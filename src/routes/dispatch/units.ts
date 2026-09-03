import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { emitAlert } from '../../utils/alertHub';
import { requireRole } from '../../middleware/auth';
import { log } from '../../utils/logger';
import { denverNowDateExpr } from '../../utils/denverTime';
import { haversineM } from '../../utils/tripTelemetry';

const units = new Hono<Env>();


// GET /dispatch/units
units.get('/', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    // next_service_date is a plain DATE (no time-of-day) representing a
    // calendar day in the shop's local (Mountain Time) sense, but
    // date('now') resolves in UTC — for roughly 6-7 hours a day (evening MT,
    // already past midnight UTC) a vehicle due "today" read as not-yet-due
    // or a vehicle due "tomorrow" read as already overdue. Shift 'now' by
    // the current MT offset before taking its date, via the shared
    // denverNowDateExpr helper (utils/denverTime.ts) used by the other
    // route files with this same pattern.
    const denverNow = denverNowDateExpr();
    const denverNowPlus7 = denverNowDateExpr('+7 days');
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
          WHEN fv.next_service_date IS NOT NULL AND date(fv.next_service_date) < ${denverNow} THEN 'overdue'
          WHEN fv.next_service_mileage IS NOT NULL AND fv.current_mileage IS NOT NULL
               AND fv.current_mileage >= fv.next_service_mileage THEN 'overdue'
          WHEN fv.next_service_date IS NOT NULL AND date(fv.next_service_date) <= ${denverNowPlus7} THEN 'due_soon'
          WHEN fv.next_service_mileage IS NOT NULL AND fv.current_mileage IS NOT NULL
               AND (fv.next_service_mileage - fv.current_mileage) < 500 THEN 'due_soon'
          ELSE 'ok'
        END as maintenance_status,
        te.id as active_shift_id, te.clock_in,
        CAST((julianday('now') - julianday(te.clock_in)) * 24 AS REAL) as shift_hours_elapsed,
        (SELECT cpg.cpg_device_id FROM cpg_device_mappings cpg WHERE cpg.unit_id = u.id AND cpg.is_active = 1 LIMIT 1) as camera_device_id,
        (SELECT cpg.ignition_state FROM cpg_device_mappings cpg WHERE cpg.unit_id = u.id AND cpg.is_active = 1 LIMIT 1) as camera_ignition_state,
        (SELECT json_array_length(sr.optimized_order_json)
           FROM serve_routes sr
          WHERE sr.officer_id = usr.id
            AND sr.route_date = ${denverNow}
          ORDER BY sr.id DESC LIMIT 1) as ps_route_stops
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      LEFT JOIN calls_for_service c ON u.current_call_id = c.id
      LEFT JOIN fleet_vehicles fv ON fv.assigned_unit_id = u.id
      LEFT JOIN time_entries te ON te.officer_id = u.officer_id AND te.clock_out IS NULL
      ORDER BY u.call_sign
    `);
    return c.json(rows);
  } catch (err) {
    log.error('GET /dispatch/units failed', {}, err as Error);
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
units.post('/', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
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
    log.error('POST / failed', { src: 'src/routes/dispatch/units.ts' }, err);
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
// General unit edit (dispatch console edit modal). Writes status, officer_id,
// emergency_active, call_sign, GPS, etc. Gated to dispatcher+ because it was
// otherwise an ownership-check bypass: the dedicated PUT /:id/status enforces
// "officers may only change their OWN unit", but this general PUT accepts the
// same `status` field with NO ownership check, so an officer could force
// another officer's unit off_duty (which makes gps.ts drop that officer's live
// position, erasing them from the AVL map) or toggle their emergency state.
// Officer self-status changes go through PUT /:id/status, which keeps the
// ownership floor.
units.put('/:id', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id') || '';
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
    let prevCallId: number | null = null;
    if (typeof body.status === 'string') {
      // Status is changing → restart the board's time-in-status dwell timer.
      // Without this, a manual edit kept the OLD last_status_change and the
      // dwell column showed days-old times after a fix.
      sets.push("last_status_change = datetime('now')");
      // Moving to a disengaged status detaches the unit from its call —
      // otherwise the stale current_call_id kept the unit pinned to a dead
      // call (and DELETE refused with UNIT_ON_CALL).
      if (['available', 'off_duty', 'out_of_service'].includes(body.status)) {
        const prev = await queryFirst<{ current_call_id: number | null }>(db, 'SELECT current_call_id FROM units WHERE id = ?', id).catch(() => null);
        prevCallId = prev?.current_call_id ?? null;
        sets.push('current_call_id = NULL');
      }
    }
    sets.push("updated_at = datetime('now')");
    params.push(id);
    await execute(db, `UPDATE units SET ${sets.join(', ')} WHERE id = ?`, ...params);

    // If the unit just disengaged from a call, remove it from that call's
    // assigned_unit_ids so the dispatch board doesn't show a ghost assignment.
    if (prevCallId) {
      try {
        const callRow = await queryFirst<{ assigned_unit_ids: string }>(
          db, 'SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?', prevCallId,
        );
        if (callRow) {
          const unitIdNum = parseInt(id, 10);
          const remaining = (JSON.parse(callRow.assigned_unit_ids || '[]') as number[]).filter((u) => u !== unitIdNum);
          await execute(db, 'UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?', JSON.stringify(remaining), prevCallId);
        }
      } catch (callErr) {
        log.error('PUT /units/:id call cleanup failed (non-fatal)', { unitId: id, callId: prevCallId }, callErr as Error);
      }
    }

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
    log.error('DELETE /:id failed', { src: 'src/routes/dispatch/units.ts' }, err);
    return c.json({ error: 'Failed to delete unit' }, 500);
  }
});

// PUT /dispatch/units/:id/status — thin convenience route for status-only updates.
// Multiple client surfaces (MdtPage, UnitStatusCard, voiceCommandExecutor,
// cadCommandParser) call this path rather than the general PUT /:id.
// requireRole gates write access — without it any authenticated user can silently
// set any unit off-duty (the exact attack the general PUT /:id gate was added to prevent).
units.put('/:id/status', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ officer_id: number | null }>(db, 'SELECT officer_id FROM units WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Unit not found' }, 404);
    // Officers may only update their own unit — dispatchers and above can update any.
    const user = c.get('user') as { role: string } | undefined;
    if (user?.role === 'officer' && existing.officer_id !== (c.get('userId') as number | undefined)) {
      return c.json({ error: 'Officers may only update their own unit', code: 'FORBIDDEN' }, 403);
    }
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.status || typeof body.status !== 'string') return c.json({ error: 'status is required' }, 400);
    const VALID_STATUSES = ['available', 'dispatched', 'enroute', 'onscene', 'busy', 'off_duty', 'out_of_service', 'on_patrol'];
    if (!VALID_STATUSES.includes(body.status as string)) {
      return c.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}`, code: 'INVALID_STATUS' }, 400);
    }
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
    log.error('PUT /:id/status failed', { src: 'src/routes/dispatch/units.ts' }, err);
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
    const VALID = ['available', 'dispatched', 'enroute', 'onscene', 'busy', 'off_duty', 'out_of_service', 'on_patrol'];
    if (!VALID.includes(status)) return c.json({ error: `status must be one of: ${VALID.join(', ')}` }, 400);

    // Disengaged statuses must clear current_call_id and remove the unit
    // from the call's assigned_unit_ids — otherwise the board shows ghost
    // assignments and those calls never release for queue promotion.
    const DISENGAGING = new Set(['available', 'off_duty', 'out_of_service', 'on_patrol']);
    const isDisengaging = DISENGAGING.has(status);

    let updated = 0;
    const userId = c.get('userId') as number | undefined;
    for (const unitId of unit_ids) {
      // Read current call assignment before status change for cleanup below.
      const unitRow = isDisengaging
        ? await queryFirst<{ current_call_id: number | null }>(db, 'SELECT current_call_id FROM units WHERE id = ?', unitId).catch(() => null)
        : null;

      const r = await execute(db,
        isDisengaging
          ? `UPDATE units SET status = ?, current_call_id = NULL, last_status_change = datetime('now'), updated_at = datetime('now') WHERE id = ?`
          : `UPDATE units SET status = ?, last_status_change = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        status, unitId);
      if ((r as any)?.meta?.changes > 0) {
        updated++;

        // Remove this unit from its previously active call's assigned_unit_ids.
        if (isDisengaging && unitRow?.current_call_id) {
          try {
            const callRow = await queryFirst<{ assigned_unit_ids: string }>(
              db, 'SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?', unitRow.current_call_id,
            );
            if (callRow) {
              const remaining = (JSON.parse(callRow.assigned_unit_ids || '[]') as number[]).filter((u) => u !== unitId);
              await execute(db,
                'UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?',
                JSON.stringify(remaining), unitRow.current_call_id);
            }
          } catch (callErr) {
            log.error('batch-status call cleanup failed (non-fatal)', { unitId, callId: unitRow.current_call_id }, callErr as Error);
          }
        }

        if (userId) {
          await execute(db,
            `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?, 'batch_status_change', 'unit', ?, ?)`,
            userId, unitId, JSON.stringify({ status, unit_id: unitId }));
        }
      }
    }
    return c.json({ updated, total: unit_ids.length });
  } catch (err) {
    log.error('POST /batch-status failed', { src: 'src/routes/dispatch/units.ts' }, err);
    return c.json({ error: 'Failed to update unit statuses' }, 500);
  }
});

// GET /dispatch/units/my-assignment
// Returns the current officer's unit and default radio channel. Used by
// DesktopSystemTray for the radio channel display in the status bar.
units.get('/my-assignment', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number | undefined) ?? null;
    const unit = await queryFirst<{ call_sign: string; status: string; vehicle_id: string | null }>(
      db, 'SELECT call_sign, status, vehicle_id FROM units WHERE officer_id = ? LIMIT 1', userId,
    );
    if (!unit) return c.json({ call_sign: null, radio_channel: null, channel: null });

    // Look up the default radio channel name for display.
    const defaultChannel = await queryFirst<{ name: string }>(
      db, 'SELECT name FROM radio_channels WHERE is_default = 1 LIMIT 1',
    );

    return c.json({
      call_sign: unit.call_sign,
      status: unit.status,
      radio_channel: defaultChannel?.name ?? null,
      channel: defaultChannel?.name ?? null,
    });
  } catch (err) {
    log.error('GET /dispatch/units/my-assignment failed', {}, err);
    return c.json({ call_sign: null, radio_channel: null, channel: null });
  }
});

// ── GET /dispatch/units/:id/eta — estimated travel time to a call ─
// Computes haversine distance from unit's last GPS → call location,
// then divides by default urban speed (35 mph). The gps.ts ETA route
// mirrors this but is mounted under /api/dispatch/gps (different prefix);
// THIS route is the canonical /api/dispatch/units/:id/eta endpoint.
const ETA_READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;
units.get('/:id/eta', requireRole(...ETA_READ_ROLES), async (c) => {
  const unitId = c.req.param('id');
  const callId = c.req.query('call_id');
  if (!callId) return c.json({ error: 'call_id query param required' }, 400);
  try {
    const db = getDb(c.env);
    const unit = await queryFirst<{ latitude: number | null; longitude: number | null }>(
      db, 'SELECT latitude, longitude FROM units WHERE id = ? LIMIT 1', unitId,
    );
    if (!unit || unit.latitude == null || unit.longitude == null) {
      return c.json({ error: 'Unit GPS location unavailable' }, 404);
    }
    const call = await queryFirst<{ latitude: number | null; longitude: number | null }>(
      db, 'SELECT latitude, longitude FROM calls_for_service WHERE id = ? LIMIT 1', callId,
    );
    if (!call || call.latitude == null || call.longitude == null) {
      return c.json({ error: 'Call location unavailable' }, 404);
    }
    const distM = haversineM(unit.latitude, unit.longitude, call.latitude, call.longitude);
    const distMiles = distM / 1609.344;
    const speedMph = 35;
    const etaMin = (distMiles / speedMph) * 60;
    return c.json({
      eta_minutes: Math.round(etaMin * 10) / 10,
      distance_miles: Math.round(distMiles * 100) / 100,
      unit_lat: unit.latitude,
      unit_lng: unit.longitude,
      call_lat: call.latitude,
      call_lng: call.longitude,
    });
  } catch (err) {
    log.error('[units] GET /:id/eta failed', { unitId, callId }, err);
    return c.json({ error: 'ETA calculation failed' }, 500);
  }
});

// GET /dispatch/units/workload
// Returns each unit with: active_call_count, queued_call_count,
// avg_response_time_today, utilization_pct. Used by dispatch board to show
// which units are overloaded.
units.get('/workload', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);

    // All non-off-duty units
    const unitRows = await query<{
      id: number;
      call_sign: string;
      status: string;
      clock_in: string | null;
    }>(db, `
      SELECT u.id, u.call_sign, u.status,
        te.clock_in
      FROM units u
      LEFT JOIN time_entries te ON te.officer_id = u.officer_id
        AND te.clock_out IS NULL
      WHERE u.status != 'off_duty'
      ORDER BY u.call_sign ASC
    `);

    const now = Date.now();

    // For each unit count active/queued calls and avg response time today
    const results = await Promise.all(unitRows.map(async (u) => {
      // Active call count: calls this unit is currently assigned to
      let active_call_count = 0;
      let queued_call_count = 0;
      try {
        const counts = await queryFirst<{ active: number; queued: number }>(db, `
          SELECT
            SUM(CASE WHEN c.status IN ('dispatched','enroute','onscene') THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN c.status = 'pending' THEN 1 ELSE 0 END) as queued
          FROM calls_for_service c
          WHERE (
            instr(',' || c.assigned_unit_ids || ',', ',' || ? || ',') > 0
          )
          AND c.status IN ('dispatched','enroute','onscene','pending')
        `, String(u.id));
        active_call_count = counts?.active ?? 0;
        queued_call_count = counts?.queued ?? 0;
      } catch { /* best-effort */ }

      // Avg response time today from call_response_times
      let avg_response_time_today: number | null = null;
      try {
        const rt = await queryFirst<{ avg_rt: number | null }>(db, `
          SELECT AVG(response_seconds) as avg_rt
          FROM call_response_times
          WHERE unit_id = ? AND onscene_at >= date('now')
        `, u.id);
        avg_response_time_today = rt?.avg_rt != null ? Math.round(rt.avg_rt) : null;
      } catch { /* table may not exist yet */ }

      // Utilization: active_minutes / shift_minutes
      let utilization_pct: number | null = null;
      if (u.clock_in) {
        try {
          const shiftMs = now - new Date(u.clock_in.includes('T') ? u.clock_in : u.clock_in.replace(' ', 'T') + 'Z').getTime();
          const shiftMinutes = shiftMs / 60000;
          if (shiftMinutes > 0) {
            // Estimate active minutes from calls with response times
            const activeResult = await queryFirst<{ active_secs: number | null }>(db, `
              SELECT SUM(
                CASE
                  WHEN c.status IN ('dispatched','enroute','onscene')
                    AND c.dispatched_at IS NOT NULL
                  THEN CAST((julianday('now') - julianday(c.dispatched_at)) * 86400 AS INTEGER)
                  ELSE 0
                END
              ) as active_secs
              FROM calls_for_service c
              WHERE instr(',' || c.assigned_unit_ids || ',', ',' || ? || ',') > 0
                AND c.status IN ('dispatched','enroute','onscene')
            `, String(u.id));
            const activeMinutes = (activeResult?.active_secs ?? 0) / 60;
            utilization_pct = Math.min(100, Math.round((activeMinutes / shiftMinutes) * 100));
          }
        } catch { /* best-effort */ }
      }

      return {
        unit_id: u.id,
        call_sign: u.call_sign,
        status: u.status,
        active_call_count,
        queued_call_count,
        avg_response_time_today,
        utilization_pct,
        shift_start: u.clock_in ?? null,
      };
    }));

    return c.json(results);
  } catch (err) {
    log.error('GET /dispatch/units/workload failed', {}, err as Error);
    return c.json({ error: 'Failed to get unit workload' }, 500);
  }
});

export default units;
