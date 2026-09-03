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
import { recordAudit } from '../utils/auditLog';
import { emitAnalytics, flexEvent } from '../utils/analytics';
import { requireRole } from '../middleware/auth';
import { validateIncidentForNibrs } from './nibrs';
import { geocodeAddress } from './geocode';
import { resolveDistrict } from '../utils/districtResolver';

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
    if (officer_id) { const oid = parseInt(officer_id, 10); if (Number.isFinite(oid) && oid > 0) { where += ' AND officer_id = ?'; params.push(oid); } }
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
    const totalRow = await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM incidents i ${where}`, ...params);
    const total = totalRow?.n ?? rows.length;
    // Client reads res.data / res.pagination (matches cases.ts list shape); a
    // bare array silently emptied the incidents list.
    return c.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.max(1, Math.ceil(total / limitNum)) } });
  } catch (err) {
    console.error('[incidents] list error', err);
    return c.json({ error: 'Failed to list incidents', code: 'INC_LIST_ERR' }, 500);
  }
});

// GET /:id
// GET /:id enriches the bare incidents row with the fields IncidentsPage.tsx's
// fetchIncidentDetail actually reads (linked_persons, linked_vehicles,
// evidence, call_type, call_created_at) — an incident's persons/vehicles are
// linked through its originating call (call_persons/call_vehicles keyed on
// incidents.call_id), the same junction tables dispatch/callLinks.ts's
// GET /calls/:id/persons|vehicles already join through. Evidence links
// directly via evidence.incident_id. Previously this returned only the bare
// row, so these panels were silently always empty.
incidents.get('/:id', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const row = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM incidents WHERE id = ?', id);
    if (!row) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);

    const callId = row.call_id as number | null;
    const [linkedPersons, linkedVehicles, evidence, call] = await Promise.all([
      callId ? query<Record<string, unknown>>(db,
        `SELECT cp.id, cp.call_id, cp.person_id, cp.role, cp.notes, cp.added_at,
                p.first_name, p.last_name, p.dob, p.gender, p.race,
                p.phone, p.address, p.caution_flags, p.is_sex_offender,
                p.gang_affiliation, p.probation_parole, p.flags
         FROM call_persons cp JOIN persons p ON cp.person_id = p.id
         WHERE cp.call_id = ? ORDER BY cp.added_at DESC LIMIT 500`, callId) : [],
      callId ? query<Record<string, unknown>>(db,
        `SELECT cv.id, cv.call_id, cv.vehicle_id, cv.role, cv.notes, cv.added_at,
                v.plate_number, v.state, v.make, v.model, v.year, v.color, v.vin,
                v.owner_person_id, op.first_name as owner_first, op.last_name as owner_last
         FROM call_vehicles cv JOIN vehicles_records v ON cv.vehicle_id = v.id
         LEFT JOIN persons op ON v.owner_person_id = op.id
         WHERE cv.call_id = ? ORDER BY cv.added_at DESC LIMIT 500`, callId) : [],
      query<Record<string, unknown>>(db,
        'SELECT * FROM evidence WHERE incident_id = ? ORDER BY created_at DESC LIMIT 500', id),
      callId ? queryFirst<{ incident_type: string; created_at: string }>(db,
        'SELECT incident_type, created_at FROM calls_for_service WHERE id = ?', callId) : null,
    ]);

    return c.json({
      ...row,
      linked_persons: linkedPersons,
      linked_vehicles: linkedVehicles,
      evidence,
      call_type: call?.incident_type ?? null,
      call_created_at: call?.created_at ?? null,
    });
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

    // Backfill geocoded coordinates when address is present but coords are not
    let lat = body.latitude != null ? Number(body.latitude) : null;
    let lng = body.longitude != null ? Number(body.longitude) : null;
    if ((lat == null || lng == null) && typeof location_address === 'string' && location_address.trim().length >= 3) {
      const coords = await geocodeAddress(c.env, location_address).catch(() => null);
      if (coords) { lat = coords.lat; lng = coords.lng; }
    }

    // Generate incident number: YY-RMP-NNNNN
    const year = new Date().getFullYear().toString().slice(-2);
    const [{ max }] = await query<{ max: string | null }>(db,
      "SELECT MAX(incident_number) AS max FROM incidents WHERE incident_number LIKE ?", `${year}-RMP-%`);
    const seq = max ? String(parseInt(max.split('-RMP-')[1] || '0', 10) + 1).padStart(5, '0') : '00001';
    const incident_number = `${year}-RMP-${seq}`;

    // Geofence: capture the full Area > Section > Zone > Beat from coordinates
    // (best-effort — never block incident creation on a geo miss).
    const geo = (lat != null && lng != null)
      ? await resolveDistrict(c.env, { lat, lng }).catch(() => null)
      : null;

    const result = await execute(db, `
      INSERT INTO incidents (incident_number, incident_type, priority, status, call_id, location_address, latitude, longitude, narrative, officer_id,
        sector_id, zone_id, beat_id, zone_beat, area_code, area_name)
      VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      incident_number, incident_type, priority || 'P3',
      call_id ?? null, location_address, lat, lng, narrative || null, userId,
      geo?.sector_id ?? null, geo?.zone_id ?? null, geo?.beat_id ?? null, geo?.zone_beat ?? null,
      geo?.area_code ?? null, geo?.area_name ?? null);
    const created = await queryFirst(db, 'SELECT * FROM incidents WHERE id = ?', result.meta.last_row_id);

    // Analytics lakehouse: incident-created event (best-effort, fire-and-forget).
    emitAnalytics(c, c.env.EVENTS, [flexEvent({
      event_type: 'incident_created', occurred_at: new Date().toISOString(),
      actor_id: userId, entity_type: 'incident', entity_id: Number(result.meta.last_row_id),
      lat, lng, status: 'draft', label: incident_type, priority: priority || 'P3',
      category: 'records',
      payload: { incident_number, call_id: call_id ?? null, area: geo?.area_name ?? null },
    })]);
    // ── FlexCam auto-preserve (best-effort, strictly additive). Resolve the
    // officer's unit from the reporting officer; never throws into the filing
    // flow — a preserve failure logs and is swallowed so the incident still files.
    // Fire-and-forget via waitUntil: the preserve issues ~11 sequential ClearPath
    // POSTs (7-min window) which must NOT delay the filing response. waitUntil
    // also keeps the work alive after the response returns. The unit lookup runs
    // INSIDE _preserve; only the request-scoped ids are captured up front.
    const incidentId = Number(result.meta.last_row_id);
    const preserveUserId = userId ?? null;
    const preserveCallId = call_id != null ? Number(call_id) : null;
    const _preserve = (async () => {
      try {
        const unit = preserveUserId ? await queryFirst<{ id: number }>(getDb(c.env), 'SELECT id FROM units WHERE officer_id=? LIMIT 1', preserveUserId).catch(() => null) : null;
        const { preserveForEvent } = await import('../utils/footage/autoPreserve');
        await preserveForEvent(c.env, { eventType: 'incident', eventId: incidentId, reason: 'incident', unitId: unit?.id ?? null, officerUserId: preserveUserId, callId: preserveCallId, eventTs: Date.now() }); // new-date-ok
      } catch (e) { console.error('[flexcam-preserve] incident:', (e as Error)?.message); }
    })();
    try { c.executionCtx.waitUntil(_preserve); } catch { /* no execution ctx (e.g. tests) — let it float */ }
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

    // Backfill geocode when location_address is updated but coords are missing
    if ('location_address' in body && typeof body.location_address === 'string' && body.location_address.trim().length >= 3) {
      const hasLat = body.latitude != null;
      const hasLng = body.longitude != null;
      const addrChanged = body.location_address !== incident.location_address;
      if ((!hasLat || !hasLng) && addrChanged) {
        const coords = await geocodeAddress(c.env, body.location_address).catch(() => null);
        if (coords) { body.latitude = coords.lat; body.longitude = coords.lng; }
      }
    }

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
        await recordAudit(c, { action: 'admin_override', entityType: 'incident', entityId: id, details: `God Mode: bypassed NIBRS validation (${validation.errors.length} errors)`, actorId: user.id });
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
    // Audit 2026-06-21 caught that the companion /return route logs
    // via recordAudit but /approve did not. Approval is the
    // consequential transition that locks the incident as NIBRS-
    // eligible — should be the LOUDER trail, not the quieter one.
    try {
      await recordAudit(c, {
        action: 'incident_approved',
        entityType: 'incident',
        entityId: id,
        details: `Approved by supervisor ${user.full_name ?? user.id} (previous status=${incident.status})`,
        actorId: user.id,
      });
    } catch { /* non-fatal */ }
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
    // Client sends `comments`; accept both so Return doesn't 400.
    const reason = String(body.reason ?? body.comments ?? '').trim();
    if (!reason) return c.json({ error: 'reason is required', code: 'INC_REASON_REQUIRED' }, 400);
    await execute(db, "UPDATE incidents SET status = 'returned', supervisor_id = ?, updated_at = datetime('now') WHERE id = ?", user.id, id);
    try {
      await recordAudit(c, { action: 'incident_returned', entityType: 'incident', entityId: id, details: `Returned for revision: ${reason}`, actorId: user.id });
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
