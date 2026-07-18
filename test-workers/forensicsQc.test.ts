// test-workers/forensicsQc.test.ts
//
// Route-level test for the QC workflow. Previously /qc-check wrote a
// JSON-stringified blob into the generic activity_log table and
// /qc-history read it back — the frontend's `details?.includes('PASS')`
// check never matched the JSON, so QC results always rendered as FAIL.
// This proves the new forensic_qc_checks-backed endpoints round-trip a
// structured pass/fail correctly.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import forensics from '../src/routes/forensics';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-examiner' });
  c.set('userId', 1);
  await next();
});
app.route('/api/forensic-lab', forensics);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT, role TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lab_number TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'received', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_qc_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL, exhibit_id INTEGER,
    check_type TEXT NOT NULL, reviewer_id INTEGER, reviewer_name TEXT, pass INTEGER NOT NULL DEFAULT 1,
    reviewer_notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL, exhibit_id INTEGER,
    action TEXT NOT NULL, details TEXT, performed_by INTEGER, performed_by_name TEXT,
    performed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Examiner', 'admin')`);
  await execute(db, `INSERT INTO forensic_cases (id, lab_number, title) VALUES (1, 'LAB-26-0003', 'QC Test Case')`);
});

describe('QC workflow', () => {
  it('POST /:id/qc-check records a structured pass/fail', async () => {
    const res = await app.request('/api/forensic-lab/1/qc-check', {
      method: 'POST', body: JSON.stringify({ check_type: 'peer_review', pass: false, reviewer_notes: 'Chain of custody gap on E-002' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { pass: number; check_type: string } };
    expect(body.data.pass).toBe(0);
    expect(body.data.check_type).toBe('peer_review');
  });

  it('GET /:id/qc-history returns the structured record, not a JSON blob', async () => {
    const res = await app.request('/api/forensic-lab/1/qc-history', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ pass: number; reviewer_notes: string }> };
    expect(body.data.length).toBe(1);
    expect(body.data[0].pass).toBe(0);
    expect(body.data[0].reviewer_notes).toBe('Chain of custody gap on E-002');
  });

  it('POST /:id/qc-check is role-gated', async () => {
    const unauthedApp = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
    unauthedApp.use('*', async (c, next) => { c.set('user', { id: 2, role: 'client_viewer', username: 'viewer' }); c.set('userId', 2); await next(); });
    unauthedApp.route('/api/forensic-lab', forensics);
    const res = await unauthedApp.request('/api/forensic-lab/1/qc-check', {
      method: 'POST', body: JSON.stringify({ check_type: 'peer_review', pass: true }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });
});
