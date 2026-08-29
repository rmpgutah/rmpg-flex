// Route-level smoke test (Miniflare/workerd) for /api/enrichment.
// Source adapters are module-mocked so no real HTTP calls are made.
// Auth is injected via middleware (same pattern as carxe.test.ts).
import { env } from 'cloudflare:test';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { getDb, execute } from '../src/utils/db';

// Mock all 10 source adapters before importing the route
vi.mock('../src/utils/enrichment/sources/nsopw', () => ({
  search: async () => ({
    source: 'nsopw', ok: true, latency_ms: 10,
    records: [{ name: 'John Smith', dob: '1990-05-12',
      addresses: [{ city: 'Salt Lake City', state: 'UT', source: 'nsopw' }],
      phones: [], emails: [], source: 'nsopw' }],
  }),
}));
vi.mock('../src/utils/enrichment/sources/assessor',      () => ({ search: async () => ({ source: 'sl_assessor',     ok: true,  latency_ms: 5, records: [] }) }));
vi.mock('../src/utils/enrichment/sources/openSanctions', () => ({ search: async () => ({ source: 'open_sanctions',  ok: true,  latency_ms: 5, records: [] }) }));
vi.mock('../src/utils/enrichment/sources/usps',          () => ({ search: async () => ({ source: 'usps',            ok: false, latency_ms: 0, records: [], error: 'not_configured' }) }));
vi.mock('../src/utils/enrichment/sources/openCorporates',() => ({ search: async () => ({ source: 'open_corporates', ok: false, latency_ms: 0, records: [], error: 'not_configured' }) }));
vi.mock('../src/utils/enrichment/sources/numverify',     () => ({ search: async () => ({ source: 'numverify',       ok: false, latency_ms: 0, records: [], error: 'not_configured' }) }));
vi.mock('../src/utils/enrichment/sources/fbi',           () => ({ search: async () => ({ source: 'fbi_wanted',      ok: true,  latency_ms: 5, records: [] }) }));
vi.mock('../src/utils/enrichment/sources/bop',           () => ({ search: async () => ({ source: 'bop_inmates',     ok: true,  latency_ms: 5, records: [] }) }));
vi.mock('../src/utils/enrichment/sources/censusGeocoder',() => ({ search: async () => ({ source: 'census_geocoder', ok: true,  latency_ms: 5, records: [] }) }));
vi.mock('../src/utils/enrichment/sources/ofac',          () => ({ search: async () => ({ source: 'ofac_sdn',        ok: true,  latency_ms: 5, records: [] }) }));
vi.mock('../src/utils/enrichment/sources/usaPeopleSearch',() => ({ search: async () => ({ source: 'usa_people_search', ok: false, latency_ms: 0, records: [], error: 'not_configured' }) }));
vi.mock('../src/utils/enrichment/sources/hunter',       () => ({ search: async () => ({ source: 'hunter',           ok: false, latency_ms: 0, records: [], error: 'not_configured' }) }));
vi.mock('../src/utils/enrichment/sources/pdl',          () => ({ search: async () => ({ source: 'pdl',              ok: false, latency_ms: 0, records: [], error: 'not_configured' }) }));
vi.mock('../src/utils/enrichment/sources/apollo',       () => ({ search: async () => ({ source: 'apollo',           ok: false, latency_ms: 0, records: [], error: 'not_configured' }) }));
vi.mock('../src/utils/enrichment/sources/hibp',         () => ({ search: async () => ({ source: 'hibp',             ok: false, latency_ms: 0, records: [], error: 'not_configured' }) }));
vi.mock('../src/utils/enrichment/sources/courtlistener', () => ({ search: async () => ({ source: 'courtlistener',    ok: true,  latency_ms: 5, records: [] }) }));

import enrichment from '../src/routes/enrichment';
import { OPEN_SOURCE_ENRICHMENT_SOURCES } from '../src/utils/enrichment/catalog';

type TestUser = { id: number; role: string; username: string };

function appWithUser(user: TestUser) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: TestUser; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    c.set('userId', user.id);
    await next();
  });
  app.route('/api/enrichment', enrichment);
  return app;
}

const testUser: TestUser = { id: 1, role: 'admin', username: 'test-officer' };

describe('POST /api/enrichment/search', () => {
  beforeAll(async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db, `CREATE TABLE IF NOT EXISTS enrichment_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_key TEXT NOT NULL UNIQUE,
      seed_json TEXT NOT NULL,
      results_json TEXT NOT NULL,
      match_tier TEXT NOT NULL,
      anchors_json TEXT,
      source_count INTEGER NOT NULL DEFAULT 0,
      searched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      searched_by INTEGER
    )`);
    await execute(db, `CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    await execute(db, `CREATE TABLE IF NOT EXISTS persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT,
      last_name TEXT,
      city TEXT,
      state TEXT
    )`);
  });

  it('returns CONFIRMED when DOB + address anchor match', async () => {
    const app = appWithUser(testUser);
    const res = await app.fetch(new Request('https://example.com/api/enrichment/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: 'John', last_name: 'Smith', dob: '1990-05-12',
        city: 'Salt Lake City', state: 'UT',
      }),
    }), env);
    const json = await res.json() as any;
    expect(res.status).toBe(200);
    expect(json.match_tier).toBe('CONFIRMED');
    expect(json.anchors).toContain('dob_match');
    expect(json.anchors).toContain('address_anchor');
    expect(json.cached).toBe(false);
  });

  it('returns cached: true on second identical call', async () => {
    const app = appWithUser(testUser);
    const makeReq = () => new Request('https://example.com/api/enrichment/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: 'Jane', last_name: 'Doe', dob: '1985-03-01' }),
    });
    await app.fetch(makeReq(), env);
    const res2 = await app.fetch(makeReq(), env);
    const json = await res2.json() as any;
    expect(json.cached).toBe(true);
  });

  it('returns 400 when first_name missing', async () => {
    const app = appWithUser(testUser);
    const res = await app.fetch(new Request('https://example.com/api/enrichment/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ last_name: 'Smith' }),
    }), env);
    expect(res.status).toBe(400);
  });

  it('GET /sources returns the enrichment catalog', async () => {
    const app = appWithUser(testUser);
    const res = await app.fetch(new Request('https://example.com/api/enrichment/sources'), env);
    const json = await res.json() as Array<{ key: string; open_source: boolean }>;
    expect(res.status).toBe(200);
    expect(json).toHaveLength(OPEN_SOURCE_ENRICHMENT_SOURCES.length);
    expect(json.filter(s => s.open_source === true)).toHaveLength(
      OPEN_SOURCE_ENRICHMENT_SOURCES.filter(s => s.openSource).length,
    );
  });
});
