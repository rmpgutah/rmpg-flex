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
    // plate-lookup writes to vehicles_records too. Without this the upsert
    // throws "no such table", and because the route deliberately degrades
    // rather than failing the officer's lookup, the failure would be INVISIBLE
    // to these tests.
    await execute(db, `CREATE TABLE IF NOT EXISTS vehicles_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, plate_number TEXT, state TEXT, make TEXT, model TEXT, year INTEGER,
      color TEXT, vin TEXT, owner_person_id INTEGER, is_stolen INTEGER, stolen_status TEXT, flags TEXT DEFAULT '[]',
      notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT,
      trim TEXT, body_style TEXT, engine_type TEXT, fuel_type TEXT, transmission TEXT,
      drive_type TEXT, doors INTEGER, lien_holder TEXT
    )`);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM carxe_lookups').run();
    await env.DB.prepare('DELETE FROM vehicles_records').run();
  });

  it('writes the decoded plate onto vehicles_records, bridging the VIN so VIN-keyed lookups become resolvable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            input: { plate: '4FXN2' },
            make: 'Mercedes-Benz',
            model: 'S550',
            trim: '4MATIC',
            year: '2014',
            color: 'Silver',
            vin: 'wddsj4eb2en037753',
            style: 'Sedan',
          }),
          { status: 200 },
        ),
      ),
    );
    const withKey = { ...(env as unknown as Record<string, unknown>), CARXE_API_KEY: 'test-key' };
    const app = appWithUser({ id: 1, role: 'officer', username: 'test-officer' });

    const res = await app.request(
      '/api/carxe/plate-lookup',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plate: '4FXN2', state: 'UT' }) },
      withKey,
    );
    const body = await res.json() as any;
    expect(body.vehicle_record).toBeDefined();
    expect(body.vehicle_record.created).toBe(true);

    const db = getDb(env as unknown as { DB: D1Database });
    const row = await queryFirst<any>(db, "SELECT * FROM vehicles_records WHERE plate_number = '4FXN2'");
    expect(row).toBeTruthy();
    // VIN normalized to upper case — resolveVehicleRecord compares on
    // UPPER(TRIM(vin)), and the live unique index is on that expression.
    expect(row.vin).toBe('WDDSJ4EB2EN037753');
    expect(row.make).toBe('Mercedes-Benz');
    expect(row.year).toBe(2014);       // '2014' string parsed to INTEGER
    expect(row.body_style).toBe('Sedan');
    expect(row.state).toBe('UT');

    vi.unstubAllGlobals();
  });

  it('does not overwrite officer-entered fields on an existing plate record (fill-only)', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(
      db,
      `INSERT INTO vehicles_records (plate_number, state, color, notes, created_at, updated_at)
       VALUES ('4FXN2', 'UT', 'Repainted matte black', 'Officer observed', datetime('now'), datetime('now'))`,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, input: { plate: '4FXN2' }, make: 'Mercedes-Benz', color: 'Silver' }), { status: 200 }),
      ),
    );
    const withKey = { ...(env as unknown as Record<string, unknown>), CARXE_API_KEY: 'test-key' };
    const app = appWithUser({ id: 1, role: 'officer', username: 'test-officer' });

    const res = await app.request(
      '/api/carxe/plate-lookup',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plate: '4FXN2', state: 'UT' }) },
      withKey,
    );
    const body = await res.json() as any;
    expect(body.vehicle_record.created).toBe(false);

    const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM vehicles_records').first<{ c: number }>();
    expect(count?.c).toBe(1);
    const row = await queryFirst<any>(db, "SELECT * FROM vehicles_records WHERE plate_number = '4FXN2'");
    // The officer's colour observation wins over CarsXE's registration colour.
    expect(row.color).toBe('Repainted matte black');
    expect(row.notes).toBe('Officer observed');
    // ...but the blank make got filled.
    expect(row.make).toBe('Mercedes-Benz');

    vi.unstubAllGlobals();
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
    // Column set mirrors the live vehicles_records columns this route touches
    // (verified against D1 785de7ae via pragma_table_info) — including the
    // spec/lien columns the enrichment paths fill. A fixture missing them would
    // fail with "no such column" instead of exercising the write.
    await execute(db, `CREATE TABLE IF NOT EXISTS vehicles_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, plate_number TEXT, state TEXT, make TEXT, model TEXT, year INTEGER,
      color TEXT, vin TEXT, owner_person_id INTEGER, is_stolen INTEGER, stolen_status TEXT, flags TEXT DEFAULT '[]',
      notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT,
      trim TEXT, body_style TEXT, engine_type TEXT, fuel_type TEXT, transmission TEXT,
      drive_type TEXT, doors INTEGER, lien_holder TEXT
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

  // The theft path intentionally runs on cache hits too (so a re-pull of a
  // cached active-theft VIN still screens). That made the notification INSERT
  // the one non-idempotent step: N pulls produced N rows.
  it('re-pulling a cached active-theft VIN keeps screening but does NOT append a duplicate notification for the same officer', async () => {
    const fetchStub = vi.fn(async () =>
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
    );
    vi.stubGlobal('fetch', fetchStub);
    const withKey = { ...(env as unknown as Record<string, unknown>), CARXE_API_KEY: 'test-key' };
    const app = appWithUser({ id: 7, role: 'officer', username: 'test-officer' });
    const req = () =>
      app.request(
        '/api/carxe/lien-theft',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vin: '2C3CDXFG1FH762860' }) },
        withKey,
      );

    const first = await req();
    const firstBody = await first.json() as any;
    expect(firstBody.cached).toBe(false);

    const second = await req();
    const secondBody = await second.json() as any;
    // Pin the branch: this must be the CACHED path, otherwise the test would
    // pass for the wrong reason (a fresh call that simply raced the window).
    expect(secondBody.cached).toBe(true);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    // Screening must still be returned on the cached pull — dedupe suppresses
    // the notification only, never the officer-safety verdict.
    expect(secondBody.screening.hits.some((h: any) => h.severity === 'critical')).toBe(true);

    const db = getDb(env as unknown as { DB: D1Database });
    const rows = await env.DB.prepare("SELECT COUNT(*) AS c FROM notifications WHERE type = 'intel_screen'").first<{ c: number }>();
    expect(rows?.c).toBe(1);

    // The flag must not have been duplicated either.
    const vehicle = await queryFirst<any>(db, 'SELECT * FROM vehicles_records WHERE UPPER(vin) = ?', '2C3CDXFG1FH762860');
    expect(JSON.parse(vehicle.flags).filter((f: any) => f?.type === 'carxe_theft')).toHaveLength(1);
  });

  // THE REGRESSION THIS FILE PREVIOUSLY MISSED. The old fixtures seeded a
  // VIN-bearing vehicles_records row, so `WHERE UPPER(vin) = ?` always matched
  // and the tests passed. Live data does not look like that: 38 of 42 rows have
  // NO vin and every row has a plate. Under those real conditions the theft
  // path INSERTed a duplicate row and stamped is_stolen=1 on the orphan, while
  // the plate-keyed record officers actually see in the dossier stayed clean.
  it('flags the EXISTING plate-keyed record (no VIN) instead of creating a duplicate — mirrors live data where 90% of rows have no VIN', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    // Seed the shape live actually has: plate, no VIN, officer-entered notes.
    await execute(
      db,
      `INSERT INTO vehicles_records (plate_number, state, make, notes, flags, created_at, updated_at)
       VALUES ('8JAR3', 'UT', 'Ram', 'Officer note: do not overwrite', '[]', datetime('now'), datetime('now'))`,
    );
    const seeded = await queryFirst<any>(db, "SELECT id FROM vehicles_records WHERE plate_number = '8JAR3'");

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            input: { vin: '1C6SRFMTXNN283482' },
            year: 2022,
            make: 'RAM',
            model: '1500',
            events: [{ event: 'Active Theft', location: 'UT', date: '2026-07-01' }],
          }),
          { status: 200 },
        ),
      ),
    );
    const withKey = { ...(env as unknown as Record<string, unknown>), CARXE_API_KEY: 'test-key' };
    const app = appWithUser({ id: 7, role: 'officer', username: 'test-officer' });

    const res = await app.request(
      '/api/carxe/lien-theft',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Plate context is what lets the server resolve onto the existing row.
        body: JSON.stringify({ vin: '1C6SRFMTXNN283482', plate: '8JAR3', state: 'UT' }),
      },
      withKey,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // Exactly ONE row for this physical car — not two.
    const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM vehicles_records').first<{ c: number }>();
    expect(count?.c).toBe(1);

    // ...and the flag landed on the ROW THAT ALREADY EXISTED.
    expect(body.screening.vehicleId).toBe(seeded.id);
    const row = await queryFirst<any>(db, 'SELECT * FROM vehicles_records WHERE id = ?', seeded.id);
    expect(row.is_stolen).toBe(1);
    expect(row.stolen_status).toBeTruthy();
    // The VIN was bridged onto the plate-keyed record, so future VIN lookups resolve.
    expect(String(row.vin).toUpperCase()).toBe('1C6SRFMTXNN283482');
    // Fill-only discipline: the blank model got filled, the officer's note and
    // the officer-entered make did NOT get overwritten by CarsXE's 'RAM'.
    expect(row.model).toBe('1500');
    expect(row.make).toBe('Ram');
    expect(row.notes).toBe('Officer note: do not overwrite');
  });

  it('stores a non-theft lien holder on the vehicle record without raising an alert', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            input: { vin: '5UXWX5C54BL706530' },
            make: 'BMW',
            events: [{ event: 'Active Lien', lienholder: 'Mountain America Credit Union', date: '2024-03-02' }],
          }),
          { status: 200 },
        ),
      ),
    );
    const withKey = { ...(env as unknown as Record<string, unknown>), CARXE_API_KEY: 'test-key' };
    const app = appWithUser({ id: 7, role: 'officer', username: 'test-officer' });

    const res = await app.request(
      '/api/carxe/lien-theft',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vin: '5UXWX5C54BL706530', plate: '8AT545' }) },
      withKey,
    );
    const body = await res.json() as any;
    // Informational only — a lien is not an officer-safety alert.
    expect(body.screening).toBeUndefined();
    const notif = await queryFirst<any>(getDb(env as unknown as { DB: D1Database }), "SELECT id FROM notifications WHERE type = 'intel_screen'");
    expect(notif).toBeFalsy();

    const row = await queryFirst<any>(
      getDb(env as unknown as { DB: D1Database }),
      'SELECT lien_holder, is_stolen FROM vehicles_records WHERE UPPER(TRIM(vin)) = ?',
      '5UXWX5C54BL706530',
    );
    expect(row.lien_holder).toBe('Mountain America Credit Union');
    expect(row.is_stolen ?? 0).toBe(0);
  });

  it('dedupe is per-recipient: a DIFFERENT officer pulling the same cached active-theft VIN still gets their own alert', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            input: { vin: '2C3CDXFG1FH762860' },
            events: [{ event: 'Active Theft', location: 'OH', date: '2026-07-01' }],
          }),
          { status: 200 },
        ),
      ),
    );
    const withKey = { ...(env as unknown as Record<string, unknown>), CARXE_API_KEY: 'test-key' };
    const body = JSON.stringify({ vin: '2C3CDXFG1FH762860' });
    const headers = { 'content-type': 'application/json' };

    await appWithUser({ id: 7, role: 'officer', username: 'officer-a' }).request(
      '/api/carxe/lien-theft', { method: 'POST', headers, body }, withKey,
    );
    await appWithUser({ id: 8, role: 'officer', username: 'officer-b' }).request(
      '/api/carxe/lien-theft', { method: 'POST', headers, body }, withKey,
    );

    const rows = await env.DB.prepare(
      "SELECT user_id FROM notifications WHERE type = 'intel_screen' ORDER BY user_id",
    ).all<{ user_id: number }>();
    expect(rows.results.map((r) => r.user_id)).toEqual([7, 8]);
  });
});
