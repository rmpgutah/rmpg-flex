// Route-level regression test (Miniflare/workerd) for
// GET /api/warrants/national-coverage.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import warrants from '../src/routes/warrants';

function buildApp(role: string) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role, username: 'test-user' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/warrants', warrants);
  return app;
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS national_warrant_sources (
    source_key TEXT PRIMARY KEY, family TEXT NOT NULL, display_name TEXT NOT NULL,
    state TEXT, jurisdiction TEXT, mode TEXT NOT NULL DEFAULT 'full-list',
    format TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 3
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS scraped_warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT, first_name TEXT, last_name TEXT,
    date_of_birth TEXT, age INTEGER, state TEXT, status TEXT DEFAULT 'active'
  )`);
  // Real production schema (migrations/baseline/schema.sql + 0151_warrant_scraper_enabled.sql):
  // id, created_at, source_name, last_run_at, last_error, source_type, priority,
  // content_hash, content_hash_updated_at, etag, last_modified, last_success_at,
  // avg_parse_count, p95_latency_ms, jitter_seed, enabled. getEnabledAdapters()
  // queries `SELECT source_name FROM warrant_scraper_config WHERE enabled = 1`.
  // Deliberately seeded EMPTY (no utah-warrant-watch, ada-county-id, or
  // natrona-county-wy rows) — this proves the route's Utah coverage comes from
  // the dedicated always-on special case, not from getEnabledAdapters failing
  // open (which would incorrectly also cover ID/WY).
  await execute(db, `CREATE TABLE IF NOT EXISTS warrant_scraper_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now','localtime')),
    source_name TEXT, last_run_at TEXT, last_error TEXT, source_type TEXT, priority INTEGER,
    content_hash TEXT, content_hash_updated_at TEXT, etag TEXT, last_modified TEXT,
    last_success_at TEXT, avg_parse_count REAL, p95_latency_ms INTEGER, jitter_seed INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1
  )`);

  await execute(db, `INSERT INTO national_warrant_sources
    (source_key, family, display_name, state, jurisdiction, format, enabled, priority)
    VALUES ('arcgis-arlington-tx', 'arcgis', 'Arlington TX Municipal Warrants', 'TX', 'Arlington', 'arcgis', 1, 2)`);
  await execute(db, `INSERT INTO national_warrant_sources
    (source_key, family, display_name, state, jurisdiction, format, enabled, priority)
    VALUES ('socrata-brla-citycourt', 'socrata', 'Baton Rouge City Court Warrants', 'LA', 'Baton Rouge', 'socrata', 0, 2)`);

  await execute(db, `INSERT INTO scraped_warrants (source_key, first_name, last_name, state, status) VALUES ('arcgis-arlington-tx', 'John', 'Doe', 'TX', 'active')`);
  await execute(db, `INSERT INTO scraped_warrants (source_key, first_name, last_name, state, status) VALUES ('arcgis-arlington-tx', 'Jane', 'Roe', 'TX', 'active')`);
});

describe('GET /api/warrants/national-coverage', () => {
  it('returns all 51 states with active/disabled status and per-state counts', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/national-coverage', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      states: Array<{ stateCode: string; stateName: string; available: boolean; message?: string }>;
      sources: number;
      states_covered: number;
      active_warrants: number;
      state_status: Record<string, string>;
      state_sources: Record<string, number>;
      state_warrants: Record<string, number>;
    };

    expect(body.states).toHaveLength(51);

    const tx = body.states.find((s) => s.stateCode === 'TX');
    expect(tx?.available).toBe(true);
    expect(body.state_sources.TX).toBe(1);
    expect(body.state_warrants.TX).toBe(2);

    // Louisiana's only source is disabled, and Utah has a code-resident
    // adapter (utahApi.ts) even with no national_warrant_sources row.
    const la = body.states.find((s) => s.stateCode === 'LA');
    expect(la?.available).toBe(false);
    expect(la?.message).toBeTruthy();

    // Utah is ALWAYS covered via the route's dedicated always-on special
    // case (utah-warrant-watch has its own poller/pipeline, independent of
    // national_warrant_sources / warrant_scraper_config). This table is
    // seeded empty with no UT row, so this proves the special case — not
    // getEnabledAdapters' fail-open behavior — is what makes this true.
    const ut = body.states.find((s) => s.stateCode === 'UT');
    expect(ut?.available).toBe(true);

    // Idaho (ada-county-id) and Wyoming (natrona-county-wy) are genuinely
    // gated, generic code-resident adapters — NOT the Utah always-on special
    // case. warrant_scraper_config exists in this test (so the query
    // succeeds, no fail-open) but has zero rows, so getEnabledAdapters()
    // returns [] and neither adapter is counted as an enabled source.
    const id = body.states.find((s) => s.stateCode === 'ID');
    expect(id?.available).toBe(false);
    const wy = body.states.find((s) => s.stateCode === 'WY');
    expect(wy?.available).toBe(false);

    // A state with zero sources of any kind, e.g. Hawaii.
    const hi = body.states.find((s) => s.stateCode === 'HI');
    expect(hi?.available).toBe(false);

    expect(body.states_covered).toBeGreaterThanOrEqual(2); // at least TX + UT
    expect(body.active_warrants).toBe(2);
  });
});
