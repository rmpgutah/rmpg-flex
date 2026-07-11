// Route-level regression test (Miniflare/workerd) for /api/warrants/scrapers —
// backing both ScrapersTab.tsx and AdminWarrantScrapersTab.tsx, neither of
// which had any matching backend route before this PR (2026-07-04).
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import scrapers from '../src/routes/scrapers';

function buildApp(role: string) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role, username: 'test-user' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/warrants/scrapers', scrapers);
  return app;
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS warrant_scraper_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_name TEXT, last_run_at TEXT, last_error TEXT,
    source_type TEXT, priority INTEGER, last_success_at TEXT, avg_parse_count REAL,
    p95_latency_ms INTEGER, enabled INTEGER NOT NULL DEFAULT 1, consecutive_errors INTEGER NOT NULL DEFAULT 0
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS national_warrant_sources (
    source_key TEXT PRIMARY KEY, family TEXT NOT NULL, display_name TEXT NOT NULL, state TEXT,
    jurisdiction TEXT, mode TEXT NOT NULL DEFAULT 'full-list', format TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 3,
    consecutive_errors INTEGER NOT NULL DEFAULT 0
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS scraped_warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT, status TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS scraper_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT NOT NULL, started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL, success INTEGER NOT NULL, checked INTEGER NOT NULL DEFAULT 0,
    found INTEGER NOT NULL DEFAULT 0, cleared INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER, trigger TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
    degraded INTEGER NOT NULL DEFAULT 0
  )`);

  await execute(db, `INSERT INTO warrant_scraper_config
    (source_name, last_error, source_type, priority, last_success_at, enabled, consecutive_errors)
    VALUES ('utah-warrant-watch', NULL, 'api', 1, '2026-07-03 12:00:00', 1, 0)`);
  await execute(db, `INSERT INTO warrant_scraper_config
    (source_name, last_error, source_type, priority, last_success_at, enabled, consecutive_errors)
    VALUES ('ada-county-id', 'timeout', 'html', 2, '2026-06-01 00:00:00', 1, 6)`);
  await execute(db, `INSERT INTO warrant_scraper_config
    (source_name, last_error, source_type, priority, last_success_at, enabled, consecutive_errors)
    VALUES ('natrona-county-wy', NULL, 'html', 3, NULL, 0, 0)`);

  await execute(db, `INSERT INTO national_warrant_sources
    (source_key, family, display_name, state, jurisdiction, format, enabled, priority, consecutive_errors)
    VALUES ('arcgis-arlington-tx', 'arcgis', 'Arlington TX Municipal Warrants', 'TX', 'Arlington', 'arcgis', 1, 2, 0)`);

  await execute(db, `INSERT INTO scraped_warrants (source_key, status) VALUES ('arcgis-arlington-tx', 'active')`);
  await execute(db, `INSERT INTO scraped_warrants (source_key, status) VALUES ('arcgis-arlington-tx', 'active')`);

  // Seed scraper_runs history for utah-warrant-watch only — 18/20 successes
  // (90% => grade B) — so we can assert real health_grade/total_runs/
  // success_rate computation, while ada-county-id/natrona-county-wy/
  // arcgis-arlington-tx have zero scraper_runs rows and must still show
  // health_grade: null (no data yet, never defaulted to 'F').
  for (let i = 0; i < 20; i++) {
    const success = i < 18 ? 1 : 0;
    await execute(db, `INSERT INTO scraper_runs
      (source_key, started_at, finished_at, success, checked, found, cleared, errors, duration_ms, trigger)
      VALUES ('utah-warrant-watch', '2026-07-0${(i % 9) + 1} 00:00:00', '2026-07-0${(i % 9) + 1} 00:01:00', ?, 10, 1, 0, ?, 1000, 'cron')`,
      success, success ? 0 : 1);
  }

  // Seed 25 rows for natrona-county-wy — the oldest 5 (by started_at) are
  // failures, the newest 20 are all successes. Proves the 20-run cap
  // actually truncates by started_at rather than merely tolerating it:
  // if the route's .slice(0, 20) were off-by-one or missing, the 5 old
  // failures would leak in and success_rate would read 20/25=80% (C)
  // instead of 20/20=100% (A).
  for (let i = 0; i < 25; i++) {
    const success = i < 5 ? 0 : 1;
    const day = String(i + 1).padStart(2, '0');
    await execute(db, `INSERT INTO scraper_runs
      (source_key, started_at, finished_at, success, checked, found, cleared, errors, duration_ms, trigger)
      VALUES ('natrona-county-wy', '2026-06-${day} 00:00:00', '2026-06-${day} 00:01:00', ?, 5, 0, 0, ?, 500, 'cron')`,
      success, success ? 0 : 1);
  }
});

describe('GET /api/warrants/scrapers', () => {
  it('returns sources from both frameworks with circuit_broken derived from consecutive_errors', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/scrapers', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { sources: Array<{ source_key: string; circuit_broken: 0 | 1; warrant_count: number; enabled: 0 | 1 }> };
    expect(body.sources).toHaveLength(4);

    const utah = body.sources.find((s) => s.source_key === 'utah-warrant-watch');
    expect(utah?.circuit_broken).toBe(0);

    const ada = body.sources.find((s) => s.source_key === 'ada-county-id');
    expect(ada?.circuit_broken).toBe(1); // 6 consecutive errors >= threshold 5

    const arcgis = body.sources.find((s) => s.source_key === 'arcgis-arlington-tx');
    expect(arcgis?.warrant_count).toBe(2);
  });

  it('computes real health_grade/total_runs/success_rate from scraper_runs history', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/scrapers', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as {
      sources: Array<{
        source_key: string;
        metrics_24h: { health_grade: string | null; total_runs: number; successful_runs: number; success_rate: number };
      }>;
    };

    const utah = body.sources.find((s) => s.source_key === 'utah-warrant-watch');
    expect(utah?.metrics_24h.total_runs).toBe(20);
    expect(utah?.metrics_24h.successful_runs).toBe(18);
    expect(utah?.metrics_24h.success_rate).toBeCloseTo(0.9);
    expect(utah?.metrics_24h.health_grade).toBe('B'); // 90% => B (>=85%, <95%)

    // Sources with zero scraper_runs rows must show null, not a defaulted 'F'.
    const ada = body.sources.find((s) => s.source_key === 'ada-county-id');
    expect(ada?.metrics_24h.total_runs).toBe(0);
    expect(ada?.metrics_24h.health_grade).toBeNull();

    const arcgis = body.sources.find((s) => s.source_key === 'arcgis-arlington-tx');
    expect(arcgis?.metrics_24h.total_runs).toBe(0);
    expect(arcgis?.metrics_24h.health_grade).toBeNull();
  });

  it('caps run-history metrics to the newest 20 rows, excluding older overflow', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/scrapers', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as {
      sources: Array<{
        source_key: string;
        metrics_24h: { health_grade: string | null; total_runs: number; successful_runs: number; success_rate: number };
      }>;
    };

    // natrona-county-wy has 25 seeded rows: the oldest 5 (by started_at) are
    // failures, the newest 20 are all successes. If the 20-run cap didn't
    // truncate correctly, the 5 old failures would leak in (20/25=80% -> C);
    // capped correctly, only the newest 20 (all success) count (100% -> A).
    const natrona = body.sources.find((s) => s.source_key === 'natrona-county-wy');
    expect(natrona?.metrics_24h.total_runs).toBe(20);
    expect(natrona?.metrics_24h.successful_runs).toBe(20);
    expect(natrona?.metrics_24h.success_rate).toBeCloseTo(1);
    expect(natrona?.metrics_24h.health_grade).toBe('A');
  });
});

describe('GET /api/warrants/scrapers/health', () => {
  it('returns rollup counts derived from the merged source list', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/scrapers/health', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { total: number; circuit_broken: number; healthy: number };
    expect(body.total).toBe(4);
    expect(body.circuit_broken).toBe(1); // ada-county-id
    expect(body.healthy).toBe(3);
  });
});

describe('POST /api/warrants/scrapers/:key/trigger', () => {
  it('rejects non-admin roles', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/scrapers/arcgis-arlington-tx/trigger', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown source key', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/not-a-real-source/trigger', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(404);
  });

  it('triggers the Utah source via runUtahWarrantScan', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/utah-warrant-watch/trigger', { method: 'POST' }, env as unknown as Record<string, unknown>);
    // The real Utah poller makes a live network call, which is unavailable in
    // Miniflare tests — accept either a successful run summary or a caught
    // network-error response, but never a 404/403 (the key must resolve).
    expect([200, 502]).toContain(res.status);

    // Whether the live Utah poller succeeded or threw, the manual trigger
    // must always leave a scraper_runs audit row behind (trigger='manual').
    const db = (env as unknown as { DB: D1Database }).DB;
    const rows = await db.prepare(
      `SELECT * FROM scraper_runs WHERE source_key = 'utah-warrant-watch' AND trigger = 'manual'`,
    ).all();
    expect(rows.results.length).toBeGreaterThanOrEqual(1);
  });

  it('triggers a config-driven (national_warrant_sources) source via runFullListLeg', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/arcgis-arlington-tx/trigger', { method: 'POST' }, env as unknown as Record<string, unknown>);
    // The real ArcGIS fetch is unavailable in Miniflare — accept either a
    // successful run summary or a caught network-error response.
    expect([200, 502]).toContain(res.status);

    const db = (env as unknown as { DB: D1Database }).DB;
    const rows = await db.prepare(
      `SELECT * FROM scraper_runs WHERE source_key = 'arcgis-arlington-tx' AND trigger = 'manual'`,
    ).all();
    expect(rows.results.length).toBeGreaterThanOrEqual(1);
  });

  it('blocks triggering a source that is disabled in warrant_scraper_config', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/natrona-county-wy/trigger', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/disabled/i);
  });
});

describe('POST /api/warrants/scrapers/:key/reset-circuit', () => {
  it('rejects non-admin roles', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/scrapers/ada-county-id/reset-circuit', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('zeroes consecutive_errors and closes the circuit', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/ada-county-id/reset-circuit', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const listRes = await app.request('/api/warrants/scrapers', {}, env as unknown as Record<string, unknown>);
    const body = await listRes.json() as { sources: Array<{ source_key: string; circuit_broken: 0 | 1; consecutive_errors: number }> };
    const ada = body.sources.find((s) => s.source_key === 'ada-county-id');
    expect(ada?.consecutive_errors).toBe(0);
    expect(ada?.circuit_broken).toBe(0);
  });

  it('returns 404 for an unknown source key', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/not-a-real-source/reset-circuit', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/warrants/scrapers/bulk', () => {
  it('rejects non-admin roles', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/scrapers/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'disable', source_keys: ['ada-county-id'] }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('disables sources across both frameworks in one call', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'disable', source_keys: ['ada-county-id', 'arcgis-arlington-tx'] }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; affected: number };
    expect(body.affected).toBe(2);

    const listRes = await app.request('/api/warrants/scrapers', {}, env as unknown as Record<string, unknown>);
    const list = await listRes.json() as { sources: Array<{ source_key: string; enabled: 0 | 1 }> };
    expect(list.sources.find((s) => s.source_key === 'ada-county-id')?.enabled).toBe(0);
    expect(list.sources.find((s) => s.source_key === 'arcgis-arlington-tx')?.enabled).toBe(0);
  });

  it('enables sources across both frameworks in one call', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'enable', source_keys: ['ada-county-id', 'arcgis-arlington-tx'] }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; affected: number };
    expect(body.affected).toBe(2);

    const listRes = await app.request('/api/warrants/scrapers', {}, env as unknown as Record<string, unknown>);
    const list = await listRes.json() as { sources: Array<{ source_key: string; enabled: 0 | 1 }> };
    expect(list.sources.find((s) => s.source_key === 'ada-county-id')?.enabled).toBe(1);
    expect(list.sources.find((s) => s.source_key === 'arcgis-arlington-tx')?.enabled).toBe(1);
  });

  it('resets consecutive_errors across both frameworks in one call', async () => {
    const app = buildApp('admin');
    // ada-county-id's consecutive_errors was already zeroed by the earlier
    // POST /:key/reset-circuit describe block above (Vitest runs describe
    // blocks in file order) — re-bump it here so this test actually
    // exercises the nonzero -> zero transition, not a no-op on an
    // already-zeroed row.
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `UPDATE warrant_scraper_config SET consecutive_errors = 6 WHERE source_name = 'ada-county-id'`);
    const res = await app.request('/api/warrants/scrapers/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'reset', source_keys: ['ada-county-id', 'arcgis-arlington-tx'] }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; affected: number };
    expect(body.affected).toBe(2);

    const listRes = await app.request('/api/warrants/scrapers', {}, env as unknown as Record<string, unknown>);
    const list = await listRes.json() as { sources: Array<{ source_key: string; consecutive_errors: number; circuit_broken: 0 | 1 }> };
    const ada = list.sources.find((s) => s.source_key === 'ada-county-id');
    expect(ada?.consecutive_errors).toBe(0);
    expect(ada?.circuit_broken).toBe(0);
  });

  it('sets priority across both frameworks in one call', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'set_priority', source_keys: ['ada-county-id', 'arcgis-arlington-tx'], priority: 1 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; affected: number };
    expect(body.affected).toBe(2);

    const listRes = await app.request('/api/warrants/scrapers', {}, env as unknown as Record<string, unknown>);
    const list = await listRes.json() as { sources: Array<{ source_key: string; priority: number }> };
    expect(list.sources.find((s) => s.source_key === 'ada-county-id')?.priority).toBe(1);
    expect(list.sources.find((s) => s.source_key === 'arcgis-arlington-tx')?.priority).toBe(1);
  });

  it('rejects a request missing source_keys', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'enable' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
  });

  it('rejects an invalid action', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', source_keys: ['ada-county-id'] }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
  });

  it('rejects set_priority with a missing or out-of-range priority', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'set_priority', source_keys: ['ada-county-id'] }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);

    const res2 = await app.request('/api/warrants/scrapers/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'set_priority', source_keys: ['ada-county-id'], priority: 5 }),
    }, env as unknown as Record<string, unknown>);
    expect(res2.status).toBe(400);
  });
});
