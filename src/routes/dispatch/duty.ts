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

const duty = new Hono<Env>();

// Dispatch-tier roles may start/end a shift on another officer's behalf.
const ON_BEHALF_ROLES = new Set(['admin', 'manager', 'supervisor', 'dispatcher']);

interface UnitRow { id: number; call_sign: string; officer_id: number | null; status: string; vehicle_id: number | null; current_call_id: number | null; }
interface VehicleRow { id: number; vehicle_number: string | null; vehicle_name: string | null; make: string | null; model: string | null; status: string; assigned_unit_id: number | null; is_take_home: number | null; }

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
const VEH_COLS = `id, vehicle_number, vehicle_name, make, model, status, assigned_unit_id, is_take_home`;
function vehicleById(db: any, id: number | null | undefined) {
  return id ? queryFirst<VehicleRow>(db, `SELECT ${VEH_COLS} FROM fleet_vehicles WHERE id = ?`, id) : Promise.resolve(null);
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
async function assignUnitVehicle(db: any, unitId: number, callSign: string | null, officerName: string | null, vehicleId: number) {
  await execute(db, `UPDATE fleet_assignments SET unassigned_at = datetime('now') WHERE (unit_id = ? OR vehicle_id = ?) AND unassigned_at IS NULL`, unitId, vehicleId);
  await execute(db, `UPDATE fleet_vehicles SET assigned_unit_id = NULL, updated_at = datetime('now') WHERE assigned_unit_id = ? AND id != ?`, unitId, vehicleId);
  await execute(db, `INSERT INTO fleet_assignments (vehicle_id, unit_id, unit_call_sign, officer_name, assigned_at) VALUES (?,?,?,?,datetime('now'))`, vehicleId, unitId, callSign, officerName);
  await execute(db, `UPDATE fleet_vehicles SET assigned_unit_id = ?, updated_at = datetime('now') WHERE id = ?`, unitId, vehicleId);
  await execute(db, `UPDATE units SET vehicle_id = ? WHERE id = ?`, vehicleId, unitId);
}

async function stateFor(db: any, officerId: number) {
  const unit = await officerUnit(db, officerId);
  const entry = await openEntry(db, officerId);
  const vehicle = unit ? await vehicleById(db, unit.vehicle_id) : null;
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

    // Vehicle resolution: explicit pick → take-home → unit's standing car →
    // prompt the officer with the available list (the approved "else prompt").
    let vehicle: VehicleRow | null;
    if (body.vehicle_id != null) {
      vehicle = await vehicleById(db, Number(body.vehicle_id));
      if (!vehicle) return c.json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }, 404);
      if (vehicle.status !== 'in_service') return c.json({ error: `Vehicle ${vehicle.vehicle_number ?? vehicle.id} is ${vehicle.status}, not in service`, code: 'VEHICLE_NOT_IN_SERVICE' }, 409);
      if (vehicle.assigned_unit_id && vehicle.assigned_unit_id !== unit.id) return c.json({ error: 'That vehicle is already assigned to another unit', code: 'VEHICLE_TAKEN' }, 409);
    } else {
      vehicle = await takeHomeVehicle(db, unit.id) || await vehicleById(db, unit.vehicle_id);
      if (vehicle && vehicle.status !== 'in_service') vehicle = null;
      if (!vehicle) {
        return c.json({ needs_vehicle: true, code: 'NEEDS_VEHICLE', available_vehicles: await availableVehicles(db, unit.id) }, 409);
      }
    }

    // 1) Clock in — reuse an already-open entry rather than double-punching.
    let entry = await openEntry(db, officerId);
    if (!entry) {
      const res = await execute(db,
        `INSERT INTO time_entries (officer_id, clock_in, status, unit_id, vehicle_id, created_at)
         VALUES (?, ?, 'active', ?, ?, datetime('now','localtime'))`,
        officerId, nowStamp(), unit.id, vehicle.id);
      entry = await queryFirst(db, `SELECT * FROM time_entries WHERE id = ?`, Number(res.meta.last_row_id));
    } else {
      await execute(db, `UPDATE time_entries SET unit_id = ?, vehicle_id = ? WHERE id = ?`, unit.id, vehicle.id, entry.id);
    }

    // 2) Unit in service, claimed by this officer, linked to the car.
    await execute(db,
      `UPDATE units SET status = 'available', officer_id = ?, vehicle_id = ?, last_status_change = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      officerId, vehicle.id, unit.id);

    // 3) Fleet assignment (idempotent — closes any stale open rows first).
    await assignUnitVehicle(db, unit.id, unit.call_sign, officerName, vehicle.id);

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

    // 1) Clock out the open entry.
    const entry = await openEntry(db, officerId);
    if (entry) {
      const stamp = nowStamp();
      const hrs = hoursBetween(entry.clock_in, stamp, Number(entry.break_minutes) || 0);
      await execute(db, `UPDATE time_entries SET clock_out = ?, total_hours = ?, status = 'completed' WHERE id = ?`, stamp, hrs, entry.id);
    }

    // 2) Take the unit off duty + release its vehicle back to the pool.
    if (unit) {
      await execute(db,
        `UPDATE units SET status = 'off_duty', current_call_id = NULL, last_status_change = datetime('now'), updated_at = datetime('now') WHERE id = ?`, unit.id);
      await releaseUnitVehicle(db, unit.id);
      const fresh = await queryFirst(db, `SELECT * FROM units WHERE id = ?`, unit.id);
      try { if (fresh) await emitAlert(c.env, 'dispatch_update', { action: 'unit_updated', unit: fresh }); } catch { /* never break the write */ }
    }

    return c.json(await stateFor(db, officerId), 200);
  } catch (err) {
    console.error('POST /dispatch/duty/end failed:', err);
    return c.json({ error: 'Failed to end shift', detail: (err as Error)?.message }, 500);
  }
});

export default duty;
