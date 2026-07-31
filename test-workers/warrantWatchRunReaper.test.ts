// test-workers/warrantWatchRunReaper.test.ts
//
// reapStaleWatchRuns() closes out watch runs whose isolate died before they could
// finalize. Cloudflare caps a Cron Trigger at 15 min of wall time and a
// waitUntil() at 30s, while the Utah scan's per-person 8s sleep meant a 150-person
// run needed ~20-25 min — so the finalize UPDATE was unreachable and live D1 held
// 20/20 rows stuck 'running', the oldest three days old.
//
// Those rows are not cosmetic: the Warrants-tab poll banner reads them as a live
// scan and (being injected above the tab strip) overlays and swallows every tab
// click, and Watch List reports "LAST SCAN: Never".
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { execute, query } from '../src/utils/db';
import { reapStaleWatchRuns } from '../src/utils/utahWarrantPoller';

const TIMEOUT_MS = 20 * 60 * 1000;
const NOW = Date.parse('2026-07-31T03:00:00.000Z');

function db() {
  return (env as unknown as { DB: D1Database }).DB;
}

beforeEach(async () => {
  await execute(db(), `CREATE TABLE IF NOT EXISTS warrant_watch_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, started_at TEXT, completed_at TEXT,
    persons_checked INTEGER DEFAULT 0, new_warrants_found INTEGER DEFAULT 0,
    warrants_cleared INTEGER DEFAULT 0, errors INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running', error_message TEXT
  )`);
  await execute(db(), 'DELETE FROM warrant_watch_runs');
});

async function rows() {
  return query<{ run_id: string; status: string; completed_at: string | null; error_message: string | null }>(
    db(), 'SELECT run_id, status, completed_at, error_message FROM warrant_watch_runs ORDER BY run_id',
  );
}

describe('reapStaleWatchRuns', () => {
  it('reaps a run older than the timeout and records why', async () => {
    const started = new Date(NOW - TIMEOUT_MS - 60_000).toISOString();
    await execute(db(), `INSERT INTO warrant_watch_runs (run_id, started_at, status) VALUES ('dead', ?, 'running')`, started);

    expect(await reapStaleWatchRuns(db(), NOW)).toBe(1);

    const [r] = await rows();
    expect(r.status).toBe('failed');
    expect(r.completed_at).not.toBeNull();
    expect(r.error_message).toMatch(/did not finalize/i);
  });

  it('stamps completed_at at started_at + timeout, not "now"', async () => {
    // The row should report roughly when it stopped being viable, not when
    // someone happened to notice it days later.
    const startedMs = NOW - 3 * 24 * 60 * 60 * 1000; // 3 days ago, like live data
    await execute(db(), `INSERT INTO warrant_watch_runs (run_id, started_at, status) VALUES ('old', ?, 'running')`, new Date(startedMs).toISOString());

    await reapStaleWatchRuns(db(), NOW);

    const [r] = await rows();
    expect(Date.parse(r.completed_at as string)).toBe(startedMs + TIMEOUT_MS);
    // Explicitly NOT the reap time.
    expect(Date.parse(r.completed_at as string)).not.toBe(NOW);
  });

  it('leaves a young run alone — a healthy in-flight scan must not be reaped', async () => {
    const started = new Date(NOW - 60_000).toISOString();
    await execute(db(), `INSERT INTO warrant_watch_runs (run_id, started_at, status) VALUES ('live', ?, 'running')`, started);

    expect(await reapStaleWatchRuns(db(), NOW)).toBe(0);
    expect((await rows())[0].status).toBe('running');
  });

  it('does not touch runs that already finalized', async () => {
    const started = new Date(NOW - TIMEOUT_MS - 60_000).toISOString();
    await execute(db(),
      `INSERT INTO warrant_watch_runs (run_id, started_at, completed_at, status) VALUES ('done', ?, ?, 'completed')`,
      started, started);

    expect(await reapStaleWatchRuns(db(), NOW)).toBe(0);
    expect((await rows())[0].status).toBe('completed');
  });

  it('handles the mixed ISO / datetime("now") timestamp formats on this table', async () => {
    // started_at is written via toISOString() (zoned) while sibling columns
    // elsewhere use zone-less datetime('now'). Parsing the zone-less form as
    // LOCAL time would skew the timeout by the host's UTC offset — which on a
    // UTC-7 host would spare rows that should be reaped. parseD1TimestampMs
    // treats a bare timestamp as UTC.
    const bare = '2026-07-28 16:00:53'; // zone-less, well past the timeout
    await execute(db(), `INSERT INTO warrant_watch_runs (run_id, started_at, status) VALUES ('bare', ?, 'running')`, bare);

    expect(await reapStaleWatchRuns(db(), NOW)).toBe(1);
    expect((await rows())[0].status).toBe('failed');
  });

  it('skips — rather than reaps — a row whose started_at is unusable', async () => {
    // Cannot reason about its age, so leave it visible rather than guessing.
    await execute(db(), `INSERT INTO warrant_watch_runs (run_id, started_at, status) VALUES ('junk', 'not-a-date', 'running')`);
    await execute(db(), `INSERT INTO warrant_watch_runs (run_id, started_at, status) VALUES ('null', NULL, 'running')`);

    expect(await reapStaleWatchRuns(db(), NOW)).toBe(0);
    expect((await rows()).every(r => r.status === 'running')).toBe(true);
  });

  it('backfills a whole backlog in one pass (the live 20-row case)', async () => {
    for (let i = 0; i < 20; i++) {
      const started = new Date(NOW - TIMEOUT_MS - (i + 1) * 60_000).toISOString();
      await execute(db(), `INSERT INTO warrant_watch_runs (run_id, started_at, status) VALUES (?, ?, 'running')`, `stuck-${i}`, started);
    }
    expect(await reapStaleWatchRuns(db(), NOW)).toBe(20);
    expect((await rows()).filter(r => r.status === 'failed')).toHaveLength(20);
  });

  it('is idempotent — a second pass reaps nothing', async () => {
    const started = new Date(NOW - TIMEOUT_MS - 60_000).toISOString();
    await execute(db(), `INSERT INTO warrant_watch_runs (run_id, started_at, status) VALUES ('dead', ?, 'running')`, started);

    expect(await reapStaleWatchRuns(db(), NOW)).toBe(1);
    expect(await reapStaleWatchRuns(db(), NOW)).toBe(0);
  });
});
