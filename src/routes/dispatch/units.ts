import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { emitAlert } from '../../utils/alertHub';
import { requireRole } from '../../middleware/auth';
import { log } from '../../utils/logger';

const units = new Hono<Env>();

// Columns a client may set via PUT /dispatch/units/:id. The handler
// interpolates body keys directly into the SQL SET clause, so without this
// allowlist any key would be concatenated into the query (column-name
// injection) and any column writable. Keys outside this set are ignored.
// `updated_at` is intentionally omitted — the handler stamps it itself.
const UPDATABLE_UNIT_COLUMNS = new Set([
  'call_sign', 'officer_id', 'status', 'latitude', 'longitude',
  'vehicle_id', 'capabilities', 'current_call_id', 'current_call_number',
  'last_status_change', 'audio_mode',
]);

// GET /dispatch/units
units.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT u.*, usr.full_name as officer_name, usr.badge_number,
        c.call_number as current_call_number, c.incident_type as current_call_type,
        c.priority as current_call_priority, c.location_address as current_call_location,
        fv.id as fleet_vehicle_id, fv.vehicle_number, fv.make as vehicle_make,
        fv.model as vehicle_model, fv.status as vehicle_status,
        fv.current_mileage, fv.next_service_mileage, fv.next_service_date,
        fv.insurance_expiry, fv.registration_expiry,
        fv.fuel_level, fv.pursuit_rated,
        CASE
          WHEN fv.id IS NULL THEN NULL
          WHEN fv.next_service_date IS NOT NULL AND date(fv.next_service_date) < date('now') THEN 'overdue'
          WHEN fv.next_service_mileage IS NOT NULL AND fv.current_mileage IS NOT NULL
               AND fv.current_mileage >= fv.next_service_mileage THEN 'overdue'
          WHEN fv.next_service_date IS NOT NULL AND date(fv.next_service_date) <= date('now', '+7 days') THEN 'due_soon'
          WHEN fv.next_service_mileage IS NOT NULL AND fv.current_mileage IS NOT NULL
               AND (fv.next_service_mileage - fv.current_mileage) < 500 THEN 'due_soon'
          ELSE 'ok'
        END as maintenance_status,
        te.id as active_shift_id, te.clock_in,
        CAST((julianday('now') - julianday(te.clock_in)) * 24 AS REAL) as shift_hours_elapsed
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      LEFT JOIN calls_for_service c ON u.current_call_id = c.id
      LEFT JOIN fleet_vehicles fv ON fv.assigned_unit_id = u.id
      LEFT JOIN time_entries te ON te.user_id = u.officer_id AND te.clock_out IS NULL
      ORDER BY u.call_sign
    `);
    return c.json(rows);
  } catch (err) {
    return c.json({ error: 'Failed to get units' }, 500);
  }
});

// POST /dispatch/units
//
// Accepts vehicle_id in EITHER form (integer fleet id or vehicle_number
// string) and coerces to the vehicle_number string for storage. The
// inverse direction is also handled: if a vehicle is assigned to this
// new unit, the fleet_vehicles.assigned_unit_id back-link is written in
// the same transaction so a subsequent fleet LIST JOIN doesn't show the
// vehicle as still belonging to its previous owner (or unassigned).
units.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.call_sign) return c.json({ error: 'call_sign is required' }, 400);

    const { call_sign, officer_id, vehicle_id, capabilities } = body;

    // ── Coerce vehicle_id to vehicle_NUMBER string ──
    // If it's a positive integer we look up the row; if we don't find
    // a matching fleet_vehicles.id, we treat the value as already a
    // vehicle_number and pass it through unchanged (defensive — the
    // legacy / external callers may send strings directly).
    let vehicleNumber: string | null = null;
    if (vehicle_id != null && vehicle_id !== '') {
      if (typeof vehicle_id === 'number' || (typeof vehicle_id === 'string' && /^\d+$/.test(vehicle_id))) {
        const vRow = await queryFirst<{ vehicle_number: string | null }>(
          db, 'SELECT vehicle_number FROM fleet_vehicles WHERE id = ?', Number(vehicle_id));
        if (vRow) vehicleNumber = vRow.vehicle_number ?? null;
        else vehicleNumber = String(vehicle_id);
      } else {
        vehicleNumber = String(vehicle_id);
      }
    }

    const result = await execute(db,
      'INSERT INTO units (call_sign, officer_id, vehicle_id, capabilities) VALUES (?, ?, ?, ?)',
      call_sign, officer_id || null, vehicleNumber, JSON.stringify(capabilities || [])
    );
    const newId = Number(result.meta.last_row_id);

    // ── Back-link the fleet side if we just resolved an integer id ──
    // fleet_vehicles.assigned_unit_id is the AUTHORITATIVE link. Setting
    // it here means the fleet LIST view (LEFT JOIN units ON units.id =
    // v.assigned_unit_id) shows this new unit owning the car without
    // waiting for a separate /fleet/:id/assign call from the client.
    if (vehicle_id != null && vehicle_id !== '' &&
        (typeof vehicle_id === 'number' || (typeof vehicle_id === 'string' && /^\d+$/.test(vehicle_id)))) {
      const vid = Number(vehicle_id);
      // Defensive: clear any prior owner so a second unit can't end up
      // pointing at the same vehicle through the back-link.
      await execute(db,
        `UPDATE fleet_vehicles SET assigned_unit_id = ?, updated_at = datetime('now') WHERE id = ?`,
        newId, vid);
    }

    const unit = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM units WHERE id = ?', newId);
    return c.json(unit, 201);
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) return c.json({ error: 'Call sign already exists' }, 409);
    return c.json({ error: 'Failed to create unit' }, 500);
  }
});

// PUT /dispatch/units/:id
//
// `vehicle_id` is INTENTIONALLY EXCLUDED from the inline write set.
// Vehicle assignment is a fleet-side operation (see
// /api/fleet/:id/assign) that updates BOTH directional links
// (fleet_vehicles.assigned_unit_id and the units.vehicle_id back-link)
// atomically. Allowing this handler to write units.vehicle_id
// independently re-introduces the bug Claude fixed in ed5d0e99
// (integer id stored in a TEXT column, breaking the NAV read path).
// If a client insists on sending vehicle_id we coerce + redirect them
// to the canonical surface via a 400 with a hint.
// Allowlist — only these columns may be written via PUT.
// vehicle_id, current_call_id, lat/lng, mileage etc. are mutated
// through their dedicated dispatch pathways, not a general PUT.
const UNIT_WRITABLE_COLUMNS = new Set([
  'call_sign', 'officer_id', 'status', 'capabilities',
  // assigned_beat was missing here — the dispatcher edit modal sends it on
  // every save (useDispatchUnitActions.handleSaveUnit) and the value was
  // silently dropped, so beat assignments never persisted via edit.
  'assigned_beat',
  'audio_mode', 'emergency_active', 'emergency_call_id', 'emergency_since',
  'gps_heading', 'gps_speed',
]);
units.put('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst(db, 'SELECT id FROM units WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Unit not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    if (body.vehicle_id != null) {
      // Surface a 400 with a pointer to the canonical endpoint rather
      // than silently dropping the field (which is what the pre-Claude
      // version did, leading to mystery "vehicle didn't update" bug
      // reports). The dispatcher UI shouldn't ever send this; the
      // PersonnelDetailPanel + FleetDetailPanel both go through
      // /api/fleet/:id/assign for vehicle changes.
      return c.json({
        error: 'vehicle_id cannot be set on the unit directly; use PUT /api/fleet/:id/assign',
        code: 'VEHICLE_ID_ROUTED',
        hint: 'PUT /api/fleet/:vehicleId/assign with { unit_id } updates both sides of the link',
      }, 400);
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (!UNIT_WRITABLE_COLUMNS.has(k)) continue;
      sets.push(`${k} = ?`);
      // D1 .bind() throws on arrays/objects. The dispatch edit modal sends
      // `capabilities` as a raw string[] (the POST handler JSON.stringifies it,
      // this PUT bound it directly) — so EVERY unit-edit save from the dispatch
      // modal 500'd. Coerce composites to JSON text, matching the column format.
      params.push(v == null ? null : (typeof v === 'object' ? JSON.stringify(v) : v));
    }
    if (!sets.length) return c.json({ message: 'No changes' });
    if (typeof body.status === 'string') {
      // Status is changing → restart the board's time-in-status dwell timer.
      // Without this, a manual edit kept the OLD last_status_change and the
      // dwell column showed days-old times after a fix.
      sets.push("last_status_change = datetime('now')");
      // Moving to a disengaged status detaches the unit from its call —
      // otherwise the stale current_call_id kept the unit pinned to a dead
      // call (and DELETE refused with UNIT_ON_CALL).
      if (['available', 'off_duty', 'out_of_service'].includes(body.status)) {
        sets.push('current_call_id = NULL');
      }
    }
    sets.push("updated_at = datetime('now')");
    params.push(id);
    await execute(db, `UPDATE units SET ${sets.join(', ')} WHERE id = ?`, ...params);
    const updated = await queryFirst(db, 'SELECT * FROM units WHERE id = ?', id);
    try {
      await emitAlert(c.env, 'dispatch_update', { action: 'unit_updated', unit: updated });
    } catch { log.warn('Broadcast unit_updated failed after PUT', { unitId: id }); /* non-fatal */ }
    return c.json(updated);
  } catch (err: any) {
    log.error('PUT /dispatch/units/:id failed', {}, err);
    if (err?.message?.includes('CHECK constraint')) {
      return c.json({ error: 'Invalid value for a constrained field (status, etc.)', code: 'CHECK_CONSTRAINT' }, 400);
    }
    // units.call_sign is UNIQUE NOT NULL — renaming a unit to an existing call
    // sign is a user-fixable conflict, not a server error.
    if (err?.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'That call sign is already in use by another unit', code: 'CALL_SIGN_TAKEN' }, 409);
    }
    if (err?.message?.includes('FOREIGN KEY constraint')) {
      return c.json({ error: 'officer_id does not reference a valid user', code: 'INVALID_OFFICER' }, 400);
    }
    if (err?.message?.includes('no such column')) {
      log.error('PUT /dispatch/units/:id column mismatch', { message: err.message });
      return c.json({ error: 'Update failed: schema mismatch', code: 'COLUMN_MISSING' }, 500);
    }
    return c.json({ error: 'Failed to update unit' }, 500);
  }
});

// DELETE /dispatch/units/:id — admin/manager only.
units.delete('/:id', requireRole('admin', 'manager'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid unit id', code: 'INVALID_ID' }, 400);
    const unit = await queryFirst<{ id: number; current_call_id: number | null }>(
      db, 'SELECT id, current_call_id FROM units WHERE id = ?', id);
    if (!unit) return c.json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }, 404);
    if (unit.current_call_id != null) {
      return c.json({ error: 'Unit is assigned to an active call — clear it first', code: 'UNIT_ON_CALL' }, 409);
    }
    // Close any open fleet_assignments row + clear the back-link so
    // the vehicle becomes unassigned and the audit trail records the
    // unassignment. Mirrors the unassign path in fleet.ts PUT
    // /:id/assign so a future re-attach doesn't read a stale link.
    await execute(db,
      `UPDATE fleet_assignments SET unassigned_at = datetime('now')
        WHERE unit_id = ? AND unassigned_at IS NULL`,
      id);
    await execute(db,
      `UPDATE fleet_vehicles SET assigned_unit_id = NULL, updated_at = datetime('now')
        WHERE assigned_unit_id = ?`,
      id);
    // Clear any officer that was pointing at this unit so the
    // personnel-side `users.assigned_unit_id` doesn't reference a now-
    // nonexistent unit (D1 has no FK; we enforce it ourselves).
    await execute(db,
      `UPDATE users SET assigned_unit_id = NULL, updated_at = datetime('now')
        WHERE assigned_unit_id = ?`,
      id);
    await execute(db, 'DELETE FROM units WHERE id = ?', id);
    return c.json({ message: 'Unit deleted', id });
  } catch (err) {
    return c.json({ error: 'Failed to delete unit' }, 500);
  }
});

// PUT /dispatch/units/:id/status — thin convenience route for status-only updates.
// Multiple client surfaces (MdtPage, UnitStatusCard, voiceCommandExecutor,
// cadCommandParser) call this path rather than the general PUT /:id.
units.put('/:id/status', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst(db, 'SELECT id FROM units WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Unit not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.status || typeof body.status !== 'string') return c.json({ error: 'status is required' }, 400);
    const detach = ['available', 'off_duty', 'out_of_service'].includes(body.status)
      ? ', current_call_id = NULL' : '';
    // Going off duty / out of service ends any on-foot episode — otherwise the
    // on_foot flag (and its board/map badge + overdue sweep) stays stuck on a
    // unit that's no longer in the field.
    const clearFoot = ['off_duty', 'out_of_service'].includes(body.status)
      ? ', on_foot = 0, on_foot_since = NULL, on_foot_alerted = 0' : '';
    await execute(db, `UPDATE units SET status = ?, last_status_change = datetime('now'), updated_at = datetime('now')${detach}${clearFoot} WHERE id = ?`, body.status, id);
    const updated = await queryFirst(db, 'SELECT * FROM units WHERE id = ?', id);
    try {
      await emitAlert(c.env, 'dispatch_update', { action: 'unit_status_changed', unit: updated });
    } catch { log.warn('Broadcast unit_status_changed failed after status update', { unitId: id }); /* non-fatal */ }
    return c.json(updated);
  } catch (err) {
    return c.json({ error: 'Failed to update unit status' }, 500);
  }
});

// NOTE: the unit-assignment handler lives at POST /dispatch/calls/:id/assign-unit
// (src/routes/dispatch/calls.ts) — that is the path the client and proxy use.

// POST /dispatch/units/batch-status — mass unit status update (post-briefing, shift change)
units.post('/batch-status', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (c) => {
  try {
    const db = getDb(c.env);
    const { unit_ids, status } = await c.req.json<{ unit_ids: number[]; status: string }>();
    if (!Array.isArray(unit_ids) || !unit_ids.length) return c.json({ error: 'unit_ids array required' }, 400);
    const VALID = ['available', 'dispatched', 'enroute', 'onscene', 'unavailable', 'out_of_service'];
    if (!VALID.includes(status)) return c.json({ error: `status must be one of: ${VALID.join(', ')}` }, 400);

    let updated = 0;
    const userId = c.get('userId') as number | undefined;
    for (const unitId of unit_ids) {
      const r = await execute(db,
        `UPDATE units SET status = ?, last_status_change = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        status, unitId);
      if ((r as any)?.meta?.changes > 0) {
        updated++;
        if (userId) {
          await execute(db,
            `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, 'batch_status_change', 'unit', ?, ?)`,
            userId, unitId, `Batch set to ${status}`);
        }
      }
    }
    return c.json({ updated, total: unit_ids.length });
  } catch (err) {
    return c.json({ error: 'Failed to update unit statuses' }, 500);
  }
});

export default units;
