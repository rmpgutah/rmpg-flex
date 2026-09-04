// ============================================================
// RMPG Flex — Serve Dashboard API (Cloudflare Worker + Hono)
// ============================================================
// Admin/manager/supervisor analytics & bulk-ops layer for the
// process-service queue. Sits alongside serve.ts (officer
// workflow) and serveIntake.ts (intake + OCR pipeline).
//
// All endpoints require auth (admin, manager, or supervisor).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, queryInChunks } from '../utils/db';
import { toDenverWallClock } from '../utils/denverTime';

const sd = new Hono<Env>();

/**
 * Pure avg/median/p90 stats over a set of "days to serve" values. Exported
 * for unit testing (tests/serveDashboardStats.test.ts) — median/p90 here
 * previously had off-by-one bugs: median used dayValues[floor(n/2)] (wrong
 * for even n — that's the lower-middle element, not the average of the two
 * middle values), and p90 used dayValues[floor(n*0.9)] (one index too high
 * for exact multiples of 10, e.g. n=100 selected the 91st value).
 */
export function computeDaysToServeStats(sortedDayValues: number[]): {
  avg: number;
  median: number;
  p90: number;
} {
  const n = sortedDayValues.length;
  const avg = n
    ? Math.round((sortedDayValues.reduce((s, v) => s + v, 0) / n) * 100) / 100
    : 0;
  const median = n
    ? (n % 2 === 1
        ? sortedDayValues[(n - 1) / 2]
        : (sortedDayValues[n / 2 - 1] + sortedDayValues[n / 2]) / 2)
    : 0;
  const p90 = n
    ? sortedDayValues[Math.max(0, Math.ceil(n * 0.9) - 1)]
    : 0;
  return { avg, median, p90 };
}

// ── Auth guard ──────────────────────────────────────────────

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

const DASHBOARD_ROLES = ['admin', 'manager', 'supervisor'] as const;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
}

// ── 1. GET /daily-summary ───────────────────────────────────
// Today's stats: total queued, attempted, served, failed, pending.
sd.get('/daily-summary', async (c) => {
  const denied = requireRole(c, ...DASHBOARD_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const today = toDenverWallClock(new Date()).slice(0, 10);

  // Single GROUP BY instead of 7 separate count queries (N+1 anti-pattern).
  const rows = await query<{ status: string; n: number }>(
    db,
    `SELECT status, COUNT(*) AS n FROM serve_queue WHERE DATE(created_at) = ? GROUP BY status`,
    today,
  );
  const byStatus: Record<string, number> = {};
  let totalN = 0;
  for (const r of rows) { byStatus[r.status] = r.n; totalN += r.n; }

  const cnt = (s: string) => byStatus[s] ?? 0;
  const pct = (n: number) => totalN ? Math.round((n / totalN) * 10000) / 100 : 0;

  return c.json({
    date: today,
    total: totalN,
    pending: cnt('pending'),
    assigned: cnt('assigned'),
    in_progress: cnt('in_progress'),
    served: cnt('served'),
    failed: cnt('failed'),
    attempted: cnt('attempted'),
    percentages: {
      pending: pct(cnt('pending')),
      assigned: pct(cnt('assigned')),
      in_progress: pct(cnt('in_progress')),
      served: pct(cnt('served')),
      failed: pct(cnt('failed')),
      attempted: pct(cnt('attempted')),
    },
  });
});

// ── 2. GET /server-performance ──────────────────────────────
// Per-server stats for last 30 days: attempts, success rate,
// avg attempts per serve, fastest serve time. Ranked by success.
sd.get('/server-performance', async (c) => {
  const denied = requireRole(c, ...DASHBOARD_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const days = parseInt(c.req.query('days') || '30', 10);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  const rows = await query<{
    officer_id: number;
    officer_name: string;
    total_attempts: number;
    successful_attempts: number;
    queues_served: number;
    avg_attempts_per_serve: number;
    fastest_serve_hours: number | null;
  }>(
    db,
    `SELECT
       a.officer_id,
       u.full_name AS officer_name,
       COUNT(*) AS total_attempts,
       SUM(CASE WHEN a.result IN ('served', 'sub_served') THEN 1 ELSE 0 END) AS successful_attempts,
       COUNT(DISTINCT a.serve_queue_id) AS queues_served,
       ROUND(
         CAST(COUNT(*) AS REAL) / MAX(COUNT(DISTINCT a.serve_queue_id), 1),
         2
       ) AS avg_attempts_per_serve,
       MIN(
         CASE WHEN a.result IN ('served', 'sub_served')
           THEN ROUND(
             (JULIANDAY(a.attempt_at) - JULIANDAY(q.created_at)) * 24,
             1
           )
         END
       ) AS fastest_serve_hours
     FROM serve_attempts a
     JOIN serve_queue q ON q.id = a.serve_queue_id
     LEFT JOIN users u ON u.id = a.officer_id
     WHERE a.attempt_at >= ?
       AND a.officer_id IS NOT NULL
     GROUP BY a.officer_id, u.full_name
     ORDER BY successful_attempts DESC, total_attempts DESC
     LIMIT 100`,
    cutoff,
  );

  return c.json({
    period_days: days,
    servers: rows.map((r) => ({
      officer_id: r.officer_id,
      officer_name: r.officer_name,
      total_attempts: r.total_attempts,
      successful_attempts: r.successful_attempts,
      queues_served: r.queues_served,
      success_rate: r.total_attempts
        ? Math.round((r.successful_attempts / r.total_attempts) * 10000) / 100
        : 0,
      avg_attempts_per_serve: r.avg_attempts_per_serve,
      fastest_serve_hours: r.fastest_serve_hours,
    })),
  });
});

// ── 3. GET /success-rate-by-type ────────────────────────────
// Success rate breakdown by attempt_type (personal, substitute,
// posting, nail-and-mail).
sd.get('/success-rate-by-type', async (c) => {
  const denied = requireRole(c, ...DASHBOARD_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const days = parseInt(c.req.query('days') || '30', 10);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  const rows = await query<{
    attempt_type: string;
    total: number;
    successful: number;
    failed: number;
    other: number;
  }>(
    db,
    `SELECT
       COALESCE(a.attempt_type, 'standard') AS attempt_type,
       COUNT(*) AS total,
       SUM(CASE WHEN a.result IN ('served', 'sub_served') THEN 1 ELSE 0 END) AS successful,
       SUM(CASE WHEN a.result = 'no_answer' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN a.result NOT IN ('served', 'sub_served', 'no_answer') THEN 1 ELSE 0 END) AS other
     FROM serve_attempts a
     WHERE a.attempt_at >= ?
     GROUP BY COALESCE(a.attempt_type, 'standard')
     ORDER BY total DESC`,
    cutoff,
  );

  return c.json({
    period_days: days,
    types: rows.map((r) => ({
      attempt_type: r.attempt_type,
      total: r.total,
      successful: r.successful,
      failed: r.failed,
      other: r.other,
      success_rate: r.total
        ? Math.round((r.successful / r.total) * 10000) / 100
        : 0,
    })),
  });
});

// ── 4. GET /time-to-serve ───────────────────────────────────
// Average days from intake to successful service. Returns avg,
// median, and p90.
sd.get('/time-to-serve', async (c) => {
  const denied = requireRole(c, ...DASHBOARD_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const days = parseInt(c.req.query('days') || '90', 10);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  // Get all successful serves and compute time-to-serve from the
  // first attempt (or queue creation if no attempts) to the final
  // successful attempt.
  const rows = await query<{
    queue_id: number;
    days_to_serve: number;
  }>(
    db,
    `WITH first_attempt AS (
       SELECT serve_queue_id, MIN(attempt_at) AS first_attempt_at
       FROM serve_attempts
       WHERE attempt_at >= ?
       GROUP BY serve_queue_id
     ),
     successful AS (
       SELECT a.serve_queue_id, MAX(a.attempt_at) AS served_at
       FROM serve_attempts a
       WHERE a.result IN ('served', 'sub_served')
         AND a.attempt_at >= ?
       GROUP BY a.serve_queue_id
     )
     SELECT
       s.serve_queue_id AS queue_id,
       ROUND((JULIANDAY(s.served_at) - JULIANDAY(COALESCE(f.first_attempt_at, q.created_at))), 1) AS days_to_serve
     FROM successful s
     LEFT JOIN first_attempt f ON f.serve_queue_id = s.serve_queue_id
     LEFT JOIN serve_queue q ON q.id = s.serve_queue_id
     ORDER BY days_to_serve ASC`,
    cutoff, cutoff,
  );

  const dayValues = rows.map((r) => r.days_to_serve).filter((n) => n !== null && n >= 0) as number[];
  dayValues.sort((a, b) => a - b);

  const { avg, median, p90 } = computeDaysToServeStats(dayValues);

  return c.json({
    period_days: days,
    sample_size: dayValues.length,
    avg_days: avg,
    median_days: median,
    p90_days: p90,
  });
});

// ── 5. GET /workload-distribution ───────────────────────────
// Current workload per active server: assigned count, overdue
// count, today's attempts. Flags servers over capacity.
sd.get('/workload-distribution', async (c) => {
  const denied = requireRole(c, ...DASHBOARD_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const capacityThreshold = parseInt(c.req.query('capacity') || '20', 10);
  const today = toDenverWallClock(new Date()).slice(0, 10);
  const rows = await query<{
    officer_id: number;
    officer_name: string;
    assigned_count: number;
    overdue_count: number;
    todays_attempts: number;
  }>(
    db,
    `SELECT
       u.id AS officer_id,
       u.full_name AS officer_name,
       SUM(CASE WHEN q.status IN ('assigned', 'in_progress', 'attempted') THEN 1 ELSE 0 END) AS assigned_count,
       SUM(CASE WHEN q.deadline IS NOT NULL
                  AND q.deadline < datetime('now')
                  AND q.status NOT IN ('served', 'cancelled', 'failed')
             THEN 1 ELSE 0 END) AS overdue_count,
       COALESCE(todays.cnt, 0) AS todays_attempts
     FROM users u
     INNER JOIN serve_queue q ON q.officer_id = u.id
     LEFT JOIN (
       SELECT officer_id, COUNT(*) AS cnt
       FROM serve_attempts
       WHERE DATE(attempt_at) = ?
       GROUP BY officer_id
     ) todays ON todays.officer_id = u.id
     WHERE q.status NOT IN ('served', 'cancelled', 'failed')
       AND u.role IN ('officer', 'supervisor', 'manager', 'admin')
     GROUP BY u.id, u.full_name, todays.cnt
     ORDER BY assigned_count DESC
     LIMIT 200`,
    today,
  );

  return c.json({
    capacity_threshold: capacityThreshold,
    servers: rows.map((r) => ({
      officer_id: r.officer_id,
      officer_name: r.officer_name,
      assigned_count: r.assigned_count,
      overdue_count: r.overdue_count,
      todays_attempts: r.todays_attempts,
      over_capacity: r.assigned_count > capacityThreshold,
    })),
    over_capacity_count: rows.filter((r) => r.assigned_count > capacityThreshold).length,
  });
});

// ── 6. GET /stale-attempts ──────────────────────────────────
// List attempts older than 14 days with no progress. Includes
// defendant, address, last attempt date, assigned server.
sd.get('/stale-attempts', async (c) => {
  const denied = requireRole(c, ...DASHBOARD_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const staleDays = parseInt(c.req.query('days') || '14', 10);

  const rows = await query<{
    id: number;
    recipient_name: string;
    defendant_name: string | null;
    recipient_address: string;
    recipient_city: string | null;
    status: string;
    last_attempt_at: string | null;
    days_stale: number;
    officer_id: number | null;
    officer_name: string | null;
    attempt_count: number;
    priority: string;
    document_type: string | null;
    case_number: string | null;
    deadline: string | null;
  }>(
    db,
    `WITH last_attempt AS (
       SELECT serve_queue_id, MAX(attempt_at) AS last_attempt_at
       FROM serve_attempts
       GROUP BY serve_queue_id
     )
     SELECT
       q.id,
       q.recipient_name,
       q.defendant_name,
       q.recipient_address,
       q.recipient_city,
       q.status,
       la.last_attempt_at,
       ROUND((JULIANDAY(datetime('now')) - JULIANDAY(la.last_attempt_at)), 0) AS days_stale,
       q.officer_id,
       u.full_name AS officer_name,
       q.attempt_count,
       q.priority,
       q.document_type,
       q.case_number,
       q.deadline
     FROM serve_queue q
     LEFT JOIN last_attempt la ON la.serve_queue_id = q.id
     LEFT JOIN users u ON u.id = q.officer_id
     WHERE q.status NOT IN ('served', 'cancelled', 'failed')
       AND la.last_attempt_at IS NOT NULL
       AND la.last_attempt_at < datetime('now', '-' || ? || ' days')
     ORDER BY la.last_attempt_at ASC
     LIMIT 200`,
    staleDays,
  );

  return c.json({
    stale_threshold_days: staleDays,
    count: rows.length,
    items: rows,
  });
});

// ── 7. GET /weekly-trend ────────────────────────────────────
// Last 12 weeks: serves per week, success rate trend, attempt
// volume.
sd.get('/weekly-trend', async (c) => {
  const denied = requireRole(c, ...DASHBOARD_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const weeks = parseInt(c.req.query('weeks') || '12', 10);
  const cutoff = new Date(Date.now() - weeks * 7 * 86400000).toISOString();

  const rows = await query<{
    week_start: string;
    total_attempts: number;
    successful_attempts: number;
    queues_served: number;
    queues_created: number;
  }>(
    db,
    `WITH weekly_attempts AS (
       SELECT
         DATE(a.attempt_at, 'weekday 0', '-6 days') AS week_start,
         COUNT(*) AS total_attempts,
         SUM(CASE WHEN a.result IN ('served', 'sub_served') THEN 1 ELSE 0 END) AS successful_attempts,
         COUNT(DISTINCT CASE WHEN a.result IN ('served', 'sub_served') THEN a.serve_queue_id END) AS queues_served
       FROM serve_attempts a
       WHERE a.attempt_at >= ?
       GROUP BY DATE(a.attempt_at, 'weekday 0', '-6 days')
     ),
     weekly_created AS (
       SELECT
         DATE(created_at, 'weekday 0', '-6 days') AS week_start,
         COUNT(*) AS queues_created
       FROM serve_queue
       WHERE created_at >= ?
       GROUP BY DATE(created_at, 'weekday 0', '-6 days')
     )
     SELECT
       COALESCE(wa.week_start, wc.week_start) AS week_start,
       COALESCE(wa.total_attempts, 0) AS total_attempts,
       COALESCE(wa.successful_attempts, 0) AS successful_attempts,
       COALESCE(wa.queues_served, 0) AS queues_served,
       COALESCE(wc.queues_created, 0) AS queues_created
     FROM weekly_attempts wa
     LEFT JOIN weekly_created wc ON wa.week_start = wc.week_start
     UNION
     SELECT
       wc2.week_start,
       COALESCE(wa2.total_attempts, 0),
       COALESCE(wa2.successful_attempts, 0),
       COALESCE(wa2.queues_served, 0),
       wc2.queues_created
     FROM weekly_created wc2
     LEFT JOIN weekly_attempts wa2 ON wc2.week_start = wa2.week_start
     WHERE wa2.week_start IS NULL
     ORDER BY week_start ASC`,
    cutoff, cutoff,
  );

  return c.json({
    period_weeks: weeks,
    weeks: rows.map((r) => ({
      week_start: r.week_start,
      total_attempts: r.total_attempts,
      successful_attempts: r.successful_attempts,
      queues_served: r.queues_served,
      queues_created: r.queues_created,
      success_rate: r.total_attempts
        ? Math.round((r.successful_attempts / r.total_attempts) * 10000) / 100
        : 0,
    })),
  });
});

// ── 8. GET /county-breakdown ────────────────────────────────
// Serve stats grouped by county/city. Returns per-region counts
// and success rates.
sd.get('/county-breakdown', async (c) => {
  const denied = requireRole(c, ...DASHBOARD_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const db = getDb(c.env);
  const days = parseInt(c.req.query('days') || '30', 10);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  const rows = await query<{
    city: string;
    total: number;
    served: number;
    failed: number;
    pending: number;
    avg_attempts: number;
  }>(
    db,
    `SELECT
       COALESCE(q.recipient_city, 'Unknown') AS city,
       COUNT(DISTINCT q.id) AS total,
       SUM(CASE WHEN q.status = 'served' THEN 1 ELSE 0 END) AS served,
       SUM(CASE WHEN q.status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN q.status IN ('pending', 'assigned', 'in_progress', 'attempted') THEN 1 ELSE 0 END) AS pending,
       ROUND(
         CAST(SUM(COALESCE(q.attempt_count, 0)) AS REAL) / MAX(COUNT(DISTINCT q.id), 1),
         2
       ) AS avg_attempts
     FROM serve_queue q
     WHERE q.created_at >= ?
     GROUP BY COALESCE(q.recipient_city, 'Unknown')
     ORDER BY total DESC
     LIMIT 100`,
    cutoff,
  );

  return c.json({
    period_days: days,
    regions: rows.map((r) => ({
      city: r.city,
      total: r.total,
      served: r.served,
      failed: r.failed,
      pending: r.pending,
      success_rate: r.total
        ? Math.round((r.served / r.total) * 10000) / 100
        : 0,
      avg_attempts: r.avg_attempts,
    })),
  });
});

// ── 9. POST /bulk-reassign ──────────────────────────────────
// Bulk reassign attempts from one server to another. Accepts
// { fromServerId, toServerId, attemptIds[] }.
sd.post('/bulk-reassign', async (c) => {
  const denied = requireRole(c, ...DASHBOARD_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const body: { fromServerId?: number; toServerId?: number; attemptIds?: number[] } =
    await c.req.json().catch(() => ({}));

  if (!body.toServerId) return c.json({ error: 'toServerId required' }, 400);
  if (!Array.isArray(body.attemptIds) || !body.attemptIds.length) {
    return c.json({ error: 'attemptIds array required' }, 400);
  }

  const db = getDb(c.env);
  const user = c.get('user') as { id: number } | undefined;

  // Validate target server
  const target = await queryFirst<{ id: number }>(
    db,
    "SELECT id FROM users WHERE id = ? AND role IN ('officer', 'supervisor', 'manager', 'admin')",
    body.toServerId,
  );
  if (!target) return c.json({ error: 'Target server not found or not assignable' }, 400);

  // Find the queue entries that own these attempts
  // Chunked: D1 caps a query at 100 bound parameters, so a bulk reassign of
  // 100+ attempts would have been rejected at bind time and 500'd. `attemptIds`
  // comes straight from the request body with no upper bound.
  const attemptIds = body.attemptIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const attemptRows = await queryInChunks<{ id: number; serve_queue_id: number; officer_id: number | null }>(
    db,
    attemptIds,
    (ph) => `SELECT id, serve_queue_id, officer_id FROM serve_attempts WHERE id IN (${ph})`,
  );

  // Optionally filter by fromServerId
  const filtered = body.fromServerId
    ? attemptRows.filter((r) => r.officer_id === body.fromServerId)
    : attemptRows;

  const reassigned: number[] = [];
  const skipped: number[] = [];

  // Collect unique queue IDs to update
  const queueIds = new Set<number>();
  for (const a of filtered) {
    queueIds.add(a.serve_queue_id);
    reassigned.push(a.id);
  }
  for (const id of body.attemptIds) {
    if (!filtered.find((r) => r.id === id)) skipped.push(id);
  }

  // Update officer_id on the parent queue entries
  const stmts = Array.from(queueIds).map((qid) =>
    db.prepare(
      "UPDATE serve_queue SET officer_id = ?, status = CASE WHEN status = 'pending' THEN 'assigned' ELSE status END, updated_at = datetime('now') WHERE id = ?",
    ).bind(body.toServerId, qid),
  );

  if (stmts.length) await db.batch(stmts);

  // Log to activity_log for audit trail
  for (const qid of queueIds) {
    await execute(
      db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, 'reassign', 'serve_assignment', ?, ?)`,
      user?.id ?? null, qid,
      JSON.stringify({
        from_server: body.fromServerId ?? null,
        to_server: body.toServerId,
        reassigned_attempts: reassigned.length,
      }),
    );
  }

  return c.json({
    success: true,
    reassigned_count: reassigned.length,
    reassigned_attempt_ids: reassigned,
    skipped_attempt_ids: skipped,
    affected_queue_ids: Array.from(queueIds),
  });
});

// ── 10. POST /export ────────────────────────────────────────
// Export serve queue filtered by status/date/server to CSV.
sd.post('/export', async (c) => {
  const denied = requireRole(c, ...DASHBOARD_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const body: { status?: string; startDate?: string; endDate?: string; serverId?: number; format?: 'csv' | 'json' } =
    await c.req.json().catch(() => ({}));

  const db = getDb(c.env);
  const where: string[] = [];
  const args: any[] = [];

  if (body.status) {
    where.push('q.status = ?');
    args.push(body.status);
  }
  if (body.startDate) {
    where.push('q.created_at >= ?');
    args.push(body.startDate);
  }
  if (body.endDate) {
    where.push('q.created_at <= ?');
    args.push(body.endDate + ' 23:59:59');
  }
  if (body.serverId) {
    where.push('q.officer_id = ?');
    args.push(body.serverId);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query<any>(
    db,
    `SELECT q.id, q.status, q.priority, q.recipient_name, q.defendant_name,
            q.recipient_address, q.recipient_address_2, q.recipient_city,
            q.recipient_state, q.recipient_zip, q.document_type, q.case_number,
            q.court_name, q.jurisdiction, q.client_name, q.attorney_name,
            q.deadline, q.attempt_count, q.max_attempts, q.officer_id,
            u.full_name AS officer_name, q.created_at, q.closed_at,
            q.service_instructions, q.notes
     FROM serve_queue q
     LEFT JOIN users u ON u.id = q.officer_id
     ${whereClause}
     ORDER BY q.id DESC
     LIMIT 10000`,
    ...args,
  );

  if (body.format === 'json') {
    return c.json({ count: rows.length, data: rows });
  }

  // CSV export
  const headers = [
    'id', 'status', 'priority', 'recipient_name', 'defendant_name',
    'recipient_address', 'recipient_address_2', 'recipient_city',
    'recipient_state', 'recipient_zip', 'document_type', 'case_number',
    'court_name', 'jurisdiction', 'client_name', 'attorney_name',
    'deadline', 'attempt_count', 'max_attempts', 'officer_id',
    'officer_name', 'created_at', 'closed_at', 'service_instructions', 'notes',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(','));

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="serve_export_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

// ── 11. POST /bulk-status-update ────────────────────────────
// Update status for multiple attempts at once. Accepts
// { attemptIds[], status, notes? }.
sd.post('/bulk-status-update', async (c) => {
  const denied = requireRole(c, ...DASHBOARD_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const body: { attemptIds?: number[]; status?: string; notes?: string } =
    await c.req.json().catch(() => ({}));

  if (!Array.isArray(body.attemptIds) || !body.attemptIds.length) {
    return c.json({ error: 'attemptIds array required' }, 400);
  }
  const VALID = ['pending', 'assigned', 'in_progress', 'served', 'attempted', 'failed', 'cancelled'];
  if (!body.status || !VALID.includes(body.status)) {
    return c.json({ error: `status must be one of: ${VALID.join(', ')}` }, 400);
  }

  const db = getDb(c.env);
  const user = c.get('user') as { id: number } | undefined;

  // Get the queue IDs affected by these attempts. `attemptIds` is unbounded
  // request-body input — AnalyticsTab's bulk action posts every selected row —
  // so the IN-list is chunked under D1's 100-bound-parameter cap. DISTINCT is
  // per-chunk only, so the same queue id can come back from two chunks; dedupe
  // in-process before building the UPDATE batch, or a job gets updated twice
  // and inflates `updatedCount`.
  const affectedQueueRows = await queryInChunks<{ serve_queue_id: number }>(
    db,
    body.attemptIds,
    (placeholders) => `SELECT DISTINCT serve_queue_id FROM serve_attempts WHERE id IN (${placeholders})`,
  );
  const affectedQueues = [...new Set(
    affectedQueueRows.map((r) => r.serve_queue_id).filter((n) => Number.isFinite(n)),
  )].map((serve_queue_id) => ({ serve_queue_id }));

  const closedAt = (body.status === 'served' || body.status === 'failed')
    ? "datetime('now')"
    : 'NULL';

  // Update queue status for each affected queue
  const stmts = affectedQueues.map((q) =>
    db.prepare(
      `UPDATE serve_queue
       SET status = ?, closed_at = ${closedAt}, updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(body.status, q.serve_queue_id),
  );

  let updatedCount = 0;
  if (stmts.length) {
    const results = await db.batch(stmts);
    updatedCount = results.filter((r) => r.success).length;
  }

  // Log the bulk action
  await execute(
    db,
    `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, 'bulk_status', 'serve_queue', 0, ?)`,
    user?.id ?? null,
    JSON.stringify({
      attempt_ids: body.attemptIds,
      new_status: body.status,
      notes: body.notes ?? null,
      affected_queue_count: affectedQueues.length,
    }),
  );

  return c.json({
    success: true,
    updated_queue_count: updatedCount,
    affected_queue_ids: affectedQueues.map((q) => q.serve_queue_id),
    status: body.status,
  });
});

// ── 12. GET /attempt-timeline/:queueId ──────────────────────
// Full timeline of all attempts for a serve queue entry, with
// photos, notes, and status changes.
sd.get('/attempt-timeline/:queueId', async (c) => {
  const denied = requireRole(c, ...DASHBOARD_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  const queueId = parseInt(c.req.param('queueId'), 10);
  if (!Number.isFinite(queueId) || queueId < 1) return c.json({ error: 'Invalid queueId' }, 400);

  const db = getDb(c.env);

  // Queue entry metadata
  const queue = await queryFirst<any>(
    db,
    `SELECT q.*, u.full_name AS officer_name
     FROM serve_queue q LEFT JOIN users u ON u.id = q.officer_id
     WHERE q.id = ?`,
    queueId,
  );
  if (!queue) return c.json({ error: 'Queue entry not found' }, 404);

  // All attempts with officer names
  const attempts = await query<any>(
    db,
    `SELECT a.*, u.full_name AS officer_name
     FROM serve_attempts a
     LEFT JOIN users u ON u.id = a.officer_id
     WHERE a.serve_queue_id = ?
     ORDER BY a.attempt_at ASC, a.id ASC`,
    queueId,
  );

  // Activity log entries for this queue (assignments, deletes, renumbers)
  const activityLog = await query<any>(
    db,
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at,
            u.full_name AS user_name
     FROM activity_log a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE (a.entity_type = 'serve_assignment' AND a.entity_id = ?)
        OR (a.entity_type = 'serve_attempt' AND (a.details LIKE ? OR a.details LIKE ?))
        OR (a.entity_type = 'serve_attempts' AND a.entity_id = ?)
        OR (a.entity_type = 'serve_queue' AND a.entity_id = ?)
     ORDER BY a.id ASC
     LIMIT 500`,
    queueId,
    `%"serve_queue_id":${queueId},%`,
    `%"serve_queue_id":${queueId}}%`,
    queueId,
    queueId,
  );

  // Build a unified timeline from attempts + activity log
  const timeline: Array<{
    type: 'attempt' | 'activity';
    timestamp: string;
    data: any;
  }> = [];

  for (const a of attempts) {
    timeline.push({
      type: 'attempt',
      timestamp: a.attempt_at,
      data: {
        attempt_id: a.id,
        attempt_number: a.attempt_number,
        officer_id: a.officer_id,
        officer_name: a.officer_name,
        result: a.result,
        disposition_code: a.disposition_code ?? null,
        attempt_type: a.attempt_type,
        notes: a.notes,
        latitude: a.latitude,
        longitude: a.longitude,
        photo_ids: (() => {
          try { return JSON.parse(a.photo_ids || '[]'); } catch { return []; }
        })(),
        signature_data: a.signature_data ? true : false,
      },
    });
  }

  for (const log of activityLog) {
    let details: any = {};
    try { details = JSON.parse(log.details || '{}'); } catch { details = { raw: log.details }; }
    timeline.push({
      type: 'activity',
      timestamp: log.created_at,
      data: {
        action: log.action,
        entity_type: log.entity_type,
        user_name: log.user_name,
        details,
      },
    });
  }

  timeline.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));

  return c.json({
    queue_id: queueId,
    queue,
    total_attempts: attempts.length,
    total_activities: activityLog.length,
    timeline,
  });
});

export default sd;
