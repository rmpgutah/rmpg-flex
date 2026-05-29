import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { requireRole } from '../../middleware/auth';

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

    const { call_sign, officer_id, vehicle_id, capabilities } = body;
    const result = await execute(db,
      'INSERT INTO units (call_sign, officer_id, vehicle_id, capabilities) VALUES (?, ?, ?, ?)',
      call_sign, officer_id || null, vehicle_id || null, JSON.stringify(capabilities || [])
    );
    const unit = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM units WHERE id = ?', Number(result.meta.last_row_id));
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
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (['id', 'created_at'].includes(k)) continue;
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
    return c.json({ message: 'Unit deleted', id });
  } catch (err) {
    return c.json({ error: 'Failed to delete unit' }, 500);
  }
});

// POST /dispatch/calls/:callId/assign-unit
units.post('/assign-unit', async (c) => {
  try {
    const db = getDb(c.env);
    const { call_id, unit_id } = await c.req.json<{ call_id: number; unit_id: number }>();
    const call = await queryFirst<{ assigned_unit_ids: string }>(db, 'SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?', call_id);
    if (!call) return c.json({ error: 'Call not found' }, 404);
    const assigned = new Set(JSON.parse(call.assigned_unit_ids || '[]') as number[]);
    assigned.add(unit_id);
    await execute(db, 'UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?', JSON.stringify([...assigned]), call_id);
    await execute(db, "UPDATE units SET status = 'dispatched', current_call_id = ? WHERE id = ?", call_id, unit_id);
    return c.json({ message: 'Unit assigned' });
  } catch (err) { return c.json({ error: 'Assign failed' }, 500); }
});

export default units;
