// test-workers/connectionsSearchPerf.test.ts
//
// GET /api/connections/search ran ~10 independent D1 queries in a strictly
// sequential `for (... of await query(...))` chain — a live search for
// "Christopher" took 8-9s end to end (confirmed via the Chrome network
// panel) because each source paid for its own round-trip one after
// another. None of the sources depend on each other, so this pins that
// results from multiple source tables (person + vehicle here) both come
// back from a single call, and in the original persons-before-vehicles
// order, after switching the route to Promise.all.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import connections from '../src/routes/connections';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-analyst' });
  c.set('userId', 1);
  await next();
});
app.route('/api/connections', connections);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS vehicles_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plate_number TEXT, make TEXT, model TEXT, color TEXT, vin TEXT
  )`);
  await execute(db, `INSERT INTO persons (first_name, last_name) VALUES ('Zippy', 'Testperson')`);
  await execute(db, `INSERT INTO vehicles_records (plate_number, make, model, color) VALUES ('ZIP123', 'Zippy Motors', 'Testcar', 'Red')`);
});

describe('GET /api/connections/search', () => {
  it('returns hits from multiple source tables in one call', async () => {
    const res = await app.request('/api/connections/search?q=Zippy', { method: 'GET' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body.find((r) => r.type === 'person' && r.label.includes('Testperson'))).toBeTruthy();
    expect(body.find((r) => r.type === 'vehicle' && r.label.includes('Testcar'))).toBeTruthy();
  });
});
