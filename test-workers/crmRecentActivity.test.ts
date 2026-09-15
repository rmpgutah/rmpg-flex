// test-workers/crmRecentActivity.test.ts
// ============================================================
// GET /api/crm/recent-activity previously only queried crm_lead_activity
// (pipeline stage-change / conversion events), joined to crm_leads for a
// `lead_name`. The CRM dashboard's "Recent Activity" card reads
// `a.client_name`, which that query never produced, so every row rendered
// as "Unknown" — and client-scoped activity logged via POST /crm/activity
// (crm_activity table) never appeared in the feed at all, since the query
// didn't touch that table.
//
// Fix: recent-activity now UNIONs crm_lead_activity (-> lead_name) and
// crm_activity (-> client_name or lead_name depending on which FK is set).
// This pins that both activity kinds surface with the correct name field.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import crm from '../src/routes/crm';

type TestUser = { id: number; role: string; username: string };

function appWithUser(user: TestUser) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: TestUser } }>();
  app.use('*', async (c, next) => { c.set('user', user); await next(); });
  app.route('/api/crm', crm);
  return app;
}

async function call(path: string) {
  const app = appWithUser({ id: 5172, role: 'admin', username: 'chzamo' });
  const res = await app.request(path, { method: 'GET' }, env as unknown as Record<string, unknown>);
  return { res, body: await res.json() as any };
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS crm_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, business_name TEXT NOT NULL,
    pipeline_stage TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active'
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS crm_lead_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, activity_type TEXT NOT NULL,
    subject TEXT, old_value TEXT, new_value TEXT, created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS crm_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER, lead_id INTEGER, activity_type TEXT NOT NULL,
    subject TEXT, details TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
});

describe('GET /api/crm/recent-activity', () => {
  it('surfaces both lead-pipeline events (lead_name) and client-logged activity (client_name)', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;

    const lead = await db.prepare(
      "INSERT INTO crm_leads (source, business_name, pipeline_stage) VALUES ('manual', 'Acme Test Co', 'new') RETURNING id",
    ).first<{ id: number }>();
    const client = await db.prepare(
      "INSERT INTO clients (name, status) VALUES ('Test Client LLC', 'active') RETURNING id",
    ).first<{ id: number }>();

    await db.prepare(
      "INSERT INTO crm_lead_activity (lead_id, activity_type, subject, old_value, new_value) VALUES (?, 'stage_change', 'Pipeline stage changed', 'new', 'contacted')",
    ).bind(lead!.id).run();
    await db.prepare(
      "INSERT INTO crm_activity (client_id, activity_type, subject) VALUES (?, 'call', 'Follow-up call')",
    ).bind(client!.id).run();

    const { res, body } = await call('/api/crm/recent-activity?limit=25');
    expect(res.status).toBe(200);

    const leadRow = body.find((r: any) => r.subject === 'Pipeline stage changed');
    const clientRow = body.find((r: any) => r.subject === 'Follow-up call');

    expect(leadRow).toBeTruthy();
    expect(leadRow.lead_name).toBe('Acme Test Co');
    expect(leadRow.client_name).toBeFalsy();

    expect(clientRow).toBeTruthy();
    expect(clientRow.client_name).toBe('Test Client LLC');

    // ids from the two source tables must not collide once merged
    expect(leadRow.id).not.toBe(clientRow.id);
  });
});
