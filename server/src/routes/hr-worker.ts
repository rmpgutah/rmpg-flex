// HR routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';
import { localToday, localNow } from '../utils/timeUtils';
import { validateStr, validateEnum, requireInt, requireFloat, validateDateStr } from '../middleware/sanitize';

function isManagerOrAbove(role: string): boolean {
  return ['admin', 'manager', 'supervisor'].includes(role);
}

function csvEscape(v: any): string {
  const s = v == null ? '' : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildCsv(columns: { key: string; header: string }[], rows: any[]): string {
  const header = columns.map(c => csvEscape(c.header)).join(',');
  const data = rows.map(r => columns.map(c => csvEscape(r[c.key])).join(','));
  return header + '\n' + data.join('\n');
}

export function mountHrRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // ─── Employees list ────────────────────────────────────────
  api.get('/employees', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const users = await db.prepare(`
        SELECT id, full_name, badge_number, role, status
        FROM users
        WHERE status = 'active'
        ORDER BY full_name
        LIMIT 1000
      `).all();
      return c.json(users);
    } catch (error: any) {
      console.error('HR employees list error:', error);
      return c.json({ error: 'Failed to list HR employees', code: 'HR_EMPLOYEES_LIST_ERROR' }, 500);
    }
  });

  // GET /api/hr/review-cycles
  api.get('/review-cycles', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      try {
        const cycles = await db.prepare('SELECT * FROM review_cycles ORDER BY start_date DESC LIMIT 100').all();
        return c.json(cycles);
      } catch (e) {
        console.warn('review_cycles table not found:', (e as Error).message);
        return c.json([]);
      }
    } catch (error: any) {
      console.error('HR review-cycles error:', error);
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // ─── Dashboard ─────────────────────────────────────────────
  api.get('/dashboard', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const today = localToday();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const activeCount = ((await db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE status = 'active'`).get()) as any).cnt;
      const newHires = ((await db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE status = 'active' AND hire_date >= ?`).get(thirtyDaysAgo)) as any).cnt;
      const terminations = ((await db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE termination_date >= ?`).get(thirtyDaysAgo)) as any).cnt;
      const onLeaveToday = ((await db.prepare(
        `SELECT COUNT(DISTINCT officer_id) as cnt FROM leave_requests
         WHERE status = 'approved' AND start_date <= ? AND end_date >= ?`
      ).get(today, today)) as any).cnt;

      const totalTraining = ((await db.prepare(`SELECT COUNT(*) as cnt FROM training_records`).get()) as any).cnt;
      const completedTraining = ((await db.prepare(`SELECT COUNT(*) as cnt FROM training_records WHERE status = 'completed'`).get()) as any).cnt;
      const training_pct = totalTraining > 0 ? Math.round((completedTraining / totalTraining) * 100) : 100;

      const totalCredentials = ((await db.prepare(`SELECT COUNT(*) as cnt FROM credentials`).get()) as any).cnt;
      const activeCredentials = ((await db.prepare(`SELECT COUNT(*) as cnt FROM credentials WHERE status = 'active'`).get()) as any).cnt;
      const credential_pct = totalCredentials > 0 ? Math.round((activeCredentials / totalCredentials) * 100) : 100;

      const overdue_count = ((await db.prepare(`SELECT COUNT(*) as cnt FROM training_records WHERE status = 'overdue'`).get()) as any).cnt;

      const pending_leave = ((await db.prepare(`SELECT COUNT(*) as cnt FROM leave_requests WHERE status = 'pending'`).get()) as any).cnt;
      const pending_reviews = ((await db.prepare(`SELECT COUNT(*) as cnt FROM performance_reviews WHERE status IN ('draft', 'submitted')`).get()) as any).cnt;

      const recentLeave = await db.prepare(
        `SELECT lr.id, 'leave_request' as entity_type, lr.type as sub_type, lr.status, lr.created_at,
                u.full_name as officer_name
         FROM leave_requests lr
         JOIN users u ON u.id = lr.officer_id
         ORDER BY lr.created_at DESC LIMIT 10`
      ).all();

      const recentDisciplinary = await db.prepare(
        `SELECT dr.id, 'disciplinary' as entity_type, dr.type as sub_type, dr.status, dr.created_at,
                u.full_name as officer_name
         FROM disciplinary_records dr
         JOIN users u ON u.id = dr.officer_id
         ORDER BY dr.created_at DESC LIMIT 10`
      ).all();

      const recentReviews = await db.prepare(
        `SELECT pr.id, 'performance_review' as entity_type, pr.type as sub_type, pr.status, pr.created_at,
                u.full_name as officer_name
         FROM performance_reviews pr
         JOIN users u ON u.id = pr.officer_id
         ORDER BY pr.created_at DESC LIMIT 10`
      ).all();

      const recent_activity = [...recentLeave, ...recentDisciplinary, ...recentReviews]
        .sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 10);

      return c.json({
        headcount: { active: activeCount, new_hires: newHires, terminations, on_leave_today: onLeaveToday },
        compliance: { training_pct, credential_pct, overdue_count },
        pending_leave,
        pending_reviews,
        recent_activity,
      });
    } catch (error: any) {
      console.error('[HR] Dashboard error:', error?.message);
      return c.json({ error: 'Failed to load dashboard', code: 'FAILED_TO_LOAD_DASHBOARD' }, 500);
    }
  });

  // ─── Leave Requests ────────────────────────────────────────
  api.get('/leave', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { officer_id, status, type, start_date, end_date } = c.req.query();

      let sql = `SELECT lr.*, u.full_name as officer_name
                 FROM leave_requests lr
                 JOIN users u ON u.id = lr.officer_id WHERE 1=1`;
      const params: any[] = [];

      if (!isManagerOrAbove(user.role)) {
        sql += ' AND lr.officer_id = ?';
        params.push(user.userId);
      } else if (officer_id) {
        sql += ' AND lr.officer_id = ?';
        params.push(Number(officer_id));
      }

      if (status) {
        const validStatuses = ['pending', 'approved', 'denied', 'cancelled'];
        if (!validStatuses.includes(status)) { return c.json({ error: 'Invalid status filter', code: 'INVALID_STATUS_FILTER' }, 400); }
        sql += ' AND lr.status = ?'; params.push(status);
      }
      if (type) {
        const validTypes = ['vacation', 'sick', 'personal', 'bereavement', 'military', 'jury_duty', 'unpaid', 'other'];
        if (!validTypes.includes(type)) { return c.json({ error: 'Invalid type filter', code: 'INVALID_TYPE_FILTER' }, 400); }
        sql += ' AND lr.type = ?'; params.push(type);
      }
      if (start_date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start_date))) { return c.json({ error: 'start_date must be YYYY-MM-DD', code: 'STARTDATE_MUST_BE_YYYYMMDD' }, 400); }
        sql += ' AND lr.start_date >= ?'; params.push(start_date);
      }
      if (end_date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(end_date))) { return c.json({ error: 'end_date must be YYYY-MM-DD', code: 'ENDDATE_MUST_BE_YYYYMMDD' }, 400); }
        sql += ' AND lr.end_date <= ?'; params.push(end_date);
      }

      sql += ' ORDER BY lr.created_at DESC';
      const rows = await db.prepare(sql).all(...params);
      return c.json(rows);
    } catch (error: any) {
      console.error('[HR] Leave list error:', error?.message);
      return c.json({ error: 'Failed to load leave requests', code: 'FAILED_TO_LOAD_LEAVE' }, 500);
    }
  });

  api.post('/leave', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { type, start_date, end_date, hours_requested, reason } = await c.req.json();

      const LEAVE_TYPES = ['vacation', 'sick', 'personal', 'bereavement', 'military', 'jury_duty', 'unpaid', 'other'] as const;
      const validType = validateEnum(type, LEAVE_TYPES, 'type');
      if (!validType) return c.json({ error: 'type is required', code: 'TYPE_IS_REQUIRED' }, 400);
      const validStart = validateDateStr(start_date, 'start_date');
      if (!validStart) return c.json({ error: 'start_date is required (YYYY-MM-DD)', code: 'STARTDATE_IS_REQUIRED_YYYYMMDD' }, 400);
      const validEnd = validateDateStr(end_date, 'end_date');
      if (!validEnd) return c.json({ error: 'end_date is required (YYYY-MM-DD)', code: 'ENDDATE_IS_REQUIRED_YYYYMMDD' }, 400);
      const validHours = requireFloat(hours_requested, 'hours_requested', 0, 2000) || 0;
      const validReason = validateStr(reason, 'reason', 2000);

      const now = localNow();
      const result = await db.prepare(
        `INSERT INTO leave_requests (officer_id, type, start_date, end_date, hours_requested, reason, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).run(user.userId, validType, validStart, validEnd, validHours, validReason, now, now);

      return c.json({ success: true, id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      if (error.message?.startsWith('Invalid ') ||
          error.message?.includes('must be') ||
          error.message?.includes('is required') ||
          error.message?.includes('is not a valid') ||
          error.message?.includes('exceeds max length')) {
        return c.json({ error: error.message }, 400);
      }
      console.error('[HR] Leave create error:', error?.message);
      return c.json({ error: 'Failed to create leave request', code: 'FAILED_TO_CREATE_LEAVE' }, 500);
    }
  });

  api.put('/leave/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

      const existing = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Leave request not found', code: 'LEAVE_REQUEST_NOT_FOUND' }, 404);
      if (existing.officer_id !== user.userId && user.role !== 'admin') return c.json({ error: 'Can only update own requests', code: 'CAN_ONLY_UPDATE_OWN' }, 403);
      if (existing.status !== 'pending' && user.role !== 'admin') return c.json({ error: 'Can only update pending requests', code: 'CAN_ONLY_UPDATE_PENDING' }, 400);

      const body = await c.req.json();
      const { type, start_date, end_date, hours_requested, reason } = body;
      const now = localNow();

      const effectiveUpdatedAt = (user.role === 'admin' && body.updated_at) ? body.updated_at : now;

      await db.prepare(
        `UPDATE leave_requests SET type = COALESCE(?, type), start_date = COALESCE(?, start_date),
         end_date = COALESCE(?, end_date), hours_requested = COALESCE(?, hours_requested),
         reason = COALESCE(?, reason), updated_at = ? WHERE id = ?`
      ).run(type || null, start_date || null, end_date || null, hours_requested ?? null, reason ?? null, effectiveUpdatedAt, id);

      if (user.role === 'admin' && body.created_at) {
        await db.prepare('UPDATE leave_requests SET created_at = ? WHERE id = ?').run(body.created_at, id);
      }

      return c.json({ success: true });
    } catch (error: any) {
      console.error('[HR] Leave update error:', error?.message);
      return c.json({ error: 'Failed to update leave request', code: 'FAILED_TO_UPDATE_LEAVE' }, 500);
    }
  });

  api.post('/leave/:id/approve', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
      const { review_notes } = await c.req.json();

      const existing = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Leave request not found', code: 'LEAVE_REQUEST_NOT_FOUND' }, 404);
      if (existing.status !== 'pending' && user.role !== 'admin') return c.json({ error: 'Can only approve pending requests', code: 'CAN_ONLY_APPROVE_PENDING' }, 400);

      const now = localNow();

      await db.prepare(
        `UPDATE leave_requests SET status = 'approved', reviewed_by = ?, reviewed_at = ?,
         review_notes = ?, updated_at = ? WHERE id = ?`
      ).run(user.userId, now, review_notes || null, now, id);

      const year = new Date(existing.start_date).getFullYear();
      const leaveType = existing.type;
      if (['vacation', 'sick', 'personal'].includes(leaveType)) {
        const usedCol = `${leaveType}_used`;
        await db.prepare(
          `INSERT OR IGNORE INTO leave_balances (officer_id, year, vacation_total, vacation_used, sick_total, sick_used, personal_total, personal_used, created_at, updated_at)
           VALUES (?, ?, 80, 0, 40, 0, 24, 0, ?, ?)`
        ).run(existing.officer_id, year, now, now);

        await db.prepare(
          `UPDATE leave_balances SET ${usedCol} = ${usedCol} + ?, updated_at = ?
           WHERE officer_id = ? AND year = ?`
        ).run(existing.hours_requested, now, existing.officer_id, year);
      }

      return c.json({ success: true });
    } catch (error: any) {
      console.error('[HR] Leave approve error:', error?.message);
      return c.json({ error: 'Failed to approve leave request', code: 'FAILED_TO_APPROVE_LEAVE' }, 500);
    }
  });

  api.post('/leave/:id/deny', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
      const { review_notes } = await c.req.json();

      const existing = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Leave request not found', code: 'LEAVE_REQUEST_NOT_FOUND' }, 404);
      if (existing.status !== 'pending' && user.role !== 'admin') return c.json({ error: 'Can only deny pending requests', code: 'CAN_ONLY_DENY_PENDING' }, 400);

      const now = localNow();
      await db.prepare(
        `UPDATE leave_requests SET status = 'denied', reviewed_by = ?, reviewed_at = ?,
         review_notes = ?, updated_at = ? WHERE id = ?`
      ).run(user.userId, now, review_notes || null, now, id);

      return c.json({ success: true });
    } catch (error: any) {
      console.error('[HR] Leave deny error:', error?.message);
      return c.json({ error: 'Failed to deny leave request', code: 'FAILED_TO_DENY_LEAVE' }, 500);
    }
  });

  api.post('/leave/bulk-approve', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { ids, review_notes } = await c.req.json();
      if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: 'ids array is required', code: 'IDS_ARRAY_IS_REQUIRED' }, 400);
      if (ids.length > 100) return c.json({ error: 'Maximum 100 IDs per bulk action', code: 'MAXIMUM_100_IDS_PER' }, 400);
      for (const id of ids) { if (isNaN(parseInt(String(id), 10)) || parseInt(String(id), 10) < 1) return c.json({ error: 'All IDs must be positive integers', code: 'ALL_IDS_MUST_BE' }, 400); }

      const now = localNow();
      let approved = 0;
      const stmt = `UPDATE leave_requests SET status = 'approved', reviewed_by = ?, reviewed_at = ?,
         review_notes = ?, updated_at = ? WHERE id = ? AND status = 'pending'`;

      for (const id of ids) {
        const result = await db.prepare(stmt).run(user.userId, now, review_notes || 'Bulk approved', now, Number(id));
        if (result.meta.changes > 0) {
          approved++;
          const req_row = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(Number(id)) as any;
          if (req_row) {
            const typeCol = `${req_row.type}_used`;
            const validCols = ['vacation_used', 'sick_used', 'personal_used'];
            if (validCols.includes(typeCol)) {
              await db.prepare(`UPDATE leave_balances SET ${typeCol} = ${typeCol} + ?, updated_at = ? WHERE officer_id = ? AND year = ?`)
                .run(req_row.hours_requested, now, req_row.officer_id, new Date(req_row.start_date).getFullYear());
            }
          }
        }
      }

      return c.json({ success: true, approved, total: ids.length });
    } catch (error: any) {
      console.error('[HR] Bulk approve error:', error?.message);
      return c.json({ error: 'Failed to bulk approve', code: 'FAILED_TO_BULK_APPROVE' }, 500);
    }
  });

  api.delete('/leave/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

      const existing = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Leave request not found', code: 'LEAVE_REQUEST_NOT_FOUND' }, 404);
      if (existing.officer_id !== user.userId && user.role !== 'admin') return c.json({ error: 'Can only cancel own requests', code: 'CAN_ONLY_CANCEL_OWN' }, 403);
      if (existing.status !== 'pending' && user.role !== 'admin') return c.json({ error: 'Can only cancel pending requests', code: 'CAN_ONLY_CANCEL_PENDING' }, 400);

      const now = localNow();
      await db.prepare(`UPDATE leave_requests SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(now, id);

      return c.json({ success: true });
    } catch (error: any) {
      console.error('[HR] Leave cancel error:', error?.message);
      return c.json({ error: 'Failed to cancel leave request', code: 'FAILED_TO_CANCEL_LEAVE' }, 500);
    }
  });

  // ─── Leave Balances ────────────────────────────────────────
  api.get('/leave/balances', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const q = c.req.query();
      const officer_id = q.officier_id || q.officer_id;
      const year = q.year;
      const targetYear = year ? Number(year) : new Date().getFullYear();
      const now = localNow();

      if (!isManagerOrAbove(user.role)) {
        await db.prepare(
          `INSERT OR IGNORE INTO leave_balances (officer_id, year, vacation_total, vacation_used, sick_total, sick_used, personal_total, personal_used, created_at, updated_at)
           VALUES (?, ?, 80, 0, 40, 0, 24, 0, ?, ?)`
        ).run(user.userId, targetYear, now, now);

        const row = await db.prepare(
          `SELECT lb.*, u.full_name as officer_name FROM leave_balances lb
           JOIN users u ON u.id = lb.officer_id
           WHERE lb.officer_id = ? AND lb.year = ?`
        ).get(user.userId, targetYear);
        return c.json(row ? [row] : []);
      }

      if (officer_id) {
        await db.prepare(
          `INSERT OR IGNORE INTO leave_balances (officer_id, year, vacation_total, vacation_used, sick_total, sick_used, personal_total, personal_used, created_at, updated_at)
           VALUES (?, ?, 80, 0, 40, 0, 24, 0, ?, ?)`
        ).run(Number(officer_id), targetYear, now, now);

        const row = await db.prepare(
          `SELECT lb.*, u.full_name as officer_name FROM leave_balances lb
           JOIN users u ON u.id = lb.officer_id
           WHERE lb.officer_id = ? AND lb.year = ?`
        ).get(Number(officer_id), targetYear);
        return c.json(row ? [row] : []);
      }

      const activeUsers = await db.prepare(`SELECT id FROM users WHERE status = 'active'
        LIMIT 1000
      `).all() as any[];
      const insertBal = db.prepare(
        `INSERT OR IGNORE INTO leave_balances (officer_id, year, vacation_total, vacation_used, sick_total, sick_used, personal_total, personal_used, created_at, updated_at)
         VALUES (?, ?, 80, 0, 40, 0, 24, 0, ?, ?)`
      );
      for (const u of activeUsers) {
        await insertBal.run(u.id, targetYear, now, now);
      }

      const rows = await db.prepare(
        `SELECT lb.*, u.full_name as officer_name FROM leave_balances lb
         JOIN users u ON u.id = lb.officer_id
         WHERE lb.year = ? ORDER BY u.full_name`
      ).all(targetYear);
      return c.json(rows);
    } catch (error: any) {
      console.error('[HR] Leave balances error:', error?.message);
      return c.json({ error: 'Failed to load leave balances', code: 'FAILED_TO_LOAD_LEAVE' }, 500);
    }
  });

  api.put('/leave/balances/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

      const existing = await db.prepare('SELECT * FROM leave_balances WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Balance not found', code: 'BALANCE_NOT_FOUND' }, 404);

      const { vacation_total, vacation_used, sick_total, sick_used, personal_total, personal_used } = await c.req.json();
      const now = localNow();

      await db.prepare(
        `UPDATE leave_balances SET
         vacation_total = COALESCE(?, vacation_total), vacation_used = COALESCE(?, vacation_used),
         sick_total = COALESCE(?, sick_total), sick_used = COALESCE(?, sick_used),
         personal_total = COALESCE(?, personal_total), personal_used = COALESCE(?, personal_used),
         updated_at = ? WHERE id = ?`
      ).run(vacation_total ?? null, vacation_used ?? null, sick_total ?? null, sick_used ?? null,
        personal_total ?? null, personal_used ?? null, now, id);

      return c.json({ success: true });
    } catch (error: any) {
      console.error('[HR] Balance update error:', error?.message);
      return c.json({ error: 'Failed to update balance', code: 'FAILED_TO_UPDATE_BALANCE' }, 500);
    }
  });

  // ─── Disciplinary Records ──────────────────────────────────
  api.get('/disciplinary', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { officer_id, type, severity, status, start_date, end_date } = c.req.query();

      if (!isManagerOrAbove(user.role)) {
        let sql = `SELECT dr.id, dr.officer_id, dr.type, dr.severity, dr.incident_date, dr.description,
                          dr.action_taken, dr.follow_up_date, dr.follow_up_notes, dr.status,
                          dr.attachments, dr.created_at, dr.updated_at,
                          u.full_name as officer_name
                   FROM disciplinary_records dr
                   JOIN users u ON u.id = dr.officer_id
                   WHERE dr.officer_id = ?`;
        const params: any[] = [user.userId];

        if (type) { sql += ' AND dr.type = ?'; params.push(type); }
        if (severity) { sql += ' AND dr.severity = ?'; params.push(severity); }
        if (status) { sql += ' AND dr.status = ?'; params.push(status); }
        if (start_date) { sql += ' AND dr.incident_date >= ?'; params.push(start_date); }
        if (end_date) { sql += ' AND dr.incident_date <= ?'; params.push(end_date); }

        sql += ' ORDER BY dr.incident_date DESC';
        return c.json(await db.prepare(sql).all(...params));
      }

      let sql = `SELECT dr.*, u.full_name as officer_name, ib.full_name as issued_by_name
                 FROM disciplinary_records dr
                 JOIN users u ON u.id = dr.officer_id
                 LEFT JOIN users ib ON ib.id = dr.issued_by
                 WHERE 1=1`;
      const params: any[] = [];

      if (officer_id) { sql += ' AND dr.officer_id = ?'; params.push(Number(officer_id)); }
      if (type) { sql += ' AND dr.type = ?'; params.push(type); }
      if (severity) { sql += ' AND dr.severity = ?'; params.push(severity); }
      if (status) { sql += ' AND dr.status = ?'; params.push(status); }
      if (start_date) { sql += ' AND dr.incident_date >= ?'; params.push(start_date); }
      if (end_date) { sql += ' AND dr.incident_date <= ?'; params.push(end_date); }

      sql += ' ORDER BY dr.incident_date DESC';
      return c.json(await db.prepare(sql).all(...params));
    } catch (error: any) {
      console.error('[HR] Disciplinary list error:', error?.message);
      return c.json({ error: 'Failed to load disciplinary records', code: 'FAILED_TO_LOAD_DISCIPLINARY' }, 500);
    }
  });

  api.get('/disciplinary/:officerId/timeline', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const officerId = parseInt(c.req.param('officerId') || '0', 10);

      if (!isManagerOrAbove(user.role) && user.userId !== officerId) {
        return c.json({ error: 'Access denied', code: 'ACCESS_DENIED' }, 403);
      }

      if (isManagerOrAbove(user.role)) {
        const rows = await db.prepare(
          `SELECT dr.*, u.full_name as officer_name, ib.full_name as issued_by_name
           FROM disciplinary_records dr
           JOIN users u ON u.id = dr.officer_id
           LEFT JOIN users ib ON ib.id = dr.issued_by
           WHERE dr.officer_id = ? ORDER BY dr.incident_date DESC`
        ).all(officerId);
        return c.json(rows);
      }

      const rows = await db.prepare(
        `SELECT dr.id, dr.officer_id, dr.type, dr.severity, dr.incident_date, dr.description,
                dr.action_taken, dr.follow_up_date, dr.follow_up_notes, dr.status,
                dr.attachments, dr.created_at, dr.updated_at,
                u.full_name as officer_name
         FROM disciplinary_records dr
         JOIN users u ON u.id = dr.officer_id
         WHERE dr.officer_id = ? ORDER BY dr.incident_date DESC`
      ).all(officerId);
      return c.json(rows);
    } catch (error: any) {
      console.error('[HR] Disciplinary timeline error:', error?.message);
      return c.json({ error: 'Failed to load timeline', code: 'FAILED_TO_LOAD_TIMELINE' }, 500);
    }
  });

  api.post('/disciplinary', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { officer_id, type, severity, incident_date, description, action_taken,
              follow_up_date, follow_up_notes, status, witness, attachments } = await c.req.json();

      const DISC_TYPES = ['verbal_warning', 'written_warning', 'suspension', 'probation', 'termination', 'counseling', 'other'] as const;
      const DISC_SEVERITIES = ['minor', 'moderate', 'major', 'critical'] as const;
      const DISC_STATUSES = ['open', 'pending_review', 'closed', 'appealed'] as const;

      const validOfficerId = requireInt(officer_id, 'officer_id');
      if (!validOfficerId) return c.json({ error: 'officer_id is required', code: 'OFFICERID_IS_REQUIRED' }, 400);
      const validIncDate = validateDateStr(incident_date, 'incident_date');
      if (!validIncDate) return c.json({ error: 'incident_date is required (YYYY-MM-DD)', code: 'INCIDENTDATE_IS_REQUIRED_YYYYMMDD' }, 400);
      const validDesc = validateStr(description, 'description', 5000);
      if (!validDesc) return c.json({ error: 'description is required', code: 'DESCRIPTION_IS_REQUIRED' }, 400);

      const validDiscType = validateEnum(type || 'verbal_warning', DISC_TYPES, 'type');
      const validSeverity = validateEnum(severity || 'minor', DISC_SEVERITIES, 'severity');
      const validDiscStatus = validateEnum(status || 'open', DISC_STATUSES, 'status');
      if (follow_up_date) validateDateStr(follow_up_date, 'follow_up_date');
      if (action_taken) validateStr(action_taken, 'action_taken', 2000);
      if (follow_up_notes) validateStr(follow_up_notes, 'follow_up_notes', 5000);
      if (witness) validateStr(witness, 'witness', 200);

      const now = localNow();
      const result = await db.prepare(
        `INSERT INTO disciplinary_records (officer_id, type, severity, incident_date, description, action_taken,
         follow_up_date, follow_up_notes, status, issued_by, witness, attachments, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(validOfficerId, validDiscType, validSeverity, validIncDate, validDesc,
        action_taken || null, follow_up_date || null, follow_up_notes || null,
        validDiscStatus, user.userId, witness || null, attachments || '[]', now, now);

      return c.json({ success: true, id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      if (error.message?.startsWith('Invalid ') ||
          error.message?.includes('must be') ||
          error.message?.includes('is required') ||
          error.message?.includes('is not a valid') ||
          error.message?.includes('exceeds max length')) {
        return c.json({ error: error.message }, 400);
      }
      console.error('[HR] Disciplinary create error:', error?.message);
      return c.json({ error: 'Failed to create disciplinary record', code: 'FAILED_TO_CREATE_DISCIPLINARY' }, 500);
    }
  });

  api.put('/disciplinary/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

      const existing = await db.prepare('SELECT * FROM disciplinary_records WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

      const { type, severity, incident_date, description, action_taken,
              follow_up_date, follow_up_notes, status, witness, attachments } = await c.req.json();
      const now = localNow();

      await db.prepare(
        `UPDATE disciplinary_records SET
         type = COALESCE(?, type), severity = COALESCE(?, severity),
         incident_date = COALESCE(?, incident_date), description = COALESCE(?, description),
         action_taken = COALESCE(?, action_taken), follow_up_date = COALESCE(?, follow_up_date),
         follow_up_notes = COALESCE(?, follow_up_notes), status = COALESCE(?, status),
         witness = COALESCE(?, witness), attachments = COALESCE(?, attachments),
         updated_at = ? WHERE id = ?`
      ).run(type || null, severity || null, incident_date || null, description || null,
        action_taken ?? null, follow_up_date ?? null, follow_up_notes ?? null,
        status || null, witness ?? null, attachments ?? null, now, id);

      return c.json({ success: true });
    } catch (error: any) {
      console.error('[HR] Disciplinary update error:', error?.message);
      return c.json({ error: 'Failed to update disciplinary record', code: 'FAILED_TO_UPDATE_DISCIPLINARY' }, 500);
    }
  });

  api.delete('/disciplinary/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

      const existing = await db.prepare('SELECT * FROM disciplinary_records WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

      await db.prepare('DELETE FROM disciplinary_records WHERE id = ?').run(id);

      return c.json({ success: true });
    } catch (error: any) {
      console.error('[HR] Disciplinary delete error:', error?.message);
      return c.json({ error: 'Failed to delete disciplinary record', code: 'FAILED_TO_DELETE_DISCIPLINARY' }, 500);
    }
  });

  // ─── Performance Reviews ───────────────────────────────────
  api.get('/reviews', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { officer_id, reviewer_id, type, status } = c.req.query();

      let sql = `SELECT pr.*, u.full_name as officer_name, rv.full_name as reviewer_name
                 FROM performance_reviews pr
                 JOIN users u ON u.id = pr.officer_id
                 LEFT JOIN users rv ON rv.id = pr.reviewer_id
                 WHERE 1=1`;
      const params: any[] = [];

      if (!isManagerOrAbove(user.role)) {
        sql += ' AND pr.officer_id = ?';
        params.push(user.userId);
      } else {
        if (officer_id) { sql += ' AND pr.officer_id = ?'; params.push(Number(officer_id)); }
        if (reviewer_id) { sql += ' AND pr.reviewer_id = ?'; params.push(Number(reviewer_id)); }
      }

      if (type) { sql += ' AND pr.type = ?'; params.push(type); }
      if (status) { sql += ' AND pr.status = ?'; params.push(status); }

      sql += ' ORDER BY pr.created_at DESC';
      return c.json(await db.prepare(sql).all(...params));
    } catch (error: any) {
      console.error('[HR] Reviews list error:', error?.message);
      return c.json({ error: 'Failed to load reviews', code: 'FAILED_TO_LOAD_REVIEWS' }, 500);
    }
  });

  api.post('/reviews', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { officer_id, reviewer_id, review_period_start, review_period_end, review_date,
              type, overall_rating, categories, strengths, areas_for_improvement, goals, status } = await c.req.json();

      const REVIEW_TYPES = ['annual', 'semi_annual', 'quarterly', 'probationary', 'special'] as const;
      const REVIEW_STATUSES = ['draft', 'submitted', 'completed', 'acknowledged'] as const;

      const validOid = requireInt(officer_id, 'officer_id');
      if (!validOid) return c.json({ error: 'officer_id is required', code: 'OFFICERID_IS_REQUIRED' }, 400);
      const validStart = validateDateStr(review_period_start, 'review_period_start');
      if (!validStart) return c.json({ error: 'review_period_start is required (YYYY-MM-DD)', code: 'REVIEWPERIODSTART_IS_REQUIRED_YYYYMMDD' }, 400);
      const validEnd = validateDateStr(review_period_end, 'review_period_end');
      if (!validEnd) return c.json({ error: 'review_period_end is required (YYYY-MM-DD)', code: 'REVIEWPERIODEND_IS_REQUIRED_YYYYMMDD' }, 400);
      if (reviewer_id) requireInt(reviewer_id, 'reviewer_id');
      if (review_date) validateDateStr(review_date, 'review_date');
      const validRevType = validateEnum(type, REVIEW_TYPES, 'type') || 'annual';
      const validRevStatus = validateEnum(status, REVIEW_STATUSES, 'status') || 'draft';
      if (overall_rating != null) requireFloat(overall_rating, 'overall_rating', 0, 10);

      const now = localNow();
      const user = c.get('user');
      const result = await db.prepare(
        `INSERT INTO performance_reviews (officer_id, reviewer_id, review_period_start, review_period_end,
         review_date, type, overall_rating, categories, strengths, areas_for_improvement, goals, status,
         created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(validOid, reviewer_id || user.userId, validStart, validEnd,
        review_date || null, validRevType, overall_rating || null,
        typeof categories === 'object' ? JSON.stringify(categories) : (categories || '{}'),
        strengths || null, areas_for_improvement || null, goals || null,
        validRevStatus, now, now);

      return c.json({ success: true, id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      if (error.message?.startsWith('Invalid ') ||
          error.message?.includes('must be') ||
          error.message?.includes('is required') ||
          error.message?.includes('is not a valid') ||
          error.message?.includes('exceeds max length')) {
        return c.json({ error: error.message }, 400);
      }
      console.error('[HR] Review create error:', error?.message);
      return c.json({ error: 'Failed to create review', code: 'FAILED_TO_CREATE_REVIEW' }, 500);
    }
  });

  api.put('/reviews/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

      const existing = await db.prepare('SELECT * FROM performance_reviews WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Review not found', code: 'REVIEW_NOT_FOUND' }, 404);

      if (!isManagerOrAbove(user.role) && user.role !== 'admin') {
        if (existing.officer_id !== user.userId || existing.status !== 'draft') {
          return c.json({ error: 'Can only update own draft reviews', code: 'CAN_ONLY_UPDATE_OWN' }, 403);
        }
      }

      const { review_period_start, review_period_end, review_date, type, overall_rating,
              categories, strengths, areas_for_improvement, goals, status } = await c.req.json();
      const now = localNow();

      const catValue = categories != null
        ? (typeof categories === 'object' ? JSON.stringify(categories) : categories)
        : null;

      await db.prepare(
        `UPDATE performance_reviews SET
         review_period_start = COALESCE(?, review_period_start),
         review_period_end = COALESCE(?, review_period_end),
         review_date = COALESCE(?, review_date),
         type = COALESCE(?, type),
         overall_rating = COALESCE(?, overall_rating),
         categories = COALESCE(?, categories),
         strengths = COALESCE(?, strengths),
         areas_for_improvement = COALESCE(?, areas_for_improvement),
         goals = COALESCE(?, goals),
         status = COALESCE(?, status),
         updated_at = ? WHERE id = ?`
      ).run(review_period_start || null, review_period_end || null,
        review_date ?? null, type || null, overall_rating ?? null,
        catValue, strengths ?? null, areas_for_improvement ?? null,
        goals ?? null, status || null, now, id);

      return c.json({ success: true });
    } catch (error: any) {
      console.error('[HR] Review update error:', error?.message);
      return c.json({ error: 'Failed to update review', code: 'FAILED_TO_UPDATE_REVIEW' }, 500);
    }
  });

  api.post('/reviews/:id/acknowledge', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
      const { officer_comments } = await c.req.json();

      const existing = await db.prepare('SELECT * FROM performance_reviews WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Review not found', code: 'REVIEW_NOT_FOUND' }, 404);
      if (existing.officer_id !== user.userId && user.role !== 'admin') return c.json({ error: 'Can only acknowledge own reviews', code: 'CAN_ONLY_ACKNOWLEDGE_OWN' }, 403);

      const now = localNow();
      await db.prepare(
        `UPDATE performance_reviews SET officer_comments = ?, acknowledged_at = ?,
         status = 'acknowledged', updated_at = ? WHERE id = ?`
      ).run(officer_comments || null, now, now, id);

      return c.json({ success: true });
    } catch (error: any) {
      console.error('[HR] Review acknowledge error:', error?.message);
      return c.json({ error: 'Failed to acknowledge review', code: 'FAILED_TO_ACKNOWLEDGE_REVIEW' }, 500);
    }
  });

  api.delete('/reviews/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

      const existing = await db.prepare('SELECT * FROM performance_reviews WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Review not found', code: 'REVIEW_NOT_FOUND' }, 404);
      if (existing.status !== 'draft' && c.get('user')?.role !== 'admin') return c.json({ error: 'Can only delete draft reviews', code: 'CAN_ONLY_DELETE_DRAFT' }, 400);

      await db.prepare('DELETE FROM performance_reviews WHERE id = ?').run(id);

      return c.json({ success: true });
    } catch (error: any) {
      console.error('[HR] Review delete error:', error?.message);
      return c.json({ error: 'Failed to delete review', code: 'FAILED_TO_DELETE_REVIEW' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Payroll — Pay Periods, Pay Rates, Payroll Entries
  // ═══════════════════════════════════════════════════════════

  // ─── Pay Periods ───────────────────────────────────────────
  api.get('/payroll/periods', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { status, year } = c.req.query();
      let where = 'WHERE 1=1';
      const params: any[] = [];
      if (status) { where += ' AND pp.status = ?'; params.push(status); }
      if (year) { where += ' AND pp.start_date >= ? AND pp.start_date < ?'; params.push(`${year}-01-01`, `${Number(year)+1}-01-01`); }

      const periods = await db.prepare(`
        SELECT pp.*, u.full_name as created_by_name,
          (SELECT COUNT(*) FROM hr_payroll_entries pe WHERE pe.pay_period_id = pp.id) as entry_count,
          (SELECT COALESCE(SUM(pe.gross_pay), 0) FROM hr_payroll_entries pe WHERE pe.pay_period_id = pp.id) as total_gross,
          (SELECT COALESCE(SUM(pe.net_pay), 0) FROM hr_payroll_entries pe WHERE pe.pay_period_id = pp.id) as total_net
        FROM hr_pay_periods pp
        LEFT JOIN users u ON u.id = pp.created_by
        ${where}
        ORDER BY pp.start_date DESC
      `).all(...params);

      return c.json(periods);
    } catch (error: any) {
      console.error('[HR] Payroll periods error:', error?.message);
      return c.json({ error: 'Failed to fetch pay periods', code: 'FAILED_TO_FETCH_PAY' }, 500);
    }
  });

  api.post('/payroll/periods', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { name, start_date, end_date, pay_date } = await c.req.json();
      if (!start_date || !end_date || !pay_date) return c.json({ error: 'start_date, end_date, and pay_date are required', code: 'STARTDATE_ENDDATE_AND_PAYDATE' }, 400);

      const user = c.get('user');
      const result = await db.prepare(
        `INSERT INTO hr_pay_periods (name, start_date, end_date, pay_date, status, created_by) VALUES (?, ?, ?, ?, 'open', ?)`
      ).run(name || `Pay Period ${start_date} - ${end_date}`, start_date, end_date, pay_date, user.userId);

      const period = await db.prepare('SELECT * FROM hr_pay_periods WHERE id = ?').get(Number(result.meta.last_row_id));
      return c.json(period);
    } catch (error: any) {
      console.error('[HR] Create pay period error:', error?.message);
      return c.json({ error: 'Failed to create pay period', code: 'FAILED_TO_CREATE_PAY' }, 500);
    }
  });

  api.put('/payroll/periods/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
      const existing = await db.prepare('SELECT * FROM hr_pay_periods WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Pay period not found', code: 'PAY_PERIOD_NOT_FOUND' }, 404);

      const { name, start_date, end_date, pay_date, status } = await c.req.json();
      const updates: string[] = [];
      const params: any[] = [];
      if (name !== undefined) { updates.push('name = ?'); params.push(name); }
      if (start_date) { updates.push('start_date = ?'); params.push(start_date); }
      if (end_date) { updates.push('end_date = ?'); params.push(end_date); }
      if (pay_date) { updates.push('pay_date = ?'); params.push(pay_date); }
      if (status) {
        const validStatuses = ['open', 'processing', 'finalized', 'paid', 'closed'];
        if (!validStatuses.includes(status)) {
          return c.json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`, code: 'INVALID_PAY_PERIOD_STATUS' }, 400);
        }
        updates.push('status = ?'); params.push(status);
      }
      if (!updates.length) return c.json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' }, 400);

      params.push(id);
      await db.prepare(`UPDATE hr_pay_periods SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      const updated = await db.prepare('SELECT * FROM hr_pay_periods WHERE id = ?').get(id);
      return c.json(updated);
    } catch (error: any) {
      console.error('[HR] Update pay period error:', error?.message);
      return c.json({ error: 'Failed to update pay period', code: 'FAILED_TO_UPDATE_PAY' }, 500);
    }
  });

  api.delete('/payroll/periods/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
      const existing = await db.prepare('SELECT * FROM hr_pay_periods WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Pay period not found', code: 'PAY_PERIOD_NOT_FOUND' }, 404);
      if (existing.status !== 'open' && user.role !== 'admin') return c.json({ error: 'Can only delete open pay periods', code: 'CAN_ONLY_DELETE_OPEN' }, 400);

      await db.prepare('DELETE FROM hr_payroll_entries WHERE pay_period_id = ?').run(id);
      await db.prepare('DELETE FROM hr_pay_periods WHERE id = ?').run(id);

      return c.json({ success: true });
    } catch (error: any) {
      console.error('[HR] Delete pay period error:', error?.message);
      return c.json({ error: 'Failed to delete pay period', code: 'FAILED_TO_DELETE_PAY' }, 500);
    }
  });

  // ─── Pay Rates ─────────────────────────────────────────────
  api.get('/payroll/rates', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { user_id } = c.req.query();
      let where = 'WHERE pr.end_date IS NULL';
      const params: any[] = [];
      if (user_id) { where += ' AND pr.user_id = ?'; params.push(Number(user_id)); }

      const rates = await db.prepare(`
        SELECT pr.*, u.full_name as officer_name, cb.full_name as created_by_name
        FROM hr_pay_rates pr
        JOIN users u ON u.id = pr.user_id
        LEFT JOIN users cb ON cb.id = pr.created_by
        ${where}
        ORDER BY u.full_name, pr.effective_date DESC
        LIMIT 1000
      `).all(...params);

      return c.json(rates);
    } catch (error: any) {
      console.error('[HR] Pay rates error:', error?.message);
      return c.json({ error: 'Failed to fetch pay rates', code: 'FAILED_TO_FETCH_PAY' }, 500);
    }
  });

  api.post('/payroll/rates', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { user_id, pay_type, rate, overtime_rate, holiday_rate, effective_date, notes } = await c.req.json();
      if (!user_id || !pay_type || rate === undefined || !effective_date) {
        return c.json({ error: 'user_id, pay_type, rate, and effective_date are required', code: 'USERID_PAYTYPE_RATE_AND' }, 400);
      }

      const user = c.get('user');

      await db.prepare(`UPDATE hr_pay_rates SET end_date = ? WHERE user_id = ? AND end_date IS NULL`).run(effective_date, user_id);

      const result = await db.prepare(`
        INSERT INTO hr_pay_rates (user_id, pay_type, rate, overtime_rate, holiday_rate, effective_date, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(user_id, pay_type, rate, overtime_rate ?? 1.5, holiday_rate ?? 1.5, effective_date, notes || null, user.userId);

      const newRate = await db.prepare('SELECT pr.*, u.full_name as officer_name FROM hr_pay_rates pr JOIN users u ON u.id = pr.user_id WHERE pr.id = ?').get(Number(result.meta.last_row_id));
      return c.json(newRate);
    } catch (error: any) {
      console.error('[HR] Create pay rate error:', error?.message);
      return c.json({ error: 'Failed to create pay rate', code: 'FAILED_TO_CREATE_PAY' }, 500);
    }
  });

  // ─── Payroll Entries ───────────────────────────────────────
  api.get('/payroll/entries', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { pay_period_id, user_id } = c.req.query();
      if (!pay_period_id) return c.json({ error: 'pay_period_id is required', code: 'PAYPERIODID_IS_REQUIRED' }, 400);

      let where = 'WHERE pe.pay_period_id = ?';
      const params: any[] = [Number(pay_period_id)];
      if (user_id) { where += ' AND pe.user_id = ?'; params.push(Number(user_id)); }

      const entries = await db.prepare(`
        SELECT pe.*, u.full_name as officer_name, u.badge_number,
          pr.pay_type, pr.rate as hourly_rate,
          ab.full_name as approved_by_name
        FROM hr_payroll_entries pe
        JOIN users u ON u.id = pe.user_id
        LEFT JOIN hr_pay_rates pr ON pr.id = pe.pay_rate_id
        LEFT JOIN users ab ON ab.id = pe.approved_by
        ${where}
        ORDER BY u.full_name
        LIMIT 1000
      `).all(...params);

      return c.json(entries);
    } catch (error: any) {
      console.error('[HR] Payroll entries error:', error?.message);
      return c.json({ error: 'Failed to fetch payroll entries', code: 'FAILED_TO_FETCH_PAYROLL' }, 500);
    }
  });

  api.post('/payroll/entries', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { pay_period_id, user_id, regular_hours, overtime_hours, holiday_hours, pto_hours, sick_hours, other_hours, other_hours_description, notes } = await c.req.json();
      if (!pay_period_id || !user_id) return c.json({ error: 'pay_period_id and user_id are required', code: 'PAYPERIODID_AND_USERID_ARE' }, 400);

      const payRate = await db.prepare(`
        SELECT * FROM hr_pay_rates WHERE user_id = ? AND end_date IS NULL ORDER BY effective_date DESC LIMIT 1
      `).get(user_id) as any;

      const rate = payRate?.rate ?? 0;
      const otMult = payRate?.overtime_rate ?? 1.5;
      const holMult = payRate?.holiday_rate ?? 1.5;

      const regHrs = regular_hours ?? 0;
      const otHrs = overtime_hours ?? 0;
      const holHrs = holiday_hours ?? 0;

      const basePay = regHrs * rate;
      const overtimePay = otHrs * rate * otMult;
      const holidayPay = holHrs * rate * holMult;
      const grossPay = basePay + overtimePay + holidayPay;

      const now = localNow();
      const result = await db.prepare(`
        INSERT INTO hr_payroll_entries (
          user_id, pay_period_id, pay_rate_id, regular_hours, overtime_hours, holiday_hours,
          pto_hours, sick_hours, other_hours, other_hours_description,
          base_pay, overtime_pay, holiday_pay, gross_pay, total_deductions, net_pay,
          status, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'draft', ?, ?, ?)
      `).run(
        user_id, pay_period_id, payRate?.id ?? null,
        regHrs, otHrs, holHrs,
        pto_hours ?? 0, sick_hours ?? 0, other_hours ?? 0, other_hours_description || null,
        basePay, overtimePay, holidayPay, grossPay, grossPay,
        notes || null, now, now
      );

      const entry = await db.prepare(`
        SELECT pe.*, u.full_name as officer_name FROM hr_payroll_entries pe JOIN users u ON u.id = pe.user_id WHERE pe.id = ?
      `).get(Number(result.meta.last_row_id));

      return c.json(entry);
    } catch (error: any) {
      console.error('[HR] Create payroll entry error:', error?.message);
      return c.json({ error: 'Failed to create payroll entry', code: 'FAILED_TO_CREATE_PAYROLL' }, 500);
    }
  });

  api.put('/payroll/entries/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
      const existing = await db.prepare('SELECT * FROM hr_payroll_entries WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Payroll entry not found', code: 'PAYROLL_ENTRY_NOT_FOUND' }, 404);
      if (existing.status === 'approved' && user.role !== 'admin') {
        return c.json({ error: 'Cannot edit approved entries', code: 'CANNOT_EDIT_APPROVED_ENTRIES' }, 400);
      }

      const { regular_hours, overtime_hours, holiday_hours, pto_hours, sick_hours, other_hours, other_hours_description, notes, status } = await c.req.json();

      const payRate = existing.pay_rate_id
        ? await db.prepare('SELECT * FROM hr_pay_rates WHERE id = ?').get(existing.pay_rate_id) as any
        : null;

      const rate = payRate?.rate ?? 0;
      const otMult = payRate?.overtime_rate ?? 1.5;
      const holMult = payRate?.holiday_rate ?? 1.5;

      const regHrs = regular_hours ?? existing.regular_hours;
      const otHrs = overtime_hours ?? existing.overtime_hours;
      const holHrs = holiday_hours ?? existing.holiday_hours;

      const basePay = regHrs * rate;
      const overtimePay = otHrs * rate * otMult;
      const holidayPay = holHrs * rate * holMult;
      const grossPay = basePay + overtimePay + holidayPay;

      const now = localNow();

      await db.prepare(`
        UPDATE hr_payroll_entries SET
          regular_hours = ?, overtime_hours = ?, holiday_hours = ?,
          pto_hours = ?, sick_hours = ?, other_hours = ?, other_hours_description = ?,
          base_pay = ?, overtime_pay = ?, holiday_pay = ?, gross_pay = ?, net_pay = ?,
          status = ?, notes = ?,
          approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
          approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END,
          updated_at = ?
        WHERE id = ?
      `).run(
        regHrs, otHrs, holHrs,
        pto_hours ?? existing.pto_hours, sick_hours ?? existing.sick_hours,
        other_hours ?? existing.other_hours, other_hours_description ?? existing.other_hours_description,
        basePay, overtimePay, holidayPay, grossPay, grossPay,
        status ?? existing.status, notes ?? existing.notes,
        status, user.userId, status, now, now, id
      );

      const updated = await db.prepare(`
        SELECT pe.*, u.full_name as officer_name FROM hr_payroll_entries pe JOIN users u ON u.id = pe.user_id WHERE pe.id = ?
      `).get(id);

      return c.json(updated);
    } catch (error: any) {
      console.error('[HR] Update payroll entry error:', error?.message);
      return c.json({ error: 'Failed to update payroll entry', code: 'FAILED_TO_UPDATE_PAYROLL' }, 500);
    }
  });

  // ─── Auto-populate period ──────────────────────────────────
  api.post('/payroll/periods/:id/populate', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
      const period = await db.prepare('SELECT * FROM hr_pay_periods WHERE id = ?').get(id) as any;
      if (!period) return c.json({ error: 'Pay period not found', code: 'PAY_PERIOD_NOT_FOUND' }, 404);
      if (period.status !== 'open' && user.role !== 'admin') return c.json({ error: 'Can only populate open pay periods', code: 'CAN_ONLY_POPULATE_OPEN' }, 400);

      const activeUsers = await db.prepare(`
        SELECT u.id, u.full_name, pr.id as pay_rate_id, pr.rate, pr.pay_type
        FROM users u
        LEFT JOIN hr_pay_rates pr ON pr.user_id = u.id AND pr.end_date IS NULL
        WHERE u.status = 'active' AND u.archived_at IS NULL
        ORDER BY u.full_name
        LIMIT 1000
      `).all() as any[];

      const existing = await db.prepare('SELECT user_id FROM hr_payroll_entries WHERE pay_period_id = ?').all(id) as any[];
      const existingIds = new Set(existing.map((e: any) => e.user_id));

      const now = localNow();
      let created = 0;
      const insert = db.prepare(`
        INSERT INTO hr_payroll_entries (
          user_id, pay_period_id, pay_rate_id,
          regular_hours, overtime_hours, holiday_hours, pto_hours, sick_hours, other_hours,
          base_pay, overtime_pay, holiday_pay, gross_pay, total_deductions, net_pay,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'draft', ?, ?)
      `);

      for (const userRow of activeUsers) {
        if (existingIds.has(userRow.id)) continue;
        await insert.run(userRow.id, id, userRow.pay_rate_id ?? null, now, now);
        created++;
      }

      return c.json({ success: true, created, total: activeUsers.length });
    } catch (error: any) {
      console.error('[HR] Populate pay period error:', error?.message);
      return c.json({ error: 'Failed to populate pay period', code: 'FAILED_TO_POPULATE_PAY' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // CSV Exports
  // ═══════════════════════════════════════════════════════════

  api.get('/leave/export/csv', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT lr.*, u.full_name as officer_name, r.full_name as reviewer_name
        FROM leave_requests lr JOIN users u ON u.id = lr.officer_id
        LEFT JOIN users r ON r.id = lr.reviewed_by
        ORDER BY lr.created_at DESC LIMIT 10000
      `).all();
      const csv = buildCsv([
        { key: 'officer_name', header: 'Employee' },
        { key: 'type', header: 'Leave Type' },
        { key: 'start_date', header: 'Start Date' },
        { key: 'end_date', header: 'End Date' },
        { key: 'hours_requested', header: 'Hours' },
        { key: 'reason', header: 'Reason' },
        { key: 'status', header: 'Status' },
        { key: 'reviewer_name', header: 'Reviewed By' },
        { key: 'created_at', header: 'Submitted' },
      ], rows);
      c.header('Content-Type', 'text/csv');
      c.header('Content-Disposition', 'attachment; filename="leave-requests.csv"');
      return c.body(csv);
    } catch (error: any) {
      console.error('[HR] Leave CSV export error:', error?.message);
      return c.json({ error: 'Export failed', code: 'EXPORT_FAILED' }, 500);
    }
  });

  api.get('/disciplinary/export/csv', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT dr.*, u.full_name as officer_name, ib.full_name as issued_by_name
        FROM disciplinary_records dr JOIN users u ON u.id = dr.officer_id
        LEFT JOIN users ib ON ib.id = dr.issued_by
        ORDER BY dr.created_at DESC LIMIT 10000
      `).all();
      const csv = buildCsv([
        { key: 'officer_name', header: 'Employee' },
        { key: 'type', header: 'Type' },
        { key: 'severity', header: 'Severity' },
        { key: 'incident_date', header: 'Incident Date' },
        { key: 'description', header: 'Description' },
        { key: 'action_taken', header: 'Action Taken' },
        { key: 'status', header: 'Status' },
        { key: 'issued_by_name', header: 'Issued By' },
        { key: 'created_at', header: 'Created' },
      ], rows);
      c.header('Content-Type', 'text/csv');
      c.header('Content-Disposition', 'attachment; filename="disciplinary-records.csv"');
      return c.body(csv);
    } catch (error: any) {
      console.error('[HR] Disciplinary CSV export error:', error?.message);
      return c.json({ error: 'Export failed', code: 'EXPORT_FAILED' }, 500);
    }
  });

  api.get('/reviews/export/csv', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT pr.*, u.full_name as officer_name, rv.full_name as reviewer_name
        FROM performance_reviews pr JOIN users u ON u.id = pr.officer_id
        LEFT JOIN users rv ON rv.id = pr.reviewer_id
        ORDER BY pr.created_at DESC LIMIT 10000
      `).all();
      const csv = buildCsv([
        { key: 'officer_name', header: 'Employee' },
        { key: 'type', header: 'Review Type' },
        { key: 'review_period_start', header: 'Period Start' },
        { key: 'review_period_end', header: 'Period End' },
        { key: 'overall_rating', header: 'Overall Rating' },
        { key: 'status', header: 'Status' },
        { key: 'reviewer_name', header: 'Reviewer' },
        { key: 'review_date', header: 'Review Date' },
      ], rows);
      c.header('Content-Type', 'text/csv');
      c.header('Content-Disposition', 'attachment; filename="performance-reviews.csv"');
      return c.body(csv);
    } catch (error: any) {
      console.error('[HR] Reviews CSV export error:', error?.message);
      return c.json({ error: 'Export failed', code: 'EXPORT_FAILED' }, 500);
    }
  });

  api.get('/payroll/export/csv', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { pay_period_id } = c.req.query();
      if (!pay_period_id) return c.json({ error: 'pay_period_id required', code: 'PAYPERIODID_REQUIRED' }, 400);
      const rows = await db.prepare(`
        SELECT pe.*, u.full_name as officer_name, u.badge_number
        FROM hr_payroll_entries pe JOIN users u ON u.id = pe.user_id
        WHERE pe.pay_period_id = ? ORDER BY u.full_name
        LIMIT 1000
      `).all(Number(pay_period_id));
      const csv = buildCsv([
        { key: 'officer_name', header: 'Employee' },
        { key: 'badge_number', header: 'Badge' },
        { key: 'regular_hours', header: 'Reg Hours' },
        { key: 'overtime_hours', header: 'OT Hours' },
        { key: 'holiday_hours', header: 'Holiday Hours' },
        { key: 'pto_hours', header: 'PTO Hours' },
        { key: 'sick_hours', header: 'Sick Hours' },
        { key: 'base_pay', header: 'Base Pay' },
        { key: 'overtime_pay', header: 'OT Pay' },
        { key: 'holiday_pay', header: 'Holiday Pay' },
        { key: 'gross_pay', header: 'Gross Pay' },
        { key: 'net_pay', header: 'Net Pay' },
        { key: 'status', header: 'Status' },
      ], rows);
      c.header('Content-Type', 'text/csv');
      c.header('Content-Disposition', 'attachment; filename="payroll.csv"');
      return c.body(csv);
    } catch (error: any) {
      console.error('[HR] Payroll CSV export error:', error?.message);
      return c.json({ error: 'Export failed', code: 'EXPORT_FAILED' }, 500);
    }
  });

  // ─── Overtime Approval Workflow ────────────────────────────
  // Note: overtime_requests table creation (Express module-level side effect)
  // is skipped in Worker context — table must exist in D1 schema.

  api.get('/payroll/overtime', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { status, officer_id } = c.req.query();
      let where = 'WHERE 1=1';
      const params: any[] = [];
      if (status) { where += ' AND status = ?'; params.push(status); }
      if (officer_id) { where += ' AND officer_id = ?'; params.push(officer_id); }
      const user = c.get('user');
      if (!isManagerOrAbove(user.role)) { where += ' AND officer_id = ?'; params.push(user.userId); }
      const rows = await db.prepare(`SELECT * FROM overtime_requests ${where} ORDER BY created_at DESC
        LIMIT 1000
      `).all(...params);
      return c.json(rows);
    } catch (error: any) {
      return c.json({ error: 'Failed to fetch OT requests', code: 'FAILED_TO_FETCH_OT' }, 500);
    }
  });

  api.post('/payroll/overtime', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { requested_date, hours_requested, reason } = await c.req.json();
      if (!requested_date || !hours_requested) {
        return c.json({ error: 'requested_date and hours_requested are required', code: 'REQUESTEDDATE_AND_HOURSREQUESTED_ARE' }, 400);
      }
      const now = localNow();
      const officerName = ((await db.prepare('SELECT full_name FROM users WHERE id = ?').get(user.userId)) as any)?.full_name || '';
      const result = await db.prepare(`
        INSERT INTO overtime_requests (officer_id, officer_name, requested_date, hours_requested, reason, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'requested', ?)
      `).run(user.userId, officerName, requested_date, parseFloat(String(hours_requested)), reason || null, now);
      return c.json({ id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to create OT request', code: 'FAILED_TO_CREATE_OT' }, 500);
    }
  });

  api.put('/payroll/overtime/:id', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { status, review_notes } = await c.req.json();
      if (!['approved', 'denied'].includes(status)) {
        return c.json({ error: 'Status must be approved or denied', code: 'STATUS_MUST_BE_APPROVED' }, 400);
      }
      const now = localNow();
      const reviewerName = ((await db.prepare('SELECT full_name FROM users WHERE id = ?').get(user.userId)) as any)?.full_name || '';
      await db.prepare(`
        UPDATE overtime_requests SET status = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_notes = ? WHERE id = ?
      `).run(status, user.userId, reviewerName, now, review_notes || null, c.req.param('id'));
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to update OT request', code: 'FAILED_TO_UPDATE_OT' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // HR FEATURES (16-30)
  // ═══════════════════════════════════════════════════════════

  // ─── 16. Payroll Period Summary ────────────────────────────
  api.get('/payroll/periods/:id/summary', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
      const period = await db.prepare('SELECT * FROM hr_pay_periods WHERE id = ?').get(id) as any;
      if (!period) return c.json({ error: 'Pay period not found', code: 'PAY_PERIOD_NOT_FOUND' }, 404);

      const entries = await db.prepare(`
        SELECT pe.*, u.full_name as officer_name
        FROM hr_payroll_entries pe
        JOIN users u ON u.id = pe.user_id
        WHERE pe.pay_period_id = ?
        LIMIT 1000
      `).all(id) as any[];

      const summary = {
        period,
        employee_count: entries.length,
        total_regular_hours: entries.reduce((s: number, e: any) => s + (e.regular_hours || 0), 0),
        total_overtime_hours: entries.reduce((s: number, e: any) => s + (e.overtime_hours || 0), 0),
        total_holiday_hours: entries.reduce((s: number, e: any) => s + (e.holiday_hours || 0), 0),
        total_pto_hours: entries.reduce((s: number, e: any) => s + (e.pto_hours || 0), 0),
        total_sick_hours: entries.reduce((s: number, e: any) => s + (e.sick_hours || 0), 0),
        total_comp_time: entries.reduce((s: number, e: any) => s + (e.other_hours || 0), 0),
        total_gross_pay: entries.reduce((s: number, e: any) => s + (e.gross_pay || 0), 0),
        total_net_pay: entries.reduce((s: number, e: any) => s + (e.net_pay || 0), 0),
        entries,
      };

      return c.json(summary);
    } catch (error: any) {
      console.error('[HR] Period summary error:', error?.message);
      return c.json({ error: 'Failed to load period summary', code: 'FAILED_TO_LOAD_PERIOD' }, 500);
    }
  });

  // ─── 17. Performance Review Templates ──────────────────────
  api.get('/review-templates', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const templates = [
        {
          id: 'annual',
          name: 'Annual Performance Review',
          type: 'annual',
          categories: {
            job_knowledge: { label: 'Job Knowledge', weight: 20 },
            quality_of_work: { label: 'Quality of Work', weight: 20 },
            communication: { label: 'Communication', weight: 15 },
            teamwork: { label: 'Teamwork', weight: 15 },
            dependability: { label: 'Dependability', weight: 15 },
            initiative: { label: 'Initiative', weight: 15 },
          },
        },
        {
          id: 'quarterly',
          name: 'Quarterly Check-In',
          type: 'quarterly',
          categories: {
            goals_progress: { label: 'Goals Progress', weight: 40 },
            performance: { label: 'Performance', weight: 30 },
            development: { label: 'Development', weight: 30 },
          },
        },
        {
          id: 'probationary',
          name: 'Probationary Period Review',
          type: 'probationary',
          categories: {
            job_knowledge: { label: 'Job Knowledge', weight: 20 },
            attendance: { label: 'Attendance & Punctuality', weight: 20 },
            following_orders: { label: 'Following Orders', weight: 20 },
            professional_conduct: { label: 'Professional Conduct', weight: 20 },
            physical_fitness: { label: 'Physical Fitness', weight: 20 },
          },
        },
      ];
      return c.json(templates);
    } catch (error: any) {
      return c.json({ error: 'Failed to load templates', code: 'FAILED_TO_LOAD_TEMPLATES' }, 500);
    }
  });

  // ─── 18. Performance Score Trends ──────────────────────────
  api.get('/reviews/trends/:officerId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const officerId = parseInt(c.req.param('officerId') || '0', 10);

      const reviews = await db.prepare(`
        SELECT id, type, overall_rating, review_date, review_period_start, review_period_end, status, template_name
        FROM performance_reviews
        WHERE officer_id = ? AND overall_rating IS NOT NULL
        ORDER BY review_period_end ASC
        LIMIT 1000
      `).all(officerId) as any[];

      return c.json(reviews);
    } catch (error: any) {
      return c.json({ error: 'Failed to load review trends', code: 'FAILED_TO_LOAD_REVIEW' }, 500);
    }
  });

  // ─── 19. Disciplinary Escalation Tracking ──────────────────
  api.get('/disciplinary/:officerId/escalation', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const officerId = parseInt(c.req.param('officerId') || '0', 10);

      const records = await db.prepare(`
        SELECT id, type, severity, incident_date, status, description, action_taken
        FROM disciplinary_records
        WHERE officer_id = ?
        ORDER BY incident_date ASC
        LIMIT 1000
      `).all(officerId) as any[];

      const escalationOrder = ['counseling', 'verbal_warning', 'written_warning', 'suspension', 'probation', 'termination'];
      const escalation = records.map((r: any, i: number) => ({
        ...r,
        escalation_level: escalationOrder.indexOf(r.type) + 1,
        step: i + 1,
      }));

      const latestType = records.length > 0 ? records[records.length - 1].type : null;
      const nextStep = latestType ? escalationOrder[escalationOrder.indexOf(latestType) + 1] || 'termination' : 'verbal_warning';

      return c.json({ records: escalation, current_level: latestType, next_step: nextStep, total_actions: records.length });
    } catch (error: any) {
      return c.json({ error: 'Failed to load escalation', code: 'FAILED_TO_LOAD_ESCALATION' }, 500);
    }
  });

  // ─── 20. Training Completion Certificates ──────────────────
  api.get('/training-certificate/:trainingId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const record = await db.prepare(`
        SELECT tr.*, u.full_name as officer_name, u.badge_number
        FROM training_records tr
        JOIN users u ON u.id = tr.officer_id
        WHERE tr.id = ?
      `).get(Number(c.req.param('trainingId'))) as any;

      if (!record) return c.json({ error: 'Training record not found', code: 'TRAINING_RECORD_NOT_FOUND' }, 404);
      if (record.status !== 'completed') return c.json({ error: 'Certificate only for completed training', code: 'CERTIFICATE_ONLY_FOR_COMPLETED' }, 400);

      return c.json({
        ...record,
        company: 'Rocky Mountain Protective Group',
        certificate_number: `RMPG-CERT-${String(record.id).padStart(6, '0')}`,
        issued_date: record.completed_date || localToday(),
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to generate certificate', code: 'FAILED_TO_GENERATE_CERTIFICATE' }, 500);
    }
  });

  // ─── 21. HR Document Library ───────────────────────────────
  api.get('/documents', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { category } = c.req.query();
      let sql = `SELECT d.*, u.full_name as uploaded_by_name FROM hr_documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE 1=1`;
      const params: any[] = [];
      if (category) { sql += ' AND d.category = ?'; params.push(category); }
      sql += ' ORDER BY d.created_at DESC';
      return c.json(await db.prepare(sql).all(...params));
    } catch (error: any) {
      return c.json({ error: 'Failed to load documents', code: 'FAILED_TO_LOAD_DOCUMENTS' }, 500);
    }
  });

  api.post('/documents', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { title, category, description, file_path, file_name, file_size } = await c.req.json();
      if (!title) return c.json({ error: 'title is required', code: 'TITLE_IS_REQUIRED' }, 400);
      const now = localNow();
      const user = c.get('user');
      const result = await db.prepare(
        `INSERT INTO hr_documents (title, category, description, file_path, file_name, file_size, uploaded_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(title, category || 'policy', description || null, file_path || null, file_name || null, file_size || 0, user.userId, now, now);
      return c.json({ success: true, id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to create document', code: 'FAILED_TO_CREATE_DOCUMENT' }, 500);
    }
  });

  api.delete('/documents/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
      await db.prepare('DELETE FROM hr_documents WHERE id = ?').run(id);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to delete document', code: 'FAILED_TO_DELETE_DOCUMENT' }, 500);
    }
  });

  // ─── 22. Employee Handbook Acknowledgment ──────────────────
  api.get('/acknowledgments', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { document_id } = c.req.query();
      let sql = `SELECT a.*, u.full_name as officer_name, d.title as document_title
                 FROM hr_handbook_acknowledgments a
                 JOIN users u ON u.id = a.officer_id
                 JOIN hr_documents d ON d.id = a.document_id WHERE 1=1`;
      const params: any[] = [];
      if (document_id) { sql += ' AND a.document_id = ?'; params.push(Number(document_id)); }
      sql += ' ORDER BY a.acknowledged_at DESC';
      return c.json(await db.prepare(sql).all(...params));
    } catch (error: any) {
      return c.json({ error: 'Failed to load acknowledgments', code: 'FAILED_TO_LOAD_ACKNOWLEDGMENTS' }, 500);
    }
  });

  api.post('/acknowledgments', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { document_id, signature } = await c.req.json();
      if (!document_id) return c.json({ error: 'document_id is required', code: 'DOCUMENTID_IS_REQUIRED' }, 400);

      await db.prepare(
        `INSERT OR REPLACE INTO hr_handbook_acknowledgments (officer_id, document_id, acknowledged_at, signature, ip_address)
         VALUES (?, ?, ?, ?, ?)`
      ).run(user.userId, document_id, localNow(), signature || null, c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown');

      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to save acknowledgment', code: 'FAILED_TO_SAVE_ACKNOWLEDGMENT' }, 500);
    }
  });

  // ─── 23. Grievance Filing System ───────────────────────────
  api.get('/grievances', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { status, officer_id } = c.req.query();
      let sql = `SELECT g.*, u.full_name as officer_name, a.full_name as assigned_to_name
                 FROM hr_grievances g
                 JOIN users u ON u.id = g.officer_id
                 LEFT JOIN users a ON a.id = g.assigned_to WHERE 1=1`;
      const params: any[] = [];
      if (!isManagerOrAbove(user.role)) { sql += ' AND g.officer_id = ?'; params.push(user.userId); }
      else if (officer_id) { sql += ' AND g.officer_id = ?'; params.push(Number(officer_id)); }
      if (status) { sql += ' AND g.status = ?'; params.push(status); }
      sql += ' ORDER BY g.created_at DESC';
      return c.json(await db.prepare(sql).all(...params));
    } catch (error: any) {
      return c.json({ error: 'Failed to load grievances', code: 'FAILED_TO_LOAD_GRIEVANCES' }, 500);
    }
  });

  api.post('/grievances', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { type, subject, description, priority } = await c.req.json();
      if (!subject || !description) return c.json({ error: 'subject and description are required', code: 'SUBJECT_AND_DESCRIPTION_ARE' }, 400);
      const now = localNow();
      const result = await db.prepare(
        `INSERT INTO hr_grievances (officer_id, type, subject, description, priority, filed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(user.userId, type || 'general', subject, description, priority || 'normal', now, now, now);
      return c.json({ success: true, id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to file grievance', code: 'FAILED_TO_FILE_GRIEVANCE' }, 500);
    }
  });

  api.put('/grievances/:id', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
      const { status, assigned_to, resolution } = await c.req.json();
      const now = localNow();
      const sets: string[] = ['updated_at = ?'];
      const vals: any[] = [now];
      if (status) { sets.push('status = ?'); vals.push(status); if (status === 'resolved' || status === 'dismissed') { sets.push('resolved_at = ?'); vals.push(now); } }
      if (assigned_to !== undefined) { sets.push('assigned_to = ?'); vals.push(assigned_to); }
      if (resolution !== undefined) { sets.push('resolution = ?'); vals.push(resolution); }
      vals.push(id);
      await db.prepare(`UPDATE hr_grievances SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to update grievance', code: 'FAILED_TO_UPDATE_GRIEVANCE' }, 500);
    }
  });

  // ─── 24. Workers Comp Incident Tracking ────────────────────
  api.get('/workers-comp', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { officer_id, status } = c.req.query();
      let sql = `SELECT w.*, u.full_name as officer_name FROM hr_workers_comp w JOIN users u ON u.id = w.officer_id WHERE 1=1`;
      const params: any[] = [];
      if (officer_id) { sql += ' AND w.officer_id = ?'; params.push(Number(officer_id)); }
      if (status) { sql += ' AND w.status = ?'; params.push(status); }
      sql += ' ORDER BY w.incident_date DESC';
      return c.json(await db.prepare(sql).all(...params));
    } catch (error: any) {
      return c.json({ error: 'Failed to load workers comp incidents', code: 'FAILED_TO_LOAD_WORKERS' }, 500);
    }
  });

  api.post('/workers-comp', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { officer_id, incident_date, injury_type, body_part, description, location,
              witnesses, treatment, physician, osha_recordable, osha_case_number, claim_number } = await c.req.json();
      if (!officer_id || !incident_date || !injury_type || !description) {
        return c.json({ error: 'officer_id, incident_date, injury_type, and description are required', code: 'OFFICERID_INCIDENTDATE_INJURYTYPE_AND' }, 400);
      }
      const now = localNow();
      const result = await db.prepare(
        `INSERT INTO hr_workers_comp (officer_id, incident_date, injury_type, body_part, description, location,
         witnesses, treatment, physician, osha_recordable, osha_case_number, claim_number, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(officer_id, incident_date, injury_type, body_part || null, description, location || null,
        witnesses || null, treatment || null, physician || null, osha_recordable ? 1 : 0,
        osha_case_number || null, claim_number || null, now, now);
      return c.json({ success: true, id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to create workers comp record', code: 'FAILED_TO_CREATE_WORKERS' }, 500);
    }
  });

  api.put('/workers-comp/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
      const { status, lost_days, treatment, physician, claim_number } = await c.req.json();
      const now = localNow();
      const sets: string[] = ['updated_at = ?'];
      const vals: any[] = [now];
      if (status) { sets.push('status = ?'); vals.push(status); }
      if (lost_days !== undefined) { sets.push('lost_days = ?'); vals.push(lost_days); }
      if (treatment !== undefined) { sets.push('treatment = ?'); vals.push(treatment); }
      if (physician !== undefined) { sets.push('physician = ?'); vals.push(physician); }
      if (claim_number !== undefined) { sets.push('claim_number = ?'); vals.push(claim_number); }
      vals.push(id);
      await db.prepare(`UPDATE hr_workers_comp SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to update workers comp record', code: 'FAILED_TO_UPDATE_WORKERS' }, 500);
    }
  });

  // ─── 25. Exit Interview Form ───────────────────────────────
  api.get('/exit-interviews', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { officer_id } = c.req.query();
      let sql = `SELECT ei.*, u.full_name as officer_name, iv.full_name as interviewer_name
                 FROM hr_exit_interviews ei
                 JOIN users u ON u.id = ei.officer_id
                 LEFT JOIN users iv ON iv.id = ei.interviewer_id WHERE 1=1`;
      const params: any[] = [];
      if (officer_id) { sql += ' AND ei.officer_id = ?'; params.push(Number(officer_id)); }
      sql += ' ORDER BY ei.interview_date DESC';
      return c.json(await db.prepare(sql).all(...params));
    } catch (error: any) {
      return c.json({ error: 'Failed to load exit interviews', code: 'FAILED_TO_LOAD_EXIT' }, 500);
    }
  });

  api.post('/exit-interviews', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { officer_id, interview_date, reason_for_leaving, satisfaction_rating, would_return,
              what_liked, what_disliked, suggestions, management_feedback,
              work_environment_rating, compensation_rating, training_rating, notes } = await c.req.json();
      if (!officer_id || !interview_date) return c.json({ error: 'officer_id and interview_date are required', code: 'OFFICERID_AND_INTERVIEWDATE_ARE' }, 400);
      const result = await db.prepare(
        `INSERT INTO hr_exit_interviews (officer_id, interview_date, interviewer_id, reason_for_leaving,
         satisfaction_rating, would_return, what_liked, what_disliked, suggestions, management_feedback,
         work_environment_rating, compensation_rating, training_rating, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(officer_id, interview_date, user.userId, reason_for_leaving || null,
        satisfaction_rating || null, would_return ? 1 : 0, what_liked || null, what_disliked || null,
        suggestions || null, management_feedback || null, work_environment_rating || null,
        compensation_rating || null, training_rating || null, notes || null);
      return c.json({ success: true, id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to create exit interview', code: 'FAILED_TO_CREATE_EXIT' }, 500);
    }
  });

  // ─── 26. Salary History Tracking ───────────────────────────
  api.get('/salary-history/:officerId', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT sh.*, u.full_name as approved_by_name
        FROM hr_salary_history sh
        LEFT JOIN users u ON u.id = sh.approved_by
        WHERE sh.officer_id = ? ORDER BY sh.effective_date DESC
        LIMIT 1000
      `).all(Number(c.req.param('officerId')));
      return c.json(rows);
    } catch (error: any) {
      return c.json({ error: 'Failed to load salary history', code: 'FAILED_TO_LOAD_SALARY' }, 500);
    }
  });

  api.post('/salary-history', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { officer_id, effective_date, salary_amount, pay_type, reason } = await c.req.json();
      if (!officer_id || !effective_date || salary_amount === undefined) {
        return c.json({ error: 'officer_id, effective_date, and salary_amount are required', code: 'OFFICERID_EFFECTIVEDATE_AND_SALARYAMOUNT' }, 400);
      }
      const result = await db.prepare(
        `INSERT INTO hr_salary_history (officer_id, effective_date, salary_amount, pay_type, reason, approved_by)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(officer_id, effective_date, salary_amount, pay_type || 'hourly', reason || null, user.userId);
      return c.json({ success: true, id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to save salary history', code: 'FAILED_TO_SAVE_SALARY' }, 500);
    }
  });

  // ─── 27. Benefits Enrollment Tracker ───────────────────────
  api.get('/benefits', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { officer_id } = c.req.query();
      let sql = `SELECT b.*, u.full_name as officer_name FROM hr_benefits b JOIN users u ON u.id = b.officer_id WHERE 1=1`;
      const params: any[] = [];
      if (!isManagerOrAbove(user.role)) { sql += ' AND b.officer_id = ?'; params.push(user.userId); }
      else if (officer_id) { sql += ' AND b.officer_id = ?'; params.push(Number(officer_id)); }
      sql += ' ORDER BY b.benefit_type';
      return c.json(await db.prepare(sql).all(...params));
    } catch (error: any) {
      return c.json({ error: 'Failed to load benefits', code: 'FAILED_TO_LOAD_BENEFITS' }, 500);
    }
  });

  api.post('/benefits', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { officer_id, benefit_type, plan_name, provider, coverage_level,
              employee_cost, employer_cost, effective_date, end_date } = await c.req.json();
      if (!officer_id || !benefit_type) return c.json({ error: 'officer_id and benefit_type are required', code: 'OFFICERID_AND_BENEFITTYPE_ARE' }, 400);
      const now = localNow();
      const result = await db.prepare(
        `INSERT INTO hr_benefits (officer_id, benefit_type, plan_name, provider, coverage_level,
         employee_cost, employer_cost, effective_date, end_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(officer_id, benefit_type, plan_name || null, provider || null, coverage_level || null,
        employee_cost || 0, employer_cost || 0, effective_date || null, end_date || null, now, now);
      return c.json({ success: true, id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to create benefit record', code: 'FAILED_TO_CREATE_BENEFIT' }, 500);
    }
  });

  api.put('/benefits/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
      const { status, end_date, plan_name, coverage_level, employee_cost, employer_cost } = await c.req.json();
      const now = localNow();
      const sets: string[] = ['updated_at = ?'];
      const vals: any[] = [now];
      if (status !== undefined) { sets.push('status = ?'); vals.push(status); }
      if (end_date !== undefined) { sets.push('end_date = ?'); vals.push(end_date); }
      if (plan_name !== undefined) { sets.push('plan_name = ?'); vals.push(plan_name); }
      if (coverage_level !== undefined) { sets.push('coverage_level = ?'); vals.push(coverage_level); }
      if (employee_cost !== undefined) { sets.push('employee_cost = ?'); vals.push(employee_cost); }
      if (employer_cost !== undefined) { sets.push('employer_cost = ?'); vals.push(employer_cost); }
      vals.push(id);
      await db.prepare(`UPDATE hr_benefits SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to update benefit', code: 'FAILED_TO_UPDATE_BENEFIT' }, 500);
    }
  });

  // ─── 28. Performance Improvement Plan (PIP) ────────────────
  api.get('/pips', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { officer_id, status } = c.req.query();
      let sql = `SELECT p.*, u.full_name as officer_name, s.full_name as supervisor_name
                 FROM hr_pips p
                 JOIN users u ON u.id = p.officer_id
                 LEFT JOIN users s ON s.id = p.supervisor_id WHERE 1=1`;
      const params: any[] = [];
      if (officer_id) { sql += ' AND p.officer_id = ?'; params.push(Number(officer_id)); }
      if (status) { sql += ' AND p.status = ?'; params.push(status); }
      sql += ' ORDER BY p.created_at DESC';
      const rows = await db.prepare(sql).all(...params) as any[];
      return c.json(rows.map((r: any) => ({ ...r, goals: JSON.parse(r.goals || '[]'), milestones: JSON.parse(r.milestones || '[]') })));
    } catch (error: any) {
      return c.json({ error: 'Failed to load PIPs', code: 'FAILED_TO_LOAD_PIPS' }, 500);
    }
  });

  api.post('/pips', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { officer_id, start_date, end_date, reason, goals, milestones } = await c.req.json();
      if (!officer_id || !start_date || !end_date || !reason) {
        return c.json({ error: 'officer_id, start_date, end_date, and reason are required', code: 'OFFICERID_STARTDATE_ENDDATE_AND' }, 400);
      }
      const now = localNow();
      const result = await db.prepare(
        `INSERT INTO hr_pips (officer_id, supervisor_id, start_date, end_date, reason, goals, milestones, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(officer_id, user.userId, start_date, end_date, reason,
        JSON.stringify(goals || []), JSON.stringify(milestones || []), now, now);
      return c.json({ success: true, id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to create PIP', code: 'FAILED_TO_CREATE_PIP' }, 500);
    }
  });

  api.put('/pips/:id', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id') || '0', 10);
      if (id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
      const { status, goals, milestones, outcome, end_date } = await c.req.json();
      const now = localNow();
      const sets: string[] = ['updated_at = ?'];
      const vals: any[] = [now];
      if (status) { sets.push('status = ?'); vals.push(status); }
      if (goals) { sets.push('goals = ?'); vals.push(JSON.stringify(goals)); }
      if (milestones) { sets.push('milestones = ?'); vals.push(JSON.stringify(milestones)); }
      if (outcome !== undefined) { sets.push('outcome = ?'); vals.push(outcome); }
      if (end_date) { sets.push('end_date = ?'); vals.push(end_date); }
      vals.push(id);
      await db.prepare(`UPDATE hr_pips SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to update PIP', code: 'FAILED_TO_UPDATE_PIP' }, 500);
    }
  });

  // ─── 29. Training ROI Calculator ───────────────────────────
  api.get('/training-roi/:officerId', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const officerId = parseInt(c.req.param('officerId') || '0', 10);

      const training = await db.prepare(`
        SELECT SUM(hours) as total_hours, COUNT(*) as total_courses,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
        FROM training_records WHERE officer_id = ?
      `).get(officerId) as any;

      const reviews = await db.prepare(`
        SELECT overall_rating, review_date FROM performance_reviews
        WHERE officer_id = ? AND overall_rating IS NOT NULL
        ORDER BY review_date ASC
        LIMIT 1000
      `).all(officerId) as any[];

      const firstRating = reviews.length > 0 ? reviews[0].overall_rating : null;
      const lastRating = reviews.length > 1 ? reviews[reviews.length - 1].overall_rating : null;
      const ratingImprovement = firstRating && lastRating ? lastRating - firstRating : null;

      const estimatedCost = (training?.total_hours || 0) * 50;

      return c.json({
        officer_id: officerId,
        total_training_hours: training?.total_hours || 0,
        total_courses: training?.total_courses || 0,
        completed_courses: training?.completed || 0,
        estimated_training_cost: estimatedCost,
        first_performance_rating: firstRating,
        latest_performance_rating: lastRating,
        rating_improvement: ratingImprovement,
        roi_indicator: ratingImprovement && ratingImprovement > 0 ? 'positive' : ratingImprovement === 0 ? 'neutral' : 'needs_review',
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to calculate training ROI', code: 'FAILED_TO_CALCULATE_TRAINING' }, 500);
    }
  });

  // ─── 30. Attendance Tracking ───────────────────────────────
  api.get('/attendance', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { officer_id, start_date, end_date, type } = c.req.query();
      let sql = `SELECT a.*, u.full_name as officer_name, d.full_name as documented_by_name
                 FROM hr_attendance a
                 JOIN users u ON u.id = a.officer_id
                 LEFT JOIN users d ON d.id = a.documented_by WHERE 1=1`;
      const params: any[] = [];
      if (!isManagerOrAbove(user.role)) { sql += ' AND a.officer_id = ?'; params.push(user.userId); }
      else if (officer_id) { sql += ' AND a.officer_id = ?'; params.push(Number(officer_id)); }
      if (start_date) { sql += ' AND a.date >= ?'; params.push(start_date); }
      if (end_date) { sql += ' AND a.date <= ?'; params.push(end_date); }
      if (type) { sql += ' AND a.type = ?'; params.push(type); }
      sql += ' ORDER BY a.date DESC';
      return c.json(await db.prepare(sql).all(...params));
    } catch (error: any) {
      return c.json({ error: 'Failed to load attendance', code: 'FAILED_TO_LOAD_ATTENDANCE' }, 500);
    }
  });

  api.post('/attendance', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { officer_id, date, type, minutes_late, reason, excused } = await c.req.json();
      if (!officer_id || !date || !type) return c.json({ error: 'officer_id, date, and type are required', code: 'OFFICERID_DATE_AND_TYPE' }, 400);
      const result = await db.prepare(
        `INSERT INTO hr_attendance (officer_id, date, type, minutes_late, reason, excused, documented_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(officer_id, date, type, minutes_late || 0, reason || null, excused ? 1 : 0, user.userId);
      return c.json({ success: true, id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to log attendance', code: 'FAILED_TO_LOG_ATTENDANCE' }, 500);
    }
  });

  api.get('/attendance/summary/:officerId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const officerId = parseInt(c.req.param('officerId') || '0', 10);
      const { year } = c.req.query();
      const targetYear = year || new Date().getFullYear();

      const summary = await db.prepare(`
        SELECT type, COUNT(*) as count, SUM(CASE WHEN excused = 1 THEN 1 ELSE 0 END) as excused_count
        FROM hr_attendance
        WHERE officer_id = ? AND date LIKE ?
        GROUP BY type
      `).all(officerId, `${targetYear}%`) as any[];

      const total = summary.reduce((s: number, r: any) => s + r.count, 0);

      const mondayFriday = await db.prepare(`
        SELECT COUNT(*) as cnt FROM hr_attendance
        WHERE officer_id = ? AND date LIKE ? AND type IN ('absent','tardy')
          AND (CAST(strftime('%w', date) AS INTEGER) IN (1, 5))
      `).get(officerId, `${targetYear}%`) as any;

      return c.json({
        officer_id: officerId,
        year: targetYear,
        by_type: summary,
        total_incidents: total,
        monday_friday_pattern: (mondayFriday?.cnt || 0) >= 3,
        monday_friday_count: mondayFriday?.cnt || 0,
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to load attendance summary', code: 'FAILED_TO_LOAD_ATTENDANCE' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Path Aliases
  // ═══════════════════════════════════════════════════════════

  api.get('/performance-reviews', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      let sql = `SELECT r.*, u.full_name as officer_name, rev.full_name as reviewer_name FROM hr_performance_reviews r JOIN users u ON u.id = r.officer_id LEFT JOIN users rev ON rev.id = r.reviewer_id WHERE 1=1`;
      const params: any[] = [];
      if (!isManagerOrAbove(user.role)) { sql += ' AND r.officer_id = ?'; params.push(user.userId); }
      sql += ' ORDER BY r.review_date DESC';
      try { return c.json(await db.prepare(sql).all(...params)); } catch { return c.json([]); }
    } catch { return c.json([]); }
  });

  api.post('/performance-reviews', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const {
        officer_id, user_id, review_type, review_date, cycle_id,
        overall_rating, strengths, areas_for_improvement, goals, comments,
      } = await c.req.json();
      const resolvedUserId = user_id || officer_id;
      if (!resolvedUserId) return c.json({ error: 'officer_id (or user_id) is required', code: 'OFFICERID_REQUIRED' }, 400);
      const user = c.get('user');
      const reviewerId = user.userId;
      const result = await db.prepare(`
        INSERT INTO hr_performance_reviews (
          user_id, reviewer_id, cycle_id, review_date,
          overall_rating, strengths, areas_for_improvement, goals, comments, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
      `).run(
        resolvedUserId,
        reviewerId,
        cycle_id || null,
        review_date || localNow(),
        overall_rating || null,
        strengths || null,
        areas_for_improvement || null,
        goals || null,
        comments || null,
      );
      return c.json({ success: true, id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      console.error('[HR] performance-reviews POST error:', error?.message);
      return c.json({ error: 'Failed to create review', code: 'FAILED_TO_CREATE_REVIEW' }, 500);
    }
  });

  api.put('/performance-reviews/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = c.req.param('id');
      const body = await c.req.json();
      const fields = ['overall_rating', 'strengths', 'areas_for_improvement', 'goals', 'comments', 'status'];
      const sets: string[] = [];
      const vals: any[] = [];
      for (const f of fields) {
        if (body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(body[f]); }
      }
      if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' }, 400);
      vals.push(id);
      await db.prepare(`UPDATE hr_performance_reviews SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to update review', code: 'FAILED_TO_UPDATE_REVIEW' }, 500);
    }
  });

  api.get('/disciplinary-actions', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      let sql = `SELECT d.*, u.full_name as officer_name, iu.full_name as issued_by_name FROM hr_disciplinary d JOIN users u ON u.id = d.officer_id LEFT JOIN users iu ON iu.id = d.issued_by WHERE 1=1`;
      const params: any[] = [];
      if (!isManagerOrAbove(user.role)) { sql += ' AND d.officer_id = ?'; params.push(user.userId); }
      sql += ' ORDER BY d.issued_date DESC';
      return c.json(await db.prepare(sql).all(...params));
    } catch { return c.json([]); }
  });

  api.post('/disciplinary-actions', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { officer_id, action_type, severity, description, issued_date } = await c.req.json();
      if (!officer_id || !action_type) return c.json({ error: 'officer_id and action_type required', code: 'OFFICERID_AND_ACTIONTYPE_REQUIRED' }, 400);
      const result = await db.prepare(`
        INSERT INTO hr_disciplinary (officer_id, issued_by, action_type, severity, description, issued_date, status)
        VALUES (?, ?, ?, ?, ?, ?, 'active')
      `).run(officer_id, user.userId, action_type, severity || 'written_warning', description || null, issued_date || localNow());
      return c.json({ success: true, id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to create disciplinary action', code: 'FAILED_TO_CREATE_DISCIPLINARY' }, 500);
    }
  });

  api.put('/disciplinary-actions/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = c.req.param('id');
      const body = await c.req.json();
      const fields = ['action_type', 'severity', 'description', 'status', 'issued_date'];
      const sets: string[] = [];
      const vals: any[] = [];
      for (const f of fields) {
        if (body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(body[f]); }
      }
      if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' }, 400);
      vals.push(id);
      await db.prepare(`UPDATE hr_disciplinary SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      return c.json({ success: true });
    } catch (error: any) {
      console.error('[HR] disciplinary-actions PUT error:', error?.message);
      return c.json({ error: 'Failed to update disciplinary action', code: 'FAILED_TO_UPDATE_DISCIPLINARY' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // UPGRADE BATCH — HR Management Enhancements
  // ═══════════════════════════════════════════════════════════

  // ── U24: Leave Balance Calculations ────────────────────────
  api.get('/leave/balance-summary', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const year = q.year ? String(q.year) : new Date().getFullYear().toString();

      const balances = await db.prepare(`
        SELECT lb.*, u.full_name, u.badge_number
        FROM hr_leave_balances lb
        JOIN users u ON u.id = lb.officer_id
        WHERE u.status = 'active'
        ORDER BY u.full_name
        LIMIT 500
      `).all() as any[];

      const used = await db.prepare(`
        SELECT officer_id, leave_type, SUM(days_requested) as days_used, COUNT(*) as request_count
        FROM hr_leave_requests WHERE status = 'approved' AND strftime('%Y', start_date) = ?
        GROUP BY officer_id, leave_type
      `).all(year) as any[];

      const usedMap: Record<string, Record<string, number>> = {};
      for (const u of used) {
        if (!usedMap[u.officer_id]) usedMap[u.officer_id] = {};
        usedMap[u.officer_id][u.leave_type] = u.days_used;
      }

      const enriched = balances.map((b: any) => {
        const officerUsed = usedMap[b.officer_id] || {};
        return {
          ...b,
          vacation_used: officerUsed['vacation'] || 0,
          sick_used: officerUsed['sick'] || 0,
          personal_used: officerUsed['personal'] || 0,
          vacation_remaining: (b.vacation_balance || 0) - (officerUsed['vacation'] || 0),
          sick_remaining: (b.sick_balance || 0) - (officerUsed['sick'] || 0),
          personal_remaining: (b.personal_balance || 0) - (officerUsed['personal'] || 0),
        };
      });

      const totalVacation = enriched.reduce((s: number, b: any) => s + (b.vacation_balance || 0), 0);
      const usedVacation = enriched.reduce((s: number, b: any) => s + (b.vacation_used || 0), 0);

      return c.json({
        balances: enriched, year,
        utilization: {
          vacation_allotted: totalVacation, vacation_used: usedVacation,
          vacation_utilization_pct: totalVacation > 0 ? Math.round((usedVacation / totalVacation) * 100) : 0,
        },
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to load leave balance summary', code: 'LEAVE_BALANCE_SUMMARY_ERROR' }, 500);
    }
  });

  // ── U25: Overtime Tracking & Trends ────────────────────────
  api.get('/overtime-trends', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const months = q.months || '6';
      const monthCount = parseInt(String(months), 10) || 6;

      const monthly = await db.prepare(`
        SELECT strftime('%Y-%m', requested_date) as month,
          SUM(hours_requested) as total_hours, COUNT(*) as request_count,
          SUM(CASE WHEN status = 'approved' THEN hours_requested ELSE 0 END) as approved_hours,
          SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) as denied_count
        FROM overtime_requests
        WHERE requested_date >= date('now', '-' || ? || ' months')
        GROUP BY month ORDER BY month
      `).all(monthCount) as any[];

      const topOfficers = await db.prepare(`
        SELECT officer_id, officer_name, SUM(hours_requested) as total_hours, COUNT(*) as request_count
        FROM overtime_requests WHERE status = 'approved' AND requested_date >= date('now', '-' || ? || ' months')
        GROUP BY officer_id ORDER BY total_hours DESC LIMIT 20
      `).all(monthCount) as any[];

      const pending = await db.prepare(`SELECT COUNT(*) as cnt, SUM(hours_requested) as hours FROM overtime_requests WHERE status = 'requested'`).get() as any;

      return c.json({
        monthly_trend: monthly, top_officers: topOfficers,
        pending: { count: pending?.cnt || 0, total_hours: pending?.hours || 0 },
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to load overtime trends', code: 'OVERTIME_TRENDS_ERROR' }, 500);
    }
  });

  // ── U26: Performance Review Scheduling Reminders ───────────
  api.get('/review-reminders', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const today = localToday();
      const reminders: any[] = [];

      const officers = await db.prepare(`
        SELECT u.id, u.full_name, u.badge_number, u.hire_date,
          MAX(r.review_date) as last_review_date
        FROM users u LEFT JOIN hr_reviews r ON r.officer_id = u.id
        WHERE u.status = 'active' AND u.archived_at IS NULL
        GROUP BY u.id
        HAVING last_review_date IS NULL OR last_review_date < date(?, '-6 months')
        ORDER BY last_review_date ASC
        LIMIT 200
      `).all(today) as any[];

      for (const o of officers) {
        const daysSince = o.last_review_date
          ? Math.floor((new Date(today).getTime() - new Date(o.last_review_date).getTime()) / 86400000)
          : null;
        reminders.push({
          officer_id: o.id, full_name: o.full_name, badge_number: o.badge_number,
          last_review_date: o.last_review_date, days_since_review: daysSince,
          severity: daysSince === null ? 'no_review' : daysSince > 365 ? 'critical' : 'due',
        });
      }

      const upcoming = await db.prepare(`
        SELECT r.id, r.officer_id, r.review_date, r.review_type, u.full_name
        FROM hr_reviews r JOIN users u ON u.id = r.officer_id
        WHERE r.status = 'scheduled' AND r.review_date >= ? AND r.review_date <= date(?, '+30 days')
        ORDER BY r.review_date ASC LIMIT 50
      `).all(today, today) as any[];

      return c.json({ overdue_reviews: reminders, upcoming_reviews: upcoming, total_overdue: reminders.length });
    } catch (error: any) {
      return c.json({ error: 'Failed to load review reminders', code: 'REVIEW_REMINDERS_ERROR' }, 500);
    }
  });

  // ── U27: Disciplinary Point System ─────────────────────────
  api.get('/disciplinary-points', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const POINT_VALUES: Record<string, number> = {
        verbal_warning: 1, written_warning: 2, suspension: 5, final_warning: 8, termination: 10,
        counseling: 0, commendation: -1,
      };

      const actions = await db.prepare(`
        SELECT d.officer_id, d.action_type, d.severity, d.status, d.issued_date,
          u.full_name as officer_name, u.badge_number
        FROM hr_disciplinary d
        JOIN users u ON u.id = d.officer_id
        WHERE u.status = 'active' AND d.status = 'active'
        AND d.issued_date >= date('now', '-12 months')
        ORDER BY d.officer_id, d.issued_date DESC
        LIMIT 1000
      `).all() as any[];

      const byOfficer: Record<number, { officer_name: string; badge_number: string; points: number; actions: any[] }> = {};
      for (const a of actions) {
        if (!byOfficer[a.officer_id]) {
          byOfficer[a.officer_id] = { officer_name: a.officer_name, badge_number: a.badge_number, points: 0, actions: [] };
        }
        const pts = POINT_VALUES[a.severity] || POINT_VALUES[a.action_type] || 1;
        byOfficer[a.officer_id].points += pts;
        byOfficer[a.officer_id].actions.push({ ...a, points: pts });
      }

      const result = Object.entries(byOfficer).map(([id, data]) => ({
        officer_id: Number(id), ...data,
        risk_level: data.points >= 8 ? 'high' : data.points >= 4 ? 'medium' : 'low',
      })).sort((a, b) => b.points - a.points);

      return c.json({ officers: result, point_values: POINT_VALUES });
    } catch (error: any) {
      return c.json({ error: 'Failed to load disciplinary points', code: 'DISCIPLINARY_POINTS_ERROR' }, 500);
    }
  });

  // ── U28: HR Notifications — combined alerts feed ───────────
  api.get('/notifications', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const today = localToday();
      const notifications: any[] = [];

      try {
        const pending = await db.prepare(`SELECT lr.id, lr.officer_id, lr.leave_type, lr.start_date, u.full_name FROM hr_leave_requests lr JOIN users u ON u.id = lr.officer_id WHERE lr.status = 'pending' ORDER BY lr.created_at ASC LIMIT 20`).all() as any[];
        for (const p of pending) {
          notifications.push({ type: 'leave_pending', severity: 'info', message: `${p.full_name}: ${p.leave_type} leave request pending (${p.start_date})`, officer_id: p.officer_id, id: p.id });
        }
      } catch { /* ok */ }

      try {
        const overdue = await db.prepare(`SELECT u.id, u.full_name, MAX(r.review_date) as last_review FROM users u LEFT JOIN hr_reviews r ON r.officer_id = u.id WHERE u.status = 'active' GROUP BY u.id HAVING last_review IS NULL OR last_review < date(?, '-12 months') LIMIT 20`).all(today) as any[];
        for (const o of overdue) {
          notifications.push({ type: 'review_overdue', severity: 'warning', message: `${o.full_name}: Performance review overdue`, officer_id: o.id });
        }
      } catch { /* ok */ }

      try {
        const otPending = await db.prepare(`SELECT COUNT(*) as cnt FROM overtime_requests WHERE status = 'requested'`).get() as any;
        if (otPending?.cnt > 0) {
          notifications.push({ type: 'overtime_pending', severity: 'info', message: `${otPending.cnt} overtime request(s) pending approval` });
        }
      } catch { /* ok */ }

      notifications.sort((a: any, b: any) => ({ critical: 0, warning: 1, info: 2 }[a.severity as string] || 9) - ({ critical: 0, warning: 1, info: 2 }[b.severity as string] || 9));
      return c.json({ notifications, total: notifications.length });
    } catch (error: any) {
      return c.json({ error: 'Failed to load HR notifications', code: 'HR_NOTIFICATIONS_ERROR' }, 500);
    }
  });

  // ── U29: HR Analytics Dashboard ────────────────────────────
  api.get('/analytics', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const today = localToday();

      let leaveUtilization = { total_allotted: 0, total_used: 0, utilization_pct: 0 };
      try {
        const balances = await db.prepare(`SELECT SUM(vacation_balance) as vb, SUM(sick_balance) as sb, SUM(personal_balance) as pb FROM hr_leave_balances`).get() as any;
        const used = await db.prepare(`SELECT SUM(days_requested) as total FROM hr_leave_requests WHERE status = 'approved' AND strftime('%Y', start_date) = strftime('%Y', 'now')`).get() as any;
        const totalAllotted = (balances?.vb || 0) + (balances?.sb || 0) + (balances?.pb || 0);
        const totalUsed = used?.total || 0;
        leaveUtilization = { total_allotted: totalAllotted, total_used: totalUsed, utilization_pct: totalAllotted > 0 ? Math.round((totalUsed / totalAllotted) * 100) : 0 };
      } catch { /* ok */ }

      let overtimeTrends = { total_hours: 0, avg_monthly: 0 };
      try {
        const ot = await db.prepare(`SELECT SUM(hours_requested) as total FROM overtime_requests WHERE status = 'approved' AND strftime('%Y', requested_date) = strftime('%Y', 'now')`).get() as any;
        const month = new Date().getMonth() + 1;
        overtimeTrends = { total_hours: Math.round((ot?.total || 0) * 10) / 10, avg_monthly: month > 0 ? Math.round(((ot?.total || 0) / month) * 10) / 10 : 0 };
      } catch { /* ok */ }

      let disciplinaryStats = { total_active: 0, by_severity: {} as Record<string, number> };
      try {
        const active = await db.prepare(`SELECT severity, COUNT(*) as count FROM hr_disciplinary WHERE status = 'active' GROUP BY severity`).all() as any[];
        const totalActive = active.reduce((s: number, a: any) => s + a.count, 0);
        const bySeverity: Record<string, number> = {};
        for (const a of active) bySeverity[a.severity] = a.count;
        disciplinaryStats = { total_active: totalActive, by_severity: bySeverity };
      } catch { /* ok */ }

      let reviewStats = { total_scheduled: 0, completed: 0, completion_pct: 0 };
      try {
        const reviews = await db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed FROM hr_reviews WHERE strftime('%Y', review_date) = strftime('%Y', 'now')`).get() as any;
        reviewStats = { total_scheduled: reviews?.total || 0, completed: reviews?.completed || 0, completion_pct: reviews?.total > 0 ? Math.round((reviews.completed / reviews.total) * 100) : 0 };
      } catch { /* ok */ }

      return c.json({ leave_utilization: leaveUtilization, overtime_trends: overtimeTrends, disciplinary_stats: disciplinaryStats, review_stats: reviewStats });
    } catch (error: any) {
      return c.json({ error: 'Failed to load HR analytics', code: 'HR_ANALYTICS_ERROR' }, 500);
    }
  });

  // ── U30: Leave Utilization Rate ────────────────────────────
  api.get('/leave/utilization', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const year = q.year ? String(q.year) : new Date().getFullYear().toString();

      const byType = await db.prepare(`
        SELECT leave_type, COUNT(*) as request_count, SUM(days_requested) as total_days,
          SUM(CASE WHEN status = 'approved' THEN days_requested ELSE 0 END) as approved_days,
          SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) as denied_count
        FROM hr_leave_requests WHERE strftime('%Y', start_date) = ?
        GROUP BY leave_type ORDER BY total_days DESC
      `).all(year) as any[];

      const monthly = await db.prepare(`
        SELECT strftime('%Y-%m', start_date) as month, SUM(days_requested) as total_days, COUNT(*) as count
        FROM hr_leave_requests WHERE status = 'approved' AND strftime('%Y', start_date) = ?
        GROUP BY month ORDER BY month
      `).all(year) as any[];

      return c.json({ year, by_type: byType, monthly_trend: monthly });
    } catch (error: any) {
      return c.json({ error: 'Failed to load leave utilization', code: 'LEAVE_UTILIZATION_ERROR' }, 500);
    }
  });

  app.route('/api/hr', api);
}
