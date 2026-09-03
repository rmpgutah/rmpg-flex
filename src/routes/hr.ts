// ============================================================
// RMPG Flex — Human Resources (Cloudflare Worker)
// ============================================================
// Full port of the legacy HR module — Leave, Disciplinary, Reviews,
// Payroll, Grievances, Documents, Attendance, PIPs. All tables
// are created via migration 0157_hr_tables_complete.sql (see
// CLAUDE.md gotcha #6 for apply instructions).
//
// Leave, disciplinary, reviews live on D1 tables created in PR #660:
//   - leave_requests       (13 cols)
//   - disciplinary_records (15 cols)
//   - review_cycles        ( 6 cols)
//   - performance_reviews  (17 cols)
//
// Payroll, Grievances, Documents, Attendance, PIPs created by
// migration 0157. hr_benefits intentionally NOT created — /benefits
// returns [] so BenefitsTab renders empty state instead of 500ing.
//
// Mounts at /api/hr (auth: required, see src/routesConfig.ts).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, executeInChunks, queryInChunks, ensureHrTables } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { populatePayrollFromClocks, denverToday } from '../utils/corporateWorkflows';

const hr = new Hono<Env>();

// Ensure all HR D1 tables exist before any route runs. The deploy step is
// continue-on-error so migration 0157 may not have reached live D1.
// ensureHrTables() is idempotent and caches via a module-level flag.
hr.use('*', async (c, next) => {
  await ensureHrTables(c.env.DB);
  await next();
});

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
// Mirrors BENEFIT_TYPES / COVERAGE_LABELS in
// client/src/pages/hr/tabs/BenefitsTab.tsx — keep the two in step.
const BENEFIT_TYPES = new Set(['health', 'dental', 'vision', 'life', '401k', 'hsa', 'fsa', 'disability', 'other']);
const COVERAGE_LEVELS = new Set(['individual', 'individual_spouse', 'family']);

// Policy defaults for synthesized leave balances. Honest fiction:
// the live D1 has no per-officer balance table, so we expose a
// flat policy + actual usage (summed from approved leave_requests).
// When a real hr_leave_balances table lands, swap the synthesizer
// for a SELECT — handler signature stays the same.
const POLICY_TOTALS = { vacation: 80, sick: 40, personal: 24 };

// ── helpers ─────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }

const OVERTIME_THRESHOLD_HOURS = 40;

// Auto-split regular hours over the weekly OT threshold into overtime, but
// only when the caller didn't explicitly supply overtime_hours themselves —
// a manager who deliberately typed both fields (e.g. correcting a prior
// entry) is trusted over the auto-split. Previously regular_hours and
// overtime_hours were both just whatever a manager typed with no threshold
// check at all.
function applyOvertimeThreshold(
  regularHours: number,
  overtimeHours: number | undefined | null,
): { regular_hours: number; overtime_hours: number } {
  if (overtimeHours != null || !Number.isFinite(regularHours) || regularHours <= OVERTIME_THRESHOLD_HOURS) {
    return { regular_hours: regularHours, overtime_hours: overtimeHours ?? 0 };
  }
  return { regular_hours: OVERTIME_THRESHOLD_HOURS, overtime_hours: regularHours - OVERTIME_THRESHOLD_HOURS };
}

function isManager(role: string) {
  return (MANAGER_ROLES as readonly string[]).includes(role);
}

// ── /dashboard — HRDashboardTab summary ─────────────────────
// Aggregated from the live HR tables (leave_requests / disciplinary_records)
// + users headcount. Each metric is independently fail-safe so one missing
// column can't zero the whole card; training/credential compliance stay 0
// until those tables land. Was 404 (no handler) → HrPage dashboard blank.
hr.get('/dashboard', requireRole(...ALL_ROLES), async (c) => {
  const db = getDb(c.env);
  const n = async (sql: string): Promise<number> => {
    try { const r = await queryFirst<{ n: number }>(db, sql); return r?.n ?? 0; } catch { return 0; }
  };
  // Nullable percentage: null means "nothing is being tracked yet", which is a
  // different fact from 0% and must not be rendered as one.
  const pct = async (sql: string): Promise<number | null> => {
    try {
      const r = await queryFirst<{ pct: number | null }>(db, sql);
      return r?.pct ?? null;
    } catch { return null; }
  };
  let recent_activity: unknown[] = [];
  try {
    recent_activity = await query(db,
      `SELECT lr.id, 'leave_request' AS type,
              ('Leave (' || COALESCE(lr.type,'') || ') ' || COALESCE(lr.status,'')) AS description,
              COALESCE(u.full_name,'') AS officer_name, lr.created_at
       FROM leave_requests lr LEFT JOIN users u ON u.id = lr.officer_id
       ORDER BY lr.created_at DESC LIMIT 8`);
  } catch { recent_activity = []; }
  return c.json({
    total_active: await n("SELECT COUNT(*) n FROM users WHERE COALESCE(status,'active') != 'terminated'"),
    new_hires_30d: await n("SELECT COUNT(*) n FROM users WHERE created_at >= datetime('now','-30 days')"),
    on_leave_today: await n("SELECT COUNT(*) n FROM leave_requests WHERE status='approved' AND date('now') BETWEEN date(start_date) AND date(end_date)"),
    pending_approvals: await n("SELECT COUNT(*) n FROM leave_requests WHERE status='pending'"),
    clocked_in_now: await n("SELECT COUNT(*) n FROM time_entries WHERE clock_out IS NULL"),
    scheduled_today: (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) n FROM schedules WHERE shift_date = ? AND status != 'cancelled'`, denverToday()).catch(() => ({ n: 0 })))?.n ?? 0,
    unattended_today: (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) n FROM schedules s WHERE s.shift_date = ? AND s.status != 'cancelled' AND NOT EXISTS (SELECT 1 FROM time_entries te WHERE te.officer_id = s.officer_id AND (date(te.clock_in) = s.shift_date OR date(te.clock_in_local) = s.shift_date))`, denverToday()).catch(() => ({ n: 0 })))?.n ?? 0,
    // These were hardcoded 0 with a comment saying they'd stay that way "until
    // those tables land" — but officer_certifications, training_courses and
    // training_enrollments all exist on live. Same stale-comment trap as the
    // Benefits handler. Now computed, and null (not 0) when there is nothing to
    // measure: a real 0% and "no requirements defined" look identical on a
    // progress bar, and 0 trips the UI's amber "out of compliance" colour, so
    // an untracked department was being reported as failing.
    //
    // Training: the requirement set is every active officer × every mandatory
    // active course; the numerator is distinct completed enrolments for those.
    training_compliance_pct: await pct(`
      SELECT CASE WHEN req.pairs = 0 THEN NULL
                  ELSE CAST(ROUND(100.0 * done.completed / req.pairs) AS INTEGER) END AS pct
        FROM (SELECT (SELECT COUNT(*) FROM users WHERE COALESCE(status,'active') = 'active')
                   * (SELECT COUNT(*) FROM training_courses
                       WHERE is_mandatory = 1 AND COALESCE(is_active,1) = 1) AS pairs) req,
             (SELECT COUNT(DISTINCT e.officer_id || '-' || e.course_id) AS completed
                FROM training_enrollments e
                JOIN training_courses c ON c.id = e.course_id
               WHERE c.is_mandatory = 1 AND COALESCE(c.is_active,1) = 1
                 AND LOWER(COALESCE(e.status,'')) = 'completed') done`),
    // Credentials: share of certifications carrying an expiry that are current.
    credential_compliance_pct: await pct(`
      SELECT CASE WHEN COUNT(*) = 0 THEN NULL
                  ELSE CAST(ROUND(100.0 * SUM(CASE WHEN date(expiration_date) >= date('now')
                                                   THEN 1 ELSE 0 END) / COUNT(*)) AS INTEGER) END AS pct
        FROM officer_certifications WHERE expiration_date IS NOT NULL`),
    overdue_items: await n("SELECT COUNT(*) n FROM disciplinary_records WHERE status='open'"),
    recent_activity,
  });
});

// ── /benefits ───────────────────────────────────────────────
// Backed by hr_benefits (migration 0217). This used to be a stub returning a
// hardcoded [] "until the hr_benefits table exists", and POST did not exist at
// all — so BenefitsTab's Add-benefit submit 404'd and reported only "Failed to
// add benefit". Visibility mirrors /leave and /disciplinary: an officer sees
// only their own enrolment, managers see everyone.

// GET /hr/benefits?officer_id=&status=&benefit_type=
hr.get('/benefits', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; role: string };
    const officerId = c.req.query('officer_id');
    const status = c.req.query('status');
    const benefitType = c.req.query('benefit_type');

    const where: string[] = [];
    const params: unknown[] = [];

    if (!isManager(user.role)) {
      where.push('b.officer_id = ?');
      params.push(user.id);
    } else if (officerId) {
      where.push('b.officer_id = ?');
      params.push(Number(officerId));
    }
    if (status) { where.push('b.status = ?'); params.push(status); }
    if (benefitType && BENEFIT_TYPES.has(benefitType)) {
      where.push('b.benefit_type = ?');
      params.push(benefitType);
    }

    const rows = await query(db,
      `SELECT b.*, o.full_name AS officer_name
         FROM hr_benefits b
         LEFT JOIN users o ON o.id = b.officer_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY b.effective_date DESC, b.id DESC
        LIMIT 1000`,
      ...params);
    return c.json(rows);
  } catch (err) {
    console.error('[hr] GET /benefits', err);
    return c.json({ error: 'Failed to load benefits', code: 'HR_BENEFITS_ERR' }, 500);
  }
});

// POST /hr/benefits — manager enrols an officer in a plan
hr.post('/benefits', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const body = await c.req.json();
    const {
      officer_id, benefit_type, plan_name, provider, coverage_level,
      employee_cost, employer_cost, effective_date, end_date, notes,
    } = body ?? {};

    if (!officer_id) return c.json({ error: 'officer_id required' }, 400);
    if (!benefit_type || !BENEFIT_TYPES.has(benefit_type)) {
      return c.json({ error: 'Invalid benefit_type' }, 400);
    }
    if (coverage_level && !COVERAGE_LEVELS.has(coverage_level)) {
      return c.json({ error: 'Invalid coverage_level' }, 400);
    }
    // Costs arrive from a number input but can still be '' or null.
    const eeCost = Number(employee_cost ?? 0);
    const erCost = Number(employer_cost ?? 0);
    if (!Number.isFinite(eeCost) || eeCost < 0) return c.json({ error: 'employee_cost must be >= 0' }, 400);
    if (!Number.isFinite(erCost) || erCost < 0) return c.json({ error: 'employer_cost must be >= 0' }, 400);

    const now = nowIso();
    const res = await execute(db,
      `INSERT INTO hr_benefits
        (officer_id, benefit_type, plan_name, provider, coverage_level,
         employee_cost, employer_cost, effective_date, end_date, status,
         notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      Number(officer_id), benefit_type, plan_name ?? null, provider ?? null,
      coverage_level || 'individual', eeCost, erCost,
      effective_date || null, end_date ?? null, notes ?? null, user.id, now, now
    );
    return c.json({ success: true, id: res.meta.last_row_id }, 201);
  } catch (err) {
    console.error('[hr] POST /benefits', err);
    return c.json({ error: 'Failed to add benefit', code: 'HR_BENEFITS_CREATE_ERR' }, 500);
  }
});

// ── /leave ──────────────────────────────────────────────────

// GET /hr/leave?officer_id=&status=
hr.get('/leave', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; role: string };
    const officerId = c.req.query('officer_id');
    const status = c.req.query('status');
    const type = c.req.query('type');

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
    if (type && LEAVE_TYPES.has(type)) {
      where.push('lr.type = ?');
      params.push(type);
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

// ── CSV exports (Leave / Disciplinary / Reviews tabs' "Export → CSV") ──
// The three HR tabs hit /api/hr/{leave|disciplinary|reviews}/export/csv via
// <ExportButton>, which 404'd (no handler) → "Export failed with status 404".
// These re-run each list query (no UI filters) and stream a CSV download. The
// joins are copied verbatim from the corresponding list handlers so no guessed
// column 500s the export. GET /…/export/csv is 3 segments — never shadows the
// 2-segment GET /…/:id.
function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

hr.get('/leave/export/csv', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT lr.*, o.full_name AS officer_name, r.full_name AS reviewer_name
      FROM leave_requests lr
      LEFT JOIN users o ON o.id = lr.officer_id
      LEFT JOIN users r ON r.id = lr.reviewed_by
      ORDER BY lr.created_at DESC LIMIT 5000`);
    return csvResponse(rowsToCsv(rows), 'leave_requests.csv');
  } catch (err) {
    console.error('[hr] GET /leave/export/csv', err);
    return c.json({ error: 'Export failed' }, 500);
  }
});

hr.get('/disciplinary/export/csv', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT dr.*, o.full_name AS officer_name, i.full_name AS issuer_name
      FROM disciplinary_records dr
      LEFT JOIN users o ON o.id = dr.officer_id
      LEFT JOIN users i ON i.id = dr.issued_by
      ORDER BY dr.incident_date DESC, dr.id DESC LIMIT 5000`);
    return csvResponse(rowsToCsv(rows), 'disciplinary_records.csv');
  } catch (err) {
    console.error('[hr] GET /disciplinary/export/csv', err);
    return c.json({ error: 'Export failed' }, 500);
  }
});

hr.get('/reviews/export/csv', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT pr.*, o.full_name AS officer_name, r.full_name AS reviewer_name
      FROM performance_reviews pr
      LEFT JOIN users o ON o.id = pr.officer_id
      LEFT JOIN users r ON r.id = pr.reviewer_id
      ORDER BY pr.review_period_end DESC, pr.id DESC LIMIT 5000`);
    return csvResponse(rowsToCsv(rows), 'performance_reviews.csv');
  } catch (err) {
    console.error('[hr] GET /reviews/export/csv', err);
    return c.json({ error: 'Export failed' }, 500);
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
      `SELECT id, full_name FROM users u WHERE ${officerWhere} ORDER BY full_name`,
      ...officerParams
    );

    if (officers.length === 0) return c.json([]);

    // Sum approved hours per (officer, type) for the requested year.
    // start_date is TEXT ISO so substr-based year extraction is fine.
    // queryInChunks with year as a leadingBinding keeps all params bound
    // (no integer interpolation) and handles org sizes > 100 officers.
    const usage = await queryInChunks<{ officer_id: number; type: string; used: number }>(
      db,
      officers.map(o => o.id),
      (ph) => `SELECT officer_id, type, COALESCE(SUM(hours_requested), 0) AS used
       FROM leave_requests
       WHERE substr(start_date, 1, 4) = ?
         AND status = 'approved'
         AND officer_id IN (${ph})
       GROUP BY officer_id, type`,
      [String(year)],
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
hr.get('/disciplinary', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user');
    const officerId = c.req.query('officer_id');
    const status = c.req.query('status');
    const type = c.req.query('type');
    const severity = c.req.query('severity');

    const where: string[] = [];
    const params: unknown[] = [];
    // Non-managers may only ever see their OWN disciplinary records (mirrors the
    // /leave + /reviews self-scoping). Managers may filter by officer_id.
    if (!isManager(user.role)) {
      where.push('dr.officer_id = ?'); params.push(user.id);
    } else if (officerId) {
      where.push('dr.officer_id = ?'); params.push(Number(officerId));
    }
    if (status && DISC_STATUSES.has(status)) { where.push('dr.status = ?'); params.push(status); }
    if (type && DISC_TYPES.has(type)) { where.push('dr.type = ?'); params.push(type); }
    if (severity && DISC_SEVERITIES.has(severity)) { where.push('dr.severity = ?'); params.push(severity); }

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

// POST /disciplinary/bulk-status {ids: number[], status} — bulk status
// transition (e.g. close out a batch at once) instead of one PUT per record.
hr.post('/disciplinary/bulk-status', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json();
    const ids: number[] = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Number.isFinite) : [];
    const status = body?.status;
    if (!ids.length) return c.json({ error: 'ids required' }, 400);
    if (!DISC_STATUSES.has(status)) return c.json({ error: 'Invalid status' }, 400);
    // ids comes straight from the request body and is unbounded, so this
    // query's SHAPE grows with the payload: a bulk-status of 100+ records
    // exceeds D1's 100-bound-parameter cap and throws at BIND time. The two
    // leading bindings (status, updated_at) are re-bound per chunk and counted
    // against the budget by executeInChunks.
    const updated = await executeInChunks(db, ids,
      (placeholders) => `UPDATE disciplinary_records SET status = ?, updated_at = ? WHERE id IN (${placeholders})`,
      [status, nowIso()]);
    return c.json({ success: true, updated });
  } catch (err) {
    console.error('[hr] POST /disciplinary/bulk-status', err);
    return c.json({ error: 'Failed to bulk-update disciplinary records', code: 'HR_DISC_BULK_ERR' }, 500);
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
    const type = c.req.query('type');

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
    if (type && REVIEW_TYPES.has(type)) {
      where.push('pr.type = ?');
      params.push(type);
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

// ═══════════════════════════════════════════════════════════════
// Payroll — Pay Periods, Pay Rates, Payroll Entries, Overtime
// ═══════════════════════════════════════════════════════════════

// ─── Pay Periods ─────────────────────────────────────────────

hr.get('/payroll/periods', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const { status, year } = c.req.query();
    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (status) { where += ' AND pp.status = ?'; params.push(status); }
    if (year) { where += ' AND pp.start_date >= ? AND pp.start_date < ?'; params.push(`${year}-01-01`, `${Number(year)+1}-01-01`); }
    const rows = await query(db, `
      SELECT pp.*, u.full_name AS created_by_name,
        (SELECT COUNT(*) FROM hr_payroll_entries pe WHERE pe.pay_period_id = pp.id) AS entry_count,
        (SELECT COALESCE(SUM(pe.gross_pay), 0) FROM hr_payroll_entries pe WHERE pe.pay_period_id = pp.id) AS total_gross,
        (SELECT COALESCE(SUM(pe.net_pay), 0) FROM hr_payroll_entries pe WHERE pe.pay_period_id = pp.id) AS total_net
      FROM hr_pay_periods pp
      LEFT JOIN users u ON u.id = pp.created_by
      ${where}
      ORDER BY pp.start_date DESC
    `, ...params);
    return c.json(rows);
  } catch (err) {
    console.error('[hr] GET /payroll/periods', err);
    return c.json({ error: 'Failed to fetch pay periods', code: 'HR_PAY_PERIODS_ERR' }, 500);
  }
});

hr.post('/payroll/periods', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const body = await c.req.json();
    const { name, start_date, end_date, pay_date } = body ?? {};
    if (!start_date || !end_date || !pay_date) {
      return c.json({ error: 'start_date, end_date, and pay_date are required' }, 400);
    }
    const res = await execute(db,
      `INSERT INTO hr_pay_periods (name, start_date, end_date, pay_date, status, created_by)
       VALUES (?, ?, ?, ?, 'open', ?)`,
      name || `Pay Period ${start_date} - ${end_date}`, start_date, end_date, pay_date, user.id
    );
    const period = await queryFirst(db, 'SELECT * FROM hr_pay_periods WHERE id = ?', Number(res.meta.last_row_id));
    return c.json(period, 201);
  } catch (err) {
    console.error('[hr] POST /payroll/periods', err);
    return c.json({ error: 'Failed to create pay period', code: 'HR_PAY_PERIOD_CREATE_ERR' }, 500);
  }
});

hr.put('/payroll/periods/:id', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const existing = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM hr_pay_periods WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Pay period not found' }, 404);
    const body = await c.req.json();
    const { name, start_date, end_date, pay_date, status } = body ?? {};
    const sets: string[] = []; const params: unknown[] = [];
    if (name !== undefined) { sets.push('name = ?'); params.push(name); }
    if (start_date) { sets.push('start_date = ?'); params.push(start_date); }
    if (end_date) { sets.push('end_date = ?'); params.push(end_date); }
    if (pay_date) { sets.push('pay_date = ?'); params.push(pay_date); }
    if (status) {
      const valid = ['open', 'processing', 'finalized', 'paid', 'closed'];
      if (!valid.includes(status)) return c.json({ error: 'Invalid status' }, 400);
      sets.push('status = ?'); params.push(status);
    }
    if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
    params.push(id);
    await execute(db, `UPDATE hr_pay_periods SET ${sets.join(', ')} WHERE id = ?`, ...params);
    const updated = await queryFirst(db, 'SELECT * FROM hr_pay_periods WHERE id = ?', id);
    return c.json(updated);
  } catch (err) {
    console.error('[hr] PUT /payroll/periods/:id', err);
    return c.json({ error: 'Failed to update pay period', code: 'HR_PAY_PERIOD_UPDATE_ERR' }, 500);
  }
});

hr.delete('/payroll/periods/:id', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const existing = await queryFirst<{ status: string }>(db, 'SELECT status FROM hr_pay_periods WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Pay period not found' }, 404);
    await execute(db, 'DELETE FROM hr_payroll_entries WHERE pay_period_id = ?', id);
    await execute(db, 'DELETE FROM hr_pay_periods WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] DELETE /payroll/periods/:id', err);
    return c.json({ error: 'Failed to delete pay period', code: 'HR_PAY_PERIOD_DEL_ERR' }, 500);
  }
});

// ─── Pay Rates ───────────────────────────────────────────────

hr.get('/payroll/rates', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.req.query('user_id');
    let where = 'WHERE pr.end_date IS NULL';
    const params: unknown[] = [];
    if (userId) { where += ' AND pr.user_id = ?'; params.push(Number(userId)); }
    const rows = await query(db, `
      SELECT pr.*, u.full_name AS officer_name, cb.full_name AS created_by_name
      FROM hr_pay_rates pr
      JOIN users u ON u.id = pr.user_id
      LEFT JOIN users cb ON cb.id = pr.created_by
      ${where}
      ORDER BY u.full_name, pr.effective_date DESC
    `, ...params);
    return c.json(rows);
  } catch (err) {
    console.error('[hr] GET /payroll/rates', err);
    return c.json({ error: 'Failed to fetch pay rates', code: 'HR_PAY_RATES_ERR' }, 500);
  }
});

hr.post('/payroll/rates', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const body = await c.req.json();
    const { user_id, pay_type, rate, overtime_rate, holiday_rate, effective_date, notes } = body ?? {};
    if (!user_id || !pay_type || rate === undefined || !effective_date) {
      return c.json({ error: 'user_id, pay_type, rate, and effective_date are required' }, 400);
    }
    await execute(db, `UPDATE hr_pay_rates SET end_date = ? WHERE user_id = ? AND end_date IS NULL`, effective_date, user_id);
    const res = await execute(db,
      `INSERT INTO hr_pay_rates (user_id, pay_type, rate, overtime_rate, holiday_rate, effective_date, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      user_id, pay_type, rate, overtime_rate ?? 1.5, holiday_rate ?? 1.5, effective_date, notes || null, user.id
    );
    const newRate = await queryFirst(db,
      'SELECT pr.*, u.full_name AS officer_name FROM hr_pay_rates pr JOIN users u ON u.id = pr.user_id WHERE pr.id = ?',
      Number(res.meta.last_row_id)
    );
    return c.json(newRate, 201);
  } catch (err) {
    console.error('[hr] POST /payroll/rates', err);
    return c.json({ error: 'Failed to create pay rate', code: 'HR_PAY_RATE_CREATE_ERR' }, 500);
  }
});

// ─── Payroll Entries ─────────────────────────────────────────

hr.get('/payroll/entries', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const payPeriodId = c.req.query('pay_period_id');
    const userId = c.req.query('user_id');
    const allParam = c.req.query('all');
    if (!payPeriodId && !allParam) return c.json({ error: 'pay_period_id or all=1 is required' }, 400);
    let where = allParam ? 'WHERE 1=1' : 'WHERE pe.pay_period_id = ?';
    const params: unknown[] = allParam ? [] : [Number(payPeriodId)];
    if (userId) {
      where += ' AND pe.user_id = ?';
      params.push(Number(userId));
    }
    const rows = await query(db, `
      SELECT pe.*, u.full_name AS officer_name, u.badge_number,
        pr.pay_type, pr.rate AS hourly_rate,
        ab.full_name AS approved_by_name
      FROM hr_payroll_entries pe
      JOIN users u ON u.id = pe.user_id
      LEFT JOIN hr_pay_rates pr ON pr.id = pe.pay_rate_id
      LEFT JOIN users ab ON ab.id = pe.approved_by
      ${where}
      ORDER BY u.full_name
    `, ...params);
    return c.json(rows);
  } catch (err) {
    console.error('[hr] GET /payroll/entries', err);
    return c.json({ error: 'Failed to fetch payroll entries', code: 'HR_PAY_ENTRIES_ERR' }, 500);
  }
});

hr.post('/payroll/entries', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json();
    const { pay_period_id, user_id, regular_hours, overtime_hours, holiday_hours, pto_hours, sick_hours, other_hours, other_hours_description, notes } = body ?? {};
    if (!pay_period_id || !user_id) return c.json({ error: 'pay_period_id and user_id are required' }, 400);

    const payRate = await queryFirst<{ id: number; rate: number; overtime_rate: number; holiday_rate: number }>(db,
      `SELECT * FROM hr_pay_rates WHERE user_id = ? AND end_date IS NULL ORDER BY effective_date DESC LIMIT 1`, user_id);
    const rate = payRate?.rate ?? 0;
    const otMult = payRate?.overtime_rate ?? 1.5;
    const holMult = payRate?.holiday_rate ?? 1.5;
    const split = applyOvertimeThreshold(regular_hours ?? 0, overtime_hours);
    const regHrs = split.regular_hours;
    const otHrs = split.overtime_hours;
    const holHrs = holiday_hours ?? 0;
    const basePay = regHrs * rate;
    const overtimePay = otHrs * rate * otMult;
    const holidayPay = holHrs * rate * holMult;
    const grossPay = basePay + overtimePay + holidayPay;

    const now = nowIso();
    const res = await execute(db,
      `INSERT INTO hr_payroll_entries (user_id, pay_period_id, pay_rate_id, regular_hours, overtime_hours, holiday_hours, pto_hours, sick_hours, other_hours, other_hours_description, base_pay, overtime_pay, holiday_pay, gross_pay, total_deductions, net_pay, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'draft', ?, ?, ?)`,
      user_id, pay_period_id, payRate?.id ?? null,
      regHrs, otHrs, holHrs, pto_hours ?? 0, sick_hours ?? 0, other_hours ?? 0, other_hours_description || null,
      basePay, overtimePay, holidayPay, grossPay, grossPay,
      notes || null, now, now
    );
    const entry = await queryFirst(db,
      'SELECT pe.*, u.full_name AS officer_name FROM hr_payroll_entries pe JOIN users u ON u.id = pe.user_id WHERE pe.id = ?',
      Number(res.meta.last_row_id)
    );
    return c.json(entry, 201);
  } catch (err) {
    console.error('[hr] POST /payroll/entries', err);
    return c.json({ error: 'Failed to create payroll entry', code: 'HR_PAY_ENTRY_CREATE_ERR' }, 500);
  }
});

hr.put('/payroll/entries/:id', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const existing = await queryFirst<any>(db, 'SELECT * FROM hr_payroll_entries WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Payroll entry not found' }, 404);
    const body = await c.req.json();
    const { regular_hours, overtime_hours, holiday_hours, pto_hours, sick_hours, other_hours, other_hours_description, notes, status } = body ?? {};

    const payRate = existing.pay_rate_id
      ? await queryFirst<{ rate: number; overtime_rate: number; holiday_rate: number }>(db, 'SELECT * FROM hr_pay_rates WHERE id = ?', existing.pay_rate_id)
      : null;
    const rate = payRate?.rate ?? 0;
    const otMult = payRate?.overtime_rate ?? 1.5;
    const holMult = payRate?.holiday_rate ?? 1.5;
    const split = regular_hours != null
      ? applyOvertimeThreshold(regular_hours, overtime_hours)
      : { regular_hours: existing.regular_hours, overtime_hours: overtime_hours ?? existing.overtime_hours };
    const regHrs = split.regular_hours;
    const otHrs = split.overtime_hours;
    const holHrs = holiday_hours ?? existing.holiday_hours;
    const basePay = regHrs * rate;
    const overtimePay = otHrs * rate * otMult;
    const holidayPay = holHrs * rate * holMult;
    const grossPay = basePay + overtimePay + holidayPay;
    const now = nowIso();
    const userId = (c.get('user') as { id: number })?.id;

    await execute(db,
      `UPDATE hr_payroll_entries SET regular_hours = ?, overtime_hours = ?, holiday_hours = ?,
        pto_hours = ?, sick_hours = ?, other_hours = ?, other_hours_description = ?,
        base_pay = ?, overtime_pay = ?, holiday_pay = ?, gross_pay = ?, net_pay = ?,
        status = ?, notes = ?,
        approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
        approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END,
        updated_at = ? WHERE id = ?`,
      regHrs, otHrs, holHrs,
      pto_hours ?? existing.pto_hours, sick_hours ?? existing.sick_hours,
      other_hours ?? existing.other_hours, other_hours_description ?? existing.other_hours_description,
      basePay, overtimePay, holidayPay, grossPay, grossPay,
      status ?? existing.status, notes ?? existing.notes,
      status, userId, status, now, now, id
    );
    const updated = await queryFirst(db,
      'SELECT pe.*, u.full_name AS officer_name FROM hr_payroll_entries pe JOIN users u ON u.id = pe.user_id WHERE pe.id = ?', id);
    return c.json(updated);
  } catch (err) {
    console.error('[hr] PUT /payroll/entries/:id', err);
    return c.json({ error: 'Failed to update payroll entry', code: 'HR_PAY_ENTRY_UPDATE_ERR' }, 500);
  }
});

// ─── Auto-populate period ────────────────────────────────────

hr.post('/payroll/periods/:id/populate', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const period = await queryFirst<{ name: string; status: string }>(db, 'SELECT name, status FROM hr_pay_periods WHERE id = ?', id);
    if (!period) return c.json({ error: 'Pay period not found' }, 404);
    const result = await populatePayrollFromClocks(db, id);
    return c.json({ success: true, ...result });
  } catch (err) {
    console.error('[hr] POST /payroll/periods/:id/populate', err);
    return c.json({ error: 'Failed to populate pay period', code: 'HR_PAY_PERIOD_POP_ERR' }, 500);
  }
});

// ─── Overtime Requests ───────────────────────────────────────

hr.get('/payroll/overtime', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; role: string };
    const { status: otStatus, officer_id } = c.req.query();
    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (!isManager(user.role)) { where += ' AND officer_id = ?'; params.push(user.id); }
    else if (officer_id) { where += ' AND officer_id = ?'; params.push(Number(officer_id)); }
    if (otStatus) { where += ' AND status = ?'; params.push(otStatus); }
    const rows = await query(db, `SELECT * FROM overtime_requests ${where} ORDER BY created_at DESC`, ...params);
    return c.json(rows);
  } catch (err) {
    console.error('[hr] GET /payroll/overtime', err);
    return c.json({ error: 'Failed to fetch OT requests', code: 'HR_OT_LIST_ERR' }, 500);
  }
});

hr.post('/payroll/overtime', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const body = await c.req.json();
    const { requested_date, hours_requested, reason } = body ?? {};
    if (!requested_date || !hours_requested) {
      return c.json({ error: 'requested_date and hours_requested are required' }, 400);
    }
    const officer = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', user.id);
    const now = nowIso();
    const res = await execute(db,
      `INSERT INTO overtime_requests (officer_id, officer_name, requested_date, hours_requested, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'requested', ?)`,
      user.id, officer?.full_name || '', requested_date, Number(hours_requested), reason || null, now
    );
    return c.json({ id: res.meta.last_row_id }, 201);
  } catch (err) {
    console.error('[hr] POST /payroll/overtime', err);
    return c.json({ error: 'Failed to create OT request', code: 'HR_OT_CREATE_ERR' }, 500);
  }
});

hr.put('/payroll/overtime/:id', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const id = Number(c.req.param('id'));
    const body = await c.req.json();
    const { status: otStatus, review_notes } = body ?? {};
    if (!['approved', 'denied'].includes(otStatus)) {
      return c.json({ error: 'Status must be approved or denied' }, 400);
    }
    const reviewer = await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', user.id);
    const now = nowIso();
    await execute(db,
      `UPDATE overtime_requests SET status = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_notes = ? WHERE id = ?`,
      otStatus, user.id, reviewer?.full_name || '', now, review_notes || null, id
    );
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] PUT /payroll/overtime/:id', err);
    return c.json({ error: 'Failed to update OT request', code: 'HR_OT_UPDATE_ERR' }, 500);
  }
});

hr.delete('/payroll/overtime/:id', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    await execute(db, 'DELETE FROM overtime_requests WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] DELETE /payroll/overtime/:id', err);
    return c.json({ error: 'Failed to delete OT request', code: 'HR_OT_DELETE_ERR' }, 500);
  }
});

// ─── Payroll CSV Export ──────────────────────────────────────

hr.get('/payroll/export/csv', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const payPeriodId = c.req.query('pay_period_id');
    if (!payPeriodId) return c.json({ error: 'pay_period_id required' }, 400);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT pe.*, u.full_name AS officer_name, u.badge_number
      FROM hr_payroll_entries pe JOIN users u ON u.id = pe.user_id
      WHERE pe.pay_period_id = ? ORDER BY u.full_name`, Number(payPeriodId));
    return csvResponse(rowsToCsv(rows), 'payroll.csv');
  } catch (err) {
    console.error('[hr] GET /payroll/export/csv', err);
    return c.json({ error: 'Export failed' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// Grievances
// ═══════════════════════════════════════════════════════════════

const GRIEVANCE_STATUSES = new Set(['filed', 'under_review', 'investigation', 'mediation', 'resolved', 'dismissed', 'appealed']);

hr.get('/grievances', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; role: string };
    const { status, officer_id } = c.req.query();
    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (!isManager(user.role)) { where += ' AND g.officer_id = ?'; params.push(user.id); }
    else if (officer_id) { where += ' AND g.officer_id = ?'; params.push(Number(officer_id)); }
    if (status && GRIEVANCE_STATUSES.has(status)) { where += ' AND g.status = ?'; params.push(status); }
    const rows = await query(db, `
      SELECT g.*, o.full_name AS officer_name, a.full_name AS assigned_to_name
      FROM hr_grievances g
      LEFT JOIN users o ON o.id = g.officer_id
      LEFT JOIN users a ON a.id = g.assigned_to
      ${where} ORDER BY g.created_at DESC`, ...params);
    return c.json(rows);
  } catch (err) {
    console.error('[hr] GET /grievances', err);
    return c.json({ error: 'Failed to load grievances', code: 'HR_GRIEV_LIST_ERR' }, 500);
  }
});

hr.post('/grievances', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const body = await c.req.json();
    const { type, grievance_type, subject, description, priority, assigned_to, against_user_id } = body ?? {};
    if (!subject || !description) return c.json({ error: 'subject and description are required' }, 400);
    const now = nowIso();
    const res = await execute(db,
      `INSERT INTO hr_grievances (officer_id, type, subject, description, status, priority, assigned_to, against_user_id, filed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'filed', ?, ?, ?, ?, ?, ?)`,
      user.id, type || grievance_type || 'general', subject, description, priority || 'normal', assigned_to || null, against_user_id || null, now, now, now
    );
    return c.json({ success: true, id: res.meta.last_row_id }, 201);
  } catch (err) {
    console.error('[hr] POST /grievances', err);
    return c.json({ error: 'Failed to create grievance', code: 'HR_GRIEV_CREATE_ERR' }, 500);
  }
});

hr.put('/grievances/:id', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const body = await c.req.json();
    const fields = ['type', 'subject', 'description', 'priority', 'assigned_to', 'against_user_id', 'resolution'];
    // alias grievance_type → type (client sent the wrong key historically)
    if ('grievance_type' in body && !('type' in body)) body.type = body.grievance_type;
    const sets: string[] = []; const params: unknown[] = [];
    for (const f of fields) {
      if (f in body) { sets.push(`${f} = ?`); params.push(body[f]); }
    }
    if (body.status) {
      if (!GRIEVANCE_STATUSES.has(body.status)) return c.json({ error: 'Invalid status' }, 400);
      sets.push('status = ?'); params.push(body.status);
      if (body.status === 'resolved' || body.status === 'dismissed') {
        sets.push('resolved_at = ?'); params.push(nowIso());
      }
    }
    if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
    sets.push('updated_at = ?'); params.push(nowIso());
    params.push(id);
    await execute(db, `UPDATE hr_grievances SET ${sets.join(', ')} WHERE id = ?`, ...params);
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] PUT /grievances/:id', err);
    return c.json({ error: 'Failed to update grievance', code: 'HR_GRIEV_UPDATE_ERR' }, 500);
  }
});

// POST /grievances/bulk-status {ids: number[], status} — bulk status
// transition (e.g. dismiss a batch of stale filed grievances at once)
// instead of one PUT per record.
hr.post('/grievances/bulk-status', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json();
    const ids: number[] = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Number.isFinite) : [];
    const status = body?.status;
    if (!ids.length) return c.json({ error: 'ids required' }, 400);
    if (!GRIEVANCE_STATUSES.has(status)) return c.json({ error: 'Invalid status' }, 400);
    const now = nowIso();
    const resolvedAt = (status === 'resolved' || status === 'dismissed') ? now : null;
    // Same caller-sized IN-list as /disciplinary/bulk-status above; three
    // leading bindings here (status, resolved_at, updated_at).
    const updated = await executeInChunks(db, ids,
      (placeholders) => `UPDATE hr_grievances SET status = ?, resolved_at = COALESCE(?, resolved_at), updated_at = ? WHERE id IN (${placeholders})`,
      [status, resolvedAt, now]);
    return c.json({ success: true, updated });
  } catch (err) {
    console.error('[hr] POST /grievances/bulk-status', err);
    return c.json({ error: 'Failed to bulk-update grievances', code: 'HR_GRIEV_BULK_ERR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// Documents & Acknowledgments
// ═══════════════════════════════════════════════════════════════

hr.get('/documents', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const { category } = c.req.query();
    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (category) { where += ' AND category = ?'; params.push(category); }
    const rows = await query(db, `
      SELECT d.*, u.full_name AS uploaded_by_name
      FROM hr_documents d
      LEFT JOIN users u ON u.id = d.uploaded_by
      ${where} ORDER BY d.created_at DESC`, ...params);
    return c.json(rows);
  } catch (err) {
    console.error('[hr] GET /documents', err);
    return c.json({ error: 'Failed to load documents', code: 'HR_DOC_LIST_ERR' }, 500);
  }
});

hr.post('/documents', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const body = await c.req.json();
    const { title, category, description, file_path, file_name, file_size } = body ?? {};
    if (!title) return c.json({ error: 'title is required' }, 400);
    const now = nowIso();
    const res = await execute(db,
      `INSERT INTO hr_documents (title, category, description, file_path, file_name, file_size, uploaded_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      title, category || 'policy', description || null, file_path || null, file_name || null, file_size || 0, user.id, now, now
    );
    return c.json({ success: true, id: res.meta.last_row_id }, 201);
  } catch (err) {
    console.error('[hr] POST /documents', err);
    return c.json({ error: 'Failed to create document', code: 'HR_DOC_CREATE_ERR' }, 500);
  }
});

hr.delete('/documents/:id', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    await execute(db, 'DELETE FROM hr_documents WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] DELETE /documents/:id', err);
    return c.json({ error: 'Failed to delete document', code: 'HR_DOC_DEL_ERR' }, 500);
  }
});

hr.get('/acknowledgments', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const documentId = c.req.query('document_id');
    const officerId = c.req.query('officer_id');
    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (documentId) { where += ' AND a.document_id = ?'; params.push(Number(documentId)); }
    if (officerId) { where += ' AND a.officer_id = ?'; params.push(Number(officerId)); }
    const rows = await query(db, `
      SELECT a.*, u.full_name AS officer_name, d.title AS document_title
      FROM hr_handbook_acknowledgments a
      LEFT JOIN users u ON u.id = a.officer_id
      LEFT JOIN hr_documents d ON d.id = a.document_id
      ${where} ORDER BY a.acknowledged_at DESC`, ...params);
    return c.json(rows);
  } catch (err) {
    console.error('[hr] GET /acknowledgments', err);
    return c.json({ error: 'Failed to load acknowledgments', code: 'HR_ACK_LIST_ERR' }, 500);
  }
});

hr.post('/acknowledgments', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const body = await c.req.json();
    const { document_id, signature } = body ?? {};
    if (!document_id) return c.json({ error: 'document_id is required' }, 400);
    const now = nowIso();
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null;
    const res = await execute(db,
      `INSERT OR IGNORE INTO hr_handbook_acknowledgments (officer_id, document_id, acknowledged_at, signature, ip_address)
       VALUES (?, ?, ?, ?, ?)`,
      user.id, document_id, now, signature || null, ip
    );
    if (res.meta.changes === 0) return c.json({ error: 'Already acknowledged' }, 409);
    return c.json({ success: true, id: res.meta.last_row_id }, 201);
  } catch (err) {
    console.error('[hr] POST /acknowledgments', err);
    return c.json({ error: 'Failed to acknowledge document', code: 'HR_ACK_CREATE_ERR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// Attendance
// ═══════════════════════════════════════════════════════════════

const ATTENDANCE_TYPES = new Set(['absent', 'tardy', 'early_departure', 'no_call_no_show']);

hr.get('/attendance', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; role: string };
    const { officer_id, type: attType, date_from, date_to } = c.req.query();
    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (!isManager(user.role)) { where += ' AND a.officer_id = ?'; params.push(user.id); }
    else if (officer_id) { where += ' AND a.officer_id = ?'; params.push(Number(officer_id)); }
    if (attType && ATTENDANCE_TYPES.has(attType)) { where += ' AND a.type = ?'; params.push(attType); }
    if (date_from) { where += ' AND a.date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND a.date <= ?'; params.push(date_to); }
    const rows = await query(db, `
      SELECT a.*, o.full_name AS officer_name, d.full_name AS documented_by_name
      FROM hr_attendance a
      LEFT JOIN users o ON o.id = a.officer_id
      LEFT JOIN users d ON d.id = a.documented_by
      ${where} ORDER BY a.date DESC, a.created_at DESC`, ...params);
    return c.json(rows);
  } catch (err) {
    console.error('[hr] GET /attendance', err);
    return c.json({ error: 'Failed to load attendance records', code: 'HR_ATTEND_LIST_ERR' }, 500);
  }
});

hr.post('/attendance', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const body = await c.req.json();
    const { officer_id, date, type, minutes_late, reason, excused } = body ?? {};
    if (!officer_id || !date || !type) return c.json({ error: 'officer_id, date, and type are required' }, 400);
    if (!ATTENDANCE_TYPES.has(type)) return c.json({ error: 'Invalid attendance type' }, 400);
    const now = nowIso();
    const res = await execute(db,
      `INSERT INTO hr_attendance (officer_id, date, type, minutes_late, reason, excused, documented_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      officer_id, date, type, minutes_late ?? 0, reason || null, excused ? 1 : 0, user.id, now
    );
    return c.json({ success: true, id: res.meta.last_row_id }, 201);
  } catch (err) {
    console.error('[hr] POST /attendance', err);
    return c.json({ error: 'Failed to create attendance record', code: 'HR_ATTEND_CREATE_ERR' }, 500);
  }
});

hr.put('/attendance/:id', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const body = await c.req.json();
    const ALLOWED = new Set(['type', 'date', 'minutes_late', 'reason', 'excused', 'documented_by']);
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(body ?? {})) {
      if (ALLOWED.has(k)) { sets.push(`${k} = ?`); vals.push(v); }
    }
    if (sets.length === 0) return c.json({ error: 'No updatable fields provided' }, 400);
    vals.push(id);
    await execute(db, `UPDATE hr_attendance SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] PUT /attendance/:id', err);
    return c.json({ error: 'Failed to update attendance record', code: 'HR_ATTEND_UPDATE_ERR' }, 500);
  }
});

hr.delete('/attendance/:id', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    await execute(db, 'DELETE FROM hr_attendance WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] DELETE /attendance/:id', err);
    return c.json({ error: 'Failed to delete attendance record', code: 'HR_ATTEND_DELETE_ERR' }, 500);
  }
});

hr.get('/attendance/summary/:officerId', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const officerId = Number(c.req.param('officerId'));
    const year = c.req.query('year') || String(new Date().getFullYear());
    const by_type = await query<{ type: string; count: number; excused_count: number }>(db,
      `SELECT type, COUNT(*) AS count,
              SUM(CASE WHEN excused = 1 THEN 1 ELSE 0 END) AS excused_count
       FROM hr_attendance
       WHERE officer_id = ? AND substr(date, 1, 4) = ?
       GROUP BY type`, officerId, year);
    const total_incidents = by_type.reduce((sum, r) => sum + r.count, 0);
    const mfRows = await query<{ mf_count: number }>(db,
      `SELECT COUNT(*) AS mf_count FROM hr_attendance
       WHERE officer_id = ? AND substr(date, 1, 4) = ?
         AND strftime('%w', date) IN ('1', '5')`, officerId, year);
    const monday_friday_count = mfRows[0]?.mf_count ?? 0;
    const monday_friday_pattern = total_incidents > 0 && monday_friday_count >= 2 && (monday_friday_count / total_incidents) >= 0.4;
    return c.json({ officer_id: officerId, year: Number(year), by_type, total_incidents, monday_friday_pattern, monday_friday_count });
  } catch (err) {
    console.error('[hr] GET /attendance/summary/:officerId', err);
    return c.json({ error: 'Failed to load attendance summary', code: 'HR_ATTEND_SUM_ERR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// Performance Improvement Plans (PIPs)
// ═══════════════════════════════════════════════════════════════

const PIP_STATUSES = new Set(['active', 'completed', 'extended', 'failed', 'cancelled']);

hr.get('/pips', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; role: string };
    const { status: pipStatus, officer_id } = c.req.query();
    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (!isManager(user.role)) { where += ' AND p.officer_id = ?'; params.push(user.id); }
    else if (officer_id) { where += ' AND p.officer_id = ?'; params.push(Number(officer_id)); }
    if (pipStatus && PIP_STATUSES.has(pipStatus)) { where += ' AND p.status = ?'; params.push(pipStatus); }
    const rows = await query(db, `
      SELECT p.*, o.full_name AS officer_name, s.full_name AS supervisor_name
      FROM hr_pips p
      LEFT JOIN users o ON o.id = p.officer_id
      LEFT JOIN users s ON s.id = p.supervisor_id
      ${where} ORDER BY p.created_at DESC`, ...params);
    return c.json(rows);
  } catch (err) {
    console.error('[hr] GET /pips', err);
    return c.json({ error: 'Failed to load PIPs', code: 'HR_PIP_LIST_ERR' }, 500);
  }
});

hr.post('/pips', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const body = await c.req.json();
    const { officer_id, supervisor_id, start_date, end_date, reason, goals } = body ?? {};
    if (!officer_id || !start_date || !end_date || !reason) {
      return c.json({ error: 'officer_id, start_date, end_date, and reason are required' }, 400);
    }
    const now = nowIso();
    const goalsJson = Array.isArray(goals) ? JSON.stringify(goals) : '[]';
    const res = await execute(db,
      `INSERT INTO hr_pips (officer_id, supervisor_id, start_date, end_date, reason, goals, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      officer_id, supervisor_id || user.id, start_date, end_date, reason, goalsJson, now, now
    );
    return c.json({ success: true, id: res.meta.last_row_id }, 201);
  } catch (err) {
    console.error('[hr] POST /pips', err);
    return c.json({ error: 'Failed to create PIP', code: 'HR_PIP_CREATE_ERR' }, 500);
  }
});

hr.put('/pips/:id', requireRole(...MANAGER_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = Number(c.req.param('id'));
    const body = await c.req.json();
    const fields = ['supervisor_id', 'start_date', 'end_date', 'reason', 'outcome', 'milestones'];
    const sets: string[] = []; const params: unknown[] = [];
    for (const f of fields) {
      if (f in body) {
        if (f === 'milestones' || f === 'goals') {
          sets.push(`${f} = ?`); params.push(Array.isArray(body[f]) ? JSON.stringify(body[f]) : body[f]);
        } else {
          sets.push(`${f} = ?`); params.push(body[f]);
        }
      }
    }
    if (body.status) {
      if (!PIP_STATUSES.has(body.status)) return c.json({ error: 'Invalid status' }, 400);
      sets.push('status = ?'); params.push(body.status);
    }
    if ('goals' in body) { sets.push('goals = ?'); params.push(Array.isArray(body.goals) ? JSON.stringify(body.goals) : body.goals); }
    if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
    sets.push('updated_at = ?'); params.push(nowIso());
    params.push(id);
    await execute(db, `UPDATE hr_pips SET ${sets.join(', ')} WHERE id = ?`, ...params);
    return c.json({ success: true });
  } catch (err) {
    console.error('[hr] PUT /pips/:id', err);
    return c.json({ error: 'Failed to update PIP', code: 'HR_PIP_UPDATE_ERR' }, 500);
  }
});

export default hr;
