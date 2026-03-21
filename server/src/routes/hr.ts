// ============================================================
// RMPG Flex — HR Module API Routes
// ============================================================
// Comprehensive Human Resources management: leave management,
// performance reviews, disciplinary actions, grievances,
// onboarding, employee documents, payroll, and pay management.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcast } from '../utils/websocket';
import { localNow } from '../utils/timeUtils';
import { validateParamId, escapeLike } from '../middleware/sanitize';

const router = Router();
router.use(authenticateToken);

// ─── Role Constants ──────────────────────────────────────
const HR_FULL_ROLES = ['admin', 'manager', 'human_resources'] as const;
const HR_READ_ROLES = ['admin', 'manager', 'human_resources', 'supervisor'] as const;

// ─── Helpers ─────────────────────────────────────────────

function isSelfServiceOnly(req: Request): boolean {
  const role = req.user?.role || '';
  return !['admin', 'manager', 'human_resources', 'supervisor'].includes(role);
}

function generateGrievanceNumber(db: ReturnType<typeof getDb>): string {
  const year = new Date().getFullYear();
  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM hr_grievances WHERE grievance_number LIKE ?`
  ).get(`GRV-${year}-%`) as { cnt: number } | undefined;
  const seq = (row?.cnt ?? 0) + 1;
  return `GRV-${year}-${String(seq).padStart(4, '0')}`;
}


// ═══════════════════════════════════════════════════════════
// 1. DASHBOARD
// ═══════════════════════════════════════════════════════════

router.get('/dashboard', requireRole(...HR_READ_ROLES), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const currentYear = new Date().getFullYear();

    const activeEmployees = db.prepare(
      `SELECT COUNT(*) as cnt FROM users WHERE is_active = 1`
    ).get() as { cnt: number };

    const pendingLeaveRequests = db.prepare(
      `SELECT COUNT(*) as cnt FROM hr_leave_requests WHERE status = 'requested'`
    ).get() as { cnt: number };

    const upcomingReviews = db.prepare(
      `SELECT COUNT(*) as cnt FROM hr_performance_reviews WHERE status IN ('scheduled', 'in_progress') AND due_date >= ?`
    ).get(now.slice(0, 10)) as { cnt: number };

    const overdueOnboarding = db.prepare(
      `SELECT COUNT(*) as cnt FROM hr_onboarding_progress WHERE status = 'pending' AND due_date < ?`
    ).get(now.slice(0, 10)) as { cnt: number };

    const expiringDocuments = db.prepare(
      `SELECT COUNT(*) as cnt FROM hr_employee_documents WHERE expires_at IS NOT NULL AND expires_at <= ? AND expires_at >= ? AND status = 'active'`
    ).get(thirtyDaysFromNow, now.slice(0, 10)) as { cnt: number };

    const currentPayPeriod = db.prepare(
      `SELECT * FROM hr_pay_periods WHERE start_date <= ? AND end_date >= ? ORDER BY start_date DESC LIMIT 1`
    ).get(now.slice(0, 10), now.slice(0, 10)) as any;

    const recentDisciplinary = db.prepare(
      `SELECT COUNT(*) as cnt FROM hr_disciplinary_actions WHERE created_at >= date(?, '-30 days')`
    ).get(now.slice(0, 10)) as { cnt: number };

    res.json({
      active_employees: activeEmployees.cnt,
      pending_leave_requests: pendingLeaveRequests.cnt,
      upcoming_reviews: upcomingReviews.cnt,
      overdue_onboarding: overdueOnboarding.cnt,
      expiring_documents: expiringDocuments.cnt,
      current_pay_period: currentPayPeriod || null,
      recent_disciplinary: recentDisciplinary.cnt,
    });
  } catch (err: any) {
    console.error('[HR] Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load HR dashboard' });
  }
});


// ═══════════════════════════════════════════════════════════
// 2. LEAVE TYPES CRUD
// ═══════════════════════════════════════════════════════════

router.get('/leave-types', requireRole(...HR_READ_ROLES), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM hr_leave_types WHERE is_active = 1 ORDER BY name ASC`
    ).all();
    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Leave types list error:', err);
    res.status(500).json({ error: 'Failed to load leave types' });
  }
});

router.post('/leave-types', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, description, default_hours_per_year, accrual_rate, max_carryover, requires_approval } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO hr_leave_types (name, description, default_hours_per_year, accrual_rate, max_carryover, requires_approval, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(name, description || null, default_hours_per_year || 0, accrual_rate || 0, max_carryover || 0, requires_approval ?? 1, localNow());

    const id = result.lastInsertRowid;
    auditLog(req, 'CREATE', 'system_config', id, `Created leave type: ${name}`);
    broadcast('hr', 'hr:updated', { type: 'leave_type', action: 'created', id });
    res.status(201).json({ success: true, id });
  } catch (err: any) {
    console.error('[HR] Leave type create error:', err);
    res.status(500).json({ error: 'Failed to create leave type' });
  }
});

router.put('/leave-types/:id', requireRole(...HR_FULL_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_leave_types WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Leave type not found' });
      return;
    }

    const { name, description, default_hours_per_year, accrual_rate, max_carryover, requires_approval } = req.body;

    db.prepare(`
      UPDATE hr_leave_types SET name = COALESCE(?, name), description = COALESCE(?, description),
        default_hours_per_year = COALESCE(?, default_hours_per_year), accrual_rate = COALESCE(?, accrual_rate),
        max_carryover = COALESCE(?, max_carryover), requires_approval = COALESCE(?, requires_approval),
        updated_at = ?
      WHERE id = ?
    `).run(name, description, default_hours_per_year, accrual_rate, max_carryover, requires_approval, localNow(), id);

    auditLog(req, 'UPDATE', 'system_config', id, `Updated leave type #${id}`);
    broadcast('hr', 'hr:updated', { type: 'leave_type', action: 'updated', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Leave type update error:', err);
    res.status(500).json({ error: 'Failed to update leave type' });
  }
});

router.delete('/leave-types/:id', requireRole(...HR_FULL_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_leave_types WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Leave type not found' });
      return;
    }

    db.prepare(`UPDATE hr_leave_types SET is_active = 0, updated_at = ? WHERE id = ?`).run(localNow(), id);
    auditLog(req, 'DELETE', 'system_config', id, `Deactivated leave type #${id}`);
    broadcast('hr', 'hr:updated', { type: 'leave_type', action: 'deleted', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Leave type delete error:', err);
    res.status(500).json({ error: 'Failed to delete leave type' });
  }
});


// ═══════════════════════════════════════════════════════════
// 3. LEAVE BALANCES
// ═══════════════════════════════════════════════════════════

router.get('/leave-balances', requireRole(...HR_READ_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, year } = req.query;
    let sql = `
      SELECT lb.*, u.full_name as user_name, lt.name as leave_type_name
      FROM hr_leave_balances lb
      JOIN users u ON u.id = lb.user_id
      JOIN hr_leave_types lt ON lt.id = lb.leave_type_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (user_id) {
      sql += ` AND lb.user_id = ?`;
      params.push(Number(user_id));
    }
    if (year) {
      sql += ` AND lb.year = ?`;
      params.push(Number(year));
    }

    sql += ` ORDER BY u.full_name ASC, lt.name ASC`;
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Leave balances list error:', err);
    res.status(500).json({ error: 'Failed to load leave balances' });
  }
});

router.get('/leave-balances/mine', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const currentYear = new Date().getFullYear();

    const rows = db.prepare(`
      SELECT lb.*, lt.name as leave_type_name
      FROM hr_leave_balances lb
      JOIN hr_leave_types lt ON lt.id = lb.leave_type_id
      WHERE lb.user_id = ? AND lb.year = ?
      ORDER BY lt.name ASC
    `).all(userId, currentYear);

    res.json(rows);
  } catch (err: any) {
    console.error('[HR] My leave balances error:', err);
    res.status(500).json({ error: 'Failed to load leave balances' });
  }
});

router.post('/leave-balances', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, leave_type_id, year, allocated_hours, used_hours, adjustment_hours, notes } = req.body;

    if (!user_id || !leave_type_id || !year) {
      res.status(400).json({ error: 'user_id, leave_type_id, and year are required' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO hr_leave_balances (user_id, leave_type_id, year, allocated_hours, used_hours, adjustment_hours, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user_id, leave_type_id, year, allocated_hours || 0, used_hours || 0, adjustment_hours || 0, notes || null, localNow(), localNow());

    const id = result.lastInsertRowid;
    auditLog(req, 'CREATE', 'users', id, `Created leave balance for user #${user_id}, type #${leave_type_id}, year ${year}`);
    broadcast('hr', 'hr:updated', { type: 'leave_balance', action: 'created', id });
    res.status(201).json({ success: true, id });
  } catch (err: any) {
    console.error('[HR] Leave balance create error:', err);
    res.status(500).json({ error: 'Failed to create leave balance' });
  }
});

router.put('/leave-balances/:id', requireRole(...HR_FULL_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_leave_balances WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Leave balance not found' });
      return;
    }

    const { allocated_hours, used_hours, adjustment_hours, notes } = req.body;

    db.prepare(`
      UPDATE hr_leave_balances SET allocated_hours = COALESCE(?, allocated_hours),
        used_hours = COALESCE(?, used_hours), adjustment_hours = COALESCE(?, adjustment_hours),
        notes = COALESCE(?, notes), updated_at = ?
      WHERE id = ?
    `).run(allocated_hours, used_hours, adjustment_hours, notes, localNow(), id);

    auditLog(req, 'UPDATE', 'users', id, `Updated leave balance #${id}`);
    broadcast('hr', 'hr:updated', { type: 'leave_balance', action: 'updated', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Leave balance update error:', err);
    res.status(500).json({ error: 'Failed to update leave balance' });
  }
});


// ═══════════════════════════════════════════════════════════
// 4. LEAVE REQUESTS
// ═══════════════════════════════════════════════════════════

router.get('/leave-requests', requireRole(...HR_READ_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, user_id } = req.query;
    let sql = `
      SELECT lr.*, u.full_name as user_name, lt.name as leave_type_name,
             rv.full_name as reviewed_by_name
      FROM hr_leave_requests lr
      JOIN users u ON u.id = lr.user_id
      JOIN hr_leave_types lt ON lt.id = lr.leave_type_id
      LEFT JOIN users rv ON rv.id = lr.reviewed_by
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      sql += ` AND lr.status = ?`;
      params.push(String(status));
    }
    if (user_id) {
      sql += ` AND lr.user_id = ?`;
      params.push(Number(user_id));
    }

    sql += ` ORDER BY lr.created_at DESC`;
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Leave requests list error:', err);
    res.status(500).json({ error: 'Failed to load leave requests' });
  }
});

router.get('/leave-requests/mine', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;

    const rows = db.prepare(`
      SELECT lr.*, lt.name as leave_type_name, rv.full_name as reviewed_by_name
      FROM hr_leave_requests lr
      JOIN hr_leave_types lt ON lt.id = lr.leave_type_id
      LEFT JOIN users rv ON rv.id = lr.reviewed_by
      WHERE lr.user_id = ?
      ORDER BY lr.created_at DESC
    `).all(userId);

    res.json(rows);
  } catch (err: any) {
    console.error('[HR] My leave requests error:', err);
    res.status(500).json({ error: 'Failed to load leave requests' });
  }
});

router.post('/leave-requests', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const { leave_type_id, start_date, end_date, hours_requested, reason } = req.body;

    if (!leave_type_id || !start_date || !end_date || !hours_requested) {
      res.status(400).json({ error: 'leave_type_id, start_date, end_date, and hours_requested are required' });
      return;
    }

    if (hours_requested <= 0) {
      res.status(400).json({ error: 'hours_requested must be positive' });
      return;
    }

    if (start_date > end_date) {
      res.status(400).json({ error: 'start_date must be before or equal to end_date' });
      return;
    }

    // Check leave balance
    const currentYear = new Date().getFullYear();
    const balance = db.prepare(`
      SELECT * FROM hr_leave_balances WHERE user_id = ? AND leave_type_id = ? AND year = ?
    `).get(userId, leave_type_id, currentYear) as any;

    if (balance) {
      const available = (balance.allocated_hours || 0) + (balance.adjustment_hours || 0) - (balance.used_hours || 0);
      if (hours_requested > available) {
        res.status(400).json({ error: `Insufficient leave balance. Available: ${available} hours, Requested: ${hours_requested} hours` });
        return;
      }
    }

    const result = db.prepare(`
      INSERT INTO hr_leave_requests (user_id, leave_type_id, start_date, end_date, hours_requested, reason, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, ?)
    `).run(userId, leave_type_id, start_date, end_date, hours_requested, reason || null, localNow(), localNow());

    const id = result.lastInsertRowid;
    auditLog(req, 'CREATE', 'users', id, `Created leave request: ${hours_requested}hrs from ${start_date} to ${end_date}`);
    broadcast('hr', 'hr:updated', { type: 'leave_request', action: 'created', id, user_id: userId });
    res.status(201).json({ success: true, id });
  } catch (err: any) {
    console.error('[HR] Leave request create error:', err);
    res.status(500).json({ error: 'Failed to create leave request' });
  }
});

router.put('/leave-requests/:id', requireRole(...HR_FULL_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_leave_requests WHERE id = ?`).get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Leave request not found' });
      return;
    }

    const { status, review_notes } = req.body;

    if (status && !['approved', 'denied'].includes(status)) {
      res.status(400).json({ error: 'Status must be approved or denied' });
      return;
    }

    const now = localNow();
    db.prepare(`
      UPDATE hr_leave_requests SET status = COALESCE(?, status), review_notes = COALESCE(?, review_notes),
        reviewed_by = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(status, review_notes, req.user!.userId, now, now, id);

    // When approved, update leave balance (add to used_hours)
    if (status === 'approved') {
      const currentYear = new Date().getFullYear();
      const balance = db.prepare(`
        SELECT * FROM hr_leave_balances WHERE user_id = ? AND leave_type_id = ? AND year = ?
      `).get(existing.user_id, existing.leave_type_id, currentYear) as any;

      if (balance) {
        db.prepare(`
          UPDATE hr_leave_balances SET used_hours = used_hours + ?, updated_at = ? WHERE id = ?
        `).run(existing.hours_requested, now, balance.id);
      } else {
        // Auto-create a balance record if none exists
        db.prepare(`
          INSERT INTO hr_leave_balances (user_id, leave_type_id, year, allocated_hours, used_hours, adjustment_hours, created_at, updated_at)
          VALUES (?, ?, ?, 0, ?, 0, ?, ?)
        `).run(existing.user_id, existing.leave_type_id, currentYear, existing.hours_requested, now, now);
      }
    }

    auditLog(req, 'UPDATE', 'users', id, `Leave request #${id} ${status || 'updated'}`);
    broadcast('hr', 'hr:updated', { type: 'leave_request', action: 'reviewed', id, status });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Leave request update error:', err);
    res.status(500).json({ error: 'Failed to update leave request' });
  }
});

router.put('/leave-requests/:id/cancel', validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const userId = req.user!.userId;

    const existing = db.prepare(`SELECT * FROM hr_leave_requests WHERE id = ?`).get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Leave request not found' });
      return;
    }

    if (existing.user_id !== userId) {
      res.status(403).json({ error: 'You can only cancel your own leave requests' });
      return;
    }

    if (existing.status !== 'requested') {
      res.status(400).json({ error: 'Only pending requests can be cancelled' });
      return;
    }

    db.prepare(`
      UPDATE hr_leave_requests SET status = 'cancelled', updated_at = ? WHERE id = ?
    `).run(localNow(), id);

    auditLog(req, 'UPDATE', 'users', id, `Cancelled leave request #${id}`);
    broadcast('hr', 'hr:updated', { type: 'leave_request', action: 'cancelled', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Leave request cancel error:', err);
    res.status(500).json({ error: 'Failed to cancel leave request' });
  }
});


// ═══════════════════════════════════════════════════════════
// 5. REVIEW CYCLES CRUD
// ═══════════════════════════════════════════════════════════

router.get('/review-cycles', requireRole(...HR_READ_ROLES), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM hr_review_cycles ORDER BY start_date DESC`).all();
    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Review cycles list error:', err);
    res.status(500).json({ error: 'Failed to load review cycles' });
  }
});

router.post('/review-cycles', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, description, start_date, end_date, review_type, status } = req.body;

    if (!name || !start_date || !end_date) {
      res.status(400).json({ error: 'name, start_date, and end_date are required' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO hr_review_cycles (name, description, start_date, end_date, review_type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, description || null, start_date, end_date, review_type || 'annual', status || 'planned', localNow(), localNow());

    const id = result.lastInsertRowid;
    auditLog(req, 'CREATE', 'system_config', id, `Created review cycle: ${name}`);
    broadcast('hr', 'hr:updated', { type: 'review_cycle', action: 'created', id });
    res.status(201).json({ success: true, id });
  } catch (err: any) {
    console.error('[HR] Review cycle create error:', err);
    res.status(500).json({ error: 'Failed to create review cycle' });
  }
});

router.put('/review-cycles/:id', requireRole(...HR_FULL_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_review_cycles WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Review cycle not found' });
      return;
    }

    const { name, description, start_date, end_date, review_type, status } = req.body;

    db.prepare(`
      UPDATE hr_review_cycles SET name = COALESCE(?, name), description = COALESCE(?, description),
        start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date),
        review_type = COALESCE(?, review_type), status = COALESCE(?, status), updated_at = ?
      WHERE id = ?
    `).run(name, description, start_date, end_date, review_type, status, localNow(), id);

    auditLog(req, 'UPDATE', 'system_config', id, `Updated review cycle #${id}`);
    broadcast('hr', 'hr:updated', { type: 'review_cycle', action: 'updated', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Review cycle update error:', err);
    res.status(500).json({ error: 'Failed to update review cycle' });
  }
});


// ═══════════════════════════════════════════════════════════
// 6. PERFORMANCE REVIEWS
// ═══════════════════════════════════════════════════════════

router.get('/reviews', requireRole(...HR_READ_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, cycle_id, status } = req.query;
    let sql = `
      SELECT pr.*, u.full_name as user_name, rv.full_name as reviewer_name,
             rc.name as cycle_name
      FROM hr_performance_reviews pr
      JOIN users u ON u.id = pr.user_id
      LEFT JOIN users rv ON rv.id = pr.reviewer_id
      LEFT JOIN hr_review_cycles rc ON rc.id = pr.cycle_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (user_id) { sql += ` AND pr.user_id = ?`; params.push(Number(user_id)); }
    if (cycle_id) { sql += ` AND pr.cycle_id = ?`; params.push(Number(cycle_id)); }
    if (status) { sql += ` AND pr.status = ?`; params.push(String(status)); }

    sql += ` ORDER BY pr.due_date DESC`;
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Reviews list error:', err);
    res.status(500).json({ error: 'Failed to load performance reviews' });
  }
});

router.get('/reviews/mine', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;

    const rows = db.prepare(`
      SELECT pr.*, rv.full_name as reviewer_name, rc.name as cycle_name
      FROM hr_performance_reviews pr
      LEFT JOIN users rv ON rv.id = pr.reviewer_id
      LEFT JOIN hr_review_cycles rc ON rc.id = pr.cycle_id
      WHERE pr.user_id = ?
      ORDER BY pr.due_date DESC
    `).all(userId);

    res.json(rows);
  } catch (err: any) {
    console.error('[HR] My reviews error:', err);
    res.status(500).json({ error: 'Failed to load reviews' });
  }
});

router.post('/reviews', requireRole(...HR_READ_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, reviewer_id, cycle_id, due_date, review_type, overall_rating, strengths, areas_for_improvement, comments, status } = req.body;

    if (!user_id || !due_date) {
      res.status(400).json({ error: 'user_id and due_date are required' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO hr_performance_reviews (user_id, reviewer_id, cycle_id, due_date, review_type, overall_rating,
        strengths, areas_for_improvement, comments, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user_id, reviewer_id || req.user!.userId, cycle_id || null, due_date,
      review_type || 'annual', overall_rating || null, strengths || null,
      areas_for_improvement || null, comments || null, status || 'scheduled',
      localNow(), localNow()
    );

    const id = result.lastInsertRowid;
    auditLog(req, 'CREATE', 'users', id, `Created performance review for user #${user_id}`);
    broadcast('hr', 'hr:updated', { type: 'review', action: 'created', id, user_id });
    res.status(201).json({ success: true, id });
  } catch (err: any) {
    console.error('[HR] Review create error:', err);
    res.status(500).json({ error: 'Failed to create performance review' });
  }
});

router.put('/reviews/:id', requireRole(...HR_READ_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_performance_reviews WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Performance review not found' });
      return;
    }

    const { reviewer_id, cycle_id, due_date, review_type, overall_rating, strengths, areas_for_improvement, comments, status } = req.body;

    db.prepare(`
      UPDATE hr_performance_reviews SET reviewer_id = COALESCE(?, reviewer_id), cycle_id = COALESCE(?, cycle_id),
        due_date = COALESCE(?, due_date), review_type = COALESCE(?, review_type),
        overall_rating = COALESCE(?, overall_rating), strengths = COALESCE(?, strengths),
        areas_for_improvement = COALESCE(?, areas_for_improvement), comments = COALESCE(?, comments),
        status = COALESCE(?, status), updated_at = ?
      WHERE id = ?
    `).run(reviewer_id, cycle_id, due_date, review_type, overall_rating, strengths, areas_for_improvement, comments, status, localNow(), id);

    auditLog(req, 'UPDATE', 'users', id, `Updated performance review #${id}`);
    broadcast('hr', 'hr:updated', { type: 'review', action: 'updated', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Review update error:', err);
    res.status(500).json({ error: 'Failed to update performance review' });
  }
});

router.put('/reviews/:id/acknowledge', validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const userId = req.user!.userId;

    const existing = db.prepare(`SELECT * FROM hr_performance_reviews WHERE id = ?`).get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Performance review not found' });
      return;
    }

    if (existing.user_id !== userId) {
      res.status(403).json({ error: 'Only the reviewed employee can acknowledge this review' });
      return;
    }

    db.prepare(`
      UPDATE hr_performance_reviews SET status = 'acknowledged', acknowledged_at = ?, updated_at = ?
      WHERE id = ?
    `).run(localNow(), localNow(), id);

    auditLog(req, 'UPDATE', 'users', id, `Acknowledged performance review #${id}`);
    broadcast('hr', 'hr:updated', { type: 'review', action: 'acknowledged', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Review acknowledge error:', err);
    res.status(500).json({ error: 'Failed to acknowledge review' });
  }
});


// ═══════════════════════════════════════════════════════════
// 7. PERFORMANCE GOALS
// ═══════════════════════════════════════════════════════════

router.get('/goals', requireRole(...HR_READ_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id } = req.query;
    let sql = `
      SELECT g.*, u.full_name as user_name
      FROM hr_performance_goals g
      JOIN users u ON u.id = g.user_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (user_id) { sql += ` AND g.user_id = ?`; params.push(Number(user_id)); }

    sql += ` ORDER BY g.target_date ASC`;
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Goals list error:', err);
    res.status(500).json({ error: 'Failed to load goals' });
  }
});

router.get('/goals/mine', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;

    const rows = db.prepare(`
      SELECT * FROM hr_performance_goals WHERE user_id = ? ORDER BY target_date ASC
    `).all(userId);

    res.json(rows);
  } catch (err: any) {
    console.error('[HR] My goals error:', err);
    res.status(500).json({ error: 'Failed to load goals' });
  }
});

router.post('/goals', requireRole(...HR_READ_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, review_id, title, description, target_date, category, priority, status, progress } = req.body;

    if (!user_id || !title) {
      res.status(400).json({ error: 'user_id and title are required' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO hr_performance_goals (user_id, review_id, title, description, target_date, category, priority, status, progress, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user_id, review_id || null, title, description || null, target_date || null,
      category || 'general', priority || 'medium', status || 'not_started', progress || 0,
      localNow(), localNow()
    );

    const id = result.lastInsertRowid;
    auditLog(req, 'CREATE', 'users', id, `Created goal "${title}" for user #${user_id}`);
    broadcast('hr', 'hr:updated', { type: 'goal', action: 'created', id, user_id });
    res.status(201).json({ success: true, id });
  } catch (err: any) {
    console.error('[HR] Goal create error:', err);
    res.status(500).json({ error: 'Failed to create goal' });
  }
});

router.put('/goals/:id', requireRole(...HR_READ_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_performance_goals WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Goal not found' });
      return;
    }

    const { title, description, target_date, category, priority, status, progress, completion_notes } = req.body;

    db.prepare(`
      UPDATE hr_performance_goals SET title = COALESCE(?, title), description = COALESCE(?, description),
        target_date = COALESCE(?, target_date), category = COALESCE(?, category),
        priority = COALESCE(?, priority), status = COALESCE(?, status),
        progress = COALESCE(?, progress), completion_notes = COALESCE(?, completion_notes), updated_at = ?
      WHERE id = ?
    `).run(title, description, target_date, category, priority, status, progress, completion_notes, localNow(), id);

    auditLog(req, 'UPDATE', 'users', id, `Updated goal #${id}`);
    broadcast('hr', 'hr:updated', { type: 'goal', action: 'updated', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Goal update error:', err);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});


// ═══════════════════════════════════════════════════════════
// 8. DISCIPLINARY ACTIONS
// ═══════════════════════════════════════════════════════════

router.get('/disciplinary', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, action_type } = req.query;
    let sql = `
      SELECT da.*, u.full_name as user_name, ib.full_name as issued_by_name
      FROM hr_disciplinary_actions da
      JOIN users u ON u.id = da.user_id
      LEFT JOIN users ib ON ib.id = da.issued_by
      WHERE 1=1
    `;
    const params: any[] = [];

    if (user_id) { sql += ` AND da.user_id = ?`; params.push(Number(user_id)); }
    if (action_type) { sql += ` AND da.action_type = ?`; params.push(String(action_type)); }

    sql += ` ORDER BY da.incident_date DESC`;
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Disciplinary list error:', err);
    res.status(500).json({ error: 'Failed to load disciplinary actions' });
  }
});

router.get('/disciplinary/:userId', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { userId } = req.params;
    const uid = parseInt(userId, 10);
    if (isNaN(uid) || uid < 1) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const rows = db.prepare(`
      SELECT da.*, ib.full_name as issued_by_name
      FROM hr_disciplinary_actions da
      LEFT JOIN users ib ON ib.id = da.issued_by
      WHERE da.user_id = ?
      ORDER BY da.incident_date DESC
    `).all(uid);

    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Disciplinary per-user error:', err);
    res.status(500).json({ error: 'Failed to load disciplinary history' });
  }
});

router.post('/disciplinary', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, action_type, incident_date, description, severity, witnesses, corrective_action, follow_up_date, status } = req.body;

    if (!user_id || !action_type || !incident_date || !description) {
      res.status(400).json({ error: 'user_id, action_type, incident_date, and description are required' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO hr_disciplinary_actions (user_id, action_type, incident_date, description, severity, witnesses,
        corrective_action, follow_up_date, issued_by, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user_id, action_type, incident_date, description, severity || 'minor',
      witnesses || null, corrective_action || null, follow_up_date || null,
      req.user!.userId, status || 'active', localNow(), localNow()
    );

    const id = result.lastInsertRowid;
    auditLog(req, 'CREATE', 'users', id, `Created disciplinary action (${action_type}) for user #${user_id}`);
    broadcast('hr', 'hr:updated', { type: 'disciplinary', action: 'created', id, user_id });
    res.status(201).json({ success: true, id });
  } catch (err: any) {
    console.error('[HR] Disciplinary create error:', err);
    res.status(500).json({ error: 'Failed to create disciplinary action' });
  }
});

router.put('/disciplinary/:id', requireRole(...HR_FULL_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_disciplinary_actions WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Disciplinary action not found' });
      return;
    }

    const { action_type, incident_date, description, severity, witnesses, corrective_action, follow_up_date, status } = req.body;

    db.prepare(`
      UPDATE hr_disciplinary_actions SET action_type = COALESCE(?, action_type), incident_date = COALESCE(?, incident_date),
        description = COALESCE(?, description), severity = COALESCE(?, severity),
        witnesses = COALESCE(?, witnesses), corrective_action = COALESCE(?, corrective_action),
        follow_up_date = COALESCE(?, follow_up_date), status = COALESCE(?, status), updated_at = ?
      WHERE id = ?
    `).run(action_type, incident_date, description, severity, witnesses, corrective_action, follow_up_date, status, localNow(), id);

    auditLog(req, 'UPDATE', 'users', id, `Updated disciplinary action #${id}`);
    broadcast('hr', 'hr:updated', { type: 'disciplinary', action: 'updated', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Disciplinary update error:', err);
    res.status(500).json({ error: 'Failed to update disciplinary action' });
  }
});


// ═══════════════════════════════════════════════════════════
// 9. GRIEVANCES
// ═══════════════════════════════════════════════════════════

router.get('/grievances', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status } = req.query;
    let sql = `
      SELECT g.*, u.full_name as filed_by_name, a.full_name as assigned_to_name
      FROM hr_grievances g
      JOIN users u ON u.id = g.filed_by
      LEFT JOIN users a ON a.id = g.assigned_to
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) { sql += ` AND g.status = ?`; params.push(String(status)); }

    sql += ` ORDER BY g.created_at DESC`;
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Grievances list error:', err);
    res.status(500).json({ error: 'Failed to load grievances' });
  }
});

router.get('/grievances/mine', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;

    const rows = db.prepare(`
      SELECT g.*, a.full_name as assigned_to_name
      FROM hr_grievances g
      LEFT JOIN users a ON a.id = g.assigned_to
      WHERE g.filed_by = ?
      ORDER BY g.created_at DESC
    `).all(userId);

    res.json(rows);
  } catch (err: any) {
    console.error('[HR] My grievances error:', err);
    res.status(500).json({ error: 'Failed to load grievances' });
  }
});

router.post('/grievances', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const { subject, description, category, against_user_id } = req.body;

    if (!subject || !description) {
      res.status(400).json({ error: 'subject and description are required' });
      return;
    }

    const grievanceNumber = generateGrievanceNumber(db);

    const result = db.prepare(`
      INSERT INTO hr_grievances (grievance_number, filed_by, subject, description, category, against_user_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'filed', ?, ?)
    `).run(grievanceNumber, userId, subject, description, category || 'general', against_user_id || null, localNow(), localNow());

    const id = result.lastInsertRowid;
    auditLog(req, 'CREATE', 'users', id, `Filed grievance ${grievanceNumber}: ${subject}`);
    broadcast('hr', 'hr:updated', { type: 'grievance', action: 'created', id, grievance_number: grievanceNumber });
    res.status(201).json({ success: true, id, grievance_number: grievanceNumber });
  } catch (err: any) {
    console.error('[HR] Grievance create error:', err);
    res.status(500).json({ error: 'Failed to file grievance' });
  }
});

router.put('/grievances/:id', requireRole(...HR_FULL_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_grievances WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Grievance not found' });
      return;
    }

    const { status, assigned_to, resolution, resolution_notes, priority } = req.body;

    db.prepare(`
      UPDATE hr_grievances SET status = COALESCE(?, status), assigned_to = COALESCE(?, assigned_to),
        resolution = COALESCE(?, resolution), resolution_notes = COALESCE(?, resolution_notes),
        priority = COALESCE(?, priority), resolved_at = CASE WHEN ? IN ('resolved', 'closed') THEN ? ELSE resolved_at END,
        updated_at = ?
      WHERE id = ?
    `).run(status, assigned_to, resolution, resolution_notes, priority, status, localNow(), localNow(), id);

    auditLog(req, 'UPDATE', 'users', id, `Updated grievance #${id}: status=${status || 'unchanged'}`);
    broadcast('hr', 'hr:updated', { type: 'grievance', action: 'updated', id, status });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Grievance update error:', err);
    res.status(500).json({ error: 'Failed to update grievance' });
  }
});


// ═══════════════════════════════════════════════════════════
// 10. ONBOARDING CHECKLISTS
// ═══════════════════════════════════════════════════════════

router.get('/onboarding/checklists', requireRole(...HR_FULL_ROLES), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM hr_onboarding_tasks WHERE checklist_id = c.id) as task_count
      FROM hr_onboarding_checklists c
      ORDER BY c.name ASC
    `).all();
    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Onboarding checklists list error:', err);
    res.status(500).json({ error: 'Failed to load onboarding checklists' });
  }
});

router.post('/onboarding/checklists', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, description, role_target, tasks } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const now = localNow();
    const insertChecklist = db.prepare(`
      INSERT INTO hr_onboarding_checklists (name, description, role_target, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertTask = db.prepare(`
      INSERT INTO hr_onboarding_tasks (checklist_id, title, description, category, sort_order, required, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const txn = db.transaction(() => {
      const result = insertChecklist.run(name, description || null, role_target || null, now, now);
      const checklistId = result.lastInsertRowid;

      if (Array.isArray(tasks) && tasks.length > 0) {
        for (const task of tasks) {
          insertTask.run(
            checklistId, task.title, task.description || null,
            task.category || 'general', task.sort_order ?? 0,
            task.required ?? 1, now
          );
        }
      }

      return checklistId;
    });

    const id = txn();
    auditLog(req, 'CREATE', 'system_config', id, `Created onboarding checklist "${name}" with ${Array.isArray(tasks) ? tasks.length : 0} tasks`);
    broadcast('hr', 'hr:updated', { type: 'onboarding_checklist', action: 'created', id });
    res.status(201).json({ success: true, id });
  } catch (err: any) {
    console.error('[HR] Onboarding checklist create error:', err);
    res.status(500).json({ error: 'Failed to create onboarding checklist' });
  }
});

router.put('/onboarding/checklists/:id', requireRole(...HR_FULL_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_onboarding_checklists WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Onboarding checklist not found' });
      return;
    }

    const { name, description, role_target } = req.body;

    db.prepare(`
      UPDATE hr_onboarding_checklists SET name = COALESCE(?, name), description = COALESCE(?, description),
        role_target = COALESCE(?, role_target), updated_at = ?
      WHERE id = ?
    `).run(name, description, role_target, localNow(), id);

    auditLog(req, 'UPDATE', 'system_config', id, `Updated onboarding checklist #${id}`);
    broadcast('hr', 'hr:updated', { type: 'onboarding_checklist', action: 'updated', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Onboarding checklist update error:', err);
    res.status(500).json({ error: 'Failed to update onboarding checklist' });
  }
});

router.delete('/onboarding/checklists/:id', requireRole(...HR_FULL_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_onboarding_checklists WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Onboarding checklist not found' });
      return;
    }

    const txn = db.transaction(() => {
      db.prepare(`DELETE FROM hr_onboarding_tasks WHERE checklist_id = ?`).run(id);
      db.prepare(`DELETE FROM hr_onboarding_checklists WHERE id = ?`).run(id);
    });
    txn();

    auditLog(req, 'DELETE', 'system_config', id, `Deleted onboarding checklist #${id}`);
    broadcast('hr', 'hr:updated', { type: 'onboarding_checklist', action: 'deleted', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Onboarding checklist delete error:', err);
    res.status(500).json({ error: 'Failed to delete onboarding checklist' });
  }
});


// ═══════════════════════════════════════════════════════════
// 11. ONBOARDING PROGRESS
// ═══════════════════════════════════════════════════════════

router.get('/onboarding/progress/:userId', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { userId } = req.params;
    const uid = parseInt(userId, 10);
    if (isNaN(uid) || uid < 1) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const rows = db.prepare(`
      SELECT op.*, ot.title as task_title, ot.description as task_description,
             ot.category as task_category, ot.required as task_required,
             oc.name as checklist_name,
             cb.full_name as completed_by_name
      FROM hr_onboarding_progress op
      JOIN hr_onboarding_tasks ot ON ot.id = op.task_id
      JOIN hr_onboarding_checklists oc ON oc.id = ot.checklist_id
      LEFT JOIN users cb ON cb.id = op.completed_by
      WHERE op.user_id = ?
      ORDER BY oc.name ASC, ot.sort_order ASC
    `).all(uid);

    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Onboarding progress error:', err);
    res.status(500).json({ error: 'Failed to load onboarding progress' });
  }
});

router.post('/onboarding/assign', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, checklist_id, due_date } = req.body;

    if (!user_id || !checklist_id) {
      res.status(400).json({ error: 'user_id and checklist_id are required' });
      return;
    }

    const checklist = db.prepare(`SELECT * FROM hr_onboarding_checklists WHERE id = ?`).get(checklist_id);
    if (!checklist) {
      res.status(404).json({ error: 'Checklist not found' });
      return;
    }

    const tasks = db.prepare(`SELECT * FROM hr_onboarding_tasks WHERE checklist_id = ? ORDER BY sort_order ASC`).all(checklist_id) as any[];

    if (tasks.length === 0) {
      res.status(400).json({ error: 'Checklist has no tasks' });
      return;
    }

    const now = localNow();
    const insertProgress = db.prepare(`
      INSERT INTO hr_onboarding_progress (user_id, task_id, status, due_date, assigned_at)
      VALUES (?, ?, 'pending', ?, ?)
    `);

    const txn = db.transaction(() => {
      for (const task of tasks) {
        insertProgress.run(user_id, task.id, due_date || null, now);
      }
    });
    txn();

    auditLog(req, 'CREATE', 'users', user_id, `Assigned onboarding checklist #${checklist_id} (${tasks.length} tasks) to user #${user_id}`);
    broadcast('hr', 'hr:updated', { type: 'onboarding_progress', action: 'assigned', user_id, checklist_id });
    res.status(201).json({ success: true, tasks_assigned: tasks.length });
  } catch (err: any) {
    console.error('[HR] Onboarding assign error:', err);
    res.status(500).json({ error: 'Failed to assign onboarding checklist' });
  }
});

router.put('/onboarding/progress/:taskProgressId', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { taskProgressId } = req.params;
    const tpId = parseInt(taskProgressId, 10);
    if (isNaN(tpId) || tpId < 1) {
      res.status(400).json({ error: 'Invalid task progress ID' });
      return;
    }

    const existing = db.prepare(`SELECT * FROM hr_onboarding_progress WHERE id = ?`).get(tpId);
    if (!existing) {
      res.status(404).json({ error: 'Onboarding task progress not found' });
      return;
    }

    const { status, notes } = req.body;
    const now = localNow();

    const completedAt = status === 'completed' ? now : null;
    const completedBy = status === 'completed' ? req.user!.userId : null;

    db.prepare(`
      UPDATE hr_onboarding_progress SET status = COALESCE(?, status),
        completed_at = COALESCE(?, completed_at), completed_by = COALESCE(?, completed_by),
        notes = COALESCE(?, notes), updated_at = ?
      WHERE id = ?
    `).run(status, completedAt, completedBy, notes, now, tpId);

    auditLog(req, 'UPDATE', 'users', tpId, `Updated onboarding task progress #${tpId}: status=${status || 'unchanged'}`);
    broadcast('hr', 'hr:updated', { type: 'onboarding_progress', action: 'updated', id: tpId });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Onboarding progress update error:', err);
    res.status(500).json({ error: 'Failed to update onboarding progress' });
  }
});


// ═══════════════════════════════════════════════════════════
// 12. EMPLOYEE DOCUMENTS
// ═══════════════════════════════════════════════════════════

router.get('/documents', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, document_type, status } = req.query;
    let sql = `
      SELECT d.*, u.full_name as user_name
      FROM hr_employee_documents d
      JOIN users u ON u.id = d.user_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (user_id) { sql += ` AND d.user_id = ?`; params.push(Number(user_id)); }
    if (document_type) { sql += ` AND d.document_type = ?`; params.push(String(document_type)); }
    if (status) { sql += ` AND d.status = ?`; params.push(String(status)); }
    else { sql += ` AND d.status != 'archived'`; }

    sql += ` ORDER BY d.created_at DESC`;
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Documents list error:', err);
    res.status(500).json({ error: 'Failed to load employee documents' });
  }
});

router.get('/documents/mine', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;

    const rows = db.prepare(`
      SELECT d.* FROM hr_employee_documents d
      WHERE d.user_id = ? AND d.status != 'archived'
      ORDER BY d.created_at DESC
    `).all(userId);

    res.json(rows);
  } catch (err: any) {
    console.error('[HR] My documents error:', err);
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

router.post('/documents', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, document_type, title, file_id, expires_at, notes } = req.body;

    if (!user_id || !document_type || !title) {
      res.status(400).json({ error: 'user_id, document_type, and title are required' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO hr_employee_documents (user_id, document_type, title, file_id, expires_at, notes, status, uploaded_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(user_id, document_type, title, file_id || null, expires_at || null, notes || null, req.user!.userId, localNow(), localNow());

    const id = result.lastInsertRowid;
    auditLog(req, 'CREATE', 'company_documents', id, `Uploaded document "${title}" for user #${user_id}`);
    broadcast('hr', 'hr:updated', { type: 'document', action: 'created', id, user_id });
    res.status(201).json({ success: true, id });
  } catch (err: any) {
    console.error('[HR] Document create error:', err);
    res.status(500).json({ error: 'Failed to create document' });
  }
});

router.put('/documents/:id', requireRole(...HR_FULL_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_employee_documents WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const { document_type, title, file_id, expires_at, notes, status } = req.body;

    db.prepare(`
      UPDATE hr_employee_documents SET document_type = COALESCE(?, document_type),
        title = COALESCE(?, title), file_id = COALESCE(?, file_id),
        expires_at = COALESCE(?, expires_at), notes = COALESCE(?, notes),
        status = COALESCE(?, status), updated_at = ?
      WHERE id = ?
    `).run(document_type, title, file_id, expires_at, notes, status, localNow(), id);

    auditLog(req, 'UPDATE', 'company_documents', id, `Updated document #${id}`);
    broadcast('hr', 'hr:updated', { type: 'document', action: 'updated', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Document update error:', err);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

router.delete('/documents/:id', requireRole(...HR_FULL_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_employee_documents WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    db.prepare(`UPDATE hr_employee_documents SET status = 'archived', updated_at = ? WHERE id = ?`).run(localNow(), id);
    auditLog(req, 'DELETE', 'company_documents', id, `Archived document #${id}`);
    broadcast('hr', 'hr:updated', { type: 'document', action: 'archived', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Document archive error:', err);
    res.status(500).json({ error: 'Failed to archive document' });
  }
});

router.post('/documents/:id/acknowledge', validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const userId = req.user!.userId;

    const doc = db.prepare(`SELECT * FROM hr_employee_documents WHERE id = ?`).get(id) as any;
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Only the document owner or HR can acknowledge
    const isHR = ['admin', 'manager', 'human_resources'].includes(req.user!.role);
    if (doc.user_id !== userId && !isHR) {
      res.status(403).json({ error: 'You do not have permission to acknowledge this document' });
      return;
    }

    // Check if already acknowledged
    const existingAck = db.prepare(`
      SELECT * FROM hr_document_acknowledgments WHERE document_id = ? AND user_id = ?
    `).get(id, userId);
    if (existingAck) {
      res.status(400).json({ error: 'Document already acknowledged' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO hr_document_acknowledgments (document_id, user_id, acknowledged_at)
      VALUES (?, ?, ?)
    `).run(id, userId, localNow());

    const ackId = result.lastInsertRowid;
    auditLog(req, 'UPDATE', 'company_documents', id, `User #${userId} acknowledged document #${id}`);
    broadcast('hr', 'hr:updated', { type: 'document_ack', action: 'created', document_id: id, user_id: userId });
    res.status(201).json({ success: true, id: ackId });
  } catch (err: any) {
    console.error('[HR] Document acknowledge error:', err);
    res.status(500).json({ error: 'Failed to acknowledge document' });
  }
});


// ═══════════════════════════════════════════════════════════
// 13. PAY RATES
// ═══════════════════════════════════════════════════════════

router.get('/pay-rates', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT pr.*, u.full_name as user_name
      FROM hr_pay_rates pr
      JOIN users u ON u.id = pr.user_id
      WHERE pr.is_current = 1
      ORDER BY u.full_name ASC
    `).all();
    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Pay rates list error:', err);
    res.status(500).json({ error: 'Failed to load pay rates' });
  }
});

router.get('/pay-rates/:userId', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { userId } = req.params;
    const uid = parseInt(userId, 10);
    if (isNaN(uid) || uid < 1) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const rows = db.prepare(`
      SELECT * FROM hr_pay_rates WHERE user_id = ? ORDER BY effective_date DESC
    `).all(uid);

    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Pay rates per-user error:', err);
    res.status(500).json({ error: 'Failed to load pay rate history' });
  }
});

router.post('/pay-rates', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, pay_type, rate, effective_date, notes } = req.body;

    if (!user_id || !pay_type || rate === undefined || rate === null || !effective_date) {
      res.status(400).json({ error: 'user_id, pay_type, rate, and effective_date are required' });
      return;
    }

    if (!['hourly', 'salary', 'contract'].includes(pay_type)) {
      res.status(400).json({ error: 'pay_type must be hourly, salary, or contract' });
      return;
    }

    const now = localNow();
    const txn = db.transaction(() => {
      // Mark all existing rates for this user as not current
      db.prepare(`UPDATE hr_pay_rates SET is_current = 0, updated_at = ? WHERE user_id = ? AND is_current = 1`).run(now, user_id);

      // Insert the new rate as current
      const result = db.prepare(`
        INSERT INTO hr_pay_rates (user_id, pay_type, rate, effective_date, is_current, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
      `).run(user_id, pay_type, rate, effective_date, notes || null, req.user!.userId, now, now);

      return result.lastInsertRowid;
    });

    const id = txn();
    auditLog(req, 'CREATE', 'users', id, `Set pay rate for user #${user_id}: ${pay_type} $${rate} effective ${effective_date}`);
    broadcast('hr', 'hr:updated', { type: 'pay_rate', action: 'created', id, user_id });
    res.status(201).json({ success: true, id });
  } catch (err: any) {
    console.error('[HR] Pay rate create error:', err);
    res.status(500).json({ error: 'Failed to create pay rate' });
  }
});

router.put('/pay-rates/:id', requireRole(...HR_FULL_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_pay_rates WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Pay rate not found' });
      return;
    }

    const { pay_type, rate, effective_date, notes } = req.body;

    db.prepare(`
      UPDATE hr_pay_rates SET pay_type = COALESCE(?, pay_type), rate = COALESCE(?, rate),
        effective_date = COALESCE(?, effective_date), notes = COALESCE(?, notes), updated_at = ?
      WHERE id = ?
    `).run(pay_type, rate, effective_date, notes, localNow(), id);

    auditLog(req, 'UPDATE', 'users', id, `Updated pay rate #${id}`);
    broadcast('hr', 'hr:updated', { type: 'pay_rate', action: 'updated', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Pay rate update error:', err);
    res.status(500).json({ error: 'Failed to update pay rate' });
  }
});


// ═══════════════════════════════════════════════════════════
// 14. PAY PERIODS
// ═══════════════════════════════════════════════════════════

router.get('/pay-periods', requireRole(...HR_FULL_ROLES), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM hr_pay_periods ORDER BY start_date DESC`).all();
    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Pay periods list error:', err);
    res.status(500).json({ error: 'Failed to load pay periods' });
  }
});

router.post('/pay-periods', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { start_date, end_date, pay_date, status } = req.body;

    if (!start_date || !end_date || !pay_date) {
      res.status(400).json({ error: 'start_date, end_date, and pay_date are required' });
      return;
    }

    if (start_date > end_date) {
      res.status(400).json({ error: 'start_date must be before end_date' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO hr_pay_periods (start_date, end_date, pay_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(start_date, end_date, pay_date, status || 'open', localNow(), localNow());

    const id = result.lastInsertRowid;
    auditLog(req, 'CREATE', 'system_config', id, `Created pay period: ${start_date} to ${end_date}, pay date ${pay_date}`);
    broadcast('hr', 'hr:updated', { type: 'pay_period', action: 'created', id });
    res.status(201).json({ success: true, id });
  } catch (err: any) {
    console.error('[HR] Pay period create error:', err);
    res.status(500).json({ error: 'Failed to create pay period' });
  }
});

router.put('/pay-periods/:id', requireRole(...HR_FULL_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_pay_periods WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Pay period not found' });
      return;
    }

    const { start_date, end_date, pay_date, status } = req.body;

    db.prepare(`
      UPDATE hr_pay_periods SET start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date),
        pay_date = COALESCE(?, pay_date), status = COALESCE(?, status), updated_at = ?
      WHERE id = ?
    `).run(start_date, end_date, pay_date, status, localNow(), id);

    auditLog(req, 'UPDATE', 'system_config', id, `Updated pay period #${id}`);
    broadcast('hr', 'hr:updated', { type: 'pay_period', action: 'updated', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Pay period update error:', err);
    res.status(500).json({ error: 'Failed to update pay period' });
  }
});


// ═══════════════════════════════════════════════════════════
// 15. PAYROLL ENTRIES
// ═══════════════════════════════════════════════════════════

router.get('/payroll', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { pay_period_id, user_id, status } = req.query;
    let sql = `
      SELECT pe.*, u.full_name as user_name, pp.start_date as period_start, pp.end_date as period_end,
             ab.full_name as approved_by_name
      FROM hr_payroll_entries pe
      JOIN users u ON u.id = pe.user_id
      JOIN hr_pay_periods pp ON pp.id = pe.pay_period_id
      LEFT JOIN users ab ON ab.id = pe.approved_by
      WHERE 1=1
    `;
    const params: any[] = [];

    if (pay_period_id) { sql += ` AND pe.pay_period_id = ?`; params.push(Number(pay_period_id)); }
    if (user_id) { sql += ` AND pe.user_id = ?`; params.push(Number(user_id)); }
    if (status) { sql += ` AND pe.status = ?`; params.push(String(status)); }

    sql += ` ORDER BY u.full_name ASC`;
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Payroll list error:', err);
    res.status(500).json({ error: 'Failed to load payroll entries' });
  }
});

router.get('/payroll/calculate/:payPeriodId', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { payPeriodId } = req.params;
    const ppId = parseInt(payPeriodId, 10);
    if (isNaN(ppId) || ppId < 1) {
      res.status(400).json({ error: 'Invalid pay period ID' });
      return;
    }

    const payPeriod = db.prepare(`SELECT * FROM hr_pay_periods WHERE id = ?`).get(ppId) as any;
    if (!payPeriod) {
      res.status(404).json({ error: 'Pay period not found' });
      return;
    }

    // Get all active employees
    const employees = db.prepare(`SELECT id, full_name FROM users WHERE is_active = 1`).all() as any[];

    const calculations: any[] = [];

    for (const emp of employees) {
      // Get current pay rate
      const payRate = db.prepare(`
        SELECT * FROM hr_pay_rates WHERE user_id = ? AND is_current = 1 LIMIT 1
      `).get(emp.id) as any;

      if (!payRate) continue;

      // Sum hours from time_entries within the pay period
      const timeData = db.prepare(`
        SELECT COALESCE(SUM(hours), 0) as total_hours,
               COALESCE(SUM(CASE WHEN entry_type = 'overtime' THEN hours ELSE 0 END), 0) as overtime_hours
        FROM time_entries
        WHERE user_id = ? AND date >= ? AND date <= ?
      `).get(emp.id, payPeriod.start_date, payPeriod.end_date) as any;

      const regularHours = (timeData.total_hours || 0) - (timeData.overtime_hours || 0);
      const overtimeHours = timeData.overtime_hours || 0;

      let grossPay = 0;
      if (payRate.pay_type === 'hourly') {
        grossPay = (regularHours * payRate.rate) + (overtimeHours * payRate.rate * 1.5);
      } else if (payRate.pay_type === 'salary') {
        // Salary: divide annual by 26 (biweekly) or 24 (semi-monthly)
        grossPay = payRate.rate / 26;
      } else {
        grossPay = payRate.rate;
      }

      // Get deductions for this user
      const deductions = db.prepare(`
        SELECT * FROM hr_deductions WHERE user_id = ? AND is_active = 1
      `).all(emp.id) as any[];

      let totalDeductions = 0;
      const deductionDetails: any[] = [];
      for (const ded of deductions) {
        let amount = 0;
        if (ded.calculation_type === 'fixed') {
          amount = ded.amount || 0;
        } else if (ded.calculation_type === 'percentage') {
          amount = grossPay * ((ded.amount || 0) / 100);
        }
        totalDeductions += amount;
        deductionDetails.push({ ...ded, calculated_amount: Math.round(amount * 100) / 100 });
      }

      const netPay = grossPay - totalDeductions;

      calculations.push({
        user_id: emp.id,
        user_name: emp.full_name,
        pay_type: payRate.pay_type,
        rate: payRate.rate,
        regular_hours: Math.round(regularHours * 100) / 100,
        overtime_hours: Math.round(overtimeHours * 100) / 100,
        gross_pay: Math.round(grossPay * 100) / 100,
        total_deductions: Math.round(totalDeductions * 100) / 100,
        net_pay: Math.round(netPay * 100) / 100,
        deductions: deductionDetails,
      });
    }

    res.json({ pay_period: payPeriod, calculations });
  } catch (err: any) {
    console.error('[HR] Payroll calculate error:', err);
    res.status(500).json({ error: 'Failed to calculate payroll' });
  }
});

router.post('/payroll', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { pay_period_id, user_id, regular_hours, overtime_hours, gross_pay, total_deductions, net_pay, notes } = req.body;

    if (!pay_period_id || !user_id) {
      res.status(400).json({ error: 'pay_period_id and user_id are required' });
      return;
    }

    // Check for existing entry
    const existing = db.prepare(`
      SELECT * FROM hr_payroll_entries WHERE pay_period_id = ? AND user_id = ?
    `).get(pay_period_id, user_id) as any;

    const now = localNow();

    if (existing) {
      // Update existing entry
      db.prepare(`
        UPDATE hr_payroll_entries SET regular_hours = COALESCE(?, regular_hours),
          overtime_hours = COALESCE(?, overtime_hours), gross_pay = COALESCE(?, gross_pay),
          total_deductions = COALESCE(?, total_deductions), net_pay = COALESCE(?, net_pay),
          notes = COALESCE(?, notes), updated_at = ?
        WHERE id = ?
      `).run(regular_hours, overtime_hours, gross_pay, total_deductions, net_pay, notes, now, existing.id);

      auditLog(req, 'UPDATE', 'users', existing.id, `Updated payroll entry #${existing.id} for user #${user_id}`);
      broadcast('hr', 'hr:updated', { type: 'payroll', action: 'updated', id: existing.id });
      res.json({ success: true, id: existing.id, updated: true });
    } else {
      // Create new entry
      const result = db.prepare(`
        INSERT INTO hr_payroll_entries (pay_period_id, user_id, regular_hours, overtime_hours, gross_pay, total_deductions, net_pay, notes, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
      `).run(pay_period_id, user_id, regular_hours || 0, overtime_hours || 0, gross_pay || 0, total_deductions || 0, net_pay || 0, notes || null, now, now);

      const id = result.lastInsertRowid;
      auditLog(req, 'CREATE', 'users', id, `Created payroll entry for user #${user_id}, period #${pay_period_id}`);
      broadcast('hr', 'hr:updated', { type: 'payroll', action: 'created', id });
      res.status(201).json({ success: true, id, updated: false });
    }
  } catch (err: any) {
    console.error('[HR] Payroll create/update error:', err);
    res.status(500).json({ error: 'Failed to create/update payroll entry' });
  }
});

router.put('/payroll/:id/approve', requireRole(...HR_FULL_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_payroll_entries WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Payroll entry not found' });
      return;
    }

    const now = localNow();
    db.prepare(`
      UPDATE hr_payroll_entries SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ?
      WHERE id = ?
    `).run(req.user!.userId, now, now, id);

    auditLog(req, 'UPDATE', 'users', id, `Approved payroll entry #${id}`);
    broadcast('hr', 'hr:updated', { type: 'payroll', action: 'approved', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Payroll approve error:', err);
    res.status(500).json({ error: 'Failed to approve payroll entry' });
  }
});


// ═══════════════════════════════════════════════════════════
// 16. DEDUCTIONS
// ═══════════════════════════════════════════════════════════

router.get('/deductions/:userId', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { userId } = req.params;
    const uid = parseInt(userId, 10);
    if (isNaN(uid) || uid < 1) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const rows = db.prepare(`
      SELECT * FROM hr_deductions WHERE user_id = ? ORDER BY name ASC
    `).all(uid);

    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Deductions list error:', err);
    res.status(500).json({ error: 'Failed to load deductions' });
  }
});

router.post('/deductions', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, name, deduction_type, calculation_type, amount, effective_date, end_date, notes } = req.body;

    if (!user_id || !name || !deduction_type || !calculation_type || amount === undefined || amount === null) {
      res.status(400).json({ error: 'user_id, name, deduction_type, calculation_type, and amount are required' });
      return;
    }

    if (!['fixed', 'percentage'].includes(calculation_type)) {
      res.status(400).json({ error: 'calculation_type must be fixed or percentage' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO hr_deductions (user_id, name, deduction_type, calculation_type, amount, effective_date, end_date, is_active, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(user_id, name, deduction_type, calculation_type, amount, effective_date || null, end_date || null, notes || null, localNow(), localNow());

    const id = result.lastInsertRowid;
    auditLog(req, 'CREATE', 'users', id, `Created deduction "${name}" (${calculation_type}: ${amount}) for user #${user_id}`);
    broadcast('hr', 'hr:updated', { type: 'deduction', action: 'created', id, user_id });
    res.status(201).json({ success: true, id });
  } catch (err: any) {
    console.error('[HR] Deduction create error:', err);
    res.status(500).json({ error: 'Failed to create deduction' });
  }
});

router.put('/deductions/:id', requireRole(...HR_FULL_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_deductions WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Deduction not found' });
      return;
    }

    const { name, deduction_type, calculation_type, amount, effective_date, end_date, notes } = req.body;

    db.prepare(`
      UPDATE hr_deductions SET name = COALESCE(?, name), deduction_type = COALESCE(?, deduction_type),
        calculation_type = COALESCE(?, calculation_type), amount = COALESCE(?, amount),
        effective_date = COALESCE(?, effective_date), end_date = COALESCE(?, end_date),
        notes = COALESCE(?, notes), updated_at = ?
      WHERE id = ?
    `).run(name, deduction_type, calculation_type, amount, effective_date, end_date, notes, localNow(), id);

    auditLog(req, 'UPDATE', 'users', id, `Updated deduction #${id}`);
    broadcast('hr', 'hr:updated', { type: 'deduction', action: 'updated', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Deduction update error:', err);
    res.status(500).json({ error: 'Failed to update deduction' });
  }
});

router.delete('/deductions/:id', requireRole(...HR_FULL_ROLES), validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT * FROM hr_deductions WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Deduction not found' });
      return;
    }

    db.prepare(`UPDATE hr_deductions SET is_active = 0, updated_at = ? WHERE id = ?`).run(localNow(), id);
    auditLog(req, 'DELETE', 'users', id, `Deactivated deduction #${id}`);
    broadcast('hr', 'hr:updated', { type: 'deduction', action: 'deactivated', id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[HR] Deduction deactivate error:', err);
    res.status(500).json({ error: 'Failed to deactivate deduction' });
  }
});


// ═══════════════════════════════════════════════════════════
// 17. PAY STUBS
// ═══════════════════════════════════════════════════════════

router.get('/pay-stubs/mine', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;

    const rows = db.prepare(`
      SELECT pe.*, pp.start_date as period_start, pp.end_date as period_end, pp.pay_date
      FROM hr_payroll_entries pe
      JOIN hr_pay_periods pp ON pp.id = pe.pay_period_id
      WHERE pe.user_id = ? AND pe.status = 'approved'
      ORDER BY pp.pay_date DESC
    `).all(userId);

    res.json(rows);
  } catch (err: any) {
    console.error('[HR] My pay stubs error:', err);
    res.status(500).json({ error: 'Failed to load pay stubs' });
  }
});

router.get('/pay-stubs/:userId', requireRole(...HR_FULL_ROLES), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { userId } = req.params;
    const uid = parseInt(userId, 10);
    if (isNaN(uid) || uid < 1) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const rows = db.prepare(`
      SELECT pe.*, pp.start_date as period_start, pp.end_date as period_end, pp.pay_date
      FROM hr_payroll_entries pe
      JOIN hr_pay_periods pp ON pp.id = pe.pay_period_id
      WHERE pe.user_id = ?
      ORDER BY pp.pay_date DESC
    `).all(uid);

    res.json(rows);
  } catch (err: any) {
    console.error('[HR] Pay stubs per-user error:', err);
    res.status(500).json({ error: 'Failed to load pay stubs' });
  }
});


export default router;
