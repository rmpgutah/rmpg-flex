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
import { recordAudit } from '../utils/auditLog';
import { codedLike } from '../utils/searchText';

import { dbErrorResponse } from '../utils/dbErrors';
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
         p.first_name AS subject_first_name, p.last_name AS subject_last_name, p.dob AS subject_dob,
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
      // D1 LIKE cap: pattern >50 chars silently returns nothing. codedLike
      // escapes (lengthens) the term, so cap the raw input low enough that
      // the escaped + wildcard-wrapped bind stays <=50.
      const rawSearch = q('search')!.trim().slice(0, 40);
      const ftLike = codedLike('u.force_type', rawSearch);
      where.push(`(${ftLike.sql} OR u.narrative LIKE ? OR u.justification LIKE ?
                   OR off.full_name LIKE ? OR p.last_name LIKE ?)`);
      const pat = `%${rawSearch}%`;
      params.push(...ftLike.binds, pat, pat, pat, pat);
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
         datetime('now'), datetime('now'))`,
      b.incident_id ?? null, userId, b.subject_person_id ?? null,
      b.force_type, b.force_level ?? null,
      b.justification ?? null, b.subject_injuries ?? null, b.officer_injuries ?? null,
      b.de_escalation_attempted ? 1 : 0, b.de_escalation_details ?? null, b.weapons_used ?? null,
      b.body_camera_active === false ? 0 : 1, witnesses, b.narrative ?? null);
    // Audit trail — UoF is a compliance document; record the submission.
    try {
      await recordAudit(c, { action: 'CREATE', entityType: 'use_of_force', entityId: r.meta.last_row_id, details: `Use of force report submitted (${b.force_type})`, actorId: userId });
    } catch { /* non-fatal */ }
    // ── FlexCam auto-preserve (best-effort, strictly additive). The officer's
    // unit isn't in scope here, so resolve it from the submitter; never throws
    // into the report flow — a preserve failure logs and is swallowed.
    // Fire-and-forget via waitUntil: the preserve issues ~11 sequential ClearPath
    // POSTs (7-min window) which must NOT delay the report response. waitUntil
    // also keeps the work alive after the response returns. The unit lookup runs
    // INSIDE _preserve; only the request-scoped ids are captured up front.
    const uofId = Number(r.meta.last_row_id);
    const preserveUserId = userId;
    const _preserve = (async () => {
      try {
        const unit = preserveUserId ? await queryFirst<{ id: number; current_call_id: number | null }>(getDb(c.env), 'SELECT id, current_call_id FROM units WHERE officer_id=? LIMIT 1', preserveUserId).catch(() => null) : null;
        const { preserveForEvent } = await import('../utils/footage/autoPreserve');
        await preserveForEvent(c.env, { eventType: 'use_of_force', eventId: uofId, reason: 'use_of_force', unitId: unit?.id ?? null, officerUserId: preserveUserId, callId: unit?.current_call_id ?? null, eventTs: Date.now() }); // new-date-ok
      } catch (e) { console.error('[flexcam-preserve] uof:', (e as Error)?.message); }
    })();
    try { c.executionCtx.waitUntil(_preserve); } catch { /* no execution ctx (e.g. tests) — let it float */ }
    return c.json({ success: true, id: r.meta.last_row_id }, 201);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to create report');
  }
});

// GET /api/use-of-force/:id — single-row fetch used by the page's deep-link
// fallback. The list endpoint pages at 50; a `?uof_id=` link can target a
// report that's not in the current page slice (or filtered out). This endpoint
// returns the same joined shape the list does so the page can hydrate the
// detail panel without re-paging.
uof.get('/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id') ?? '', 10);
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid report id', code: 'INVALID_ID' }, 400);
    const db = getDb(c.env);
    const row = await queryFirst<Record<string, unknown>>(db, `${REPORT_SELECT} WHERE u.id = ?`, id);
    if (!row) return c.json({ error: 'Report not found', code: 'NOT_FOUND' }, 404);
    return c.json(row);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to load report');
  }
});

// GET /api/use-of-force/:id/footage — linked body-cam + dashcam clips for
// court-package context. Resolves footage_evidence_links rows where
// entity_type='use_of_force' (populated by autoPreserve on submission) AND
// any bodycam_videos with a matching incident_id. Both feeds are best-effort
// — a UoF report can ship before/without footage, and the page must still
// render. Schema-tolerant: footage_requests + bodycam_videos may be missing
// columns on older D1 slices (we COALESCE / SELECT only known fields).
uof.get('/:id/footage', async (c) => {
  try {
    const id = parseInt(c.req.param('id') ?? '', 10);
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid report id', code: 'INVALID_ID' }, 400);
    const db = getDb(c.env);
    // Pull the UoF row to discover the linked incident_id (BWC linkage path).
    const uofRow = await queryFirst<{ incident_id: number | null }>(db,
      'SELECT incident_id FROM use_of_force WHERE id = ?', id).catch(() => null);
    const incidentId = uofRow?.incident_id ?? null;

    // FlexCam dashcam — preserved by autoPreserve at submission time.
    const flexcam = await query<Record<string, unknown>>(db,
      `SELECT fr.id, fr.title, fr.classification, fr.status, fr.evidence_locked,
              fr.evidence_number, fr.from_ts, fr.to_ts, fr.reason, fr.created_at
       FROM footage_evidence_links fel
       JOIN footage_requests fr ON fr.id = fel.footage_request_id
       WHERE fel.entity_type = 'use_of_force' AND fel.entity_id = ?
       ORDER BY fr.id DESC`, id).catch(() => []);

    // BWC clips — linked via incident_id where available. Older bodycam_videos
    // rows may lack incident_id; the IS NOT NULL guard avoids the empty match.
    let bodycam: Record<string, unknown>[] = [];
    if (incidentId != null) {
      bodycam = await query<Record<string, unknown>>(db,
        // bodycam_videos has no officer_name — resolve it off users.full_name.
        `SELECT v.id, v.title, v.classification, v.retention_status, v.recorded_at,
                v.duration_seconds, v.file_size, u.full_name AS officer_name,
                v.case_number, v.created_at
         FROM bodycam_videos v
         LEFT JOIN users u ON u.id = v.officer_id
         WHERE v.incident_id = ?
         ORDER BY v.recorded_at DESC`, incidentId).catch(() => []);
    }
    return c.json({ flexcam: flexcam || [], bodycam: bodycam || [] });
  } catch (err) {
    // Soft-fail: page renders the rest even if footage join fails.
    return c.json({ flexcam: [], bodycam: [] });
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
      `UPDATE use_of_force SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'),
              review_notes = COALESCE(?, review_notes), updated_at = datetime('now')
       WHERE id = ?`, status, userId, b.notes ?? null, id);
    try {
      await recordAudit(c, { action: 'REVIEW', entityType: 'use_of_force', entityId: id, details: `Use of force report ${b.decision}`, actorId: userId });
    } catch { /* non-fatal */ }
    const updated = await queryFirst<Record<string, unknown>>(db, `${REPORT_SELECT} WHERE u.id = ?`, id);
    return c.json({ success: true, report: updated });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to record review');
  }
});

export default uof;
