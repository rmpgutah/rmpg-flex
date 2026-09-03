import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

import { dbErrorResponse } from '../utils/dbErrors';
import { log } from '../utils/logger';
import { containsAnyClause } from '../utils/searchText';
const properties = new Hono<Env>();

// Mirrors the sentinel logic in records.ts. properties.client_id is NOT NULL,
// so a null/0 client_id must resolve to the "Unaffiliated" sentinel rather than
// failing with a constraint error.
async function resolvePropertyClientId(db: D1Database, raw: unknown): Promise<number> {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  const found = await queryFirst<{ id: number }>(db, "SELECT id FROM clients WHERE name = 'Unaffiliated — No Client' LIMIT 1");
  if (found) return found.id;
  const result = await execute(db,
    "INSERT INTO clients (name, contact_name, status, notes) VALUES ('Unaffiliated — No Client', 'system', 'active', 'Auto-created for hand-entered property records with no parent client. Do not delete — used as the default client_id for those rows.')");
  return Number(result.meta.last_row_id);
}

// GET /records/properties
properties.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const { search, client_id } = c.req.query();
    let sql = 'SELECT p.*, c.name as client_name FROM properties p LEFT JOIN clients c ON p.client_id = c.id';
    const params: unknown[] = [];
    const wheres: string[] = [];
    if (search) { const m = containsAnyClause(['p.name', 'p.address']); wheres.push(m.sql); params.push(...m.binds(search)); }
    if (client_id) { wheres.push('p.client_id = ?'); params.push(client_id); }
    if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
    sql += ' ORDER BY p.name LIMIT 500';
    const rows = await query<Record<string, unknown>>(db, sql, ...params);
    return c.json(rows);
  } catch (err) {
    log.error('GET / failed', { src: 'src/routes/properties.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// POST /records/properties — create a property.
properties.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.name || !body.address) return c.json({ error: 'name and address required' }, 400);
    const result = await execute(db,
      `INSERT INTO properties (client_id, name, address, property_type, latitude, longitude, gate_code, alarm_code, emergency_contact, post_orders, hazard_notes, city, state, zip, notes, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      await resolvePropertyClientId(db, body.client_id), body.name, body.address, body.property_type || null,
      body.latitude || null, body.longitude || null, body.gate_code || null,
      body.alarm_code || null, body.emergency_contact || null, body.post_orders || null,
      body.hazard_notes || null, body.city || null, body.state || null, body.zip || null,
      body.notes || null, body.is_active ?? 1);
    const created = await queryFirst(db, 'SELECT * FROM properties WHERE id = ?', Number(result.meta.last_row_id));
    return c.json(created, 201);
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

// GET /records/properties/export — MUST be registered BEFORE '/:id'. Hono's
// SmartRouter falls back to the order-sensitive TrieRouter on the static-vs-param
// overlap, so '/:id' (registered first) would otherwise shadow this with id='export'.
properties.get('/export', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, 'SELECT p.*, c.name as client_name FROM properties p LEFT JOIN clients c ON p.client_id = c.id ORDER BY p.name LIMIT 50000');
    if (rows.length === 0) return c.json([]);
    const keys = Object.keys(rows[0] as object);
    const csv = [keys.join(','), ...rows.map((r: any) => keys.map((k: string) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    return c.newResponse(csv, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=properties_export.csv' });
  } catch (err) {
    log.error('GET /export failed', { src: 'src/routes/properties.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// GET /records/properties/:id
properties.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const row = await queryFirst<Record<string, unknown>>(db, 'SELECT p.*, c.name as client_name FROM properties p LEFT JOIN clients c ON p.client_id = c.id WHERE p.id = ?', id);
    if (!row) return c.json({ error: 'Property not found' }, 404);
    return c.json(row);
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
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
      'secondary_contact_phone', 'utility_shutoffs',
      // Assessor-sourced columns (migration 0142). `year_built` was already
      // writable above (pre-existing column from 0037); the rest are new.
      'parcel_number', 'owner_of_record', 'owner_type', 'owner_mailing_address',
      'total_market_value', 'land_sqft',
      'last_sale_date', 'last_sale_price', 'legal_description', 'tax_district',
      'assessor_last_synced_at', 'assessor_source_url']);
    const cols: string[] = []; const params: unknown[] = [];
    for (const [key, val] of Object.entries(body)) {
      if (!writable.has(key)) continue;
      if (key === 'client_id') { cols.push('client_id = ?'); params.push(await resolvePropertyClientId(db, val)); }
      else { cols.push(`${key} = ?`); params.push(val ?? null); }
    }
    if (cols.length === 0) return c.json({ message: 'No changes' });
    cols.push("updated_at = datetime('now')");
    await execute(db, `UPDATE properties SET ${cols.join(', ')} WHERE id = ?`, ...params, id);
    const updated = await queryFirst(db, 'SELECT * FROM properties WHERE id = ?', id);
    return c.json(updated);
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
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
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
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
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
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
  } catch (err) { return dbErrorResponse(c, err, 'Failed'); }
});

export default properties;
