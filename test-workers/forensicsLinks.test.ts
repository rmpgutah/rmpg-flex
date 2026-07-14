// test-workers/forensicsLinks.test.ts
//
// Route-level test for forensic case cross-links: search, create, list,
// delete. Mirrors the request/response contract of GET /records/search
// (src/routes/records.ts:2003) so the ForensicLabPage Links tab's search
// bar behaves identically to LinkRecordModal elsewhere in the app.
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
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_case_entity_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL,
    entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, entity_label TEXT,
    relationship TEXT NOT NULL DEFAULT 'related', linked_by INTEGER, linked_by_name TEXT,
    linked_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL, exhibit_id INTEGER,
    action TEXT NOT NULL, details TEXT, performed_by INTEGER, performed_by_name TEXT,
    performed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT, phone TEXT
  )`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Examiner', 'admin')`);
  await execute(db, `INSERT INTO forensic_cases (id, lab_number, title) VALUES (1, 'LAB-26-0002', 'Link Test Case')`);
  await execute(db, `INSERT INTO persons (id, first_name, last_name, phone) VALUES (1, 'Jane', 'Doe', '555-0100')`);
});

describe('Forensic case links', () => {
  it('GET /:caseId/links/search?type=person&q= returns a labeled result', async () => {
    const res = await app.request('/api/forensic-lab/1/links/search?type=person&q=Doe', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: number; label: string }>;
    expect(body.length).toBe(1);
    expect(body[0].label).toBe('Doe, Jane');
  });

  it('POST /:caseId/links creates a link with a server-resolved label', async () => {
    const res = await app.request('/api/forensic-lab/1/links', {
      method: 'POST', body: JSON.stringify({ entity_type: 'person', entity_id: 1, relationship: 'suspect' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { entity_label: string; relationship: string } };
    expect(body.data.entity_label).toBe('Doe, Jane');
    expect(body.data.relationship).toBe('suspect');
  });

  it('GET /:caseId/links lists the created link', async () => {
    const res = await app.request('/api/forensic-lab/1/links', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as Array<{ id: number }>;
    expect(body.length).toBe(1);
  });

  it('DELETE /:caseId/links/:linkId removes it', async () => {
    const listRes = await app.request('/api/forensic-lab/1/links', {}, env as unknown as Record<string, unknown>);
    const [link] = await listRes.json() as Array<{ id: number }>;
    const delRes = await app.request(`/api/forensic-lab/1/links/${link.id}`, { method: 'DELETE' }, env as unknown as Record<string, unknown>);
    expect(delRes.status).toBe(200);
    const listRes2 = await app.request('/api/forensic-lab/1/links', {}, env as unknown as Record<string, unknown>);
    expect(await listRes2.json()).toEqual([]);
  });
});
