import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow, localToday } from '../utils/timeUtils';
import { validateParamId, validateParamIdMiddleware, validateStr, validateEnum, requireInt, requireFloat, validateDateStr } from '../middleware/sanitize';
import { auditLog } from '../utils/auditLogger';
import { broadcast } from '../utils/websocket';
import { sendCsv } from '../utils/csvExport';

const router = Router();
router.use(authenticateToken);

const isManagerOrAbove = (role: string) => ['admin', 'manager', 'supervisor'].includes(role);

// ─── Employees list (used by HR modals for dropdowns) ────────────────────────

router.get('/employees', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const users = db.prepare(`
      SELECT id, full_name, badge_number, role, status
      FROM users
      WHERE status = 'active'
      ORDER BY full_name
    
      LIMIT 1000
    `).all();
    res.json(users);
  } catch (error: any) {
    console.error('HR employees list error:', error);
    res.status(500).json({ error: 'Failed to hr employees list', code: 'HR_EMPLOYEES_LIST_ERROR' });
  }
});

// GET /api/hr/review-cycles — Review cycle templates
router.get('/review-cycles', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    // Check if review_cycles table exists, otherwise return empty
    try {
      const cycles = db.prepare('SELECT * FROM review_cycles ORDER BY start_date DESC').all();
      res.json(cycles);
    } catch {
      res.json([]);
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Dashboard ───────────────────────────────────────────────────────────────

router.get('/dashboard', requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const today = localToday();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Headcount metrics
    const activeCount = (db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE status = 'active'`).get() as any).cnt;
    const newHires = (db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE status = 'active' AND hire_date >= ?`).get(thirtyDaysAgo) as any).cnt;
    const terminations = (db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE termination_date >= ?`).get(thirtyDaysAgo) as any).cnt;
    const onLeaveToday = (db.prepare(
      `SELECT COUNT(DISTINCT officer_id) as cnt FROM leave_requests
       WHERE status = 'approved' AND start_date <= ? AND end_date >= ?`
    ).get(today, today) as any).cnt;

    // Compliance
    const totalTraining = (db.prepare(`SELECT COUNT(*) as cnt FROM training_records`).get() as any).cnt;
    const completedTraining = (db.prepare(`SELECT COUNT(*) as cnt FROM training_records WHERE status = 'completed'`).get() as any).cnt;
    const training_pct = totalTraining > 0 ? Math.round((completedTraining / totalTraining) * 100) : 100;

    const totalCredentials = (db.prepare(`SELECT COUNT(*) as cnt FROM credentials`).get() as any).cnt;
    const activeCredentials = (db.prepare(`SELECT COUNT(*) as cnt FROM credentials WHERE status = 'active'`).get() as any).cnt;
    const credential_pct = totalCredentials > 0 ? Math.round((activeCredentials / totalCredentials) * 100) : 100;

    const overdue_count = (db.prepare(`SELECT COUNT(*) as cnt FROM training_records WHERE status = 'overdue'`).get() as any).cnt;

    // Pending counts
    const pending_leave = (db.prepare(`SELECT COUNT(*) as cnt FROM leave_requests WHERE status = 'pending'`).get() as any).cnt;
    const pending_reviews = (db.prepare(`SELECT COUNT(*) as cnt FROM performance_reviews WHERE status IN ('draft', 'submitted')`).get() as any).cnt;

    // Recent activity: last 10 from leave_requests + disciplinary_records + performance_reviews
    const recentLeave = db.prepare(
      `SELECT lr.id, 'leave_request' as entity_type, lr.type as sub_type, lr.status, lr.created_at,
              u.full_name as officer_name
       FROM leave_requests lr
       JOIN users u ON u.id = lr.officer_id
       ORDER BY lr.created_at DESC LIMIT 10`
    ).all();

    const recentDisciplinary = db.prepare(
      `SELECT dr.id, 'disciplinary' as entity_type, dr.type as sub_type, dr.status, dr.created_at,
              u.full_name as officer_name
       FROM disciplinary_records dr
       JOIN users u ON u.id = dr.officer_id
       ORDER BY dr.created_at DESC LIMIT 10`
    ).all();

    const recentReviews = db.prepare(
      `SELECT pr.id, 'performance_review' as entity_type, pr.type as sub_type, pr.status, pr.created_at,
              u.full_name as officer_name
       FROM performance_reviews pr
       JOIN users u ON u.id = pr.officer_id
       ORDER BY pr.created_at DESC LIMIT 10`
    ).all();

    const recent_activity = [...recentLeave, ...recentDisciplinary, ...recentReviews]
      .sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, 10);

    res.json({
      headcount: { active: activeCount, new_hires: newHires, terminations, on_leave_today: onLeaveToday },
      compliance: { training_pct, credential_pct, overdue_count },
      pending_leave,
      pending_reviews,
      recent_activity,
    });
  } catch (error: any) {
    console.error('[HR] Dashboard error:', error?.message);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ─── Leave Requests ──────────────────────────────────────────────────────────

router.get('/leave', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { officer_id, status, type, start_date, end_date } = req.query;

    let sql = `SELECT lr.*, u.full_name as officer_name
               FROM leave_requests lr
               JOIN users u ON u.id = lr.officer_id WHERE 1=1`;
    const params: any[] = [];

    // Officers see only their own
    if (!isManagerOrAbove(user.role)) {
      sql += ' AND lr.officer_id = ?';
      params.push(user.id);
    } else if (officer_id) {
      sql += ' AND lr.officer_id = ?';
      params.push(Number(officer_id));
    }

    if (status) {
      const validStatuses = ['pending', 'approved', 'denied', 'cancelled'];
      if (!validStatuses.includes(status as string)) { res.status(400).json({ error: 'Invalid status filter' }); return; }
      sql += ' AND lr.status = ?'; params.push(status);
    }
    if (type) {
      const validTypes = ['vacation', 'sick', 'personal', 'bereavement', 'military', 'jury_duty', 'unpaid', 'other'];
      if (!validTypes.includes(type as string)) { res.status(400).json({ error: 'Invalid type filter' }); return; }
      sql += ' AND lr.type = ?'; params.push(type);
    }
    if (start_date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start_date))) { res.status(400).json({ error: 'start_date must be YYYY-MM-DD' }); return; }
      sql += ' AND lr.start_date >= ?'; params.push(start_date);
    }
    if (end_date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(end_date))) { res.status(400).json({ error: 'end_date must be YYYY-MM-DD' }); return; }
      sql += ' AND lr.end_date <= ?'; params.push(end_date);
    }

    sql += ' ORDER BY lr.created_at DESC';
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (error: any) {
    console.error('[HR] Leave list error:', error?.message);
    res.status(500).json({ error: 'Failed to load leave requests' });
  }
});

router.post('/leave', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { type, start_date, end_date, hours_requested, reason } = req.body;

    // ── Validate leave request ──
    const LEAVE_TYPES = ['vacation', 'sick', 'personal', 'bereavement', 'military', 'jury_duty', 'unpaid', 'other'] as const;
    const validType = validateEnum(type, LEAVE_TYPES, 'type');
    if (!validType) return res.status(400).json({ error: 'type is required' });
    const validStart = validateDateStr(start_date, 'start_date');
    if (!validStart) return res.status(400).json({ error: 'start_date is required (YYYY-MM-DD)' });
    const validEnd = validateDateStr(end_date, 'end_date');
    if (!validEnd) return res.status(400).json({ error: 'end_date is required (YYYY-MM-DD)' });
    const validHours = requireFloat(hours_requested, 'hours_requested', 0, 2000) || 0;
    const validReason = validateStr(reason, 'reason', 2000);

    const now = localNow();
    const result = db.prepare(
      `INSERT INTO leave_requests (officer_id, type, start_date, end_date, hours_requested, reason, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(user.id, validType, validStart, validEnd, validHours, validReason, now, now);

    auditLog(req, 'CREATE', 'leave_request', Number(result.lastInsertRowid),
      `Leave request created: ${type} ${start_date} to ${end_date}`);
    broadcast('admin', 'hr:updated', { entity: 'leave', action: 'created', id: Number(result.lastInsertRowid) });
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    if (error.message?.startsWith('Invalid ') || error.message?.includes('must be')) {
      res.status(400).json({ error: error.message }); return;
    }
    console.error('[HR] Leave create error:', error?.message);
    res.status(500).json({ error: 'Failed to create leave request' });
  }
});

router.put('/leave/:id', validateParamIdMiddleware, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const id = Number(req.params.id);

    const existing = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Leave request not found' });
    if (existing.officer_id !== user.id) return res.status(403).json({ error: 'Can only update own requests' });
    if (existing.status !== 'pending') return res.status(400).json({ error: 'Can only update pending requests' });

    const { type, start_date, end_date, hours_requested, reason } = req.body;
    const now = localNow();

    db.prepare(
      `UPDATE leave_requests SET type = COALESCE(?, type), start_date = COALESCE(?, start_date),
       end_date = COALESCE(?, end_date), hours_requested = COALESCE(?, hours_requested),
       reason = COALESCE(?, reason), updated_at = ? WHERE id = ?`
    ).run(type || null, start_date || null, end_date || null, hours_requested ?? null, reason ?? null, now, id);

    auditLog(req, 'UPDATE', 'leave_request', id, `Leave request updated`);
    broadcast('admin', 'hr:updated', { entity: 'leave', action: 'updated', id });
    res.json({ success: true });
  } catch (error: any) {
    console.error('[HR] Leave update error:', error?.message);
    res.status(500).json({ error: 'Failed to update leave request' });
  }
});

router.post('/leave/:id/approve', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const id = Number(req.params.id);
    const { review_notes } = req.body;

    const existing = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Leave request not found' });
    if (existing.status !== 'pending') return res.status(400).json({ error: 'Can only approve pending requests' });

    const now = localNow();

    db.prepare(
      `UPDATE leave_requests SET status = 'approved', reviewed_by = ?, reviewed_at = ?,
       review_notes = ?, updated_at = ? WHERE id = ?`
    ).run(user.id, now, review_notes || null, now, id);

    // Deduct hours from leave_balances
    const year = new Date(existing.start_date).getFullYear();
    const leaveType = existing.type;
    if (['vacation', 'sick', 'personal'].includes(leaveType)) {
      const usedCol = `${leaveType}_used`;
      // Ensure balance row exists
      db.prepare(
        `INSERT OR IGNORE INTO leave_balances (officer_id, year, vacation_total, vacation_used, sick_total, sick_used, personal_total, personal_used, created_at, updated_at)
         VALUES (?, ?, 80, 0, 40, 0, 24, 0, ?, ?)`
      ).run(existing.officer_id, year, now, now);

      db.prepare(
        `UPDATE leave_balances SET ${usedCol} = ${usedCol} + ?, updated_at = ?
         WHERE officer_id = ? AND year = ?`
      ).run(existing.hours_requested, now, existing.officer_id, year);
    }

    auditLog(req, 'UPDATE', 'leave_request', id, `Leave request approved`);
    broadcast('admin', 'hr:updated', { entity: 'leave', action: 'approved', id });
    res.json({ success: true });
  } catch (error: any) {
    console.error('[HR] Leave approve error:', error?.message);
    res.status(500).json({ error: 'Failed to approve leave request' });
  }
});

router.post('/leave/:id/deny', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const id = Number(req.params.id);
    const { review_notes } = req.body;

    const existing = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Leave request not found' });
    if (existing.status !== 'pending') return res.status(400).json({ error: 'Can only deny pending requests' });

    const now = localNow();
    db.prepare(
      `UPDATE leave_requests SET status = 'denied', reviewed_by = ?, reviewed_at = ?,
       review_notes = ?, updated_at = ? WHERE id = ?`
    ).run(user.id, now, review_notes || null, now, id);

    auditLog(req, 'UPDATE', 'leave_request', id, `Leave request denied`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[HR] Leave deny error:', error?.message);
    res.status(500).json({ error: 'Failed to deny leave request' });
  }
});

// Bulk approve multiple leave requests
router.post('/leave/bulk-approve', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { ids, review_notes } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array is required' });
    if (ids.length > 100) return res.status(400).json({ error: 'Maximum 100 IDs per bulk action' });
    for (const id of ids) { if (isNaN(parseInt(String(id), 10)) || parseInt(String(id), 10) < 1) return res.status(400).json({ error: 'All IDs must be positive integers' }); }

    const now = localNow();
    let approved = 0;
    const stmt = db.prepare(
      `UPDATE leave_requests SET status = 'approved', reviewed_by = ?, reviewed_at = ?,
       review_notes = ?, updated_at = ? WHERE id = ? AND status = 'pending'`
    );

    for (const id of ids) {
      const result = stmt.run(user.id, now, review_notes || 'Bulk approved', now, Number(id));
      if (result.changes > 0) {
        approved++;
        // Update balance
        const req_row = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(Number(id)) as any;
        if (req_row) {
          const typeCol = `${req_row.type}_used`;
          const validCols = ['vacation_used', 'sick_used', 'personal_used'];
          if (validCols.includes(typeCol)) {
            db.prepare(`UPDATE leave_balances SET ${typeCol} = ${typeCol} + ?, updated_at = ? WHERE officer_id = ? AND year = ?`)
              .run(req_row.hours_requested, now, req_row.officer_id, new Date(req_row.start_date).getFullYear());
          }
        }
        auditLog(req, 'UPDATE', 'leave_request', Number(id), `Leave request bulk approved`);
      }
    }

    res.json({ success: true, approved, total: ids.length });
  } catch (error: any) {
    console.error('[HR] Bulk approve error:', error?.message);
    res.status(500).json({ error: 'Failed to bulk approve' });
  }
});

router.delete('/leave/:id', validateParamIdMiddleware, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const id = Number(req.params.id);

    const existing = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Leave request not found' });
    if (existing.officer_id !== user.id) return res.status(403).json({ error: 'Can only cancel own requests' });
    if (existing.status !== 'pending') return res.status(400).json({ error: 'Can only cancel pending requests' });

    const now = localNow();
    db.prepare(`UPDATE leave_requests SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(now, id);

    auditLog(req, 'DELETE', 'leave_request', id, `Leave request cancelled`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[HR] Leave cancel error:', error?.message);
    res.status(500).json({ error: 'Failed to cancel leave request' });
  }
});

// ─── Leave Balances ──────────────────────────────────────────────────────────

router.get('/leave/balances', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { officer_id, year } = req.query;
    const targetYear = year ? Number(year) : new Date().getFullYear();
    const now = localNow();

    if (!isManagerOrAbove(user.role)) {
      // Officers see own only — auto-create if missing
      db.prepare(
        `INSERT OR IGNORE INTO leave_balances (officer_id, year, vacation_total, vacation_used, sick_total, sick_used, personal_total, personal_used, created_at, updated_at)
         VALUES (?, ?, 80, 0, 40, 0, 24, 0, ?, ?)`
      ).run(user.id, targetYear, now, now);

      const row = db.prepare(
        `SELECT lb.*, u.full_name as officer_name FROM leave_balances lb
         JOIN users u ON u.id = lb.officer_id
         WHERE lb.officer_id = ? AND lb.year = ?`
      ).get(user.id, targetYear);
      return res.json(row ? [row] : []);
    }

    // Managers see all or specific officer
    if (officer_id) {
      db.prepare(
        `INSERT OR IGNORE INTO leave_balances (officer_id, year, vacation_total, vacation_used, sick_total, sick_used, personal_total, personal_used, created_at, updated_at)
         VALUES (?, ?, 80, 0, 40, 0, 24, 0, ?, ?)`
      ).run(Number(officer_id), targetYear, now, now);

      const row = db.prepare(
        `SELECT lb.*, u.full_name as officer_name FROM leave_balances lb
         JOIN users u ON u.id = lb.officer_id
         WHERE lb.officer_id = ? AND lb.year = ?`
      ).get(Number(officer_id), targetYear);
      return res.json(row ? [row] : []);
    }

    // All active users — auto-create balances for anyone missing
    const activeUsers = db.prepare(`SELECT id FROM users WHERE status = 'active'
      LIMIT 1000
    `).all() as any[];
    const insertBal = db.prepare(
      `INSERT OR IGNORE INTO leave_balances (officer_id, year, vacation_total, vacation_used, sick_total, sick_used, personal_total, personal_used, created_at, updated_at)
       VALUES (?, ?, 80, 0, 40, 0, 24, 0, ?, ?)`
    );
    for (const u of activeUsers) {
      insertBal.run(u.id, targetYear, now, now);
    }

    const rows = db.prepare(
      `SELECT lb.*, u.full_name as officer_name FROM leave_balances lb
       JOIN users u ON u.id = lb.officer_id
       WHERE lb.year = ? ORDER BY u.full_name`
    ).all(targetYear);
    res.json(rows);
  } catch (error: any) {
    console.error('[HR] Leave balances error:', error?.message);
    res.status(500).json({ error: 'Failed to load leave balances' });
  }
});

router.put('/leave/balances/:id', validateParamIdMiddleware, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);

    const existing = db.prepare('SELECT * FROM leave_balances WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Balance not found' });

    const { vacation_total, vacation_used, sick_total, sick_used, personal_total, personal_used } = req.body;
    const now = localNow();

    db.prepare(
      `UPDATE leave_balances SET
       vacation_total = COALESCE(?, vacation_total), vacation_used = COALESCE(?, vacation_used),
       sick_total = COALESCE(?, sick_total), sick_used = COALESCE(?, sick_used),
       personal_total = COALESCE(?, personal_total), personal_used = COALESCE(?, personal_used),
       updated_at = ? WHERE id = ?`
    ).run(vacation_total ?? null, vacation_used ?? null, sick_total ?? null, sick_used ?? null,
      personal_total ?? null, personal_used ?? null, now, id);

    auditLog(req, 'UPDATE', 'leave_balance', id, `Leave balance overridden`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[HR] Balance update error:', error?.message);
    res.status(500).json({ error: 'Failed to update balance' });
  }
});

// ─── Disciplinary Records ────────────────────────────────────────────────────

router.get('/disciplinary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { officer_id, type, severity, status, start_date, end_date } = req.query;

    if (!isManagerOrAbove(user.role)) {
      // Officers see own records with issued_by/witness redacted
      let sql = `SELECT dr.id, dr.officer_id, dr.type, dr.severity, dr.incident_date, dr.description,
                        dr.action_taken, dr.follow_up_date, dr.follow_up_notes, dr.status,
                        dr.attachments, dr.created_at, dr.updated_at,
                        u.full_name as officer_name
                 FROM disciplinary_records dr
                 JOIN users u ON u.id = dr.officer_id
                 WHERE dr.officer_id = ?`;
      const params: any[] = [user.id];

      if (type) { sql += ' AND dr.type = ?'; params.push(type); }
      if (severity) { sql += ' AND dr.severity = ?'; params.push(severity); }
      if (status) { sql += ' AND dr.status = ?'; params.push(status); }
      if (start_date) { sql += ' AND dr.incident_date >= ?'; params.push(start_date); }
      if (end_date) { sql += ' AND dr.incident_date <= ?'; params.push(end_date); }

      sql += ' ORDER BY dr.incident_date DESC';
      return res.json(db.prepare(sql).all(...params));
    }

    // Managers/admins see all with full detail
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
    res.json(db.prepare(sql).all(...params));
  } catch (error: any) {
    console.error('[HR] Disciplinary list error:', error?.message);
    res.status(500).json({ error: 'Failed to load disciplinary records' });
  }
});

router.get('/disciplinary/:officerId/timeline', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const officerId = Number(req.params.officerId);

    // Officers can only see own timeline
    if (!isManagerOrAbove(user.role) && user.id !== officerId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (isManagerOrAbove(user.role)) {
      const rows = db.prepare(
        `SELECT dr.*, u.full_name as officer_name, ib.full_name as issued_by_name
         FROM disciplinary_records dr
         JOIN users u ON u.id = dr.officer_id
         LEFT JOIN users ib ON ib.id = dr.issued_by
         WHERE dr.officer_id = ? ORDER BY dr.incident_date DESC`
      ).all(officerId);
      return res.json(rows);
    }

    // Officer viewing own — redact issued_by/witness
    const rows = db.prepare(
      `SELECT dr.id, dr.officer_id, dr.type, dr.severity, dr.incident_date, dr.description,
              dr.action_taken, dr.follow_up_date, dr.follow_up_notes, dr.status,
              dr.attachments, dr.created_at, dr.updated_at,
              u.full_name as officer_name
       FROM disciplinary_records dr
       JOIN users u ON u.id = dr.officer_id
       WHERE dr.officer_id = ? ORDER BY dr.incident_date DESC`
    ).all(officerId);
    res.json(rows);
  } catch (error: any) {
    console.error('[HR] Disciplinary timeline error:', error?.message);
    res.status(500).json({ error: 'Failed to load timeline' });
  }
});

router.post('/disciplinary', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { officer_id, type, severity, incident_date, description, action_taken,
            follow_up_date, follow_up_notes, status, witness, attachments } = req.body;

    // ── Validate disciplinary inputs ──
    const DISC_TYPES = ['verbal_warning', 'written_warning', 'suspension', 'probation', 'termination', 'counseling', 'other'] as const;
    const DISC_SEVERITIES = ['minor', 'moderate', 'major', 'critical'] as const;
    const DISC_STATUSES = ['open', 'pending_review', 'closed', 'appealed'] as const;

    const validOfficerId = requireInt(officer_id, 'officer_id');
    if (!validOfficerId) return res.status(400).json({ error: 'officer_id is required' });
    const validIncDate = validateDateStr(incident_date, 'incident_date');
    if (!validIncDate) return res.status(400).json({ error: 'incident_date is required (YYYY-MM-DD)' });
    const validDesc = validateStr(description, 'description', 5000);
    if (!validDesc) return res.status(400).json({ error: 'description is required' });
    const validDiscType = validateEnum(type, DISC_TYPES, 'type') || 'verbal_warning';
    const validSeverity = validateEnum(severity, DISC_SEVERITIES, 'severity') || 'minor';
    const validDiscStatus = validateEnum(status, DISC_STATUSES, 'status') || 'open';
    if (follow_up_date) validateDateStr(follow_up_date, 'follow_up_date');
    validateStr(action_taken, 'action_taken', 2000);
    validateStr(follow_up_notes, 'follow_up_notes', 5000);
    validateStr(witness, 'witness', 200);

    const now = localNow();
    const result = db.prepare(
      `INSERT INTO disciplinary_records (officer_id, type, severity, incident_date, description, action_taken,
       follow_up_date, follow_up_notes, status, issued_by, witness, attachments, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(validOfficerId, validDiscType, validSeverity, validIncDate, validDesc,
      action_taken || null, follow_up_date || null, follow_up_notes || null,
      validDiscStatus, user.id, witness || null, attachments || '[]', now, now);

    auditLog(req, 'CREATE', 'disciplinary_record', Number(result.lastInsertRowid),
      `Disciplinary record created for officer ${officer_id}: ${type || 'verbal_warning'}`);
    broadcast('admin', 'hr:updated', { entity: 'disciplinary', action: 'created', id: Number(result.lastInsertRowid) });
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    if (error.message?.startsWith('Invalid ') || error.message?.includes('must be')) {
      res.status(400).json({ error: error.message }); return;
    }
    console.error('[HR] Disciplinary create error:', error?.message);
    res.status(500).json({ error: 'Failed to create disciplinary record' });
  }
});

router.put('/disciplinary/:id', validateParamIdMiddleware, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);

    const existing = db.prepare('SELECT * FROM disciplinary_records WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    const { type, severity, incident_date, description, action_taken,
            follow_up_date, follow_up_notes, status, witness, attachments } = req.body;
    const now = localNow();

    db.prepare(
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

    auditLog(req, 'UPDATE', 'disciplinary_record', id, `Disciplinary record updated`);
    broadcast('admin', 'hr:updated', { entity: 'disciplinary', action: 'updated', id });
    res.json({ success: true });
  } catch (error: any) {
    console.error('[HR] Disciplinary update error:', error?.message);
    res.status(500).json({ error: 'Failed to update disciplinary record' });
  }
});

router.delete('/disciplinary/:id', validateParamIdMiddleware, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);

    const existing = db.prepare('SELECT * FROM disciplinary_records WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    db.prepare('DELETE FROM disciplinary_records WHERE id = ?').run(id);

    auditLog(req, 'DELETE', 'disciplinary_record', id, `Disciplinary record deleted`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[HR] Disciplinary delete error:', error?.message);
    res.status(500).json({ error: 'Failed to delete disciplinary record' });
  }
});

// ─── Performance Reviews ─────────────────────────────────────────────────────

router.get('/reviews', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { officer_id, reviewer_id, type, status } = req.query;

    let sql = `SELECT pr.*, u.full_name as officer_name, rv.full_name as reviewer_name
               FROM performance_reviews pr
               JOIN users u ON u.id = pr.officer_id
               LEFT JOIN users rv ON rv.id = pr.reviewer_id
               WHERE 1=1`;
    const params: any[] = [];

    if (!isManagerOrAbove(user.role)) {
      sql += ' AND pr.officer_id = ?';
      params.push(user.id);
    } else {
      if (officer_id) { sql += ' AND pr.officer_id = ?'; params.push(Number(officer_id)); }
      if (reviewer_id) { sql += ' AND pr.reviewer_id = ?'; params.push(Number(reviewer_id)); }
    }

    if (type) { sql += ' AND pr.type = ?'; params.push(type); }
    if (status) { sql += ' AND pr.status = ?'; params.push(status); }

    sql += ' ORDER BY pr.created_at DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (error: any) {
    console.error('[HR] Reviews list error:', error?.message);
    res.status(500).json({ error: 'Failed to load reviews' });
  }
});

router.post('/reviews', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, reviewer_id, review_period_start, review_period_end, review_date,
            type, overall_rating, categories, strengths, areas_for_improvement, goals, status } = req.body;

    // ── Validate review inputs ──
    const REVIEW_TYPES = ['annual', 'semi_annual', 'quarterly', 'probationary', 'special'] as const;
    const REVIEW_STATUSES = ['draft', 'submitted', 'completed', 'acknowledged'] as const;

    const validOid = requireInt(officer_id, 'officer_id');
    if (!validOid) return res.status(400).json({ error: 'officer_id is required' });
    const validStart = validateDateStr(review_period_start, 'review_period_start');
    if (!validStart) return res.status(400).json({ error: 'review_period_start is required (YYYY-MM-DD)' });
    const validEnd = validateDateStr(review_period_end, 'review_period_end');
    if (!validEnd) return res.status(400).json({ error: 'review_period_end is required (YYYY-MM-DD)' });
    if (reviewer_id) requireInt(reviewer_id, 'reviewer_id');
    if (review_date) validateDateStr(review_date, 'review_date');
    const validRevType = validateEnum(type, REVIEW_TYPES, 'type') || 'annual';
    const validRevStatus = validateEnum(status, REVIEW_STATUSES, 'status') || 'draft';
    if (overall_rating != null) requireFloat(overall_rating, 'overall_rating', 0, 10);

    const now = localNow();
    const user = (req as any).user;
    const result = db.prepare(
      `INSERT INTO performance_reviews (officer_id, reviewer_id, review_period_start, review_period_end,
       review_date, type, overall_rating, categories, strengths, areas_for_improvement, goals, status,
       created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(validOid, reviewer_id || user.id, validStart, validEnd,
      review_date || null, validRevType, overall_rating || null,
      typeof categories === 'object' ? JSON.stringify(categories) : (categories || '{}'),
      strengths || null, areas_for_improvement || null, goals || null,
      validRevStatus, now, now);

    auditLog(req, 'CREATE', 'performance_review', Number(result.lastInsertRowid),
      `Performance review created for officer ${officer_id}`);
    broadcast('admin', 'hr:updated', { entity: 'review', action: 'created', id: Number(result.lastInsertRowid) });
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    if (error.message?.startsWith('Invalid ') || error.message?.includes('must be')) {
      res.status(400).json({ error: error.message }); return;
    }
    console.error('[HR] Review create error:', error?.message);
    res.status(500).json({ error: 'Failed to create review' });
  }
});

router.put('/reviews/:id', validateParamIdMiddleware, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const id = Number(req.params.id);

    const existing = db.prepare('SELECT * FROM performance_reviews WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Review not found' });

    // Managers/admins/supervisors can update any; officers can only update own drafts
    if (!isManagerOrAbove(user.role)) {
      if (existing.officer_id !== user.id || existing.status !== 'draft') {
        return res.status(403).json({ error: 'Can only update own draft reviews' });
      }
    }

    const { review_period_start, review_period_end, review_date, type, overall_rating,
            categories, strengths, areas_for_improvement, goals, status } = req.body;
    const now = localNow();

    const catValue = categories != null
      ? (typeof categories === 'object' ? JSON.stringify(categories) : categories)
      : null;

    db.prepare(
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

    auditLog(req, 'UPDATE', 'performance_review', id, `Performance review updated`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[HR] Review update error:', error?.message);
    res.status(500).json({ error: 'Failed to update review' });
  }
});

router.post('/reviews/:id/acknowledge', validateParamIdMiddleware, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const id = Number(req.params.id);
    const { officer_comments } = req.body;

    const existing = db.prepare('SELECT * FROM performance_reviews WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Review not found' });
    if (existing.officer_id !== user.id) return res.status(403).json({ error: 'Can only acknowledge own reviews' });

    const now = localNow();
    db.prepare(
      `UPDATE performance_reviews SET officer_comments = ?, acknowledged_at = ?,
       status = 'acknowledged', updated_at = ? WHERE id = ?`
    ).run(officer_comments || null, now, now, id);

    auditLog(req, 'UPDATE', 'performance_review', id, `Performance review acknowledged`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[HR] Review acknowledge error:', error?.message);
    res.status(500).json({ error: 'Failed to acknowledge review' });
  }
});

router.delete('/reviews/:id', validateParamIdMiddleware, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);

    const existing = db.prepare('SELECT * FROM performance_reviews WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Review not found' });
    if (existing.status !== 'draft') return res.status(400).json({ error: 'Can only delete draft reviews' });

    db.prepare('DELETE FROM performance_reviews WHERE id = ?').run(id);

    auditLog(req, 'DELETE', 'performance_review', id, `Draft performance review deleted`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[HR] Review delete error:', error?.message);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Payroll — Pay Periods, Pay Rates, Payroll Entries
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Pay Periods ─────────────────────────────────────────────────────────────

router.get('/payroll/periods', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, year } = req.query;
    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { where += ' AND pp.status = ?'; params.push(status); }
    if (year) { where += ' AND pp.start_date >= ? AND pp.start_date < ?'; params.push(`${year}-01-01`, `${Number(year)+1}-01-01`); }

    const periods = db.prepare(`
      SELECT pp.*, u.full_name as created_by_name,
        (SELECT COUNT(*) FROM hr_payroll_entries pe WHERE pe.pay_period_id = pp.id) as entry_count,
        (SELECT COALESCE(SUM(pe.gross_pay), 0) FROM hr_payroll_entries pe WHERE pe.pay_period_id = pp.id) as total_gross,
        (SELECT COALESCE(SUM(pe.net_pay), 0) FROM hr_payroll_entries pe WHERE pe.pay_period_id = pp.id) as total_net
      FROM hr_pay_periods pp
      LEFT JOIN users u ON u.id = pp.created_by
      ${where}
      ORDER BY pp.start_date DESC
    `).all(...params);

    res.json(periods);
  } catch (error: any) {
    console.error('[HR] Payroll periods error:', error?.message);
    res.status(500).json({ error: 'Failed to fetch pay periods' });
  }
});

router.post('/payroll/periods', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, start_date, end_date, pay_date } = req.body;
    if (!start_date || !end_date || !pay_date) return res.status(400).json({ error: 'start_date, end_date, and pay_date are required' });

    const userId = (req as any).user?.id;
    const result = db.prepare(
      `INSERT INTO hr_pay_periods (name, start_date, end_date, pay_date, status, created_by) VALUES (?, ?, ?, ?, 'open', ?)`
    ).run(name || `Pay Period ${start_date} - ${end_date}`, start_date, end_date, pay_date, userId);

    const period = db.prepare('SELECT * FROM hr_pay_periods WHERE id = ?').get(Number(result.lastInsertRowid));
    auditLog(req, 'CREATE', 'hr_pay_period', Number(result.lastInsertRowid), `Created pay period: ${start_date} to ${end_date}`);
    res.json(period);
  } catch (error: any) {
    console.error('[HR] Create pay period error:', error?.message);
    res.status(500).json({ error: 'Failed to create pay period' });
  }
});

router.put('/payroll/periods/:id', validateParamIdMiddleware, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM hr_pay_periods WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Pay period not found' });

    const { name, start_date, end_date, pay_date, status } = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (start_date) { updates.push('start_date = ?'); params.push(start_date); }
    if (end_date) { updates.push('end_date = ?'); params.push(end_date); }
    if (pay_date) { updates.push('pay_date = ?'); params.push(pay_date); }
    if (status) { updates.push('status = ?'); params.push(status); }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

    params.push(id);
    db.prepare(`UPDATE hr_pay_periods SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM hr_pay_periods WHERE id = ?').get(id);
    auditLog(req, 'UPDATE', 'hr_pay_period', id, `Updated pay period`);
    res.json(updated);
  } catch (error: any) {
    console.error('[HR] Update pay period error:', error?.message);
    res.status(500).json({ error: 'Failed to update pay period' });
  }
});

router.delete('/payroll/periods/:id', validateParamIdMiddleware, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM hr_pay_periods WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Pay period not found' });
    if (existing.status !== 'open') return res.status(400).json({ error: 'Can only delete open pay periods' });

    db.prepare('DELETE FROM hr_payroll_entries WHERE pay_period_id = ?').run(id);
    db.prepare('DELETE FROM hr_pay_periods WHERE id = ?').run(id);

    auditLog(req, 'DELETE', 'hr_pay_period', id, `Deleted pay period: ${existing.name}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[HR] Delete pay period error:', error?.message);
    res.status(500).json({ error: 'Failed to delete pay period' });
  }
});

// ─── Pay Rates ───────────────────────────────────────────────────────────────

router.get('/payroll/rates', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id } = req.query;
    let where = 'WHERE pr.end_date IS NULL'; // Only active rates
    const params: any[] = [];
    if (user_id) { where += ' AND pr.user_id = ?'; params.push(Number(user_id)); }

    const rates = db.prepare(`
      SELECT pr.*, u.full_name as officer_name, cb.full_name as created_by_name
      FROM hr_pay_rates pr
      JOIN users u ON u.id = pr.user_id
      LEFT JOIN users cb ON cb.id = pr.created_by
      ${where}
      ORDER BY u.full_name, pr.effective_date DESC
    
      LIMIT 1000
    `).all(...params);

    res.json(rates);
  } catch (error: any) {
    console.error('[HR] Pay rates error:', error?.message);
    res.status(500).json({ error: 'Failed to fetch pay rates' });
  }
});

router.post('/payroll/rates', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, pay_type, rate, overtime_rate, holiday_rate, effective_date, notes } = req.body;
    if (!user_id || !pay_type || rate === undefined || !effective_date) {
      return res.status(400).json({ error: 'user_id, pay_type, rate, and effective_date are required' });
    }

    const userId = (req as any).user?.id;

    // Close any existing active rate for this user
    db.prepare(`UPDATE hr_pay_rates SET end_date = ? WHERE user_id = ? AND end_date IS NULL`).run(effective_date, user_id);

    const result = db.prepare(`
      INSERT INTO hr_pay_rates (user_id, pay_type, rate, overtime_rate, holiday_rate, effective_date, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user_id, pay_type, rate, overtime_rate ?? 1.5, holiday_rate ?? 1.5, effective_date, notes || null, userId);

    const newRate = db.prepare('SELECT pr.*, u.full_name as officer_name FROM hr_pay_rates pr JOIN users u ON u.id = pr.user_id WHERE pr.id = ?').get(Number(result.lastInsertRowid));
    auditLog(req, 'CREATE', 'hr_pay_rate', Number(result.lastInsertRowid), `Set pay rate for user ${user_id}: ${pay_type} $${rate}`);
    res.json(newRate);
  } catch (error: any) {
    console.error('[HR] Create pay rate error:', error?.message);
    res.status(500).json({ error: 'Failed to create pay rate' });
  }
});

// ─── Payroll Entries ─────────────────────────────────────────────────────────

router.get('/payroll/entries', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { pay_period_id, user_id } = req.query;
    if (!pay_period_id) return res.status(400).json({ error: 'pay_period_id is required' });

    let where = 'WHERE pe.pay_period_id = ?';
    const params: any[] = [Number(pay_period_id)];
    if (user_id) { where += ' AND pe.user_id = ?'; params.push(Number(user_id)); }

    const entries = db.prepare(`
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

    res.json(entries);
  } catch (error: any) {
    console.error('[HR] Payroll entries error:', error?.message);
    res.status(500).json({ error: 'Failed to fetch payroll entries' });
  }
});

router.post('/payroll/entries', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { pay_period_id, user_id, regular_hours, overtime_hours, holiday_hours, pto_hours, sick_hours, other_hours, other_hours_description, notes } = req.body;
    if (!pay_period_id || !user_id) return res.status(400).json({ error: 'pay_period_id and user_id are required' });

    // Find active pay rate
    const payRate = db.prepare(`
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
    const result = db.prepare(`
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

    const entry = db.prepare(`
      SELECT pe.*, u.full_name as officer_name FROM hr_payroll_entries pe JOIN users u ON u.id = pe.user_id WHERE pe.id = ?
    `).get(Number(result.lastInsertRowid));

    auditLog(req, 'CREATE', 'hr_payroll_entry', Number(result.lastInsertRowid), `Payroll entry for user ${user_id}, gross: $${grossPay.toFixed(2)}`);
    res.json(entry);
  } catch (error: any) {
    console.error('[HR] Create payroll entry error:', error?.message);
    res.status(500).json({ error: 'Failed to create payroll entry' });
  }
});

router.put('/payroll/entries/:id', validateParamIdMiddleware, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM hr_payroll_entries WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Payroll entry not found' });
    if (existing.status === 'approved') return res.status(400).json({ error: 'Cannot edit approved entries' });

    const { regular_hours, overtime_hours, holiday_hours, pto_hours, sick_hours, other_hours, other_hours_description, notes, status } = req.body;

    // Recalculate pay
    const payRate = existing.pay_rate_id
      ? db.prepare('SELECT * FROM hr_pay_rates WHERE id = ?').get(existing.pay_rate_id) as any
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
    const userId = (req as any).user?.id;

    db.prepare(`
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
      status, userId, status, now, now, id
    );

    const updated = db.prepare(`
      SELECT pe.*, u.full_name as officer_name FROM hr_payroll_entries pe JOIN users u ON u.id = pe.user_id WHERE pe.id = ?
    `).get(id);

    auditLog(req, 'UPDATE', 'hr_payroll_entry', id, `Updated payroll entry, gross: $${grossPay.toFixed(2)}`);
    res.json(updated);
  } catch (error: any) {
    console.error('[HR] Update payroll entry error:', error?.message);
    res.status(500).json({ error: 'Failed to update payroll entry' });
  }
});

// ─── Auto-populate period ────────────────────────────────────────────────────

router.post('/payroll/periods/:id/populate', validateParamIdMiddleware, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const period = db.prepare('SELECT * FROM hr_pay_periods WHERE id = ?').get(id) as any;
    if (!period) return res.status(404).json({ error: 'Pay period not found' });
    if (period.status !== 'open') return res.status(400).json({ error: 'Can only populate open pay periods' });

    // Get all active employees with pay rates
    const activeUsers = db.prepare(`
      SELECT u.id, u.full_name, pr.id as pay_rate_id, pr.rate, pr.pay_type
      FROM users u
      LEFT JOIN hr_pay_rates pr ON pr.user_id = u.id AND pr.end_date IS NULL
      WHERE u.status = 'active' AND u.archived_at IS NULL
      ORDER BY u.full_name
    
      LIMIT 1000
    `).all() as any[];

    // Don't duplicate existing entries
    const existing = db.prepare('SELECT user_id FROM hr_payroll_entries WHERE pay_period_id = ?').all(id) as any[];
    const existingIds = new Set(existing.map(e => e.user_id));

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

    for (const user of activeUsers) {
      if (existingIds.has(user.id)) continue;
      insert.run(user.id, id, user.pay_rate_id ?? null, now, now);
      created++;
    }

    auditLog(req, 'CREATE', 'hr_payroll_entry', id, `Auto-populated ${created} entries for pay period ${period.name}`);
    res.json({ success: true, created, total: activeUsers.length });
  } catch (error: any) {
    console.error('[HR] Populate pay period error:', error?.message);
    res.status(500).json({ error: 'Failed to populate pay period' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CSV Exports
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/leave/export/csv', requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT lr.*, u.full_name as officer_name, r.full_name as reviewer_name
      FROM leave_requests lr JOIN users u ON u.id = lr.officer_id
      LEFT JOIN users r ON r.id = lr.reviewed_by
      ORDER BY lr.created_at DESC LIMIT 10000
    `).all();
    sendCsv(res, 'leave-requests.csv', [
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
  } catch (error: any) {
    console.error('[HR] Leave CSV export error:', error?.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

router.get('/disciplinary/export/csv', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT dr.*, u.full_name as officer_name, ib.full_name as issued_by_name
      FROM disciplinary_records dr JOIN users u ON u.id = dr.officer_id
      LEFT JOIN users ib ON ib.id = dr.issued_by
      ORDER BY dr.created_at DESC LIMIT 10000
    `).all();
    sendCsv(res, 'disciplinary-records.csv', [
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
  } catch (error: any) {
    console.error('[HR] Disciplinary CSV export error:', error?.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

router.get('/reviews/export/csv', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT pr.*, u.full_name as officer_name, rv.full_name as reviewer_name
      FROM performance_reviews pr JOIN users u ON u.id = pr.officer_id
      LEFT JOIN users rv ON rv.id = pr.reviewer_id
      ORDER BY pr.created_at DESC LIMIT 10000
    `).all();
    sendCsv(res, 'performance-reviews.csv', [
      { key: 'officer_name', header: 'Employee' },
      { key: 'type', header: 'Review Type' },
      { key: 'review_period_start', header: 'Period Start' },
      { key: 'review_period_end', header: 'Period End' },
      { key: 'overall_rating', header: 'Overall Rating' },
      { key: 'status', header: 'Status' },
      { key: 'reviewer_name', header: 'Reviewer' },
      { key: 'review_date', header: 'Review Date' },
    ], rows);
  } catch (error: any) {
    console.error('[HR] Reviews CSV export error:', error?.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

router.get('/payroll/export/csv', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { pay_period_id } = req.query;
    if (!pay_period_id) return res.status(400).json({ error: 'pay_period_id required' });
    const rows = db.prepare(`
      SELECT pe.*, u.full_name as officer_name, u.badge_number
      FROM hr_payroll_entries pe JOIN users u ON u.id = pe.user_id
      WHERE pe.pay_period_id = ? ORDER BY u.full_name
    
      LIMIT 1000
    `).all(Number(pay_period_id));
    sendCsv(res, 'payroll.csv', [
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
  } catch (error: any) {
    console.error('[HR] Payroll CSV export error:', error?.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

// ─── Overtime Approval Workflow ──────────────────────────────────────────────

// Ensure overtime_requests table exists
try {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS overtime_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      officer_id INTEGER NOT NULL,
      officer_name TEXT,
      requested_date TEXT NOT NULL,
      hours_requested REAL NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'requested',
      reviewed_by INTEGER,
      reviewed_by_name TEXT,
      reviewed_at TEXT,
      review_notes TEXT,
      created_at TEXT NOT NULL
    )
  `);
} catch { /* table may already exist */ }

// GET /payroll/overtime — List OT requests
router.get('/payroll/overtime', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, officer_id } = req.query;
    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (officer_id) { where += ' AND officer_id = ?'; params.push(officer_id); }
    const role = req.user!.role;
    // Non-managers only see their own
    if (!isManagerOrAbove(role)) { where += ' AND officer_id = ?'; params.push(req.user!.userId); }
    const rows = db.prepare(`SELECT * FROM overtime_requests ${where} ORDER BY created_at DESC
      LIMIT 1000
    `).all(...params);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch OT requests' });
  }
});

// POST /payroll/overtime — Request OT
router.post('/payroll/overtime', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { requested_date, hours_requested, reason } = req.body;
    if (!requested_date || !hours_requested) {
      res.status(400).json({ error: 'requested_date and hours_requested are required' });
      return;
    }
    const now = localNow();
    const officerName = (db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any)?.full_name || '';
    const result = db.prepare(`
      INSERT INTO overtime_requests (officer_id, officer_name, requested_date, hours_requested, reason, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'requested', ?)
    `).run(req.user!.userId, officerName, requested_date, parseFloat(hours_requested as string), reason || null, now);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create OT request' });
  }
});

// PUT /payroll/overtime/:id — Approve/deny OT request
router.put('/payroll/overtime/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, review_notes } = req.body;
    if (!['approved', 'denied'].includes(status)) {
      res.status(400).json({ error: 'Status must be approved or denied' });
      return;
    }
    const now = localNow();
    const reviewerName = (db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any)?.full_name || '';
    db.prepare(`
      UPDATE overtime_requests SET status = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_notes = ? WHERE id = ?
    `).run(status, req.user!.userId, reviewerName, now, review_notes || null, req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update OT request' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// HR FEATURES (16-30)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 16. Payroll Period Summary ──────────────────────────────────────────────
router.get('/payroll/periods/:id/summary', validateParamIdMiddleware, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const period = db.prepare('SELECT * FROM hr_pay_periods WHERE id = ?').get(id) as any;
    if (!period) return res.status(404).json({ error: 'Pay period not found' });

    const entries = db.prepare(`
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

    res.json(summary);
  } catch (error: any) {
    console.error('[HR] Period summary error:', error?.message);
    res.status(500).json({ error: 'Failed to load period summary' });
  }
});

// ─── 17. Performance Review Templates ────────────────────────────────────────
router.get('/review-templates', requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
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
    res.json(templates);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load templates' });
  }
});

// ─── 18. Performance Score Trends ────────────────────────────────────────────
router.get('/reviews/trends/:officerId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const officerId = Number(req.params.officerId);

    const reviews = db.prepare(`
      SELECT id, type, overall_rating, review_date, review_period_start, review_period_end, status, template_name
      FROM performance_reviews
      WHERE officer_id = ? AND overall_rating IS NOT NULL
      ORDER BY review_period_end ASC
    
      LIMIT 1000
    `).all(officerId) as any[];

    res.json(reviews);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load review trends' });
  }
});

// ─── 19. Disciplinary Escalation Tracking ────────────────────────────────────
router.get('/disciplinary/:officerId/escalation', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const officerId = Number(req.params.officerId);

    const records = db.prepare(`
      SELECT id, type, severity, incident_date, status, description, action_taken
      FROM disciplinary_records
      WHERE officer_id = ?
      ORDER BY incident_date ASC
    
      LIMIT 1000
    `).all(officerId) as any[];

    // Escalation levels
    const escalationOrder = ['counseling', 'verbal_warning', 'written_warning', 'suspension', 'probation', 'termination'];
    const escalation = records.map((r: any, i: number) => ({
      ...r,
      escalation_level: escalationOrder.indexOf(r.type) + 1,
      step: i + 1,
    }));

    // Determine current escalation state
    const latestType = records.length > 0 ? records[records.length - 1].type : null;
    const nextStep = latestType ? escalationOrder[escalationOrder.indexOf(latestType) + 1] || 'termination' : 'verbal_warning';

    res.json({ records: escalation, current_level: latestType, next_step: nextStep, total_actions: records.length });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load escalation' });
  }
});

// ─── 20. Training Completion Certificates — return data for client PDF gen ───
router.get('/training-certificate/:trainingId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare(`
      SELECT tr.*, u.full_name as officer_name, u.badge_number
      FROM training_records tr
      JOIN users u ON u.id = tr.officer_id
      WHERE tr.id = ?
    `).get(Number(req.params.trainingId)) as any;

    if (!record) return res.status(404).json({ error: 'Training record not found' });
    if (record.status !== 'completed') return res.status(400).json({ error: 'Certificate only for completed training' });

    res.json({
      ...record,
      company: 'Rocky Mountain Protective Group',
      certificate_number: `RMPG-CERT-${String(record.id).padStart(6, '0')}`,
      issued_date: record.completed_date || new Date().toISOString().slice(0, 10),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate certificate' });
  }
});

// ─── 21. HR Document Library ─────────────────────────────────────────────────
router.get('/documents', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { category } = req.query;
    let sql = `SELECT d.*, u.full_name as uploaded_by_name FROM hr_documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE 1=1`;
    const params: any[] = [];
    if (category) { sql += ' AND d.category = ?'; params.push(category); }
    sql += ' ORDER BY d.created_at DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

router.post('/documents', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { title, category, description, file_path, file_name, file_size } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const now = localNow();
    const result = db.prepare(
      `INSERT INTO hr_documents (title, category, description, file_path, file_name, file_size, uploaded_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(title, category || 'policy', description || null, file_path || null, file_name || null, file_size || 0, (req as any).user?.id, now, now);
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create document' });
  }
});

router.delete('/documents/:id', validateParamIdMiddleware, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM hr_documents WHERE id = ?').run(Number(req.params.id));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// ─── 22. Employee Handbook Acknowledgment ────────────────────────────────────
router.get('/acknowledgments', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { document_id } = req.query;
    let sql = `SELECT a.*, u.full_name as officer_name, d.title as document_title
               FROM hr_handbook_acknowledgments a
               JOIN users u ON u.id = a.officer_id
               JOIN hr_documents d ON d.id = a.document_id WHERE 1=1`;
    const params: any[] = [];
    if (document_id) { sql += ' AND a.document_id = ?'; params.push(Number(document_id)); }
    sql += ' ORDER BY a.acknowledged_at DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load acknowledgments' });
  }
});

router.post('/acknowledgments', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { document_id, signature } = req.body;
    if (!document_id) return res.status(400).json({ error: 'document_id is required' });

    db.prepare(
      `INSERT OR REPLACE INTO hr_handbook_acknowledgments (officer_id, document_id, acknowledged_at, signature, ip_address)
       VALUES (?, ?, ?, ?, ?)`
    ).run(user.id, document_id, localNow(), signature || null, req.ip || 'unknown');

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to save acknowledgment' });
  }
});

// ─── 23. Grievance Filing System ─────────────────────────────────────────────
router.get('/grievances', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { status, officer_id } = req.query;
    let sql = `SELECT g.*, u.full_name as officer_name, a.full_name as assigned_to_name
               FROM hr_grievances g
               JOIN users u ON u.id = g.officer_id
               LEFT JOIN users a ON a.id = g.assigned_to WHERE 1=1`;
    const params: any[] = [];
    if (!isManagerOrAbove(user.role)) { sql += ' AND g.officer_id = ?'; params.push(user.id); }
    else if (officer_id) { sql += ' AND g.officer_id = ?'; params.push(Number(officer_id)); }
    if (status) { sql += ' AND g.status = ?'; params.push(status); }
    sql += ' ORDER BY g.created_at DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load grievances' });
  }
});

router.post('/grievances', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { type, subject, description, priority } = req.body;
    if (!subject || !description) return res.status(400).json({ error: 'subject and description are required' });
    const now = localNow();
    const result = db.prepare(
      `INSERT INTO hr_grievances (officer_id, type, subject, description, priority, filed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(user.id, type || 'general', subject, description, priority || 'normal', now, now, now);
    auditLog(req, 'CREATE', 'hr_grievance', Number(result.lastInsertRowid), `Grievance filed: ${subject}`);
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to file grievance' });
  }
});

router.put('/grievances/:id', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const { status, assigned_to, resolution } = req.body;
    const now = localNow();
    const sets: string[] = ['updated_at = ?'];
    const vals: any[] = [now];
    if (status) { sets.push('status = ?'); vals.push(status); if (status === 'resolved' || status === 'dismissed') { sets.push('resolved_at = ?'); vals.push(now); } }
    if (assigned_to !== undefined) { sets.push('assigned_to = ?'); vals.push(assigned_to); }
    if (resolution !== undefined) { sets.push('resolution = ?'); vals.push(resolution); }
    vals.push(id);
    db.prepare(`UPDATE hr_grievances SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    auditLog(req, 'UPDATE', 'hr_grievance', id, `Grievance updated`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update grievance' });
  }
});

// ─── 24. Workers Comp Incident Tracking ──────────────────────────────────────
router.get('/workers-comp', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, status } = req.query;
    let sql = `SELECT w.*, u.full_name as officer_name FROM hr_workers_comp w JOIN users u ON u.id = w.officer_id WHERE 1=1`;
    const params: any[] = [];
    if (officer_id) { sql += ' AND w.officer_id = ?'; params.push(Number(officer_id)); }
    if (status) { sql += ' AND w.status = ?'; params.push(status); }
    sql += ' ORDER BY w.incident_date DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load workers comp incidents' });
  }
});

router.post('/workers-comp', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, incident_date, injury_type, body_part, description, location,
            witnesses, treatment, physician, osha_recordable, osha_case_number, claim_number } = req.body;
    if (!officer_id || !incident_date || !injury_type || !description) {
      return res.status(400).json({ error: 'officer_id, incident_date, injury_type, and description are required' });
    }
    const now = localNow();
    const result = db.prepare(
      `INSERT INTO hr_workers_comp (officer_id, incident_date, injury_type, body_part, description, location,
       witnesses, treatment, physician, osha_recordable, osha_case_number, claim_number, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(officer_id, incident_date, injury_type, body_part || null, description, location || null,
      witnesses || null, treatment || null, physician || null, osha_recordable ? 1 : 0,
      osha_case_number || null, claim_number || null, now, now);
    auditLog(req, 'CREATE', 'hr_workers_comp', Number(result.lastInsertRowid), `Workers comp incident reported`);
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create workers comp record' });
  }
});

router.put('/workers-comp/:id', validateParamIdMiddleware, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const { status, lost_days, treatment, physician, claim_number } = req.body;
    const now = localNow();
    const sets: string[] = ['updated_at = ?'];
    const vals: any[] = [now];
    if (status) { sets.push('status = ?'); vals.push(status); }
    if (lost_days !== undefined) { sets.push('lost_days = ?'); vals.push(lost_days); }
    if (treatment !== undefined) { sets.push('treatment = ?'); vals.push(treatment); }
    if (physician !== undefined) { sets.push('physician = ?'); vals.push(physician); }
    if (claim_number !== undefined) { sets.push('claim_number = ?'); vals.push(claim_number); }
    vals.push(id);
    db.prepare(`UPDATE hr_workers_comp SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update workers comp record' });
  }
});

// ─── 25. Exit Interview Form ─────────────────────────────────────────────────
router.get('/exit-interviews', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id } = req.query;
    let sql = `SELECT ei.*, u.full_name as officer_name, iv.full_name as interviewer_name
               FROM hr_exit_interviews ei
               JOIN users u ON u.id = ei.officer_id
               LEFT JOIN users iv ON iv.id = ei.interviewer_id WHERE 1=1`;
    const params: any[] = [];
    if (officer_id) { sql += ' AND ei.officer_id = ?'; params.push(Number(officer_id)); }
    sql += ' ORDER BY ei.interview_date DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load exit interviews' });
  }
});

router.post('/exit-interviews', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, interview_date, reason_for_leaving, satisfaction_rating, would_return,
            what_liked, what_disliked, suggestions, management_feedback,
            work_environment_rating, compensation_rating, training_rating, notes } = req.body;
    if (!officer_id || !interview_date) return res.status(400).json({ error: 'officer_id and interview_date are required' });
    const result = db.prepare(
      `INSERT INTO hr_exit_interviews (officer_id, interview_date, interviewer_id, reason_for_leaving,
       satisfaction_rating, would_return, what_liked, what_disliked, suggestions, management_feedback,
       work_environment_rating, compensation_rating, training_rating, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(officer_id, interview_date, (req as any).user?.id, reason_for_leaving || null,
      satisfaction_rating || null, would_return ? 1 : 0, what_liked || null, what_disliked || null,
      suggestions || null, management_feedback || null, work_environment_rating || null,
      compensation_rating || null, training_rating || null, notes || null);
    auditLog(req, 'CREATE', 'hr_exit_interview', Number(result.lastInsertRowid), `Exit interview recorded`);
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create exit interview' });
  }
});

// ─── 26. Salary History Tracking ─────────────────────────────────────────────
router.get('/salary-history/:officerId', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT sh.*, u.full_name as approved_by_name
      FROM hr_salary_history sh
      LEFT JOIN users u ON u.id = sh.approved_by
      WHERE sh.officer_id = ? ORDER BY sh.effective_date DESC
    
      LIMIT 1000
    `).all(Number(req.params.officerId));
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load salary history' });
  }
});

router.post('/salary-history', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, effective_date, salary_amount, pay_type, reason } = req.body;
    if (!officer_id || !effective_date || salary_amount === undefined) {
      return res.status(400).json({ error: 'officer_id, effective_date, and salary_amount are required' });
    }
    const result = db.prepare(
      `INSERT INTO hr_salary_history (officer_id, effective_date, salary_amount, pay_type, reason, approved_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(officer_id, effective_date, salary_amount, pay_type || 'hourly', reason || null, (req as any).user?.id);
    auditLog(req, 'CREATE', 'hr_salary_history', Number(result.lastInsertRowid),
      `Salary change: $${salary_amount} effective ${effective_date}`);
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to save salary history' });
  }
});

// ─── 27. Benefits Enrollment Tracker ─────────────────────────────────────────
router.get('/benefits', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { officer_id } = req.query;
    let sql = `SELECT b.*, u.full_name as officer_name FROM hr_benefits b JOIN users u ON u.id = b.officer_id WHERE 1=1`;
    const params: any[] = [];
    if (!isManagerOrAbove(user.role)) { sql += ' AND b.officer_id = ?'; params.push(user.id); }
    else if (officer_id) { sql += ' AND b.officer_id = ?'; params.push(Number(officer_id)); }
    sql += ' ORDER BY b.benefit_type';
    res.json(db.prepare(sql).all(...params));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load benefits' });
  }
});

router.post('/benefits', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, benefit_type, plan_name, provider, coverage_level,
            employee_cost, employer_cost, effective_date, end_date } = req.body;
    if (!officer_id || !benefit_type) return res.status(400).json({ error: 'officer_id and benefit_type are required' });
    const now = localNow();
    const result = db.prepare(
      `INSERT INTO hr_benefits (officer_id, benefit_type, plan_name, provider, coverage_level,
       employee_cost, employer_cost, effective_date, end_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(officer_id, benefit_type, plan_name || null, provider || null, coverage_level || null,
      employee_cost || 0, employer_cost || 0, effective_date || null, end_date || null, now, now);
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create benefit record' });
  }
});

router.put('/benefits/:id', validateParamIdMiddleware, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const { status, end_date, plan_name, coverage_level, employee_cost, employer_cost } = req.body;
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
    db.prepare(`UPDATE hr_benefits SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update benefit' });
  }
});

// ─── 28. Performance Improvement Plan (PIP) ──────────────────────────────────
router.get('/pips', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, status } = req.query;
    let sql = `SELECT p.*, u.full_name as officer_name, s.full_name as supervisor_name
               FROM hr_pips p
               JOIN users u ON u.id = p.officer_id
               LEFT JOIN users s ON s.id = p.supervisor_id WHERE 1=1`;
    const params: any[] = [];
    if (officer_id) { sql += ' AND p.officer_id = ?'; params.push(Number(officer_id)); }
    if (status) { sql += ' AND p.status = ?'; params.push(status); }
    sql += ' ORDER BY p.created_at DESC';
    const rows = db.prepare(sql).all(...params) as any[];
    res.json(rows.map((r: any) => ({ ...r, goals: JSON.parse(r.goals || '[]'), milestones: JSON.parse(r.milestones || '[]') })));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load PIPs' });
  }
});

router.post('/pips', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, start_date, end_date, reason, goals, milestones } = req.body;
    if (!officer_id || !start_date || !end_date || !reason) {
      return res.status(400).json({ error: 'officer_id, start_date, end_date, and reason are required' });
    }
    const now = localNow();
    const result = db.prepare(
      `INSERT INTO hr_pips (officer_id, supervisor_id, start_date, end_date, reason, goals, milestones, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(officer_id, (req as any).user?.id, start_date, end_date, reason,
      JSON.stringify(goals || []), JSON.stringify(milestones || []), now, now);
    auditLog(req, 'CREATE', 'hr_pip', Number(result.lastInsertRowid), `PIP created for officer ${officer_id}`);
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create PIP' });
  }
});

router.put('/pips/:id', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const { status, goals, milestones, outcome, end_date } = req.body;
    const now = localNow();
    const sets: string[] = ['updated_at = ?'];
    const vals: any[] = [now];
    if (status) { sets.push('status = ?'); vals.push(status); }
    if (goals) { sets.push('goals = ?'); vals.push(JSON.stringify(goals)); }
    if (milestones) { sets.push('milestones = ?'); vals.push(JSON.stringify(milestones)); }
    if (outcome !== undefined) { sets.push('outcome = ?'); vals.push(outcome); }
    if (end_date) { sets.push('end_date = ?'); vals.push(end_date); }
    vals.push(id);
    db.prepare(`UPDATE hr_pips SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    auditLog(req, 'UPDATE', 'hr_pip', id, `PIP updated`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update PIP' });
  }
});

// ─── 29. Training ROI Calculator ─────────────────────────────────────────────
router.get('/training-roi/:officerId', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const officerId = Number(req.params.officerId);

    // Training costs
    const training = db.prepare(`
      SELECT SUM(hours) as total_hours, COUNT(*) as total_courses,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM training_records WHERE officer_id = ?
    `).get(officerId) as any;

    // Performance improvement (compare first vs last review)
    const reviews = db.prepare(`
      SELECT overall_rating, review_date FROM performance_reviews
      WHERE officer_id = ? AND overall_rating IS NOT NULL
      ORDER BY review_date ASC
    
      LIMIT 1000
    `).all(officerId) as any[];

    const firstRating = reviews.length > 0 ? reviews[0].overall_rating : null;
    const lastRating = reviews.length > 1 ? reviews[reviews.length - 1].overall_rating : null;
    const ratingImprovement = firstRating && lastRating ? lastRating - firstRating : null;

    // Estimated cost: $50/hr training cost assumption
    const estimatedCost = (training?.total_hours || 0) * 50;

    res.json({
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
    res.status(500).json({ error: 'Failed to calculate training ROI' });
  }
});

// ─── 30. Attendance Tracking ─────────────────────────────────────────────────
router.get('/attendance', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { officer_id, start_date, end_date, type } = req.query;
    let sql = `SELECT a.*, u.full_name as officer_name, d.full_name as documented_by_name
               FROM hr_attendance a
               JOIN users u ON u.id = a.officer_id
               LEFT JOIN users d ON d.id = a.documented_by WHERE 1=1`;
    const params: any[] = [];
    if (!isManagerOrAbove(user.role)) { sql += ' AND a.officer_id = ?'; params.push(user.id); }
    else if (officer_id) { sql += ' AND a.officer_id = ?'; params.push(Number(officer_id)); }
    if (start_date) { sql += ' AND a.date >= ?'; params.push(start_date); }
    if (end_date) { sql += ' AND a.date <= ?'; params.push(end_date); }
    if (type) { sql += ' AND a.type = ?'; params.push(type); }
    sql += ' ORDER BY a.date DESC';
    res.json(db.prepare(sql).all(...params));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load attendance' });
  }
});

router.post('/attendance', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, date, type, minutes_late, reason, excused } = req.body;
    if (!officer_id || !date || !type) return res.status(400).json({ error: 'officer_id, date, and type are required' });
    const result = db.prepare(
      `INSERT INTO hr_attendance (officer_id, date, type, minutes_late, reason, excused, documented_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(officer_id, date, type, minutes_late || 0, reason || null, excused ? 1 : 0, (req as any).user?.id);
    auditLog(req, 'CREATE', 'hr_attendance', Number(result.lastInsertRowid), `Attendance incident: ${type} for officer ${officer_id}`);
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to log attendance' });
  }
});

router.get('/attendance/summary/:officerId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const officerId = Number(req.params.officerId);
    const { year } = req.query;
    const targetYear = year || new Date().getFullYear();

    const summary = db.prepare(`
      SELECT type, COUNT(*) as count, SUM(CASE WHEN excused = 1 THEN 1 ELSE 0 END) as excused_count
      FROM hr_attendance
      WHERE officer_id = ? AND date LIKE ?
      GROUP BY type
    `).all(officerId, `${targetYear}%`) as any[];

    const total = summary.reduce((s: number, r: any) => s + r.count, 0);

    // Pattern detection: 3+ Monday/Friday absences = pattern
    const mondayFriday = db.prepare(`
      SELECT COUNT(*) as cnt FROM hr_attendance
      WHERE officer_id = ? AND date LIKE ? AND type IN ('absent','tardy')
        AND (CAST(strftime('%w', date) AS INTEGER) IN (1, 5))
    `).get(officerId, `${targetYear}%`) as any;

    res.json({
      officer_id: officerId,
      year: targetYear,
      by_type: summary,
      total_incidents: total,
      monday_friday_pattern: (mondayFriday?.cnt || 0) >= 3,
      monday_friday_count: mondayFriday?.cnt || 0,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load attendance summary' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Path Aliases (client uses different names than server)
// Express use() sub-mount trick: mount the same router at alternate paths
// ═══════════════════════════════════════════════════════════════

// /hr/performance-reviews/* → redirects to /hr/reviews/* handlers
router.get('/performance-reviews', (req: Request, res: Response) => {
  const db = getDb();
  const user = (req as any).user;
  let sql = `SELECT r.*, u.full_name as officer_name, rev.full_name as reviewer_name FROM hr_performance_reviews r JOIN users u ON u.id = r.officer_id LEFT JOIN users rev ON rev.id = r.reviewer_id WHERE 1=1`;
  const params: any[] = [];
  if (!isManagerOrAbove(user.role)) { sql += ' AND r.officer_id = ?'; params.push(user.id); }
  sql += ' ORDER BY r.review_date DESC';
  try { res.json(db.prepare(sql).all(...params)); } catch { res.json([]); }
});

router.post('/performance-reviews', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, review_type, review_date, period_start, period_end, overall_rating, strengths, areas_for_improvement, goals, comments } = req.body;
    if (!officer_id || !review_type) return res.status(400).json({ error: 'officer_id and review_type required' });
    const result = db.prepare(`
      INSERT INTO hr_performance_reviews (officer_id, reviewer_id, review_type, review_date, period_start, period_end, overall_rating, strengths, areas_for_improvement, goals, comments, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `).run(officer_id, (req as any).user?.id, review_type, review_date || localNow(), period_start || null, period_end || null, overall_rating || null, strengths || null, areas_for_improvement || null, goals || null, comments || null);
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create review' });
  }
});

router.put('/performance-reviews/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const fields = ['overall_rating', 'strengths', 'areas_for_improvement', 'goals', 'comments', 'status'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id);
    db.prepare(`UPDATE hr_performance_reviews SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update review' });
  }
});

// /hr/disciplinary-actions/* → redirects to /hr/disciplinary/* handlers
router.get('/disciplinary-actions', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    let sql = `SELECT d.*, u.full_name as officer_name, iu.full_name as issued_by_name FROM hr_disciplinary d JOIN users u ON u.id = d.officer_id LEFT JOIN users iu ON iu.id = d.issued_by WHERE 1=1`;
    const params: any[] = [];
    if (!isManagerOrAbove(user.role)) { sql += ' AND d.officer_id = ?'; params.push(user.id); }
    sql += ' ORDER BY d.issued_date DESC';
    res.json(db.prepare(sql).all(...params));
  } catch { res.json([]); }
});

router.post('/disciplinary-actions', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, action_type, severity, description, issued_date } = req.body;
    if (!officer_id || !action_type) return res.status(400).json({ error: 'officer_id and action_type required' });
    const result = db.prepare(`
      INSERT INTO hr_disciplinary (officer_id, issued_by, action_type, severity, description, issued_date, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(officer_id, (req as any).user?.id, action_type, severity || 'written_warning', description || null, issued_date || localNow());
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create disciplinary action' });
  }
});

router.put('/disciplinary-actions/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const fields = ['action_type', 'severity', 'description', 'status', 'resolution', 'resolution_date'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id);
    db.prepare(`UPDATE hr_disciplinary SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update disciplinary action' });
  }
});

export default router;
