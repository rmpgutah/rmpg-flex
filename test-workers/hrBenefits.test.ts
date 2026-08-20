// Route-level tests (Miniflare/workerd) for the HR Console Benefits tab.
//
// GET /hr/benefits used to be a stub returning a hardcoded [] ("deferred until
// the hr_benefits table exists" — a comment that was already stale; the table
// existed on live all along), and POST /hr/benefits did not exist at all, so
// BenefitsTab's Add-benefit submit 404'd and surfaced only a generic toast.
//
// The fixture below mirrors the LIVE hr_benefits schema column-for-column
// (including notes/created_by added by migration 0218). A fixture that declares
// a shape live does not have is worse than no test: it green-lights broken SQL
// in CI. scripts/check-fixture-schema-drift.py enforces that.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import hr from '../src/routes/hr';

function appAs(role: string, id = 1) {
  const app = new Hono<{
    Bindings: Record<string, unknown>;
    Variables: { user: { id: number; role: string; username: string }; userId: number };
  }>();
  app.use('*', async (c, next) => {
    c.set('user', { id, role, username: 'test-user' });
    c.set('userId', id);
    await next();
  });
  app.route('/hr', hr);
  return app;
}

const db = () => (env as unknown as { DB: D1Database }).DB;

beforeAll(async () => {
  await execute(db(), `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT, badge_number TEXT,
    role TEXT NOT NULL DEFAULT 'officer', status TEXT NOT NULL DEFAULT 'active'
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS hr_benefits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    officer_id INTEGER NOT NULL,
    benefit_type TEXT NOT NULL,
    plan_name TEXT,
    provider TEXT,
    coverage_level TEXT DEFAULT 'individual',
    employee_cost REAL DEFAULT 0,
    employer_cost REAL DEFAULT 0,
    effective_date TEXT,
    end_date TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    notes TEXT,
    created_by INTEGER
  )`);
  await execute(db(), "INSERT OR IGNORE INTO users (id, full_name, role) VALUES (1, 'Manager One', 'manager'), (2, 'Officer Two', 'officer')");
});

beforeEach(async () => {
  await execute(db(), 'DELETE FROM hr_benefits');
});

const post = (app: ReturnType<typeof appAs>, body: unknown) => app.request(
  '/hr/benefits',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  env as unknown as Record<string, unknown>,
);

const VALID = {
  officer_id: 2, benefit_type: 'health', plan_name: 'Gold PPO', provider: 'Acme Health',
  coverage_level: 'family', employee_cost: 120.5, employer_cost: 430.25,
  effective_date: '2026-08-01',
};

describe('POST /hr/benefits', () => {
  it('creates a benefit row and echoes its id', async () => {
    const res = await post(appAs('manager'), VALID);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.id).toBeTruthy();

    const row = await db().prepare('SELECT * FROM hr_benefits WHERE id = ?').bind(body.id).first() as any;
    expect(row.officer_id).toBe(2);
    expect(row.plan_name).toBe('Gold PPO');
    expect(row.coverage_level).toBe('family');
    expect(row.employee_cost).toBeCloseTo(120.5);
    expect(row.status).toBe('active');
    expect(row.created_by).toBe(1);
  });

  it('rejects an unknown benefit_type instead of writing it', async () => {
    const res = await post(appAs('manager'), { ...VALID, benefit_type: 'crypto_stipend' });
    expect(res.status).toBe(400);
    const n = await db().prepare('SELECT COUNT(*) AS n FROM hr_benefits').first() as { n: number };
    expect(n.n).toBe(0);
  });

  it('rejects an unknown coverage_level', async () => {
    const res = await post(appAs('manager'), { ...VALID, coverage_level: 'entire_precinct' });
    expect(res.status).toBe(400);
  });

  it('rejects a negative employee_cost', async () => {
    const res = await post(appAs('manager'), { ...VALID, employee_cost: -5 });
    expect(res.status).toBe(400);
  });

  it('requires officer_id', async () => {
    const { officer_id, ...noOfficer } = VALID;
    const res = await post(appAs('manager'), noOfficer);
    expect(res.status).toBe(400);
  });

  it('is manager-only — an officer cannot enrol anyone', async () => {
    const res = await post(appAs('officer', 2), VALID);
    expect(res.status).toBe(403);
    const n = await db().prepare('SELECT COUNT(*) AS n FROM hr_benefits').first() as { n: number };
    expect(n.n).toBe(0);
  });
});

describe('GET /hr/benefits', () => {
  it('returns the enrolment with the officer name joined', async () => {
    await post(appAs('manager'), VALID);
    const res = await appAs('manager').request('/hr/benefits', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const rows = await res.json() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].officer_name).toBe('Officer Two');
    expect(rows[0].benefit_type).toBe('health');
  });

  it('scopes a non-manager to their OWN enrolment only', async () => {
    await post(appAs('manager'), VALID);                       // officer 2
    await post(appAs('manager'), { ...VALID, officer_id: 1 }); // officer 1

    const own = await appAs('officer', 2).request('/hr/benefits', {}, env as unknown as Record<string, unknown>);
    const ownRows = await own.json() as any[];
    expect(ownRows).toHaveLength(1);
    expect(ownRows[0].officer_id).toBe(2);

    const all = await appAs('manager').request('/hr/benefits', {}, env as unknown as Record<string, unknown>);
    expect((await all.json() as any[])).toHaveLength(2);
  });

  it('filters by benefit_type for managers', async () => {
    await post(appAs('manager'), VALID);
    await post(appAs('manager'), { ...VALID, benefit_type: 'dental' });
    const res = await appAs('manager').request('/hr/benefits?benefit_type=dental', {}, env as unknown as Record<string, unknown>);
    const rows = await res.json() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].benefit_type).toBe('dental');
  });
});
