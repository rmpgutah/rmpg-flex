import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, executeInChunks } from '../utils/db';
import { denverNowDateExpr } from '../utils/denverTime';

import { log } from '../utils/logger';
// ═══════════════════════════════════════════════════════════════
// CRM backend — leads, proposals, templates, lead-activity, tasks,
// dashboard + reports aggregations. Backed by live D1 tables
// (crm_leads / crm_lead_activity / crm_proposals /
// crm_proposal_templates / crm_tasks / crm_activity) created this pass,
// plus the pre-existing clients / client_contracts tables.
//
// Every handler is wrapped in try/catch and returns the same null-safe
// shape on error that the old stubs returned, so a transient DB issue
// degrades to "empty" rather than a 500 that breaks the page.
//
// Firecrawl + scraper-source endpoints stay stubbed — those are an
// external-integration (Firecrawl API) concern, not local data flow.
// ═══════════════════════════════════════════════════════════════

const crm = new Hono<Env>();

/** Best-effort current-user id for created_by columns (claim name varies). */
function actorId(c: { get: (k: 'user') => any }): number | null {
  const u = c.get('user');
  const v = u?.user_id ?? u?.userId ?? u?.id ?? null;
  return v == null ? null : (Number(v) || null);
}

// ── Dashboard / overview ─────────────────────────────────────────
crm.get('/dashboard', async (c) => {
  const empty = { active_clients: 0, total_clients: 0, outstanding_revenue: 0, overdue_invoices: 0, pending_tasks: 0, expiring_contracts: 0, total_invoiced_mtd: 0, total_paid_mtd: 0 };
  try {
    const db = getDb(c.env);
    const cl = await queryFirst<{ total: number; active: number; outstanding: number; invoiced: number; paid: number }>(db,
      "SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END),0) active, COALESCE(SUM(outstanding_balance),0) outstanding, COALESCE(SUM(total_invoiced),0) invoiced, COALESCE(SUM(total_paid),0) paid FROM clients");
    const tasks = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) n FROM crm_tasks WHERE status != 'completed'");
    const expiring = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) n FROM client_contracts WHERE end_date IS NOT NULL AND date(end_date) BETWEEN date('now') AND date('now','+60 days') AND status='active'");
    return c.json({
      active_clients: cl?.active ?? 0,
      total_clients: cl?.total ?? 0,
      outstanding_revenue: cl?.outstanding ?? 0,
      overdue_invoices: 0,
      pending_tasks: tasks?.n ?? 0,
      expiring_contracts: expiring?.n ?? 0,
      total_invoiced_mtd: cl?.invoiced ?? 0,
      total_paid_mtd: cl?.paid ?? 0,
    });
  } catch { return c.json(empty); }
});

crm.get('/recent-activity', async (c) => {
  try {
    const db = getDb(c.env);
    return c.json(await query(db,
      "SELECT a.*, l.business_name AS lead_name FROM crm_lead_activity a LEFT JOIN crm_leads l ON l.id = a.lead_id ORDER BY a.created_at DESC, a.id DESC LIMIT 25"));
  } catch { return c.json([]); }
});

crm.get('/expiring-contracts', async (c) => {
  try {
    const db = getDb(c.env);
    return c.json(await query(db,
      "SELECT cc.*, cl.name AS client_name FROM client_contracts cc LEFT JOIN clients cl ON cl.id = cc.client_id WHERE cc.end_date IS NOT NULL AND date(cc.end_date) BETWEEN date('now') AND date('now','+90 days') ORDER BY cc.end_date"));
  } catch { return c.json([]); }
});

crm.get('/pipeline-summary', async (c) => {
  try {
    const db = getDb(c.env);
    const stages = await query(db, "SELECT pipeline_stage AS stage, COUNT(*) count, COALESCE(SUM(estimated_value),0) total_value FROM crm_leads GROUP BY pipeline_stage");
    return c.json({ stages, conversions: [] });
  } catch { return c.json({ stages: [], conversions: [] }); }
});

crm.get('/revenue-forecast', async (c) => {
  try {
    const db = getDb(c.env);
    const won = await queryFirst<{ v: number }>(db, "SELECT COALESCE(SUM(total_value),0) v FROM crm_proposals WHERE stage='accepted'");
    const pipeline = await queryFirst<{ v: number; n: number }>(db, "SELECT COALESCE(SUM(total_value),0) v, COUNT(*) n FROM crm_proposals WHERE stage IN ('draft','sent','viewed')");
    const expected = await queryFirst<{ v: number }>(db, "SELECT COALESCE(SUM(estimated_value),0) v FROM crm_leads WHERE pipeline_stage IN ('qualified','proposal','negotiation')");
    return c.json({ won_revenue: won?.v ?? 0, total_expected: expected?.v ?? 0, total_pipeline: pipeline?.v ?? 0, active_deals: pipeline?.n ?? 0 });
  } catch { return c.json({ won_revenue: 0, total_expected: 0, total_pipeline: 0, active_deals: 0 }); }
});

crm.get('/contacts', async (c) => {
  try {
    const db = getDb(c.env);
    return c.json(await query(db, "SELECT id AS client_id, name, contact_name, contact_email, contact_phone, status FROM clients ORDER BY name"));
  } catch { return c.json([]); }
});

// ── Tasks ────────────────────────────────────────────────────────
crm.get('/tasks', async (c) => {
  try {
    const db = getDb(c.env);
    // Honor the client's status filter (comma-separated). Only exclude completed
    // by default (no param); selecting Completed/Cancelled/All must work.
    // Allowlist against the known crm_tasks statuses (mirrors the ARCHIVABLE
    // pattern in dispatch/calls.ts archive-bulk) so an attacker-supplied CSV
    // can't inflate the IN() list or bind arbitrary values.
    const VALID_TASK_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
    const statuses = (c.req.query('status') || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => VALID_TASK_STATUSES.includes(s))
      .slice(0, VALID_TASK_STATUSES.length);
    if (statuses.length) {
      const placeholders = statuses.map(() => '?').join(',');
      return c.json(await query(db,
        `SELECT * FROM crm_tasks WHERE status IN (${placeholders}) ORDER BY (due_date IS NULL), due_date, id DESC`,
        ...statuses));
    }
    return c.json(await query(db, "SELECT * FROM crm_tasks WHERE status != 'completed' ORDER BY (due_date IS NULL), due_date, id DESC"));
  } catch (e) {
    log.error('GET /tasks failed', { src: 'src/routes/crm.ts', status: c.req.query('status') ?? null }, e);
    return c.json({ error: 'Failed to load tasks' }, 500);
  }
});
crm.post('/tasks', async (c) => {
  try {
    const db = getDb(c.env); const b = await c.req.json<Record<string, any>>();
    const r = await execute(db, "INSERT INTO crm_tasks (client_id, lead_id, title, description, task_type, due_date, priority, status, assigned_to, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
      b.client_id ?? null, b.lead_id ?? null, b.title ?? null, b.description ?? null, b.task_type ?? 'follow_up', b.due_date ?? null, b.priority ?? 'normal', b.status ?? 'pending', b.assigned_to ?? null, actorId(c));
    return c.json({ id: r.meta.last_row_id }, 201);
  } catch (e) {
    log.error('POST /tasks failed', { src: 'src/routes/crm.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});
crm.put('/tasks/:id', async (c) => {
  try {
    const db = getDb(c.env); const id = Number(c.req.param('id')); const b = await c.req.json<Record<string, any>>();
    const cols: string[] = []; const vals: unknown[] = [];
    for (const k of ['title', 'description', 'task_type', 'due_date', 'priority', 'status', 'assigned_to', 'completed_at']) if (k in b) { cols.push(`${k} = ?`); vals.push(b[k]); }
    if (b.status === 'completed' && !('completed_at' in b)) { cols.push("completed_at = datetime('now')"); }
    if (!cols.length) return c.json({});
    vals.push(id);
    await execute(db, `UPDATE crm_tasks SET ${cols.join(', ')} WHERE id = ?`, ...vals);
    return c.json({ success: true });
  } catch (e) {
    log.error('PUT /tasks/:id failed', { src: 'src/routes/crm.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});
crm.delete('/tasks/:id', async (c) => {
  try { const db = getDb(c.env); await execute(db, 'DELETE FROM crm_tasks WHERE id = ?', Number(c.req.param('id'))); return c.json({ success: true }); }
  catch (e) {
    log.error('DELETE /tasks/:id failed', { src: 'src/routes/crm.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

crm.post('/activity', async (c) => {
  try {
    const db = getDb(c.env); const b = await c.req.json<Record<string, any>>();
    const r = await execute(db, "INSERT INTO crm_activity (client_id, lead_id, activity_type, subject, details, created_by) VALUES (?,?,?,?,?,?)",
      b.client_id ?? null, b.lead_id ?? null, b.activity_type ?? 'note', b.subject ?? null, b.details ?? null, actorId(c));
    return c.json({ id: r.meta.last_row_id }, 201);
  } catch (e) {
    log.error('POST /activity failed', { src: 'src/routes/crm.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});
crm.get('/activity/:clientId', async (c) => {
  try { const db = getDb(c.env); return c.json(await query(db, 'SELECT * FROM crm_activity WHERE client_id = ? ORDER BY created_at DESC, id DESC', Number(c.req.param('clientId')))); }
  catch { return c.json([]); }
});

// ── Leads ────────────────────────────────────────────────────────
// Static sub-paths registered BEFORE param routes so Hono doesn't
// swallow them as a :id.
crm.get('/leads/pipeline-summary', async (c) => {
  try {
    const db = getDb(c.env);
    return c.json(await query(db, "SELECT pipeline_stage AS stage, COUNT(*) count, COALESCE(SUM(estimated_value),0) total_value FROM crm_leads GROUP BY pipeline_stage"));
  } catch { return c.json([{ stage: 'new', count: 0, total_value: 0 }]); }
});
crm.get('/leads/follow-ups', async (c) => {
  try {
    const db = getDb(c.env);
    const overdue = await query(db, "SELECT * FROM crm_leads WHERE next_follow_up IS NOT NULL AND date(next_follow_up) < date('now') AND pipeline_stage NOT IN ('won','lost','dismissed') ORDER BY next_follow_up");
    const today = await query(db, `SELECT * FROM crm_leads WHERE next_follow_up IS NOT NULL AND date(next_follow_up) = ${denverNowDateExpr()} AND pipeline_stage NOT IN ('won','lost','dismissed') ORDER BY next_follow_up`);
    const upcoming = await query(db, "SELECT * FROM crm_leads WHERE next_follow_up IS NOT NULL AND date(next_follow_up) BETWEEN date('now','+1 day') AND date('now','+14 days') AND pipeline_stage NOT IN ('won','lost','dismissed') ORDER BY next_follow_up");
    return c.json({ overdue, today, upcoming });
  } catch { return c.json({ overdue: [], today: [], upcoming: [] }); }
});
crm.get('/leads/source-analytics', async (c) => {
  try {
    const db = getDb(c.env);
    const days = Number(c.req.query('days')) || 30;
    const data = await query(db,
      `SELECT source, COUNT(*) lead_count, COALESCE(SUM(estimated_value),0) total_value,
              SUM(CASE WHEN pipeline_stage='won' THEN 1 ELSE 0 END) won_count
       FROM crm_leads WHERE created_at >= datetime('now', ?) GROUP BY source ORDER BY lead_count DESC`,
      `-${days} days`);
    return c.json({ period_days: days, data });
  } catch { return c.json({ period_days: 30, data: [] }); }
});

const LEAD_COLS = ['source', 'source_id', 'source_url', 'business_name', 'industry', 'sic_code', 'business_type', 'contact_name', 'contact_email', 'contact_phone', 'contact_title', 'address', 'city', 'state', 'zip', 'latitude', 'longitude', 'estimated_value', 'permit_number', 'registration_date', 'license_number', 'project_type', 'property_size', 'pipeline_stage', 'lead_score', 'assigned_to', 'client_id', 'proposal_id', 'notes', 'service_interest', 'lost_reason', 'next_follow_up'];

crm.get('/leads', async (c) => {
  try {
    const db = getDb(c.env);
    const source = c.req.query('source'); const stage = c.req.query('pipeline_stage');
    const where: string[] = []; const p: unknown[] = [];
    if (source) { where.push('source = ?'); p.push(source); }
    if (stage) { where.push('pipeline_stage = ?'); p.push(stage); }
    const sql = `SELECT * FROM crm_leads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id DESC LIMIT 2000`;
    return c.json(await query(db, sql, ...p));
  } catch { return c.json([]); }
});

crm.post('/leads', async (c) => {
  try {
    const db = getDb(c.env); const b = await c.req.json<Record<string, any>>();
    if (!b.business_name) return c.json({ error: 'business_name required' }, 400);
    const r = await execute(db,
      `INSERT INTO crm_leads (source, source_id, source_url, business_name, industry, sic_code, business_type, contact_name, contact_email, contact_phone, contact_title, address, city, state, zip, latitude, longitude, estimated_value, permit_number, registration_date, license_number, project_type, property_size, pipeline_stage, lead_score, assigned_to, notes, service_interest, next_follow_up)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      b.source ?? 'manual', b.source_id ?? null, b.source_url ?? null, b.business_name, b.industry ?? null, b.sic_code ?? null, b.business_type ?? null,
      b.contact_name ?? null, b.contact_email ?? null, b.contact_phone ?? null, b.contact_title ?? null, b.address ?? null, b.city ?? null, b.state ?? 'UT', b.zip ?? null,
      b.latitude ?? null, b.longitude ?? null, b.estimated_value ?? null, b.permit_number ?? null, b.registration_date ?? null, b.license_number ?? null,
      b.project_type ?? null, b.property_size ?? null, b.pipeline_stage ?? 'new', b.lead_score ?? 0, b.assigned_to ?? null, b.notes ?? null, b.service_interest ?? null, b.next_follow_up ?? null);
    return c.json(await queryFirst(db, 'SELECT * FROM crm_leads WHERE id = ?', r.meta.last_row_id), 201);
  } catch (e) {
    log.error('POST /leads failed', { src: 'src/routes/crm.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

crm.put('/leads/:id/stage', async (c) => {
  try {
    const db = getDb(c.env); const id = Number(c.req.param('id')); const b = await c.req.json<Record<string, any>>();
    const stage = b.stage ?? b.pipeline_stage;
    if (!stage) return c.json({ error: 'stage required' }, 400);
    const prev = await queryFirst<{ pipeline_stage: string }>(db, 'SELECT pipeline_stage FROM crm_leads WHERE id = ?', id);
    await execute(db, "UPDATE crm_leads SET pipeline_stage = ?, lost_reason = COALESCE(?, lost_reason), updated_at = datetime('now') WHERE id = ?", stage, b.lost_reason ?? null, id);
    await execute(db, "INSERT INTO crm_lead_activity (lead_id, activity_type, subject, old_value, new_value, created_by) VALUES (?,?,?,?,?,?)",
      id, 'stage_change', 'Pipeline stage changed', prev?.pipeline_stage ?? null, stage, actorId(c));
    return c.json({ success: true });
  } catch (e) {
    log.error('PUT /leads/:id/stage failed', { src: 'src/routes/crm.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

crm.post('/leads/:id/convert', async (c) => {
  try {
    const db = getDb(c.env); const id = Number(c.req.param('id'));
    const lead = await queryFirst<Record<string, any>>(db, 'SELECT * FROM crm_leads WHERE id = ?', id);
    if (!lead) return c.json({ error: 'Lead not found' }, 404);
    if (lead.client_id) return c.json({ client_id: lead.client_id, already_converted: true });
    const r = await execute(db,
      "INSERT INTO clients (name, contact_name, contact_email, contact_phone, address, status, notes, client_since) VALUES (?,?,?,?,?,'active',?,datetime('now'))",
      lead.business_name, lead.contact_name ?? null, lead.contact_email ?? null, lead.contact_phone ?? null, lead.address ?? null, lead.notes ?? null);
    const clientId = r.meta.last_row_id;
    await execute(db, "UPDATE crm_leads SET client_id = ?, pipeline_stage = 'won', updated_at = datetime('now') WHERE id = ?", clientId, id);
    await execute(db, "INSERT INTO crm_lead_activity (lead_id, activity_type, subject, new_value, created_by) VALUES (?,?,?,?,?)",
      id, 'converted', 'Lead converted to client', String(clientId), actorId(c));
    return c.json({ client_id: clientId });
  } catch (e) {
    log.error('POST /leads/:id/convert failed', { src: 'src/routes/crm.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

crm.post('/leads/bulk-action', async (c) => {
  try {
    const db = getDb(c.env); const b = await c.req.json<{ action?: string; lead_ids?: number[]; ids?: number[]; value?: any }>();
    const ids = (b.lead_ids ?? b.ids ?? []).map(Number).filter(Boolean);
    if (!ids.length) return c.json({ updated: 0 });
    // lead_ids is caller-supplied and unbounded — a bulk action over 100+ leads
    // exceeds D1's 100-bound-parameter cap and throws at BIND time. The 'assign'
    // branch also binds assigned_to ahead of the IN-list, so that leading
    // parameter is declared and counted against the per-chunk budget.
    if (b.action === 'mark_contacted') await executeInChunks(db, ids, (ph) => `UPDATE crm_leads SET pipeline_stage='contacted', updated_at=datetime('now') WHERE id IN (${ph})`);
    else if (b.action === 'dismiss') await executeInChunks(db, ids, (ph) => `UPDATE crm_leads SET pipeline_stage='dismissed', updated_at=datetime('now') WHERE id IN (${ph})`);
    else if (b.action === 'delete') await executeInChunks(db, ids, (ph) => `DELETE FROM crm_leads WHERE id IN (${ph})`);
    else if (b.action === 'assign') await executeInChunks(db, ids, (ph) => `UPDATE crm_leads SET assigned_to=?, updated_at=datetime('now') WHERE id IN (${ph})`, [b.value ?? null]);
    return c.json({ updated: ids.length });
  } catch (e) {
    log.error('POST /leads/bulk-action failed', { src: 'src/routes/crm.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

crm.put('/leads/:id', async (c) => {
  try {
    const db = getDb(c.env); const id = Number(c.req.param('id')); const b = await c.req.json<Record<string, any>>();
    const cols: string[] = []; const vals: unknown[] = [];
    for (const k of LEAD_COLS) if (k in b) { cols.push(`${k} = ?`); vals.push(b[k]); }
    if (!cols.length) return c.json({ error: 'No fields to update' }, 400);
    cols.push("updated_at = datetime('now')"); vals.push(id);
    await execute(db, `UPDATE crm_leads SET ${cols.join(', ')} WHERE id = ?`, ...vals);
    return c.json(await queryFirst(db, 'SELECT * FROM crm_leads WHERE id = ?', id));
  } catch (e) {
    log.error('PUT /leads/:id failed', { src: 'src/routes/crm.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

crm.get('/lead-activity/:leadId', async (c) => {
  try { const db = getDb(c.env); return c.json(await query(db, 'SELECT * FROM crm_lead_activity WHERE lead_id = ? ORDER BY created_at DESC, id DESC', Number(c.req.param('leadId')))); }
  catch { return c.json([]); }
});
crm.post('/lead-activity', async (c) => {
  try {
    const db = getDb(c.env); const b = await c.req.json<Record<string, any>>();
    const r = await execute(db, "INSERT INTO crm_lead_activity (lead_id, activity_type, subject, details, created_by) VALUES (?,?,?,?,?)",
      b.lead_id, b.activity_type ?? 'note', b.subject ?? null, b.details ?? null, actorId(c));
    return c.json({ id: r.meta.last_row_id }, 201);
  } catch (e) {
    log.error('POST /lead-activity failed', { src: 'src/routes/crm.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

// ── Proposals ────────────────────────────────────────────────────
const PROPOSAL_COLS = ['proposal_number', 'lead_id', 'client_id', 'title', 'template_type', 'description', 'scope_of_work', 'terms', 'monthly_value', 'total_value', 'billing_frequency', 'valid_until', 'proposed_start', 'proposed_end', 'contract_length_months', 'stage', 'rejection_reason', 'assigned_to', 'notes', 'pdf_path'];

crm.get('/proposal-templates', async (c) => {
  try { const db = getDb(c.env); return c.json(await query(db, 'SELECT * FROM crm_proposal_templates WHERE is_active = 1 ORDER BY name')); }
  catch { return c.json([]); }
});

crm.get('/proposals', async (c) => {
  try {
    const db = getDb(c.env);
    return c.json(await query(db,
      "SELECT p.*, c.name AS client_name, l.business_name AS lead_name FROM crm_proposals p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN crm_leads l ON l.id = p.lead_id ORDER BY p.created_at DESC, p.id DESC"));
  } catch { return c.json([]); }
});

crm.post('/proposals', async (c) => {
  try {
    const db = getDb(c.env); const b = await c.req.json<Record<string, any>>();
    const cnt = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) n FROM crm_proposals');
    const num = b.proposal_number || `PROP-${String((cnt?.n ?? 0) + 1).padStart(4, '0')}`;
    const r = await execute(db,
      `INSERT INTO crm_proposals (proposal_number, lead_id, client_id, title, template_type, description, scope_of_work, terms, monthly_value, total_value, billing_frequency, valid_until, proposed_start, proposed_end, contract_length_months, stage, assigned_to, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      num, b.lead_id ?? null, b.client_id ?? null, b.title ?? null, b.template_type ?? null, b.description ?? null, b.scope_of_work ?? null, b.terms ?? null,
      b.monthly_value ?? 0, b.total_value ?? 0, b.billing_frequency ?? 'monthly', b.valid_until ?? null, b.proposed_start ?? null, b.proposed_end ?? null,
      b.contract_length_months ?? null, b.stage ?? 'draft', b.assigned_to ?? null, b.notes ?? null, actorId(c));
    return c.json(await queryFirst(db, 'SELECT * FROM crm_proposals WHERE id = ?', r.meta.last_row_id), 201);
  } catch (e) {
    log.error('POST /proposals failed', { src: 'src/routes/crm.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

crm.put('/proposals/:id/stage', async (c) => {
  try {
    const db = getDb(c.env); const id = Number(c.req.param('id')); const b = await c.req.json<Record<string, any>>();
    const stage = b.stage;
    if (!stage) return c.json({ error: 'stage required' }, 400);
    // Stamp the matching lifecycle timestamp when a stage is entered.
    const stamp: Record<string, string> = { sent: 'sent_at', viewed: 'viewed_at', accepted: 'accepted_at', rejected: 'rejected_at' };
    const extra = stamp[stage] ? `, ${stamp[stage]} = datetime('now')` : '';
    await execute(db, `UPDATE crm_proposals SET stage = ?, rejection_reason = COALESCE(?, rejection_reason), updated_at = datetime('now')${extra} WHERE id = ?`,
      stage, b.rejection_reason ?? null, id);
    return c.json({ success: true });
  } catch (e) {
    log.error('PUT /proposals/:id/stage failed', { src: 'src/routes/crm.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

crm.put('/proposals/:id', async (c) => {
  try {
    const db = getDb(c.env); const id = Number(c.req.param('id')); const b = await c.req.json<Record<string, any>>();
    const cols: string[] = []; const vals: unknown[] = [];
    for (const k of PROPOSAL_COLS) if (k in b) { cols.push(`${k} = ?`); vals.push(b[k]); }
    if (!cols.length) return c.json({ error: 'No fields to update' }, 400);
    cols.push("updated_at = datetime('now')"); vals.push(id);
    await execute(db, `UPDATE crm_proposals SET ${cols.join(', ')} WHERE id = ?`, ...vals);
    return c.json(await queryFirst(db, 'SELECT * FROM crm_proposals WHERE id = ?', id));
  } catch (e) {
    log.error('PUT /proposals/:id failed', { src: 'src/routes/crm.ts' }, e); return c.json({ error: 'Failed', detail: (e as Error)?.message }, 500); }
});

crm.get('/proposals/:id', async (c) => {
  try {
    const db = getDb(c.env);
    return c.json(await queryFirst(db,
      "SELECT p.*, c.name AS client_name, l.business_name AS lead_name FROM crm_proposals p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN crm_leads l ON l.id = p.lead_id WHERE p.id = ?", Number(c.req.param('id'))) ?? {});
  } catch { return c.json({}); }
});

// ── Reports ──────────────────────────────────────────────────────
crm.get('/reports/metrics', async (c) => {
  const empty = { total_pipeline_value: 0, win_rate: 0, avg_cycle_days: 0, leads_this_month: 0, proposals_sent: 0, proposals_accepted: 0 };
  try {
    const db = getDb(c.env);
    const pipeline = await queryFirst<{ v: number }>(db, "SELECT COALESCE(SUM(estimated_value),0) v FROM crm_leads WHERE pipeline_stage NOT IN ('won','lost','dismissed')");
    const wl = await queryFirst<{ won: number; lost: number }>(db, "SELECT SUM(CASE WHEN pipeline_stage='won' THEN 1 ELSE 0 END) won, SUM(CASE WHEN pipeline_stage='lost' THEN 1 ELSE 0 END) lost FROM crm_leads");
    const month = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) n FROM crm_leads WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m','now')");
    const props = await queryFirst<{ sent: number; accepted: number; cycle: number }>(db,
      "SELECT SUM(CASE WHEN stage IN ('sent','viewed','accepted','rejected') THEN 1 ELSE 0 END) sent, SUM(CASE WHEN stage='accepted' THEN 1 ELSE 0 END) accepted, AVG(CASE WHEN accepted_at IS NOT NULL THEN julianday(accepted_at)-julianday(created_at) END) cycle FROM crm_proposals");
    const won = wl?.won ?? 0, lost = wl?.lost ?? 0;
    return c.json({
      total_pipeline_value: pipeline?.v ?? 0,
      win_rate: (won + lost) > 0 ? Math.round((won / (won + lost)) * 100) : 0,
      avg_cycle_days: props?.cycle ? Math.round(props.cycle) : 0,
      leads_this_month: month?.n ?? 0,
      proposals_sent: props?.sent ?? 0,
      proposals_accepted: props?.accepted ?? 0,
    });
  } catch { return c.json(empty); }
});
crm.get('/reports/revenue', async (c) => {
  try {
    const db = getDb(c.env);
    return c.json(await query(db,
      "SELECT strftime('%Y-%m', accepted_at) AS month, COALESCE(SUM(total_value),0) total FROM crm_proposals WHERE stage='accepted' AND accepted_at IS NOT NULL GROUP BY month ORDER BY month"));
  } catch { return c.json([]); }
});
crm.get('/reports/pipeline', async (c) => {
  try {
    const db = getDb(c.env);
    const stages = await query(db, "SELECT pipeline_stage AS stage, COUNT(*) count, COALESCE(SUM(estimated_value),0) total_value FROM crm_leads GROUP BY pipeline_stage");
    return c.json({ stages });
  } catch { return c.json({ stages: [] }); }
});
crm.get('/reports/retention', async (c) => {
  try { const db = getDb(c.env); return c.json(await query(db, "SELECT status, COUNT(*) count FROM clients GROUP BY status")); }
  catch { return c.json([]); }
});
crm.get('/reports/lead-source-roi', async (c) => {
  try {
    const db = getDb(c.env);
    return c.json(await query(db,
      "SELECT source, COUNT(*) leads, SUM(CASE WHEN pipeline_stage='won' THEN 1 ELSE 0 END) won, COALESCE(SUM(estimated_value),0) pipeline_value FROM crm_leads GROUP BY source ORDER BY leads DESC"));
  } catch { return c.json([]); }
});

// ── Firecrawl + scraper sources — external integration, still stubbed ──
crm.get('/firecrawl/status', (c) => c.json({ connected: false }));
crm.get('/firecrawl/saved-searches', (c) => c.json([]));
crm.get('/firecrawl/search-history', (c) => c.json([]));
crm.get('/firecrawl/monitors', (c) => c.json([]));
crm.get('/firecrawl/monitors/:id/changes', (c) => c.json([]));
crm.post('/firecrawl/search', (c) => c.json({ results: [] }));
crm.post('/firecrawl/scrape', (c) => c.json({}));
crm.post('/firecrawl/import', (c) => c.json({ id: 0 }, 201));
crm.post('/firecrawl/import-bulk', (c) => c.json({ imported: 0, skipped: 0 }));
crm.post('/firecrawl/saved-searches', (c) => c.json({ id: 0 }, 201));
crm.post('/firecrawl/monitors', (c) => c.json({ id: 0 }, 201));
crm.post('/firecrawl/monitors/:id/check', (c) => c.json({}));
crm.post('/firecrawl/monitors/changes/:id/acknowledge', (c) => c.json({}));
crm.delete('/firecrawl/monitors/:id', (c) => c.json({}));

crm.get('/scrape-sources', (c) => c.json([]));
crm.get('/scrape-log', (c) => c.json([]));
crm.put('/scrape-sources/:key', (c) => c.json({}));
crm.post('/scrape-sources/:key/poll-now', (c) => c.json({}));

export default crm;
