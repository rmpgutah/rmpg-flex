// ============================================================
// HR — leave requests + balances (only the leave-related endpoints
// that have backing tables on live D1 today).
// ============================================================
// Live tables:
//   leave_requests       (officer_id, type, start_date, end_date,
//                         hours_requested, status, reviewed_by,
//                         reviewed_at, denial_reason, created_at)
//   hr_reviews, review_cycles, disciplinary_records  (used elsewhere)
//
// Sub-pages still backed by proxy stubs because their tables don't
// exist on live D1 yet: payroll (periods/rates/entries/overtime),
// grievances, hr_documents, attendance_records, pips, benefits. When
// those tables land, the corresponding handlers go here.

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const hr = new Hono<Env>();

// Default annual allotments — matches PayrollTab's PTO_ACCRUAL_PER_PAY_PERIOD
// (4 hrs × 26 pay periods = 104 hrs/year). Sick + personal are policy
// defaults; an hr_leave_policies table can override these per-officer
// in a follow-up without touching this handler.
const DEFAULT_VACATION_HOURS = 104;
const DEFAULT_SICK_HOURS = 80;
const DEFAULT_PERSONAL_HOURS = 24;

// GET /api/hr/leave/balances?year=YYYY[&officer_id=N]
// HRDashboardTab expects a single { vacation_total, vacation_used, ... }
// object for the current user. LeaveTab uses Array.isArray(bals) ? bals :
// [bals] so a single object is wrapped automatically. We return the
// single-object shape with both legacy and new field names so neither
// tab needs a client change.
hr.get('/leave/balances', async (c) => {
  try {
    const db = getDb(c.env);
    const year = parseInt(c.req.query('year') || String(new Date().getFullYear()), 10);
    const officerIdParam = c.req.query('officer_id');
    const officerId = officerIdParam ? parseInt(officerIdParam, 10) : (c.get('userId') as number | undefined);

    if (!officerId) {
      // No officer context — return totals across the whole agency so
      // the admin LeaveTab still shows something. Same field names as
      // the single-officer response.
      const totals = await queryFirst<Record<string, number>>(db, `
        SELECT
          COALESCE(SUM(CASE WHEN type IN ('vacation','pto') AND status = 'approved' THEN hours_requested ELSE 0 END), 0) AS vacation_used,
          COALESCE(SUM(CASE WHEN type = 'sick' AND status = 'approved' THEN hours_requested ELSE 0 END), 0) AS sick_used,
          COALESCE(SUM(CASE WHEN type = 'personal' AND status = 'approved' THEN hours_requested ELSE 0 END), 0) AS personal_used,
          COALESCE(SUM(CASE WHEN type IN ('vacation','pto') AND status = 'pending' THEN hours_requested ELSE 0 END), 0) AS vacation_pending
        FROM leave_requests
        WHERE strftime('%Y', start_date) = ?
      `, String(year));
      return c.json({
        vacation_total: DEFAULT_VACATION_HOURS,
        vacation_used: totals?.vacation_used ?? 0,
        sick_total: DEFAULT_SICK_HOURS,
        sick_used: totals?.sick_used ?? 0,
        personal_total: DEFAULT_PERSONAL_HOURS,
        personal_used: totals?.personal_used ?? 0,
        pto_used: totals?.vacation_used ?? 0,
        pto_pending: totals?.vacation_pending ?? 0,
        year,
      });
    }

    const totals = await queryFirst<Record<string, number>>(db, `
      SELECT
        COALESCE(SUM(CASE WHEN type IN ('vacation','pto') AND status = 'approved' THEN hours_requested ELSE 0 END), 0) AS vacation_used,
        COALESCE(SUM(CASE WHEN type = 'sick' AND status = 'approved' THEN hours_requested ELSE 0 END), 0) AS sick_used,
        COALESCE(SUM(CASE WHEN type = 'personal' AND status = 'approved' THEN hours_requested ELSE 0 END), 0) AS personal_used,
        COALESCE(SUM(CASE WHEN type IN ('vacation','pto') AND status = 'pending' THEN hours_requested ELSE 0 END), 0) AS vacation_pending
      FROM leave_requests
      WHERE officer_id = ? AND strftime('%Y', start_date) = ?
    `, officerId, String(year));

    const officer = await queryFirst<{ id: number; full_name: string; badge_number: string; hire_date: string | null }>(
      db, 'SELECT id, full_name, badge_number, hire_date FROM users WHERE id = ?', officerId);

    return c.json({
      // HRDashboardTab fields
      vacation_total: DEFAULT_VACATION_HOURS,
      vacation_used: totals?.vacation_used ?? 0,
      sick_total: DEFAULT_SICK_HOURS,
      sick_used: totals?.sick_used ?? 0,
      personal_total: DEFAULT_PERSONAL_HOURS,
      personal_used: totals?.personal_used ?? 0,
      // PayrollTab fields
      id: officer?.id,
      full_name: officer?.full_name,
      badge_number: officer?.badge_number,
      hire_date: officer?.hire_date,
      pto_used: totals?.vacation_used ?? 0,
      pto_pending: totals?.vacation_pending ?? 0,
      year,
    });
  } catch (err) {
    console.error('GET /hr/leave/balances error:', err);
    return c.json({
      vacation_total: DEFAULT_VACATION_HOURS, vacation_used: 0,
      sick_total: DEFAULT_SICK_HOURS, sick_used: 0,
      personal_total: DEFAULT_PERSONAL_HOURS, personal_used: 0,
      pto_used: 0, pto_pending: 0,
    }, 200);
  }
});

// GET /api/hr/leave[?status=...&officer_id=N&year=YYYY]
hr.get('/leave', async (c) => {
  try {
    const db = getDb(c.env);
    const { status, officer_id, year, limit: limitParam } = c.req.query();
    const limit = Math.min(500, Math.max(1, parseInt(limitParam || '100', 10)));

    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (status) { where += ' AND lr.status = ?'; params.push(status); }
    if (officer_id) { where += ' AND lr.officer_id = ?'; params.push(officer_id); }
    if (year) { where += " AND strftime('%Y', lr.start_date) = ?"; params.push(year); }

    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        lr.*,
        u.full_name AS officer_name,
        u.badge_number AS officer_badge
      FROM leave_requests lr
      LEFT JOIN users u ON u.id = lr.officer_id
      ${where}
      ORDER BY lr.start_date DESC, lr.id DESC
      LIMIT ?
    `, ...params, limit);
    return c.json(rows);
  } catch (err) {
    console.error('GET /hr/leave error:', err);
    return c.json([], 200);
  }
});

// POST /api/hr/leave — submit a new leave request.
hr.post('/leave', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    if (!userId) return c.json({ error: 'Unauthenticated' }, 401);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.type || !body.start_date || !body.end_date) {
      return c.json({ error: 'type, start_date, end_date required' }, 400);
    }
    const result = await execute(db, `
      INSERT INTO leave_requests (officer_id, type, start_date, end_date, hours_requested, reason, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
    `, body.officer_id ?? userId, body.type, body.start_date, body.end_date,
       body.hours_requested ?? null, body.reason ?? null);
    return c.json({ success: true, id: result.meta.last_row_id }, 201);
  } catch (err) {
    console.error('POST /hr/leave error:', err);
    return c.json({ error: 'Failed to create leave request' }, 500);
  }
});

// PUT /api/hr/leave/:id — approve / deny.
hr.put('/leave/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const userId = c.get('userId') as number | undefined;
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.status) return c.json({ error: 'status required' }, 400);

    await execute(db, `
      UPDATE leave_requests
      SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'),
          denial_reason = ?
      WHERE id = ?
    `, body.status, userId ?? null, body.denial_reason ?? null, id);

    const updated = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM leave_requests WHERE id = ?', id);
    return c.json(updated);
  } catch (err) {
    return c.json({ error: 'Failed to update leave request' }, 500);
  }
});

export default hr;
