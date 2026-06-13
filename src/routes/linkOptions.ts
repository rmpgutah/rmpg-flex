// Configurable linkage option lists. Read endpoint feeds dispatch dropdowns;
// admin CRUD (added in a later task) edits the same link_options table.
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, execute, queryFirst } from '../utils/db';
import { requireRole } from '../middleware/auth';

const CATEGORIES = ['person_role', 'vehicle_role', 'caller_relationship', 'business_role'] as const;

// Read router — mounted at /api/dispatch → GET /api/dispatch/link-options.
export const linkOptions = new Hono<Env>();

linkOptions.get('/link-options', async (c) => {
  try {
    const db = getDb(c.env);
    // Return ALL rows (active AND inactive) with the is_active flag — the CLIENT
    // merge needs to SEE an inactive default row to hide it. Filtering is_active=1
    // here would simply omit a hidden default, leaving its hardcoded default
    // visible (hide would silently no-op).
    const rows = await query<{ category: string; value: string; label: string; sort_order: number; is_active: number }>(
      db,
      `SELECT category, value, label, sort_order, is_active
         FROM link_options
        ORDER BY category, sort_order`,
    );
    const grouped: Record<string, unknown[]> = {};
    for (const cat of CATEGORIES) grouped[cat] = [];
    for (const r of rows) (grouped[r.category] ||= []).push(r);
    return c.json(grouped);
  } catch {
    // Table missing / not yet applied to live → empty groups; client falls back
    // to its hardcoded defaults. Never 500 the dropdowns.
    return c.json({ person_role: [], vehicle_role: [], caller_relationship: [], business_role: [] });
  }
});

// Admin router — mounted at /api/admin/link-options. admin/manager only.
export const linkOptionsAdmin = new Hono<Env>();

// GET (all rows incl. inactive, for the editor)
linkOptionsAdmin.get('/', requireRole('admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const rows = await query<Record<string, unknown>>(
    db, 'SELECT * FROM link_options ORDER BY category, sort_order',
  );
  return c.json(rows);
});

// POST — add a custom option { category, value, label, sort_order? }
linkOptionsAdmin.post('/', requireRole('admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const b = await c.req.json<{ category: string; value: string; label: string; sort_order?: number }>();
  if (!b.category || !b.value || !b.label) return c.json({ error: 'category, value, label required' }, 400);
  await execute(
    db,
    `INSERT OR IGNORE INTO link_options (category, value, label, sort_order, is_active, is_default)
     VALUES (?, ?, ?, ?, 1, 0)`,
    b.category, b.value.trim(), b.label.trim(), b.sort_order ?? 500,
  );
  const row = await queryFirst(db, 'SELECT * FROM link_options WHERE category = ? AND value = ?', b.category, b.value.trim());
  return c.json(row, 201);
});

// PATCH /:id — edit label / sort_order / is_active
linkOptionsAdmin.patch('/:id', requireRole('admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const b = await c.req.json<{ label?: string; sort_order?: number; is_active?: number }>();
  const sets: string[] = []; const params: unknown[] = [];
  if (b.label !== undefined) { sets.push('label = ?'); params.push(b.label); }
  if (b.sort_order !== undefined) { sets.push('sort_order = ?'); params.push(b.sort_order); }
  if (b.is_active !== undefined) { sets.push('is_active = ?'); params.push(b.is_active ? 1 : 0); }
  if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  await execute(db, `UPDATE link_options SET ${sets.join(', ')} WHERE id = ?`, ...params);
  const row = await queryFirst(db, 'SELECT * FROM link_options WHERE id = ?', id);
  return c.json(row);
});

// DELETE /:id — hard-delete custom rows only; defaults are hidden, not deleted.
linkOptionsAdmin.delete('/:id', requireRole('admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const row = await queryFirst<{ is_default: number }>(db, 'SELECT is_default FROM link_options WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.is_default) {
    await execute(db, "UPDATE link_options SET is_active = 0, updated_at = datetime('now') WHERE id = ?", id);
    return c.json({ success: true, hidden: true });
  }
  await execute(db, 'DELETE FROM link_options WHERE id = ?', id);
  return c.json({ success: true, deleted: true });
});
