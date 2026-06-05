// ============================================================
// RMPG Flex — Process Server worklist endpoints (rewrite port)
// ============================================================
// The officer-facing ServePage calls /api/process-server/* . Most of that
// router still lives on the legacy worker, but three endpoints the page
// depends on were 404ing in production: GET /deadlines, GET /success-rates,
// and route optimization. In legacy serve.ts they're declared AFTER the
// `/:id` route, so Express matched `/deadlines` against `/:id` and the
// deployed worker never reached them (route-order shadow).
//
// These are ported here and proxy-routed to env.API on their exact paths,
// so they resolve before the generic /:id legacy route. Everything else on
// /api/process-server stays on legacy. Column refs are fully qualified — the
// JOIN to users (which has its own status column) would otherwise raise
// "ambiguous column name: status".
//
// Mounted at /api/process-server (routesConfig).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const ps = new Hono<Env>();

const READ_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher', 'officer'];
const WRITE_ROLES = ['admin', 'manager', 'supervisor', 'officer'];

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// ── GET /deadlines — statutory service-by triage ────────────
// Buckets open serves by days-to-deadline so the queue can surface what's
// overdue / due-soon. Mirrors the legacy response shape exactly so the
// existing ServePage Deadlines panel renders unchanged.
ps.get('/deadlines', async (c) => {
  const denied = requireRole(c, ...READ_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const rows = await query<any>(db, `
      SELECT sq.id, sq.recipient_name, sq.deadline, sq.status, sq.attempt_count, sq.max_attempts,
             sq.document_type, sq.case_number, sq.client_name,
             u.full_name AS officer_name,
             JULIANDAY(sq.deadline) - JULIANDAY('now') AS days_remaining
      FROM serve_queue sq
      LEFT JOIN users u ON u.id = sq.officer_id
      WHERE sq.deadline IS NOT NULL AND sq.status NOT IN ('served', 'cancelled')
      ORDER BY sq.deadline ASC
      LIMIT 1000`);
    const dr = (r: any) => Number(r.days_remaining);
    const overdue = rows.filter((r) => dr(r) < 0);
    const urgent = rows.filter((r) => dr(r) >= 0 && dr(r) <= 3);
    const upcoming = rows.filter((r) => dr(r) > 3 && dr(r) <= 14);
    const safe = rows.filter((r) => dr(r) > 14);
    return c.json({ all: rows, overdue, urgent, upcoming, safe, total: rows.length });
  } catch (err) {
    console.error('[process-server] deadlines error', err);
    return c.json({ error: 'Failed to fetch deadlines', code: 'FAILED_TO_FETCH_DEADLINES', detail: (err as Error)?.message }, 500);
  }
});

// ── GET /success-rates?days=90 — outcome analytics ──────────
ps.get('/success-rates', async (c) => {
  const denied = requireRole(c, ...READ_ROLES);
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const parsedDays = parseInt(c.req.query('days') || '90', 10);
    if (!Number.isFinite(parsedDays) || parsedDays < 1 || parsedDays > 3650) {
      return c.json({ error: 'days must be a number between 1 and 3650', code: 'INVALID_DAYS_PARAM' }, 400);
    }
    const cutoff = new Date(Date.now() - parsedDays * 86400000).toISOString();

    const overall = await queryFirst<any>(db, `
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status = 'served' THEN 1 ELSE 0 END) AS served,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
             AVG(attempt_count) AS avg_attempts
      FROM serve_queue WHERE created_at >= ?`, cutoff) || { total: 0, served: 0, failed: 0, avg_attempts: 0 };

    const byOfficer = await query<any>(db, `
      SELECT u.full_name AS officer_name, sq.officer_id,
             COUNT(*) AS total,
             SUM(CASE WHEN sq.status = 'served' THEN 1 ELSE 0 END) AS served,
             SUM(CASE WHEN sq.status = 'failed' THEN 1 ELSE 0 END) AS failed,
             ROUND(AVG(sq.attempt_count), 1) AS avg_attempts
      FROM serve_queue sq LEFT JOIN users u ON u.id = sq.officer_id
      WHERE sq.created_at >= ? GROUP BY sq.officer_id ORDER BY served DESC`, cutoff);

    const byDocType = await query<any>(db, `
      SELECT document_type, COUNT(*) AS total,
             SUM(CASE WHEN status = 'served' THEN 1 ELSE 0 END) AS served,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM serve_queue WHERE created_at >= ? AND document_type IS NOT NULL AND document_type != ''
      GROUP BY document_type ORDER BY total DESC`, cutoff);

    // Best-time-to-serve signal: success by hour-of-day + weekday, from the
    // attempt log. attempt_at is the canonical timestamp; fall back to created_at.
    const byHour = await query<any>(db, `
      SELECT CAST(strftime('%H', COALESCE(attempt_at, created_at)) AS INTEGER) AS hour,
             COUNT(*) AS attempts,
             SUM(CASE WHEN result = 'served' THEN 1 ELSE 0 END) AS served
      FROM serve_attempts WHERE COALESCE(attempt_at, created_at) >= ?
      GROUP BY hour ORDER BY hour`, cutoff);

    const byWeekday = await query<any>(db, `
      SELECT CAST(strftime('%w', COALESCE(attempt_at, created_at)) AS INTEGER) AS weekday,
             COUNT(*) AS attempts,
             SUM(CASE WHEN result = 'served' THEN 1 ELSE 0 END) AS served
      FROM serve_attempts WHERE COALESCE(attempt_at, created_at) >= ?
      GROUP BY weekday ORDER BY weekday`, cutoff);

    const byMethod = await query<any>(db, `
      SELECT attempt_type AS method, COUNT(*) AS count,
             SUM(CASE WHEN result = 'served' THEN 1 ELSE 0 END) AS successful
      FROM serve_attempts WHERE COALESCE(attempt_at, created_at) >= ?
      GROUP BY attempt_type ORDER BY count DESC`, cutoff);

    const rate = (s: number, t: number) => (t > 0 ? Math.round((s / t) * 100) : 0);
    const withRate = (r: any) => ({ ...r, success_rate: rate(r.served, r.total) });
    return c.json({
      overall: { ...overall, success_rate: rate(overall.served, overall.total) },
      by_officer: byOfficer.map(withRate),
      by_document_type: byDocType.map(withRate),
      by_hour: byHour.map((r: any) => ({ ...r, success_rate: rate(r.served, r.attempts) })),
      by_weekday: byWeekday.map((r: any) => ({ ...r, success_rate: rate(r.served, r.attempts) })),
      by_method: byMethod,
      period_days: parsedDays,
    });
  } catch (err) {
    console.error('[process-server] success-rates error', err);
    return c.json({ error: 'Failed to fetch success rates', code: 'FAILED_TO_FETCH_SUCCESS', detail: (err as Error)?.message }, 500);
  }
});

export default ps;
