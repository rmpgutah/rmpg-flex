// ============================================================
// RMPG Flex — Internal Affairs / Professional Standards
// ============================================================
// Spillman Flex IA module parity: complaints, investigations,
// early intervention flags.
// Migration: 0047_spillman_modules.sql
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
// IA edits are court-record material — every mutation must be auditable.
// recordAudit() is the canonical seam (writes audit_log + mirrors to
// flex_events). Wired into create/update/delete + investigation upsert as
// part of the Page 52 IA upgrade.
import { recordAudit } from '../utils/auditLog';

import { dbErrorResponse } from '../utils/dbErrors';
import { log } from '../utils/logger';
const affairs = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

async function generateComplaintNumber(db: ReturnType<typeof getDb>): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `IA-${yy}-`;
  const last = await queryFirst<{ complaint_number: string }>(
    db, 'SELECT complaint_number FROM ia_complaints WHERE complaint_number LIKE ? ORDER BY id DESC LIMIT 1', `${prefix}%`,
  );
  let nextNum = 1;
  if (last?.complaint_number) {
    const m = last.complaint_number.match(/^IA-\d{2}-(\d+)$/);
    if (m) nextNum = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

// ═══════════════════════════════════════════════════════════════
// COMPLAINTS
// ═══════════════════════════════════════════════════════════════

affairs.get('/complaints', async (c) => {
  // IA records are restricted personnel files (they name the subject officer
  // and the allegation). Reads were ungated while every write in this file
  // checks admin|manager|supervisor — so an `officer` could read complaints
  // about colleagues, and the external `contract_manager` / `client_viewer`
  // roles could read the entire IA file. Match the write policy.
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const tableCheck = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='ia_complaints'");
    if (!tableCheck?.n) return c.json({ data: [], pagination: { page: 1, per_page: 50, total: 0, totalPages: 0 } });
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q('status')) { conditions.push('status = ?'); params.push(q('status')); }
    if (q('type')) { conditions.push('complaint_type = ?'); params.push(q('type')); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(q('per_page') || '50', 10) || 50));
    const offset = (page - 1) * perPage;
    const count = await queryFirst<{ total: number }>(db, `SELECT COUNT(*) as total FROM ia_complaints ${where}`, ...params);
    const rows = await query<Record<string, unknown>>(
      db, `SELECT c.*, so.full_name as subject_officer_name, u.full_name as assigned_to_name
           FROM ia_complaints c LEFT JOIN users so ON c.subject_officer_id = so.id LEFT JOIN users u ON c.assigned_to = u.id
           ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`, ...params, perPage, offset,
    );
    const total = count?.total ?? 0;
    return c.json({ data: rows, pagination: { page, per_page: perPage, total, totalPages: Math.ceil(total / perPage) } });
  } catch (err) {
    log.error('GET /complaints failed', { src: 'src/routes/affairs.ts' }, err);
    return c.json({ error: 'Failed to list complaints', code: 'LIST_ERROR' }, 500);
  }
});

affairs.get('/complaints/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID' }, 400);
    const row = await queryFirst<Record<string, unknown>>(db,
      'SELECT c.*, so.full_name as subject_officer_name FROM ia_complaints c LEFT JOIN users so ON c.subject_officer_id = so.id WHERE c.id = ?', id);
    if (!row) return c.json({ error: 'Complaint not found' }, 404);
    return c.json({ data: row });
  } catch (err) {
    log.error('GET /complaints/:id failed', { src: 'src/routes/affairs.ts' }, err);
    return c.json({ error: 'Failed to get complaint' }, 500);
  }
});

affairs.post('/complaints', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.description !== 'string' || !b.description.trim()) return c.json({ error: 'description required' }, 400);
    const complaintNumber = await generateComplaintNumber(db);
    const result = await execute(db,
      `INSERT INTO ia_complaints (complaint_number, complainant_name, complainant_contact, subject_officer_id, complaint_type, description, incident_date, incident_location, witnesses, evidence_list, assigned_to, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      complaintNumber, b.complainant_name ?? null, b.complainant_contact ?? null, b.subject_officer_id ?? null,
      b.complaint_type ?? 'other', b.description, b.incident_date ?? null, b.incident_location ?? null,
      b.witnesses ?? null, b.evidence_list ?? null, b.assigned_to ?? null, userId,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM ia_complaints WHERE id = ?', newId);
    await recordAudit(c, {
      action: 'IA_COMPLAINT_FILED',
      entityType: 'ia_complaint',
      entityId: newId,
      details: {
        complaint_number: complaintNumber,
        complaint_type: b.complaint_type ?? 'other',
        subject_officer_id: b.subject_officer_id ?? null,
        // Do NOT log the description / complainant contact — the row
        // itself is the source of truth; audit_log is the index.
      },
    });
    return c.json({ data: created, complaint_number: complaintNumber }, 201);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to create complaint');
  }
});

const COMPLAINT_UPDATABLE = new Set(['complainant_name','complainant_contact','subject_officer_id','complaint_type','description','incident_date','incident_location','witnesses','evidence_list','status','assigned_to','finding','discipline','closed_date']);

affairs.put('/complaints/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID' }, 400);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM ia_complaints WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Complaint not found' }, 404);
    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) {
      if (!COMPLAINT_UPDATABLE.has(k)) continue;
      sets.push(`${k} = ?`); vals.push(v ?? null);
    }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    if (b.status === 'closed' || b.status === 'sustained' || b.status === 'not_sustained' || b.status === 'exonerated' || b.status === 'unfounded') {
      sets.push("closed_date = COALESCE(closed_date, date('now'))");
    }
    sets.push(`updated_at = datetime('now')`); vals.push(id);
    await execute(db, `UPDATE ia_complaints SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM ia_complaints WHERE id = ?', id);
    // Capture which fields actually changed (status / disposition transitions
    // are the legally-load-bearing edits — finding/discipline are court input).
    const changedFields = Object.keys(b).filter((k) => COMPLAINT_UPDATABLE.has(k));
    await recordAudit(c, {
      action: 'IA_COMPLAINT_UPDATED',
      entityType: 'ia_complaint',
      entityId: id,
      details: {
        changed_fields: changedFields,
        new_status: typeof b.status === 'string' ? b.status : undefined,
        new_finding: typeof b.finding === 'string' && b.finding ? 'set' : undefined,
        new_discipline: typeof b.discipline === 'string' && b.discipline ? 'set' : undefined,
      },
    });
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /complaints/:id failed', { src: 'src/routes/affairs.ts' }, err);
    return c.json({ error: 'Failed to update complaint' }, 500);
  }
});

affairs.delete('/complaints/:id', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    // Capture the row identity BEFORE cascading the delete — the audit
    // entry needs the complaint_number, not just the integer id, because
    // the row will be gone by the time auditors read this back.
    const doomed = await queryFirst<{ complaint_number: string; subject_officer_id: number | null }>(
      db, 'SELECT complaint_number, subject_officer_id FROM ia_complaints WHERE id = ?', id);
    await execute(db, 'DELETE FROM ia_investigations WHERE complaint_id = ?', id);
    const result = await execute(db, 'DELETE FROM ia_complaints WHERE id = ?', id);
    if (result.meta.changes === 0) return c.json({ error: 'Complaint not found' }, 404);
    await recordAudit(c, {
      action: 'IA_COMPLAINT_DELETED',
      entityType: 'ia_complaint',
      entityId: id,
      details: {
        complaint_number: doomed?.complaint_number ?? null,
        subject_officer_id: doomed?.subject_officer_id ?? null,
        cascade: 'investigations',
      },
    });
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /complaints/:id failed', { src: 'src/routes/affairs.ts' }, err);
    return c.json({ error: 'Failed to delete complaint' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// INVESTIGATIONS
// ═══════════════════════════════════════════════════════════════

affairs.get('/complaints/:id/investigations', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const rows = await query<Record<string, unknown>>(db,
      'SELECT i.*, u.full_name as investigator_name FROM ia_investigations i LEFT JOIN users u ON i.investigator_id = u.id WHERE i.complaint_id = ? ORDER BY i.started_at DESC', id);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /complaints/:id/investigations failed', { src: 'src/routes/affairs.ts' }, err);
    return c.json({ error: 'Failed to list investigations' }, 500);
  }
});

affairs.post('/complaints/:id/investigations', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const result = await execute(db,
      `INSERT INTO ia_investigations (complaint_id, investigator_id, started_at, summary, status)
       VALUES (?, ?, COALESCE(?, datetime('now')), ?, ?)`,
      id, b.investigator_id ?? null, b.started_at ?? null, b.summary ?? null, b.status ?? 'open',
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM ia_investigations WHERE id = ?', newId);
    await recordAudit(c, {
      action: 'IA_INVESTIGATION_OPENED',
      entityType: 'ia_investigation',
      entityId: newId,
      details: {
        complaint_id: id,
        investigator_id: b.investigator_id ?? null,
        status: b.status ?? 'open',
      },
    });
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /complaints/:id/investigations failed', { src: 'src/routes/affairs.ts' }, err);
    return c.json({ error: 'Failed to create investigation' }, 500);
  }
});

affairs.put('/complaints/:id/investigations/:invId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const cid = parseInt(c.req.param('id'), 10);
    const iid = parseInt(c.req.param('invId'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const updatable = new Set(['investigator_id','completed_at','summary','findings','recommendations','reviewed_by','reviewed_at','status']);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (b.status === 'completed') { sets.push("completed_at = COALESCE(completed_at, datetime('now'))"); }
    // Mirror the auto-stamp for 'reviewed' — without this, a reviewer-only
    // transition (completed → reviewed) leaves reviewed_at unset unless the
    // client explicitly passes it, which they don't today.
    if (b.status === 'reviewed') { sets.push("reviewed_at = COALESCE(reviewed_at, datetime('now'))"); }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    vals.push(iid, cid);
    await execute(db, `UPDATE ia_investigations SET ${sets.join(', ')} WHERE id = ? AND complaint_id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM ia_investigations WHERE id = ?', iid);
    await recordAudit(c, {
      action: 'IA_INVESTIGATION_UPDATED',
      entityType: 'ia_investigation',
      entityId: iid,
      details: {
        complaint_id: cid,
        changed_fields: Object.keys(b).filter((k) => updatable.has(k)),
        new_status: typeof b.status === 'string' ? b.status : undefined,
      },
    });
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /complaints/:id/investigations/:invId failed', { src: 'src/routes/affairs.ts' }, err);
    return c.json({ error: 'Failed to update investigation' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// EARLY INTERVENTION FLAGS
// ═══════════════════════════════════════════════════════════════

affairs.get('/flags', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q('officer_id')) { conditions.push('officer_id = ?'); params.push(q('officer_id')); }
    if (q('resolved') === 'true') { conditions.push('resolved_at IS NOT NULL'); }
    if (q('resolved') === 'false') { conditions.push('resolved_at IS NULL'); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await query<Record<string, unknown>>(db,
      `SELECT f.*, u.full_name as officer_name FROM early_intervention_flags f LEFT JOIN users u ON f.officer_id = u.id ${where} ORDER BY f.flagged_at DESC`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /flags failed', { src: 'src/routes/affairs.ts' }, err);
    return c.json({ error: 'Failed to list flags' }, 500);
  }
});

affairs.post('/flags', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();
    if (!b.officer_id) return c.json({ error: 'officer_id required' }, 400);
    if (!b.description) return c.json({ error: 'description required' }, 400);
    const result = await execute(db,
      `INSERT INTO early_intervention_flags (officer_id, flag_type, trigger_value, threshold, description, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      b.officer_id, b.flag_type ?? 'other', b.trigger_value ?? null, b.threshold ?? null, b.description, userId,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM early_intervention_flags WHERE id = ?', newId);
    await recordAudit(c, {
      action: 'IA_FLAG_RAISED',
      entityType: 'ia_flag',
      entityId: newId,
      details: {
        officer_id: b.officer_id,
        flag_type: b.flag_type ?? 'other',
        trigger_value: b.trigger_value ?? null,
        threshold: b.threshold ?? null,
      },
    });
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /flags failed', { src: 'src/routes/affairs.ts' }, err);
    return c.json({ error: 'Failed to create flag' }, 500);
  }
});

affairs.put('/flags/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const updatable = new Set(['resolved_at','resolution']);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    vals.push(id);
    await execute(db, `UPDATE early_intervention_flags SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM early_intervention_flags WHERE id = ?', id);
    await recordAudit(c, {
      action: typeof b.resolved_at === 'string' && b.resolved_at ? 'IA_FLAG_RESOLVED' : 'IA_FLAG_UPDATED',
      entityType: 'ia_flag',
      entityId: id,
      details: {
        resolution: typeof b.resolution === 'string' ? 'set' : undefined,
        resolved_at_set: typeof b.resolved_at === 'string' && !!b.resolved_at,
      },
    });
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /flags/:id failed', { src: 'src/routes/affairs.ts' }, err);
    return c.json({ error: 'Failed to resolve flag' }, 500);
  }
});

affairs.get('/stats', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const complaintTable = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='ia_complaints'");
    if (!complaintTable?.n) return c.json({ total_complaints: 0, open_complaints: 0, active_investigations: 0, sustained: 0, total_flags: 0, active_flags: 0 });
    const total = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM ia_complaints'))?.count ?? 0;
    const open = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM ia_complaints WHERE status NOT IN ('closed','sustained','not_sustained','exonerated','unfounded')"))?.count ?? 0;
    const flags = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM early_intervention_flags WHERE resolved_at IS NULL'))?.count ?? 0;
    return c.json({ total_complaints: total, open_complaints: open, unresolved_flags: flags });
  } catch (err) {
    log.error('GET /stats failed', { src: 'src/routes/affairs.ts' }, err);
    return c.json({ error: 'Failed to load stats' }, 500);
  }
});

export default affairs;
