// Route-level test (Miniflare/workerd) for the self-service "am I clocked
// in" endpoint that powers the desktop Clock & Shift widget. Unlike GET
// /personnel/time (gated by requireTimeWriter — admin/manager/supervisor/HR
// only), this endpoint is self-only: any authenticated officer can read
// their OWN open time entry, never anyone else's.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import personnel from '../src/routes/personnel';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 7, role: 'officer' });
  c.set('userId', 7);
  await next();
});
app.route('/api/personnel', personnel);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    officer_id INTEGER, schedule_id INTEGER,
    clock_in TEXT, clock_in_local TEXT, clock_out TEXT,
    total_hours REAL, break_start TEXT, break_minutes INTEGER,
    status TEXT, notes TEXT, created_at TEXT
  )`);
});

describe('GET /api/personnel/time/mine/active', () => {
  it('returns active:false when the officer has no open time entry', async () => {
    const res = await app.request('/api/personnel/time/mine/active', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { active: boolean; entry: unknown };
    expect(body.active).toBe(false);
    expect(body.entry).toBeNull();
  });

  it('returns active:true with the entry when clocked in', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `INSERT INTO time_entries (officer_id, clock_in, clock_in_local, status, created_at) VALUES (7, '2026-07-18T14:00:00Z', '2026-07-18T08:00:00', 'active', datetime('now'))`);
    const res = await app.request('/api/personnel/time/mine/active', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as { active: boolean; entry: { officer_id: number; clock_out: string | null } };
    expect(body.active).toBe(true);
    expect(body.entry.officer_id).toBe(7);
    expect(body.entry.clock_out).toBeNull();
  });

  it('never returns another officer\'s open entry', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, `INSERT INTO time_entries (officer_id, clock_in, status, created_at) VALUES (999, datetime('now'), 'active', datetime('now'))`);
    const res = await app.request('/api/personnel/time/mine/active', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as { entry: { officer_id: number } | null };
    expect(body.entry?.officer_id).not.toBe(999);
  });
});
