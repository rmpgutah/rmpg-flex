// ============================================================
// RMPG Flex — Investigative Tip Queue
// ============================================================
// Backs client/src/pages/TipsPage.tsx. Distinct from the anonymous
// community-portal `public_tips` table (src/routes/community.ts) —
// this is the detective-facing tracked/assigned/case-linked tip
// queue. Was a fully-built client page with zero matching route.
// Migration 0167_impounds_pawn_tips_crash_animal.sql.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const tips = new Hono<Env>();

const WRITE = ['admin', 'manager', 'supervisor', 'officer'];

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

async function generateTrackingNumber(db: ReturnType<typeof getDb>): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `INV-${yy}-`;
  const last = await queryFirst<{ tracking_number: string }>(
    db, 'SELECT tracking_number FROM investigative_tips WHERE tracking_number LIKE ? ORDER BY id DESC LIMIT 1', `${prefix}%`);
  let next = 1;
  if (last?.tracking_number) {
    const m = last.tracking_number.match(/^INV-\d{2}-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(next).padStart(4, '0')}`;
}

// GET / — list + stats, filterable by ?status= and ?search=
tips.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const status = c.req.query('status');
    const search = c.req.query('search');
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (status) { conditions.push('t.status = ?'); params.push(status); }
    if (search) {
      conditions.push('(t.tracking_number LIKE ? OR t.description LIKE ? OR t.location LIKE ?)');
      const s = `%${search}%`; params.push(s, s, s);
    }
    const where = conditions.join(' AND ');
    const rows = await query<Record<string, unknown>>(db, `
      SELECT t.*, u.full_name as assigned_to_name, ca.case_number as linked_case_number
      FROM investigative_tips t
      LEFT JOIN users u ON t.assigned_to = u.id
      LEFT JOIN cases ca ON t.linked_case_id = ca.id
      WHERE ${where} ORDER BY t.received_at DESC LIMIT 500
    `, ...params);
    const stats = await queryFirst<{ new_tips: number; reviewed: number; investigating: number; actionable: number }>(db, `
      SELECT
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_tips,
        SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) as reviewed,
        SUM(CASE WHEN status = 'investigating' THEN 1 ELSE 0 END) as investigating,
        SUM(CASE WHEN status = 'actionable' THEN 1 ELSE 0 END) as actionable
      FROM investigative_tips
    `);
    return c.json({
      data: rows,
      stats: {
        new_tips: stats?.new_tips ?? 0, reviewed: stats?.reviewed ?? 0,
        investigating: stats?.investigating ?? 0, actionable: stats?.actionable ?? 0,
      },
    });
  } catch (err) {
    return c.json({ error: 'Failed to list tips' }, 500);
  }
});

// GET /investigators — assignable users
tips.get('/investigators', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<{ id: number; name: string; username: string }>(db,
      `SELECT id, full_name as name, username FROM users WHERE role IN ('officer','supervisor','manager','admin') AND status = 'active' ORDER BY full_name`);
    return c.json(rows);
  } catch (err) {
    return c.json({ error: 'Failed to list investigators' }, 500);
  }
});

// POST / — create (also used for public tip → investigative tip promotion later)
tips.post('/', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, any>>();
    if (typeof b.description !== 'string' || !b.description.trim()) return c.json({ error: 'description required' }, 400);
    const trackingNumber = await generateTrackingNumber(db);
    const result = await execute(db,
      `INSERT INTO investigative_tips (tracking_number, tip_type, description, urgency, status, source, location, notes)
       VALUES (?,?,?,?,?,?,?,?)`,
      trackingNumber, b.tip_type ?? null, b.description, b.urgency ?? 'routine', b.status ?? 'new',
      b.source ?? null, b.location ?? null, b.notes ?? null,
    );
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM investigative_tips WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create tip' }, 500);
  }
});

// PUT /:id/status
tips.put('/:id/status', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const { status } = await c.req.json<{ status?: string }>();
    if (!status) return c.json({ error: 'status required' }, 400);
    const isReview = status === 'reviewed';
    const u = c.get('user') as { id: number } | undefined;
    await execute(db,
      `UPDATE investigative_tips SET status = ?, updated_at = datetime('now','localtime')${isReview ? ", reviewed_at = datetime('now','localtime'), reviewed_by = ?" : ''} WHERE id = ?`,
      ...(isReview ? [status, u?.id ?? null, id] : [status, id]),
    );
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to update status' }, 500);
  }
});

// PUT /:id/assign
tips.put('/:id/assign', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const { assigned_to } = await c.req.json<{ assigned_to?: string | number }>();
    await execute(db,
      `UPDATE investigative_tips SET assigned_to = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
      assigned_to ?? null, id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to assign tip' }, 500);
  }
});

// PUT /:id/link-case
tips.put('/:id/link-case', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const { case_number } = await c.req.json<{ case_number?: string }>();
    if (!case_number) return c.json({ error: 'case_number required' }, 400);
    const caseRow = await queryFirst<{ id: number }>(db, 'SELECT id FROM cases WHERE case_number = ?', case_number);
    if (!caseRow) return c.json({ error: 'Case not found' }, 404);
    await execute(db,
      `UPDATE investigative_tips SET linked_case_id = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
      caseRow.id, id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to link case' }, 500);
  }
});

export default tips;
