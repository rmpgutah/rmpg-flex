// ============================================================
// RMPG Flex — Incidents (Hono / lean API)
// Minimal CRUD + the NIBRS-validated submit handler (NB-2).
//   GET    /api/incidents
//   GET    /api/incidents/:id
//   POST   /api/incidents
//   PUT    /api/incidents/:id
//   PUT    /api/incidents/:id/submit      ← NIBRS validator gate
//   PUT    /api/incidents/:id/approve     supervisor+
//   PUT    /api/incidents/:id/return      supervisor+
//   DELETE /api/incidents/:id             draft-only
// ============================================================
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { validateIncidentForNibrs } from './nibrs';

const incidents = new Hono<Env>();

const READ_ROLES  = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];
const WRITE_ROLES = ['admin', 'manager', 'supervisor', 'officer'];
const REVIEW_ROLES = ['admin', 'manager', 'supervisor'];

// GET /api/incidents
incidents.get('/', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const { status, officer_id, page, limit } = c.req.query();
    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (officer_id) { where += ' AND officer_id = ?'; params.push(parseInt(officer_id, 10)); }
    const pageNum = Math.max(1, parseInt(page || '1', 10));
    const limitNum = Math.min(500, Math.max(1, parseInt(limit || '100', 10)));
    const offset = (pageNum - 1) * limitNum;
    const rows = await query<Record<string, unknown>>(db, `
      SELECT i.*, u.full_name AS officer_name, s.full_name AS supervisor_name
      FROM incidents i
      LEFT JOIN users u ON u.id = i.officer_id
      LEFT JOIN users s ON s.id = i.supervisor_id
      ${where} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
      ...params, limitNum, offset);
    return c.json(rows);
  } catch (err) {
    console.error('[incidents] list error', err);
    return c.json({ error: 'Failed to list incidents', code: 'INC_LIST_ERR' }, 500);
  }
});

// GET /:id
incidents.get('/:id', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const row = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM incidents WHERE id = ?', id);
    if (!row) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);
    return c.json(row);
  } catch (err) {
    console.error('[incidents] get error', err);
    return c.json({ error: 'Failed to fetch incident', code: 'INC_FETCH_ERR' }, 500);
  }
});

// POST / — create draft
incidents.post('/', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as any));
    const { incident_type, location_address, priority, call_id, narrative } = body;
    if (!incident_type || !location_address) return c.json({ error: 'incident_type and location_address are required', code: 'INC_MISSING_FIELDS' }, 400);

    // Generate incident number: YY-RMP-NNNNN
    const year = new Date().getFullYear().toString().slice(-2);
    const [{ max }] = await query<{ max: string | null }>(db,
      "SELECT MAX(incident_number) AS max FROM incidents WHERE incident_number LIKE ?", `${year}-RMP-%`);
    const seq = max ? String(parseInt(max.split('-RMP-')[1] || '0', 10) + 1).padStart(5, '0') : '00001';
    const incident_number = `${year}-RMP-${seq}`;

    const result = await execute(db, `
      INSERT INTO incidents (incident_number, incident_type, priority, status, call_id, location_address, narrative, officer_id)
      VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`,
      incident_number, incident_type, priority || 'P3',
      call_id ?? null, location_address, narrative || null, userId);
    const created = await queryFirst(db, 'SELECT * FROM incidents WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) {
    console.error('[incidents] create error', err);
    return c.json({ error: 'Failed to create incident', code: 'INC_CREATE_ERR' }, 500);
  }
});

// PUT /:id — edit draft/returned
incidents.put('/:id', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const user = c.get('user') as any;
    const incident: any = await queryFirst(db, 'SELECT * FROM incidents WHERE id = ?', id);
    if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);
    if (!['draft', 'returned'].includes(incident.status) && user.role !== 'admin') {
      return c.json({ error: 'Can only edit draft or returned incidents', code: 'INC_NOT_EDITABLE' }, 403);
    }

    const body = await c.req.json().catch(() => ({} as any));
    const editable = ['incident_type', 'priority', 'location_address', 'latitude', 'longitude', 'narrative'];
    const sets: string[] = []; const vals: unknown[] = [];
    for (const k of editable) if (k in body) { sets.push(`${k} = ?`); vals.push(body[k]); }
    if (sets.length === 0) return c.json(incident);
    await execute(db, `UPDATE incidents SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...vals, id);
    return c.json(await queryFirst(db, 'SELECT * FROM incidents WHERE id = ?', id));
  } catch (err) {
    console.error('[incidents] update error', err);
    return c.json({ error: 'Failed to update incident', code: 'INC_UPDATE_ERR' }, 500);
  }
});

// PUT /:id/submit — NIBRS-validated submit (NB-2 gate)
incidents.put('/:id/submit', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const user = c.get('user') as any;
    const incident: any = await queryFirst(db, 'SELECT * FROM incidents WHERE id = ?', id);
    if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);
    if (!['draft', 'returned'].includes(incident.status) && user.role !== 'admin') {
      return c.json({ error: 'Can only submit draft or returned incidents', code: 'INC_NOT_SUBMITTABLE' }, 400);
    }
    if (!incident.narrative?.trim()) {
      return c.json({ error: 'Narrative is required before submitting', code: 'INC_NARRATIVE_REQUIRED' }, 400);
    }

    // ── NIBRS gate (NB-2) ──
    const validation = await validateIncidentForNibrs(db, id);
    const force = c.req.query('force') === '1' && user.role === 'admin';
    if (!validation.valid && !force) {
      return c.json({ error: 'Incident fails NIBRS validation', code: 'NIBRS_VALIDATION_FAILED', validation }, 422);
    }
    if (!validation.valid && force) {
      try {
        await execute(db, `
          INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
          VALUES (?, 'admin_override', 'incident', ?, ?)`,
          user.id, id, `God Mode: bypassed NIBRS validation (${validation.errors.length} errors)`);
      } catch { /* non-fatal */ }
    }

    await execute(db, "UPDATE incidents SET status = 'submitted', updated_at = datetime('now') WHERE id = ?", id);
    const updated = await queryFirst<any>(db, 'SELECT * FROM incidents WHERE id = ?', id);
    return c.json({ ...updated, validation });
  } catch (err) {
    console.error('[incidents] submit error', err);
    return c.json({ error: 'Failed to submit incident', code: 'INC_SUBMIT_ERR' }, 500);
  }
});

// PUT /:id/approve — supervisor+
incidents.put('/:id/approve', requireRole(...REVIEW_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const user = c.get('user') as any;
    const incident: any = await queryFirst(db, 'SELECT * FROM incidents WHERE id = ?', id);
    if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);
    if (!['submitted', 'under_review'].includes(incident.status) && user.role !== 'admin') {
      return c.json({ error: 'Can only approve submitted/under_review', code: 'INC_NOT_APPROVABLE' }, 400);
    }
    await execute(db, "UPDATE incidents SET status = 'approved', supervisor_id = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", user.id, id);
    return c.json(await queryFirst(db, 'SELECT * FROM incidents WHERE id = ?', id));
  } catch (err) {
    console.error('[incidents] approve error', err);
    return c.json({ error: 'Failed to approve', code: 'INC_APPROVE_ERR' }, 500);
  }
});

// PUT /:id/return — supervisor+ returns with reason
incidents.put('/:id/return', requireRole(...REVIEW_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const user = c.get('user') as any;
    const incident: any = await queryFirst(db, 'SELECT * FROM incidents WHERE id = ?', id);
    if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);
    if (!['submitted', 'under_review'].includes(incident.status)) {
      return c.json({ error: 'Can only return submitted/under_review', code: 'INC_NOT_RETURNABLE' }, 400);
    }
    const body = await c.req.json().catch(() => ({} as any));
    const reason = String(body.reason || '').trim();
    if (!reason) return c.json({ error: 'reason is required', code: 'INC_REASON_REQUIRED' }, 400);
    await execute(db, "UPDATE incidents SET status = 'returned', supervisor_id = ?, updated_at = datetime('now') WHERE id = ?", user.id, id);
    try {
      await execute(db, `
        INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
        VALUES (?, 'incident_returned', 'incident', ?, ?)`,
        user.id, id, `Returned for revision: ${reason}`);
    } catch { /* non-fatal */ }
    return c.json(await queryFirst(db, 'SELECT * FROM incidents WHERE id = ?', id));
  } catch (err) {
    console.error('[incidents] return error', err);
    return c.json({ error: 'Failed to return incident', code: 'INC_RETURN_ERR' }, 500);
  }
});

// DELETE /:id — draft-only
incidents.delete('/:id', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const user = c.get('user') as any;
    const incident: any = await queryFirst(db, 'SELECT * FROM incidents WHERE id = ?', id);
    if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);
    if (incident.status !== 'draft' && user.role !== 'admin') {
      return c.json({ error: 'Can only delete drafts', code: 'INC_NOT_DELETABLE' }, 403);
    }
    await execute(db, 'DELETE FROM incidents WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    console.error('[incidents] delete error', err);
    return c.json({ error: 'Failed to delete', code: 'INC_DELETE_ERR' }, 500);
  }
});

export default incidents;
