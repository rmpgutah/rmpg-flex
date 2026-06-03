// ============================================================
// RMPG Flex — Skiptracer (Cloudflare Worker)
// ============================================================
// Read-only surface over the legacy skiptracer tables. Replaces the
// proxy stubs that PR #667 used to silence /api/skiptracer/{status,stats}
// while there was no rewrite handler yet. The legacy v2 worker still
// owns POST /api/skiptracer/search (the actual Microbilt round-trip);
// this router just exposes what's already in D1.
//
// Tables read:
//   skiptracer_dossiers — manually-built subject dossiers
//   microbilt_searches  — every Microbilt round-trip the legacy worker logged
//
// Why this isn't a thin proxy passthrough: the dossier list and stats
// endpoints are hit on dashboard mount, polling at 30s intervals. A
// proxy round-trip to legacy adds ~150ms per poll for the same data
// that's already in the (rewrite-side) D1 connection — collapse it.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';

const skiptracer = new Hono<Env>();

function requireRole(
  c: { get: (k: 'user') => { role: string } | undefined },
  ...roles: string[]
): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// GET /status — dashboard polls this on mount. The rewrite has no
// external job-state store, so "running" can't be detected truthfully;
// hardcode 'idle' per the task spec rather than fabricating state.
skiptracer.get('/status', async (c) => {
  try {
    const db = getDb(c.env);
    const last = await queryFirst<{ last_run: string | null }>(
      db,
      `SELECT MAX(created_at) as last_run FROM microbilt_searches`,
    );
    return c.json({
      status: 'idle',
      running_searches: 0,
      last_run: last?.last_run ?? null,
    });
  } catch (err) {
    return c.json({
      error: 'Failed to get skiptracer status',
      code: 'STATUS_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// GET /stats — dashboard tile + Skiptracer page header
skiptracer.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const total = (await queryFirst<{ count: number }>(
      db, `SELECT COUNT(*) as count FROM microbilt_searches`,
    ))?.count ?? 0;

    // SQLite-style "start of current month" — locked to localtime to
    // match the column default. Avoids timezone drift between INSERT
    // and SELECT that bit us on call_number generation.
    const thisMonth = (await queryFirst<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM microbilt_searches
       WHERE created_at >= strftime('%Y-%m-01 00:00:00', 'now', 'localtime')`,
    ))?.count ?? 0;

    // subject_name aliased to `name` so the client doesn't need a
    // schema-aware mapping layer — matches the field name the legacy
    // proxy stub was returning.
    const recent = await query<Record<string, unknown>>(
      db,
      `SELECT id, subject_name AS name, created_at
         FROM skiptracer_dossiers
        ORDER BY created_at DESC
        LIMIT 10`,
    );

    return c.json({
      total_searches: total,
      searches_this_month: thisMonth,
      recent_dossiers: recent,
    });
  } catch (err) {
    return c.json({
      error: 'Failed to get skiptracer stats',
      code: 'STATS_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// GET /dossiers — paginated list, admin/manager only.
// Cap per_page at 50 (the table can hold large search_results JSON
// per row; even 100 rows × ~50 KB blob is a 5 MB response).
skiptracer.get('/dossiers', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(50, Math.max(1, parseInt(q('per_page') || '25', 10) || 25));
    const offset = (page - 1) * perPage;

    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    const status = q('status');
    if (status) { conditions.push('status = ?'); params.push(status); }
    const search = q('search');
    if (search) {
      conditions.push('(subject_name LIKE ? OR notes LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const countRow = await queryFirst<{ total: number }>(
      db, `SELECT COUNT(*) as total FROM skiptracer_dossiers ${where}`, ...params,
    );

    // Deliberately NOT selecting search_results in the list — it can
    // be a multi-MB JSON blob per row. Detail endpoint serves it.
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT sd.id, sd.subject_name, sd.subject_dob, sd.notes, sd.status,
              sd.created_by, sd.created_at, sd.updated_at,
              u.full_name AS created_by_name
         FROM skiptracer_dossiers sd
         LEFT JOIN users u ON sd.created_by = u.id
         ${where}
         ORDER BY sd.created_at DESC, sd.id DESC
         LIMIT ? OFFSET ?`,
      ...params, perPage, offset,
    );

    const total = countRow?.total ?? 0;
    return c.json({
      data: rows,
      pagination: {
        page, per_page: perPage, total,
        totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0,
      },
    });
  } catch (err) {
    return c.json({
      error: 'Failed to list dossiers',
      code: 'DOSSIERS_LIST_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// GET /dossiers/:id — single dossier, admin/manager only.
// search_results is a JSON string column on disk; surface it as
// parsed JSON when possible so the client doesn't double-parse.
skiptracer.get('/dossiers/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

    const row = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT sd.*, u.full_name AS created_by_name
         FROM skiptracer_dossiers sd
         LEFT JOIN users u ON sd.created_by = u.id
         WHERE sd.id = ?`,
      id,
    );
    if (!row) return c.json({ error: 'Dossier not found', code: 'NOT_FOUND' }, 404);

    if (typeof row.search_results === 'string' && row.search_results) {
      try { row.search_results = JSON.parse(row.search_results); }
      catch { /* leave as-is; client tolerates raw string */ }
    }
    return c.json({ data: row });
  } catch (err) {
    return c.json({
      error: 'Failed to get dossier',
      code: 'DOSSIER_GET_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

export default skiptracer;
