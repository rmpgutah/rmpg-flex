// ============================================================
// Regression tests for NOT NULL INSERT bugs (2026-06-06).
// ============================================================
// These four routes were 500-ing in production because their
// INSERT statements omitted NOT NULL columns with no DB default:
//
//   1. POST /api/citations/:id/violations      → missing violation_code
//   2. POST /api/records/properties            → missing is_active
//   3. POST /api/records/businesses            → missing is_active
//   4. POST /api/shift-plans/shift-swaps       → missing created_at
//
// The recordingDb helper captures the SQL + bound args so we
// can assert the column list and the supplied value for each.
// ============================================================

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import citations from '../src/routes/citations';
import records from '../src/routes/records';
import properties from '../src/routes/properties';
import shiftPlans from '../src/routes/shiftPlans';
import type { Env } from '../src/types';
import { recordingDb } from './helpers/fakeD1';

const TEST_USER = { id: 1, username: 'tester', full_name: 'Test Officer', role: 'admin' };
const TEST_JWT_SECRET = 'test-secret-do-not-use-in-prod';

async function authedRequest(db: D1Database, path: string, init?: RequestInit, role: string = 'admin') {
  // Sign a real JWT for the fake user. The in-router authMiddleware
  // (shiftPlans mounts at bare /api so it carries its own) will
  // verify the token, look up the user, and inject `c.var.user`.
  // For routers without their own authMiddleware (citations, records,
  // properties), we inject the user via app.use('*') below so route
  // handlers can read c.get('user').
  const token = await sign(
    { user_id: TEST_USER.id, role, exp: Math.floor(Date.now() / 1000) + 3600 },
    TEST_JWT_SECRET,
  );

  const app = new Hono<Env>();
  // Pre-empt route handlers that call c.get('user') before any
  // in-router authMiddleware runs (e.g. citations, records, properties
  // don't carry their own — they rely on the global app.use loop in
  // src/index.ts which we don't mount in tests).
  app.use('*', async (c, next) => {
    c.set('user', { ...TEST_USER, role });
    await next();
  });
  // Mount more-specific paths first so Hono's trie picks them over
  // the catch-all /api/records (records router swallows everything).
  app.route('/api/citations', citations);
  app.route('/api/records/properties', properties);
  app.route('/api/records', records);
  app.route('/api', shiftPlans);
  return app.request(
    path,
    {
      ...(init ?? {}),
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        authorization: `Bearer ${token}`,
      },
    },
    { DB: db, JWT_SECRET: TEST_JWT_SECRET },
  );
}

const jsonReq = (body: unknown) => ({
  method: 'POST' as const,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

function colIdx(sql: string, col: string): number {
  const cols = sql.match(/INSERT INTO \w+\s*\(([^)]+)\)/)![1].split(',').map((s) => s.trim());
  return cols.indexOf(col);
}

describe('NOT NULL regression tests', () => {
  it('POST /api/citations/:id/violations inserts violation_code', async () => {
    const rec = recordingDb([
      { match: /COALESCE\(MAX\(violation_number\)/, rows: [{ max_num: 0 }] },
      { match: /SELECT id, username, role, full_name, status FROM users/, rows: [{ id: 1, username: 'tester', role: 'admin', full_name: 'Test Officer', status: 'active' }] },
    ]);
    const res = await authedRequest(rec.db, '/api/citations/42/violations', jsonReq({ violation_description: 'Speed 15 over' }));
    expect(res.status).toBe(201);
    const write = rec.calls.find((c) => /INSERT INTO citation_violations/.test(c.sql))!;
    expect(write).toBeDefined();
    expect(write.sql).toMatch(/violation_code/);
    const idx = colIdx(write.sql, 'violation_code');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(write.args[idx]).toBeTruthy();
  });

  it('POST /api/records/properties inserts is_active', async () => {
    const rec = recordingDb([
      { match: /SELECT id, username, role, full_name, status FROM users/, rows: [{ id: 1, username: 'tester', role: 'admin', full_name: 'Test Officer', status: 'active' }] },
    ]);
    const res = await authedRequest(rec.db, '/api/records/properties', jsonReq({ name: '123 Main', address: '123 Main St' }));
    expect(res.status).toBe(201);
    const write = rec.calls.find((c) => /INSERT INTO properties/.test(c.sql))!;
    expect(write).toBeDefined();
    expect(write.sql).toMatch(/is_active/);
    const idx = colIdx(write.sql, 'is_active');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(write.args[idx]).toBe(1);
  });

  it('POST /api/records/businesses writes to the canonical businesses table with created_at', async () => {
    const rec = recordingDb([
      { match: /SELECT id, username, role, full_name, status FROM users/, rows: [{ id: 1, username: 'tester', role: 'admin', full_name: 'Test Officer', status: 'active' }] },
    ]);
    const res = await authedRequest(rec.db, '/api/records/businesses', jsonReq({ name: 'Acme Inc', business_type: 'retail' }));
    expect(res.status).toBe(201);
    // Unified onto the dedicated businesses table (migration 0125), no longer
    // properties. created_at is supplied as a non-null datetime literal so the
    // NOT NULL DEFAULT is always satisfied regardless of the posted body.
    const write = rec.calls.find((c) => /INSERT INTO businesses/.test(c.sql))!;
    expect(write).toBeDefined();
    expect(write.sql).toMatch(/created_at/);
    expect(write.sql).toMatch(/datetime\('now'\)/);
    expect(write.sql).toMatch(/business_type/);
  });

  it('POST /api/shift-plans/shift-swaps inserts created_at', async () => {
    const rec = recordingDb([
      { match: /SELECT id, username, role, full_name, status FROM users/, rows: [{ id: 1, username: 'tester', role: 'admin', full_name: 'Test Officer', status: 'active' }] },
    ]);
    const res = await authedRequest(rec.db, '/api/shift-swaps', jsonReq({ shift_date: '2026-06-07' }));
    expect(res.status).toBe(201);
    const write = rec.calls.find((c) => /INSERT INTO shift_swap_requests/.test(c.sql))!;
    expect(write).toBeDefined();
    // Server should have supplied created_at in the column list AND a
    // non-null default in VALUES (datetime('now','localtime') literal —
    // not a bound ? parameter, so we just assert the SQL has both).
    expect(write.sql).toMatch(/created_at/);
    expect(write.sql).toMatch(/datetime\('now'.*\)/);
  });

  it('POST /api/records/evidence accepts without incident_id (standalone evidence)', async () => {
    const rec = recordingDb([
      { match: /SELECT id, username, role, full_name, status FROM users/, rows: [{ id: 1, username: 'tester', role: 'admin', full_name: 'Test Officer', status: 'active' }] },
      { match: /INSERT INTO evidence/, rows: [] },
    ]);
    const res = await authedRequest(rec.db, '/api/records/evidence', jsonReq({ evidence_type: 'photo', description: 'A photo' }));
    expect(res.status).toBe(201);
  });
});
