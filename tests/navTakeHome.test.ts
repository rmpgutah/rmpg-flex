// ============================================================
// /api/nav take-home status — must not read users.has_take_home
// ============================================================
// No migration ever created `users.has_take_home`; the only take-home schema
// is migration 0064 (`users.take_home_vehicle_id` + `fleet_vehicles.take_home`).
// The two nav handlers (and the GPS breadcrumb write path) selected the
// phantom column, so on any DB built from the migrations they 500'd:
// `no such column: has_take_home` → useNavTripDetection never learned the
// officer had a take-home vehicle and trip detection stayed disabled.
// ============================================================

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import nav from '../src/routes/nav';
import type { Env } from '../src/types';
import { recordingDb } from './helpers/fakeD1';

function buildApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 3, username: 'officer1', role: 'officer', full_name: 'Officer One' });
    c.set('userId', 3);
    await next();
  });
  app.route('/api/nav', nav);
  return (path: string) => app.request(path, {}, { DB: db, JWT_SECRET: 'test' });
}

// A D1 double that throws exactly the way live D1 does for a missing column,
// so any handler still selecting users.has_take_home fails the test.
function strictDb(rows: Record<string, unknown>[]) {
  const { db } = recordingDb([{ match: /FROM users u\s+LEFT JOIN fleet_vehicles fv/, rows }]);
  const inner = db as unknown as { prepare: (sql: string) => unknown };
  const origPrepare = inner.prepare.bind(inner);
  inner.prepare = (sql: string) => {
    if (/\bhas_take_home\b/.test(sql)) throw new Error('D1_ERROR: no such column: has_take_home: SQLITE_ERROR');
    return origPrepare(sql);
  };
  return db;
}

describe('nav take-home status', () => {
  it('GET /vehicle-take-home reports true when the linked fleet vehicle is flagged take_home', async () => {
    const res = await buildApp(strictDb([{ take_home_vehicle_id: 12, vehicle_take_home: 1 }]))('/api/nav/vehicle-take-home');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ has_take_home: true, vehicle_id: 12 });
  });

  it('GET /vehicle-take-home reports false when the user has no take-home vehicle', async () => {
    const res = await buildApp(strictDb([{ take_home_vehicle_id: null, vehicle_take_home: null }]))('/api/nav/vehicle-take-home');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ has_take_home: false, vehicle_id: null });
  });

  it('GET /vehicle-take-home reports false when the linked vehicle is not flagged take_home', async () => {
    const res = await buildApp(strictDb([{ take_home_vehicle_id: 12, vehicle_take_home: 0 }]))('/api/nav/vehicle-take-home');
    expect(await res.json()).toEqual({ has_take_home: false, vehicle_id: 12 });
  });

  it('GET /trip/check-take-home uses the same derivation', async () => {
    const res = await buildApp(strictDb([{ take_home_vehicle_id: 12, vehicle_take_home: 1 }]))('/api/nav/trip/check-take-home');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ take_home: true, vehicle_id: 12 });
  });
});
