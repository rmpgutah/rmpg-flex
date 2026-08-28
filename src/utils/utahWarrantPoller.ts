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
//
// 2026-07-17 REBUILD: the state migrated warrants.utah.gov to a new
// API entirely — POST /api/v1/persons + GET /api/v1/persons/:id/warrants
// now 403 at the CloudFront edge ("distribution ... supports only cachable
// requests", i.e. GET-only). Verified live against the site's own
// js/scripts.js: it now calls GET /warrant-api/warrantPublic/search
// ?firstName=X&lastName=Y (values UPPERCASED) for candidates, then
// GET /warrant-api/warrantPublic/detail/:personId for that person's
// warrants — both requiring a `X-Proxy-App: warrants` header (a plain
// server-side fetch with that header + a browser UA works fine; no
// browser-fingerprint/JS-challenge involved, confirmed via curl).
// Every person fetch had been failing 100% (50/50 errors, every run,
// for hours) until this rewrite — this is why the Sources/Scrapers tab
// showed permanent "NaN" active-warrant/indexed counts and a scan
// history of nothing but errors.

import { log } from './logger';
import type { D1Database } from '@cloudflare/workers-types';
import { execute, query, queryFirst } from './db';
import { broadcastAll } from '../routes/ws';
import { isCircuitOpen } from './warrantSources/resilience';
// Reused rather than re-implemented: warrant_watch_runs mixes ISO-8601
// (toISOString) and zone-less datetime('now') timestamps, which is exactly the
// skew this helper exists to normalize. Its own docblock argues for centralizing
// it instead of keeping parallel copies.
import { parseD1TimestampMs } from './fleetio/sync';
import { confirmIdentity } from './identityConfirm';

// Source key tying this poller to its warrant_scraper_config row + the
// scraper_events WebSocket channel + the dispatcher-facing display name
// shown in the Sources/Scrapers tab.
const SOURCE_KEY = 'utah-warrant-watch';
const DISPLAY_NAME = 'Utah Warrant Watch';
const SOURCE_PRIORITY = 1;

const API_BASE = 'https://warrants.utah.gov/warrant-api/warrantPublic';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
// Required by the CloudFront distribution in front of the new API — a
// plain fetch without it 403s with {"message":"Missing X-Proxy-App header"}.
// Value copied verbatim from the site's own js/scripts.js fetch calls.
const PROXY_APP_HEADER = 'warrants';

const REQUEST_TIMEOUT_MS = 15_000;
const BASE_DELAY_MS = 8_000; // matches legacy adaptive baseline
// Fallback only — the live cap is read from warrant_scraper_config.max_persons_per_run
// (migration 0200) so it can be retuned without a redeploy. This constant is used
// solely when that row/column is missing (fresh D1, migration not yet applied).
const DEFAULT_MAX_PERSONS_PER_RUN = 60;
// ── Execution-window budget ───────────────────────────────────────────────────
// Cloudflare caps a Cron Trigger invocation at 15 MINUTES of wall time (and
// waitUntil() at only 30s past a response). This loop sleeps BASE_DELAY_MS
// between every person, so 150 persons needed ~20-25 min — meaning the finalize
// UPDATE below the loop was UNREACHABLE and every run stayed 'running' forever
// (20/20 rows in live D1 on 2026-07-30, oldest 3 days old, all with the
// persons_checked=0 that the INSERT wrote). The health write to
// warrant_scraper_config sits below the loop too, which is why
// last_success_at was frozen at 2026-07-24.
//
// Two guards, because either alone is insufficient:
//   - DEFAULT_MAX_PERSONS_PER_RUN (60 x ~10s = ~10 min) sizes the COMMON path,
//     but it is only a fallback — the live cap comes from
//     warrant_scraper_config.max_persons_per_run and can be retuned to
//     anything, so it cannot be trusted to bound wall time.
//   - RUN_WALL_BUDGET_MS is the HARD backstop: whatever the configured slice
//     size and however slow the upstream gets, the loop stops in time to
//     finalize. persons_cursor_id already resumes the next slice on the next
//     tick, so stopping early loses no coverage — it just spreads it out.
const RUN_WALL_BUDGET_MS = 10 * 60 * 1000;
// A manual trigger runs inside a request isolate, where waitUntil() grants only
// 30s past the response. Give it a much smaller budget so it does a real,
// honestly-finalized slice instead of orphaning a row it can never close.
export const MANUAL_RUN_WALL_BUDGET_MS = 20 * 1000;
// Any run still 'running' past this is not slow, it is dead — its isolate was
// evicted. Comfortably above RUN_WALL_BUDGET_MS so a healthy long run is never
// reaped out from under itself.
const STALE_RUN_TIMEOUT_MS = 20 * 60 * 1000;
// Emit a run_progress WS event every N persons so the Sources/Scrapers Live
// Feed and the Warrants-tab poll-status strip show movement mid-run instead
// of only start/end.
const PROGRESS_EVENT_INTERVAL = 10;

interface PersonRow {
  id: number;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  dob: string | null;
}

/**
 * Upstream person candidate. Verified live 2026-07-17 against
 * GET warrants.utah.gov/warrant-api/warrantPublic/search?firstName=&lastName=.
 * `age` is a NUMBER here (unlike the pre-migration API's stringified age).
 * The search endpoint returns duplicate rows per personId (name-spelling
 * variants, multiple addresses on file) — callers must dedup by personId.
 */
export interface PersonStub {
  personId: number;
  firstName: string;
  middleName?: string;
  lastName: string;
  age?: number;
  city?: string;
  zipCode?: string;
}

/** One warrant from GET /warrant-api/warrantPublic/detail/:personId's `warrant[]`. */
interface UtahApiWarrant {
  warrantNumber?: string;
  issueDate?: string;
  courtDescription?: string;
  courtCaseNumber?: string;
  chargeDescription?: string[];
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

/**
 * Decide whether an upstream candidate is the SAME human as the local person.
 * "John Smith" returns many people; we require name + DOB/age confirmation
 * (and reject a city conflict) before attributing any warrant. A local
 * person with no DOB is never auto-linked to a namesake.
 */
function isLikelyMatch(local: PersonRow, candidate: PersonStub): boolean {
  const verdict = confirmIdentity(
    { first: local.first_name, last: local.last_name, dob: local.dob },
    {
      first: candidate.firstName,
      last: candidate.lastName,
      age: candidate.age,
      city: candidate.city,
    },
  );
  if (!verdict.matched) return false;
  // Age agrees. If BOTH have a middle name, require first-initial match
  // to reject "JOHN K SMITH" vs "JOHN E SMITH" same-age collisions.
  const lm = local.middle_name?.trim()?.[0]?.toUpperCase();
  const um = candidate.middleName?.trim()?.[0]?.toUpperCase();
  if (lm && um && lm !== um) return false;
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
export async function searchUtahCandidates(firstName: string, lastName: string): Promise<PersonStub[]> {
  const params = new URLSearchParams();
  params.set('firstName', firstName.toUpperCase());
  params.set('lastName', lastName.toUpperCase());

  const searchRes = await fetchWithTimeout(`${API_BASE}/search?${params.toString()}`, {
    method: 'GET',
    headers: {
      'X-Proxy-App': PROXY_APP_HEADER,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': USER_AGENT,
    },
  });

  if (searchRes.status === 404 || searchRes.status === 204) return [];
  if (!searchRes.ok) {
    throw new Error(`search ${searchRes.status}`);
  }

  const allCandidates = (await searchRes.json()) as PersonStub[];
  if (!Array.isArray(allCandidates) || allCandidates.length === 0) return [];

  const seenPersonIds = new Set<number>();
  return allCandidates.filter((c) => {
    if (!c?.personId || seenPersonIds.has(c.personId)) return false;
    seenPersonIds.add(c.personId);
    return true;
  });
}

export async function fetchWarrantsForCandidates(candidates: PersonStub[]): Promise<FetchedWarrant[]> {
  const out: FetchedWarrant[] = [];
  for (const candidate of candidates) {
    const detailRes = await fetchWithTimeout(
      `${API_BASE}/detail/${encodeURIComponent(candidate.personId)}`,
      { headers: { 'X-Proxy-App': PROXY_APP_HEADER, accept: 'application/json', 'user-agent': USER_AGENT } },
    );
    if (detailRes.status === 404) continue;
    if (!detailRes.ok) throw new Error(`detail/${candidate.personId} ${detailRes.status}`);
    const detail = (await detailRes.json()) as { warrant?: UtahApiWarrant[] };
    for (const w of detail.warrant ?? []) {
      out.push({
        utah_person_id: String(candidate.personId),
        utah_warrant_id: w.warrantNumber || `${candidate.personId}:${w.courtCaseNumber ?? ''}:${w.issueDate ?? ''}`,
        first_name: candidate.firstName,
        middle_name: candidate.middleName ?? null,
        last_name: candidate.lastName,
        age: typeof candidate.age === 'number' ? candidate.age : null,
        city: candidate.city?.trim() || null,
        issue_date: w.issueDate ?? null,
        court_name: w.courtDescription ?? null,
        case_id: w.courtCaseNumber ?? null,
        charges: JSON.stringify(w.chargeDescription ?? []),
      });
    }
  }
  return out;
}

export async function fetchWarrantsForPerson(person: PersonRow): Promise<FetchedWarrant[]> {
  const allCandidates = await searchUtahCandidates(person.first_name, person.last_name);
  if (allCandidates.length === 0) return [];

  // Reject namesakes BEFORE fetching their warrants — saves rate budget and
  // prevents attributing a stranger's warrant to this local person.
  const matched = allCandidates.filter((c) => isLikelyMatch(person, c));
  if (matched.length === 0) return [];
  return fetchWarrantsForCandidates(matched);
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
export async function recordWarrant(
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
         charge_description=?, issuing_court=?, issued_date=?,
         scraped_source=?, scraped_raw=?, confirmed=1, auto_created=1,
         last_checked_at=datetime('now'), last_check_result='active',
         updated_at=datetime('now')
       WHERE id=?`,
      localPersonId, subjectName, w.first_name, w.last_name,
      chargeText, w.court_name, w.issue_date,
      SOURCE_KEY, JSON.stringify(w), existing.id,
    );
    return;
  }
  // warrant_number is UNIQUE; UTW-<id> is deterministic per Utah warrant.
  try {
    await execute(
      db,
      `INSERT INTO warrants (
         warrant_number, type, status,
         subject_person_id, subject_name, subject_first_name, subject_last_name,
         charge_description, issuing_court, issued_date,
         source, external_warrant_id, external_source_key, scraped_source, scraped_raw,
         auto_created, confirmed, last_checked_at, last_check_result, created_at, updated_at
       ) VALUES (?, 'arrest', 'active',
         ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         1, 1, datetime('now'), 'active', datetime('now'), datetime('now'))`,
      `UTW-${w.utah_warrant_id}`,
      localPersonId, subjectName, w.first_name, w.last_name,
      chargeText, w.court_name, w.issue_date,
      SOURCE_KEY, w.utah_warrant_id, SOURCE_KEY, SOURCE_KEY, JSON.stringify(w),
    );
  } catch (err) {
    // Non-fatal: a UNIQUE collision on warrant_number (e.g. a manual record
    // already claimed UTW-<id>) shouldn't abort the whole scan.
    console.warn(`[Utah Warrants] local record sync skipped for ${w.utah_warrant_id}:`,
      err instanceof Error ? err.message : String(err));
  }

  // A manually-entered row may describe THIS SAME warrant under the bare
  // number, with no UTW- prefix. The lookup above cannot see it — it matches
  // on external_warrant_id, which a hand-typed record never has — so the two
  // rows coexist and drift apart. Record the disagreement.
  await recordSourceConflict(db, w);
}

/**
 * Flag a manually-entered warrant whose status disagrees with the state source.
 *
 * NEVER overwrites the local status. An officer-entered value is not silently
 * replaced by a scraper; the conflict is recorded for a human to resolve.
 *
 * Matching is deliberately conservative — the bare number ALONE is not enough,
 * since numbering is only unique per issuing court. A match additionally
 * requires the same issued_date or the same court (case-insensitive: live data
 * had "Davis County Justice Cou" against "DAVIS COUNTY JUSTICE COU").
 *
 * Found live 2026-08-01: warrants 3149919 and 3155534 each had a UTW- twin
 * agreeing on issued_date AND court, while the manual rows read 'active' and
 * the state read 'recalled' with last_check_result='cleared'. Two of the 23
 * warrants the system reported ACTIVE had been recalled by Utah.
 *
 * Best-effort: a failure here must never abort the scan.
 */
async function recordSourceConflict(db: D1Database, w: FetchedWarrant): Promise<void> {
  try {
    const scraped = await queryFirst<{ id: number; status: string }>(
      db,
      'SELECT id, status FROM warrants WHERE external_warrant_id = ? AND external_source_key = ?',
      w.utah_warrant_id, SOURCE_KEY,
    );
    if (!scraped) return;

    const bare = String(w.utah_warrant_id);
    const local = await queryFirst<{ id: number; status: string; basis: string }>(
      db,
      `SELECT id, status,
              CASE WHEN issued_date = ? AND UPPER(TRIM(COALESCE(issuing_court,''))) = UPPER(TRIM(COALESCE(?,'')))
                     THEN 'issued_date+court'
                   WHEN issued_date = ? THEN 'issued_date'
                   ELSE 'court' END AS basis
         FROM warrants
        WHERE warrant_number = ?
          AND id != ?
          AND (external_source_key IS NULL OR external_source_key != ?)
          AND (issued_date = ?
               OR UPPER(TRIM(COALESCE(issuing_court,''))) = UPPER(TRIM(COALESCE(?,''))))
        LIMIT 1`,
      w.issue_date, w.court_name, w.issue_date,
      bare, scraped.id, SOURCE_KEY, w.issue_date, w.court_name,
    );
    if (!local || local.status === scraped.status) return;

    // Upsert: the poller runs on a schedule, so re-detecting the same open
    // conflict must refresh it rather than stack a row every cycle.
    await execute(
      db,
      `INSERT INTO warrant_source_conflicts
         (local_warrant_id, scraped_warrant_id, normalized_number,
          local_status, scraped_status, match_basis, source_key, detected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(local_warrant_id, scraped_warrant_id) DO UPDATE SET
         local_status = excluded.local_status,
         scraped_status = excluded.scraped_status,
         match_basis = excluded.match_basis,
         detected_at = excluded.detected_at`,
      local.id, scraped.id, bare, local.status, scraped.status, local.basis, SOURCE_KEY,
    );

    console.warn(
      `[Utah Warrants] status conflict on ${bare}: local warrant ${local.id} is `
      + `'${local.status}' but the state source reports '${scraped.status}' `
      + `(matched on ${local.basis}). Flagged for review; local status unchanged.`,
    );
  } catch (err) {
    console.warn('[Utah Warrants] conflict check failed:',
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
  checkedPersonIds: number[],
): Promise<number> {
  // SCOPED to the persons this run actually (successfully) checked. Runs are
  // cursor-sliced (LIMIT max_persons_per_run), so "unseen since run start"
  // is only meaningful for people whose warrants this run refreshed — an
  // unscoped sweep after a tail slice cleared LIVE warrants belonging to
  // everyone in the head slice (their last_seen_at predates this run's
  // started_at by design). Persons whose fetch errored are excluded too:
  // their rows weren't refreshed, so "unseen" would be a false clear.
  if (checkedPersonIds.length === 0) return 0;
  let clearedTotal = 0;
  const CHUNK = 90; // stay under D1's 100-bound-parameter cap (+1 for the timestamp)
  for (let i = 0; i < checkedPersonIds.length; i += CHUNK) {
    const chunk = checkedPersonIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
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
        WHERE is_active = 1 AND datetime(last_seen_at) < datetime(?)
          AND person_id IN (${placeholders})`,
      runStartedAt, ...chunk,
    );
    if (clearing.length === 0) continue;

    // Flip the cache rows inactive — RETAINED, never deleted, so the warrant
    // survives in our DB after Utah drops it from their public feed.
    await execute(
      db,
      `UPDATE utah_warrants
          SET is_active = 0
        WHERE is_active = 1
          AND datetime(last_seen_at) < datetime(?)
          AND person_id IN (${placeholders})`,
      runStartedAt, ...chunk,
    );
    clearedTotal += clearing.length;

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
  }
  return clearedTotal;
}

/**
 * On-demand single-person check ("Run Check Now" in the WarrantsPage person
 * drawer). Deliberately does NOT call markClearedWarrants() — that sweep
 * clears every utah_warrants row whose last_seen_at predates the run, which
 * is only valid for a full-population run_id; scoping it to a run that only
 * ever touched one person would incorrectly mass-clear everyone else's
 * active warrants. Also doesn't write a warrant_watch_runs row — that table
 * represents scheduled/full population runs, not per-person spot-checks.
 */
export async function runUtahWarrantCheckForPerson(
  db: D1Database, personId: number,
): Promise<{ found: number; errors: number }> {
  const person = await queryFirst<PersonRow>(
    db, 'SELECT id, first_name, middle_name, last_name, dob FROM persons WHERE id = ?', personId,
  );
  if (!person) return { found: 0, errors: 0 };

  const confirmed = !!(person.dob && person.dob.trim() !== '');
  try {
    const fetched = await fetchWarrantsForPerson(person);
    for (const w of fetched) {
      await recordWarrant(db, w, person.id);
      if (confirmed) await syncLocalWarrantRecord(db, w, person.id);
    }
    return { found: fetched.length, errors: 0 };
  } catch (err) {
    console.warn(
      `[Utah Warrants] on-demand check for person ${personId} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { found: 0, errors: 1 };
  }
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
export async function runUtahWarrantScan(
  db: D1Database,
  opts: { wallBudgetMs?: number } = {},
): Promise<WatchRunResult> {
  const run_id = `utah-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const started_at = new Date().toISOString();
  // Monotonic-ish deadline for the per-person loop. See RUN_WALL_BUDGET_MS.
  const wallBudgetMs = opts.wallBudgetMs ?? RUN_WALL_BUDGET_MS;
  const runStartedMs = Date.now();
  let budgetExhausted = false;

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

  const config = await queryFirst<{
    max_persons_per_run: number | null; persons_cursor_id: number | null; consecutive_errors: number | null;
    last_run_at: string | null;
  }>(
    db,
    'SELECT max_persons_per_run, persons_cursor_id, consecutive_errors, last_run_at FROM warrant_scraper_config WHERE source_name = ?',
    SOURCE_KEY,
  );
  const maxPersonsPerRun = config?.max_persons_per_run ?? DEFAULT_MAX_PERSONS_PER_RUN;
  const cursorId = config?.persons_cursor_id ?? 0;

  // Circuit breaker: consecutive_errors was previously written for every OTHER
  // warrant source (see runScan.ts's updateNationalSourceHealth + the generic
  // scraped-leg health update) but never for Utah — meaning ScrapersTab's
  // circuit-broken badge for this source was always false regardless of how
  // long warrants.utah.gov had been down, and the cron kept hitting a dead
  // upstream every 4 hours forever. Wire it below (post-run) and gate here:
  // if 5+ consecutive whole-run failures, skip the actual scan (no upstream
  // calls, no rate-budget burn) and report a failed run immediately.
  // Half-open recovery: the skip path below never reaches the post-run config
  // update (the only place consecutive_errors resets), so a pure streak-count
  // circuit could NEVER close — a multi-day upstream outage would disable Utah
  // scanning permanently until someone hand-edited the DB. Allow one probe run
  // once the last REAL attempt (last_run_at is only written by real runs, not
  // by these skips) is older than the probe window; a failed probe re-opens
  // the circuit for another window, a successful one resets the streak to 0.
  const CIRCUIT_PROBE_WINDOW_MS = 6 * 60 * 60 * 1000;
  const lastRealRunMs = config?.last_run_at ? Date.parse(config.last_run_at) : 0;
  const probeAllowed = !Number.isFinite(lastRealRunMs) || lastRealRunMs === 0
    || Date.now() - lastRealRunMs >= CIRCUIT_PROBE_WINDOW_MS;
  if (isCircuitOpen(Array(config?.consecutive_errors ?? 0).fill(1)) && !probeAllowed) {
    error_message = `Circuit open after ${config?.consecutive_errors} consecutive failed runs — skipping this scan.`;
    const completed_at = new Date().toISOString();
    await execute(
      db,
      `UPDATE warrant_watch_runs
         SET completed_at = ?, status = 'failed', error_message = ?
       WHERE run_id = ?`,
      completed_at, error_message, run_id,
    );
    try {
      broadcastAll('scraper_events', {
        event: 'circuit_broken',
        source_key: SOURCE_KEY,
        display_name: DISPLAY_NAME,
        consecutive_errors: config?.consecutive_errors ?? 0,
        recovery_at: completed_at,
        backoff_hours: 0,
      });
    } catch { /* non-fatal */ }
    return {
      run_id, status: 'failed', persons_checked: 0, new_warrants_found: 0,
      warrants_cleared: 0, errors: 0, error_message,
    };
  }

  try {
    // Filter rules (mirror server/src/utils/utahWarrantScraper.ts:589-602
    // and looksLikeOrganization() — keep in sync):
    //   - parens/commas in either name → CRM org rows like
    //     "Capital One, N.A., ..." with last_name "(Organization)"
    //   - >30 char names → business descriptions concatenated into one field
    // Filtered rows return HTTP 400 from warrants.utah.gov and burn rate budget.
    // ORDER BY id (not name) + WHERE id > cursor so successive runs sweep a
    // fresh slice of the roster instead of always restarting at the same
    // alphabetically-first rows — the resume-cursor pattern the doc header
    // flagged as deferred v3 work.
    let persons = await query<PersonRow>(
      db,
      `SELECT id, first_name, middle_name, last_name, dob
         FROM persons
        WHERE id > ?
          AND first_name IS NOT NULL AND first_name != ''
          AND last_name  IS NOT NULL AND last_name  != ''
          AND first_name NOT LIKE '%(%' AND first_name NOT LIKE '%)%'
          AND first_name NOT LIKE '%,%'
          AND last_name  NOT LIKE '%(%' AND last_name  NOT LIKE '%)%'
          AND last_name  NOT LIKE '%,%'
          AND length(first_name) <= 30
          AND length(last_name)  <= 30
        ORDER BY id
        LIMIT ?`,
      cursorId,
      maxPersonsPerRun,
    );

    // End of roster reached — wrap back to the start so the next run
    // doesn't stall forever past the last id.
    if (persons.length === 0 && cursorId > 0) {
      persons = await query<PersonRow>(
        db,
        `SELECT id, first_name, middle_name, last_name, dob
           FROM persons
          WHERE id > 0
            AND first_name IS NOT NULL AND first_name != ''
            AND last_name  IS NOT NULL AND last_name  != ''
            AND first_name NOT LIKE '%(%' AND first_name NOT LIKE '%)%'
            AND first_name NOT LIKE '%,%'
            AND last_name  NOT LIKE '%(%' AND last_name  NOT LIKE '%)%'
            AND last_name  NOT LIKE '%,%'
            AND length(first_name) <= 30
            AND length(last_name)  <= 30
          ORDER BY id
          LIMIT ?`,
        maxPersonsPerRun,
      );
    }
    // Advance the cursor to the last id processed; wrap to 0 (restart from
    // the top) once a pass returns fewer rows than the cap — that means we
    // hit the end of the eligible roster.
    // NOTE: this is the cursor for a run that processes the WHOLE slice. If the
    // wall-budget guard below breaks early we must NOT use it — advancing past
    // people we never checked would silently skip them for a full roster pass.
    // lastProcessedId tracks what we actually got through.
    const nextCursorId =
      persons.length === 0 || persons.length < maxPersonsPerRun
        ? 0
        : persons[persons.length - 1].id;
    let lastProcessedId: number | null = null;
    // Persons whose fetch SUCCEEDED this run — the only population the
    // cleared-warrant sweep may legally reason about (see markClearedWarrants).
    const successfullyCheckedIds: number[] = [];

    for (const person of persons) {
      // Hard wall-budget guard. Stop BEFORE starting another person (each costs
      // a fetch plus a ~8-10s sleep) so there is always time left to finalize
      // this run's row. Without this the isolate is evicted mid-loop and the row
      // below never gets written — see RUN_WALL_BUDGET_MS.
      if (Date.now() - runStartedMs >= wallBudgetMs) {
        budgetExhausted = true;
        break;
      }
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
        successfullyCheckedIds.push(person.id);
      } catch (err) {
        errors++;
        console.warn(
          `[Utah Warrants] ${person.first_name} ${person.last_name}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      persons_checked++;
      lastProcessedId = person.id;
      if (persons_checked % PROGRESS_EVENT_INTERVAL === 0 && persons_checked < persons.length) {
        try {
          broadcastAll('scraper_events', {
            event: 'run_progress',
            source_key: SOURCE_KEY,
            display_name: DISPLAY_NAME,
            persons_checked,
            persons_total: persons.length,
            new_warrants_found,
            errors,
          });
        } catch { /* non-fatal */ }
      }
      if (persons_checked < persons.length) {
        // 8s + 0-2s jitter — matches legacy adaptive pattern, stays under
        // the WAF's "scraper" heuristic.
        await sleep(BASE_DELAY_MS + Math.floor(Math.random() * 2_000));
      }
    }

    // Sweep: warrants belonging to persons THIS RUN successfully checked whose
    // last_seen_at predates the run are cleared — archives the canonical record
    // + emits a warrant_cleared notification. Scoping to the checked set makes
    // the sweep safe on sliced AND budget-truncated passes alike; the old
    // unscoped sweep ("this run saw everyone") mass-cleared live warrants for
    // every person outside the current slice.
    warrants_cleared = await markClearedWarrants(db, started_at, run_id, successfullyCheckedIds);
    if (budgetExhausted) {
      console.warn(
        `[Utah Warrants] wall budget (${wallBudgetMs}ms) reached after ${persons_checked}/${persons.length} persons — resuming next tick`,
      );
    }

    // Advance the resume cursor so the next run covers a fresh slice of
    // the roster (or wraps to the top — see nextCursorId above). On a truncated
    // pass advance only as far as we actually got, so the next tick picks up at
    // the first unchecked person rather than skipping the remainder.
    const cursorToWrite = budgetExhausted ? (lastProcessedId ?? cursorId) : nextCursorId;
    try {
      await execute(
        db,
        'UPDATE warrant_scraper_config SET persons_cursor_id = ? WHERE source_name = ?',
        cursorToWrite,
        SOURCE_KEY,
      );
    } catch (err) {
      console.warn('[Utah Warrants] cursor update failed:', err);
    }
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
    // A budget-truncated pass is a SUCCESSFUL partial, not a failure — it checked
    // real people and resumes from its cursor. Record that in error_message (the
    // only free-text column here) so scan history can say "partial" instead of
    // implying full roster coverage.
    error_message
      ?? (budgetExhausted
        ? `partial: wall budget reached after ${persons_checked} person(s); resumes next tick`
        : null),
    run_id,
  );

  // A run counts as a whole-source health failure — for circuit-breaker
  // purposes — either when the scan itself threw (status='failed') or when
  // EVERY attempted person errored (a strong signal warrants.utah.gov is
  // fully down/blocking us, vs. isolated per-person hiccups which are
  // expected and already tolerated).
  const runHealthFailed = status === 'failed' || (persons_checked > 0 && errors === persons_checked);
  const wasCircuitOpen = isCircuitOpen(Array(config?.consecutive_errors ?? 0).fill(1));

  // Persist current scraper state to warrant_scraper_config so /scrapers
  // shows the correct "current state" even without joining warrant_watch_runs.
  // CASE clauses keep last_success_at on a failed run and clear last_error
  // on a successful one, so the field reads as "is it broken NOW?".
  // consecutive_errors mirrors the write path every OTHER warrant source
  // already has (see updateNationalSourceHealth in runScan.ts) — Utah never
  // had one before, so ScrapersTab's circuit-broken badge for this source
  // was always false no matter how long the upstream had been down.
  try {
    await execute(
      db,
      `UPDATE warrant_scraper_config
          SET last_run_at = ?,
              last_success_at = CASE WHEN ? = 'completed' THEN ? ELSE last_success_at END,
              last_error      = CASE WHEN ? = 'failed'    THEN ? ELSE NULL END,
              consecutive_errors = CASE WHEN ? THEN consecutive_errors + 1 ELSE 0 END
        WHERE source_name = ?`,
      completed_at,
      status, completed_at,
      status, error_message ?? null,
      runHealthFailed ? 1 : 0,
      SOURCE_KEY,
    );
  } catch (err) {
    console.warn('[Utah Warrants] config update failed:', err);
  }

  if (!runHealthFailed && wasCircuitOpen) {
    try {
      broadcastAll('scraper_events', {
        event: 'circuit_restored',
        source_key: SOURCE_KEY,
        display_name: DISPLAY_NAME,
      });
    } catch { /* non-fatal */ }
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

/**
 * Reap watch runs whose isolate died before they could finalize.
 *
 * Cloudflare caps a Cron Trigger at 15 min of wall time and a waitUntil() at 30s
 * past the response. Any run still `'running'` well past RUN_WALL_BUDGET_MS did
 * not finish slowly — it was evicted mid-loop and will never write its own
 * completion row. Left alone those rows are actively harmful: the Warrants-tab
 * poll banner reads them as a live scan (and, being injected above the tab strip,
 * overlays and swallows every tab click), Watch List reports "LAST SCAN: Never"
 * because it looks for a completed run, and scan history shows "In progress…
 * 0/0/0/0" forever.
 *
 * Live D1 on 2026-07-30 had 20/20 rows in exactly this state, the oldest 3 days
 * old. The first production tick of this reaper closes all of them out, which is
 * the intended one-time backfill.
 *
 * `completed_at` is set to `started_at + timeout` rather than now, so the row
 * reports roughly when it actually stopped being viable instead of when someone
 * happened to notice.
 *
 * Timestamps here are mixed-format — `started_at` is written as ISO-8601 UTC
 * (`toISOString()`) while sibling columns elsewhere use zone-less
 * `datetime('now')` — so comparison MUST go through `parseD1TimestampMs`, or the
 * timeout skews by the host's UTC offset (CLAUDE.md invariant).
 *
 * Returns the number of rows reaped.
 */
export async function reapStaleWatchRuns(
  db: D1Database,
  now: number = Date.now(),
): Promise<number> {
  const running = await query<{ id: number; run_id: string; started_at: string | null }>(
    db,
    `SELECT id, run_id, started_at FROM warrant_watch_runs WHERE status = 'running'`,
  );
  if (running.length === 0) return 0;

  let reaped = 0;
  for (const row of running) {
    const startedMs = parseD1TimestampMs(row.started_at);
    // An unparseable/absent started_at cannot be aged out safely — leave it and
    // log, rather than reaping a row we can't reason about.
    if (startedMs == null) {
      console.warn(`[Utah Warrants] reaper: run ${row.run_id} has unparseable started_at, skipping`);
      continue;
    }
    if (now - startedMs < STALE_RUN_TIMEOUT_MS) continue;

    const completed_at = new Date(startedMs + STALE_RUN_TIMEOUT_MS).toISOString();
    await execute(
      db,
      `UPDATE warrant_watch_runs
          SET status = 'failed', completed_at = ?, error_message = ?
        WHERE id = ? AND status = 'running'`,
      completed_at,
      'run did not finalize within the execution window (isolate evicted before completion)',
      row.id,
    );
    reaped++;
  }

  if (reaped > 0) {
    console.warn(`[Utah Warrants] reaper: closed out ${reaped} stale 'running' run(s)`);
  }
  return reaped;
}

/**
 * Continue a roster pass that the wall budget truncated, WITHOUT waiting for the
 * next 4-hourly cron tick.
 *
 * WHY. The wall-budget guard is not optional — Cloudflare caps a Cron Trigger at
 * 15 minutes, so a run that tries to sweep the whole roster in one invocation is
 * killed mid-loop and never finalizes (that was the original 20/20-stuck-rows
 * bug). The limit cannot be removed. What CAN be removed is the limit's
 * CONSEQUENCE: a truncated pass used to sit idle for up to 4 hours before
 * resuming, so people at the far end of the roster went unchecked for most of a
 * day. Observed live 2026-07-31: two consecutive passes stopped at 59 and 60 of
 * 83 people.
 *
 * This runs on the per-minute cron and immediately continues from
 * `persons_cursor_id` until the pass completes, so NO PERSON IS SKIPPED and no
 * pass is abandoned — the roster is always swept end to end.
 *
 * It is deliberately bounded to finishing the current pass rather than looping
 * forever. Once the cursor wraps to 0 the pass is complete (and the
 * cleared-warrant sweep has run), and we stop until the next scheduled tick.
 * That matters: the 8s-per-person pacing exists to stay under
 * warrants.utah.gov's WAF scraper heuristic, and turning this into a 24/7
 * crawler would risk RMPG being blocked outright — which would take warrant
 * checks down completely, a far worse outcome than a slower sweep.
 *
 * Overlap-safe: skips entirely while any run is still 'running', so the
 * per-minute cadence cannot start a second concurrent scan. If an isolate dies
 * mid-run, `reapStaleWatchRuns` closes the row out and resumption self-heals on
 * the following tick.
 *
 * @returns the run result if a continuation was started, else null.
 */
export async function resumePartialWatchRun(db: D1Database): Promise<WatchRunResult | null> {
  // 1. Never overlap a live run.
  const inFlight = await queryFirst<{ n: number }>(
    db, `SELECT COUNT(*) AS n FROM warrant_watch_runs WHERE status = 'running'`);
  if ((inFlight?.n ?? 0) > 0) return null;

  // 2. Only continue when the LAST run was itself budget-truncated. A run that
  //    completed a full pass, failed outright, or was reaped is not resumable —
  //    resuming those would be a new pass, which is the cron's job, not ours.
  const latest = await queryFirst<{ status: string; error_message: string | null }>(
    db, `SELECT status, error_message FROM warrant_watch_runs ORDER BY started_at DESC LIMIT 1`);
  if (!latest || latest.status !== 'completed') return null;
  if (!String(latest.error_message ?? '').startsWith('partial:')) return null;

  // 3. Confirm we are genuinely mid-pass. The cursor wraps to 0 when a pass
  //    reaches the end of the eligible roster, so a zero cursor means the pass
  //    finished and there is nothing to resume.
  const cfg = await queryFirst<{ persons_cursor_id: number | null }>(
    db, 'SELECT persons_cursor_id FROM warrant_scraper_config WHERE source_name = ?', SOURCE_KEY);
  if (!cfg || !cfg.persons_cursor_id) return null;

  console.log(`[Utah Warrants] resuming truncated pass from cursor ${cfg.persons_cursor_id}`);
  return runUtahWarrantScan(db);
}

/** @deprecated alias kept for backward compat with v1 callers; use runUtahWarrantScan */
export const runUtahWarrantSmokePoll = runUtahWarrantScan;
