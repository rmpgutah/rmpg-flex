// test-workers/warrantResumePartialRun.test.ts
//
// resumePartialWatchRun() continues a roster pass that the 15-minute cron wall
// cap truncated, instead of leaving the remainder unchecked for up to 4 hours.
//
// Observed live 2026-07-31: consecutive passes stopped at 59 and 60 of 83 people
// ("partial: wall budget reached after 59 person(s); resumes next tick"), so the
// tail of the roster went unchecked for most of the day.
//
// These tests pin the GUARDS, not the happy path. The guards are the whole risk:
// this runs on the PER-MINUTE cron, so a wrong condition means either overlapping
// concurrent scans or a 24/7 crawler against warrants.utah.gov — whose WAF the
// 8s-per-person pacing exists to stay under. A false negative just delays a
// sweep; a false positive can get RMPG blocked outright.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { execute } from '../src/utils/db';
import { resumePartialWatchRun } from '../src/utils/utahWarrantPoller';

function db() {
  return (env as unknown as { DB: D1Database }).DB;
}

const PARTIAL = 'partial: wall budget reached after 59 person(s); resumes next tick';

beforeEach(async () => {
  await execute(db(), `CREATE TABLE IF NOT EXISTS warrant_watch_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, started_at TEXT, completed_at TEXT,
    persons_checked INTEGER DEFAULT 0, new_warrants_found INTEGER DEFAULT 0,
    warrants_cleared INTEGER DEFAULT 0, errors INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running', error_message TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS warrant_scraper_config (
    source_name TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1, source_type TEXT,
    priority INTEGER DEFAULT 3, consecutive_errors INTEGER DEFAULT 0,
    last_run_at TEXT, last_success_at TEXT, last_error TEXT,
    avg_parse_count REAL, p95_latency_ms REAL,
    max_persons_per_run INTEGER, persons_cursor_id INTEGER
  )`);
  await execute(db(), 'DELETE FROM warrant_watch_runs');
  await execute(db(), 'DELETE FROM warrant_scraper_config');
});

async function seedRun(status: string, message: string | null) {
  await execute(db(),
    `INSERT INTO warrant_watch_runs (run_id, started_at, completed_at, status, error_message)
     VALUES ('r1', '2026-07-31T16:00:00Z', ?, ?, ?)`,
    status === 'running' ? null : '2026-07-31T16:10:00Z', status, message);
}

async function seedCursor(cursor: number | null) {
  await execute(db(),
    `INSERT INTO warrant_scraper_config (source_name, persons_cursor_id) VALUES ('utah-warrant-watch', ?)`,
    cursor);
}

describe('resumePartialWatchRun — guards', () => {
  it('does NOT resume while a run is still in flight (no overlapping scans)', async () => {
    // The per-minute cadence would otherwise start a second scan every minute
    // for the ~10 minutes a real run takes.
    await seedRun('running', null);
    await seedCursor(500);
    expect(await resumePartialWatchRun(db())).toBeNull();
  });

  it('does NOT resume after a run that completed a FULL pass', async () => {
    // No partial marker → the pass finished; a new pass is the cron's job.
    await seedRun('completed', null);
    await seedCursor(500);
    expect(await resumePartialWatchRun(db())).toBeNull();
  });

  it('does NOT resume after a FAILED run', async () => {
    await seedRun('failed', 'upstream 503');
    await seedCursor(500);
    expect(await resumePartialWatchRun(db())).toBeNull();
  });

  it('does NOT resume after a run the reaper closed out', async () => {
    // A reaped row is not a partial — resuming it would be a new pass.
    await seedRun('failed', 'run did not finalize within the execution window (isolate evicted before completion)');
    await seedCursor(500);
    expect(await resumePartialWatchRun(db())).toBeNull();
  });

  it('does NOT resume when the cursor has wrapped to 0 (pass complete)', async () => {
    // Cursor 0 means the roster was swept end to end and the cleared-warrant
    // sweep ran. Continuing here is what would turn this into a 24/7 crawler.
    await seedRun('completed', PARTIAL);
    await seedCursor(0);
    expect(await resumePartialWatchRun(db())).toBeNull();
  });

  it('does NOT resume when the cursor is NULL', async () => {
    await seedRun('completed', PARTIAL);
    await seedCursor(null);
    expect(await resumePartialWatchRun(db())).toBeNull();
  });

  it('does NOT resume with no run history at all', async () => {
    await seedCursor(500);
    expect(await resumePartialWatchRun(db())).toBeNull();
  });

  it('does NOT resume when the config row is missing', async () => {
    await seedRun('completed', PARTIAL);
    expect(await resumePartialWatchRun(db())).toBeNull();
  });

  it('considers only the NEWEST run, not any older partial', async () => {
    // An old partial followed by a full completion must not re-trigger.
    await execute(db(),
      `INSERT INTO warrant_watch_runs (run_id, started_at, completed_at, status, error_message)
       VALUES ('old', '2026-07-31T08:00:00Z', '2026-07-31T08:10:00Z', 'completed', ?)`, PARTIAL);
    await execute(db(),
      `INSERT INTO warrant_watch_runs (run_id, started_at, completed_at, status, error_message)
       VALUES ('new', '2026-07-31T16:00:00Z', '2026-07-31T16:05:00Z', 'completed', NULL)`);
    await seedCursor(500);
    expect(await resumePartialWatchRun(db())).toBeNull();
  });

  it('DOES resume when the newest run is partial and the cursor is mid-roster', async () => {
    // The one case that should fire. persons table is absent here, so the scan
    // itself degrades — we assert only that a continuation was ATTEMPTED
    // (non-null result), which is what the guard chain controls.
    await seedRun('completed', PARTIAL);
    await seedCursor(500);
    const result = await resumePartialWatchRun(db());
    expect(result).not.toBeNull();
    expect(result?.run_id).toMatch(/^utah-/);
  });
});
