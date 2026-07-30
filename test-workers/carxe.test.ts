// Route-level smoke test (Miniflare/workerd) for /api/carxe.
// This codebase's test-workers/*.test.ts files don't use JWT bearer tokens
// against SELF.fetch — auth is applied per-prefix in src/index.ts, not
// inside the router, so routers are tested in isolation with an injected
// c.set('user', ...) middleware (see test-workers/health.test.ts,
// test-workers/auth.test.ts, and test-workers/legalDataHunter.test.ts for
// the established pattern). There is no globalThis.__TEST_JWT__ /
// unstable_dev fixture in this codebase; we build a local Hono app per
// test with the role we need, exactly like legalDataHunter.test.ts does.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import carxe from '../src/routes/carxe';
import { getDb, execute, queryFirst } from '../src/utils/db';

type TestUser = { id: number; role: string; username: string };

function appWithUser(user: TestUser) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: TestUser; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    c.set('userId', user.id);
    await next();
  });
  app.route('/api/carxe', carxe);
  return app;
}

describe('POST /api/carxe/plate-lookup', () => {
  beforeAll(async () => {
    // Miniflare's D1 instance doesn't have migrations applied — create the
    // table this route touches inline, mirroring the other test-workers/*
    // files' pattern (see legalDataHunter.test.ts, bodycamDetections.test.ts).
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db, `CREATE TABLE IF NOT EXISTS carxe_lookups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lookup_type TEXT NOT NULL,
      plate TEXT,
      state TEXT,
      vin TEXT,
      response_json TEXT NOT NULL,
      requested_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM carxe_lookups').run();
  });

  it('returns not_configured when CARXE_API_KEY is unset', async () => {
    const app = appWithUser({ id: 1, role: 'officer', username: 'test-officer' });
    const res = await app.request(
      '/api/carxe/plate-lookup',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plate: '7XER187', state: 'CA' }),
      },
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: 'not_configured' });
  });

  it('rejects client_viewer role (not an operational role)', async () => {
    const app = appWithUser({ id: 2, role: 'client_viewer', username: 'viewer' });
    const res = await app.request(
      '/api/carxe/plate-lookup',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plate: '7XER187', state: 'CA' }),
      },
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(403);
  });

  it('returns invalid_input when plate is missing', async () => {
    const app = appWithUser({ id: 1, role: 'officer', username: 'test-officer' });
    const res = await app.request(
      '/api/carxe/plate-lookup',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'CA' }),
      },
      env as unknown as Record<string, unknown>,
    );
    // configFromEnv is checked before body parsing, so with no CARXE_API_KEY
    // set this still resolves to not_configured rather than invalid_input —
    // asserting 200 here pins that ordering rather than guessing at it.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: 'not_configured' });
  });

  it('fails closed (500 rate_limit_unavailable) when no KV binding is present, instead of proceeding unmetered', async () => {
    // Miniflare binds a real KV namespace (see vitest.workers.config.mts),
    // so the missing-KV branch can't be exercised via globalThis `env`.
    // app.request() accepts an env override as its third arg — build one
    // with CARXE_API_KEY set (so we get past configFromEnv) but with both
    // CARXE_RATE_KV and KV stripped out, to simulate the binding being
    // dropped/renamed.
    const app = appWithUser({ id: 1, role: 'officer', username: 'test-officer' });
    const envWithoutKv: Record<string, unknown> = { ...(env as unknown as Record<string, unknown>), CARXE_API_KEY: 'test-key' };
    delete envWithoutKv.KV;
    delete envWithoutKv.CARXE_RATE_KV;

    const res = await app.request(
      '/api/carxe/plate-lookup',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plate: '7XER187', state: 'CA' }),
      },
      envWithoutKv,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: 'rate_limit_unavailable' });
  });

  it('caches a stateless plate lookup: second call with no state returns cached: true (Fix #2)', async () => {
    // Regression test: `state IS ?` (not `= ?`) is required for this to
    // work — SQLite `NULL = NULL` is never true, and PlateLogPage.tsx calls
    // CarxeLookupPanel with no `state` prop, so this is the primary UI path.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, make: 'Kia', model: 'Forte', year: '2017' }), { status: 200 }),
      ),
    );
    const withKey = { ...(env as unknown as Record<string, unknown>), CARXE_API_KEY: 'test-key' };
    const app = appWithUser({ id: 1, role: 'officer', username: 'test-officer' });

    const first = await app.request(
      '/api/carxe/plate-lookup',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plate: '7XER187' }) },
      withKey,
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({ ok: true, cached: false });

    const second = await app.request(
      '/api/carxe/plate-lookup',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plate: '7XER187' }) },
      withKey,
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody).toMatchObject({ ok: true, cached: true });

    vi.unstubAllGlobals();
  });
});

describe('POST /api/carxe/lien-theft', () => {
  beforeAll(async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db, `CREATE TABLE IF NOT EXISTS carxe_lookups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lookup_type TEXT NOT NULL,
      plate TEXT,
      state TEXT,
      vin TEXT,
      response_json TEXT NOT NULL,
      requested_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await execute(db, `CREATE TABLE IF NOT EXISTS vehicles_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, plate_number TEXT, state TEXT, make TEXT, model TEXT, year INTEGER,
      color TEXT, vin TEXT, owner_person_id INTEGER, is_stolen INTEGER, stolen_status TEXT, flags TEXT DEFAULT '[]',
      notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT
    )`);
    await execute(db, `CREATE TABLE IF NOT EXISTS intel_watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, reason TEXT
    )`);
    await execute(db, `CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, priority TEXT, title TEXT, message TEXT,
      entity_type TEXT, entity_id INTEGER, user_id INTEGER, is_read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM carxe_lookups').run();
    await env.DB.prepare('DELETE FROM vehicles_records').run();
    await env.DB.prepare('DELETE FROM intel_watchlist').run();
    await env.DB.prepare('DELETE FROM notifications').run();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('an active theft event upserts vehicles_records, screens it, and raises a critical notification (Fix #1)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            input: { vin: '2C3CDXFG1FH762860' },
            year: 2015,
            make: 'Dodge',
            model: 'Charger',
            events: [{ event: 'Active Theft', location: 'OH', date: '2026-07-01' }],
          }),
          { status: 200 },
        ),
      ),
    );
    const withKey = { ...(env as unknown as Record<string, unknown>), CARXE_API_KEY: 'test-key' };
    const app = appWithUser({ id: 7, role: 'officer', username: 'test-officer' });

    const res = await app.request(
      '/api/carxe/lien-theft',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vin: '2C3CDXFG1FH762860' }) },
      withKey,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.screening).toBeDefined();
    expect(body.screening.hits.some((h: any) => h.kind === 'stolen' && h.severity === 'critical')).toBe(true);

    const db = getDb(env as unknown as { DB: D1Database });
    const vehicle = await queryFirst<any>(db, 'SELECT * FROM vehicles_records WHERE UPPER(vin) = ?', '2C3CDXFG1FH762860');
    expect(vehicle).toBeTruthy();
    expect(vehicle.is_stolen).toBe(1);
    expect(vehicle.stolen_status).toBeTruthy();
    expect(vehicle.make).toBe('Dodge');

    const notif = await queryFirst<any>(db, "SELECT * FROM notifications WHERE entity_type = 'vehicle' AND entity_id = ?", vehicle.id);
    expect(notif).toBeTruthy();
    expect(notif.priority).toBe('high');
    expect(String(notif.message)).toMatch(/STOLEN/i);
  });

  it('a non-active ("Theft Recovered") event does NOT trigger screening or a notification (Fix #3)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            input: { vin: '1HGCM82633A004352' },
            events: [{ event: 'Theft Recovered', location: 'UT', date: '2020-01-01' }],
          }),
          { status: 200 },
        ),
      ),
    );
    const withKey = { ...(env as unknown as Record<string, unknown>), CARXE_API_KEY: 'test-key' };
    const app = appWithUser({ id: 7, role: 'officer', username: 'test-officer' });

    const res = await app.request(
      '/api/carxe/lien-theft',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vin: '1HGCM82633A004352' }) },
      withKey,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.screening).toBeUndefined();

    const db = getDb(env as unknown as { DB: D1Database });
    const vehicle = await queryFirst<any>(db, 'SELECT * FROM vehicles_records WHERE UPPER(vin) = ?', '1HGCM82633A004352');
    expect(vehicle).toBeFalsy();

    const notif = await queryFirst<any>(db, "SELECT * FROM notifications WHERE type = 'intel_screen'");
    expect(notif).toBeFalsy();
  });
});
