import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';

import { dbErrorResponse } from '../utils/dbErrors';
// Mirror CHECK constraints on narcotics_cases from migrations/0048_specialized_modules.sql
// (case_type / status / priority). Keep in sync if the migration moves.
const CASE_TYPES = new Set(['investigation', 'buy_bust', 'ci_management', 'surveillance', 'other']);
const NARC_STATUSES = new Set(['open', 'active', 'closed', 'pending_review']);
const NARC_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

function checkNarcEnum(value: unknown, allowed: Set<string>): boolean {
  if (value === undefined || value === null || value === '') return true;
  return typeof value === 'string' && allowed.has(value);
}

function validateNarcCase(body: any): { ok: true } | { ok: false; field: 'case_type' | 'status' | 'priority' } {
  if (!checkNarcEnum(body.case_type, CASE_TYPES)) return { ok: false, field: 'case_type' };
  if (!checkNarcEnum(body.status, NARC_STATUSES)) return { ok: false, field: 'status' };
  if (!checkNarcEnum(body.priority, NARC_PRIORITIES)) return { ok: false, field: 'priority' };
  return { ok: true };
}

function narcEnumError(field: 'case_type' | 'status' | 'priority') {
  const allowed = Array.from(field === 'case_type' ? CASE_TYPES : field === 'status' ? NARC_STATUSES : NARC_PRIORITIES);
  return { error: `Invalid ${field}`, field, allowed };
}

const narcotics = new Hono<Env>();

// Narcotics cases include ci_management (confidential-informant) records and
// subject names — CJIS-restricted. Gate the whole router to operational roles
// so the external contract_manager / client_viewer cannot read or write them
// (matching intel.ts's `operational` set).
narcotics.use('*', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'));

narcotics.get('/cases', async (c) => {
  try { const db = getDb(c.env); const rows = await query(db, 'SELECT * FROM narcotics_cases ORDER BY created_at DESC LIMIT 200'); return c.json(rows || []); }
  catch (err) { return dbErrorResponse(c, err, 'Failed to fetch narcotics cases'); }
});

narcotics.post('/cases', async (c) => {
  try { const actor = c.get('user') as { role: string } | undefined; if (!actor || !new Set(['admin', 'manager', 'supervisor', 'officer']).has(actor.role)) return c.json({ error: 'Forbidden' }, 403); const db = getDb(c.env); const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
    const v = validateNarcCase(body);
    if (!v.ok) return c.json(narcEnumError(v.field), 400);
    const result = await execute(db, 'INSERT INTO narcotics_cases (case_number, case_type, subject_name, location, substance, quantity, street_value, status, priority, officer_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', (body.case_number || (() => { throw new Error("case_number required"); })()), body.case_type || 'investigation', body.subject_name || null, body.location || null, body.substance || null, body.quantity || null, body.street_value || 0, body.status || 'open', body.priority || 'normal', body.officer_id || null, body.notes || null); return c.json({ success: true, id: result.meta.last_row_id }); }
  catch (err) { return dbErrorResponse(c, err, 'Failed to create narcotics case'); }
});

narcotics.get('/cases/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const row = await queryFirst<object>(db, 'SELECT * FROM narcotics_cases WHERE id=?', id);
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
  } catch (err) { return dbErrorResponse(c, err, 'Failed to fetch narcotics case'); }
});

narcotics.put('/cases/:id', async (c) => {
  try { const actor = c.get('user') as { role: string } | undefined; if (!actor || !new Set(['admin', 'manager', 'supervisor', 'officer']).has(actor.role)) return c.json({ error: 'Forbidden' }, 403); const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const body = await c.req.json();
    if (!body || Object.keys(body).length === 0) return c.json({ error: "Request body required" }, 400);
    const v = validateNarcCase(body);
    if (!v.ok) return c.json(narcEnumError(v.field), 400);
    await execute(db, 'UPDATE narcotics_cases SET case_number=?, case_type=?, subject_name=?, location=?, substance=?, quantity=?, street_value=?, status=?, priority=?, officer_id=?, notes=?, updated_at=datetime(\'now\') WHERE id=?', (body.case_number || (() => { throw new Error("case_number required"); })()), body.case_type || 'investigation', body.subject_name || null, body.location || null, body.substance || null, body.quantity || null, body.street_value || 0, body.status || 'open', body.priority || 'normal', body.officer_id || null, body.notes || null, id); return c.json({ success: true }); }
  catch (err) { return dbErrorResponse(c, err, 'Failed to update narcotics case'); }
});

narcotics.delete('/cases/:id', async (c) => {
  try {
    const actor = c.get('user') as { role: string } | undefined;
    if (!actor || !new Set(['admin', 'manager', 'supervisor']).has(actor.role)) return c.json({ error: 'Forbidden' }, 403);
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const result = await execute(db, 'DELETE FROM narcotics_cases WHERE id=?', id);
    if (!result.meta.changes) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) { return dbErrorResponse(c, err, 'Failed to delete narcotics case'); }
});

narcotics.get('/stats', async (c) => {
  try { const db = getDb(c.env); const total = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM narcotics_cases'); const active = await queryFirst<{cnt:number}>(db, "SELECT COUNT(*) as cnt FROM narcotics_cases WHERE status IN ('open','active')"); const seized = await queryFirst<{cnt:number}>(db, 'SELECT COALESCE(SUM(street_value),0) as cnt FROM narcotics_cases');
    // Seizures = cases with an actual substance recorded (was duplicating the
    // total case count). Guards live-D1 sentinel strings.
    const seizures = await queryFirst<{cnt:number}>(db, "SELECT COUNT(*) as cnt FROM narcotics_cases WHERE substance IS NOT NULL AND TRIM(LOWER(substance)) NOT IN ('','none','n/a','na')");
    return c.json({ totalInvestigations: total?.cnt || 0, activeCIs: active?.cnt || 0, totalSeizures: seizures?.cnt || 0, totalStreetValue: seized?.cnt || 0 }); }
  catch (err) { return dbErrorResponse(c, err, 'Failed to fetch narcotics stats'); }
});

export default narcotics;
