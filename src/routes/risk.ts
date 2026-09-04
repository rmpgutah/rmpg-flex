// ============================================================
// RMPG Flex — Risk Management
// ============================================================
// Spillman Flex Risk Management parity: assessments,
// safety inspections, insurance claims.
// Migration: 0047_spillman_modules.sql
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

import { log } from '../utils/logger';
const risk = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

async function generateAssessmentNumber(db: ReturnType<typeof getDb>, prefix: string): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const p = `${prefix}-${yy}-`;
  const last = await queryFirst<{ assessment_number: string }>(
    db, `SELECT assessment_number FROM risk_assessments WHERE assessment_number LIKE ? ORDER BY id DESC LIMIT 1`, `${p}%`);
  let nextNum = 1;
  if (last?.assessment_number) {
    const m = last.assessment_number.match(/\w+-\d{2}-(\d+)$/);
    if (m) nextNum = parseInt(m[1], 10) + 1;
  }
  return `${p}${String(nextNum).padStart(4, '0')}`;
}

// ═══════════════════════════════════════════════════════════════
// RISK ASSESSMENTS
// ═══════════════════════════════════════════════════════════════

risk.get('/assessments', async (c) => {
  try {
    const db = getDb(c.env);
    const tableCheck = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='risk_assessments'");
    if (!tableCheck?.n) return c.json({ data: [] });
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('risk_level')) { conditions.push('risk_level = ?'); params.push(q('risk_level')); }
    if (q('status')) { conditions.push('status = ?'); params.push(q('status')); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await query<Record<string, unknown>>(db,
      `SELECT ra.*, u.full_name as assessed_by_name FROM risk_assessments ra LEFT JOIN users u ON ra.assessed_by = u.id ${where} ORDER BY ra.created_at DESC LIMIT 200`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /assessments failed', { src: 'src/routes/risk.ts' }, err);
    return c.json({ error: 'Failed to list assessments' }, 500);
  }
});

risk.post('/assessments', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number | undefined) ?? null;
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.entity_type !== 'string') return c.json({ error: 'entity_type required' }, 400);
    if (typeof b.description !== 'string' || !b.description.trim()) return c.json({ error: 'description required' }, 400);
    const number = await generateAssessmentNumber(db, 'RA');
    const result = await execute(db,
      `INSERT INTO risk_assessments (assessment_number, entity_type, entity_id, risk_level, risk_category, description, assessed_by, assessed_date, mitigation_plan, review_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, date('now')), ?, ?, ?)`,
      number, b.entity_type, b.entity_id ?? null, b.risk_level ?? 'low', b.risk_category ?? null,
      b.description, userId, b.assessed_date ?? null, b.mitigation_plan ?? null, b.review_date ?? null, 'active');
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM risk_assessments WHERE id = ?', newId);
    return c.json({ data: created, assessment_number: number }, 201);
  } catch (err) {
    log.error('POST /assessments failed', { src: 'src/routes/risk.ts' }, err);
    return c.json({ error: 'Failed to create assessment' }, 500);
  }
});

const ASSESSMENT_UPDATABLE = new Set(['entity_type','entity_id','risk_level','risk_category','description','mitigation_plan','review_date','status']);

risk.put('/assessments/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (ASSESSMENT_UPDATABLE.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    sets.push(`updated_at = datetime('now')`); vals.push(id);
    await execute(db, `UPDATE risk_assessments SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM risk_assessments WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /assessments/:id failed', { src: 'src/routes/risk.ts' }, err);
    return c.json({ error: 'Failed to update assessment' }, 500);
  }
});

risk.delete('/assessments/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const result = await execute(db, 'DELETE FROM risk_assessments WHERE id = ?', id);
    if (result.meta.changes === 0) return c.json({ error: 'Assessment not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /assessments/:id failed', { src: 'src/routes/risk.ts' }, err);
    return c.json({ error: 'Failed to delete assessment', code: 'DELETE_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// SAFETY INSPECTIONS
// ═══════════════════════════════════════════════════════════════

risk.get('/inspections', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('status')) { conditions.push('status = ?'); params.push(q('status')); }
    if (q('type')) { conditions.push('inspection_type = ?'); params.push(q('type')); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await query<Record<string, unknown>>(db,
      `SELECT si.*, u.full_name as inspector_name FROM safety_inspections si LEFT JOIN users u ON si.inspector_id = u.id ${where} ORDER BY si.inspection_date DESC LIMIT 200`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /inspections failed', { src: 'src/routes/risk.ts' }, err);
    return c.json({ error: 'Failed to list inspections' }, 500);
  }
});

risk.post('/inspections', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number | undefined) ?? null;
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.location !== 'string' || !b.location.trim()) return c.json({ error: 'location required' }, 400);
    const inspNumber = `SI-${Date.now()}`;
    const result = await execute(db,
      `INSERT INTO safety_inspections (inspection_number, location, inspection_type, inspector_id, inspection_date, pass_fail, findings, corrective_actions, next_inspection_due, status)
       VALUES (?, ?, ?, ?, COALESCE(?, date('now')), ?, ?, ?, ?, ?)`,
      inspNumber, b.location, b.inspection_type ?? 'general', userId, b.inspection_date ?? null,
      b.pass_fail ?? null, b.findings ?? null, b.corrective_actions ?? null, b.next_inspection_due ?? null, 'pending');
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM safety_inspections WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /inspections failed', { src: 'src/routes/risk.ts' }, err);
    return c.json({ error: 'Failed to create inspection' }, 500);
  }
});

risk.put('/inspections/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const updatable = new Set(['location','inspection_type','inspection_date','pass_fail','findings','corrective_actions','next_inspection_due','status']);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    vals.push(id);
    await execute(db, `UPDATE safety_inspections SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM safety_inspections WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /inspections/:id failed', { src: 'src/routes/risk.ts' }, err);
    return c.json({ error: 'Failed to update inspection' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// INSURANCE CLAIMS
// ═══════════════════════════════════════════════════════════════

risk.get('/claims', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('status')) { conditions.push('status = ?'); params.push(q('status')); }
    if (q('type')) { conditions.push('claim_type = ?'); params.push(q('type')); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await query<Record<string, unknown>>(db,
      `SELECT ic.*, u.full_name as reported_by_name FROM insurance_claims ic LEFT JOIN users u ON ic.reported_by = u.id ${where} ORDER BY ic.created_at DESC LIMIT 200`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /claims failed', { src: 'src/routes/risk.ts' }, err);
    return c.json({ error: 'Failed to list claims' }, 500);
  }
});

risk.post('/claims', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number | undefined) ?? null;
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.incident_date !== 'string') return c.json({ error: 'incident_date required' }, 400);
    if (typeof b.description !== 'string' || !b.description.trim()) return c.json({ error: 'description required' }, 400);
    const claimNumber = `CLM-${Date.now()}`;
    const result = await execute(db,
      `INSERT INTO insurance_claims (claim_number, claim_type, incident_date, description, reported_by, insurer_name, policy_number, claim_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      claimNumber, b.claim_type ?? 'auto', b.incident_date, b.description, userId, b.insurer_name ?? null, b.policy_number ?? null, b.claim_amount ?? null, 'reported');
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM insurance_claims WHERE id = ?', newId);
    return c.json({ data: created, claim_number: claimNumber }, 201);
  } catch (err) {
    log.error('POST /claims failed', { src: 'src/routes/risk.ts' }, err);
    return c.json({ error: 'Failed to file claim' }, 500);
  }
});

risk.put('/claims/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const updatable = new Set(['claim_type','description','insurer_name','policy_number','claim_amount','settlement_amount','status','notes']);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    sets.push(`updated_at = datetime('now')`); vals.push(id);
    await execute(db, `UPDATE insurance_claims SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM insurance_claims WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /claims/:id failed', { src: 'src/routes/risk.ts' }, err);
    return c.json({ error: 'Failed to update claim' }, 500);
  }
});

risk.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const riskTable = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='risk_assessments'");
    if (!riskTable?.n) return c.json({ total_assessments: 0, high_risk: 0, medium_risk: 0, low_risk: 0, total_inspections: 0, open_claims: 0 });
    const activeAssessments = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM risk_assessments WHERE status = 'active'"))?.count ?? 0;
    const pendingInspections = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM safety_inspections WHERE status = 'pending'"))?.count ?? 0;
    const openClaims = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM insurance_claims WHERE status IN ('reported','under_review')"))?.count ?? 0;
    return c.json({ active_assessments: activeAssessments, pending_inspections: pendingInspections, open_claims: openClaims });
  } catch (err) {
    log.error('GET /stats failed', { src: 'src/routes/risk.ts' }, err);
    return c.json({ error: 'Failed to load stats' }, 500);
  }
});

export default risk;
