// ============================================================
// RMPG Flex — Shift Plans (Cloudflare Worker)
// ============================================================
// Daily shift roster planning + swap requests + overtime/staffing
// analytics. Full Phase 1 port — 1:1 feature parity with legacy.
//
// Migration: 0031_shift_plans.sql.
//
// Mount: /api (router owns sub-paths /shift-plans/*, /shift-swaps/*,
// /shift-overtime, /staffing-levels, /shift-notifications). Mounting
// at /api preserves the legacy URL contract that the React client
// already calls.
//
// Hono trie ordering note: more-specific /shift-plans paths
// (/coverage/:date, /export/csv, /conflicts/:date, /bulk-activate)
// are declared BEFORE /shift-plans/:id so the static segment wins.
// Hono trie does prefer literals over params, but explicit ordering
// is the safer contract for future maintainers.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const sp = new Hono<Env>();

// ── Helpers ─────────────────────────────────────────────────

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

function parseAssignments<T extends { assignments?: string | unknown[] }>(row: T): T {
  if (!row) return row;
  try {
    (row as any).assignments = typeof row.assignments === 'string'
      ? JSON.parse(row.assignments)
      : (row.assignments ?? []);
  } catch {
    (row as any).assignments = [];
  }
  return row;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
}

const SHIFT_TYPES = new Set(['day', 'swing', 'night', 'graveyard', 'custom']);
const PLAN_STATUSES = new Set(['draft', 'active', 'completed', 'cancelled']);

// ─────────────────────────────────────────────────────────────
// Static + specific paths FIRST (before /shift-plans/:id)
// ─────────────────────────────────────────────────────────────

// GET /shift-plans/coverage/:date
sp.get('/shift-plans/coverage/:date', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);
  const date = c.req.param('date');
  const db = getDb(c.env);
  const rows = await query<{ plan_id: string; plan_name: string; shift_type: string; assignments: string }>(
    db,
    `SELECT id AS plan_id, name AS plan_name, shift_type, assignments
       FROM shift_plans
       WHERE date = ? AND status = 'active'
       ORDER BY shift_type LIMIT 1000`,
    date,
  );
  const all: any[] = [];
  for (const r of rows) {
    let assignments: any[] = [];
    try { assignments = typeof r.assignments === 'string' ? JSON.parse(r.assignments) : (r.assignments || []); }
    catch { assignments = []; }
    for (const a of assignments) {
      all.push({ ...a, plan_id: r.plan_id, plan_name: r.plan_name, shift_type: r.shift_type });
    }
  }
  return c.json(all);
});

// GET /shift-plans/conflicts/:date
sp.get('/shift-plans/conflicts/:date', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);
  const date = c.req.param('date');
  const db = getDb(c.env);
  const plans = await query<any>(db, 'SELECT * FROM shift_plans WHERE date = ? ORDER BY shift_type', date);
  const officerShifts: Record<string, any[]> = {};
  for (const plan of plans) {
    let assignments: any[] = [];
    try { assignments = typeof plan.assignments === 'string' ? JSON.parse(plan.assignments) : (plan.assignments || []); }
    catch { assignments = []; }
    for (const a of assignments) {
      const key = a.officer_id || a.name;
      if (!key) continue;
      (officerShifts[key] ??= []).push({
        plan_id: plan.id, plan_name: plan.name, shift_type: plan.shift_type,
        officer_name: a.name || a.officer_name,
      });
    }
  }
  const conflicts = Object.entries(officerShifts)
    .filter(([, s]) => s.length > 1)
    .map(([o, s]) => ({
      officer_key: o, officer_name: s[0]?.officer_name || o,
      conflict_type: 'double_booked', shift_count: s.length, shifts: s,
    }));
  return c.json({ date, conflicts, total: conflicts.length });
});

// POST /shift-plans/bulk-activate
sp.post('/shift-plans/bulk-activate', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<{ plan_ids?: string[]; start_date?: string; end_date?: string }>()
    .catch(() => ({} as { plan_ids?: string[]; start_date?: string; end_date?: string }));
  const db = getDb(c.env);
  let activated = 0;
  if (Array.isArray(body.plan_ids) && body.plan_ids.length > 0) {
    const ph = body.plan_ids.map(() => '?').join(',');
    const r = await execute(
      db,
      `UPDATE shift_plans SET status = 'active', updated_at = datetime('now','localtime')
         WHERE id IN (${ph}) AND status = 'draft'`,
      ...body.plan_ids,
    );
    activated = (r.meta as any).changes ?? 0;
  } else if (body.start_date && body.end_date) {
    const r = await execute(
      db,
      `UPDATE shift_plans SET status = 'active', updated_at = datetime('now','localtime')
         WHERE date BETWEEN ? AND ? AND status = 'draft'`,
      body.start_date, body.end_date,
    );
    activated = (r.meta as any).changes ?? 0;
  } else {
    return c.json({ error: 'Provide plan_ids or start_date/end_date' }, 400);
  }
  return c.json({ success: true, activated_count: activated });
});

// GET /shift-plans/export/csv
sp.get('/shift-plans/export/csv', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const rows = await query<any>(
    db,
    `SELECT sp.name, sp.date, sp.shift_type, sp.status,
            u.full_name AS created_by_name, sp.created_at
       FROM shift_plans sp LEFT JOIN users u ON sp.created_by = u.id
       ORDER BY sp.date DESC LIMIT 10000`,
  );
  const headers = ['Plan Name', 'Date', 'Shift Type', 'Status', 'Created By', 'Created At'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([r.name, r.date, r.shift_type, r.status, r.created_by_name, r.created_at]
      .map(csvEscape).join(','));
  }
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="shift_plans_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

// POST /shift-plans/:id/activate
sp.post('/shift-plans/:id/activate', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = c.req.param('id');
  const db = getDb(c.env);
  const existing = await queryFirst<{ date: string }>(db, 'SELECT date FROM shift_plans WHERE id = ?', id);
  if (!existing) return c.json({ error: 'Shift plan not found' }, 404);

  // Demote every other active plan for the same date.
  await execute(
    db,
    `UPDATE shift_plans SET status = 'draft', updated_at = datetime('now','localtime')
       WHERE date = ? AND id != ? AND status = 'active'`,
    existing.date, id,
  );
  await execute(
    db,
    `UPDATE shift_plans SET status = 'active', updated_at = datetime('now','localtime') WHERE id = ?`,
    id,
  );
  const updated = await queryFirst<any>(
    db,
    `SELECT sp.*, u.full_name AS created_by_name
       FROM shift_plans sp LEFT JOIN users u ON sp.created_by = u.id
       WHERE sp.id = ?`,
    id,
  );
  return c.json(parseAssignments(updated));
});

// ─────────────────────────────────────────────────────────────
// Core /shift-plans CRUD
// ─────────────────────────────────────────────────────────────

sp.get('/shift-plans', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);
  const date = c.req.query('date');
  const status = c.req.query('status');
  const where: string[] = [];
  const args: any[] = [];
  if (date) { where.push('sp.date = ?'); args.push(date); }
  if (status) { where.push('sp.status = ?'); args.push(status); }
  const sql = `
    SELECT sp.*, u.full_name AS created_by_name
      FROM shift_plans sp LEFT JOIN users u ON sp.created_by = u.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY sp.date DESC, sp.created_at DESC LIMIT 500`;
  const rows = await query<any>(getDb(c.env), sql, ...args);
  return c.json(rows.map(parseAssignments));
});

sp.get('/shift-plans/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);
  const row = await queryFirst<any>(
    getDb(c.env),
    `SELECT sp.*, u.full_name AS created_by_name
       FROM shift_plans sp LEFT JOIN users u ON sp.created_by = u.id
       WHERE sp.id = ?`,
    c.req.param('id'),
  );
  if (!row) return c.json({ error: 'Shift plan not found' }, 404);
  return c.json(parseAssignments(row));
});

// POST /shift-plans — upsert (client supplies the id)
sp.post('/shift-plans', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);

  const { id, name, date, shiftType, assignments, status, createdAt, updatedAt } = body;
  if (!id || !name || !date) {
    return c.json({ error: 'id, name, and date are required' }, 400);
  }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(date)) {
    return c.json({ error: 'date must be in YYYY-MM-DD format' }, 400);
  }
  if (shiftType && !SHIFT_TYPES.has(shiftType)) {
    return c.json({ error: `shift_type must be one of: ${[...SHIFT_TYPES].join(', ')}` }, 400);
  }
  if (status && !PLAN_STATUSES.has(status)) {
    return c.json({ error: `status must be one of: ${[...PLAN_STATUSES].join(', ')}` }, 400);
  }
  if (typeof name === 'string' && name.length > 200) {
    return c.json({ error: 'name must be 200 characters or less' }, 400);
  }

  const cleanName = typeof name === 'string' ? name.trim() : name;
  const assignmentsJson = assignments ? JSON.stringify(assignments) : '[]';
  const existing = await queryFirst<{ id: string }>(db, 'SELECT id FROM shift_plans WHERE id = ?', id);

  if (existing) {
    await execute(
      db,
      `UPDATE shift_plans
         SET name = ?, date = ?, shift_type = ?, assignments = ?, status = ?,
             updated_at = COALESCE(?, datetime('now','localtime'))
         WHERE id = ?`,
      cleanName, date, shiftType || 'day', assignmentsJson, status || 'draft', updatedAt ?? null, id,
    );
  } else {
    await execute(
      db,
      `INSERT INTO shift_plans (id, name, date, shift_type, assignments, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?, ?,
               COALESCE(?, datetime('now','localtime')),
               COALESCE(?, datetime('now','localtime')))`,
      id, cleanName, date, shiftType || 'day', assignmentsJson, status || 'draft', user?.id ?? null,
      createdAt ?? null, updatedAt ?? null,
    );
  }

  const plan = await queryFirst<any>(
    db,
    `SELECT sp.*, u.full_name AS created_by_name
       FROM shift_plans sp LEFT JOIN users u ON sp.created_by = u.id
       WHERE sp.id = ?`,
    id,
  );
  return c.json(parseAssignments(plan), existing ? 200 : 201);
});

// PUT /shift-plans/:id — partial update, accepts both shiftType & shift_type
sp.put('/shift-plans/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = c.req.param('id');
  const db = getDb(c.env);
  const existing = await queryFirst<any>(db, 'SELECT * FROM shift_plans WHERE id = ?', id);
  if (!existing) return c.json({ error: 'Shift plan not found' }, 404);

  const body = await c.req.json<any>().catch(() => ({}));
  // Legacy bug fix preserved: clients post camelCase shiftType — promote it.
  if ('shiftType' in body && !('shift_type' in body)) body.shift_type = body.shiftType;

  const allowed = ['name', 'date', 'shift_type', 'assignments', 'status'];
  const sets: string[] = [];
  const args: any[] = [];
  for (const f of allowed) {
    if (!(f in body)) continue;
    if (f === 'shift_type' && body[f] && !SHIFT_TYPES.has(body[f])) continue;
    if (f === 'status' && body[f] && !PLAN_STATUSES.has(body[f])) continue;
    let v = body[f];
    if (f === 'assignments' && typeof v !== 'string') v = JSON.stringify(v ?? []);
    sets.push(`${f} = ?`);
    args.push(v === '' ? null : v ?? null);
  }
  if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
  sets.push("updated_at = datetime('now','localtime')");
  args.push(id);
  await execute(db, `UPDATE shift_plans SET ${sets.join(', ')} WHERE id = ?`, ...args);

  const updated = await queryFirst<any>(
    db,
    `SELECT sp.*, u.full_name AS created_by_name
       FROM shift_plans sp LEFT JOIN users u ON sp.created_by = u.id
       WHERE sp.id = ?`,
    id,
  );
  return c.json(parseAssignments(updated));
});

sp.delete('/shift-plans/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied }, 403);
  const id = c.req.param('id');
  const db = getDb(c.env);
  const existing = await queryFirst<{ id: string }>(db, 'SELECT id FROM shift_plans WHERE id = ?', id);
  if (!existing) return c.json({ error: 'Shift plan not found' }, 404);
  await execute(db, 'DELETE FROM shift_plans WHERE id = ?', id);
  return c.json({ message: 'Shift plan deleted' });
});

// ─────────────────────────────────────────────────────────────
// Shift Swaps
// ─────────────────────────────────────────────────────────────

sp.get('/shift-swaps', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);
  const status = c.req.query('status');
  const date = c.req.query('date');
  const where: string[] = [];
  const args: any[] = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (date) { where.push('shift_date = ?'); args.push(date); }
  const sql = `SELECT * FROM shift_swap_requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at DESC LIMIT 200`;
  return c.json(await query(getDb(c.env), sql, ...args));
});

sp.post('/shift-swaps', async (c) => {
  const user = c.get('user') as { id: number; full_name?: string } | undefined;
  if (!user) return c.json({ error: 'Unauthenticated' }, 401);
  const body = await c.req.json<any>().catch(() => ({}));
  if (!body.shift_date) return c.json({ error: 'shift_date required' }, 400);
  const db = getDb(c.env);

  const targetName = body.target_id
    ? (await queryFirst<{ full_name: string }>(db, 'SELECT full_name FROM users WHERE id = ?', body.target_id))?.full_name ?? null
    : null;

  const r = await execute(
    db,
    `INSERT INTO shift_swap_requests (
       requester_id, requester_name, target_id, target_name, plan_id,
       shift_date, original_shift, requested_shift, reason, status
     ) VALUES (?,?,?,?,?, ?,?,?,?,'pending')`,
    user.id, user.full_name ?? null, body.target_id ?? null, targetName,
    body.plan_id ?? null, body.shift_date, body.original_shift ?? null,
    body.requested_shift ?? null, body.reason ?? null,
  );
  return c.json({ success: true, id: r.meta.last_row_id }, 201);
});

sp.put('/shift-swaps/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  if (!['approved', 'denied'].includes(body.status)) {
    return c.json({ error: 'status must be approved or denied' }, 400);
  }
  const user = c.get('user') as { id: number; full_name?: string } | undefined;
  const db = getDb(c.env);
  await execute(
    db,
    `UPDATE shift_swap_requests SET status = ?, reviewed_by = ?, reviewed_by_name = ?,
       reviewed_at = datetime('now','localtime'), review_notes = ?
     WHERE id = ?`,
    body.status, user?.id ?? null, user?.full_name ?? null, body.review_notes ?? null, id,
  );
  return c.json({ success: true });
});

// ─────────────────────────────────────────────────────────────
// Overtime + staffing + notifications
// ─────────────────────────────────────────────────────────────

sp.get('/shift-overtime', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);
  const start = c.req.query('week_start') || new Date().toISOString().slice(0, 10);
  const endDate = new Date(new Date(start).getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const plans = await query<any>(
    getDb(c.env),
    `SELECT * FROM shift_plans WHERE date BETWEEN ? AND ? AND status = 'active' ORDER BY date`,
    start, endDate,
  );

  const officerHours: Record<string, { name: string; total_hours: number; shifts: number; dates: string[] }> = {};
  for (const plan of plans) {
    let assignments: any[] = [];
    try { assignments = typeof plan.assignments === 'string' ? JSON.parse(plan.assignments) : (plan.assignments || []); }
    catch { assignments = []; }
    for (const a of assignments) {
      const key = a.officer_id || a.name || a.call_sign;
      if (!key) continue;
      if (!officerHours[key]) {
        officerHours[key] = { name: a.name || a.officer_name || String(key), total_hours: 0, shifts: 0, dates: [] };
      }
      officerHours[key].total_hours += (a.hours || 8);
      officerHours[key].shifts += 1;
      if (!officerHours[key].dates.includes(plan.date)) officerHours[key].dates.push(plan.date);
    }
  }
  const OT = 40;
  const result = Object.entries(officerHours)
    .map(([id, d]) => ({
      officer_key: id, ...d,
      overtime_hours: Math.max(0, d.total_hours - OT),
      is_overtime: d.total_hours > OT,
    }))
    .sort((a, b) => b.total_hours - a.total_hours);
  return c.json({ week_start: start, week_end: endDate, officers: result, overtime_threshold: OT });
});

sp.get('/staffing-levels', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);
  const targetDate = c.req.query('date') || new Date().toISOString().slice(0, 10);
  const minimums: Record<string, number> = {
    day: parseInt(c.req.query('min_day') || '2', 10),
    swing: parseInt(c.req.query('min_swing') || '2', 10),
    grave: parseInt(c.req.query('min_grave') || '1', 10),
  };
  const plans = await query<any>(getDb(c.env), 'SELECT * FROM shift_plans WHERE date = ? ORDER BY shift_type', targetDate);
  const levels: any[] = [];
  for (const plan of plans) {
    let assignments: any[] = [];
    try { assignments = typeof plan.assignments === 'string' ? JSON.parse(plan.assignments) : (plan.assignments || []); }
    catch { assignments = []; }
    const cnt = assignments.length;
    const minR = minimums[plan.shift_type] || 1;
    levels.push({
      plan_id: plan.id, plan_name: plan.name, shift_type: plan.shift_type, status: plan.status,
      staff_count: cnt, min_required: minR, max_recommended: minR * 2,
      is_understaffed: cnt < minR,
      staffing_status: cnt < minR ? 'understaffed' : cnt > minR * 2 ? 'overstaffed' : 'adequate',
    });
  }
  const coveredTypes = new Set(plans.map((p) => p.shift_type));
  for (const [st, min] of Object.entries(minimums)) {
    if (!coveredTypes.has(st)) {
      levels.push({
        shift_type: st, status: 'no_plan', staff_count: 0, min_required: min,
        is_understaffed: true, staffing_status: 'no_coverage',
      });
    }
  }
  return c.json({ date: targetDate, levels, minimums });
});

sp.get('/shift-notifications', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const today = new Date().toISOString().slice(0, 10);
  const notifications: any[] = [];

  const pendingSwaps = await queryFirst<{ cnt: number }>(
    db,
    "SELECT COUNT(*) AS cnt FROM shift_swap_requests WHERE status = 'pending'",
  );
  if ((pendingSwaps?.cnt ?? 0) > 0) {
    notifications.push({ type: 'swap_pending', severity: 'info', message: `${pendingSwaps!.cnt} shift swap request(s) pending` });
  }

  const upcoming = await query<any>(
    db,
    `SELECT date, shift_type, assignments FROM shift_plans
       WHERE date BETWEEN ? AND date(?, '+7 days') AND status = 'active'`,
    today, today,
  );
  for (const p of upcoming) {
    let asgn: any[] = [];
    try { asgn = typeof p.assignments === 'string' ? JSON.parse(p.assignments) : (p.assignments || []); }
    catch { asgn = []; }
    if (asgn.length < 2) {
      notifications.push({
        type: 'understaffed', severity: 'warning',
        message: `${p.date} ${p.shift_type}: Only ${asgn.length} officer(s)`, date: p.date,
      });
    }
  }

  const datesWithPlans = new Set(upcoming.map((p) => p.date));
  for (let i = 0; i < 7; i++) {
    const d = new Date(new Date(today).getTime() + i * 86400000).toISOString().slice(0, 10);
    if (!datesWithPlans.has(d)) {
      notifications.push({ type: 'no_plan', severity: 'critical', message: `${d}: No active shift plan`, date: d });
    }
  }

  const sevOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  notifications.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));
  return c.json({ notifications, total: notifications.length });
});

export default sp;
