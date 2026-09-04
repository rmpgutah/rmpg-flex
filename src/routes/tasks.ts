// ============================================================
// RMPG Flex — Task / Work Management
// ============================================================
// Spillman Flex Task Management parity: assignments, comments,
// linked-entity tasks.
// Migration: 0047_spillman_modules.sql
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

import { log } from '../utils/logger';
const tasks = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// ═══════════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════════

tasks.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const tableCheck = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='task_assignments'");
    if (!tableCheck?.n) return c.json({ data: [], pagination: { page: 1, per_page: 50, total: 0, totalPages: 0 } });
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('status')) { conditions.push('t.status = ?'); params.push(q('status')); }
    if (q('priority')) { conditions.push('t.priority = ?'); params.push(q('priority')); }
    if (q('assigned_to')) { conditions.push('t.assigned_to = ?'); params.push(q('assigned_to')); }
    if (q('assigned_by')) { conditions.push('t.assigned_by = ?'); params.push(q('assigned_by')); }
    if (q('entity_type')) { conditions.push('t.linked_entity_type = ?'); params.push(q('entity_type')); }
    if (q('entity_id')) { conditions.push('t.linked_entity_id = ?'); params.push(q('entity_id')); }
    if (q('overdue') === 'true') { conditions.push("t.due_date < date('now') AND t.status NOT IN ('completed','cancelled')"); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(q('per_page') || '50', 10) || 50));
    const offset = (page - 1) * perPage;
    const count = await queryFirst<{ total: number }>(db, `SELECT COUNT(*) as total FROM task_assignments t ${where}`, ...params);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT t.*, to_u.full_name as assigned_to_name, by_u.full_name as assigned_by_name
       FROM task_assignments t
       LEFT JOIN users to_u ON t.assigned_to = to_u.id
       LEFT JOIN users by_u ON t.assigned_by = by_u.id
       ${where} ORDER BY CASE WHEN t.priority = 'urgent' THEN 0 WHEN t.priority = 'high' THEN 1 ELSE 2 END, t.due_date ASC, t.id DESC
       LIMIT ? OFFSET ?`, ...params, perPage, offset);
    const total = count?.total ?? 0;
    return c.json({ data: rows, pagination: { page, per_page: perPage, total, totalPages: Math.ceil(total / perPage) } });
  } catch (err) {
    log.error('GET / failed', { src: 'src/routes/tasks.ts' }, err);
    return c.json({ error: 'Failed to list tasks' }, 500);
  }
});

// NOTE: /stats MUST be registered before /:id — Hono matches in
// registration order, so a literal /stats declared after the parametric
// /:id is swallowed by it (parseInt('stats') = NaN → 400). That was the
// live `/api/tasks/stats` 400 (sweep 2026-06-02).
tasks.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const taskTable = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='task_assignments'");
    if (!taskTable?.n) return c.json({ total: 0, by_status: [], by_priority: [], overdue: 0 });
    const total = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM task_assignments'))?.count ?? 0;
    const pending = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM task_assignments WHERE status IN ('pending','in_progress')"))?.count ?? 0;
    const overdue = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM task_assignments WHERE due_date < date('now') AND status NOT IN ('completed','cancelled')"))?.count ?? 0;
    return c.json({ total, pending, overdue });
  } catch (err) {
    log.error('GET /stats failed', { src: 'src/routes/tasks.ts' }, err);
    return c.json({ error: 'Failed to load stats' }, 500);
  }
});

tasks.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID' }, 400);
    const row = await queryFirst<Record<string, unknown>>(db,
      `SELECT t.*, to_u.full_name as assigned_to_name, by_u.full_name as assigned_by_name
       FROM task_assignments t LEFT JOIN users to_u ON t.assigned_to = to_u.id LEFT JOIN users by_u ON t.assigned_by = by_u.id WHERE t.id = ?`, id);
    if (!row) return c.json({ error: 'Task not found' }, 404);
    return c.json({ data: row });
  } catch (err) {
    log.error('GET /:id failed', { src: 'src/routes/tasks.ts' }, err);
    return c.json({ error: 'Failed to get task' }, 500);
  }
});

tasks.post('/', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.task_title !== 'string' || !b.task_title.trim()) return c.json({ error: 'task_title required' }, 400);
    const result = await execute(db,
      `INSERT INTO task_assignments (task_title, description, task_type, priority, status, assigned_to, assigned_by, due_date, linked_entity_type, linked_entity_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.task_title, b.description ?? null, b.task_type ?? 'general', b.priority ?? 'normal',
      b.status ?? 'pending', b.assigned_to ?? null, userId, b.due_date ?? null,
      b.linked_entity_type ?? null, b.linked_entity_id ?? null, b.notes ?? null,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db,
      'SELECT t.*, to_u.full_name as assigned_to_name FROM task_assignments t LEFT JOIN users to_u ON t.assigned_to = to_u.id WHERE t.id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST / failed', { src: 'src/routes/tasks.ts' }, err);
    return c.json({ error: 'Failed to create task' }, 500);
  }
});

const TASK_UPDATABLE = new Set(['task_title','description','task_type','priority','status','assigned_to','due_date','completed_at','linked_entity_type','linked_entity_id','notes']);

tasks.put('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const existing = await queryFirst<{ id: number; status: string }>(db, 'SELECT id, status FROM task_assignments WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Task not found' }, 404);
    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (TASK_UPDATABLE.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (b.status === 'completed') { sets.push("completed_at = COALESCE(completed_at, datetime('now'))"); }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    sets.push(`updated_at = datetime('now')`); vals.push(id);
    await execute(db, `UPDATE task_assignments SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM task_assignments WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /:id failed', { src: 'src/routes/tasks.ts' }, err);
    return c.json({ error: 'Failed to update task' }, 500);
  }
});

tasks.delete('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    await execute(db, 'DELETE FROM task_comments WHERE task_id = ?', id);
    const result = await execute(db, 'DELETE FROM task_assignments WHERE id = ?', id);
    if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /:id failed', { src: 'src/routes/tasks.ts' }, err);
    return c.json({ error: 'Failed to delete task' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// COMMENTS
// ═══════════════════════════════════════════════════════════════

tasks.get('/:id/comments', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const rows = await query<Record<string, unknown>>(db,
      'SELECT tc.*, u.full_name as user_name FROM task_comments tc LEFT JOIN users u ON tc.user_id = u.id WHERE tc.task_id = ? ORDER BY tc.created_at', id);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /:id/comments failed', { src: 'src/routes/tasks.ts' }, err);
    return c.json({ error: 'Failed to list comments' }, 500);
  }
});

tasks.post('/:id/comments', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const userId = c.get('userId') as number | undefined;
    const b = await c.req.json<{ comment_text: string }>();
    if (typeof b.comment_text !== 'string' || !b.comment_text.trim()) return c.json({ error: 'comment_text required' }, 400);
    const result = await execute(db,
      'INSERT INTO task_comments (task_id, user_id, comment_text) VALUES (?, ?, ?)', id, userId, b.comment_text);
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db,
      'SELECT tc.*, u.full_name as user_name FROM task_comments tc LEFT JOIN users u ON tc.user_id = u.id WHERE tc.id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /:id/comments failed', { src: 'src/routes/tasks.ts' }, err);
    return c.json({ error: 'Failed to add comment' }, 500);
  }
});

export default tasks;
