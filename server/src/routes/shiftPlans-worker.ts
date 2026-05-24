// Shift Plans routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';
import { localNow, localToday } from '../worker-middleware/timeUtils';

function parseAssignments(row: any): any {
  if (!row) return row;
  try {
    row.assignments = typeof row.assignments === 'string' ? JSON.parse(row.assignments) : row.assignments;
  } catch {
    row.assignments = [];
  }
  return row;
}

export function mountShiftPlanRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // ============================================================
  // GET /shift-plans — List all shift plans
  // ============================================================
  api.get('/shift-plans', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { date, status } = q;

      let sql = `
        SELECT sp.*, u.full_name as created_by_name
        FROM shift_plans sp
        LEFT JOIN users u ON sp.created_by = u.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (date) { sql += ' AND sp.date = ?'; params.push(date); }
      if (status) { sql += ' AND sp.status = ?'; params.push(status); }

      sql += ' ORDER BY sp.date DESC, sp.created_at DESC LIMIT 500';

      const rows = await db.prepare(sql).all(...params) as any[];
      const plans = rows.map(parseAssignments);
      return c.json(plans);
    } catch (error: any) {
      console.error('Get shift plans error:', error);
      return c.json({ error: 'Failed to get shift plans', code: 'GET_SHIFT_PLANS_ERROR' }, 500);
    }
  });

  // ============================================================
  // GET /shift-plans/coverage/:date — Active plan assignments for a date
  // ============================================================
  api.get('/shift-plans/coverage/:date', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const date = c.req.param('date');

      const rows = await db.prepare(`
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

      return c.json(allAssignments);
    } catch (error: any) {
      console.error('Get shift coverage error:', error);
      return c.json({ error: 'Failed to get shift coverage', code: 'GET_SHIFT_COVERAGE_ERROR' }, 500);
    }
  });

  // ============================================================
  // GET /shift-plans/:id — Get single plan by id
  // ============================================================
  api.get('/shift-plans/:id', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);

      const row = await db.prepare(`
        SELECT sp.*, u.full_name as created_by_name
        FROM shift_plans sp
        LEFT JOIN users u ON sp.created_by = u.id
        WHERE sp.id = ?
      `).get(c.req.param('id')) as any;

      if (!row) return c.json({ error: 'Shift plan not found', code: 'SHIFT_PLAN_NOT_FOUND' }, 404);

      return c.json(parseAssignments(row));
    } catch (error: any) {
      console.error('Get shift plan error:', error);
      return c.json({ error: 'Failed to get shift plan', code: 'GET_SHIFT_PLAN_ERROR' }, 500);
    }
  });

  // ============================================================
  // POST /shift-plans — Create or upsert a shift plan
  // ============================================================
  api.post('/shift-plans', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { id, name, date, shiftType, assignments, status, createdAt, updatedAt } = body;

      if (!id || !name || !date) return c.json({ error: 'id, name, and date are required', code: 'MISSING_FIELDS' }, 400);

      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(date)) {
        return c.json({ error: 'date must be in YYYY-MM-DD format', code: 'INVALID_DATE_FORMAT' }, 400);
      }

      const validShiftTypes = ['day', 'swing', 'night', 'graveyard', 'custom'];
      if (shiftType && !validShiftTypes.includes(shiftType)) {
        return c.json({ error: `shift_type must be one of: ${validShiftTypes.join(', ')}`, code: 'INVALID_SHIFT_TYPE' }, 400);
      }

      const validPlanStatuses = ['draft', 'active', 'completed', 'cancelled'];
      if (status && !validPlanStatuses.includes(status)) {
        return c.json({ error: `status must be one of: ${validPlanStatuses.join(', ')}`, code: 'INVALID_STATUS' }, 400);
      }

      if (typeof name === 'string' && name.length > 200) {
        return c.json({ error: 'name must be 200 characters or less', code: 'NAME_TOO_LONG' }, 400);
      }

      const cleanName = typeof name === 'string' ? name.trim() : name;
      const now = localNow();
      const assignmentsJson = assignments ? JSON.stringify(assignments) : '[]';

      const existing = await db.prepare('SELECT id FROM shift_plans WHERE id = ?').get(id) as any;

      if (existing) {
        await db.prepare(`
          UPDATE shift_plans
          SET name = ?, date = ?, shift_type = ?, assignments = ?, status = ?, updated_at = ?
          WHERE id = ?
        `).run(name, date, shiftType || 'day', assignmentsJson, status || 'draft', updatedAt || now, id);
      } else {
        await db.prepare(`
          INSERT INTO shift_plans (id, name, date, shift_type, assignments, status, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, name, date, shiftType || 'day', assignmentsJson, status || 'draft', c.get('user').userId, createdAt || now, updatedAt || now);
      }

      const plan = await db.prepare(`
        SELECT sp.*, u.full_name as created_by_name
        FROM shift_plans sp
        LEFT JOIN users u ON sp.created_by = u.id
        WHERE sp.id = ?
      `).get(id) as any;

      return c.json(parseAssignments(plan), existing ? 200 : 201);
    } catch (error: any) {
      console.error('Create/upsert shift plan error:', error);
      return c.json({ error: 'Failed to create/upsert shift plan', code: 'CREATEUPSERT_SHIFT_PLAN_ERROR' }, 500);
    }
  });

  // ============================================================
  // PUT /shift-plans/:id — Update a shift plan
  // ============================================================
  api.put('/shift-plans/:id', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existing = await db.prepare('SELECT * FROM shift_plans WHERE id = ?').get(c.req.param('id')) as any;
      if (!existing) return c.json({ error: 'Shift plan not found', code: 'SHIFT_PLAN_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const fields = ['name', 'date', 'shift_type', 'assignments', 'status'];
      const bodyKeys = Object.keys(body);
      const setClauses: string[] = [];
      const values: any[] = [];

      // Accept camelCase shiftType from client
      if (bodyKeys.includes('shiftType') && !bodyKeys.includes('shift_type')) {
        body.shift_type = body.shiftType;
        bodyKeys.push('shift_type');
      }

      for (const f of fields) {
        if (bodyKeys.includes(f)) {
          setClauses.push(`${f} = ?`);
          let val = body[f];
          if (f === 'assignments' && typeof val !== 'string') {
            val = JSON.stringify(val);
          }
          values.push(val === '' ? null : val ?? null);
        }
      }

      if (setClauses.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' }, 400);

      setClauses.push('updated_at = ?');
      values.push(localNow());
      values.push(c.req.param('id'));

      await db.prepare(`UPDATE shift_plans SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

      const updated = await db.prepare(`
        SELECT sp.*, u.full_name as created_by_name
        FROM shift_plans sp
        LEFT JOIN users u ON sp.created_by = u.id
        WHERE sp.id = ?
      `).get(c.req.param('id')) as any;

      return c.json(parseAssignments(updated));
    } catch (error: any) {
      console.error('Update shift plan error:', error);
      return c.json({ error: 'Failed to update shift plan', code: 'UPDATE_SHIFT_PLAN_ERROR' }, 500);
    }
  });

  // ============================================================
  // DELETE /shift-plans/:id — Admin/manager only: delete a shift plan
  // ============================================================
  api.delete('/shift-plans/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existing = await db.prepare('SELECT * FROM shift_plans WHERE id = ?').get(c.req.param('id')) as any;
      if (!existing) return c.json({ error: 'Shift plan not found', code: 'SHIFT_PLAN_NOT_FOUND' }, 404);

      await db.prepare('DELETE FROM shift_plans WHERE id = ?').run(c.req.param('id'));
      return c.json({ message: 'Shift plan deleted' });
    } catch (error: any) {
      console.error('Delete shift plan error:', error);
      return c.json({ error: 'Failed to delete shift plan', code: 'DELETE_SHIFT_PLAN_ERROR' }, 500);
    }
  });

  // ============================================================
  // POST /shift-plans/:id/activate — Activate a plan, deactivate others for same date
  // ============================================================
  api.post('/shift-plans/:id/activate', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existing = await db.prepare('SELECT * FROM shift_plans WHERE id = ?').get(c.req.param('id')) as any;
      if (!existing) return c.json({ error: 'Shift plan not found', code: 'SHIFT_PLAN_NOT_FOUND' }, 404);

      const now = localNow();

      await db.prepare(`
        UPDATE shift_plans SET status = 'draft', updated_at = ?
        WHERE date = ? AND id != ? AND status = 'active'
      `).run(now, existing.date, c.req.param('id'));

      await db.prepare(`
        UPDATE shift_plans SET status = 'active', updated_at = ?
        WHERE id = ?
      `).run(now, c.req.param('id'));

      const updated = await db.prepare(`
        SELECT sp.*, u.full_name as created_by_name
        FROM shift_plans sp
        LEFT JOIN users u ON sp.created_by = u.id
        WHERE sp.id = ?
      `).get(c.req.param('id')) as any;

      return c.json(parseAssignments(updated));
    } catch (error: any) {
      console.error('Activate shift plan error:', error);
      return c.json({ error: 'Failed to activate shift plan', code: 'ACTIVATE_SHIFT_PLAN_ERROR' }, 500);
    }
  });

  // ============================================================
  // POST /shift-plans/bulk-activate — Bulk Plan Publishing
  // ============================================================
  api.post('/shift-plans/bulk-activate', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { plan_ids, start_date, end_date } = body;
      const now = localNow();
      let activated = 0;
      if (Array.isArray(plan_ids) && plan_ids.length > 0) {
        const ph = plan_ids.map(() => '?').join(',');
        const result = await db.prepare(`UPDATE shift_plans SET status = 'active', updated_at = ? WHERE id IN (${ph}) AND status = 'draft'`).run(now, ...plan_ids);
        activated = result.meta.changes;
      } else if (start_date && end_date) {
        const result = await db.prepare(`UPDATE shift_plans SET status = 'active', updated_at = ? WHERE date BETWEEN ? AND ? AND status = 'draft'`).run(now, start_date, end_date);
        activated = result.meta.changes;
      } else {
        return c.json({ error: 'Provide plan_ids or start_date/end_date', code: 'MISSING_FIELDS' }, 400);
      }
      return c.json({ success: true, activated_count: activated });
    } catch (error: any) {
      return c.json({ error: 'Failed to bulk activate', code: 'BULK_ACTIVATE_ERROR' }, 500);
    }
  });

  // ============================================================
  // GET /shift-plans/conflicts/:date — Shift Plan Conflict Detection
  // ============================================================
  api.get('/shift-plans/conflicts/:date', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const plans = await db.prepare('SELECT * FROM shift_plans WHERE date = ? ORDER BY shift_type').all(c.req.param('date')) as any[];
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
      return c.json({ date: c.req.param('date'), conflicts, total: conflicts.length });
    } catch (error: any) {
      return c.json({ error: 'Failed to detect conflicts', code: 'SHIFT_CONFLICTS_ERROR' }, 500);
    }
  });

  // ============================================================
  // GET /shift-plans/export/csv — Shift Plans CSV Export
  // ============================================================
  api.get('/shift-plans/export/csv', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT sp.name, sp.date, sp.shift_type, sp.status,
               u.full_name as created_by_name, sp.created_at
        FROM shift_plans sp
        LEFT JOIN users u ON sp.created_by = u.id
        ORDER BY sp.date DESC
        LIMIT 10000
      `).all() as any[];
      const headers = ['Plan Name', 'Date', 'Shift Type', 'Status', 'Created By', 'Created At'];
      const csv = [
        headers.join(','),
        ...rows.map((r: any) => [
          (r.name || '').replace(/"/g, '""'),
          r.date, r.shift_type, r.status,
          (r.created_by_name || '').replace(/"/g, '""'),
          r.created_at
        ].map(v => `"${v || ''}"`).join(','))
      ].join('\n');
      c.header('Content-Type', 'text/csv');
      c.header('Content-Disposition', `attachment; filename="shift_plans_export_${new Date().toISOString().slice(0, 10)}.csv"`);
      return c.body(csv);
    } catch (error: any) {
      console.error('Shift plans CSV export error:', error);
      return c.json({ error: 'Failed to export shift plans', code: 'SHIFT_PLANS_EXPORT_ERROR' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // UPGRADE BATCH — Shift Plans Enhancements
  // ═══════════════════════════════════════════════════════════════

  // U31: Shift Swap Requests
  api.get('/shift-swaps', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      // Ensure table exists
      await db.exec(`CREATE TABLE IF NOT EXISTS shift_swap_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_id INTEGER NOT NULL, requester_name TEXT,
        target_id INTEGER, target_name TEXT,
        plan_id TEXT, shift_date TEXT NOT NULL,
        original_shift TEXT, requested_shift TEXT,
        reason TEXT, status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by INTEGER, reviewed_by_name TEXT,
        reviewed_at TEXT, review_notes TEXT,
        created_at TEXT NOT NULL
      )`);
      const q = c.req.query();
      const { status, date } = q;
      let sql = 'SELECT * FROM shift_swap_requests WHERE 1=1';
      const params: any[] = [];
      if (status) { sql += ' AND status = ?'; params.push(status); }
      if (date) { sql += ' AND shift_date = ?'; params.push(date); }
      sql += ' ORDER BY created_at DESC LIMIT 200';
      return c.json(await db.prepare(sql).all(...params));
    } catch (error: any) {
      return c.json({ error: 'Failed to load shift swaps', code: 'SHIFT_SWAPS_ERROR' }, 500);
    }
  });

  api.post('/shift-swaps', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      await db.exec(`CREATE TABLE IF NOT EXISTS shift_swap_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_id INTEGER NOT NULL, requester_name TEXT,
        target_id INTEGER, target_name TEXT,
        plan_id TEXT, shift_date TEXT NOT NULL,
        original_shift TEXT, requested_shift TEXT,
        reason TEXT, status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by INTEGER, reviewed_by_name TEXT,
        reviewed_at TEXT, review_notes TEXT,
        created_at TEXT NOT NULL
      )`);
      const body = await c.req.json();
      const { target_id, plan_id, shift_date, original_shift, requested_shift, reason } = body;
      if (!shift_date) return c.json({ error: 'shift_date required', code: 'MISSING_FIELDS' }, 400);
      const user = c.get('user');
      const requesterName = (await db.prepare('SELECT full_name FROM users WHERE id = ?').get(user.userId) as any)?.full_name || '';
      const targetName = target_id ? ((await db.prepare('SELECT full_name FROM users WHERE id = ?').get(target_id) as any)?.full_name || '') : null;
      const result = await db.prepare(`INSERT INTO shift_swap_requests (requester_id, requester_name, target_id, target_name, plan_id, shift_date, original_shift, requested_shift, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(user.userId, requesterName, target_id || null, targetName, plan_id || null, shift_date, original_shift || null, requested_shift || null, reason || null, localNow());
      return c.json({ success: true, id: result.meta.last_row_id }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to create shift swap', code: 'SHIFT_SWAP_CREATE_ERROR' }, 500);
    }
  });

  api.put('/shift-swaps/:id', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { status, review_notes } = body;
      if (!['approved', 'denied'].includes(status)) return c.json({ error: 'status must be approved or denied', code: 'INVALID_STATUS' }, 400);
      const user = c.get('user');
      const reviewerName = (await db.prepare('SELECT full_name FROM users WHERE id = ?').get(user.userId) as any)?.full_name || '';
      await db.prepare('UPDATE shift_swap_requests SET status = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_notes = ? WHERE id = ?').run(status, user.userId, reviewerName, localNow(), review_notes || null, c.req.param('id'));
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to update swap', code: 'SHIFT_SWAP_UPDATE_ERROR' }, 500);
    }
  });

  // U32: Shift Overtime Calculations
  api.get('/shift-overtime', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const start = (c.req.query('week_start') as string) || localToday();
      const endDate = new Date(new Date(start).getTime() + 7 * 86400000).toISOString().split('T')[0];
      const plans = await db.prepare(`SELECT * FROM shift_plans WHERE date BETWEEN ? AND ? AND status = 'active' ORDER BY date`).all(start, endDate) as any[];

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
      return c.json({ week_start: start, week_end: endDate, officers: result, overtime_threshold: OT });
    } catch (error: any) {
      return c.json({ error: 'Failed to calculate overtime', code: 'SHIFT_OVERTIME_ERROR' }, 500);
    }
  });

  // U33: Staffing Level Indicators
  api.get('/staffing-levels', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const targetDate = (c.req.query('date') as string) || localToday();
      const minimums: Record<string, number> = {
        day: parseInt(c.req.query('min_day') as string || '2', 10),
        swing: parseInt(c.req.query('min_swing') as string || '2', 10),
        grave: parseInt(c.req.query('min_grave') as string || '1', 10),
      };
      const plans = await db.prepare('SELECT * FROM shift_plans WHERE date = ? ORDER BY shift_type').all(targetDate) as any[];
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
      return c.json({ date: targetDate, levels, minimums });
    } catch (error: any) {
      return c.json({ error: 'Failed to load staffing levels', code: 'STAFFING_LEVELS_ERROR' }, 500);
    }
  });

  // U36: Shift Plan Notifications
  api.get('/shift-notifications', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const today = localToday();
      const notifications: any[] = [];

      try {
        await db.exec(`CREATE TABLE IF NOT EXISTS shift_swap_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          requester_id INTEGER NOT NULL, requester_name TEXT,
          target_id INTEGER, target_name TEXT,
          plan_id TEXT, shift_date TEXT NOT NULL,
          original_shift TEXT, requested_shift TEXT,
          reason TEXT, status TEXT NOT NULL DEFAULT 'pending',
          reviewed_by INTEGER, reviewed_by_name TEXT,
          reviewed_at TEXT, review_notes TEXT,
          created_at TEXT NOT NULL
        )`);
        const ps = await db.prepare("SELECT COUNT(*) as cnt FROM shift_swap_requests WHERE status = 'pending'").get() as any;
        if (ps?.cnt > 0) notifications.push({ type: 'swap_pending', severity: 'info', message: `${ps.cnt} shift swap request(s) pending` });
      } catch { /* ok */ }

      const upcoming = await db.prepare(`SELECT date, shift_type, assignments FROM shift_plans WHERE date BETWEEN ? AND date(?, '+7 days') AND status = 'active'`).all(today, today) as any[];
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
      return c.json({ notifications, total: notifications.length });
    } catch (error: any) {
      return c.json({ error: 'Failed to load notifications', code: 'SHIFT_NOTIFICATIONS_ERROR' }, 500);
    }
  });

  app.route('/api/admin', api);
}
