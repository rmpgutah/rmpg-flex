import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { getDb, execute } from '../src/utils/db';
import skiptracerV2 from '../src/routes/skiptracerV2';

type TestUser = { id: number; role: string; username: string; user_id: number };

function appWithUser(user: TestUser) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: TestUser; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    c.set('userId', user.id);
    await next();
  });
  app.route('/api/skiptracer-v2', skiptracerV2);
  return app;
}

const testUser: TestUser = { id: 1, role: 'admin', username: 'test-officer', user_id: 1 };

describe('skiptracer-v2 routes', () => {
  beforeAll(async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db, `CREATE TABLE IF NOT EXISTS persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT, middle_name TEXT, last_name TEXT, dob TEXT,
      phone TEXT, email TEXT, address TEXT, city TEXT, state TEXT, zip TEXT,
      ssn_last4 TEXT, ssn_full TEXT, alias_nickname TEXT, aliases TEXT
    )`);
    await execute(db, `INSERT INTO persons (first_name, last_name, city, state)
      VALUES ('Jane', 'Doe', 'Salt Lake City', 'UT')`);
    await execute(db, `CREATE TABLE IF NOT EXISTS skiptracer_dossiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_name TEXT NOT NULL,
      search_results TEXT,
      profile_snapshot TEXT,
      notes TEXT,
      tags TEXT,
      status TEXT DEFAULT 'active',
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
    await execute(db, `CREATE TABLE IF NOT EXISTS system_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key TEXT NOT NULL,
      config_value TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      is_active INTEGER NOT NULL DEFAULT 1
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
    await execute(db, `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT
    )`);
    await execute(db, `INSERT OR IGNORE INTO users (id, full_name) VALUES (1, 'Test Officer')`);
    // Disable all external enrichment sources so the search test never fires real HTTP calls.
    for (const key of [
      'nsopw', 'sl_assessor', 'open_sanctions', 'fbi_wanted', 'bop_inmates',
      'census_geocoder', 'ofac_sdn', 'usps', 'open_corporates', 'numverify',
      'usa_people_search', 'hunter', 'pdl', 'apollo', 'hibp', 'courtlistener',
    ]) {
      await execute(db,
        `INSERT OR IGNORE INTO system_config (config_key, config_value, category)
         VALUES (?, '0', 'skiptracer')`,
        `skiptracer_v2_source_${key}_enabled`,
      );
    }
  });

  it('GET /sources returns registered adapters', async () => {
    const app = appWithUser(testUser);
    const res = await app.request('/api/skiptracer-v2/sources', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ name: string; configured: boolean }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.some(s => s.name === 'local_rms')).toBe(true);
  });

  it('GET /search finds local RMS matches', async () => {
    const app = appWithUser(testUser);
    const res = await app.request('/api/skiptracer-v2/search?q=Jane+Doe&engine=microbilt', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { profiles: unknown[]; totalResults: number };
    expect(body.totalResults).toBeGreaterThan(0);
    expect(body.profiles.length).toBeGreaterThan(0);
  });

  it('POST /dossiers saves a profile snapshot', async () => {
    const app = appWithUser(testUser);
    const res = await app.request('/api/skiptracer-v2/dossiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subjectName: 'Jane Doe',
        profileSnapshot: { fullName: 'Jane Doe', sources: ['local_rms'] },
        notes: 'test',
      }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: number };
    expect(body.id).toBeGreaterThan(0);
  });
});
