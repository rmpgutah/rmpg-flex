// ============================================================
// RMPG Flex — Human Resources (Cloudflare Worker)
// ============================================================
// Phase 1 port of the legacy HR module — Leave, Disciplinary,
// Reviews, Benefits. Bucket I deferrals (payroll, exit interviews,
// grievances, PIPs, attendance, salary history, workers' comp,
// handbook acks, leave-balances-as-real-data) remain on legacy
// until the dedicated tables land.
//
// Tables on live D1 (un-prefixed, created via direct patches in
// PR #660 — NOT in /migrations/, see [[project-hr-tables-stub-created]]):
//   - leave_requests       (13 cols)
//   - disciplinary_records (15 cols)
//   - review_cycles        ( 6 cols)
//   - performance_reviews  (17 cols)
//
// hr_benefits intentionally NOT created — /benefits returns [] so
// the BenefitsTab renders an empty state instead of 500ing.
//
// Mounts at /api/hr (see src/routesConfig.ts, alphabetical slot
// between /api/grievances and /api/incidents — but only /api/hr
// today since the other two don't exist as rewrite ports yet).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';

const hr = new Hono<Env>();

// Role tiers
const MANAGER_ROLES = ['admin', 'manager', 'supervisor', 'human_resources'] as const;
const ALL_ROLES = [
  'admin', 'manager', 'supervisor', 'human_resources',
  'officer', 'dispatcher',
] as const;

// CHECK-constraint mirrors (kept tight; rejecting unknown values at
// the edge is cheaper than letting D1 raise a SQL error mid-write).
const LEAVE_TYPES = new Set(['vacation', 'sick', 'personal', 'bereavement', 'training', 'unpaid']);
const LEAVE_STATUSES = new Set(['pending', 'approved', 'denied', 'cancelled']);
const DISC_TYPES = new Set(['verbal_warning', 'written_warning', 'suspension', 'termination', 'commendation', 'counseling']);
const DISC_SEVERITIES = new Set(['minor', 'moderate', 'major', 'critical']);
const DISC_STATUSES = new Set(['open', 'closed', 'appealed']);
const REVIEW_TYPES = new Set(['annual', 'probationary', 'quarterly', 'improvement_plan']);
const REVIEW_STATUSES = new Set(['draft', 'submitted', 'acknowledged', 'completed']);

// Policy defaults for synthesized leave balances. Honest fiction:
// the live D1 has no per-officer balance table, so we expose a
// flat policy + actual usage (summed from approved leave_requests).
// When a real hr_leave_balances table lands, swap the synthesizer
// for a SELECT — handler signature stays the same.
const POLICY_TOTALS = { vacation: 80, sick: 40, personal: 24 };

// ── helpers ─────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }

function isManager(role: string) {
  return (MANAGER_ROLES as readonly string[]).includes(role);
}

// ── /benefits — deferred until hr_benefits table exists ─────

hr.get('/benefits', requireRole(...ALL_ROLES), async (c) => {
  // Empty list silences BenefitsTab's load() error toast and lets
  // the "no benefits enrolled" empty state render. Real handler
  // lands with the hr_benefits table in a follow-up.
  return c.json([]);
});

// ── /leave ──────────────────────────────────────────────────

// GET /hr/leave?officer_id=&status=
hr.get('/leave', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; role: string };
    const officerId = c.req.query('officer_id');
    const status = c.req.query('status');

    const where: string[] = [];
    const params: unknown[] = [];

    // Officers see only their own; managers see all unless filtered.
    if (!isManager(user.role)) {
      where.push('lr.officer_id = ?');
      params.push(user.id);
    } else if (officerId) {
      where.push('lr.officer_id = ?');
      params.push(Number(officerId));
    }
    if (status && LEAVE_STATUSES.has(status)) {
      where.push('lr.status = ?');
      params.push(status);
    }

    const sql = `
      SELECT lr.*, o.full_name AS officer_name, r.full_name AS reviewer_name
      FROM leave_requests lr
      LEFT JOIN users o ON o.id = lr.officer_id
      LEFT JOIN users r ON r.id = lr.reviewed_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY lr.created_at DESC
      LIMIT 500
    `;
    const rows = await query(db, sql, ...params);
    return c.json(rows);
  } catch (err) {
    console.error('[hr] GET /leave', err);
    return c.json({ error: 'Failed to load leave requests', code: 'HR_LEAVE_LIST_ERR' }, 500);
  }
});

// GET /hr/leave/balances?year=YYYY — synthesized from POLICY_TOTALS
// plus summed approved leave_requests.hours_requested per type.
hr.get('/leave/balances', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; role: string };
    const year = Number(c.req.query('year')) || new Date().getFullYear();

    // Manager sees all officers; officer sees only own row.
    const officerWhere = isManager(user.role) ? "u.status = 'active'" : 'u.id = ?';
    const officerParams: unknown[] = isManager(user.role) ? [] : [user.id];

    const officers = await query<{ id: number; full_name: string }>(
      db,
      `SELECT id, full_name FROM users WHERE ${officerWhere} ORDER BY full_name`,
      ...officerParams
    );

    if (officers.length === 0) return c.json([]);

    // Sum approved hours per (officer, type) for the requested year.
    // start_date is TEXT ISO so substr-based year extraction is fine.
    const idList = officers.map(o => o.id).join(',');
    const usage = await query<{ officer_id: number; type: string; used: number }>(
      db,
      `SELECT officer_id, type, COALESCE(SUM(hours_requested), 0) AS used
       FROM leave_requests
       WHERE status = 'approved'
         AND officer_id IN (${idList})
         AND substr(start_date, 1, 4) = ?
       GROUP BY officer_id, type`,
      String(year)
    );

    const usageByOfficer = new Map<number, Record<string, number>>();
    for (const u of usage) {
      const m = usageByOfficer.get(u.officer_id) ?? {};
      m[u.type] = Number(u.used) || 0;
      usageByOfficer.set(u.officer_id, m);
    }

    const result = officers.map(o => {
      const u = usageByOfficer.get(o.id) ?? {};
      return {
        id: o.id, // synthesized — no real balance row id
        officer_id: o.id,
        officer_name: o.full_name,
        year,
        vacation_total: POLICY_TOTALS.vacation,
        vacation_used: u.vacation ?? 0,
        sick_total: POLICY_TOTALS.sick,
        sick_used: u.sick ?? 0,
        personal_total: POLICY_TOTALS.personal,
        personal_used: u.personal ?? 0,
      };
    });
    return c.json(result);
  } catch (err) {
    console.error('[hr] GET /leave/balances', err);
    return c.json({ error: 'Failed to load leave balances', code: 'HR_LEAVE_BAL_ERR' }, 500);
  }
});

// POST /hr/leave — officer submits a request for themselves
hr.post('/leave', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const body = await c.req.json();
    const { type, start_date, end_date, hours_requested, reason } = body ?? {};

    if (!type || !LEAVE_TYPES.has(type)) return c.json({ error: 'Invalid leave type' }, 400);
    if (!start_date || !end_date) return c.json({ error: 'start_date and end_date required' }, 400);
    const hrs = Number(hours_requested);
    if (!Number.isFinite(hrs) || hrs <= 0) return c.json({ error: 'hours_requested must be > 0' }, 400);

    const now = nowIso();
    const res = await execute(db,
      `INSERT INTO leave_requests
        (officer_id, type, start_date, end_date, hours_requested, reason, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      user.id, type, start_date, end_date, hrs, reason ?? null, now, now
    );
    return c.json({ success: true, id: res.meta.last_row_id });
  } catch (err) {
    console.error('[hr] POST /leave', err);
    return c.json({ error: 'Failed to create leave request', code: 'HR_LEAVE_CREATE_ERR' }, 500);
  }
});

// PUT /hr/leave/:id — officer edits own pending request
hr.put('/leave/:id', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; role: string };
    const id = Number(c.req.param('id'));
    const body = await c.req.json();

    const row = await queryFirst<{ officer_id: number; status: string }>(
      db, 'SELECT officer_id, status FROM leave_requests WHERE id = ?', id
    );
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (!isManager(user.role) && row.officer_id !== user.id) {
      return c.json({ error: 'Cannot edit another officer\'s request' }, 403);
    }
    if (row.status !== 'pending') {
      return c.json({ error: 'Only pending requests can be edited' }, 400);
    }

    const { type, start_date, end_date, hours_requested, reason } = body ?? {};
    if (type && !LEAVE_TYPES.has(type)) return c.json({ error: 'Invalid leave type' }, 400);

    await execute(db,
      `UPDATE leave_requests
       SET type = COALESCE(?, type),
           start_date = COALESCE(?, start_date),
           end_date = COALESCE(?, end_date),
           hours_requested = COALESCE(?, hours_requested),
           reason = COALESCE(?, reason),
           updated_at = ?
       WHERE id = ?`,
      type ?? null,
      start_date ?? null,
      end_date ?? null,
      Number.isFinite(Number(hours_requested)) ? Number(hours_requested) : null,
      reason ?? null,
      nowIso(),
      id,
    );
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] PUT /leave/:id', err);
    return c.json({ error: 'Failed to update leave request', code: 'HR_LEAVE_UPDATE_ERR' }, 500);
  }
});

// DELETE /hr/leave/:id — owner cancels (still 'pending') OR manager cancels any
hr.delete('/leave/:id', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; role: string };
    const id = Number(c.req.param('id'));

    const row = await queryFirst<{ officer_id: number; status: string }>(
      db, 'SELECT officer_id, status FROM leave_requests WHERE id = ?', id
    );
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (!isManager(user.role) && row.officer_id !== user.id) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    await execute(db,
      `UPDATE leave_requests SET status = 'cancelled', updated_at = ? WHERE id = ?`,
      nowIso(), id
    );
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] DELETE /leave/:id', err);
    return c.json({ error: 'Failed to cancel leave request', code: 'HR_LEAVE_DEL_ERR' }, 500);
  }
});

// POST /hr/leave/:id/approve — manager only
hr.post('/leave/:id/approve', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const id = Number(c.req.param('id'));
    const now = nowIso();
    const res = await execute(db,
      `UPDATE leave_requests
       SET status = 'approved', reviewed_by = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
      user.id, now, now, id
    );
    if (res.meta.changes === 0) return c.json({ error: 'Not found or not pending' }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] PUT /leave/:id/approve', err);
    return c.json({ error: 'Failed to approve leave request', code: 'HR_LEAVE_APPROVE_ERR' }, 500);
  }
});

// POST /hr/leave/:id/deny — manager only; persists denial_reason
hr.post('/leave/:id/deny', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const id = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => ({} as any));
    const reason = body.denial_reason ?? body.reason ?? null;
    const now = nowIso();
    const res = await execute(db,
      `UPDATE leave_requests
       SET status = 'denied', reviewed_by = ?, reviewed_at = ?, denial_reason = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
      user.id, now, reason, now, id
    );
    if (res.meta.changes === 0) return c.json({ error: 'Not found or not pending' }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] PUT /leave/:id/deny', err);
    return c.json({ error: 'Failed to deny leave request', code: 'HR_LEAVE_DENY_ERR' }, 500);
  }
});

// ── /disciplinary ───────────────────────────────────────────

// GET /hr/disciplinary?officer_id=&status=
hr.get('/disciplinary', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const officerId = c.req.query('officer_id');
    const status = c.req.query('status');

    const where: string[] = [];
    const params: unknown[] = [];
    if (officerId) { where.push('dr.officer_id = ?'); params.push(Number(officerId)); }
    if (status && DISC_STATUSES.has(status)) { where.push('dr.status = ?'); params.push(status); }

    const sql = `
      SELECT dr.*, o.full_name AS officer_name, i.full_name AS issuer_name
      FROM disciplinary_records dr
      LEFT JOIN users o ON o.id = dr.officer_id
      LEFT JOIN users i ON i.id = dr.issued_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY dr.incident_date DESC, dr.id DESC
      LIMIT 500
    `;
    const rows = await query(db, sql, ...params);
    return c.json(rows);
  } catch (err) {
    console.error('[hr] GET /disciplinary', err);
    return c.json({ error: 'Failed to load disciplinary records', code: 'HR_DISC_LIST_ERR' }, 500);
  }
});

// GET /hr/disciplinary/:officerId/timeline
hr.get('/disciplinary/:officerId/timeline', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const officerId = Number(c.req.param('officerId'));
    const rows = await query(db,
      `SELECT dr.*, o.full_name AS officer_name, i.full_name AS issuer_name
       FROM disciplinary_records dr
       LEFT JOIN users o ON o.id = dr.officer_id
       LEFT JOIN users i ON i.id = dr.issued_by
       WHERE dr.officer_id = ?
       ORDER BY dr.incident_date DESC, dr.id DESC`,
      officerId
    );
    return c.json(rows);
  } catch (err) {
    console.error('[hr] GET /disciplinary/:officerId/timeline', err);
    return c.json({ error: 'Failed to load timeline', code: 'HR_DISC_TIMELINE_ERR' }, 500);
  }
});

// POST /hr/disciplinary — manager creates a record
hr.post('/disciplinary', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const body = await c.req.json();
    const {
      officer_id, type, severity, incident_date, description,
      action_taken, follow_up_date, follow_up_notes, witness, attachments,
    } = body ?? {};

    if (!officer_id) return c.json({ error: 'officer_id required' }, 400);
    if (!type || !DISC_TYPES.has(type)) return c.json({ error: 'Invalid type' }, 400);
    if (severity && !DISC_SEVERITIES.has(severity)) return c.json({ error: 'Invalid severity' }, 400);
    if (!incident_date) return c.json({ error: 'incident_date required' }, 400);
    if (!description) return c.json({ error: 'description required' }, 400);

    const now = nowIso();
    const attJson = Array.isArray(attachments) ? JSON.stringify(attachments) : '[]';
    const res = await execute(db,
      `INSERT INTO disciplinary_records
        (officer_id, type, severity, incident_date, description, action_taken,
         follow_up_date, follow_up_notes, status, issued_by, witness, attachments,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
      Number(officer_id), type, severity ?? null, incident_date, description,
      action_taken ?? null, follow_up_date ?? null, follow_up_notes ?? null,
      user.id, witness ?? null, attJson, now, now
    );
    return c.json({ success: true, id: res.meta.last_row_id });
  } catch (err) {
    console.error('[hr] POST /disciplinary', err);
    return c.json({ error: 'Failed to create record', code: 'HR_DISC_CREATE_ERR' }, 500);
  }
});

// PUT /hr/disciplinary/:id
hr.put('/disciplinary/:id', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const body = await c.req.json();
    const fields = ['type', 'severity', 'incident_date', 'description', 'action_taken',
      'follow_up_date', 'follow_up_notes', 'status', 'witness'];
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const f of fields) {
      if (f in body) {
        if (f === 'type' && !DISC_TYPES.has(body[f])) return c.json({ error: 'Invalid type' }, 400);
        if (f === 'severity' && body[f] && !DISC_SEVERITIES.has(body[f])) return c.json({ error: 'Invalid severity' }, 400);
        if (f === 'status' && !DISC_STATUSES.has(body[f])) return c.json({ error: 'Invalid status' }, 400);
        sets.push(`${f} = ?`);
        params.push(body[f]);
      }
    }
    if ('attachments' in body) {
      sets.push('attachments = ?');
      params.push(Array.isArray(body.attachments) ? JSON.stringify(body.attachments) : '[]');
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);
    sets.push('updated_at = ?');
    params.push(nowIso());
    params.push(id);

    const res = await execute(db,
      `UPDATE disciplinary_records SET ${sets.join(', ')} WHERE id = ?`,
      ...params
    );
    if (res.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] PUT /disciplinary/:id', err);
    return c.json({ error: 'Failed to update record', code: 'HR_DISC_UPDATE_ERR' }, 500);
  }
});

// DELETE /hr/disciplinary/:id
hr.delete('/disciplinary/:id', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const res = await execute(db, 'DELETE FROM disciplinary_records WHERE id = ?', id);
    if (res.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] DELETE /disciplinary/:id', err);
    return c.json({ error: 'Failed to delete record', code: 'HR_DISC_DEL_ERR' }, 500);
  }
});

// ── /reviews ────────────────────────────────────────────────

// GET /hr/reviews?officer_id=&status=&cycle_id=
hr.get('/reviews', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; role: string };
    const officerId = c.req.query('officer_id');
    const status = c.req.query('status');

    const where: string[] = [];
    const params: unknown[] = [];
    if (!isManager(user.role)) {
      where.push('pr.officer_id = ?');
      params.push(user.id);
    } else if (officerId) {
      where.push('pr.officer_id = ?');
      params.push(Number(officerId));
    }
    if (status && REVIEW_STATUSES.has(status)) {
      where.push('pr.status = ?');
      params.push(status);
    }

    const sql = `
      SELECT pr.*, o.full_name AS officer_name, r.full_name AS reviewer_name
      FROM performance_reviews pr
      LEFT JOIN users o ON o.id = pr.officer_id
      LEFT JOIN users r ON r.id = pr.reviewer_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY pr.review_period_end DESC, pr.id DESC
      LIMIT 500
    `;
    const rows = await query<Record<string, unknown>>(db, sql, ...params);
    // categories is TEXT JSON in D1; decode for the client
    for (const r of rows) {
      if (typeof r.categories === 'string') {
        try { r.categories = JSON.parse(r.categories); } catch { r.categories = {}; }
      }
    }
    return c.json(rows);
  } catch (err) {
    console.error('[hr] GET /reviews', err);
    return c.json({ error: 'Failed to load reviews', code: 'HR_REV_LIST_ERR' }, 500);
  }
});

// GET /hr/reviews/:id
hr.get('/reviews/:id', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; role: string };
    const id = Number(c.req.param('id'));
    const row = await queryFirst<Record<string, unknown>>(db,
      `SELECT pr.*, o.full_name AS officer_name, r.full_name AS reviewer_name
       FROM performance_reviews pr
       LEFT JOIN users o ON o.id = pr.officer_id
       LEFT JOIN users r ON r.id = pr.reviewer_id
       WHERE pr.id = ?`,
      id
    );
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (!isManager(user.role) && row.officer_id !== user.id) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    if (typeof row.categories === 'string') {
      try { row.categories = JSON.parse(row.categories); } catch { row.categories = {}; }
    }
    return c.json(row);
  } catch (err) {
    console.error('[hr] GET /reviews/:id', err);
    return c.json({ error: 'Failed to load review', code: 'HR_REV_GET_ERR' }, 500);
  }
});

// POST /hr/reviews — manager only
hr.post('/reviews', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const body = await c.req.json();
    const {
      officer_id, type, review_period_start, review_period_end, review_date,
      categories, overall_rating, strengths, areas_for_improvement, goals,
    } = body ?? {};

    if (!officer_id) return c.json({ error: 'officer_id required' }, 400);
    if (!type || !REVIEW_TYPES.has(type)) return c.json({ error: 'Invalid type' }, 400);
    if (!review_period_start || !review_period_end) {
      return c.json({ error: 'review_period_start and review_period_end required' }, 400);
    }

    const now = nowIso();
    const catJson = categories && typeof categories === 'object'
      ? JSON.stringify(categories)
      : '{}';
    const res = await execute(db,
      `INSERT INTO performance_reviews
        (officer_id, reviewer_id, review_period_start, review_period_end, review_date,
         type, overall_rating, categories, strengths, areas_for_improvement, goals,
         status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      Number(officer_id), user.id, review_period_start, review_period_end,
      review_date ?? null, type,
      Number.isFinite(Number(overall_rating)) ? Number(overall_rating) : null,
      catJson, strengths ?? null, areas_for_improvement ?? null, goals ?? null,
      now, now
    );
    return c.json({ success: true, id: res.meta.last_row_id });
  } catch (err) {
    console.error('[hr] POST /reviews', err);
    return c.json({ error: 'Failed to create review', code: 'HR_REV_CREATE_ERR' }, 500);
  }
});

// PUT /hr/reviews/:id — manager only
hr.put('/reviews/:id', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const body = await c.req.json();
    const fields = ['type', 'review_period_start', 'review_period_end', 'review_date',
      'overall_rating', 'strengths', 'areas_for_improvement', 'goals',
      'status', 'officer_comments'];
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const f of fields) {
      if (f in body) {
        if (f === 'type' && !REVIEW_TYPES.has(body[f])) return c.json({ error: 'Invalid type' }, 400);
        if (f === 'status' && !REVIEW_STATUSES.has(body[f])) return c.json({ error: 'Invalid status' }, 400);
        sets.push(`${f} = ?`);
        params.push(body[f]);
      }
    }
    if ('categories' in body) {
      sets.push('categories = ?');
      params.push(typeof body.categories === 'object' ? JSON.stringify(body.categories) : '{}');
    }
    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);
    sets.push('updated_at = ?');
    params.push(nowIso());
    params.push(id);

    const res = await execute(db,
      `UPDATE performance_reviews SET ${sets.join(', ')} WHERE id = ?`,
      ...params
    );
    if (res.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] PUT /reviews/:id', err);
    return c.json({ error: 'Failed to update review', code: 'HR_REV_UPDATE_ERR' }, 500);
  }
});

// DELETE /hr/reviews/:id — manager only
hr.delete('/reviews/:id', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const res = await execute(db, 'DELETE FROM performance_reviews WHERE id = ?', id);
    if (res.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] DELETE /reviews/:id', err);
    return c.json({ error: 'Failed to delete review', code: 'HR_REV_DEL_ERR' }, 500);
  }
});

// POST /hr/reviews/:id/acknowledge — the reviewed officer ack's
hr.post('/reviews/:id/acknowledge', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const id = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => ({} as any));

    const row = await queryFirst<{ officer_id: number }>(
      db, 'SELECT officer_id FROM performance_reviews WHERE id = ?', id
    );
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (row.officer_id !== user.id) {
      return c.json({ error: 'Only the reviewed officer can acknowledge' }, 403);
    }
    const now = nowIso();
    await execute(db,
      `UPDATE performance_reviews
       SET status = 'acknowledged', acknowledged_at = ?,
           officer_comments = COALESCE(?, officer_comments), updated_at = ?
       WHERE id = ?`,
      now, body.officer_comments ?? null, now, id
    );
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] POST /reviews/:id/acknowledge', err);
    return c.json({ error: 'Failed to acknowledge review', code: 'HR_REV_ACK_ERR' }, 500);
  }
});

export default hr;
