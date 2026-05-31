import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const properties = new Hono<Env>();

// GET /records/properties
properties.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const { search, client_id } = c.req.query();
    let sql = 'SELECT p.*, c.name as client_name FROM properties p LEFT JOIN clients c ON p.client_id = c.id';
    const params: unknown[] = [];
    const wheres: string[] = [];
    if (search) { wheres.push('(p.name LIKE ? OR p.address LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    if (client_id) { wheres.push('p.client_id = ?'); params.push(client_id); }
    if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
    sql += ' ORDER BY p.name LIMIT 500';
    const rows = await query<Record<string, unknown>>(db, sql, ...params);
    return c.json(rows);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// POST /records/properties — create a property.
properties.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.name || !body.address) return c.json({ error: 'name and address required' }, 400);
    const result = await execute(db,
      `INSERT INTO properties (client_id, name, address, property_type, latitude, longitude, gate_code, alarm_code, emergency_contact, post_orders, hazard_notes, city, state, zip, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      body.client_id ?? 1, body.name, body.address, body.property_type || null,
      body.latitude || null, body.longitude || null, body.gate_code || null,
      body.alarm_code || null, body.emergency_contact || null, body.post_orders || null,
      body.hazard_notes || null, body.city || null, body.state || null, body.zip || null,
      body.notes || null);
    const created = await queryFirst(db, 'SELECT * FROM properties WHERE id = ?', Number(result.meta.last_row_id));
    return c.json(created, 201);
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// GET /records/properties/:id
properties.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const row = await queryFirst<Record<string, unknown>>(db, 'SELECT p.*, c.name as client_name FROM properties p LEFT JOIN clients c ON p.client_id = c.id WHERE p.id = ?', id);
    if (!row) return c.json({ error: 'Property not found' }, 404);
    return c.json(row);
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// PUT /records/properties/:id
properties.put('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM properties WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Property not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    const writable = new Set(['client_id', 'name', 'address', 'property_type', 'latitude', 'longitude',
      'gate_code', 'alarm_code', 'emergency_contact', 'post_orders', 'hazard_notes',
      'city', 'state', 'zip', 'access_instructions', 'notes', 'business_type',
      'structure_type', 'occupancy_status', 'year_built', 'square_footage',
      'number_of_stories', 'security_features', 'key_holder_name', 'key_holder_phone',
      'key_holder_relationship', 'owner_name', 'owner_phone', 'is_active',
      'alarm_account', 'alarm_company', 'alarm_system', 'camera_system',
      'closing_hours', 'contact_email', 'opening_hours', 'parking_info',
      'patrol_frequency', 'roof_access', 'secondary_contact_name',
      'secondary_contact_phone', 'utility_shutoffs']);
    const cols: string[] = []; const params: unknown[] = [];
    for (const [key, val] of Object.entries(body)) { if (writable.has(key)) { cols.push(`${key} = ?`); params.push(val ?? null); } }
    if (cols.length === 0) return c.json({ message: 'No changes' });
    cols.push("updated_at = datetime('now')");
    await execute(db, `UPDATE properties SET ${cols.join(', ')} WHERE id = ?`, ...params, id);
    const updated = await queryFirst(db, 'SELECT * FROM properties WHERE id = ?', id);
    return c.json(updated);
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// DELETE /records/properties/:id
properties.delete('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM properties WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Property not found' }, 404);
    await execute(db, 'DELETE FROM properties WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// POST /records/properties/:id/archive — soft-delete via archived_at column.
properties.post('/:id/archive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number; archived_at: string | null }>(db, 'SELECT id, archived_at FROM properties WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Property not found' }, 404);
    if (existing.archived_at) return c.json({ message: 'Already archived' });
    await execute(db, "UPDATE properties SET archived_at = datetime('now') WHERE id = ?", id);
    return c.json({ success: true, archived: true });
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// POST /records/properties/:id/unarchive
properties.post('/:id/unarchive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number; archived_at: string | null }>(db, 'SELECT id, archived_at FROM properties WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Property not found' }, 404);
    if (!existing.archived_at) return c.json({ message: 'Not archived' });
    await execute(db, 'UPDATE properties SET archived_at = NULL WHERE id = ?', id);
    return c.json({ success: true, archived: false });
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// GET /records/properties/export
properties.get('/export', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, 'SELECT p.*, c.name as client_name FROM properties p LEFT JOIN clients c ON p.client_id = c.id ORDER BY p.name LIMIT 50000');
    if (rows.length === 0) return c.json([]);
    const keys = Object.keys(rows[0] as object);
    const csv = [keys.join(','), ...rows.map((r: any) => keys.map((k: string) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    return c.newResponse(csv, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=properties_export.csv' });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

export default properties;
