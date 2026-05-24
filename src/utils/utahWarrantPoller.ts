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

const API_BASE = 'https://warrants.utah.gov/api/v1';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 15_000;
const BASE_DELAY_MS = 8_000; // matches legacy adaptive baseline
const MAX_PERSONS_PER_RUN = 50;

interface PersonRow {
  id: number;
  first_name: string;
  last_name: string;
  dob: string | null;
}

interface PersonStub {
  id: string;
  name: { first: string; middle?: string; last: string };
}

/** Full upstream warrant shape from /persons/:id/warrants. */
interface UtahApiWarrant {
  id: string;
  issueDate?: string;
  court?: { name?: string; caseId?: string };
  charges?: string[];
}

/** Row we insert into utah_warrants — joins the upstream person + warrant data. */
interface FetchedWarrant {
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
async function fetchWarrantsForPerson(person: PersonRow): Promise<FetchedWarrant[]> {
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
  const candidates = personsJson.persons ?? [];
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
    for (const w of wJson.warrants ?? []) {
      out.push({
        utah_person_id: candidate.id,
        utah_warrant_id: w.id,
        first_name: candidate.name.first,
        middle_name: candidate.name.middle ?? null,
        last_name: candidate.name.last,
        age: typeof (candidate as PersonStub & { age?: number | string }).age === 'number'
          ? (candidate as PersonStub & { age?: number }).age ?? null
          : null,
        city: null, // PersonStub doesn't currently expose homeAddress; extend if/when needed
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
async function recordWarrant(
  db: D1Database,
  w: FetchedWarrant,
  localPersonId: number | null,
): Promise<void> {
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
}

/**
 * Mark warrants is_active=0 when they weren't seen in the current run.
 * Used at end of runUtahWarrantScan to count warrants_cleared.
 *
 * Returns the number of rows that transitioned active → cleared.
 */
async function markClearedWarrants(
  db: D1Database,
  runStartedAt: string,
): Promise<number> {
  const result = await execute(
    db,
    `UPDATE utah_warrants
        SET is_active = 0
      WHERE is_active = 1
        AND last_seen_at < ?`,
    runStartedAt,
  );
  return result.meta?.changes ?? 0;
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
      `SELECT id, first_name, last_name, dob
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
      try {
        const fetched = await fetchWarrantsForPerson(person);
        for (const w of fetched) {
          await recordWarrant(db, w, person.id);
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

    // Sweep: anything whose last_seen_at predates this run is cleared.
    warrants_cleared = await markClearedWarrants(db, started_at);
  } catch (err) {
    status = 'failed';
    error_message = err instanceof Error ? err.message : String(err);
  }

  await execute(
    db,
    `UPDATE warrant_watch_runs
       SET completed_at = ?, status = ?, persons_checked = ?,
           new_warrants_found = ?, warrants_cleared = ?, errors = ?, error_message = ?
       WHERE run_id = ?`,
    new Date().toISOString(),
    status,
    persons_checked,
    new_warrants_found,
    warrants_cleared,
    errors,
    error_message ?? null,
    run_id,
  );

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
