// ============================================================
// RMPG Flex — Use of Force reports
// ============================================================
// Backs UseOfForcePage.tsx (route /use-of-force). HISTORY: the live
// `use_of_force` table was a stub (id, created_at only) and this router's
// POST inserted nothing but created_at — every field officers entered was
// silently discarded while the UI showed success. Migration 0087 (applied
// directly to live 785de7ae on 2026-06-10) widened the table to the real
// report schema; this router now persists the full report, serves the list
// with officer/subject/incident/reviewer joins, real stats, and a review
// flow that actually records the supervisor's decision.
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

// Joined SELECT used by both the list and single-row reads. Matches the
// UofReport interface the page renders (officer_name/badge, subject names,
// incident_number/type, reviewer_name).
const REPORT_SELECT = `
  SELECT u.*,
         off.full_name AS officer_name, off.badge_number AS officer_badge,
         p.first_name AS subject_first_name, p.last_name AS subject_last_name, p.date_of_birth AS subject_dob,
         i.incident_number, i.incident_type,
         rev.full_name AS reviewer_name
  FROM use_of_force u
  LEFT JOIN users off ON off.id = u.officer_id
  LEFT JOIN persons p ON p.id = u.subject_person_id
  LEFT JOIN incidents i ON i.id = u.incident_id
  LEFT JOIN users rev ON rev.id = u.reviewed_by`;

// GET /api/use-of-force?page=&per_page=&status=&search=
uof.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(q('per_page') || '50', 10) || 50));
    const offset = (page - 1) * perPage;

    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q('status')) { where.push('u.status = ?'); params.push(q('status')); }
    if (q('search')) {
      where.push(`(u.force_type LIKE ? OR u.narrative LIKE ? OR u.justification LIKE ?
                   OR off.full_name LIKE ? OR p.last_name LIKE ?)`);
      const pat = `%${q('search')}%`;
      params.push(pat, pat, pat, pat, pat);
    }
    const whereSql = where.join(' AND ');

    const total = (await queryFirst<{ c: number }>(db,
      `SELECT COUNT(*) AS c FROM use_of_force u
       LEFT JOIN users off ON off.id = u.officer_id
       LEFT JOIN persons p ON p.id = u.subject_person_id
       WHERE ${whereSql}`, ...params))?.c ?? 0;
    const rows = await query<Record<string, unknown>>(db,
      `${REPORT_SELECT} WHERE ${whereSql} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      ...params, perPage, offset);
    return c.json({ data: rows || [], pagination: { page, per_page: perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) } });
  } catch (err) {
    console.error('GET /use-of-force failed:', err);
    return c.json({ data: [], pagination: { page: 1, per_page: 50, total: 0, totalPages: 1 } });
  }
});

// GET /api/use-of-force/stats
uof.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const total = (await queryFirst<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM use_of_force'))?.c ?? 0;
    const pending = (await queryFirst<{ c: number }>(db, "SELECT COUNT(*) AS c FROM use_of_force WHERE COALESCE(status,'submitted') IN ('submitted','draft')"))?.c ?? 0;
    const reviewed = (await queryFirst<{ c: number }>(db, "SELECT COUNT(*) AS c FROM use_of_force WHERE status = 'reviewed'"))?.c ?? 0;
    const thisMonth = (await queryFirst<{ c: number }>(db, "SELECT COUNT(*) AS c FROM use_of_force WHERE created_at >= datetime('now','start of month')"))?.c ?? 0;
    const byType = await query<Record<string, unknown>>(db,
      "SELECT force_type, COUNT(*) AS count FROM use_of_force WHERE force_type IS NOT NULL GROUP BY force_type ORDER BY count DESC");
    const byLevel = await query<Record<string, unknown>>(db,
      "SELECT force_level, COUNT(*) AS count FROM use_of_force WHERE force_level IS NOT NULL GROUP BY force_level ORDER BY count DESC");
    return c.json({ total, pending_review: pending, reviewed, this_month: thisMonth, by_type: byType, by_level: byLevel });
  } catch {
    return c.json({ total: 0, pending_review: 0, reviewed: 0, this_month: 0, by_type: [], by_level: [] });
  }
});

// POST /api/use-of-force — persist the FULL report. officer_id is the
// authenticated submitter; witness_officers arrives as an array (JSON-encoded
// for storage); booleans are coerced to 0/1.
uof.post('/', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = (c.get('user') as { id: number } | undefined)?.id ?? null;
    const b = await c.req.json<Record<string, unknown>>();
    if (!b.force_type || typeof b.force_type !== 'string') {
      return c.json({ error: 'force_type is required', code: 'MISSING_FORCE_TYPE' }, 400);
    }
    const witnesses = Array.isArray(b.witness_officers) ? JSON.stringify(b.witness_officers)
      : typeof b.witness_officers === 'string' ? b.witness_officers : '[]';
    const r = await execute(db,
      `INSERT INTO use_of_force (
         incident_id, officer_id, subject_person_id, force_type, force_level,
         justification, subject_injuries, officer_injuries,
         de_escalation_attempted, de_escalation_details, weapons_used,
         body_camera_active, witness_officers, narrative, status,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted',
         datetime('now','localtime'), datetime('now','localtime'))`,
      b.incident_id ?? null, userId, b.subject_person_id ?? null,
      b.force_type, b.force_level ?? null,
      b.justification ?? null, b.subject_injuries ?? null, b.officer_injuries ?? null,
      b.de_escalation_attempted ? 1 : 0, b.de_escalation_details ?? null, b.weapons_used ?? null,
      b.body_camera_active === false ? 0 : 1, witnesses, b.narrative ?? null);
    // Audit trail — UoF is a compliance document; record the submission.
    try {
      await execute(db,
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at)
         VALUES (?, 'CREATE', 'use_of_force', ?, ?, datetime('now'))`,
        userId, r.meta.last_row_id, `Use of force report submitted (${b.force_type})`);
    } catch { /* non-fatal */ }
    return c.json({ success: true, id: r.meta.last_row_id }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create report', detail: (err as Error)?.message }, 500);
  }
});

// PUT /api/use-of-force/:id/review — supervisor decision. The page sends
// { decision: 'approved' | 'returned' }; approved maps to status 'reviewed'
// (the page's STATUS_COLORS green state), returned stays 'returned'.
uof.put('/:id/review', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') ?? '', 10);
    if (isNaN(id)) return c.json({ error: 'Invalid report id', code: 'INVALID_ID' }, 400);
    const b = await c.req.json<{ decision?: string; notes?: string }>().catch(() => ({} as { decision?: string; notes?: string }));
    const status = b.decision === 'approved' ? 'reviewed'
      : b.decision === 'returned' ? 'returned' : null;
    if (!status) return c.json({ error: "decision must be 'approved' or 'returned'", code: 'INVALID_DECISION' }, 400);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM use_of_force WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Report not found', code: 'NOT_FOUND' }, 404);
    const userId = (c.get('user') as { id: number } | undefined)?.id ?? null;
    await execute(db,
      `UPDATE use_of_force SET status = ?, reviewed_by = ?, reviewed_at = datetime('now','localtime'),
              review_notes = COALESCE(?, review_notes), updated_at = datetime('now','localtime')
       WHERE id = ?`, status, userId, b.notes ?? null, id);
    try {
      await execute(db,
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at)
         VALUES (?, 'REVIEW', 'use_of_force', ?, ?, datetime('now'))`,
        userId, id, `Use of force report ${b.decision}`);
    } catch { /* non-fatal */ }
    const updated = await queryFirst<Record<string, unknown>>(db, `${REPORT_SELECT} WHERE u.id = ?`, id);
    return c.json({ success: true, report: updated });
  } catch (err) {
    return c.json({ error: 'Failed to record review', detail: (err as Error)?.message }, 500);
  }
});

export default uof;
