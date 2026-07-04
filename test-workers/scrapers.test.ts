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
  });

  it('blocks triggering a source that is disabled in warrant_scraper_config', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/warrants/scrapers/natrona-county-wy/trigger', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/disabled/i);
  });
});
