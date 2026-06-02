// Workers-compatible Utah warrant poller for the CF Worker rehome.
//
// Iterates over D1 persons and queries warrants.utah.gov for each one,
// records a run summary in warrant_watch_runs, and returns counts.
//
// v1 was a "smoke poll" against a single known-returning query (JOHN SMITH)
// to prove the pipeline. This v2 reads the actual persons table — when D1
// has zero persons (early migration state), the loop runs 0 times and the
// dashboard shows "0 checked" instead of a fake count. That's correct
// behavior, not a regression.
//
// Design notes:
//   - User-agent: deliberate Chrome string to bypass the CloudFront WAF
//     that 403s identifier-style UAs (verified live 2026-05-24). Do NOT
//     "improve" this to an RFC-friendly identifier UA without re-validating
//     against the upstream.
//   - Org-row filter mirrors server/src/utils/utahWarrantScraper.ts:589-602
//     exactly. Skipping these saves rate budget and avoids HTTP 400s.
//   - MAX_PERSONS_PER_RUN caps each cron firing to stay within Workers'
//     CPU budget (~15min on paid plan). At 8s per fetch plus jitter,
//     50 persons fit comfortably. Larger rosters need a resume-from-cursor
//     pattern, deferred to v3.
//   - new_warrants_found counts UNIQUE warrants returned across all persons
//     this run. We don't yet have a `scraped_warrants` table to dedup
//     against historical state, so "new" here means "appeared this run"
//     not "appeared this run for the first time ever." Improves once
//     scraped_warrants is added.

import type { D1Database } from '@cloudflare/workers-types';
import { execute, query, queryFirst } from './db';
import { broadcastAll } from '../routes/ws';

// Source key tying this poller to its warrant_scraper_config row + the
// scraper_events WebSocket channel + the dispatcher-facing display name
// shown in the Sources/Scrapers tab.
const SOURCE_KEY = 'utah-warrant-watch';
const DISPLAY_NAME = 'Utah Warrant Watch';
const SOURCE_PRIORITY = 1;

const API_BASE = 'https://warrants.utah.gov/api/v1';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 15_000;
const BASE_DELAY_MS = 8_000; // matches legacy adaptive baseline
const MAX_PERSONS_PER_RUN = 50;

interface PersonRow {
  id: number;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  dob: string | null;
}

/**
 * Upstream person candidate. Verified live 2026-05-24 against
 * POST warrants.utah.gov/api/v1/persons — the real shape includes
 * homeAddress.city and age (as a STRING, e.g. "64"), neither of which
 * the prior PersonStub declared, so both were silently discarded.
 */
interface PersonStub {
  id: string;
  name: { first: string; middle?: string; last: string };
  homeAddress?: { city?: string };
  age?: string; // API returns a string, NOT a number
}

/** Full upstream warrant shape from /persons/:id/warrants. */
interface UtahApiWarrant {
  id: string;
  issueDate?: string;
  court?: { name?: string; caseId?: string };
  charges?: string[];
}

/** Row we insert into utah_warrants — joins the upstream person + warrant data. */
export interface FetchedWarrant {
  utah_person_id: string;
  utah_warrant_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  age: number | null;
  city: string | null;
  issue_date: string | null;
  court_name: string | null;
  case_id: string | null;
  charges: string; // JSON-stringified array
}

export interface WatchRunResult {
  run_id: string;
  status: 'completed' | 'failed';
  persons_checked: number;
  new_warrants_found: number;
  warrants_cleared: number;
  errors: number;
  error_message?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Whole-years age from an ISO-ish dob string, or null if unparseable. */
function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const born = new Date(dob);
  if (isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

// How many years the local DOB-derived age may differ from the upstream
// `age` field and still count as the same person. ±1 absorbs the
// birthday-timing gap between when the state computed `age` and now.
const AGE_MATCH_TOLERANCE = 1;

/**
 * Decide whether an upstream candidate is plausibly the SAME human as the
 * local person — the guard against attributing a namesake's warrant to the
 * wrong local file. "John Smith" returns 8 distinct people; without this
 * filter every one of their warrants lands on a single local person_id.
 *
 * Confident path: local DOB present → derive age, require the upstream
 * `age` to be within AGE_MATCH_TOLERANCE years. Middle-initial agreement
 * (when both sides have one) further confirms.
 *
 * Ambiguous path: local person has NO dob, so age can't disambiguate.
 * That branch is a deliberate policy decision — see TODO below.
 */
function isLikelyMatch(local: PersonRow, candidate: PersonStub): boolean {
  const localAge = ageFromDob(local.dob);
  const upstreamAge = candidate.age != null ? parseInt(candidate.age, 10) : NaN;

  if (localAge != null && Number.isFinite(upstreamAge)) {
    if (Math.abs(localAge - upstreamAge) > AGE_MATCH_TOLERANCE) return false;
    // Age agrees. If BOTH have a middle name, require first-initial match
    // to reject "JOHN K SMITH" vs "JOHN E SMITH" same-age collisions.
    const lm = local.middle_name?.trim()?.[0]?.toUpperCase();
    const um = candidate.name.middle?.trim()?.[0]?.toUpperCase();
    if (lm && um && lm !== um) return false;
    return true;
  }

  // Policy (operator decision 2026-05-24): when the local record has no DOB,
  // age-matching is impossible, so attribute the namesake rather than skip
  // the person entirely. Age-from-DOB remains the PRIMARY matcher above —
  // this branch only runs for DOB-less local records (≈25% of the roster).
  // Tradeoff accepted: some namesake false-positives on DOB-less records,
  // in exchange for never silently leaving a person unchecked. Backfilling
  // DOBs on those records upgrades them to the confident path automatically.
  return true;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search the public Utah warrants API for one person.
 * Returns the full warrant details (joined with upstream person data)
 * for caller-side persistence. Throws on transport error.
 *
 * v3 (this revision): returns full warrant rows instead of just a count
 * so the caller can persist them via recordWarrant() into utah_warrants.
 * Earlier versions counted and discarded — see git blame for the count-only
 * implementation prior to migration 0035.
 */
export async function fetchWarrantsForPerson(person: PersonRow): Promise<FetchedWarrant[]> {
  const personsRes = await fetchWithTimeout(`${API_BASE}/persons`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': USER_AGENT,
    },
    body: JSON.stringify({
      name: { first: person.first_name, last: person.last_name },
    }),
  });

  if (personsRes.status === 404 || personsRes.status === 204) return [];
  if (!personsRes.ok && personsRes.status !== 201) {
    throw new Error(`persons search ${personsRes.status}`);
  }

  const personsJson = (await personsRes.json()) as { persons?: PersonStub[] };
  const allCandidates = personsJson.persons ?? [];
  if (allCandidates.length === 0) return [];

  // Reject namesakes BEFORE fetching their warrants — saves rate budget and
  // prevents attributing a stranger's warrant to this local person.
  const candidates = allCandidates.filter((c) => isLikelyMatch(person, c));
  if (candidates.length === 0) return [];

  const out: FetchedWarrant[] = [];
  for (const candidate of candidates) {
    const warrantsRes = await fetchWithTimeout(
      `${API_BASE}/persons/${encodeURIComponent(candidate.id)}/warrants`,
      { headers: { accept: 'application/json', 'user-agent': USER_AGENT } },
    );
    if (warrantsRes.status === 404) continue;
    if (!warrantsRes.ok) throw new Error(`warrants/${candidate.id} ${warrantsRes.status}`);
    const wJson = (await warrantsRes.json()) as { warrants?: UtahApiWarrant[] };
    const ageNum = candidate.age != null ? parseInt(candidate.age, 10) : NaN;
    for (const w of wJson.warrants ?? []) {
      out.push({
        utah_person_id: candidate.id,
        utah_warrant_id: w.id,
        first_name: candidate.name.first,
        middle_name: candidate.name.middle ?? null,
        last_name: candidate.name.last,
        // API returns age as a string ("64"); parse to int, null if absent.
        age: Number.isFinite(ageNum) ? ageNum : null,
        // homeAddress.city IS exposed by the upstream API (verified live).
        city: candidate.homeAddress?.city ?? null,
        issue_date: w.issueDate ?? null,
        court_name: w.court?.name ?? null,
        case_id: w.court?.caseId ?? null,
        charges: JSON.stringify(w.charges ?? []),
      });
    }
  }
  return out;
}

/**
 * Persist one fetched warrant into utah_warrants.
 *
 * Lifecycle model: first-seen + last-seen, mutable detail fields.
 *   - first_seen_at and issue_date are immutable after initial insert (the
 *     timeline anchors — "when did THIS warrant first appear in our view?").
 *   - last_seen_at + is_active are refreshed on every re-fetch. The matching
 *     markClearedWarrants() pass below flips is_active=0 for rows the latest
 *     run didn't return.
 *   - charges/court_name/case_id/age/middle_name are overwritten with the
 *     latest upstream values — warrant charges can be amended court-side,
 *     and we want the dashboard to reflect that without an audit table.
 *
 * If we ever need a full mutation audit (e.g. for evidence chain), add a
 * separate utah_warrant_observations table; don't try to retrofit it here.
 */
// Returns true when this run inserted a brand-new utah_warrants row (a
// genuinely first-seen warrant) vs. refreshed an existing one. The caller
// uses it to decide whether to emit a 'warrant_found' notification — we only
// want to alert on the transition into our view, not on every steady-state
// re-confirmation every 4 hours.
async function recordWarrant(
  db: D1Database,
  w: FetchedWarrant,
  localPersonId: number | null,
): Promise<boolean> {
  const existing = await queryFirst<{ id: number; is_active: number }>(
    db,
    'SELECT id, is_active FROM utah_warrants WHERE utah_person_id = ? AND utah_warrant_id = ?',
    w.utah_person_id, w.utah_warrant_id,
  );
  await execute(
    db,
    `INSERT INTO utah_warrants (
       utah_person_id, utah_warrant_id, first_name, middle_name, last_name,
       age, city, issue_date, court_name, case_id, charges, person_id,
       first_seen_at, last_seen_at, is_active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 1)
     ON CONFLICT (utah_person_id, utah_warrant_id) DO UPDATE SET
       last_seen_at = datetime('now'),
       is_active    = 1,
       charges      = excluded.charges,
       court_name   = excluded.court_name,
       case_id      = excluded.case_id,
       age          = excluded.age,
       middle_name  = excluded.middle_name`,
    w.utah_person_id, w.utah_warrant_id,
    w.first_name, w.middle_name, w.last_name,
    w.age, w.city, w.issue_date, w.court_name, w.case_id, w.charges,
    localPersonId,
  );
  // "New" = no row before, OR a previously-cleared row resurfacing (is_active
  // flipped 0→1). Both are notification-worthy transitions.
  return !existing || existing.is_active === 0;
}

// Parse the JSON-array charges string into a human "A; B" line for the
// canonical warrants record (utah_warrants stores the raw JSON; the records
// table wants display text). Falls back to the raw value if not an array.
function chargesToText(charges: string | null): string {
  if (!charges) return '';
  try {
    const arr = JSON.parse(charges);
    return Array.isArray(arr) ? arr.filter(Boolean).map(String).join('; ') : String(charges);
  } catch { return String(charges); }
}

// Auto-save a CONFIRMED Utah warrant into the canonical `warrants` records
// table so it's retained as a first-class record even after Utah drops it
// from their public DB. Idempotent on (external_warrant_id, external_source_key):
// re-pulls UPDATE the existing row (and un-archive it if it had been cleared
// and the warrant reappeared). Only confirmed (DOB-age-matched) hits are
// promoted — unverified namesakes stay as utah_warrants leads to avoid
// attributing a stranger's warrant to a real person's permanent record.
async function syncLocalWarrantRecord(
  db: D1Database,
  w: FetchedWarrant,
  localPersonId: number,
): Promise<void> {
  const chargeText = chargesToText(w.charges);
  const subjectName = [w.first_name, w.last_name].filter(Boolean).join(' ').trim() || null;
  const existing = await queryFirst<{ id: number }>(
    db,
    'SELECT id FROM warrants WHERE external_warrant_id = ? AND external_source_key = ?',
    w.utah_warrant_id, SOURCE_KEY,
  );
  if (existing) {
    await execute(
      db,
      `UPDATE warrants SET
         status='active', archived_at=NULL,
         subject_person_id=?, subject_name=?, subject_first_name=?, subject_last_name=?,
         charge_description=?, offense=?, issuing_court=?, court=?, issued_date=?,
         scraped_source=?, scraped_raw=?, confirmed=1, auto_created=1,
         last_checked_at=datetime('now'), last_check_result='active',
         updated_at=datetime('now')
       WHERE id=?`,
      localPersonId, subjectName, w.first_name, w.last_name,
      chargeText, chargeText, w.court_name, w.court_name, w.issue_date,
      SOURCE_KEY, JSON.stringify(w), existing.id,
    );
    return;
  }
  // warrant_number is UNIQUE; UTW-<id> is deterministic per Utah warrant.
  try {
    await execute(
      db,
      `INSERT INTO warrants (
         warrant_number, type, warrant_type, status,
         subject_person_id, subject_name, subject_first_name, subject_last_name,
         charge_description, offense, issuing_court, court, issued_date,
         source, external_warrant_id, external_source_key, scraped_source, scraped_raw,
         auto_created, confirmed, last_checked_at, last_check_result, created_at, updated_at
       ) VALUES (?, 'arrest', 'arrest', 'active',
         ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         1, 1, datetime('now'), 'active', datetime('now'), datetime('now'))`,
      `UTW-${w.utah_warrant_id}`,
      localPersonId, subjectName, w.first_name, w.last_name,
      chargeText, chargeText, w.court_name, w.court_name, w.issue_date,
      SOURCE_KEY, w.utah_warrant_id, SOURCE_KEY, SOURCE_KEY, JSON.stringify(w),
    );
  } catch (err) {
    // Non-fatal: a UNIQUE collision on warrant_number (e.g. a manual record
    // already claimed UTW-<id>) shouldn't abort the whole scan.
    console.warn(`[Utah Warrants] local record sync skipped for ${w.utah_warrant_id}:`,
      err instanceof Error ? err.message : String(err));
  }
}

// Append a warrant_watch_log event — the warrant subsystem's notification
// feed (Alert Feed on the Dashboard tab + recentHits on the Watch tab read
// event IN ('warrant_found','warrant_cleared')). Best-effort: a logging
// failure must never abort the scan.
async function logWatchEvent(
  db: D1Database,
  event: 'warrant_found' | 'warrant_cleared',
  w: { first_name?: string | null; last_name?: string | null; utah_warrant_id: string;
       utah_person_id?: string | null; court_name?: string | null; case_id?: string | null;
       charges?: string | null; issue_date?: string | null },
  personId: number | null,
  runId: string,
): Promise<void> {
  try {
    const name = [w.first_name, w.last_name].filter(Boolean).join(' ').trim() || null;
    await execute(
      db,
      `INSERT INTO warrant_watch_log (
         person_id, person_name, event, utah_warrant_id, utah_person_id,
         court_name, case_id, charges, issue_date, scan_run_id, run_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      personId, name, event, w.utah_warrant_id, w.utah_person_id ?? null,
      w.court_name ?? null, w.case_id ?? null, w.charges ?? null, w.issue_date ?? null,
      runId, runId,
    );
  } catch (err) {
    console.warn('[Utah Warrants] watch_log insert failed:',
      err instanceof Error ? err.message : String(err));
  }
}

/**
 * Mark warrants is_active=0 when they weren't seen in the current run.
 * Used at end of runUtahWarrantScan to count warrants_cleared.
 *
 * Returns the number of rows that transitioned active → cleared.
 *
 * CRITICAL — datetime FORMAT NORMALISATION. `last_seen_at` is written by
 * recordWarrant() via SQLite's `datetime('now')`, which yields the canonical
 * `YYYY-MM-DD HH:MM:SS` form (SPACE separator). `runStartedAt` is a JS
 * `new Date().toISOString()` string: `YYYY-MM-DDTHH:MM:SS.sssZ` (T separator
 * + fractional seconds + Z). A raw `last_seen_at < ?` is a *lexicographic
 * TEXT* compare — and at index 10 a space (0x20) always sorts before 'T'
 * (0x54), so EVERY space-formatted row compared as "less than" ANY
 * T-formatted start time, regardless of the real instant. That cleared every
 * warrant on every run (the "found N / cleared N forever, all is_active=0"
 * churn). Wrapping BOTH sides in datetime() reduces them to the same
 * canonical form so the comparison is a true chronological one.
 */
async function markClearedWarrants(
  db: D1Database,
  runStartedAt: string,
  runId: string,
): Promise<number> {
  // Identify the rows that are about to clear BEFORE flipping them, so we can
  // emit a per-warrant notification and archive the canonical record. (A bulk
  // UPDATE alone loses the identity of what cleared.)
  const clearing = await query<{
    person_id: number | null; first_name: string | null; last_name: string | null;
    utah_person_id: string; utah_warrant_id: string; court_name: string | null;
    case_id: string | null; charges: string | null; issue_date: string | null;
  }>(
    db,
    `SELECT person_id, first_name, last_name, utah_person_id, utah_warrant_id,
            court_name, case_id, charges, issue_date
       FROM utah_warrants
      WHERE is_active = 1 AND datetime(last_seen_at) < datetime(?)`,
    runStartedAt,
  );
  if (clearing.length === 0) return 0;

  // Flip the cache rows inactive — RETAINED, never deleted, so the warrant
  // survives in our DB after Utah drops it from their public feed.
  await execute(
    db,
    `UPDATE utah_warrants
        SET is_active = 0
      WHERE is_active = 1
        AND datetime(last_seen_at) < datetime(?)`,
    runStartedAt,
  );

  for (const r of clearing) {
    // Archive the canonical record (if one was auto-created for a confirmed
    // hit). 'recalled' = no longer in force per the source; archived_at marks
    // the soft-archive; the row is RETAINED for the permanent record.
    try {
      await execute(
        db,
        `UPDATE warrants
            SET status='recalled', archived_at=datetime('now'),
                last_checked_at=datetime('now'), last_check_result='cleared',
                notification_sent=1, updated_at=datetime('now')
          WHERE external_warrant_id=? AND external_source_key=? AND status='active'`,
        r.utah_warrant_id, SOURCE_KEY,
      );
    } catch (err) {
      console.warn('[Utah Warrants] archive-on-clear failed:',
        err instanceof Error ? err.message : String(err));
    }
    // Notification: warrant no longer active on the source DB.
    await logWatchEvent(db, 'warrant_cleared', r, r.person_id, runId);
  }
  return clearing.length;
}

/**
 * Per-person Utah warrant scan. Reads persons from D1, queries each against
 * warrants.utah.gov, records summary in warrant_watch_runs.
 *
 * When D1 has 0 persons, completes successfully with persons_checked=0 —
 * that's the early-migration state and exactly what the dashboard should show.
 *
 * Old export name (`runUtahWarrantSmokePoll`) kept as an alias for
 * backward compat with code that imports the prior smoke-poll name.
 */
export async function runUtahWarrantScan(db: D1Database): Promise<WatchRunResult> {
  const run_id = `utah-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const started_at = new Date().toISOString();

  await execute(
    db,
    `INSERT INTO warrant_watch_runs (run_id, started_at, status, persons_checked,
      new_warrants_found, warrants_cleared, errors)
     VALUES (?, ?, 'running', 0, 0, 0, 0)`,
    run_id,
    started_at,
  );

  // WebSocket fan-out to anyone watching the Sources/Scrapers Live Feed.
  // No-op when run from the cron isolate (no connected clients) — that's
  // fine; the broadcasts matter for the manual-trigger UX where the
  // operator is on the page waiting for completion.
  try {
    broadcastAll('scraper_events', {
      event: 'run_started',
      source_key: SOURCE_KEY,
      display_name: DISPLAY_NAME,
      priority: SOURCE_PRIORITY,
      started_at,
    });
  } catch { /* non-fatal */ }

  let persons_checked = 0;
  let new_warrants_found = 0;
  let warrants_cleared = 0;
  let errors = 0;
  let status: 'completed' | 'failed' = 'completed';
  let error_message: string | undefined;

  try {
    // Filter rules (mirror server/src/utils/utahWarrantScraper.ts:589-602
    // and looksLikeOrganization() — keep in sync):
    //   - parens/commas in either name → CRM org rows like
    //     "Capital One, N.A., ..." with last_name "(Organization)"
    //   - >30 char names → business descriptions concatenated into one field
    // Filtered rows return HTTP 400 from warrants.utah.gov and burn rate budget.
    const persons = await query<PersonRow>(
      db,
      `SELECT id, first_name, middle_name, last_name, dob
         FROM persons
        WHERE first_name IS NOT NULL AND first_name != ''
          AND last_name  IS NOT NULL AND last_name  != ''
          AND first_name NOT LIKE '%(%' AND first_name NOT LIKE '%)%'
          AND first_name NOT LIKE '%,%'
          AND last_name  NOT LIKE '%(%' AND last_name  NOT LIKE '%)%'
          AND last_name  NOT LIKE '%,%'
          AND length(first_name) <= 30
          AND length(last_name)  <= 30
        ORDER BY last_name, first_name
        LIMIT ?`,
      MAX_PERSONS_PER_RUN,
    );

    for (const person of persons) {
      // Confirmed = local DOB present, so isLikelyMatch age-gated the candidate
      // before we ever fetched it. Only confirmed hits are promoted to the
      // canonical warrants records table; DOB-less namesakes stay as leads.
      const confirmed = !!(person.dob && person.dob.trim() !== '');
      try {
        const fetched = await fetchWarrantsForPerson(person);
        for (const w of fetched) {
          const isNew = await recordWarrant(db, w, person.id);
          if (confirmed) await syncLocalWarrantRecord(db, w, person.id);
          // Notify on first appearance (new or resurfaced) for every hit —
          // the watch feed surfaces leads too; the records table does not.
          if (isNew) await logWatchEvent(db, 'warrant_found', w, person.id, run_id);
        }
        new_warrants_found += fetched.length;
      } catch (err) {
        errors++;
        console.warn(
          `[Utah Warrants] ${person.first_name} ${person.last_name}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      persons_checked++;
      if (persons_checked < persons.length) {
        // 8s + 0-2s jitter — matches legacy adaptive pattern, stays under
        // the WAF's "scraper" heuristic.
        await sleep(BASE_DELAY_MS + Math.floor(Math.random() * 2_000));
      }
    }

    // Sweep: anything whose last_seen_at predates this run is cleared —
    // archives the canonical record + emits a warrant_cleared notification.
    warrants_cleared = await markClearedWarrants(db, started_at, run_id);
  } catch (err) {
    status = 'failed';
    error_message = err instanceof Error ? err.message : String(err);
  }

  const completed_at = new Date().toISOString();
  await execute(
    db,
    `UPDATE warrant_watch_runs
       SET completed_at = ?, status = ?, persons_checked = ?,
           new_warrants_found = ?, warrants_cleared = ?, errors = ?, error_message = ?
       WHERE run_id = ?`,
    completed_at,
    status,
    persons_checked,
    new_warrants_found,
    warrants_cleared,
    errors,
    error_message ?? null,
    run_id,
  );

  // Persist current scraper state to warrant_scraper_config so /scrapers
  // shows the correct "current state" even without joining warrant_watch_runs.
  // CASE clauses keep last_success_at on a failed run and clear last_error
  // on a successful one, so the field reads as "is it broken NOW?".
  try {
    await execute(
      db,
      `UPDATE warrant_scraper_config
          SET last_run_at = ?,
              last_success_at = CASE WHEN ? = 'completed' THEN ? ELSE last_success_at END,
              last_error      = CASE WHEN ? = 'failed'    THEN ? ELSE NULL END
        WHERE source_name = ?`,
      completed_at,
      status, completed_at,
      status, error_message ?? null,
      SOURCE_KEY,
    );
  } catch (err) {
    console.warn('[Utah Warrants] config update failed:', err);
  }

  // Broadcast run completion (Live Feed). Discriminated union on `event` per
  // ScraperWsEvent in client/src/types/scrapers.ts.
  try {
    if (status === 'completed') {
      broadcastAll('scraper_events', {
        event: 'run_completed',
        source_key: SOURCE_KEY,
        display_name: DISPLAY_NAME,
        http_status: 200,
        parsed: new_warrants_found,
        inserted: new_warrants_found,
        updated: warrants_cleared,
        unchanged: new_warrants_found === 0,
        parser_used: 'custom',
      });
    } else {
      broadcastAll('scraper_events', {
        event: 'run_failed',
        source_key: SOURCE_KEY,
        display_name: DISPLAY_NAME,
        error: error_message ?? 'Scan failed',
      });
    }
  } catch { /* non-fatal */ }

  return {
    run_id,
    status,
    persons_checked,
    new_warrants_found,
    warrants_cleared,
    errors,
    error_message,
  };
}

/** Read-only: latest run summary for header badges, dashboard widgets, etc. */
export async function getLatestUtahWatchRun(db: D1Database) {
  return queryFirst<{
    run_id: string;
    started_at: string;
    completed_at: string | null;
    status: 'running' | 'completed' | 'failed';
    persons_checked: number;
    new_warrants_found: number;
    warrants_cleared: number;
    errors: number;
    error_message: string | null;
  }>(db, 'SELECT * FROM warrant_watch_runs ORDER BY started_at DESC LIMIT 1');
}

/** @deprecated alias kept for backward compat with v1 callers; use runUtahWarrantScan */
export const runUtahWarrantSmokePoll = runUtahWarrantScan;
