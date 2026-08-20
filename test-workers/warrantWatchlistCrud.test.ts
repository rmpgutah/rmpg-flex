import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import intel from '../src/routes/intel';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 5, role: 'officer' });
  c.set('userId', 5);
  await next();
});
app.route('/api/intel', intel);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS intel_watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
    reason TEXT, added_by INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    last_alert_at TEXT DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now')),
    last_known_status TEXT, expiry_alerted_at TEXT,
    UNIQUE (entity_type, entity_id, added_by)
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, warrant_number TEXT, status TEXT NOT NULL DEFAULT 'active',
    subject_person_id INTEGER, subject_name TEXT, expires_at TEXT
  )`);
  await execute(db, `INSERT INTO warrants (id, warrant_number, status, subject_person_id, subject_name)
    VALUES (42, 'W-2026-042', 'active', 900, 'John Doe')`);
});

describe('POST /api/intel/watchlist — warrant entity type', () => {
  it('rejects a non-existent warrant id with 404', async () => {
    const res = await app.request('/api/intel/watchlist', {
      method: 'POST',
      body: JSON.stringify({ entity_type: 'warrant', entity_id: 999999 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(404);
  });

  it('accepts a real warrant id and seeds last_known_status from its current status', async () => {
    const res = await app.request('/api/intel/watchlist', {
      method: 'POST',
      body: JSON.stringify({ entity_type: 'warrant', entity_id: 42, reason: 'flagged from warrants' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);

    const listRes = await app.request('/api/intel/watchlist', {}, env as unknown as Record<string, unknown>);
    const rows = await listRes.json() as { entity_type: string; entity_id: number; last_known_status: string }[];
    const row = rows.find(r => r.entity_type === 'warrant' && r.entity_id === 42);
    expect(row?.last_known_status).toBe('active');
  });

  it('still accepts person/vehicle watches unchanged (no existence check, no last_known_status)', async () => {
    const res = await app.request('/api/intel/watchlist', {
      method: 'POST',
      body: JSON.stringify({ entity_type: 'person', entity_id: 12345 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
  });
});
