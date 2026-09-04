// ============================================================
// RMPG Flex — Asset / Equipment Management
// ============================================================
// Spillman Flex Asset Tracking parity: inventory, checkouts,
// weapons, ammunition, K9 records.
// Migration: 0047_spillman_modules.sql
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { containsAnyClause } from '../utils/searchText';

import { log } from '../utils/logger';
const assets = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// ═══════════════════════════════════════════════════════════════
// ASSET INVENTORY
// ═══════════════════════════════════════════════════════════════

assets.get('/inventory', async (c) => {
  try {
    const db = getDb(c.env);
    const tableCheck = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='asset_inventory'");
    if (!tableCheck?.n) return c.json({ data: [], pagination: { page: 1, per_page: 50, total: 0, totalPages: 0 } });
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q('type')) { conditions.push('asset_type = ?'); params.push(q('type')); }
    if (q('status')) { conditions.push('status = ?'); params.push(q('status')); }
    if (q('assigned_to')) { conditions.push('assigned_to = ?'); params.push(q('assigned_to')); }
    if (q('search')) { const m = containsAnyClause(['asset_tag', 'make', 'model']); conditions.push(m.sql); params.push(...m.binds(q('search')!)); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(q('per_page') || '50', 10) || 50));
    const offset = (page - 1) * perPage;
    const count = await queryFirst<{ total: number }>(db, `SELECT COUNT(*) as total FROM asset_inventory ${where}`, ...params);
    const rows = await query<Record<string, unknown>>(
      db, `SELECT a.*, u.full_name as assigned_to_name FROM asset_inventory a LEFT JOIN users u ON a.assigned_to = u.id ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`, ...params, perPage, offset,
    );
    const total = count?.total ?? 0;
    return c.json({ data: rows, pagination: { page, per_page: perPage, total, totalPages: Math.ceil(total / perPage) } });
  } catch (err) {
    log.error('GET /inventory failed', { src: 'src/routes/assets.ts' }, err);
    return c.json({ error: 'Failed to list assets' }, 500);
  }
});

assets.post('/inventory', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.asset_tag !== 'string' || !b.asset_tag.trim()) return c.json({ error: 'asset_tag required' }, 400);
    const result = await execute(db,
      `INSERT INTO asset_inventory (asset_tag, asset_type, make, model, serial_number, status, assigned_to, issued_date, purchase_date, purchase_cost, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.asset_tag, b.asset_type ?? 'other', b.make ?? null, b.model ?? null, b.serial_number ?? null,
      b.status ?? 'available', b.assigned_to ?? null, b.issued_date ?? null, b.purchase_date ?? null, b.purchase_cost ?? null, b.notes ?? null,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM asset_inventory WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /inventory failed', { src: 'src/routes/assets.ts' }, err);
    return c.json({ error: 'Failed to create asset' }, 500);
  }
});

const ASSET_UPDATABLE = new Set(['asset_tag','asset_type','make','model','serial_number','status','assigned_to','issued_date','return_date','purchase_date','purchase_cost','notes']);

assets.put('/inventory/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (ASSET_UPDATABLE.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    sets.push(`updated_at = datetime('now')`); vals.push(id);
    await execute(db, `UPDATE asset_inventory SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM asset_inventory WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /inventory/:id failed', { src: 'src/routes/assets.ts' }, err);
    return c.json({ error: 'Failed to update asset' }, 500);
  }
});

assets.delete('/inventory/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const result = await execute(db, 'DELETE FROM asset_inventory WHERE id = ?', id);
    if (result.meta.changes === 0) return c.json({ error: 'Asset not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /inventory/:id failed', { src: 'src/routes/assets.ts' }, err);
    return c.json({ error: 'Failed to delete asset', code: 'DELETE_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// CHECKOUTS
// ═══════════════════════════════════════════════════════════════

assets.get('/checkouts', async (c) => {
  try {
    const db = getDb(c.env);
    const assetId = c.req.query('asset_id');
    let where = '1=1'; const params: unknown[] = [];
    if (assetId) { where = 'co.asset_id = ?'; params.push(assetId); }
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT co.*, a.asset_tag, a.make, a.model, u.full_name as checked_out_to_name
       FROM asset_checkouts co
       LEFT JOIN asset_inventory a ON co.asset_id = a.id
       LEFT JOIN users u ON co.checked_out_to = u.id
       WHERE ${where} ORDER BY co.checkout_date DESC LIMIT 200`,
      ...params,
    );
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /checkouts failed', { src: 'src/routes/assets.ts' }, err);
    return c.json({ error: 'Failed to list checkouts' }, 500);
  }
});

assets.post('/checkouts', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number | undefined) ?? null;
    const b = await c.req.json<Record<string, unknown>>();
    if (!b.asset_id) return c.json({ error: 'asset_id required' }, 400);
    if (!b.checked_out_to) return c.json({ error: 'checked_out_to required' }, 400);
    const result = await execute(db,
      `INSERT INTO asset_checkouts (asset_id, checked_out_to, expected_return, condition_out, authorized_by, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      b.asset_id, b.checked_out_to, b.expected_return ?? null, b.condition_out ?? null, userId, b.notes ?? null,
    );
    await execute(db, 'UPDATE asset_inventory SET status = ? WHERE id = ?', 'issued', b.asset_id);
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db,
      'SELECT co.*, a.asset_tag FROM asset_checkouts co LEFT JOIN asset_inventory a ON co.asset_id = a.id WHERE co.id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /checkouts failed', { src: 'src/routes/assets.ts' }, err);
    return c.json({ error: 'Failed to create checkout' }, 500);
  }
});

assets.put('/checkouts/:id/return', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    await execute(db,
      `UPDATE asset_checkouts SET actual_return = datetime('now'), condition_in = ? WHERE id = ?`,
      b.condition_in ?? null, id,
    );
    const co = await queryFirst<{ asset_id: number }>(db, 'SELECT asset_id FROM asset_checkouts WHERE id = ?', id);
    if (co) await execute(db, 'UPDATE asset_inventory SET status = ? WHERE id = ?', 'available', co.asset_id);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM asset_checkouts WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /checkouts/:id/return failed', { src: 'src/routes/assets.ts' }, err);
    return c.json({ error: 'Failed to return asset' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// WEAPON INVENTORY
// ═══════════════════════════════════════════════════════════════

assets.get('/weapons', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db, 'SELECT w.*, u.full_name as assigned_to_name FROM weapon_inventory w LEFT JOIN users u ON w.assigned_to = u.id ORDER BY w.created_at DESC');
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /weapons failed', { src: 'src/routes/assets.ts' }, err);
    return c.json({ error: 'Failed to list weapons' }, 500);
  }
});

assets.post('/weapons', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.serial_number !== 'string' || !b.serial_number.trim()) return c.json({ error: 'serial_number required' }, 400);
    const result = await execute(db,
      `INSERT INTO weapon_inventory (weapon_type, make, model, caliber, serial_number, status, assigned_to, issued_date, last_qualified, next_qual_due, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.weapon_type ?? 'handgun', b.make ?? null, b.model ?? null, b.caliber ?? null, b.serial_number,
      b.status ?? 'armory', b.assigned_to ?? null, b.issued_date ?? null, b.last_qualified ?? null, b.next_qual_due ?? null, b.notes ?? null,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM weapon_inventory WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /weapons failed', { src: 'src/routes/assets.ts' }, err);
    return c.json({ error: 'Failed to register weapon' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// AMMUNITION
// ═══════════════════════════════════════════════════════════════

assets.get('/ammunition', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM ammunition_inventory ORDER BY created_at DESC');
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /ammunition failed', { src: 'src/routes/assets.ts' }, err);
    return c.json({ error: 'Failed to list ammunition' }, 500);
  }
});

assets.post('/ammunition', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.ammo_type !== 'string') return c.json({ error: 'ammo_type required' }, 400);
    const result = await execute(db,
      `INSERT INTO ammunition_inventory (ammo_type, caliber, manufacturer, lot_number, quantity_rounds, expiration_date, storage_location, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      b.ammo_type, b.caliber ?? null, b.manufacturer ?? null, b.lot_number ?? null, b.quantity_rounds ?? 0, b.expiration_date ?? null, b.storage_location ?? null, b.notes ?? null,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM ammunition_inventory WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /ammunition failed', { src: 'src/routes/assets.ts' }, err);
    return c.json({ error: 'Failed to log ammunition' }, 500);
  }
});

assets.put('/ammunition/:id/issue', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<{ quantity?: number; issued_to?: number }>();
    const current = await queryFirst<{ quantity_rounds: number }>(db, 'SELECT quantity_rounds FROM ammunition_inventory WHERE id = ?', id);
    if (!current) return c.json({ error: 'Not found' }, 404);
    const qty = Math.min(b.quantity ?? 0, current.quantity_rounds);
    if (qty <= 0) return c.json({ error: 'No quantity to issue' }, 400);
    await execute(db,
      `UPDATE ammunition_inventory SET quantity_rounds = quantity_rounds - ?, quantity_issued = quantity_issued + ?, issued_to = ?, issued_date = date('now') WHERE id = ?`,
      qty, qty, b.issued_to ?? null, id);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM ammunition_inventory WHERE id = ?', id);
    return c.json({ data: updated, issued: qty });
  } catch (err) {
    log.error('PUT /ammunition/:id/issue failed', { src: 'src/routes/assets.ts' }, err);
    return c.json({ error: 'Failed to issue ammunition' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// K9 RECORDS
// ═══════════════════════════════════════════════════════════════

assets.get('/k9', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      'SELECT k.*, u.full_name as handler_name FROM k9_records k LEFT JOIN users u ON k.handler_id = u.id ORDER BY k.created_at DESC');
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /k9 failed', { src: 'src/routes/assets.ts' }, err);
    return c.json({ error: 'Failed to list K9 records' }, 500);
  }
});

assets.post('/k9', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.k9_name !== 'string' || !b.k9_name.trim()) return c.json({ error: 'k9_name required' }, 400);
    const result = await execute(db,
      `INSERT INTO k9_records (k9_name, breed, handler_id, status, certified_date, cert_expiry, specialties, vet_last_visit, vet_next_due, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.k9_name, b.breed ?? null, b.handler_id ?? null, b.status ?? 'active', b.certified_date ?? null,
      b.cert_expiry ?? null, b.specialties ?? null, b.vet_last_visit ?? null, b.vet_next_due ?? null, b.notes ?? null,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM k9_records WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /k9 failed', { src: 'src/routes/assets.ts' }, err);
    return c.json({ error: 'Failed to register K9' }, 500);
  }
});

assets.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const assetTable = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='asset_inventory'");
    // Match the happy-path camelCase keys the client reads (was snake_case → tiles blank).
    if (!assetTable?.n) return c.json({ totalAssets: 0, issuedAssets: 0, totalWeapons: 0, activeK9: 0 });
    const totalAssets = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM asset_inventory'))?.count ?? 0;
    const issuedAssets = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM asset_inventory WHERE status = 'issued'"))?.count ?? 0;
    const totalWeapons = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM weapon_inventory'))?.count ?? 0;
    const activeK9 = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM k9_records WHERE status = 'active'"))?.count ?? 0;
    return c.json({ totalAssets, issuedAssets, totalWeapons, activeK9 });
  } catch (err) {
    log.error('GET /stats failed', { src: 'src/routes/assets.ts' }, err);
    return c.json({ error: 'Failed to load stats' }, 500);
  }
});

export default assets;
