// GET /process-server/officer-start/:officerId — the route planner's origin feed.
//
// Runs the real router against Miniflare's D1 so the "newest fix wins" ordering
// and the zone-safe age math are exercised, not just typechecked. The client
// policy that consumes this (freshness window, live-vs-stored preference) is
// unit-tested separately in client/src/utils/__tests__/serveRouteOrigin.test.ts.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import serve from '../src/routes/serve';

type Role = 'officer' | 'supervisor' | 'admin' | 'client_viewer';

function appAs(role: Role) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 42, role, username: `test_${role}`, full_name: `Test ${role}` });
    c.set('userId', 42);
    await next();
  });
  app.route('/process-server', serve);
  return app;
}

const db = () => env.DB as unknown as import('@cloudflare/workers-types').D1Database;

const get = (role: Role, officerId: string | number) =>
  appAs(role).request(
    `/process-server/officer-start/${officerId}`,
    {},
    env as unknown as Record<string, unknown>,
  );

beforeAll(async () => {
  await db().prepare(`CREATE TABLE IF NOT EXISTS gps_breadcrumbs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id INTEGER,
    officer_id INTEGER NOT NULL,
    latitude REAL,
    longitude REAL,
    accuracy REAL,
    recorded_at TEXT
  )`).run();
});

beforeEach(async () => {
  await db().prepare('DELETE FROM gps_breadcrumbs').run();
});

async function insertFix(officerId: number, lat: number, lng: number, recordedAt: string, accuracy: number | null = 15) {
  await db().prepare(
    'INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, recorded_at) VALUES (1,?,?,?,?,?)',
  ).bind(officerId, lat, lng, accuracy, recordedAt).run();
}

/** UTC "YYYY-MM-DD HH:MM:SS", the zone-less shape datetime('now') writes. */
function d1Stamp(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60000).toISOString().slice(0, 19).replace('T', ' ');
}

describe('GET /process-server/officer-start/:officerId', () => {
  it('reports found:false rather than erroring when the officer has no fixes', async () => {
    const res = await get('officer', 7);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.found).toBe(false);
    expect(body.officer_id).toBe(7);
  });

  it('returns the officer position and its age', async () => {
    await insertFix(7, 40.6945, -111.8819, d1Stamp(20), 35);
    const body = await (await get('officer', 7)).json() as any;
    expect(body.found).toBe(true);
    expect(body.lat).toBeCloseTo(40.6945, 4);
    expect(body.lng).toBeCloseTo(-111.8819, 4);
    expect(body.accuracy_m).toBe(35);
    // NOTE: this asserts the age MATH, not the timezone handling. workerd runs
    // with UTC as local time, so a naive Date.parse of a zone-less stamp passes
    // here too — verified by swapping it in. The route still uses
    // parseD1TimestampMs deliberately (CLAUDE.md requires it for D1 timestamps,
    // and it is what keeps this correct if the value is ever read outside a
    // UTC runtime), but do not read a green test here as proof of that.
    expect(body.age_minutes).toBeGreaterThanOrEqual(19);
    expect(body.age_minutes).toBeLessThanOrEqual(21);
  });

  it('returns the NEWEST fix, not an arbitrary one', async () => {
    await insertFix(7, 1.0, 1.0, d1Stamp(300));
    await insertFix(7, 2.0, 2.0, d1Stamp(5));
    await insertFix(7, 3.0, 3.0, d1Stamp(120));
    const body = await (await get('officer', 7)).json() as any;
    expect(body.lat).toBeCloseTo(2.0, 4);
  });

  it('never returns another officer\'s position', async () => {
    await insertFix(7, 1.0, 1.0, d1Stamp(5));
    await insertFix(9, 2.0, 2.0, d1Stamp(1));
    const body = await (await get('officer', 7)).json() as any;
    expect(body.lat).toBeCloseTo(1.0, 4);
  });

  it('skips rows with NULL coordinates', async () => {
    await insertFix(7, 1.0, 1.0, d1Stamp(60));
    // A newer row with no coordinates must not shadow the usable older one.
    await db().prepare(
      'INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, recorded_at) VALUES (1,?,NULL,NULL,?,?)',
    ).bind(7, 10, d1Stamp(1)).run();
    const body = await (await get('officer', 7)).json() as any;
    expect(body.found).toBe(true);
    expect(body.lat).toBeCloseTo(1.0, 4);
  });

  it('rejects a non-numeric officerId', async () => {
    const res = await get('officer', 'abc');
    expect(res.status).toBe(400);
  });

  it('tolerates a missing accuracy', async () => {
    await insertFix(7, 1.0, 1.0, d1Stamp(5), null);
    const body = await (await get('officer', 7)).json() as any;
    expect(body.accuracy_m).toBeNull();
  });
});
