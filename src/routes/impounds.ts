// ============================================================
// RMPG Flex — Impound Lot Management
// ============================================================
// Backs client/src/pages/ImpoundPage.tsx. Was a fully-built client
// page with zero matching route — every request 404'd. Migration
// 0167_impounds_pawn_tips_crash_animal.sql.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

import { log } from '../utils/logger';
const impounds = new Hono<Env>();

const WRITE = ['admin', 'manager', 'supervisor', 'officer'];

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

// GET / — list, optionally filtered by ?status=
impounds.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const status = c.req.query('status');
    const where = status ? 'WHERE status = ?' : '';
    const params = status ? [status] : [];
    const rows = await query<Record<string, unknown>>(
      db, `SELECT * FROM impounds ${where} ORDER BY impound_date DESC LIMIT 500`, ...params);
    return c.json(rows);
  } catch (err) {
    log.error('GET / failed', { src: 'src/routes/impounds.ts' }, err);
    return c.json({ error: 'Failed to list impounds' }, 500);
  }
});

// GET /stats — counts per status
impounds.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<{ status: string; count: number }>(
      db, 'SELECT status, COUNT(*) as count FROM impounds GROUP BY status');
    return c.json(rows);
  } catch (err) {
    log.error('GET /stats failed', { src: 'src/routes/impounds.ts' }, err);
    return c.json({ error: 'Failed to load stats' }, 500);
  }
});

// POST / — create
impounds.post('/', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, any>>();
    if (typeof b.reason !== 'string' || !b.reason.trim()) return c.json({ error: 'reason required' }, 400);
    const result = await execute(db,
      `INSERT INTO impounds (
        vehicle_year, vehicle_make, vehicle_model, vehicle_color, vehicle_vin,
        license_plate, license_state, tow_company, tow_driver, lot_location, lot_space,
        reason, authority, hold_flag, hold_reason, daily_fee, tow_fee, status,
        owner_name, owner_phone, owner_notified, owner_notified_date,
        call_id, incident_id, officer_id, photos, property_inventory, notes
      ) VALUES (?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?)`,
      b.vehicle_year ?? null, b.vehicle_make ?? null, b.vehicle_model ?? null, b.vehicle_color ?? null, b.vehicle_vin ?? null,
      b.license_plate ?? null, b.license_state ?? null, b.tow_company ?? null, b.tow_driver ?? null, b.lot_location ?? null, b.lot_space ?? null,
      b.reason, b.authority ?? null, b.hold_flag ?? 0, b.hold_reason ?? null, b.daily_fee ?? 25, b.tow_fee ?? 150, b.status ?? 'impounded',
      b.owner_name ?? null, b.owner_phone ?? null, b.owner_notified ?? 0, b.owner_notified_date ?? null,
      b.call_id ?? null, b.incident_id ?? null, b.officer_id ?? null, b.photos ?? null, b.property_inventory ?? null, b.notes ?? null,
    );
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM impounds WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) {
    log.error('POST / failed', { src: 'src/routes/impounds.ts' }, err);
    return c.json({ error: 'Failed to create impound' }, 500);
  }
});

// PUT /:id — update
impounds.put('/:id', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const b = await c.req.json<Record<string, any>>();
    const updatable = new Set([
      'vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_color', 'vehicle_vin',
      'license_plate', 'license_state', 'tow_company', 'tow_driver', 'lot_location', 'lot_space',
      'reason', 'authority', 'hold_flag', 'hold_reason', 'daily_fee', 'tow_fee', 'status',
      'owner_name', 'owner_phone', 'owner_notified', 'owner_notified_date',
      'call_id', 'incident_id', 'officer_id', 'photos', 'property_inventory', 'notes',
    ]);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (!sets.length) return c.json({ error: 'No fields' }, 400);
    sets.push(`updated_at = datetime('now')`); vals.push(id);
    await execute(db, `UPDATE impounds SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM impounds WHERE id = ?', id);
    if (!updated) return c.json({ error: 'Not found' }, 404);
    return c.json(updated);
  } catch (err) {
    log.error('PUT /:id failed', { src: 'src/routes/impounds.ts' }, err);
    return c.json({ error: 'Failed to update impound' }, 500);
  }
});

// PUT /:id/release — release the vehicle, computing days stored + total fees
impounds.put('/:id/release', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const b = await c.req.json<{ released_to?: string; release_notes?: string }>().catch(() => ({} as { released_to?: string; release_notes?: string }));
    const row = await queryFirst<{ impound_date: string; daily_fee: number; tow_fee: number }>(
      db, 'SELECT impound_date, daily_fee, tow_fee FROM impounds WHERE id = ?', id);
    if (!row) return c.json({ error: 'Not found' }, 404);
    const days = daysSince(row.impound_date);
    const totalFees = (days * (row.daily_fee || 0)) + (row.tow_fee || 0);
    await execute(db,
      `UPDATE impounds SET status = 'released', release_date = datetime('now'),
        days_stored = ?, total_fees = ?, released_to = ?, release_notes = ?,
        updated_at = datetime('now') WHERE id = ?`,
      days, totalFees, b.released_to ?? null, b.release_notes ?? null, id,
    );
    return c.json({ days, total_fees: totalFees });
  } catch (err) {
    log.error('PUT /:id/release failed', { src: 'src/routes/impounds.ts' }, err);
    return c.json({ error: 'Failed to release impound' }, 500);
  }
});

export default impounds;
