// test-workers/forensicsTemplates.test.ts
//
// Route-level test for applying a report template to a case. Confirms
// the template's `sections` JSON is copied onto
// forensic_cases.report_sections, which generateForensicCasePdf() (client-
// side, not tested here) reads to render a structured layout.
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
    status TEXT NOT NULL DEFAULT 'received', report_sections TEXT, updated_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_report_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, case_type TEXT,
    sections TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL, exhibit_id INTEGER,
    action TEXT NOT NULL, details TEXT, performed_by INTEGER, performed_by_name TEXT,
    performed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Examiner', 'admin')`);
  await execute(db, `INSERT INTO forensic_cases (id, lab_number, title) VALUES (1, 'LAB-26-0004', 'Template Test Case')`);
  await execute(db, `INSERT INTO forensic_report_templates (id, name, sections) VALUES (1, 'Standard DNA Report', '[{"key":"summary","label":"Case Summary"}]')`);
});

describe('POST /:caseId/apply-template', () => {
  it('copies the template sections onto the case', async () => {
    const res = await app.request('/api/forensic-lab/1/apply-template', {
      method: 'POST', body: JSON.stringify({ template_id: 1 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { report_sections: string } };
    expect(JSON.parse(body.data.report_sections)).toEqual([{ key: 'summary', label: 'Case Summary' }]);
  });

  it('404s for an unknown template', async () => {
    const res = await app.request('/api/forensic-lab/1/apply-template', {
      method: 'POST', body: JSON.stringify({ template_id: 999 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(404);
  });
});
