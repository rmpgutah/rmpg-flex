// ============================================================
// RMPG Flex — Jail Management (Cloudflare Worker)
// ============================================================
// Spillman Flex Jail module parity: inmate booking, housing,
// charges, visitors, property, medical, disciplinary, transports.
// Migration: 0047_spillman_modules.sql
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const jail = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

async function generateBookingNumber(db: ReturnType<typeof getDb>): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `BK-${yy}-`;
  const last = await queryFirst<{ booking_number: string }>(
    db, `SELECT booking_number FROM inmates WHERE booking_number LIKE ? ORDER BY id DESC LIMIT 1`, `${prefix}%`,
  );
  let nextNum = 1;
  if (last?.booking_number) {
    const m = last.booking_number.match(/^BK-\d{2}-(\d+)$/);
    if (m) nextNum = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

// ═══════════════════════════════════════════════════════════════
// INMATES
// ═══════════════════════════════════════════════════════════════

jail.get('/inmates', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q('status')) { conditions.push('status = ?'); params.push(q('status')); }
    if (q('search')) { const s = `%${q('search')}%`; conditions.push('(last_name LIKE ? OR first_name LIKE ? OR booking_number LIKE ?)'); params.push(s, s, s); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(q('per_page') || '50', 10) || 50));
    const offset = (page - 1) * perPage;
    const count = await queryFirst<{ total: number }>(db, `SELECT COUNT(*) as total FROM inmates ${where}`, ...params);
    const rows = await query<Record<string, unknown>>(
      db, `SELECT * FROM inmates ${where} ORDER BY booking_date DESC LIMIT ? OFFSET ?`, ...params, perPage, offset,
    );
    const total = count?.total ?? 0;
    return c.json({ data: rows, pagination: { page, per_page: perPage, total, totalPages: Math.ceil(total / perPage) } });
  } catch (err) {
    return c.json({ error: 'Failed to list inmates', code: 'LIST_ERROR' }, 500);
  }
});

jail.get('/inmates/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const row = await queryFirst<Record<string, unknown>>(db, 'SELECT i.*, u.full_name as arresting_officer_name FROM inmates i LEFT JOIN users u ON i.arresting_officer_id = u.id WHERE i.id = ?', id);
    if (!row) return c.json({ error: 'Inmate not found', code: 'NOT_FOUND' }, 404);
    return c.json({ data: row });
  } catch (err) {
    return c.json({ error: 'Failed to get inmate', code: 'GET_ERROR' }, 500);
  }
});

jail.post('/inmates', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.last_name !== 'string' || !b.last_name.trim()) return c.json({ error: 'last_name required', code: 'LAST_NAME_REQUIRED' }, 400);
    if (typeof b.first_name !== 'string' || !b.first_name.trim()) return c.json({ error: 'first_name required', code: 'FIRST_NAME_REQUIRED' }, 400);
    const bookingNumber = await generateBookingNumber(db);
    const result = await execute(db,
      `INSERT INTO inmates (booking_number, last_name, first_name, middle_name, dob, gender, race, height_inches, weight_lbs, hair_color, eye_color, skin_tone, marks_scars_tattoos, housing_unit, housing_cell, arresting_agency, arresting_officer_id, arrest_incident_id, bail_amount, bond_type, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      bookingNumber, b.last_name, b.first_name, b.middle_name ?? null, b.dob ?? null, b.gender ?? null,
      b.race ?? null, b.height_inches ?? null, b.weight_lbs ?? null, b.hair_color ?? null, b.eye_color ?? null,
      b.skin_tone ?? null, b.marks_scars_tattoos ?? null, b.housing_unit ?? null, b.housing_cell ?? null,
      b.arresting_agency ?? 'RMPG', b.arresting_officer_id ?? null, b.arrest_incident_id ?? null,
      b.bail_amount ?? null, b.bond_type ?? null, b.notes ?? null, userId,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM inmates WHERE id = ?', newId);
    return c.json({ data: created, booking_number: bookingNumber }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create inmate record', code: 'CREATE_ERROR', detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});

const INMATE_UPDATABLE = new Set(['last_name','first_name','middle_name','dob','gender','race','height_inches','weight_lbs','hair_color','eye_color','skin_tone','marks_scars_tattoos','housing_unit','housing_cell','bail_amount','bond_type','status','release_date','release_reason','notes']);

jail.put('/inmates/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM inmates WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Inmate not found', code: 'NOT_FOUND' }, 404);
    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) {
      if (!INMATE_UPDATABLE.has(k)) continue;
      sets.push(`${k} = ?`); vals.push(v ?? null);
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);
    sets.push(`updated_at = datetime('now','localtime')`); vals.push(id);
    await execute(db, `UPDATE inmates SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM inmates WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    return c.json({ error: 'Failed to update inmate', code: 'UPDATE_ERROR' }, 500);
  }
});

jail.delete('/inmates/:id', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
    await execute(db, 'DELETE FROM inmate_charges WHERE inmate_id = ?', id);
    await execute(db, 'DELETE FROM inmate_visitors WHERE inmate_id = ?', id);
    await execute(db, 'DELETE FROM inmate_property WHERE inmate_id = ?', id);
    await execute(db, 'DELETE FROM inmate_medical WHERE inmate_id = ?', id);
    await execute(db, 'DELETE FROM inmate_disciplinary WHERE inmate_id = ?', id);
    await execute(db, 'DELETE FROM inmate_transports WHERE inmate_id = ?', id);
    const result = await execute(db, 'DELETE FROM inmates WHERE id = ?', id);
    if (result.meta.changes === 0) return c.json({ error: 'Inmate not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to delete inmate', code: 'DELETE_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// CHARGES
// ═══════════════════════════════════════════════════════════════

jail.get('/inmates/:id/charges', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
    const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM inmate_charges WHERE inmate_id = ? ORDER BY id', id);
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to list charges', code: 'LIST_ERROR' }, 500);
  }
});

jail.post('/inmates/:id/charges', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM inmates WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Inmate not found' }, 404);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.charge_description !== 'string' || !b.charge_description.trim()) return c.json({ error: 'charge_description required' }, 400);
    const result = await execute(db,
      `INSERT INTO inmate_charges (inmate_id, charge_description, statute_code, offense_level, warrant_number, court_docket, bond_amount, disposition, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, b.charge_description, b.statute_code ?? null, b.offense_level ?? null, b.warrant_number ?? null,
      b.court_docket ?? null, b.bond_amount ?? null, b.disposition ?? null, b.notes ?? null,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM inmate_charges WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to add charge' }, 500);
  }
});

jail.delete('/inmates/:id/charges/:chargeId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const chargeId = parseInt(c.req.param('chargeId'), 10);
    const result = await execute(db, 'DELETE FROM inmate_charges WHERE id = ? AND inmate_id = ?', chargeId, id);
    if (result.meta.changes === 0) return c.json({ error: 'Charge not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to delete charge' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// VISITORS
// ═══════════════════════════════════════════════════════════════

jail.get('/inmates/:id/visitors', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM inmate_visitors WHERE inmate_id = ? ORDER BY visit_date DESC', id);
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to list visitors' }, 500);
  }
});

jail.post('/inmates/:id/visitors', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.visitor_name !== 'string' || !b.visitor_name.trim()) return c.json({ error: 'visitor_name required' }, 400);
    const result = await execute(db,
      `INSERT INTO inmate_visitors (inmate_id, visitor_name, relationship, visit_type, check_in, check_out, officer_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, b.visitor_name, b.relationship ?? null, b.visit_type ?? 'in_person', b.check_in ?? null, b.check_out ?? null, b.officer_id ?? null, b.notes ?? null,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM inmate_visitors WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to log visitor' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// PROPERTY
// ═══════════════════════════════════════════════════════════════

jail.get('/inmates/:id/property', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM inmate_property WHERE inmate_id = ? ORDER BY id', id);
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to list property' }, 500);
  }
});

jail.post('/inmates/:id/property', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.item_description !== 'string' || !b.item_description.trim()) return c.json({ error: 'item_description required' }, 400);
    const result = await execute(db,
      `INSERT INTO inmate_property (inmate_id, item_description, item_category, quantity, value_estimate, stored_location, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, b.item_description, b.item_category ?? null, b.quantity ?? 1, b.value_estimate ?? null, b.stored_location ?? null, b.status ?? 'held', b.notes ?? null,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM inmate_property WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to add property item' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// MEDICAL
// ═══════════════════════════════════════════════════════════════

jail.get('/inmates/:id/medical', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM inmate_medical WHERE inmate_id = ? ORDER BY screened_date DESC', id);
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to list medical screenings' }, 500);
  }
});

jail.post('/inmates/:id/medical', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.screening_type !== 'string') return c.json({ error: 'screening_type required' }, 400);
    const result = await execute(db,
      `INSERT INTO inmate_medical (inmate_id, screening_type, findings, prescribed_med, allergies, suicide_risk, cleared_for_booking, screened_by, screened_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')), ?)`,
      id, b.screening_type, b.findings ?? null, b.prescribed_med ?? null, b.allergies ?? null,
      b.suicide_risk ?? 0, b.cleared_for_booking ?? 1, b.screened_by ?? null, b.screened_date ?? null, b.notes ?? null,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM inmate_medical WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to record medical screening' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// DISCIPLINARY
// ═══════════════════════════════════════════════════════════════

jail.get('/inmates/:id/disciplinary', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const rows = await query<Record<string, unknown>>(db, 'SELECT d.*, u.full_name as reported_by_name FROM inmate_disciplinary d LEFT JOIN users u ON d.reported_by = u.id WHERE d.inmate_id = ? ORDER BY violation_date DESC', id);
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to list disciplinary records' }, 500);
  }
});

jail.post('/inmates/:id/disciplinary', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.violation !== 'string' || !b.violation.trim()) return c.json({ error: 'violation required' }, 400);
    const result = await execute(db,
      `INSERT INTO inmate_disciplinary (inmate_id, violation, violation_date, reported_by, sanction, hearing_date, hearing_outcome, notes)
       VALUES (?, ?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?)`,
      id, b.violation, b.violation_date ?? null, userId, b.sanction ?? null, b.hearing_date ?? null, b.hearing_outcome ?? null, b.notes ?? null,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM inmate_disciplinary WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to record disciplinary action' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// TRANSPORTS
// ═══════════════════════════════════════════════════════════════

jail.get('/inmates/:id/transports', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const rows = await query<Record<string, unknown>>(db, 'SELECT t.*, u.full_name as transporting_officer_name FROM inmate_transports t LEFT JOIN users u ON t.transporting_officer_id = u.id WHERE t.inmate_id = ? ORDER BY depart_date DESC', id);
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to list transports' }, 500);
  }
});

jail.post('/inmates/:id/transports', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.destination !== 'string' || !b.destination.trim()) return c.json({ error: 'destination required' }, 400);
    const result = await execute(db,
      `INSERT INTO inmate_transports (inmate_id, destination, reason, depart_date, return_date, transporting_officer_id, vehicle_id, status, notes)
       VALUES (?, ?, ?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?)`,
      id, b.destination, b.reason ?? null, b.depart_date ?? null, b.return_date ?? null, b.transporting_officer_id ?? null, b.vehicle_id ?? null, b.status ?? 'scheduled', b.notes ?? null,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM inmate_transports WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to schedule transport' }, 500);
  }
});

jail.put('/inmates/:id/transports/:transportId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const tid = parseInt(c.req.param('transportId'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const updatable = new Set(['destination','reason','return_date','transporting_officer_id','vehicle_id','status','notes']);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    vals.push(tid, id);
    await execute(db, `UPDATE inmate_transports SET ${sets.join(', ')} WHERE id = ? AND inmate_id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM inmate_transports WHERE id = ?', tid);
    return c.json({ data: updated });
  } catch (err) {
    return c.json({ error: 'Failed to update transport' }, 500);
  }
});

// Stats
jail.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const total = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM inmates'))?.count ?? 0;
    const housed = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM inmates WHERE status = 'housed'"))?.count ?? 0;
    const booked = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM inmates WHERE status = 'booked'"))?.count ?? 0;
    return c.json({ total, housed, booked });
  } catch (err) {
    return c.json({ error: 'Failed to load stats' }, 500);
  }
});

export default jail;
