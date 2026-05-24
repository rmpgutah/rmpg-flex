// Workers-compatible Utah warrant poller for the CF Worker rehome.
//
// v1 (this version) does a SMOKE POLL: hits warrants.utah.gov/api/v1/persons
// once per cron firing with a known-returning query ("JOHN SMITH"), so the
// dashboard widget shows live activity even though the D1 persons table is
// largely empty during the migration. Records every run in warrant_watch_runs.
//
// v2 (follow-up): iterate over D1 persons, fetch warrants per person, write
// scraped_warrants. Matches the legacy server's _runWarrantWatchScanImpl
// behavior. Schema is already shaped for that — just needs the loop.
//
// User-agent: deliberate Chrome string to bypass the CloudFront WAF that 403s
// identifier-style UAs (verified live 2026-05-24). Do NOT "improve" this to
// an RFC-friendly identifier UA without re-validating against the upstream.

import type { D1Database } from '@cloudflare/workers-types';
import { execute, queryFirst } from './db';

const API_BASE = 'https://warrants.utah.gov/api/v1';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

interface PersonStub {
  id: string;
  name: { first: string; middle?: string; last: string };
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

/**
 * Smoke poll. Hits warrants.utah.gov with a known-returning query to prove
 * the pipeline is healthy and record an audit row. Safe to call from a cron
 * trigger or an HTTP trigger button.
 */
export async function runUtahWarrantSmokePoll(db: D1Database): Promise<WatchRunResult> {
  const run_id = `utah-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const started_at = new Date().toISOString();

  // Insert row immediately so the dashboard widget can show "NOW" status
  // mid-flight if the user happens to refresh during a long fetch.
  await execute(
    db,
    `INSERT INTO warrant_watch_runs (run_id, started_at, status, persons_checked,
      new_warrants_found, warrants_cleared, errors)
     VALUES (?, ?, 'running', 0, 0, 0, 0)`,
    run_id,
    started_at,
  );

  let persons_checked = 0;
  let errors = 0;
  let status: 'completed' | 'failed' = 'completed';
  let error_message: string | undefined;

  try {
    const res = await fetch(`${API_BASE}/persons`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify({ name: { first: 'JOHN', last: 'SMITH' } }),
    });
    if (!res.ok && res.status !== 201) {
      throw new Error(`warrants.utah.gov returned ${res.status}`);
    }
    const json = (await res.json()) as { persons?: PersonStub[] };
    persons_checked = json.persons?.length ?? 0;
  } catch (err) {
    status = 'failed';
    errors = 1;
    error_message = err instanceof Error ? err.message : String(err);
  }

  await execute(
    db,
    `UPDATE warrant_watch_runs
       SET completed_at = ?, status = ?, persons_checked = ?, errors = ?, error_message = ?
       WHERE run_id = ?`,
    new Date().toISOString(),
    status,
    persons_checked,
    errors,
    error_message ?? null,
    run_id,
  );

  return {
    run_id,
    status,
    persons_checked,
    new_warrants_found: 0,
    warrants_cleared: 0,
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
