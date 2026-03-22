import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow, localToday } from '../utils/timeUtils';
import { validateParamId } from '../middleware/sanitize';
import { auditLog } from '../utils/auditLogger';
import { broadcast } from '../utils/websocket';
import { sendCsv } from '../utils/csvExport';

const router = Router();
router.use(authenticateToken);

const isManagerOrAbove = (role: string) => ['admin', 'manager', 'supervisor'].includes(role);

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

    if (status) { sql += ' AND lr.status = ?'; params.push(status); }
    if (type) { sql += ' AND lr.type = ?'; params.push(type); }
    if (start_date) { sql += ' AND lr.start_date >= ?'; params.push(start_date); }
    if (end_date) { sql += ' AND lr.end_date <= ?'; params.push(end_date); }

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

    if (!type || !start_date || !end_date) {
      return res.status(400).json({ error: 'type, start_date, and end_date are required' });
    }

    const now = localNow();
    const result = db.prepare(
      `INSERT INTO leave_requests (officer_id, type, start_date, end_date, hours_requested, reason, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(user.id, type, start_date, end_date, hours_requested || 0, reason || null, now, now);

    auditLog(req, 'CREATE' as any, 'leave_request' as any, Number(result.lastInsertRowid),
      `Leave request created: ${type} ${start_date} to ${end_date}`);
    broadcast('admin', 'hr:updated', { entity: 'leave', action: 'created', id: Number(result.lastInsertRowid) });
    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('[HR] Leave create error:', error?.message);
    res.status(500).json({ error: 'Failed to create leave request' });
  }
});

router.put('/leave/:id', validateParamId, (req: Request, res: Response) => {
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

    auditLog(req, 'UPDATE' as any, 'leave_request' as any, id, `Leave request updated`);
    broadcast('admin', 'hr:updated', { entity: 'leave', action: 'updated', id });
    res.json({ success: true });
  } catch (error: any) {
    console.error('[HR] Leave update error:', error?.message);
    res.status(500).json({ error: 'Failed to update leave request' });
  }
});

router.post('/leave/:id/approve', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
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

    auditLog(req, 'UPDATE' as any, 'leave_request' as any, id, `Leave request approved`);
    broadcast('admin', 'hr:updated', { entity: 'leave', action: 'approved', id });
    res.json({ success: true });
  } catch (error: any) {
    console.error('[HR] Leave approve error:', error?.message);
    res.status(500).json({ error: 'Failed to approve leave request' });
  }
});

router.post('/leave/:id/deny', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
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

    auditLog(req, 'UPDATE' as any, 'leave_request' as any, id, `Leave request denied`);
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
        auditLog(req, 'UPDATE' as any, 'leave_request' as any, Number(id), `Leave request bulk approved`);
      }
    }

    res.json({ success: true, approved, total: ids.length });
  } catch (error: any) {
    console.error('[HR] Bulk approve error:', error?.message);
    res.status(500).json({ error: 'Failed to bulk approve' });
  }
});

router.delete('/leave/:id', validateParamId, (req: Request, res: Response) => {
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

    auditLog(req, 'DELETE' as any, 'leave_request' as any, id, `Leave request cancelled`);
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
    const activeUsers = db.prepare(`SELECT id FROM users WHERE status = 'active'`).all() as any[];
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

router.put('/leave/balances/:id', validateParamId, requireRole('admin'), (req: Request, res: Response) => {
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

    auditLog(req, 'UPDATE' as any, 'leave_balance' as any, id, `Leave balance overridden`);
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

    if (!officer_id || !incident_date || !description) {
      return res.status(400).json({ error: 'officer_id, incident_date, and description are required' });
    }

    const now = localNow();
    const result = db.prepare(
      `INSERT INTO disciplinary_records (officer_id, type, severity, incident_date, description, action_taken,
       follow_up_date, follow_up_notes, status, issued_by, witness, attachments, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(officer_id, type || 'verbal_warning', severity || 'minor', incident_date, description,
      action_taken || null, follow_up_date || null, follow_up_notes || null,
      status || 'open', user.id, witness || null, attachments || '[]', now, now);

    auditLog(req, 'CREATE' as any, 'disciplinary_record' as any, Number(result.lastInsertRowid),
      `Disciplinary record created for officer ${officer_id}: ${type || 'verbal_warning'}`);
    broadcast('admin', 'hr:updated', { entity: 'disciplinary', action: 'created', id: Number(result.lastInsertRowid) });
    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('[HR] Disciplinary create error:', error?.message);
    res.status(500).json({ error: 'Failed to create disciplinary record' });
  }
});

router.put('/disciplinary/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
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

    auditLog(req, 'UPDATE' as any, 'disciplinary_record' as any, id, `Disciplinary record updated`);
    broadcast('admin', 'hr:updated', { entity: 'disciplinary', action: 'updated', id });
    res.json({ success: true });
  } catch (error: any) {
    console.error('[HR] Disciplinary update error:', error?.message);
    res.status(500).json({ error: 'Failed to update disciplinary record' });
  }
});

router.delete('/disciplinary/:id', validateParamId, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);

    const existing = db.prepare('SELECT * FROM disciplinary_records WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    db.prepare('DELETE FROM disciplinary_records WHERE id = ?').run(id);

    auditLog(req, 'DELETE' as any, 'disciplinary_record' as any, id, `Disciplinary record deleted`);
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

    if (!officer_id || !review_period_start || !review_period_end) {
      return res.status(400).json({ error: 'officer_id, review_period_start, and review_period_end are required' });
    }

    const now = localNow();
    const user = (req as any).user;
    const result = db.prepare(
      `INSERT INTO performance_reviews (officer_id, reviewer_id, review_period_start, review_period_end,
       review_date, type, overall_rating, categories, strengths, areas_for_improvement, goals, status,
       created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(officer_id, reviewer_id || user.id, review_period_start, review_period_end,
      review_date || null, type || 'annual', overall_rating || null,
      typeof categories === 'object' ? JSON.stringify(categories) : (categories || '{}'),
      strengths || null, areas_for_improvement || null, goals || null,
      status || 'draft', now, now);

    auditLog(req, 'CREATE' as any, 'performance_review' as any, Number(result.lastInsertRowid),
      `Performance review created for officer ${officer_id}`);
    broadcast('admin', 'hr:updated', { entity: 'review', action: 'created', id: Number(result.lastInsertRowid) });
    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('[HR] Review create error:', error?.message);
    res.status(500).json({ error: 'Failed to create review' });
  }
});

router.put('/reviews/:id', validateParamId, (req: Request, res: Response) => {
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

    auditLog(req, 'UPDATE' as any, 'performance_review' as any, id, `Performance review updated`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[HR] Review update error:', error?.message);
    res.status(500).json({ error: 'Failed to update review' });
  }
});

router.post('/reviews/:id/acknowledge', validateParamId, (req: Request, res: Response) => {
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

    auditLog(req, 'UPDATE' as any, 'performance_review' as any, id, `Performance review acknowledged`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[HR] Review acknowledge error:', error?.message);
    res.status(500).json({ error: 'Failed to acknowledge review' });
  }
});

router.delete('/reviews/:id', validateParamId, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);

    const existing = db.prepare('SELECT * FROM performance_reviews WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Review not found' });
    if (existing.status !== 'draft') return res.status(400).json({ error: 'Can only delete draft reviews' });

    db.prepare('DELETE FROM performance_reviews WHERE id = ?').run(id);

    auditLog(req, 'DELETE' as any, 'performance_review' as any, id, `Draft performance review deleted`);
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

    const period = db.prepare('SELECT * FROM hr_pay_periods WHERE id = ?').get(result.lastInsertRowid);
    auditLog(req, 'CREATE' as any, 'hr_pay_period' as any, result.lastInsertRowid, `Created pay period: ${start_date} to ${end_date}`);
    res.json(period);
  } catch (error: any) {
    console.error('[HR] Create pay period error:', error?.message);
    res.status(500).json({ error: 'Failed to create pay period' });
  }
});

router.put('/payroll/periods/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
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
    auditLog(req, 'UPDATE' as any, 'hr_pay_period' as any, id, `Updated pay period`);
    res.json(updated);
  } catch (error: any) {
    console.error('[HR] Update pay period error:', error?.message);
    res.status(500).json({ error: 'Failed to update pay period' });
  }
});

router.delete('/payroll/periods/:id', validateParamId, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM hr_pay_periods WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Pay period not found' });
    if (existing.status !== 'open') return res.status(400).json({ error: 'Can only delete open pay periods' });

    db.prepare('DELETE FROM hr_payroll_entries WHERE pay_period_id = ?').run(id);
    db.prepare('DELETE FROM hr_pay_periods WHERE id = ?').run(id);

    auditLog(req, 'DELETE' as any, 'hr_pay_period' as any, id, `Deleted pay period: ${existing.name}`);
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

    const newRate = db.prepare('SELECT pr.*, u.full_name as officer_name FROM hr_pay_rates pr JOIN users u ON u.id = pr.user_id WHERE pr.id = ?').get(result.lastInsertRowid);
    auditLog(req, 'CREATE' as any, 'hr_pay_rate' as any, result.lastInsertRowid, `Set pay rate for user ${user_id}: ${pay_type} $${rate}`);
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
    `).get(result.lastInsertRowid);

    auditLog(req, 'CREATE' as any, 'hr_payroll_entry' as any, result.lastInsertRowid, `Payroll entry for user ${user_id}, gross: $${grossPay.toFixed(2)}`);
    res.json(entry);
  } catch (error: any) {
    console.error('[HR] Create payroll entry error:', error?.message);
    res.status(500).json({ error: 'Failed to create payroll entry' });
  }
});

router.put('/payroll/entries/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
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

    auditLog(req, 'UPDATE' as any, 'hr_payroll_entry' as any, id, `Updated payroll entry, gross: $${grossPay.toFixed(2)}`);
    res.json(updated);
  } catch (error: any) {
    console.error('[HR] Update payroll entry error:', error?.message);
    res.status(500).json({ error: 'Failed to update payroll entry' });
  }
});

// ─── Auto-populate period ────────────────────────────────────────────────────

router.post('/payroll/periods/:id/populate', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
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

    auditLog(req, 'CREATE' as any, 'hr_payroll_entry' as any, id, `Auto-populated ${created} entries for pay period ${period.name}`);
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

export default router;
