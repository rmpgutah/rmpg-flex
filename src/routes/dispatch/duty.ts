// ============================================================
// RMPG Flex — Officer duty / shift lifecycle (the integrated "Start/End Shift")
// ------------------------------------------------------------
// One action that ties together the three previously-disconnected subsystems:
//   • TIME    — time_entries (clock-in / clock-out, payroll)
//   • DUTY    — units.status (in-service ↔ off-duty) + officer claim
//   • FLEET   — fleet_vehicles.assigned_unit_id + fleet_assignments (audit) +
//               units.vehicle_id back-link
//
// Going on duty: clock the officer in, put their unit in service, and assign a
// fleet vehicle (their take-home car if one is marked, otherwise the officer
// picks from the in-service pool — the server returns needs_vehicle:true with
// the list). Going off duty reverses all three (clock out, off-duty, release
// the car). All writes hit the SAME live D1 the legacy worker uses, so it stays
// consistent with the legacy /units/:id/status path (which still owns the
// mid-shift operational statuses + the live /api/ws broadcast).
//
// Mounted at /api/dispatch/duty (auth required); proxy routes the prefix to the
// rewrite (env.API), where fleet lives — the whole reason this can be atomic.
// ============================================================
import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { emitAlert } from '../../utils/alertHub';
import { setFleetOdometer } from '../../utils/fleetOdometer';

const duty = new Hono<Env>();

// Dispatch-tier roles may start/end a shift on another officer's behalf.
const ON_BEHALF_ROLES = new Set(['admin', 'manager', 'supervisor', 'dispatcher']);

// NOTE: units.vehicle_id is a TEXT column holding the vehicle_NUMBER string
// (e.g. "PS-D19"), NOT the fleet_vehicles.id. The authoritative unit↔vehicle
// link is fleet_vehicles.assigned_unit_id → units.id; units.vehicle_id is a
// denormalized display field. (Verified on live data.)
interface UnitRow { id: number; call_sign: string; officer_id: number | null; status: string; vehicle_id: string | null; current_call_id: number | null; }
interface VehicleRow { id: number; vehicle_number: string | null; vehicle_name: string | null; make: string | null; model: string | null; status: string; assigned_unit_id: number | null; is_take_home: number | null; current_mileage: number | null; }

// ISO timestamp matching the stored time_entries format ("…+00:00", no millis).
function nowStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
}
function hoursBetween(inIso: string, outIso: string, breakMin = 0): number {
  const a = new Date(inIso).getTime();
  const b = new Date(outIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round(((b - a) / 3_600_000 - breakMin / 60) * 100) / 100;
}

// Server-side odometer guardrail. Mirrors MileagePromptModal's policy so a
// scripted client (or a tampered modal) can't write nonsense to payroll:
//   - present, finite, > 0
//   - ≤ 999,999 (the modal's same ceiling — past that is almost certainly a
//     stray digit, not a real reading)
//   - if a previous reading is supplied (end-of-shift case), the new value
//     must be ≥ previous unless the caller passed an override_reason. We
//     log the reason; the audit row is the time_entry update itself.
// Returns either the validated number or a 409-shaped error payload that the
// handler returns directly so the client can route to the modal.
function validateMileage(raw: unknown, previous: number | null, overrideReason: string | null):
  | { ok: true; value: number }
  | { ok: false; code: 'NEEDS_MILEAGE' | 'MILEAGE_TOO_HIGH' | 'MILEAGE_DECREASING'; message: string; previous?: number } {
  const v = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(v) || v <= 0) {
    return { ok: false, code: 'NEEDS_MILEAGE', message: 'Odometer reading is required to start/end a shift.' };
  }
  if (v > 999_999) {
    return { ok: false, code: 'MILEAGE_TOO_HIGH', message: `Mileage ${v} exceeds the 999,999 ceiling — likely a typo.` };
  }
  if (previous != null && v < previous && !overrideReason) {
    return { ok: false, code: 'MILEAGE_DECREASING', message: `Reading ${v} is below the last recorded ${previous}. Manager override required.`, previous };
  }
  return { ok: true, value: Math.round(v * 10) / 10 };
}

// Whose shift this request acts on: self by default; another officer only for
// dispatch-tier roles passing officer_id.
function resolveOfficerId(c: any, requested?: unknown): number | null {
  const self = c.get('userId') as number | undefined;
  const role = (c.get('user') as { role?: string } | undefined)?.role;
  const reqId = requested != null ? Number(requested) : NaN;
  if (Number.isFinite(reqId) && reqId > 0 && role && ON_BEHALF_ROLES.has(role)) return reqId;
  return Number.isFinite(self) ? Number(self) : null;
}

// The officer's unit — most-recently-active crewed unit.
function officerUnit(db: any, officerId: number) {
  return queryFirst<UnitRow>(db,
    `SELECT id, call_sign, officer_id, status, vehicle_id, current_call_id
       FROM units WHERE officer_id = ? ORDER BY last_status_change DESC, id DESC LIMIT 1`, officerId);
}
function unitById(db: any, id: number) {
  return queryFirst<UnitRow>(db,
    `SELECT id, call_sign, officer_id, status, vehicle_id, current_call_id FROM units WHERE id = ?`, id);
}
function openEntry(db: any, officerId: number) {
  return queryFirst<Record<string, any>>(db,
    `SELECT * FROM time_entries WHERE officer_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`, officerId);
}
const VEH_COLS = `id, vehicle_number, vehicle_name, make, model, status, assigned_unit_id, is_take_home, current_mileage`;
function vehicleById(db: any, id: number | null | undefined) {
  return id ? queryFirst<VehicleRow>(db, `SELECT ${VEH_COLS} FROM fleet_vehicles WHERE id = ?`, id) : Promise.resolve(null);
}
// The unit's currently-assigned vehicle via the authoritative link.
function currentVehicleForUnit(db: any, unitId: number) {
  return queryFirst<VehicleRow>(db, `SELECT ${VEH_COLS} FROM fleet_vehicles WHERE assigned_unit_id = ? LIMIT 1`, unitId);
}
// In-service vehicles free to take (unassigned, or already on this unit).
function availableVehicles(db: any, unitId: number | null) {
  return query<VehicleRow>(db,
    `SELECT ${VEH_COLS} FROM fleet_vehicles
      WHERE status = 'in_service' AND (assigned_unit_id IS NULL OR assigned_unit_id = ?)
      ORDER BY is_take_home DESC, vehicle_number`, unitId ?? -1);
}
// The unit's take-home car, if one is marked + in service.
function takeHomeVehicle(db: any, unitId: number | null) {
  return unitId ? queryFirst<VehicleRow>(db,
    `SELECT ${VEH_COLS} FROM fleet_vehicles WHERE is_take_home = 1 AND assigned_unit_id = ? AND status = 'in_service' LIMIT 1`, unitId)
    : Promise.resolve(null);
}

// Release whatever vehicle a unit holds (close audit rows + clear both links).
async function releaseUnitVehicle(db: any, unitId: number) {
  await execute(db, `UPDATE fleet_assignments SET unassigned_at = datetime('now') WHERE unit_id = ? AND unassigned_at IS NULL`, unitId);
  await execute(db, `UPDATE fleet_vehicles SET assigned_unit_id = NULL, updated_at = datetime('now') WHERE assigned_unit_id = ?`, unitId);
  await execute(db, `UPDATE units SET vehicle_id = NULL WHERE id = ?`, unitId);
}
// Assign a vehicle to a unit. Idempotent: closes the unit's + the vehicle's
// prior OPEN assignment rows first (prevents the stale-open-row leak), then
// writes the fresh audit row + both directional links.
async function assignUnitVehicle(db: any, unitId: number, callSign: string | null, officerName: string | null, vehicleId: number, vehicleNumber: string | null) {
  await execute(db, `UPDATE fleet_assignments SET unassigned_at = datetime('now') WHERE (unit_id = ? OR vehicle_id = ?) AND unassigned_at IS NULL`, unitId, vehicleId);
  await execute(db, `UPDATE fleet_vehicles SET assigned_unit_id = NULL, updated_at = datetime('now') WHERE assigned_unit_id = ? AND id != ?`, unitId, vehicleId);
  await execute(db, `INSERT INTO fleet_assignments (vehicle_id, unit_id, unit_call_sign, officer_name, assigned_at) VALUES (?,?,?,?,datetime('now'))`, vehicleId, unitId, callSign, officerName);
  await execute(db, `UPDATE fleet_vehicles SET assigned_unit_id = ?, updated_at = datetime('now') WHERE id = ?`, unitId, vehicleId);
  // units.vehicle_id is the denormalized vehicle_NUMBER string (not the id).
  await execute(db, `UPDATE units SET vehicle_id = ? WHERE id = ?`, vehicleNumber, unitId);
}

async function stateFor(db: any, officerId: number) {
  const unit = await officerUnit(db, officerId);
  const entry = await openEntry(db, officerId);
  const vehicle = unit ? await currentVehicleForUnit(db, unit.id) : null;
  const takeHome = unit ? await takeHomeVehicle(db, unit.id) : null;
  const vehicles = await availableVehicles(db, unit?.id ?? null);
  return {
    on_shift: !!entry,
    time_entry: entry || null,
    unit: unit || null,
    vehicle: vehicle || null,
    take_home_vehicle: takeHome || null,
    available_vehicles: vehicles,
  };
}

// Shape one roster row from the joined SELECT. Exported for the test suite —
// the nesting contract (unit/vehicle/last_gps null vs object) is what the iOS
// DutyRosterView decodes, so it's locked here rather than re-derived.
export function _rosterRowForTest(r: Record<string, any>) {
  return rosterRow(r);
}
function rosterRow(r: Record<string, any>) {
  const onShift = r.entry_id != null;
  const clockInMs = onShift ? new Date(r.clock_in).getTime() : NaN;
  return {
    officer_id: r.officer_id,
    name: r.full_name ?? null,
    role: r.role ?? null,
    on_shift: onShift,
    entry_id: r.entry_id ?? null,
    clock_in: onShift ? r.clock_in : null,
    hours_so_far: Number.isFinite(clockInMs)
      ? Math.max(0, Math.round((Date.now() - clockInMs) / 36_000) / 100)
      : null,
    unit: r.unit_id != null
      ? { id: r.unit_id, call_sign: r.call_sign ?? null, status: r.unit_status ?? null, current_call_id: r.current_call_id ?? null }
      : null,
    vehicle: r.veh_id != null
      ? { id: r.veh_id, vehicle_number: r.veh_number ?? null, vehicle_name: r.veh_name ?? null }
      : null,
    last_gps: r.latitude != null && r.longitude != null
      ? { lat: r.latitude, lng: r.longitude, at: r.gps_updated_at ?? null }
      : null,
  };
}

// The active-roster SELECT, shared by /roster (dispatch, full) and /onduty
// (any officer, on-duty only). One pass: users × open time entry × claimed
// unit (with GPS mirror) × assigned fleet vehicle.
async function loadRoster(db: any) {
  const rows = await query<Record<string, any>>(db, `
    SELECT us.id AS officer_id, us.full_name, us.role,
           te.id AS entry_id, te.clock_in,
           un.id AS unit_id, un.call_sign, un.status AS unit_status,
           un.current_call_id, un.latitude, un.longitude, un.gps_updated_at,
           fv.id AS veh_id, fv.vehicle_number AS veh_number, fv.vehicle_name AS veh_name
      FROM users us
      LEFT JOIN time_entries te ON te.id = (
        SELECT id FROM time_entries WHERE officer_id = us.id AND clock_out IS NULL
         ORDER BY clock_in DESC LIMIT 1)
      LEFT JOIN units un ON un.id = (
        SELECT id FROM units WHERE officer_id = us.id
         ORDER BY last_status_change DESC, id DESC LIMIT 1)
      LEFT JOIN fleet_vehicles fv ON fv.assigned_unit_id = un.id
     WHERE COALESCE(us.status, 'active') NOT IN ('terminated', 'inactive')
     ORDER BY (te.id IS NULL), us.full_name`);
  return rows.map(rosterRow);
}

// GET /dispatch/duty/roster — every active officer's duty state in one call.
// Dispatch-tier only: this is the supervision surface behind the iOS Duty
// Roster screen (start/end on behalf + time corrections hang off these rows).
duty.get('/roster', async (c) => {
  try {
    const role = (c.get('user') as { role?: string } | undefined)?.role;
    if (!role || !ON_BEHALF_ROLES.has(role)) {
      return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403);
    }
    return c.json({ officers: await loadRoster(getDb(c.env)) });
  } catch (err) {
    console.error('GET /dispatch/duty/roster failed:', err);
    return c.json({ error: 'Failed to load duty roster', detail: (err as Error)?.message }, 500);
  }
});

// GET /dispatch/duty/onduty — on-duty officers only, readable by ANY authed
// officer (situational awareness / mutual aid). Reuses the roster shape but
// filtered to on-shift; no dispatch-tier gate.
duty.get('/onduty', async (c) => {
  try {
    const officers = (await loadRoster(getDb(c.env))).filter((o) => o.on_shift);
    return c.json({ officers });
  } catch (err) {
    console.error('GET /dispatch/duty/onduty failed:', err);
    return c.json({ error: 'Failed to load on-duty roster', detail: (err as Error)?.message }, 500);
  }
});

// GET /dispatch/duty/timecard — the SESSION officer's own time entries (last
// 60). Unlike /api/personnel/time (manager-gated), this is self-only: any
// officer can read their own card.
duty.get('/timecard', async (c) => {
  try {
    const officerId = resolveOfficerId(c);
    if (!officerId) return c.json({ error: 'No officer in session', code: 'NO_OFFICER' }, 401);
    const entries = await query<Record<string, any>>(getDb(c.env), `
      SELECT id, clock_in, clock_out, total_hours, break_minutes, status, notes,
             starting_mileage, ending_mileage
        FROM time_entries WHERE officer_id = ?
       ORDER BY clock_in DESC LIMIT 60`, officerId);
    return c.json({ entries });
  } catch (err) {
    console.error('GET /dispatch/duty/timecard failed:', err);
    return c.json({ error: 'Failed to load timecard', detail: (err as Error)?.message }, 500);
  }
});

// GET /dispatch/duty/me — current shift state + vehicle options for the picker.
duty.get('/me', async (c) => {
  try {
    const officerId = resolveOfficerId(c, c.req.query('officer_id'));
    if (!officerId) return c.json({ error: 'No officer in session', code: 'NO_OFFICER' }, 401);
    return c.json(await stateFor(getDb(c.env), officerId));
  } catch (err) {
    console.error('GET /dispatch/duty/me failed:', err);
    return c.json({ error: 'Failed to load shift state', detail: (err as Error)?.message }, 500);
  }
});

// POST /dispatch/duty/start — go on duty: clock in + unit in-service + vehicle.
duty.post('/start', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const officerId = resolveOfficerId(c, body.officer_id);
    if (!officerId) return c.json({ error: 'No officer in session', code: 'NO_OFFICER' }, 401);

    const unit = body.unit_id != null ? await unitById(db, Number(body.unit_id)) : await officerUnit(db, officerId);
    if (!unit) return c.json({ error: 'No unit assigned — ask dispatch to assign you a unit first', code: 'NO_UNIT' }, 409);

    const officer = await queryFirst<{ full_name: string }>(db, `SELECT full_name FROM users WHERE id = ?`, officerId);
    const officerName = officer?.full_name ?? null;

    // RESUME guard — a second login (new device, expired session, accidental
    // OFF→ON bounce) while a shift is already open must NOT force the vehicle
    // report + odometer ritual again. The open entry IS the shift; we just
    // re-point the unit/links at it below.
    const existingEntry = await openEntry(db, officerId);
    const resuming = !!existingEntry;

    // Vehicle resolution: explicit pick → take-home → unit's standing car →
    // the open entry's vehicle (resume) → prompt the officer with the list.
    let vehicle: VehicleRow | null;
    if (body.vehicle_id != null) {
      vehicle = await vehicleById(db, Number(body.vehicle_id));
      if (!vehicle) return c.json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }, 404);
      if (vehicle.status !== 'in_service') return c.json({ error: `Vehicle ${vehicle.vehicle_number ?? vehicle.id} is ${vehicle.status}, not in service`, code: 'VEHICLE_NOT_IN_SERVICE' }, 409);
      if (vehicle.assigned_unit_id && vehicle.assigned_unit_id !== unit.id) return c.json({ error: 'That vehicle is already assigned to another unit', code: 'VEHICLE_TAKEN' }, 409);
    } else {
      vehicle = await takeHomeVehicle(db, unit.id) || await currentVehicleForUnit(db, unit.id);
      if (!vehicle && resuming && existingEntry!.vehicle_id != null) {
        vehicle = await vehicleById(db, Number(existingEntry!.vehicle_id));
      }
      if (vehicle && vehicle.status !== 'in_service') vehicle = null;
      if (!vehicle) {
        return c.json({ needs_vehicle: true, code: 'NEEDS_VEHICLE', available_vehicles: await availableVehicles(db, unit.id) }, 409);
      }
    }

    // Starting odometer. Three accepted shapes:
    //   provided  → validated against the vehicle's last known reading;
    //   resuming  → not needed (the open entry already holds the shift's
    //               starting reading — COALESCE below never overwrites it);
    //   omitted   → defaults to the fleet odometer, which duty readings +
    //               GPS trip accruals keep current, so a one-tap "Start
    //               Shift" / MDT 10-8 needs no manual entry at all.
    const lastEnding = await queryFirst<{ m: number | null }>(db,
      `SELECT ending_mileage AS m FROM time_entries WHERE vehicle_id = ? AND ending_mileage IS NOT NULL ORDER BY clock_out DESC LIMIT 1`, vehicle.id);
    let startingMileage: number | null = null;
    if (body.starting_mileage != null && body.starting_mileage !== '') {
      const startCheck = validateMileage(body.starting_mileage, lastEnding?.m ?? null, typeof body.override_reason === 'string' ? body.override_reason : null);
      if (!startCheck.ok) {
        return c.json({ error: startCheck.message, code: startCheck.code, previous_mileage: lastEnding?.m ?? null }, 409);
      }
      startingMileage = startCheck.value;
    } else if (!resuming) {
      const odo = vehicle.current_mileage != null ? Number(vehicle.current_mileage) : null;
      startingMileage = odo != null && Number.isFinite(odo) && odo > 0 ? Math.round(odo * 10) / 10 : (lastEnding?.m ?? null);
      if (startingMileage == null) {
        return c.json({ error: 'No odometer history for this vehicle — enter the starting mileage.', code: 'NEEDS_MILEAGE' }, 409);
      }
    }

    // Per-shift QR token — random uuid embedded in the ShiftCard QR. The
    // /m/shift/:token mobile page treats it as the bearer credential for this
    // shift's inspection writes (auto-invalidated when clock_out is set).
    const qrToken = crypto.randomUUID();

    // 1) Clock in — reuse an already-open entry rather than double-punching.
    let entry = existingEntry;
    if (!entry) {
      const res = await execute(db,
        `INSERT INTO time_entries (officer_id, clock_in, status, unit_id, vehicle_id, starting_mileage, qr_token, created_at)
         VALUES (?, ?, 'active', ?, ?, ?, ?, datetime('now','localtime'))`,
        officerId, nowStamp(), unit.id, vehicle.id, startingMileage, qrToken);
      entry = await queryFirst(db, `SELECT * FROM time_entries WHERE id = ?`, Number(res.meta.last_row_id));
    } else {
      // Re-open path: rotate the token so a stale QR from a prior open entry
      // can't be reused. Same shift, fresh QR for the inspection page.
      await execute(db,
        `UPDATE time_entries SET unit_id = ?, vehicle_id = ?, starting_mileage = COALESCE(starting_mileage, ?), qr_token = ? WHERE id = ?`,
        unit.id, vehicle.id, startingMileage, qrToken, entry.id);
    }
    // Re-anchor the fleet record when a reading was taken (or odometer-derived
    // on a fresh shift). On a resume with no reading there's nothing to anchor.
    if (startingMileage != null) await setFleetOdometer(db, vehicle.id, startingMileage);

    // 2) Unit in service, claimed by this officer, linked to the car
    //    (units.vehicle_id = the denormalized vehicle_NUMBER string).
    await execute(db,
      `UPDATE units SET status = 'available', officer_id = ?, vehicle_id = ?, last_status_change = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      officerId, vehicle.vehicle_number, unit.id);

    // 3) Fleet assignment (idempotent — closes any stale open rows first).
    await assignUnitVehicle(db, unit.id, unit.call_sign, officerName, vehicle.id, vehicle.vehicle_number);

    const fresh = await queryFirst(db, `SELECT * FROM units WHERE id = ?`, unit.id);
    try { if (fresh) await emitAlert(c.env, 'dispatch_update', { action: 'unit_updated', unit: fresh }); } catch { /* never break the write */ }

    return c.json(await stateFor(db, officerId), 200);
  } catch (err) {
    console.error('POST /dispatch/duty/start failed:', err);
    return c.json({ error: 'Failed to start shift', detail: (err as Error)?.message }, 500);
  }
});

// POST /dispatch/duty/end — go off duty: clock out + off-duty + release vehicle.
duty.post('/end', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const officerId = resolveOfficerId(c, body.officer_id);
    if (!officerId) return c.json({ error: 'No officer in session', code: 'NO_OFFICER' }, 401);

    const unit = body.unit_id != null ? await unitById(db, Number(body.unit_id)) : await officerUnit(db, officerId);

    // 1) Clock out the open entry — ending odometer is required.
    const entry = await openEntry(db, officerId);
    if (entry) {
      // Ending odometer. Provided → validated against THIS shift's starting
      // reading (officer must end ≥ where they started). Omitted → default to
      // the fleet odometer (kept current all shift by GPS trip accruals), so a
      // one-tap "End Shift" / MDT OFF closes the books with travel-derived
      // mileage instead of failing. Never below the shift's starting reading.
      const startMi: number | null = typeof entry.starting_mileage === 'number' ? entry.starting_mileage : null;
      let endingMileage: number | null = null;
      if (body.ending_mileage != null && body.ending_mileage !== '') {
        const endCheck = validateMileage(body.ending_mileage, startMi, typeof body.override_reason === 'string' ? body.override_reason : null);
        if (!endCheck.ok) {
          return c.json({ error: endCheck.message, code: endCheck.code, previous_mileage: startMi, starting_mileage: startMi }, 409);
        }
        endingMileage = endCheck.value;
      } else {
        const veh = entry.vehicle_id != null ? await vehicleById(db, Number(entry.vehicle_id)) : null;
        const odo = veh?.current_mileage != null ? Number(veh.current_mileage) : null;
        if (odo != null && Number.isFinite(odo) && odo > 0) {
          endingMileage = Math.round(Math.max(odo, startMi ?? 0) * 10) / 10;
        } else if (startMi != null) {
          endingMileage = startMi; // no odometer history — close at 0 miles rather than block
        }
      }
      const totalMiles = startMi != null && endingMileage != null ? Math.max(0, Math.round((endingMileage - startMi) * 10) / 10) : null;

      const stamp = nowStamp();
      const hrs = hoursBetween(entry.clock_in, stamp, Number(entry.break_minutes) || 0);
      await execute(db,
        `UPDATE time_entries SET clock_out = ?, total_hours = ?, ending_mileage = ?, total_miles = ?, status = 'completed' WHERE id = ?`,
        stamp, hrs, endingMileage, totalMiles, entry.id);
      // Shift-end odometer reading is authoritative — sync the fleet vehicle.
      await setFleetOdometer(db, entry.vehicle_id != null ? Number(entry.vehicle_id) : null, endingMileage);
    }

    // 2) Take the unit off duty + release its vehicle back to the pool.
    if (unit) {
      await execute(db,
        `UPDATE units SET status = 'off_duty', current_call_id = NULL, on_foot = 0, on_foot_since = NULL, on_foot_alerted = 0, last_status_change = datetime('now'), updated_at = datetime('now') WHERE id = ?`, unit.id);
      await releaseUnitVehicle(db, unit.id);
      const fresh = await queryFirst(db, `SELECT * FROM units WHERE id = ?`, unit.id);
      try { if (fresh) await emitAlert(c.env, 'dispatch_update', { action: 'unit_updated', unit: fresh }); } catch { /* never break the write */ }
    }

    // 3) Tear down any armed WelfareWatchDO for this officer. Without this,
    // a watch armed on a P1/P2 onscene that never de-escalated will keep
    // firing alarms against an off-duty officer (phantom escalations to
    // supervisors, dispatcher distrust of the watch system). handleStop()
    // is idempotent (setState(null) + deleteAlarm), so it's safe to fire
    // unconditionally — but we only broadcast the auto-clear when the DO
    // actually had state to clear, to avoid ghost dispatch_update frames
    // on every shift-end. Best-effort: a DO failure must NEVER block the
    // shift transition itself.
    try {
      const id = c.env.WELFARE_WATCH.idFromName(`u-${officerId}`);
      const stub = c.env.WELFARE_WATCH.get(id);
      const stateRes = await stub.fetch('https://do/state', { method: 'GET' });
      const prev = await stateRes.json<{ stage?: number; idle?: boolean; call_sign?: string | null; call_number?: string | null }>().catch(() => ({} as any));
      const wasArmed = prev && !prev.idle && (prev.stage ?? 0) >= 0 && (prev.call_sign != null || prev.call_number != null);
      await stub.fetch('https://do/stop', { method: 'POST' });
      if (wasArmed) {
        try {
          await emitAlert(c.env, 'dispatch_update', {
            action: 'welfare_auto_cleared',
            user_id: officerId,
            call_sign: prev.call_sign ?? null,
            call_number: prev.call_number ?? null,
            reason: 'shift_end',
          });
        } catch { /* broadcast is non-fatal */ }
      }
    } catch (err) {
      console.error('[duty/end] welfare DO teardown failed (non-fatal)', { officerId, err: (err as Error)?.message });
    }

    return c.json(await stateFor(db, officerId), 200);
  } catch (err) {
    console.error('POST /dispatch/duty/end failed:', err);
    return c.json({ error: 'Failed to end shift', detail: (err as Error)?.message }, 500);
  }
});

export default duty;
