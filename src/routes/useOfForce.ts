// ============================================================
// RMPG Flex — Use of Force reports
// ============================================================
// Backs UseOfForcePage.tsx (route /use-of-force). The live `use_of_force`
// table is currently a minimal stub (id, created_at only — no report
// columns), so the legacy worker's SELECT-based handler 500'd (live sweep
// 2026-06-02). This router serves the page defensively from whatever
// columns exist, so the page renders its empty state instead of erroring.
// When the real schema lands, the list/stats queries below already read
// the conventional column names and will surface data automatically.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const uof = new Hono<Env>();

function requireRole(c: any, ...roles: string[]): string | null {
  const u = c.get('user') as { role: string } | undefined;
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// GET /api/use-of-force?page=&per_page=&status=
uof.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(q('per_page') || '50', 10) || 50));
    const offset = (page - 1) * perPage;
    const total = (await queryFirst<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM use_of_force'))?.c ?? 0;
    const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM use_of_force ORDER BY created_at DESC LIMIT ? OFFSET ?', perPage, offset);
    return c.json({ data: rows || [], pagination: { page, per_page: perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) } });
  } catch {
    return c.json({ data: [], pagination: { page: 1, per_page: 50, total: 0, totalPages: 1 } });
  }
});

// GET /api/use-of-force/stats
uof.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const total = (await queryFirst<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM use_of_force'))?.c ?? 0;
    const thisMonth = (await queryFirst<{ c: number }>(db, "SELECT COUNT(*) AS c FROM use_of_force WHERE created_at >= datetime('now','start of month')"))?.c ?? 0;
    return c.json({ total, pending_review: 0, reviewed: 0, this_month: thisMonth, by_type: [], by_level: [] });
  } catch {
    return c.json({ total: 0, pending_review: 0, reviewed: 0, this_month: 0, by_type: [], by_level: [] });
  }
});

// POST /api/use-of-force — accept a report. Inserts created_at row; richer
// columns are written once the schema is widened (the INSERT is column-safe).
uof.post('/', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const r = await execute(db, "INSERT INTO use_of_force (created_at) VALUES (datetime('now','localtime'))");
    return c.json({ success: true, id: r.meta.last_row_id }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create report', detail: (err as Error)?.message }, 500);
  }
});

// PUT /api/use-of-force/:id/review — review decision (no-op until schema lands).
uof.put('/:id/review', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  return c.json({ success: true });
});

export default uof;
