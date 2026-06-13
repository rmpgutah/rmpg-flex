// src/routes/serveBilling.ts
// ============================================================
// RMPG Flex — Process Service Contracts billing
// Pricing rate card, per-contract PS terms, computed serve
// charges (review-gated), and invoice generation from charges.
// Mounted at /api/billing alongside billing.ts (Hono path-matches).
// Migration: 0104_process_service_billing.sql
// ============================================================
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const psb = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}
const MANAGE = ['admin', 'manager', 'contract_manager'];
const REVIEW = ['admin', 'manager', 'contract_manager', 'supervisor'];

async function logAudit(db: ReturnType<typeof getDb>, userId: number | null, action: string, entityType: string, entityId: number | null, details: unknown) {
  try {
    await execute(db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`,
      userId, action, entityType, entityId, JSON.stringify(details ?? {}));
  } catch { /* audit must never break the write */ }
}

// ── Pricing rate card ──────────────────────────────────────
psb.get('/ps-pricing/items', async (c) => {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM ps_pricing_items ORDER BY sort_order, id');
  return c.json({ data: rows });
});

psb.post('/ps-pricing/items', async (c) => {
  const denied = requireRole(c, ...MANAGE);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const b = await c.req.json<any>();
  if (!b.code || !b.label) return c.json({ error: 'code and label required' }, 400);
  const user = c.get('user') as { id: number } | undefined;
  const ins = await execute(db,
    `INSERT INTO ps_pricing_items (code, label, unit, amount, taxable, attempts_included, sort_order, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    b.code, b.label, b.unit ?? 'per_serve', Number(b.amount) || 0, b.taxable ? 1 : 0,
    Number(b.attempts_included) || 0, Number(b.sort_order) || 0, user?.id ?? null);
  const id = Number(ins.meta.last_row_id);
  await logAudit(db, user?.id ?? null, 'create', 'ps_pricing_item', id, b);
  const created = await queryFirst(db, 'SELECT * FROM ps_pricing_items WHERE id = ?', id);
  return c.json({ data: created }, 201);
});

psb.put('/ps-pricing/items/:id', async (c) => {
  const denied = requireRole(c, ...MANAGE);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const before = await queryFirst<any>(db, 'SELECT * FROM ps_pricing_items WHERE id = ?', id);
  if (!before) return c.json({ error: 'Not found' }, 404);
  const b = await c.req.json<any>();
  const user = c.get('user') as { id: number } | undefined;
  await execute(db,
    `UPDATE ps_pricing_items SET
       label = ?, unit = ?, amount = ?, taxable = ?, attempts_included = ?, is_active = ?, sort_order = ?,
       updated_at = datetime('now','localtime'), updated_by = ?
     WHERE id = ?`,
    b.label ?? before.label, b.unit ?? before.unit,
    b.amount !== undefined ? Number(b.amount) : before.amount,
    b.taxable !== undefined ? (b.taxable ? 1 : 0) : before.taxable,
    b.attempts_included !== undefined ? Number(b.attempts_included) : before.attempts_included,
    b.is_active !== undefined ? (b.is_active ? 1 : 0) : before.is_active,
    b.sort_order !== undefined ? Number(b.sort_order) : before.sort_order,
    user?.id ?? null, id);
  await logAudit(db, user?.id ?? null, 'update', 'ps_pricing_item', id, { before, after: b });
  const after = await queryFirst(db, 'SELECT * FROM ps_pricing_items WHERE id = ?', id);
  return c.json({ data: after });
});

psb.delete('/ps-pricing/items/:id', async (c) => {
  const denied = requireRole(c, ...MANAGE);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const user = c.get('user') as { id: number } | undefined;
  // Soft-delete: charges reference codes historically.
  await execute(db, `UPDATE ps_pricing_items SET is_active = 0, updated_at = datetime('now','localtime'), updated_by = ? WHERE id = ?`, user?.id ?? null, id);
  await logAudit(db, user?.id ?? null, 'deactivate', 'ps_pricing_item', id, {});
  return c.json({ success: true });
});

// Suppress unused variable warning for REVIEW (reserved for future charge-review endpoints)
void REVIEW;

export default psb;
