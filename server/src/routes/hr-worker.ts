import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramStr, paramNum, localNow, localToday } from '../worker-middleware/d1Helpers';

export function mountHrRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  const isManagerOrAbove = (role: string) => ['admin', 'manager', 'supervisor'].includes(role);

  // GET /api/hr/employees
  api.get('/employees', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const users = await db.prepare(`
        SELECT id, full_name, badge_number, role, status
        FROM users WHERE status = 'active' ORDER BY full_name LIMIT 1000
      `).all();
      return c.json(users);
    } catch (error: any) {
      return c.json({ error: 'Failed to list HR employees', code: 'HR_EMPLOYEES_LIST_ERROR' }, 500);
    }
  });

  // GET /api/hr/review-cycles
  api.get('/review-cycles', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const cycles = await db.prepare('SELECT * FROM review_cycles ORDER BY start_date DESC LIMIT 100').all();
      return c.json(cycles);
    } catch (e) {
      return c.json([]);
    }
  });

  // GET /api/hr/dashboard
  api.get('/dashboard', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const today = localToday();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const activeCount = await db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE status = 'active'`).get() as any;
      const newHires = await db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE status = 'active' AND hire_date >= ?`).get(thirtyDaysAgo) as any;
      const terminations = await db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE termination_date >= ?`).get(thirtyDaysAgo) as any;
      const onLeaveToday = await db.prepare(`SELECT COUNT(DISTINCT officer_id) as cnt FROM leave_requests WHERE status = 'approved' AND start_date <= ? AND end_date >= ?`).get(today, today) as any;

      const totalTraining = await db.prepare(`SELECT COUNT(*) as cnt FROM training_records`).get() as any;
      const completedTraining = await db.prepare(`SELECT COUNT(*) as cnt FROM training_records WHERE status = 'completed'`).get() as any;
      const training_pct = totalTraining?.cnt > 0 ? Math.round((completedTraining?.cnt / totalTraining?.cnt) * 100) : 100;

      const totalCredentials = await db.prepare(`SELECT COUNT(*) as cnt FROM credentials`).get() as any;
      const activeCredentials = await db.prepare(`SELECT COUNT(*) as cnt FROM credentials WHERE status = 'active'`).get() as any;
      const credential_pct = totalCredentials?.cnt > 0 ? Math.round((activeCredentials?.cnt / totalCredentials?.cnt) * 100) : 100;

      const overdue_count = await db.prepare(`SELECT COUNT(*) as cnt FROM training_records WHERE status = 'overdue'`).get() as any;
      const pending_leave = await db.prepare(`SELECT COUNT(*) as cnt FROM leave_requests WHERE status = 'pending'`).get() as any;
      const pending_reviews = await db.prepare(`SELECT COUNT(*) as cnt FROM performance_reviews WHERE status IN ('draft', 'submitted')`).get() as any;

      const recentLeave = await db.prepare(`SELECT lr.id, 'leave_request' as entity_type, lr.type as sub_type, lr.status, lr.created_at, u.full_name as officer_name FROM leave_requests lr JOIN users u ON u.id = lr.officer_id ORDER BY lr.created_at DESC LIMIT 10`).all();
      const recentDisciplinary = await db.prepare(`SELECT dr.id, 'disciplinary' as entity_type, dr.type as sub_type, dr.status, dr.created_at, u.full_name as officer_name FROM disciplinary_records dr JOIN users u ON u.id = dr.officer_id ORDER BY dr.created_at DESC LIMIT 10`).all();
      const recentReviews = await db.prepare(`SELECT pr.id, 'performance_review' as entity_type, pr.type as sub_type, pr.status, pr.created_at, u.full_name as officer_name FROM performance_reviews pr JOIN users u ON u.id = pr.officer_id ORDER BY pr.created_at DESC LIMIT 10`).all();

      const recent_activity = [...recentLeave, ...recentDisciplinary, ...recentReviews]
        .sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 10);

      return c.json({
        headcount: { active: activeCount?.cnt || 0, new_hires: newHires?.cnt || 0, terminations: terminations?.cnt || 0, on_leave_today: onLeaveToday?.cnt || 0 },
        compliance: { training_pct, credential_pct, overdue_count: overdue_count?.cnt || 0 },
        pending_leave: pending_leave?.cnt || 0,
        pending_reviews: pending_reviews?.cnt || 0,
        recent_activity,
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to load dashboard', code: 'FAILED_TO_LOAD_DASHBOARD' }, 500);
    }
  });

  // GET /api/hr/leave
  api.get('/leave', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const officer_id = c.req.query('officer_id');
      const status = c.req.query('status');
      const type = c.req.query('type');
      const start_date = c.req.query('start_date');
      const end_date = c.req.query('end_date');

      let sql = `SELECT lr.*, u.full_name as officer_name FROM leave_requests lr JOIN users u ON u.id = lr.officer_id WHERE 1=1`;
      const params: any[] = [];

      if (!isManagerOrAbove(user.role)) {
        sql += ' AND lr.officer_id = ?';
        params.push(user.userId);
      } else if (officer_id) {
        sql += ' AND lr.officer_id = ?';
        params.push(Number(officer_id));
      }

      if (status) sql += ' AND lr.status = ?', params.push(status);
      if (type) sql += ' AND lr.type = ?', params.push(type);
      if (start_date) sql += ' AND lr.start_date >= ?', params.push(start_date);
      if (end_date) sql += ' AND lr.end_date <= ?', params.push(end_date);

      sql += ' ORDER BY lr.created_at DESC';
      const rows = await db.prepare(sql).all(...params);
      return c.json(rows);
    } catch (error: any) {
      return c.json({ error: 'Failed to load leave requests', code: 'FAILED_TO_LOAD_LEAVE' }, 500);
    }
  });

  // POST /api/hr/leave
  api.post('/leave', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const body = await c.req.json();
      const { type, start_date, end_date, hours_requested, reason } = body;

      if (!type) return c.json({ error: 'type is required' }, 400);
      if (!start_date) return c.json({ error: 'start_date is required (YYYY-MM-DD)' }, 400);
      if (!end_date) return c.json({ error: 'end_date is required (YYYY-MM-DD)' }, 400);

      const now = localNow();
      const result = await db.prepare(
        `INSERT INTO leave_requests (officer_id, type, start_date, end_date, hours_requested, reason, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).run(user.userId, type, start_date, end_date, hours_requested || 0, reason || '', now, now);

      return c.json({ success: true, id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to create leave request', code: 'FAILED_TO_CREATE_LEAVE' }, 500);
    }
  });

  // PUT /api/hr/leave/:id
  api.put('/leave/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const existing = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) as any;

      if (!existing) return c.json({ error: 'Leave request not found', code: 'LEAVE_REQUEST_NOT_FOUND' }, 404);
      if (existing.officer_id !== user.userId && user.role !== 'admin') return c.json({ error: 'Can only update own requests' }, 403);

      const { type, start_date, end_date, hours_requested, reason } = body;
      const now = localNow();

      await db.prepare(
        `UPDATE leave_requests SET type = COALESCE(?, type), start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date), hours_requested = COALESCE(?, hours_requested), reason = COALESCE(?, reason), updated_at = ? WHERE id = ?`
      ).run(type || null, start_date || null, end_date || null, hours_requested ?? null, reason ?? null, now, id);

      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to update leave request', code: 'FAILED_TO_UPDATE_LEAVE' }, 500);
    }
  });

  // POST /api/hr/leave/:id/approve
  api.post('/leave/:id/approve', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      const { review_notes } = await c.req.json();
      const existing = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) as any;

      if (!existing) return c.json({ error: 'Leave request not found', code: 'LEAVE_REQUEST_NOT_FOUND' }, 404);

      const now = localNow();
      await db.prepare(
        `UPDATE leave_requests SET status = 'approved', reviewed_by = ?, reviewed_at = ?, review_notes = ?, updated_at = ? WHERE id = ?`
      ).run(user.userId, now, review_notes || null, now, id);

      const year = new Date(existing.start_date).getFullYear();
      const leaveType = existing.type;
      if (['vacation', 'sick', 'personal'].includes(leaveType)) {
        const usedCol = `${leaveType}_used`;
        await db.prepare(
          `INSERT OR IGNORE INTO leave_balances (officer_id, year, vacation_total, vacation_used, sick_total, sick_used, personal_total, personal_used, created_at, updated_at) VALUES (?, ?, 80, 0, 40, 0, 24, 0, ?, ?)`
        ).run(existing.officer_id, year, now, now);
        await db.prepare(
          `UPDATE leave_balances SET ${usedCol} = ${usedCol} + ?, updated_at = ? WHERE officer_id = ? AND year = ?`
        ).run(existing.hours_requested, now, existing.officer_id, year);
      }

      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to approve leave request', code: 'FAILED_TO_APPROVE_LEAVE' }, 500);
    }
  });

  // POST /api/hr/leave/:id/deny
  api.post('/leave/:id/deny', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      const { review_notes } = await c.req.json();
      const existing = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) as any;

      if (!existing) return c.json({ error: 'Leave request not found', code: 'LEAVE_REQUEST_NOT_FOUND' }, 404);

      const now = localNow();
      await db.prepare(
        `UPDATE leave_requests SET status = 'denied', reviewed_by = ?, reviewed_at = ?, review_notes = ?, updated_at = ? WHERE id = ?`
      ).run(user.userId, now, review_notes || null, now, id);

      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to deny leave request', code: 'FAILED_TO_DENY_LEAVE' }, 500);
    }
  });

  // DELETE /api/hr/leave/:id
  api.delete('/leave/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      const existing = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) as any;

      if (!existing) return c.json({ error: 'Leave request not found', code: 'LEAVE_REQUEST_NOT_FOUND' }, 404);
      if (existing.officer_id !== user.userId && user.role !== 'admin') return c.json({ error: 'Can only cancel own requests' }, 403);

      const now = localNow();
      await db.prepare(`UPDATE leave_requests SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(now, id);

      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to cancel leave request', code: 'FAILED_TO_CANCEL_LEAVE' }, 500);
    }
  });

  // GET /api/hr/leave/balances
  api.get('/leave/balances', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const officer_id = c.req.query('officer_id');
      const year = c.req.query('year');
      const targetYear = year ? Number(year) : new Date().getFullYear();
      const now = localNow();

      if (!isManagerOrAbove(user.role)) {
        await db.prepare(
          `INSERT OR IGNORE INTO leave_balances (officer_id, year, vacation_total, vacation_used, sick_total, sick_used, personal_total, personal_used, created_at, updated_at) VALUES (?, ?, 80, 0, 40, 0, 24, 0, ?, ?)`
        ).run(user.userId, targetYear, now, now);
        const row = await db.prepare(
          `SELECT lb.*, u.full_name as officer_name FROM leave_balances lb JOIN users u ON u.id = lb.officer_id WHERE lb.officer_id = ? AND lb.year = ?`
        ).get(user.userId, targetYear);
        return c.json(row ? [row] : []);
      }

      if (officer_id) {
        await db.prepare(
          `INSERT OR IGNORE INTO leave_balances (officer_id, year, vacation_total, vacation_used, sick_total, sick_used, personal_total, personal_used, created_at, updated_at) VALUES (?, ?, 80, 0, 40, 0, 24, 0, ?, ?)`
        ).run(Number(officer_id), targetYear, now, now);
        const row = await db.prepare(
          `SELECT lb.*, u.full_name as officer_name FROM leave_balances lb JOIN users u ON u.id = lb.officer_id WHERE lb.officer_id = ? AND lb.year = ?`
        ).get(Number(officer_id), targetYear);
        return c.json(row ? [row] : []);
      }

      const activeUsers = await db.prepare(`SELECT id FROM users WHERE status = 'active' LIMIT 1000`).all() as any[];
      const insertBal = db.prepare(
        `INSERT OR IGNORE INTO leave_balances (officer_id, year, vacation_total, vacation_used, sick_total, sick_used, personal_total, personal_used, created_at, updated_at) VALUES (?, ?, 80, 0, 40, 0, 24, 0, ?, ?)`
      );
      for (const u of activeUsers) {
        await insertBal.run(u.id, targetYear, now, now);
      }
      const rows = await db.prepare(
        `SELECT lb.*, u.full_name as officer_name FROM leave_balances lb JOIN users u ON u.id = lb.officer_id WHERE lb.year = ? ORDER BY u.full_name`
      ).all(targetYear);
      return c.json(rows);
    } catch (error: any) {
      return c.json({ error: 'Failed to load leave balances', code: 'FAILED_TO_LOAD_LEAVE' }, 500);
    }
  });

  // GET /api/hr/disciplinary
  api.get('/disciplinary', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const officer_id = c.req.query('officer_id');
      const type = c.req.query('type');
      const severity = c.req.query('severity');
      const status = c.req.query('status');

      if (!isManagerOrAbove(user.role)) {
        let sql = `SELECT dr.id, dr.officer_id, dr.type, dr.severity, dr.incident_date, dr.description, dr.action_taken, dr.follow_up_date, dr.follow_up_notes, dr.status, dr.attachments, dr.created_at, dr.updated_at, u.full_name as officer_name FROM disciplinary_records dr JOIN users u ON u.id = dr.officer_id WHERE dr.officer_id = ?`;
        const params: any[] = [user.userId];
        if (type) sql += ' AND dr.type = ?', params.push(type);
        if (severity) sql += ' AND dr.severity = ?', params.push(severity);
        if (status) sql += ' AND dr.status = ?', params.push(status);
        sql += ' ORDER BY dr.incident_date DESC';
        return c.json(await db.prepare(sql).all(...params));
      }

      let sql = `SELECT dr.*, u.full_name as officer_name, ib.full_name as issued_by_name FROM disciplinary_records dr JOIN users u ON u.id = dr.officer_id LEFT JOIN users ib ON ib.id = dr.issued_by WHERE 1=1`;
      const params: any[] = [];
      if (officer_id) sql += ' AND dr.officer_id = ?', params.push(Number(officer_id));
      if (type) sql += ' AND dr.type = ?', params.push(type);
      if (severity) sql += ' AND dr.severity = ?', params.push(severity);
      if (status) sql += ' AND dr.status = ?', params.push(status);
      sql += ' ORDER BY dr.incident_date DESC';
      return c.json(await db.prepare(sql).all(...params));
    } catch (error: any) {
      return c.json({ error: 'Failed to load disciplinary records', code: 'FAILED_TO_LOAD_DISCIPLINARY' }, 500);
    }
  });

  // GET /api/hr/reviews
  api.get('/reviews', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const officer_id = c.req.query('officer_id');
      const reviewer_id = c.req.query('reviewer_id');
      const type = c.req.query('type');
      const status = c.req.query('status');

      let sql = `SELECT pr.*, u.full_name as officer_name, rv.full_name as reviewer_name FROM performance_reviews pr JOIN users u ON u.id = pr.officer_id LEFT JOIN users rv ON rv.id = pr.reviewer_id WHERE 1=1`;
      const params: any[] = [];

      if (!isManagerOrAbove(user.role)) {
        sql += ' AND pr.officer_id = ?', params.push(user.userId);
      } else {
        if (officer_id) sql += ' AND pr.officer_id = ?', params.push(Number(officer_id));
        if (reviewer_id) sql += ' AND pr.reviewer_id = ?', params.push(Number(reviewer_id));
      }
      if (type) sql += ' AND pr.type = ?', params.push(type);
      if (status) sql += ' AND pr.status = ?', params.push(status);
      sql += ' ORDER BY pr.created_at DESC';
      return c.json(await db.prepare(sql).all(...params));
    } catch (error: any) {
      return c.json({ error: 'Failed to load reviews', code: 'FAILED_TO_LOAD_REVIEWS' }, 500);
    }
  });

  // GET /api/hr/payroll/periods
  api.get('/payroll/periods', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const status = c.req.query('status');
      const year = c.req.query('year');
      let where = 'WHERE 1=1';
      const params: any[] = [];
      if (status) where += ' AND pp.status = ?', params.push(status);
      if (year) where += ` AND pp.start_date >= ? AND pp.start_date < ?`, params.push(`${year}-01-01`, `${Number(year) + 1}-01-01`);

      const periods = await db.prepare(`
        SELECT pp.*, u.full_name as created_by_name,
          (SELECT COUNT(*) FROM hr_payroll_entries pe WHERE pe.pay_period_id = pp.id) as entry_count,
          (SELECT COALESCE(SUM(pe.gross_pay), 0) FROM hr_payroll_entries pe WHERE pe.pay_period_id = pp.id) as total_gross,
          (SELECT COALESCE(SUM(pe.net_pay), 0) FROM hr_payroll_entries pe WHERE pe.pay_period_id = pp.id) as total_net
        FROM hr_pay_periods pp LEFT JOIN users u ON u.id = pp.created_by ${where} ORDER BY pp.start_date DESC
      `).all(...params);
      return c.json(periods);
    } catch (error: any) {
      return c.json({ error: 'Failed to fetch pay periods', code: 'FAILED_TO_FETCH_PAY' }, 500);
    }
  });

  app.route('/api/hr', api);
}
