// Route-level regression test (Miniflare/workerd) for
// POST /api/warrants/national-search.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import warrants from '../src/routes/warrants';

function buildApp(role: string) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role, username: 'test-user' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/warrants', warrants);
  return app;
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS scraped_warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT, full_name TEXT, first_name TEXT,
    last_name TEXT, date_of_birth TEXT, warrant_type TEXT, charge_description TEXT,
    court_name TEXT, case_number TEXT, bail_amount REAL, offense_level TEXT, issue_date TEXT,
    status TEXT DEFAULT 'active', warrant_id TEXT, person_id INTEGER, middle_name TEXT,
    age INTEGER, gender TEXT, race TEXT, city TEXT, state TEXT, photo_url TEXT, detail_url TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, warrant_number TEXT, type TEXT, status TEXT DEFAULT 'active',
    subject_name TEXT, subject_first_name TEXT, subject_last_name TEXT, subject_dob TEXT,
    offense TEXT, offense_description TEXT, charge_description TEXT, issuing_court TEXT,
    bond_amount REAL, bail_amount REAL, issued_date TEXT, offense_level TEXT, warrant_type TEXT
  )`);

  // Exact DOB match — should be included when dob is queried.
  await execute(db, `INSERT INTO scraped_warrants (source_key, first_name, last_name, date_of_birth, state, status)
    VALUES ('arcgis-arlington-tx', 'John', 'Smith', '1990-05-12', 'TX', 'active')`);
  // Same name, different DOB — should be EXCLUDED when dob is queried.
  await execute(db, `INSERT INTO scraped_warrants (source_key, first_name, last_name, date_of_birth, state, status)
    VALUES ('arcgis-arlington-tx', 'John', 'Smith', '1975-01-01', 'TX', 'active')`);
  // Same name, no dob, but age unset either — should be EXCLUDED when dob is queried.
  await execute(db, `INSERT INTO scraped_warrants (source_key, first_name, last_name, state, status)
    VALUES ('arcgis-arlington-tx', 'John', 'Smith', 'TX', 'active')`);

  await execute(db, `INSERT INTO warrants (warrant_number, subject_first_name, subject_last_name, subject_dob, status)
    VALUES ('RMPG-1', 'John', 'Smith', '1990-05-12', 'active')`);
});

describe('POST /api/warrants/national-search', () => {
  it('rejects an empty query', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/national-search', {
      method: 'POST', body: JSON.stringify({}),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
  });

  it('applies strict DOB matching: only the exact-DOB row and the local row are returned, not the DOB-mismatch or no-DOB rows', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/national-search', {
      method: 'POST',
      body: JSON.stringify({ last_name: 'Smith', dob: '1990-05-12' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { total: number; by_state: Record<string, Array<{ dob: string }>>; local: Array<{ dob: string }> };

    expect(body.by_state.TX).toHaveLength(1);
    expect(body.by_state.TX[0].dob).toBe('1990-05-12');
    expect(body.local).toHaveLength(1);
    expect(body.local[0].dob).toBe('1990-05-12');
    expect(body.total).toBe(2);
  });

  it('falls back to name-only matching (all 3 scraped rows) when no dob is supplied', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/national-search', {
      method: 'POST',
      body: JSON.stringify({ last_name: 'Smith' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { by_state: Record<string, unknown[]> };
    expect(body.by_state.TX).toHaveLength(3);
  });

  it('captures every column from the source row, not just a curated subset', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/warrants/national-search', {
      method: 'POST',
      body: JSON.stringify({ last_name: 'Smith', dob: '1990-05-12' }),
    }, env as unknown as Record<string, unknown>);
    const body = await res.json() as { by_state: Record<string, Array<Record<string, unknown>>> };
    // source_key/city/state (not part of the curated MappedWarrant fields)
    // must still be present, passed through under their own column name.
    expect(body.by_state.TX[0].source_key).toBe('arcgis-arlington-tx');
    expect(body.by_state.TX[0].state).toBe('TX');
  });
});
