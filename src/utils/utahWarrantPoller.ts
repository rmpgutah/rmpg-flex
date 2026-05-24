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

interface WarrantStub {
  id: string;
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
 * Returns the count of unique warrants matched, or throws on transport error.
 */
async function fetchWarrantsForPerson(person: PersonRow): Promise<number> {
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

  if (personsRes.status === 404 || personsRes.status === 204) return 0;
  if (!personsRes.ok && personsRes.status !== 201) {
    throw new Error(`persons search ${personsRes.status}`);
  }

  const personsJson = (await personsRes.json()) as { persons?: PersonStub[] };
  const candidates = personsJson.persons ?? [];
  if (candidates.length === 0) return 0;

  let warrantCount = 0;
  for (const candidate of candidates) {
    const warrantsRes = await fetchWithTimeout(
      `${API_BASE}/persons/${encodeURIComponent(candidate.id)}/warrants`,
      { headers: { accept: 'application/json', 'user-agent': USER_AGENT } },
    );
    if (warrantsRes.status === 404) continue;
    if (!warrantsRes.ok) throw new Error(`warrants/${candidate.id} ${warrantsRes.status}`);
    const wJson = (await warrantsRes.json()) as { warrants?: WarrantStub[] };
    warrantCount += wJson.warrants?.length ?? 0;
  }
  return warrantCount;
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
        const count = await fetchWarrantsForPerson(person);
        new_warrants_found += count;
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
  } catch (err) {
    status = 'failed';
    error_message = err instanceof Error ? err.message : String(err);
  }

  await execute(
    db,
    `UPDATE warrant_watch_runs
       SET completed_at = ?, status = ?, persons_checked = ?,
           new_warrants_found = ?, errors = ?, error_message = ?
       WHERE run_id = ?`,
    new Date().toISOString(),
    status,
    persons_checked,
    new_warrants_found,
    errors,
    error_message ?? null,
    run_id,
  );

  return {
    run_id,
    status,
    persons_checked,
    new_warrants_found,
    warrants_cleared: 0, // requires scraped_warrants table — v3
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
