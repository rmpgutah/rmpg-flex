// ============================================================
// RMPG Flex — Process Service Intake (Cloudflare Worker)
// ============================================================
// Civil-paper service tracking: subpoenas, summons, evictions, etc.
// Each row in serve_queue is one paper to deliver; serve_attempts is
// the append-only attempt log. Phase 1 RMS port.
//
// Migration: 0030_serve_intake.sql.
//
// Scope vs legacy /server/routes/serveIntake.ts (1336 LOC):
//   This port covers the data layer + structured-intake CRUD. The
//   legacy file's heavy PDF parser path (extract-text → parse →
//   intake, ~1100 LOC of regex parsers + ServeManager poller + OCR
//   fallback) is deferred. Reason: extraction is now handled by the
//   /api/document-intake + pdfTools container pipeline; the parser
//   port should layer on top of that pipeline rather than re-invent
//   the Node-specific execFile(pdftotext) path.
//
// Endpoints (12):
//   GET    /stats
//   GET    /                       list queue with filters
//   GET    /:id                    one queue entry + attempts
//   POST   /                       create from structured payload
//   PUT    /:id
//   DELETE /:id                    admin/manager only
//   GET    /:id/attempts
//   POST   /:id/attempts           log attempt; bumps attempt_count
//   POST   /:id/skip-trace         log address search
//   GET    /routes                 list officer routes
//   POST   /routes
//   GET    /export.csv             admin/manager export
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const si = new Hono<Env>();

// ── Helpers ─────────────────────────────────────────────────

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  const s = typeof v === 'string' ? v : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

const PRIORITIES = new Set(['routine', 'normal', 'rush', 'urgent']);
const STATUSES = new Set(['pending', 'assigned', 'in_progress', 'served', 'attempted', 'failed', 'cancelled']);
const ATTEMPT_RESULTS = new Set([
  'served', 'sub_served', 'posted', 'no_answer', 'refused',
  'bad_address', 'moved', 'deceased', 'other',
]);

// ── GET /stats ──────────────────────────────────────────────
si.get('/stats', async (c) => {
  const db = getDb(c.env);
  const total = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM serve_queue');
  const pending = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM serve_queue WHERE status='pending'");
  const inProgress = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM serve_queue WHERE status IN ('assigned','in_progress','attempted')");
  const served = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM serve_queue WHERE status='served'");
  const overdue = await queryFirst<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM serve_queue WHERE deadline IS NOT NULL AND deadline < datetime('now','localtime') AND status NOT IN ('served','cancelled','failed')",
  );
  return c.json({
    total: total?.n ?? 0,
    pending: pending?.n ?? 0,
    in_progress: inProgress?.n ?? 0,
    served: served?.n ?? 0,
    overdue: overdue?.n ?? 0,
  });
});

// ── GET / — list with filters ───────────────────────────────
si.get('/', async (c) => {
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
  const sql = `
    SELECT q.*, u.full_name AS officer_name
    FROM serve_queue q
    LEFT JOIN users u ON u.id = q.officer_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY
      CASE q.priority WHEN 'urgent' THEN 1 WHEN 'rush' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
      q.deadline IS NULL, q.deadline ASC, q.id DESC
    LIMIT ?`;
  args.push(limit);
  const rows = await query(db, sql, ...args);
  return c.json(rows);
});

// ── GET /:id ────────────────────────────────────────────────
si.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const row = await queryFirst<any>(
    db,
    `SELECT q.*, u.full_name AS officer_name
     FROM serve_queue q LEFT JOIN users u ON u.id = q.officer_id
     WHERE q.id = ?`,
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

// ── POST / — structured intake (no PDF parsing here) ────────
si.post('/', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  const db = getDb(c.env);

  const priority = PRIORITIES.has(body.priority) ? body.priority : 'normal';
  const status = STATUSES.has(body.status) ? body.status : 'pending';

  if (!body.recipient_name && !body.recipient_address) {
    return c.json({ error: 'recipient_name or recipient_address required' }, 400);
  }

  const result = await execute(
    db,
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
  return c.json({ success: true, id: result.meta.last_row_id });
});

// ── PUT /:id ────────────────────────────────────────────────
si.put('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const db = getDb(c.env);

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
    if (k === 'priority' && body[k] && !PRIORITIES.has(body[k])) continue;
    if (k === 'status' && body[k] && !STATUSES.has(body[k])) continue;
    sets.push(`${k} = ?`);
    args.push(body[k]);
  }
  if (!sets.length) return c.json({ error: 'No fields to update' }, 400);
  sets.push("updated_at = datetime('now','localtime')");
  args.push(id);
  await execute(db, `UPDATE serve_queue SET ${sets.join(', ')} WHERE id = ?`, ...args);
  return c.json({ success: true });
});

// ── DELETE /:id — admin/manager only ────────────────────────
si.delete('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  await execute(db, 'DELETE FROM serve_queue WHERE id = ?', id);
  return c.json({ success: true });
});

// ── GET /:id/attempts ───────────────────────────────────────
si.get('/:id/attempts', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const rows = await query(
    db,
    `SELECT a.*, u.full_name AS officer_name
     FROM serve_attempts a LEFT JOIN users u ON u.id = a.officer_id
     WHERE a.serve_queue_id = ? ORDER BY a.attempt_at DESC`,
    id,
  );
  return c.json(rows);
});

// ── POST /:id/attempts — log + auto-bump counters ───────────
// On 'served' the queue entry promotes to status='served'. On other
// results, attempt_count increments and status flips to 'attempted'
// (or 'failed' once max_attempts is exceeded).
si.post('/:id/attempts', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);

  const queue = await queryFirst<{ attempt_count: number; max_attempts: number; status: string }>(
    db,
    'SELECT attempt_count, max_attempts, status FROM serve_queue WHERE id = ?',
    id,
  );
  if (!queue) return c.json({ error: 'Queue entry not found' }, 404);

  const result = ATTEMPT_RESULTS.has(body.result) ? body.result : 'other';
  const nextNum = (queue.attempt_count || 0) + 1;

  const ins = await execute(
    db,
    `INSERT INTO serve_attempts (
      serve_queue_id, attempt_number, officer_id, result,
      latitude, longitude, notes, attempt_type, photo_ids, signature_data, status
    ) VALUES (?,?,?,?, ?,?,?,?, ?,?,?)`,
    id, nextNum, body.officer_id ?? user?.id ?? null, result,
    body.latitude ?? null, body.longitude ?? null, body.notes ?? null,
    body.attempt_type ?? null,
    JSON.stringify(body.photo_ids ?? []), body.signature_data ?? null,
    result === 'served' ? 'served' : 'attempted',
  );

  let newStatus = queue.status;
  if (result === 'served') newStatus = 'served';
  else if (nextNum >= (queue.max_attempts || 3)) newStatus = 'failed';
  else newStatus = 'attempted';

  await execute(
    db,
    `UPDATE serve_queue SET attempt_count = ?, status = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    nextNum, newStatus, id,
  );

  return c.json({ success: true, id: ins.meta.last_row_id, attempt_number: nextNum, queue_status: newStatus });
});

// ── POST /:id/skip-trace ────────────────────────────────────
si.post('/:id/skip-trace', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<any>().catch(() => ({}));
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);

  const r = await execute(
    db,
    `INSERT INTO serve_skip_traces (
      serve_queue_id, search_type, search_query, results_json, addresses_found_json, searched_by
    ) VALUES (?,?,?,?,?,?)`,
    id, body.search_type ?? 'manual', body.search_query ?? null,
    body.results_json ? JSON.stringify(body.results_json) : null,
    JSON.stringify(body.addresses_found ?? []),
    user?.id ?? null,
  );
  return c.json({ success: true, id: r.meta.last_row_id });
});

// ── GET /routes ─────────────────────────────────────────────
si.get('/routes', async (c) => {
  const db = getDb(c.env);
  const officerId = c.req.query('officer_id');
  const date = c.req.query('date');
  const where: string[] = [];
  const args: any[] = [];
  if (officerId) { where.push('officer_id = ?'); args.push(parseInt(officerId, 10)); }
  if (date) { where.push('route_date = ?'); args.push(date); }
  const sql = `SELECT * FROM serve_routes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY route_date DESC, id DESC LIMIT 200`;
  const rows = await query(db, sql, ...args);
  return c.json(rows);
});

// ── POST /routes ────────────────────────────────────────────
si.post('/routes', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'dispatcher', 'officer');
  if (denied) return c.json({ error: denied }, 403);
  const body = await c.req.json<any>().catch(() => ({}));
  const user = c.get('user') as { id: number } | undefined;
  if (!body.officer_id && !user?.id) return c.json({ error: 'officer_id required' }, 400);
  const db = getDb(c.env);
  const r = await execute(
    db,
    `INSERT INTO serve_routes (
      officer_id, route_date, optimized_order_json, waypoints_json,
      total_distance_miles, total_time_minutes,
      start_lat, start_lng, end_lat, end_lng, notes
    ) VALUES (?,?,?,?, ?,?, ?,?,?,?, ?)`,
    body.officer_id ?? user?.id, body.route_date ?? null,
    JSON.stringify(body.optimized_order ?? []),
    JSON.stringify(body.waypoints ?? []),
    body.total_distance_miles ?? null, body.total_time_minutes ?? null,
    body.start_lat ?? null, body.start_lng ?? null,
    body.end_lat ?? null, body.end_lng ?? null,
    body.notes ?? null,
  );
  return c.json({ success: true, id: r.meta.last_row_id });
});

// ── GET /export.csv — admin/manager ─────────────────────────
si.get('/export.csv', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const rows = await query<any>(
    db,
    `SELECT id, status, priority, recipient_name, recipient_address, recipient_city,
            recipient_state, document_type, case_number, court_name, deadline,
            attempt_count, officer_id, created_at
       FROM serve_queue ORDER BY id DESC LIMIT 10000`,
  );
  const headers = [
    'id', 'status', 'priority', 'recipient_name', 'recipient_address', 'recipient_city',
    'recipient_state', 'document_type', 'case_number', 'court_name', 'deadline',
    'attempt_count', 'officer_id', 'created_at',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(','));
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="serve-queue.csv"',
    },
  });
});

export default si;
