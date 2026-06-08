import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { requireRole } from '../../middleware/auth';

const units = new Hono<Env>();

// CROSS-INTEGRATION NOTE (Claude Opus 4.8 — see PR #1025 / ed5d0e99):
//   `units.vehicle_id` is a TEXT column holding the denormalized
//   vehicle_NUMBER string (e.g. "PS-D19"). It has no FK to
//   fleet_vehicles. The authoritative link is
//   `fleet_vehicles.assigned_unit_id → units.id`. Callers that pass an
//   integer fleet_vehicles.id by accident will silently store "5" or
//   "12" — the NAV-side `/dispatch/gps/my-unit` then has nothing to
//   match, the duty/me card shows "No vehicle", and the fleet LIST
//   LEFT JOIN sees the orphan as an unassigned unit. We coerce here.

// GET /dispatch/units
units.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT u.*, usr.full_name as officer_name, usr.badge_number,
        c.call_number as current_call_number, c.incident_type as current_call_type,
        c.priority as current_call_priority, c.location_address as current_call_location
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      LEFT JOIN calls_for_service c ON u.current_call_id = c.id
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

    // ── Coerce vehicle_id to vehicle_NUMBER string (Claude: ed5d0e99) ──
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
      params.push(v ?? null);
    }
    if (!sets.length) return c.json({ message: 'No changes' });
    sets.push("updated_at = datetime('now')");
    params.push(id);
    await execute(db, `UPDATE units SET ${sets.join(', ')} WHERE id = ?`, ...params);
    const updated = await queryFirst(db, 'SELECT * FROM units WHERE id = ?', id);
    return c.json(updated);
  } catch (err) {
    return c.json({ error: 'Failed to update unit' }, 500);
  }
});

// DELETE /dispatch/units/:id — admin/manager only.
//
// CROSS-INTEGRATION (Claude Opus 4.8): if the unit being deleted owns
// a vehicle (fleet_vehicles.assigned_unit_id = :id), the back-link on
// the fleet side is the only FK-free link. Without clearing it, the
// fleet LIST view (LEFT JOIN units u ON u.id = v.assigned_unit_id)
// silently drops that row from the join, but the vehicle still
// appears with its old assigned_unit_id in any /api/fleet/:id fetch.
// We close the open fleet_assignments row + clear the back-link in the
// same handler so the unit deletion is a true two-sided teardown.
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

// POST /dispatch/calls/:callId/assign-unit
//
// CROSS-INTEGRATION GUARD (Claude Opus 4.8): unit.current_call_id is a
// single-pointer column. Reassigning a unit to a SECOND call without
// unassigning it from the first leaves call A's assigned_unit_ids JSON
// still containing the unit while unit.current_call_id points at
// call B — the dispatcher's call list shows the unit on B but call A's
// detail panel shows it on a unit that's "actually" elsewhere. Guard
// with a 409 when the unit is currently committed to a different call.
units.post('/assign-unit', async (c) => {
  try {
    const db = getDb(c.env);
    const { call_id, unit_id } = await c.req.json<{ call_id: number; unit_id: number }>();
    if (!Number.isFinite(call_id) || call_id <= 0) return c.json({ error: 'Invalid call_id' }, 400);
    if (!Number.isFinite(unit_id) || unit_id <= 0) return c.json({ error: 'Invalid unit_id' }, 400);
    const call = await queryFirst<{ assigned_unit_ids: string }>(db, 'SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?', call_id);
    if (!call) return c.json({ error: 'Call not found' }, 404);
    const unit = await queryFirst<{ id: number; current_call_id: number | null; call_sign: string | null }>(
      db, 'SELECT id, current_call_id, call_sign FROM units WHERE id = ?', unit_id);
    if (!unit) return c.json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }, 404);
    if (unit.current_call_id != null && unit.current_call_id !== call_id) {
      return c.json({
        error: `Unit ${unit.call_sign ?? unit_id} is already committed to call ${unit.current_call_id} — unassign first`,
        code: 'UNIT_ON_OTHER_CALL',
        current_call_id: unit.current_call_id,
      }, 409);
    }
    const assigned = new Set(JSON.parse(call.assigned_unit_ids || '[]') as number[]);
    assigned.add(unit_id);
    await execute(db, 'UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?', JSON.stringify([...assigned]), call_id);
    await execute(db, "UPDATE units SET status = 'dispatched', current_call_id = ? WHERE id = ?", call_id, unit_id);
    return c.json({ message: 'Unit assigned', unit_id, call_id });
  } catch (err) { return c.json({ error: 'Assign failed' }, 500); }
});

export default units;
