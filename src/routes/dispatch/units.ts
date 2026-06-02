import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { requireRole } from '../../middleware/auth';
import { broadcastAll } from '../ws';

const units = new Hono<Env>();

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
units.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.call_sign) return c.json({ error: 'call_sign is required' }, 400);

    // The create form (useDispatchUnitActions) sends a chosen status; it was
    // previously dropped (not in the INSERT), so a new unit always landed on
    // the DB default. Honor it, defaulting to 'available'. Must match the live
    // `units` CHECK constraint (no 'on_patrol').
    const VALID_UNIT_STATUSES = ['available', 'dispatched', 'enroute', 'onscene', 'busy', 'off_duty', 'out_of_service'];
    const VALID_AUDIO_MODES = ['audible', 'silent', 'vibrate'];
    const { call_sign, officer_id, vehicle_id, capabilities, assigned_beat } = body;
    const status = VALID_UNIT_STATUSES.includes(String(body.status || '').toLowerCase())
      ? String(body.status).toLowerCase() : 'available';
    const audioMode = VALID_AUDIO_MODES.includes(String(body.audio_mode || '').toLowerCase())
      ? String(body.audio_mode).toLowerCase() : 'audible';
    // capabilities may arrive as an array (multi-select) or a pre-stringified
    // JSON string — normalize to a JSON string for the TEXT column.
    const capsJson = typeof capabilities === 'string' ? capabilities : JSON.stringify(capabilities || []);
    const result = await execute(db,
      'INSERT INTO units (call_sign, officer_id, vehicle_id, capabilities, status, assigned_beat, audio_mode) VALUES (?, ?, ?, ?, ?, ?, ?)',
      call_sign, officer_id || null, vehicle_id || null, capsJson, status, assigned_beat || null, audioMode
    );
    const unit = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM units WHERE id = ?', Number(result.meta.last_row_id));
    // Live fan-out so every open dispatch/map board adds the new unit without a
    // manual refresh. /dispatch is excluded from the generic data_changed sync
    // (src/index.ts), so these surgical broadcasts are the only live path.
    try { if (unit) broadcastAll('dispatch_update', { action: 'unit_created', unit }); } catch { /* never break the write */ }
    return c.json(unit, 201);
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) return c.json({ error: 'Call sign already exists' }, 409);
    return c.json({ error: 'Failed to create unit' }, 500);
  }
});

// PUT /dispatch/units/:id
units.put('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst(db, 'SELECT id FROM units WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Unit not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    // Allowlist the writable columns. The previous version interpolated EVERY
    // body key straight into the SQL as a column name, which (1) 500'd the whole
    // update if the payload carried any non-column key (e.g. unit_type, which
    // does not exist on the live 17-col units table) and (2) was a column-name
    // injection vector. Only these columns exist on live units and are safe to set.
    const ALLOWED_COLS = new Set([
      'call_sign', 'officer_id', 'status', 'vehicle_id', 'current_call_id',
      'capabilities', 'latitude', 'longitude', 'gps_source', 'assigned_beat',
      'mileage', 'audio_mode',
    ]);
    const VALID_UNIT_STATUSES = ['available', 'dispatched', 'enroute', 'onscene', 'busy', 'off_duty', 'out_of_service'];
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (!ALLOWED_COLS.has(k)) continue;
      if (k === 'status' && !VALID_UNIT_STATUSES.includes(String(v || '').toLowerCase())) {
        return c.json({ error: `status must be one of ${VALID_UNIT_STATUSES.join(', ')}`, code: 'INVALID_STATUS' }, 400);
      }
      sets.push(`${k} = ?`);
      params.push(k === 'capabilities' && v != null && typeof v !== 'string' ? JSON.stringify(v) : (v ?? null));
    }
    if (!sets.length) return c.json({ message: 'No changes' });
    sets.push("updated_at = datetime('now')");
    params.push(id);
    await execute(db, `UPDATE units SET ${sets.join(', ')} WHERE id = ?`, ...params);
    const updated = await queryFirst(db, 'SELECT * FROM units WHERE id = ?', id);
    try { if (updated) broadcastAll('dispatch_update', { action: 'unit_updated', unit: updated }); } catch { /* never break the write */ }
    return c.json(updated);
  } catch (err) {
    return c.json({ error: 'Failed to update unit' }, 500);
  }
});

// DELETE /dispatch/units/:id — admin/manager only. Validates the id, confirms
// the unit exists, and refuses to delete a unit currently assigned to a call
// (deleting it would orphan that unit id inside calls_for_service.assigned_unit_ids).
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
    await execute(db, 'DELETE FROM units WHERE id = ?', id);
    try { broadcastAll('dispatch_update', { action: 'unit_deleted', unit_id: id }); } catch { /* never break the write */ }
    return c.json({ message: 'Unit deleted', id });
  } catch (err) {
    return c.json({ error: 'Failed to delete unit' }, 500);
  }
});

// POST /dispatch/units/:id/dispose — admin/manager unit disposal.
// The plain DELETE refuses a unit that's still on a call (it would orphan the
// unit id inside calls_for_service.assigned_unit_ids). In practice units get
// STUCK with a stale current_call_id (e.g. an off-duty placeholder pinned to an
// old call), so an admin could never remove them. Disposal force-clears the
// call membership first, then either:
//   mode 'delete' (default) — permanently removes the unit row, or
//   mode 'retire'           — keeps the row for history but sets it
//                             out_of_service + frees it from the call (a soft,
//                             reversible decommission; flip status back to
//                             available to reinstate).
units.post('/:id/dispose', requireRole('admin', 'manager'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid unit id', code: 'INVALID_ID' }, 400);

    const body = await c.req.json<{ mode?: string }>().catch(() => ({} as { mode?: string }));
    const mode = body.mode === 'retire' ? 'retire' : 'delete';

    const unit = await queryFirst<{ id: number; call_sign: string; current_call_id: number | null }>(
      db, 'SELECT id, call_sign, current_call_id FROM units WHERE id = ?', id);
    if (!unit) return c.json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }, 404);

    // Force-clear the unit from its current call's assigned_unit_ids so the call
    // doesn't keep a phantom member. Best-effort; never block disposal on it.
    if (unit.current_call_id != null) {
      try {
        const call = await queryFirst<{ assigned_unit_ids: string }>(
          db, 'SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?', unit.current_call_id);
        if (call) {
          const remaining = (JSON.parse(call.assigned_unit_ids || '[]') as number[]).filter((u) => u !== id);
          await execute(db, 'UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?', JSON.stringify(remaining), unit.current_call_id);
        }
      } catch (err) { console.error('[dispatch] dispose: clear call membership:', err); }
    }

    const userId = c.get('userId') as number | undefined;
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';

    if (mode === 'retire') {
      await execute(db, "UPDATE units SET status = 'out_of_service', current_call_id = NULL, last_status_change = datetime('now'), updated_at = datetime('now') WHERE id = ?", id);
      const updated = await queryFirst<Record<string, any>>(db, 'SELECT * FROM units WHERE id = ?', id);
      try {
        if (updated) {
          broadcastAll('dispatch_update', { action: 'unit_status_changed', unit: updated });
          broadcastAll('dispatch_update', { action: 'unit_updated', unit: updated });
        }
      } catch { /* never break the write */ }
      try {
        if (userId != null) await execute(db,
          "INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'unit_retired', 'unit', ?, ?, ?)",
          userId, id, `Retired unit ${unit.call_sign}`, ip);
      } catch { /* audit is best-effort */ }
      return c.json({ message: 'Unit retired (out of service)', id, mode: 'retire', unit: updated });
    }

    // D1 enforces foreign keys. Two child tables reference units(id) with no
    // ON DELETE rule, so any child row makes `DELETE FROM units` fail with a FK
    // constraint error. Resolve dependents first:
    //   gps_breadcrumbs.unit_id is NOT NULL  → purge the unit's location trail.
    //   fleet_assignments.unit_id is nullable → detach (NULL) to keep the
    //     assignment-history row's call_sign/officer_name text intact.
    // These must succeed for the DELETE to proceed, so let failures surface to
    // the outer catch (logged) rather than swallowing them.
    await execute(db, 'DELETE FROM gps_breadcrumbs WHERE unit_id = ?', id);
    await execute(db, 'UPDATE fleet_assignments SET unit_id = NULL WHERE unit_id = ?', id);
    await execute(db, 'DELETE FROM units WHERE id = ?', id);
    try { broadcastAll('dispatch_update', { action: 'unit_deleted', unit_id: id }); } catch { /* never break the write */ }
    try {
      if (userId != null) await execute(db,
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'unit_deleted', 'unit', ?, ?, ?)",
        userId, id, `Disposed (deleted) unit ${unit.call_sign}`, ip);
    } catch { /* audit is best-effort */ }
    return c.json({ message: 'Unit disposed (deleted)', id, mode: 'delete' });
  } catch (err) {
    console.error('[dispatch] dispose unit failed:', err);
    return c.json({ error: 'Failed to dispose unit', code: 'UNIT_DISPOSE_ERROR' }, 500);
  }
});

// NOTE: unit↔call assignment is owned by calls.ts (`POST /dispatch/calls/:id/
// assign-unit`), which every client and the CAD command parser target. A
// divergent duplicate previously lived here at `/dispatch/units/assign-unit`
// (Set-dedup, no premise push, no double-assign cleanup, bare {message}
// response) that no client ever reached — removed to prevent silent drift.

export default units;
