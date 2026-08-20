// test-workers/scrapersHealthRunDerived.test.ts
//
// GET /scrapers/health used to return `failed`, `last_hour_runs` and
// `last_hour_inserted` as HARDCODED ZEROS, justified by a comment saying per-run
// history did not exist yet. That was stale: scraper_runs landed in migration
// 0174 and the same file's buildMetrics() already reads it. Only this endpoint
// was left behind, so ScrapersTab rendered "Last hour: <blank> runs, <blank> new"
// and its Failed LED could never light, on a system that had the data all along.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import scrapers from '../src/routes/scrapers';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string } } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin' });
  await next();
});
app.route('/api/scrapers', scrapers);

function db() {
  return (env as unknown as { DB: D1Database }).DB;
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60 * 1000;

beforeEach(async () => {
  await execute(db(), `CREATE TABLE IF NOT EXISTS warrant_scraper_config (
    source_name TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1, source_type TEXT,
    priority INTEGER DEFAULT 3, consecutive_errors INTEGER DEFAULT 0,
    last_run_at TEXT, last_success_at TEXT, last_error TEXT,
    avg_parse_count REAL, p95_latency_ms REAL, max_persons_per_run INTEGER, persons_cursor_id INTEGER
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS national_warrant_sources (
    source_key TEXT PRIMARY KEY, display_name TEXT, state TEXT, jurisdiction TEXT,
    format TEXT, enabled INTEGER DEFAULT 1, priority INTEGER DEFAULT 3, consecutive_errors INTEGER DEFAULT 0
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS scraped_warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT, status TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS scraper_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT NOT NULL, started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL, success INTEGER NOT NULL, checked INTEGER DEFAULT 0,
    found INTEGER DEFAULT 0, cleared INTEGER DEFAULT 0, errors INTEGER DEFAULT 0,
    duration_ms INTEGER, trigger TEXT
  )`);
  for (const t of ['warrant_scraper_config', 'national_warrant_sources', 'scraper_runs', 'scraped_warrants']) {
    await execute(db(), `DELETE FROM ${t}`);
  }
});

async function health() {
  const res = await app.request('/api/scrapers/health', {}, env as unknown as Record<string, unknown>);
  return await res.json() as Record<string, number>;
}

async function addRun(key: string, opts: { success: boolean; found?: number; msAgo: number }) {
  await execute(db(),
    `INSERT INTO scraper_runs (source_key, started_at, finished_at, success, found, trigger)
     VALUES (?, ?, ?, ?, ?, 'cron')`,
    key, iso(opts.msAgo), iso(opts.msAgo), opts.success ? 1 : 0, opts.found ?? 0);
}

describe('GET /scrapers/health — run-derived fields', () => {
  it('counts last-hour runs and inserts from scraper_runs instead of returning 0', async () => {
    await execute(db(), `INSERT INTO national_warrant_sources (source_key, display_name) VALUES ('src-a', 'A')`);
    await addRun('src-a', { success: true, found: 12, msAgo: 10 * MIN });
    await addRun('src-a', { success: true, found: 5, msAgo: 30 * MIN });

    const h = await health();
    expect(h.last_hour_runs).toBe(2);
    expect(h.last_hour_inserted).toBe(17);
  });

  it('excludes runs older than an hour from the last-hour window', async () => {
    await execute(db(), `INSERT INTO national_warrant_sources (source_key, display_name) VALUES ('src-a', 'A')`);
    await addRun('src-a', { success: true, found: 99, msAgo: 90 * MIN });

    const h = await health();
    expect(h.last_hour_runs).toBe(0);
    expect(h.last_hour_inserted).toBe(0);
  });

  it('reports a source whose LATEST run failed as failed, not degraded', async () => {
    await execute(db(), `INSERT INTO national_warrant_sources (source_key, display_name) VALUES ('broken', 'B')`);
    // Older success, newest failure — "is it broken NOW?" must follow the newest.
    await addRun('broken', { success: true, msAgo: 120 * MIN });
    await addRun('broken', { success: false, msAgo: 5 * MIN });

    const h = await health();
    expect(h.failed).toBe(1);
    expect(h.degraded).toBe(0);
  });

  it('reports a lingering error whose latest run SUCCEEDED as degraded, not failed', async () => {
    await execute(db(),
      `INSERT INTO warrant_scraper_config (source_name, last_error) VALUES ('recovering', 'stale boom')`);
    await addRun('recovering', { success: false, msAgo: 120 * MIN });
    await addRun('recovering', { success: true, msAgo: 5 * MIN });

    const h = await health();
    expect(h.degraded).toBe(1);
    expect(h.failed).toBe(0);
  });

  it('healthy + degraded + failed + circuit_broken always accounts for every source', async () => {
    await execute(db(), `INSERT INTO national_warrant_sources (source_key, display_name) VALUES ('ok', 'OK')`);
    await execute(db(), `INSERT INTO national_warrant_sources (source_key, display_name) VALUES ('bad', 'BAD')`);
    await execute(db(),
      `INSERT INTO warrant_scraper_config (source_name, last_error) VALUES ('meh', 'lingering')`);
    await addRun('ok', { success: true, msAgo: 5 * MIN });
    await addRun('bad', { success: false, msAgo: 5 * MIN });
    await addRun('meh', { success: true, msAgo: 5 * MIN });

    const h = await health();
    // No bucket may double-count or drop a source — the LED row must sum to total.
    expect(h.healthy + h.degraded + h.failed + h.circuit_broken).toBe(h.total);
    expect(h.failed).toBe(1);
    expect(h.degraded).toBe(1);
  });

  it('degrades to zeros rather than 500ing when there is no run history', async () => {
    await execute(db(), `INSERT INTO national_warrant_sources (source_key, display_name) VALUES ('src-a', 'A')`);
    const res = await app.request('/api/scrapers/health', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const h = await res.json() as Record<string, number>;
    expect(h.last_hour_runs).toBe(0);
    expect(h.failed).toBe(0);
  });
});
