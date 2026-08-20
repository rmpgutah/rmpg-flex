// test-workers/warrantsUnifiedWatchedOnly.test.ts
// Route-level test (Miniflare/workerd) for the watched_only filter on
// GET /warrants/unified — this endpoint filters in-memory over a merged
// array (local warrants + scraped_warrants), not via SQL, so this test
// confirms watched_only composes correctly with the existing status filter.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import warrants from '../src/routes/warrants';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string } } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 7, role: 'officer' });
  await next();
});
app.route('/api/warrants', warrants);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, warrant_number TEXT, type TEXT DEFAULT 'arrest',
    status TEXT NOT NULL DEFAULT 'active', subject_person_id INTEGER, subject_name TEXT,
    subject_first_name TEXT, subject_last_name TEXT, charge_description TEXT, bail_amount REAL,
    offense_level TEXT, issuing_court TEXT,
    source TEXT, archived_at TEXT, expires_at TEXT, created_at TEXT DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS scraped_warrants (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS intel_watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
    added_by INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1
  )`);
  await execute(db, `INSERT INTO warrants (id, warrant_number, status) VALUES (10, 'W-10', 'active'), (11, 'W-11', 'active'), (12, 'W-12', 'served')`);
  await execute(db, `INSERT INTO intel_watchlist (entity_type, entity_id, added_by, active) VALUES ('warrant', 10, 7, 1), ('warrant', 12, 7, 1), ('warrant', 11, 99, 1)`);
});

describe('GET /warrants/unified?watched_only=1', () => {
  it('returns only the current user\'s watched warrants', async () => {
    const res = await app.request('/api/warrants/unified?watched_only=1', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as { warrants: { id: number }[]; total: number };
    const ids = body.warrants.map(w => w.id).sort();
    expect(ids).toEqual([10, 12]); // NOT 11 — that's watched by a different user (added_by=99)
  });

  it('composes with the existing status filter', async () => {
    const res = await app.request('/api/warrants/unified?watched_only=1&status=active', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as { warrants: { id: number }[]; total: number };
    expect(body.warrants.map(w => w.id)).toEqual([10]); // 12 is watched but status='served', filtered out
  });

  it('is a no-op when omitted (existing behavior unchanged)', async () => {
    const res = await app.request('/api/warrants/unified', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as { warrants: { id: number }[]; total: number };
    expect(body.total).toBe(3);
  });
});
