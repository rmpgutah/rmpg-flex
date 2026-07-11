// ============================================================
// RMPG Flex — Pawn Shop Transaction Tracking
// ============================================================
// Backs client/src/pages/PawnTrackingPage.tsx. Was a fully-built
// client page with zero matching route. Migration
// 0167_impounds_pawn_tips_crash_animal.sql.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const pawn = new Hono<Env>();

const WRITE = ['admin', 'manager', 'supervisor', 'officer'];

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// GET / — list, filterable by ?status= and ?search= (serial/name/item)
pawn.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const status = c.req.query('status');
    const search = c.req.query('search');
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (status) { conditions.push('status = ?'); params.push(status); }
    if (search) {
      conditions.push('(serial_number LIKE ? OR item_description LIKE ? OR seller_last_name LIKE ? OR seller_first_name LIKE ?)');
      const s = `%${search}%`; params.push(s, s, s, s);
    }
    const rows = await query<Record<string, unknown>>(
      db, `SELECT * FROM pawn_transactions WHERE ${conditions.join(' AND ')} ORDER BY transaction_date DESC LIMIT 500`, ...params);
    return c.json(rows);
  } catch (err) {
    return c.json({ error: 'Failed to list transactions' }, 500);
  }
});

// GET /search/stolen — held/flagged transactions cross-referenced as stolen
pawn.get('/search/stolen', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db, `SELECT * FROM pawn_transactions WHERE flagged_stolen = 1 ORDER BY transaction_date DESC LIMIT 200`);
    return c.json(rows);
  } catch (err) {
    return c.json({ error: 'Failed to search stolen matches' }, 500);
  }
});

// POST / — create
pawn.post('/', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, any>>();
    if (typeof b.shop_name !== 'string' || !b.shop_name.trim()) return c.json({ error: 'shop_name required' }, 400);
    if (typeof b.item_description !== 'string' || !b.item_description.trim()) return c.json({ error: 'item_description required' }, 400);
    const holdDays = b.hold_period_days ?? 30;
    const result = await execute(db,
      `INSERT INTO pawn_transactions (
        shop_name, shop_address, transaction_date, transaction_type, item_description, item_category,
        serial_number, brand, model, color,
        seller_first_name, seller_last_name, seller_dob, seller_id_type, seller_id_number, seller_address, seller_phone,
        hold_period_days, hold_expires, status, amount, notes, entered_by
      ) VALUES (?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?,?,?)`,
      b.shop_name, b.shop_address ?? null, b.transaction_date ?? null, b.transaction_type ?? 'pawn', b.item_description, b.item_category ?? null,
      b.serial_number ?? null, b.brand ?? null, b.model ?? null, b.color ?? null,
      b.seller_first_name ?? null, b.seller_last_name ?? null, b.seller_dob ?? null, b.seller_id_type ?? null, b.seller_id_number ?? null, b.seller_address ?? null, b.seller_phone ?? null,
      holdDays, b.hold_expires ?? null, b.status ?? 'held', b.amount ?? null, b.notes ?? null, b.entered_by ?? null,
    );
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM pawn_transactions WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create transaction' }, 500);
  }
});

// PUT /:id — update
pawn.put('/:id', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, any>>();
    const updatable = new Set([
      'shop_name', 'shop_address', 'transaction_date', 'transaction_type', 'item_description', 'item_category',
      'serial_number', 'brand', 'model', 'color',
      'seller_first_name', 'seller_last_name', 'seller_dob', 'seller_id_type', 'seller_id_number', 'seller_address', 'seller_phone',
      'hold_period_days', 'hold_expires', 'status', 'flagged_stolen', 'matched_evidence_id', 'amount', 'notes', 'entered_by',
    ]);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (!sets.length) return c.json({ error: 'No fields' }, 400);
    sets.push(`updated_at = datetime('now','localtime')`); vals.push(id);
    await execute(db, `UPDATE pawn_transactions SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM pawn_transactions WHERE id = ?', id);
    if (!updated) return c.json({ error: 'Not found' }, 404);
    return c.json(updated);
  } catch (err) {
    return c.json({ error: 'Failed to update transaction' }, 500);
  }
});

// POST /:id/flag — flag a transaction as tied to stolen property
pawn.post('/:id/flag', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const result = await execute(db,
      `UPDATE pawn_transactions SET flagged_stolen = 1, status = 'flagged', updated_at = datetime('now','localtime') WHERE id = ?`, id);
    if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM pawn_transactions WHERE id = ?', id);
    return c.json(updated);
  } catch (err) {
    return c.json({ error: 'Failed to flag transaction' }, 500);
  }
});

export default pawn;
