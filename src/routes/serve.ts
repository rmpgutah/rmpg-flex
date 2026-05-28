// ============================================================
// RMPG Flex — Process Service Operations (Cloudflare Worker)
// ============================================================
// Officer-facing serve workflow on top of serve_queue / serve_attempts
// / serve_routes (defined by migration 0030_serve_intake.sql, ensured
// by 0033_serve_ensure.sql).
//
// Relationship to serveIntake (PR #625):
//   - /api/serve-intake = data layer + structured intake (creating
//     queue entries from parsed documents)
//   - /api/serve        = officer-facing daily workflow (routing,
//     attempts, deadlines, priority queue, success rates)
//   Both routes touch the same tables; the split mirrors legacy.
//
// Endpoints (15 MVP):
//   GET    /linked-statuses          status enum + counts
//   GET    /stats/summary
//   GET    /                         list queue (rich filters)
//   POST   /                         create queue entry (alias of intake POST)
//   GET    /:id
//   PUT    /:id
//   POST   /:id/attempt              richer than intake's variant (gps + invalidation)
//   POST   /:id/substitute-service   substitute-service attempt shortcut
//   GET    /:id/gps-trail            attempt locations as a polyline-ready array
//   GET    /routes/:date             active route for officer+date
//   POST   /routes                   create/update route plan
//   PUT    /reorder                  bulk sort_order update
//   GET    /priority-queue           urgent-first triage feed
//   GET    /deadlines                approaching-deadline list
//   GET    /success-rates            per-officer success aggregations
//   GET    /export/csv               admin/manager
//
// Deferred (depend on external integrations / infra not yet ported):
//   - sync-from-sm / push-status     (ServeManager API client)
//   - auto-skip-trace                (third-party skip-trace vendor)
//   - affidavit                      (PDF rendering — pdfTools container)
//   - create-invoice-item            (QuickBooks / ServeManager billing)
//   - notify-completion              (email/SMS fan-out)
//   - route-map                      (Mapbox render endpoint)
//   - cost-estimate                  (config-driven pricing tables)
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const sv = new Hono<Env>();

// ── Helpers ─────────────────────────────────────────────────

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
}

const WRITE = ['admin', 'manager', 'supervisor', 'officer'];
const READ = [...WRITE, 'dispatcher'];

const STATUSES = new Set(['pending', 'assigned', 'in_progress', 'served', 'attempted', 'failed', 'cancelled']);
const ATTEMPT_RESULTS = new Set([
  'served', 'sub_served', 'posted', 'no_answer', 'refused',
  'bad_address', 'moved', 'deceased', 'other',
]);

// ─────────────────────────────────────────────────────────────
// Static paths first (BEFORE /:id)
// ─────────────────────────────────────────────────────────────

// GET /linked-statuses
sv.get('/linked-statuses', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const rows = await query<{ status: string; n: number }>(
    getDb(c.env), 'SELECT status, COUNT(*) AS n FROM serve_queue GROUP BY status',
  );
  return c.json({ statuses: [...STATUSES], counts: rows });
});

// GET /stats/summary
sv.get('/stats/summary', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const total = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM serve_queue');
  const pending = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM serve_queue WHERE status='pending'");
  const served = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM serve_queue WHERE status='served'");
  const failed = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM serve_queue WHERE status='failed'");
  const overdue = await queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM serve_queue
       WHERE deadline IS NOT NULL AND deadline < datetime('now','localtime')
         AND status NOT IN ('served','cancelled','failed')`,
  );
  return c.json({
    total: total?.n ?? 0, pending: pending?.n ?? 0,
    served: served?.n ?? 0, failed: failed?.n ?? 0, overdue: overdue?.n ?? 0,
  });
});

// GET /routes/:date  (specific path before /:id catches "routes")
sv.get('/routes/:date', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const date = c.req.param('date');
  const officerId = c.req.query('officer_id');
  const args: any[] = [date];
  let sql = 'SELECT * FROM serve_routes WHERE route_date = ?';
  if (officerId) { sql += ' AND officer_id = ?'; args.push(parseInt(officerId, 10)); }
  sql += ' ORDER BY id DESC LIMIT 50';
  return c.json(await query(getDb(c.env), sql, ...args));
});

// POST /routes
sv.post('/routes', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  const user = c.get('user') as { id: number } | undefined;
  const officerId = body.officer_id ?? user?.id;
  if (!officerId) return c.json({ error: 'officer_id required' }, 400);
  const r = await execute(
    getDb(c.env),
    `INSERT INTO serve_routes (
       officer_id, route_date, optimized_order_json, waypoints_json,
       total_distance_miles, total_time_minutes,
       start_lat, start_lng, end_lat, end_lng, notes
     ) VALUES (?,?,?,?, ?,?, ?,?,?,?, ?)`,
    officerId, body.route_date ?? null,
    JSON.stringify(body.optimized_order ?? []),
    JSON.stringify(body.waypoints ?? []),
    body.total_distance_miles ?? null, body.total_time_minutes ?? null,
    body.start_lat ?? null, body.start_lng ?? null,
    body.end_lat ?? null, body.end_lng ?? null,
    body.notes ?? null,
  );
  return c.json({ success: true, id: r.meta.last_row_id }, 201);
});

// PUT /reorder — bulk sort_order update for drag-and-drop UIs
sv.put('/reorder', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<{ items?: { id: number; sort_order: number }[] }>()
    .catch(() => ({} as { items?: { id: number; sort_order: number }[] }));
  if (!Array.isArray(body.items) || !body.items.length) {
    return c.json({ error: 'items array required' }, 400);
  }
  const db = getDb(c.env);
  // D1 doesn't support transactions across multiple .run() calls in
  // a single batch the same way as better-sqlite3; use db.batch().
  await db.batch(body.items.map((it) => db.prepare(
    "UPDATE serve_queue SET sort_order = ?, updated_at = datetime('now','localtime') WHERE id = ?",
  ).bind(it.sort_order, it.id)));
  return c.json({ success: true, updated: body.items.length });
});

// GET /priority-queue — urgent first, then rush, then deadline-ascending
sv.get('/priority-queue', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const officerId = c.req.query('officer_id');
  const where: string[] = ["status NOT IN ('served','cancelled','failed')"];
  const args: any[] = [];
  if (officerId) { where.push('officer_id = ?'); args.push(parseInt(officerId, 10)); }
  const sql = `SELECT * FROM serve_queue
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE priority WHEN 'urgent' THEN 1 WHEN 'rush' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
      deadline IS NULL, deadline ASC, sort_order ASC, id ASC
    LIMIT 100`;
  return c.json(await query(getDb(c.env), sql, ...args));
});

// GET /deadlines — approaching-deadline triage view
sv.get('/deadlines', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const days = parseInt(c.req.query('days') || '7', 10);
  const sql = `SELECT * FROM serve_queue
    WHERE deadline IS NOT NULL
      AND deadline <= datetime('now','localtime','+' || ? || ' days')
      AND status NOT IN ('served','cancelled','failed')
    ORDER BY deadline ASC LIMIT 200`;
  return c.json(await query(getDb(c.env), sql, days));
});

// GET /success-rates — per-officer success aggregations
sv.get('/success-rates', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const rows = await query<{ officer_id: number; full_name: string; total: number; served: number; failed: number }>(
    getDb(c.env),
    `SELECT u.id AS officer_id, u.full_name,
            COUNT(q.id) AS total,
            SUM(CASE WHEN q.status='served' THEN 1 ELSE 0 END) AS served,
            SUM(CASE WHEN q.status='failed' THEN 1 ELSE 0 END) AS failed
       FROM serve_queue q LEFT JOIN users u ON u.id = q.officer_id
       WHERE q.officer_id IS NOT NULL
       GROUP BY q.officer_id, u.full_name
       ORDER BY total DESC LIMIT 100`,
  );
  return c.json({
    officers: rows.map((r) => ({
      ...r,
      success_pct: r.total ? Math.round((r.served / r.total) * 10000) / 100 : 0,
    })),
  });
});

// GET /export/csv
sv.get('/export/csv', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied }, 403);
  const rows = await query<any>(
    getDb(c.env),
    `SELECT id, status, priority, recipient_name, recipient_address, recipient_city,
            recipient_state, document_type, case_number, deadline, attempt_count, officer_id, created_at
       FROM serve_queue ORDER BY id DESC LIMIT 10000`,
  );
  const headers = ['id', 'status', 'priority', 'recipient_name', 'recipient_address',
    'recipient_city', 'recipient_state', 'document_type', 'case_number', 'deadline',
    'attempt_count', 'officer_id', 'created_at'];
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(','));
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="serve_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

// ─────────────────────────────────────────────────────────────
// Core queue CRUD (overlaps with serveIntake — intentional)
// ─────────────────────────────────────────────────────────────

sv.get('/', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const status = c.req.query('status');
  const officerId = c.req.query('officer_id');
  const priority = c.req.query('priority');
  const search = c.req.query('q');
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 500);
  const where: string[] = [];
  const args: any[] = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (officerId) { where.push('officer_id = ?'); args.push(parseInt(officerId, 10)); }
  if (priority) { where.push('priority = ?'); args.push(priority); }
  if (search) {
    where.push('(recipient_name LIKE ? OR case_number LIKE ? OR recipient_address LIKE ?)');
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const sql = `SELECT q.*, u.full_name AS officer_name
    FROM serve_queue q LEFT JOIN users u ON u.id = q.officer_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY
      CASE q.priority WHEN 'urgent' THEN 1 WHEN 'rush' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
      q.deadline IS NULL, q.deadline ASC, q.sort_order ASC, q.id DESC LIMIT ?`;
  args.push(limit);
  return c.json(await query(db, sql, ...args));
});

sv.post('/', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  if (!body.recipient_name && !body.recipient_address) {
    return c.json({ error: 'recipient_name or recipient_address required' }, 400);
  }
  const priority = body.priority ?? 'normal';
  const status = body.status && STATUSES.has(body.status) ? body.status : 'pending';
  const r = await execute(
    getDb(c.env),
    `INSERT INTO serve_queue (
       call_id, sm_job_id, officer_id, serve_date,
       recipient_name, recipient_person_id, recipient_address, recipient_city,
       recipient_state, recipient_zip, recipient_lat, recipient_lng, property_id,
       document_type, case_number, court_name, jurisdiction,
       client_name, attorney_name, priority, time_window, deadline,
       max_attempts, service_instructions, notes, status
     ) VALUES (?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?)`,
    body.call_id ?? null, body.sm_job_id ?? null, body.officer_id ?? null, body.serve_date ?? null,
    body.recipient_name ?? null, body.recipient_person_id ?? null, body.recipient_address ?? null, body.recipient_city ?? null,
    body.recipient_state ?? null, body.recipient_zip ?? null, body.recipient_lat ?? null, body.recipient_lng ?? null, body.property_id ?? null,
    body.document_type ?? null, body.case_number ?? null, body.court_name ?? null, body.jurisdiction ?? null,
    body.client_name ?? null, body.attorney_name ?? null, priority, body.time_window ?? null, body.deadline ?? null,
    body.max_attempts ?? 3, body.service_instructions ?? null, body.notes ?? null, status,
  );
  return c.json({ success: true, id: r.meta.last_row_id }, 201);
});

sv.get('/:id', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const row = await queryFirst<any>(
    db,
    `SELECT q.*, u.full_name AS officer_name
       FROM serve_queue q LEFT JOIN users u ON u.id = q.officer_id WHERE q.id = ?`,
    id,
  );
  if (!row) return c.json({ error: 'Not found' }, 404);
  const attempts = await query(
    db,
    `SELECT a.*, u.full_name AS officer_name
       FROM serve_attempts a LEFT JOIN users u ON u.id = a.officer_id
       WHERE a.serve_queue_id = ? ORDER BY a.attempt_at DESC`,
    id,
  );
  return c.json({ ...row, attempts });
});

sv.put('/:id', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const allowed = [
    'call_id', 'sm_job_id', 'officer_id', 'serve_date',
    'recipient_name', 'recipient_person_id', 'recipient_address', 'recipient_city',
    'recipient_state', 'recipient_zip', 'recipient_lat', 'recipient_lng', 'property_id',
    'document_type', 'case_number', 'court_name', 'jurisdiction',
    'client_name', 'attorney_name', 'priority', 'time_window', 'deadline',
    'max_attempts', 'service_instructions', 'notes', 'status', 'sort_order',
  ];
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of allowed) {
    if (!(k in body)) continue;
    if (k === 'status' && body[k] && !STATUSES.has(body[k])) continue;
    sets.push(`${k} = ?`);
    args.push(body[k]);
  }
  if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
  sets.push("updated_at = datetime('now','localtime')");
  args.push(id);
  await execute(getDb(c.env), `UPDATE serve_queue SET ${sets.join(', ')} WHERE id = ?`, ...args);
  return c.json({ success: true });
});

// ─────────────────────────────────────────────────────────────
// Attempts — richer than the intake variant (gps + photo refs)
// ─────────────────────────────────────────────────────────────

async function logAttempt(c: any, defaultResult: string) {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as any;
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);

  const queue = await queryFirst<{ attempt_count: number; max_attempts: number; status: string }>(
    db, 'SELECT attempt_count, max_attempts, status FROM serve_queue WHERE id = ?', id,
  );
  if (!queue) return c.json({ error: 'Queue entry not found' }, 404);

  const result = ATTEMPT_RESULTS.has(body.result) ? body.result : defaultResult;
  const nextNum = (queue.attempt_count ?? 0) + 1;

  // Live serve_attempts has no `status` column (migration 0030 drift —
  // never applied to 785de7ae). It's redundant with `result` + the
  // serve_queue.status update below, so omit it. See
  // [[feedback-verify-live-schema-before-insert]].
  const ins = await execute(
    db,
    `INSERT INTO serve_attempts (
       serve_queue_id, attempt_number, officer_id, result,
       latitude, longitude, notes, attempt_type, photo_ids, signature_data
     ) VALUES (?,?,?,?, ?,?,?,?, ?,?)`,
    id, nextNum, body.officer_id ?? user?.id ?? null, result,
    body.latitude ?? null, body.longitude ?? null, body.notes ?? null,
    body.attempt_type ?? null,
    JSON.stringify(body.photo_ids ?? []), body.signature_data ?? null,
  );

  let newStatus = queue.status;
  if (result === 'served' || result === 'sub_served') newStatus = 'served';
  else if (nextNum >= (queue.max_attempts ?? 3)) newStatus = 'failed';
  else newStatus = 'attempted';

  await execute(
    db,
    `UPDATE serve_queue SET attempt_count = ?, status = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    nextNum, newStatus, id,
  );
  return c.json({ success: true, id: ins.meta.last_row_id, attempt_number: nextNum, queue_status: newStatus });
}

sv.post('/:id/attempt', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  return logAttempt(c, 'other');
});

// Substitute service shortcut: forces result='sub_served', sets attempt_type='substitute'
sv.post('/:id/substitute-service', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  // Clone request with overrides — Hono's c.req.json() consumes the body once,
  // so we read it here and re-attach via a synthesized handler.
  const body = await c.req.json<any>().catch(() => ({}));
  body.result = 'sub_served';
  body.attempt_type = body.attempt_type ?? 'substitute';
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);
  const queue = await queryFirst<{ attempt_count: number; max_attempts: number }>(
    db, 'SELECT attempt_count, max_attempts FROM serve_queue WHERE id = ?', id,
  );
  if (!queue) return c.json({ error: 'Queue entry not found' }, 404);
  const nextNum = (queue.attempt_count ?? 0) + 1;
  // No `status` column on live serve_attempts (see logAttempt note above).
  const ins = await execute(
    db,
    `INSERT INTO serve_attempts (
       serve_queue_id, attempt_number, officer_id, result,
       latitude, longitude, notes, attempt_type, photo_ids, signature_data
     ) VALUES (?,?,?, 'sub_served', ?,?,?, ?, ?,?)`,
    id, nextNum, body.officer_id ?? user?.id ?? null,
    body.latitude ?? null, body.longitude ?? null, body.notes ?? null,
    body.attempt_type, JSON.stringify(body.photo_ids ?? []), body.signature_data ?? null,
  );
  await execute(
    db,
    `UPDATE serve_queue SET attempt_count = ?, status = 'served', updated_at = datetime('now','localtime') WHERE id = ?`,
    nextNum, id,
  );
  return c.json({ success: true, id: ins.meta.last_row_id, attempt_number: nextNum });
});

// GET /:id/gps-trail — attempts ordered chronologically, drop ones missing coords
sv.get('/:id/gps-trail', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const rows = await query<{ attempt_at: string; latitude: number | null; longitude: number | null; result: string }>(
    getDb(c.env),
    `SELECT attempt_at, latitude, longitude, result FROM serve_attempts
       WHERE serve_queue_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY attempt_at ASC`,
    id,
  );
  return c.json({
    trail: rows,
    polyline: rows.map((r) => [r.longitude, r.latitude]),  // GeoJSON [lng,lat] order
  });
});

export default sv;
