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
import { getDb, query, queryFirst, execute, executeInChunks } from '../utils/db';
import { authMiddleware } from '../middleware/auth';
// No dynamic-import precedent exists elsewhere in this router (checked via
// `grep -n "await import(" src/routes/shiftPlans.ts` — zero hits), so a
// normal static import is used here per the task brief's fallback guidance.
import { evaluateNotificationRules } from './notificationEngine';

const sp = new Hono<Env>();

// Per-shift-type staffing minimums, shared by GET /staffing-levels and
// GET /shift-notifications so the two surfaces never disagree on what
// counts as understaffed (a graveyard shift needs only 1 officer; day/
// swing need 2). GET /staffing-levels allows overriding these via query
// params — that override is local to that handler and doesn't affect
// this shared default.
export const SHIFT_STAFFING_MINIMUMS: Record<string, number> = { day: 2, swing: 2, graveyard: 1 };

// Auth is enforced INSIDE the router instead of via the registry's
// per-prefix loop. The router mounts at the bare `/api` prefix so it
// can serve `/api/shift-plans/*`, `/api/shift-swaps/*`, etc. under a
// single mount — but `auth: 'required'` in the registry would cause
// the loop in `src/index.ts` to register `app.use('/api/*',
// authMiddleware)`, blanket-blocking every public route including
// `/api/auth/login` (see PR #627 incident). Same pattern the geocode
// router uses post-#627: register here, mark the registry entry
// `auth: 'public'`.
//
// ⚠️  Scope this to the exact sub-paths this router owns — NOT `'*'`.
// A router-internal `sp.use('*', mw)` merges through `app.route('/api',
// sp)` into the parent app's route table as a genuinely global
// `/api/*` pattern (same blanket-block #627 was about, just registered
// from this call site instead of index.ts — see geocode.ts's matching
// comment for the Hono internals). Because this router mounts before
// other bare-`/api` public routers (mobileCfs, downloads, stubs'
// diagnostics/updates mounts), a bare `'*'` here silently 401'd all of
// them (found 2026-07-18 wiring mobile rate limiting — see
// test-workers/mobileAuthRouting.test.ts). List every literal path +
// its `/*` glob (Hono's glob doesn't match the bare path — same
// gotcha documented in routesConfig.ts's file header).
sp.use('/shift-plans', authMiddleware);
sp.use('/shift-plans/*', authMiddleware);
sp.use('/shift-swaps', authMiddleware);
sp.use('/shift-swaps/*', authMiddleware);
sp.use('/admin/shift-swaps', authMiddleware);
sp.use('/shift-overtime', authMiddleware);
sp.use('/staffing-levels', authMiddleware);
sp.use('/shift-notifications', authMiddleware);

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

// Every shift-swap status transition writes one row to the existing
// generic activity_log table (migrations/0001_initial.sql) rather than a
// new dedicated audit table -- entity_type='shift_swap_request' lets a
// future "history for this swap" view query
// activity_log WHERE entity_type = 'shift_swap_request' AND entity_id = ?
// with no new schema.
async function writeSwapActivityLog(
  db: ReturnType<typeof getDb>,
  actorUserId: number,
  action: string,
  swapId: number,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await execute(
      db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, 'shift_swap_request', ?, ?, datetime('now'))`,
      actorUserId, action, swapId, JSON.stringify(details),
    );
  } catch { /* audit-log failure must never block the swap action */ }
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
    // plan_ids is caller-supplied and unbounded, so the query's SHAPE grows with
    // the request: a bulk-activate of 100+ plans exceeds D1's 100-bound-parameter
    // cap and throws at BIND time, before the statement runs. Passes every test
    // and every small activation, then fails on exactly the big batch that
    // matters most.
    activated = await executeInChunks(db, body.plan_ids,
      (ph) => `UPDATE shift_plans SET status = 'active', updated_at = datetime('now')
         WHERE id IN (${ph}) AND status = 'draft'`);
  } else if (body.start_date && body.end_date) {
    const r = await execute(
      db,
      `UPDATE shift_plans SET status = 'active', updated_at = datetime('now')
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
    `UPDATE shift_plans SET status = 'draft', updated_at = datetime('now')
       WHERE date = ? AND id != ? AND status = 'active'`,
    existing.date, id,
  );
  await execute(
    db,
    `UPDATE shift_plans SET status = 'active', updated_at = datetime('now') WHERE id = ?`,
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

// GET /shift-plans/templates — list reusable shift pattern templates
// Registered before /shift-plans/:id so this literal path isn't shadowed by the param route.
sp.get('/shift-plans/templates', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const rows = await query<any>(db, 'SELECT * FROM shift_plan_templates ORDER BY name ASC');
  for (const r of rows) {
    try { r.pattern = typeof r.pattern_json === 'string' ? JSON.parse(r.pattern_json) : (r.pattern_json || []); }
    catch { r.pattern = []; }
  }
  return c.json({ count: rows.length, data: rows });
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
             updated_at = COALESCE(?, datetime('now'))
         WHERE id = ?`,
      cleanName, date, shiftType || 'day', assignmentsJson, status || 'draft', updatedAt ?? null, id,
    );
  } else {
    await execute(
      db,
      `INSERT INTO shift_plans (id, name, date, shift_type, assignments, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?, ?,
               COALESCE(?, datetime('now')),
               COALESCE(?, datetime('now')))`,
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
  sets.push("updated_at = datetime('now')");
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

// GET /api/shift-swaps and GET /api/admin/shift-swaps — same query, two
// mount points. Client's ShiftPlansPage currently hits /api/admin/shift-swaps;
// keep both registered until the client is converged on one path. Sharing
// a handler so the two never drift apart.
async function listShiftSwaps(c: any) {
  const status = c.req.query('status');
  const date = c.req.query('date');
  const where: string[] = [];
  const args: any[] = [];
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher');
  if (denied) {
    // Non-elevated callers (e.g. plain officers) don't get a blanket 403 —
    // they can still see swaps where they're the requester or the target,
    // which is exactly the data the client's accept/decline modal needs.
    const user = c.get('user');
    if (!user) return c.json({ error: denied }, 403);
    where.push('(requester_id = ? OR target_id = ?)');
    args.push(user.id, user.id);
  }
  if (status) { where.push('status = ?'); args.push(status); }
  if (date) { where.push('shift_date = ?'); args.push(date); }
  const sql = `SELECT * FROM shift_swap_requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at DESC LIMIT 200`;
  return c.json(await query(getDb(c.env), sql, ...args));
}
sp.get('/shift-swaps', listShiftSwaps);
sp.get('/admin/shift-swaps', listShiftSwaps);

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
       shift_date, original_shift, requested_shift, reason, status, created_at
     ) VALUES (?,?,?,?,?, ?,?,?,?,'pending', datetime('now'))`,
    user.id, user.full_name ?? null, body.target_id ?? null, targetName,
    body.plan_id ?? null, body.shift_date, body.original_shift ?? null,
    body.requested_shift ?? null, body.reason ?? null,
  );

  const swapId = Number(r.meta.last_row_id);

  await writeSwapActivityLog(db, user.id, 'swap_requested', swapId, { shift_date: body.shift_date, target_id: body.target_id ?? null });

  try {
    await evaluateNotificationRules(db, 'shift_swap_requested', {
      title: 'Shift swap requested',
      message: `${user.full_name ?? 'An officer'} requested a swap for ${body.shift_date}`,
      priority: 'normal',
      entity_type: 'shift_swap_request',
      entity_id: swapId,
    }, c.env);
  } catch { /* notification failure must never block the swap request */ }

  return c.json({ success: true, id: swapId }, 201);
});

sp.post('/shift-swaps/:id/respond', async (c) => {
  const user = c.get('user') as { id: number; full_name?: string } | undefined;
  if (!user) return c.json({ error: 'Unauthenticated' }, 401);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<{ accept?: boolean }>().catch(() => ({} as { accept?: boolean }));
  if (typeof body.accept !== 'boolean') {
    return c.json({ error: 'accept (boolean) is required' }, 400);
  }
  const db = getDb(c.env);

  const swap = await queryFirst<{
    requester_id: number; target_id: number | null; target_name: string | null;
    shift_date: string; status: string;
  }>(
    db,
    'SELECT requester_id, target_id, target_name, shift_date, status FROM shift_swap_requests WHERE id = ?',
    id,
  );
  if (!swap) return c.json({ error: 'Shift swap request not found' }, 404);
  if (swap.target_id === null) {
    return c.json({ error: 'This swap has no target officer to respond' }, 400);
  }
  if (swap.target_id !== user.id) {
    return c.json({ error: 'Only the target officer can respond to this swap' }, 403);
  }
  if (swap.status !== 'pending') {
    return c.json({ error: 'This swap is not awaiting a response' }, 400);
  }

  if (body.accept) {
    await execute(
      db,
      `UPDATE shift_swap_requests SET status = 'pending_supervisor', target_responded_at = datetime('now') WHERE id = ?`,
      id,
    );
    await writeSwapActivityLog(db, user.id, 'swap_target_accepted', id, { shift_date: swap.shift_date });
    try {
      await evaluateNotificationRules(db, 'shift_swap_target_accepted', {
        title: 'Shift swap accepted — ready for review',
        message: `${swap.target_name ?? 'The target officer'} accepted a swap for ${swap.shift_date}`,
        priority: 'normal',
        entity_type: 'shift_swap_request',
        entity_id: id,
      }, c.env);
    } catch { /* notification failure must never block the response */ }
  } else {
    const declineNote = `${swap.target_name ?? 'The target officer'} declined the swap`;
    await execute(
      db,
      `UPDATE shift_swap_requests SET status = 'denied', target_responded_at = datetime('now'), review_notes = ? WHERE id = ?`,
      declineNote, id,
    );
    await writeSwapActivityLog(db, user.id, 'swap_target_rejected', id, { shift_date: swap.shift_date });
    try {
      await evaluateNotificationRules(db, 'shift_swap_denied', {
        title: 'Shift swap denied',
        message: `Your swap request for ${swap.shift_date} was declined by the target officer`,
        priority: 'normal',
        entity_type: 'shift_swap_request',
        entity_id: id,
      }, c.env, [swap.requester_id]);
    } catch { /* notification failure must never block the response */ }
  }

  return c.json({ success: true });
});

sp.post('/shift-swaps/:id/cancel', async (c) => {
  const user = c.get('user') as { id: number; full_name?: string } | undefined;
  if (!user) return c.json({ error: 'Unauthenticated' }, 401);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);

  const swap = await queryFirst<{ requester_id: number; shift_date: string; status: string }>(
    db,
    'SELECT requester_id, shift_date, status FROM shift_swap_requests WHERE id = ?',
    id,
  );
  if (!swap) return c.json({ error: 'Shift swap request not found' }, 404);
  if (swap.requester_id !== user.id) {
    return c.json({ error: 'Only the requester can cancel this swap' }, 403);
  }
  if (swap.status !== 'pending' && swap.status !== 'pending_supervisor') {
    return c.json({ error: `Cannot cancel a swap in status '${swap.status}'` }, 400);
  }

  await execute(db, `UPDATE shift_swap_requests SET status = 'cancelled' WHERE id = ?`, id);
  await writeSwapActivityLog(db, user.id, 'swap_cancelled', id, { shift_date: swap.shift_date });

  return c.json({ success: true });
});

sp.put('/shift-swaps/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  if (!['approved', 'denied'].includes(body.status)) {
    return c.json({ error: 'status must be approved or denied' }, 400);
  }
  const user = c.get('user') as { id: number; full_name?: string } | undefined;
  const db = getDb(c.env);

  const swap = await queryFirst<{ requester_id: number | null; target_id: number | null; shift_date: string; status: string }>(
    db,
    'SELECT requester_id, target_id, shift_date, status FROM shift_swap_requests WHERE id = ?',
    id,
  );
  if (!swap) return c.json({ error: 'Shift swap request not found' }, 404);
  if (swap.target_id !== null && swap.status === 'pending') {
    return c.json({ error: "This swap is awaiting the target officer's response" }, 400);
  }
  if (swap.status !== 'pending' && swap.status !== 'pending_supervisor') {
    return c.json({ error: `Cannot review a swap in status '${swap.status}'` }, 400);
  }

  await execute(
    db,
    `UPDATE shift_swap_requests SET status = ?, reviewed_by = ?, reviewed_by_name = ?,
       reviewed_at = datetime('now'), review_notes = ?
     WHERE id = ?`,
    body.status, user?.id ?? null, user?.full_name ?? null, body.review_notes ?? null, id,
  );

  await writeSwapActivityLog(db, user?.id ?? 0, `swap_${body.status}`, id, { shift_date: swap.shift_date, review_notes: body.review_notes ?? null });

  try {
    const dynamicTargets = [swap.requester_id, swap.target_id]
      .filter((x): x is number => typeof x === 'number');
    await evaluateNotificationRules(db, `shift_swap_${body.status}`, {
      title: body.status === 'approved' ? 'Shift swap approved' : 'Shift swap denied',
      message: `Your swap request for ${swap.shift_date} was ${body.status}`,
      priority: 'normal',
      entity_type: 'shift_swap_request',
      entity_id: id,
    }, c.env, dynamicTargets);
  } catch { /* notification failure must never block the swap review */ }

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
    day: parseInt(c.req.query('min_day') || String(SHIFT_STAFFING_MINIMUMS.day), 10),
    swing: parseInt(c.req.query('min_swing') || String(SHIFT_STAFFING_MINIMUMS.swing), 10),
    graveyard: parseInt(c.req.query('min_grave') || String(SHIFT_STAFFING_MINIMUMS.graveyard), 10),
  };
  const plans = await query<any>(getDb(c.env), 'SELECT * FROM shift_plans WHERE date = ? ORDER BY shift_type', targetDate);
  const levels: any[] = [];
  for (const plan of plans) {
    let assignments: any[] = [];
    try { assignments = typeof plan.assignments === 'string' ? JSON.parse(plan.assignments) : (plan.assignments || []); }
    catch { assignments = []; }
    const cnt = assignments.length;
    // `|| 1` discarded an explicit min of 0 ("no coverage required on this
    // shift"), since 0 is falsy — the same falsy-zero bug as the citation
    // warning multiplier. `??` alone would let a NaN from a junk query param
    // through, so the guard is an explicit finite check.
    const configured = minimums[plan.shift_type];
    const minR = Number.isFinite(configured) ? configured : 1;
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
    const minRequired = SHIFT_STAFFING_MINIMUMS[p.shift_type] ?? 1;
    if (asgn.length < minRequired) {
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

// ─────────────────────────────────────────────────────────────
// Shift Plan Templates
// ─────────────────────────────────────────────────────────────

// POST /shift-plans/templates — create a new template
sp.post('/shift-plans/templates', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const user = c.get('user') as { id: number } | undefined;
  const body = await c.req.json<any>().catch(() => ({}));
  if (!body.name) return c.json({ error: 'name is required' }, 400);
  const db = getDb(c.env);
  const result = await execute(
    db,
    `INSERT INTO shift_plan_templates (name, description, shift_type, pattern_json, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    body.name, body.description ?? null, body.shift_type ?? 'day',
    JSON.stringify(body.pattern ?? []), user?.id ?? null,
  );
  const created = await queryFirst<any>(db, 'SELECT * FROM shift_plan_templates WHERE id = ?', result.meta.last_row_id);
  if (created) {
    try { created.pattern = JSON.parse(created.pattern_json); } catch { created.pattern = []; }
  }
  return c.json({ data: created }, 201);
});

// POST /shift-plans/apply-template/:templateId — apply a template to a date range
sp.post('/shift-plans/apply-template/:templateId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const templateId = parseInt(c.req.param('templateId'), 10);
  if (!Number.isFinite(templateId) || templateId < 1) return c.json({ error: 'Invalid template id' }, 400);
  const user = c.get('user') as { id: number } | undefined;
  const body = await c.req.json<{ start_date?: string; end_date?: string; override_name?: string }>().catch(
    () => ({} as { start_date?: string; end_date?: string; override_name?: string }),
  );
  if (!body.start_date || !body.end_date) return c.json({ error: 'start_date and end_date required' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(body.end_date)) {
    return c.json({ error: 'Dates must be YYYY-MM-DD format' }, 400);
  }
  const db = getDb(c.env);
  const template = await queryFirst<any>(db, 'SELECT * FROM shift_plan_templates WHERE id = ?', templateId);
  if (!template) return c.json({ error: 'Template not found' }, 404);

  let pattern: any[] = [];
  try { pattern = typeof template.pattern_json === 'string' ? JSON.parse(template.pattern_json) : (template.pattern_json || []); }
  catch { pattern = []; }

  const start = new Date(body.start_date);
  const end = new Date(body.end_date);
  const created: number[] = [];
  let dayIdx = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const slot = pattern[dayIdx % pattern.length] || {};
    const existing = await queryFirst<any>(db, 'SELECT id FROM shift_plans WHERE date = ? AND shift_type = ? AND status = ?', dateStr, template.shift_type, 'draft');
    if (existing) continue;

    const planName = body.override_name
      ? `${body.override_name} (${dateStr})`
      : `${template.name} (${dateStr})`;

    const assignments = slot.assignments || [];
    const result = await execute(
      db,
      `INSERT INTO shift_plans (id, name, date, shift_type, assignments, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
      `${template.shift_type}_${dateStr}_${Date.now()}`, planName, dateStr,
      template.shift_type, JSON.stringify(assignments), user?.id ?? null,
    );
    created.push(Number(result.meta.last_row_id));
    dayIdx++;
  }

  return c.json({
    success: true,
    count: created.length,
    template_name: template.name,
    date_range: { start: body.start_date, end: body.end_date },
  });
});

export default sp;
