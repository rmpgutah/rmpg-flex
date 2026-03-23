import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcastAdminUpdate } from '../utils/websocket';
import { localNow, localToday } from '../utils/timeUtils';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// ============================================================
// Initialize tables for this module
// ============================================================
function initTables(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS shift_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      shift_type TEXT NOT NULL DEFAULT 'day',
      assignments TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

// Run table init on import (may fail if DB not yet initialized)
let tablesInitialized = false;
try {
  initTables();
  tablesInitialized = true;
} catch {
  // DB may not be initialized yet at import time; will retry on first request
}

// Lazy init middleware — ensures tables exist before any route handler runs
router.use((_req, _res, next) => {
  if (!tablesInitialized) {
    try {
      initTables();
      tablesInitialized = true;
    } catch (err) {
      console.error('shiftPlans initTables retry failed:', err);
    }
  }
  next();
});

// Helper: parse assignments JSON on a row
function parseAssignments(row: any): any {
  if (!row) return row;
  try {
    row.assignments = typeof row.assignments === 'string' ? JSON.parse(row.assignments) : row.assignments;
  } catch {
    row.assignments = [];
  }
  return row;
}

// ============================================================
// GET /shift-plans — List all shift plans
// ============================================================
router.get('/shift-plans', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date, status } = req.query;

    let sql = `
      SELECT sp.*, u.full_name as created_by_name
      FROM shift_plans sp
      LEFT JOIN users u ON sp.created_by = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (date) {
      sql += ' AND sp.date = ?';
      params.push(date);
    }

    if (status) {
      sql += ' AND sp.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY sp.date DESC, sp.created_at DESC LIMIT 500';

    const rows = db.prepare(sql).all(...params) as any[];
    const plans = rows.map(parseAssignments);

    res.json(plans);
  } catch (error: any) {
    console.error('Get shift plans error:', error);
    res.status(500).json({ error: 'Failed to get shift plans', code: 'GET_SHIFT_PLANS_ERROR' });
  }
});

// ============================================================
// GET /shift-plans/coverage/:date — Active plan assignments for a date
// ============================================================
router.get('/shift-plans/coverage/:date', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date } = req.params;

    const rows = db.prepare(`
      SELECT sp.id as plan_id, sp.name as plan_name, sp.shift_type, sp.assignments
      FROM shift_plans sp
      WHERE sp.date = ? AND sp.status = 'active'
      ORDER BY sp.shift_type
    
      LIMIT 1000
    `).all(date) as any[];

    const allAssignments: any[] = [];
    for (const row of rows) {
      let assignments: any[] = [];
      try {
        assignments = typeof row.assignments === 'string' ? JSON.parse(row.assignments) : row.assignments;
      } catch {
        assignments = [];
      }
      for (const assignment of assignments) {
        allAssignments.push({
          ...assignment,
          plan_id: row.plan_id,
          plan_name: row.plan_name,
          shift_type: row.shift_type,
        });
      }
    }

    res.json(allAssignments);
  } catch (error: any) {
    console.error('Get shift coverage error:', error);
    res.status(500).json({ error: 'Failed to get shift coverage', code: 'GET_SHIFT_COVERAGE_ERROR' });
  }
});

// ============================================================
// GET /shift-plans/:id — Get single plan by id
// ============================================================
router.get('/shift-plans/:id', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    const row = db.prepare(`
      SELECT sp.*, u.full_name as created_by_name
      FROM shift_plans sp
      LEFT JOIN users u ON sp.created_by = u.id
      WHERE sp.id = ?
    `).get(req.params.id) as any;

    if (!row) {
      res.status(404).json({ error: 'Shift plan not found', code: 'SHIFT_PLAN_NOT_FOUND' });
      return;
    }

    res.json(parseAssignments(row));
  } catch (error: any) {
    console.error('Get shift plan error:', error);
    res.status(500).json({ error: 'Failed to get shift plan', code: 'GET_SHIFT_PLAN_ERROR' });
  }
});

// ============================================================
// POST /shift-plans — Create or upsert a shift plan
// ============================================================
router.post('/shift-plans', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id, name, date, shiftType, assignments, status, createdAt, updatedAt } = req.body;

    if (!id || !name || !date) {
      res.status(400).json({ error: 'id, name, and date are required', code: 'MISSING_FIELDS' });
      return;
    }

    // Validate date format
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(date)) {
      res.status(400).json({ error: 'date must be in YYYY-MM-DD format', code: 'INVALID_DATE_FORMAT' });
      return;
    }

    // Input sanitization
    const cleanName = typeof name === 'string' ? name.trim() : name;

    const now = localNow();
    const assignmentsJson = assignments ? JSON.stringify(assignments) : '[]';

    // Check if plan with this id already exists (upsert)
    const existing = db.prepare('SELECT id FROM shift_plans WHERE id = ?').get(id) as any;

    if (existing) {
      // Update existing plan
      db.prepare(`
        UPDATE shift_plans
        SET name = ?, date = ?, shift_type = ?, assignments = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(
        name,
        date,
        shiftType || 'day',
        assignmentsJson,
        status || 'draft',
        updatedAt || now,
        id,
      );

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'shift_plan_updated', 'shift_plan', ?, ?, ?)
      `).run(req.user!.userId, id, `Updated shift plan: ${name}`, req.ip || 'unknown');
    } else {
      // Insert new plan
      db.prepare(`
        INSERT INTO shift_plans (id, name, date, shift_type, assignments, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        name,
        date,
        shiftType || 'day',
        assignmentsJson,
        status || 'draft',
        req.user!.userId,
        createdAt || now,
        updatedAt || now,
      );

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'shift_plan_created', 'shift_plan', ?, ?, ?)
      `).run(req.user!.userId, id, `Created shift plan: ${name}`, req.ip || 'unknown');
    }

    const plan = db.prepare(`
      SELECT sp.*, u.full_name as created_by_name
      FROM shift_plans sp
      LEFT JOIN users u ON sp.created_by = u.id
      WHERE sp.id = ?
    `).get(id) as any;

    res.status(existing ? 200 : 201).json(parseAssignments(plan));
  } catch (error: any) {
    console.error('Create/upsert shift plan error:', error);
    res.status(500).json({ error: 'Failed to create/upsert shift plan', code: 'CREATEUPSERT_SHIFT_PLAN_ERROR' });
  }
});

// ============================================================
// PUT /shift-plans/:id — Update a shift plan
// ============================================================
router.put('/shift-plans/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM shift_plans WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Shift plan not found', code: 'SHIFT_PLAN_NOT_FOUND' });
      return;
    }

    const fields = ['name', 'date', 'shift_type', 'assignments', 'status'];
    const bodyKeys = Object.keys(req.body);
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const f of fields) {
      if (bodyKeys.includes(f)) {
        setClauses.push(`${f} = ?`);
        let val = req.body[f];
        if (f === 'assignments' && typeof val !== 'string') {
          val = JSON.stringify(val);
        }
        values.push(val === '' ? null : val ?? null);
      }
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' });
      return;
    }

    setClauses.push('updated_at = ?');
    values.push(localNow());
    values.push(req.params.id);

    db.prepare(`UPDATE shift_plans SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'shift_plan_updated', 'shift_plan', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Updated shift plan: ${existing.name}`, req.ip || 'unknown');

    const updated = db.prepare(`
      SELECT sp.*, u.full_name as created_by_name
      FROM shift_plans sp
      LEFT JOIN users u ON sp.created_by = u.id
      WHERE sp.id = ?
    `).get(req.params.id) as any;

    res.json(parseAssignments(updated));
  } catch (error: any) {
    console.error('Update shift plan error:', error);
    res.status(500).json({ error: 'Failed to update shift plan', code: 'UPDATE_SHIFT_PLAN_ERROR' });
  }
});

// ============================================================
// DELETE /shift-plans/:id — Admin/manager only: delete a shift plan
// ============================================================
router.delete('/shift-plans/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM shift_plans WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Shift plan not found', code: 'SHIFT_PLAN_NOT_FOUND' });
      return;
    }

    db.prepare('DELETE FROM shift_plans WHERE id = ?').run(req.params.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'shift_plan_deleted', 'shift_plan', ?, ?, ?)
    `).run(req.user!.userId, existing.id, `Deleted shift plan: ${existing.name}`, req.ip || 'unknown');

    res.json({ message: 'Shift plan deleted' });
  } catch (error: any) {
    console.error('Delete shift plan error:', error);
    res.status(500).json({ error: 'Failed to delete shift plan', code: 'DELETE_SHIFT_PLAN_ERROR' });
  }
});

// ============================================================
// POST /shift-plans/:id/activate — Activate a plan, deactivate others for same date
// ============================================================
router.post('/shift-plans/:id/activate', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM shift_plans WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Shift plan not found', code: 'SHIFT_PLAN_NOT_FOUND' });
      return;
    }

    const now = localNow();

    // Set all other plans for the same date back to 'draft'
    db.prepare(`
      UPDATE shift_plans SET status = 'draft', updated_at = ?
      WHERE date = ? AND id != ? AND status = 'active'
    `).run(now, existing.date, req.params.id);

    // Activate the target plan
    db.prepare(`
      UPDATE shift_plans SET status = 'active', updated_at = ?
      WHERE id = ?
    `).run(now, req.params.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'shift_plan_activated', 'shift_plan', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Activated shift plan: ${existing.name} for ${existing.date}`, req.ip || 'unknown');

    const updated = db.prepare(`
      SELECT sp.*, u.full_name as created_by_name
      FROM shift_plans sp
      LEFT JOIN users u ON sp.created_by = u.id
      WHERE sp.id = ?
    `).get(req.params.id) as any;

    res.json(parseAssignments(updated));
  } catch (error: any) {
    console.error('Activate shift plan error:', error);
    res.status(500).json({ error: 'Failed to activate shift plan', code: 'ACTIVATE_SHIFT_PLAN_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// UPGRADE BATCH — Shift Plans Enhancements
// ═══════════════════════════════════════════════════════════════

function initSwapTable(): void {
  const db = getDb();
  db.prepare(`CREATE TABLE IF NOT EXISTS shift_swap_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL, requester_name TEXT,
    target_id INTEGER, target_name TEXT,
    plan_id TEXT, shift_date TEXT NOT NULL,
    original_shift TEXT, requested_shift TEXT,
    reason TEXT, status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by INTEGER, reviewed_by_name TEXT,
    reviewed_at TEXT, review_notes TEXT,
    created_at TEXT NOT NULL
  )`).run();
}
try { initSwapTable(); } catch { /* ok */ }

// U31: Shift Swap Requests
router.get('/shift-swaps', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    try { initSwapTable(); } catch { /* ok */ }
    const db = getDb();
    const { status, date } = req.query;
    let sql = 'SELECT * FROM shift_swap_requests WHERE 1=1';
    const params: any[] = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (date) { sql += ' AND shift_date = ?'; params.push(date); }
    sql += ' ORDER BY created_at DESC LIMIT 200';
    res.json(db.prepare(sql).all(...params));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load shift swaps', code: 'SHIFT_SWAPS_ERROR' });
  }
});

router.post('/shift-swaps', (req: Request, res: Response) => {
  try {
    try { initSwapTable(); } catch { /* ok */ }
    const db = getDb();
    const { target_id, plan_id, shift_date, original_shift, requested_shift, reason } = req.body;
    if (!shift_date) return res.status(400).json({ error: 'shift_date required', code: 'MISSING_FIELDS' });
    const requesterName = (db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any)?.full_name || '';
    const targetName = target_id ? ((db.prepare('SELECT full_name FROM users WHERE id = ?').get(target_id) as any)?.full_name || '') : null;
    const result = db.prepare(`INSERT INTO shift_swap_requests (requester_id, requester_name, target_id, target_name, plan_id, shift_date, original_shift, requested_shift, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(req.user!.userId, requesterName, target_id || null, targetName, plan_id || null, shift_date, original_shift || null, requested_shift || null, reason || null, localNow());
    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create shift swap', code: 'SHIFT_SWAP_CREATE_ERROR' });
  }
});

router.put('/shift-swaps/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, review_notes } = req.body;
    if (!['approved', 'denied'].includes(status)) return res.status(400).json({ error: 'status must be approved or denied', code: 'INVALID_STATUS' });
    const reviewerName = (db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any)?.full_name || '';
    db.prepare('UPDATE shift_swap_requests SET status = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_notes = ? WHERE id = ?').run(status, req.user!.userId, reviewerName, localNow(), review_notes || null, req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update swap', code: 'SHIFT_SWAP_UPDATE_ERROR' });
  }
});

// U32: Shift Overtime Calculations
router.get('/shift-overtime', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const start = (req.query.week_start as string) || localToday();
    const endDate = new Date(new Date(start).getTime() + 7 * 86400000).toISOString().split('T')[0];
    const plans = db.prepare(`SELECT * FROM shift_plans WHERE date BETWEEN ? AND ? AND status = 'active' ORDER BY date`).all(start, endDate) as any[];

    const officerHours: Record<string, { name: string; total_hours: number; shifts: number; dates: string[] }> = {};
    for (const plan of plans) {
      let assignments: any[] = [];
      try { assignments = typeof plan.assignments === 'string' ? JSON.parse(plan.assignments) : (plan.assignments || []); } catch { assignments = []; }
      for (const a of assignments) {
        const key = a.officer_id || a.name || a.call_sign;
        if (!key) continue;
        if (!officerHours[key]) officerHours[key] = { name: a.name || a.officer_name || String(key), total_hours: 0, shifts: 0, dates: [] };
        officerHours[key].total_hours += (a.hours || 8);
        officerHours[key].shifts += 1;
        if (!officerHours[key].dates.includes(plan.date)) officerHours[key].dates.push(plan.date);
      }
    }
    const OT = 40;
    const result = Object.entries(officerHours).map(([id, d]) => ({ officer_key: id, ...d, overtime_hours: Math.max(0, d.total_hours - OT), is_overtime: d.total_hours > OT })).sort((a, b) => b.total_hours - a.total_hours);
    res.json({ week_start: start, week_end: endDate, officers: result, overtime_threshold: OT });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to calculate overtime', code: 'SHIFT_OVERTIME_ERROR' });
  }
});

// U33: Staffing Level Indicators
router.get('/staffing-levels', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const targetDate = (req.query.date as string) || localToday();
    const minimums: Record<string, number> = {
      day: parseInt(req.query.min_day as string || '2', 10),
      swing: parseInt(req.query.min_swing as string || '2', 10),
      grave: parseInt(req.query.min_grave as string || '1', 10),
    };
    const plans = db.prepare('SELECT * FROM shift_plans WHERE date = ? ORDER BY shift_type').all(targetDate) as any[];
    const levels: any[] = [];
    for (const plan of plans) {
      let assignments: any[] = [];
      try { assignments = typeof plan.assignments === 'string' ? JSON.parse(plan.assignments) : (plan.assignments || []); } catch { assignments = []; }
      const cnt = assignments.length;
      const minR = minimums[plan.shift_type] || 1;
      levels.push({ plan_id: plan.id, plan_name: plan.name, shift_type: plan.shift_type, status: plan.status,
        staff_count: cnt, min_required: minR, max_recommended: minR * 2,
        is_understaffed: cnt < minR, staffing_status: cnt < minR ? 'understaffed' : cnt > minR * 2 ? 'overstaffed' : 'adequate' });
    }
    const coveredTypes = new Set(plans.map((p: any) => p.shift_type));
    for (const [st, min] of Object.entries(minimums)) {
      if (!coveredTypes.has(st)) levels.push({ shift_type: st, status: 'no_plan', staff_count: 0, min_required: min, is_understaffed: true, staffing_status: 'no_coverage' });
    }
    res.json({ date: targetDate, levels, minimums });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load staffing levels', code: 'STAFFING_LEVELS_ERROR' });
  }
});

// U34: Bulk Plan Publishing
router.post('/shift-plans/bulk-activate', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { plan_ids, start_date, end_date } = req.body;
    const now = localNow();
    let activated = 0;
    if (Array.isArray(plan_ids) && plan_ids.length > 0) {
      const ph = plan_ids.map(() => '?').join(',');
      activated = db.prepare(`UPDATE shift_plans SET status = 'active', updated_at = ? WHERE id IN (${ph}) AND status = 'draft'`).run(now, ...plan_ids).changes;
    } else if (start_date && end_date) {
      activated = db.prepare(`UPDATE shift_plans SET status = 'active', updated_at = ? WHERE date BETWEEN ? AND ? AND status = 'draft'`).run(now, start_date, end_date).changes;
    } else {
      return res.status(400).json({ error: 'Provide plan_ids or start_date/end_date', code: 'MISSING_FIELDS' });
    }
    res.json({ success: true, activated_count: activated });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to bulk activate', code: 'BULK_ACTIVATE_ERROR' });
  }
});

// U35: Shift Plan Conflict Detection
router.get('/shift-plans/conflicts/:date', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const plans = db.prepare('SELECT * FROM shift_plans WHERE date = ? ORDER BY shift_type').all(req.params.date) as any[];
    const officerShifts: Record<string, any[]> = {};
    for (const plan of plans) {
      let assignments: any[] = [];
      try { assignments = typeof plan.assignments === 'string' ? JSON.parse(plan.assignments) : (plan.assignments || []); } catch { assignments = []; }
      for (const a of assignments) {
        const key = a.officer_id || a.name;
        if (!key) continue;
        if (!officerShifts[key]) officerShifts[key] = [];
        officerShifts[key].push({ plan_id: plan.id, plan_name: plan.name, shift_type: plan.shift_type, officer_name: a.name || a.officer_name });
      }
    }
    const conflicts = Object.entries(officerShifts).filter(([_, s]) => s.length > 1).map(([o, s]) => ({
      officer_key: o, officer_name: s[0]?.officer_name || o, conflict_type: 'double_booked', shift_count: s.length, shifts: s }));
    res.json({ date: req.params.date, conflicts, total: conflicts.length });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to detect conflicts', code: 'SHIFT_CONFLICTS_ERROR' });
  }
});

// U36: Shift Plan Notifications
router.get('/shift-notifications', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const today = localToday();
    const notifications: any[] = [];

    try {
      initSwapTable();
      const ps = db.prepare("SELECT COUNT(*) as cnt FROM shift_swap_requests WHERE status = 'pending'").get() as any;
      if (ps?.cnt > 0) notifications.push({ type: 'swap_pending', severity: 'info', message: `${ps.cnt} shift swap request(s) pending` });
    } catch { /* ok */ }

    const upcoming = db.prepare(`SELECT date, shift_type, assignments FROM shift_plans WHERE date BETWEEN ? AND date(?, '+7 days') AND status = 'active'`).all(today, today) as any[];
    for (const p of upcoming) {
      let asgn: any[] = [];
      try { asgn = typeof p.assignments === 'string' ? JSON.parse(p.assignments) : (p.assignments || []); } catch { asgn = []; }
      if (asgn.length < 2) notifications.push({ type: 'understaffed', severity: 'warning', message: `${p.date} ${p.shift_type}: Only ${asgn.length} officer(s)`, date: p.date });
    }

    const datesWithPlans = new Set(upcoming.map((p: any) => p.date));
    for (let i = 0; i < 7; i++) {
      const d = new Date(new Date(today).getTime() + i * 86400000).toISOString().split('T')[0];
      if (!datesWithPlans.has(d)) notifications.push({ type: 'no_plan', severity: 'critical', message: `${d}: No active shift plan`, date: d });
    }

    notifications.sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity as string] || 9) - ({ critical: 0, warning: 1, info: 2 }[b.severity as string] || 9));
    res.json({ notifications, total: notifications.length });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load notifications', code: 'SHIFT_NOTIFICATIONS_ERROR' });
  }
});

export default router;
