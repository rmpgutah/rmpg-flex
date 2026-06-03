// ============================================================
// RMPG Flex — /api/reports/* aggregations
// ============================================================
// Dashboard endpoints that summarise incidents, citations, and beat
// activity over rolling windows. Replaces the empty-shape stubs from
// src/routes/stubs.ts so the Reports dashboard renders real numbers.
//
// All handlers gated to admin/manager/supervisor — these expose
// org-wide rollups, not officer-level data.
//
// Time windows are user-supplied via ?days=N (clamped to [1, 365]).
// SQL filters on created_at (when the record entered the system) —
// not approved_at / disposition_date — so freshly-entered work is
// reflected immediately on the dashboard.
// ============================================================

import { Hono } from 'hono';
import { requireRole } from '../middleware/auth';
import { getDb, query, queryFirst } from '../utils/db';
import type { Env } from '../types';

const reports = new Hono<Env>();

const ANALYTICS_ROLES = ['admin', 'manager', 'supervisor'];

reports.use('*', requireRole(...ANALYTICS_ROLES));

function clampDays(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 365);
}

// GET /api/reports/incidents-summary?days=30
reports.get('/incidents-summary', async (c) => {
  try {
  const db = getDb(c.env);
  const days = clampDays(c.req.query('days'), 30);
  const since = `-${days} days`;

  const total = await queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM incidents WHERE created_at >= datetime('now', ?)`,
    since
  );
  const by_type = await query<{ type: string; count: number }>(
    db,
    `SELECT incident_type AS type, COUNT(*) AS count
       FROM incidents
      WHERE created_at >= datetime('now', ?)
      GROUP BY incident_type
      ORDER BY count DESC`,
    since
  );
  const by_status = await query<{ status: string; count: number }>(
    db,
    `SELECT status, COUNT(*) AS count
       FROM incidents
      WHERE created_at >= datetime('now', ?)
      GROUP BY status
      ORDER BY count DESC`,
    since
  );
  const by_day = await query<{ date: string; count: number }>(
    db,
    `SELECT date(created_at) AS date, COUNT(*) AS count
       FROM incidents
      WHERE created_at >= datetime('now', ?)
      GROUP BY date(created_at)
      ORDER BY date ASC`,
    since
  );

  return c.json({
    days,
    total: total?.n ?? 0,
    by_type,
    by_status,
    by_day,
  });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /api/reports/crime-trends?days=90
// trends[]: per-day incident_type rollup for stacked line charts.
// top_categories[]: leaderboard of incident_type counts for the
// whole window (denormalised for the dashboard's quick-stats card).
reports.get('/crime-trends', async (c) => {
  try {
  const db = getDb(c.env);
  const days = clampDays(c.req.query('days'), 90);
  const since = `-${days} days`;

  const trends = await query<{ date: string; type: string; count: number }>(
    db,
    `SELECT date(created_at) AS date, incident_type AS type, COUNT(*) AS count
       FROM incidents
      WHERE created_at >= datetime('now', ?)
      GROUP BY date(created_at), incident_type
      ORDER BY date ASC, count DESC`,
    since
  );
  const top_categories = await query<{ type: string; count: number }>(
    db,
    `SELECT incident_type AS type, COUNT(*) AS count
       FROM incidents
      WHERE created_at >= datetime('now', ?)
      GROUP BY incident_type
      ORDER BY count DESC
      LIMIT 10`,
    since
  );

  return c.json({ days, trends, top_categories });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /api/reports/beat-activity?days=30
// One row per active beat with call/incident/citation counts.
// Joins:
//   calls    — calls_for_service.beat_id = dispatch_beats.beat_code
//   incidents — via calls_for_service (incidents have no beat_id of their own)
//   citations — citations.beat_id = dispatch_beats.beat_code
// Inactive beats are excluded.
reports.get('/beat-activity', async (c) => {
  try {
  const db = getDb(c.env);
  const days = clampDays(c.req.query('days'), 30);
  const since = `-${days} days`;

  const beats = await query<{
    beat_code: string;
    beat_name: string;
    district_letter: string | null;
    calls: number;
    incidents: number;
    citations: number;
  }>(
    db,
    `SELECT b.beat_code,
            b.beat_name,
            b.district_letter,
            COALESCE(c.n, 0)  AS calls,
            COALESCE(i.n, 0)  AS incidents,
            COALESCE(ci.n, 0) AS citations
       FROM dispatch_beats b
       LEFT JOIN (
         SELECT beat_id, COUNT(*) AS n
           FROM calls_for_service
          WHERE created_at >= datetime('now', ?)
          GROUP BY beat_id
       ) c  ON c.beat_id = b.beat_code
       LEFT JOIN (
         SELECT cfs.beat_id, COUNT(*) AS n
           FROM incidents i
           JOIN calls_for_service cfs ON cfs.id = i.call_id
          WHERE i.created_at >= datetime('now', ?)
          GROUP BY cfs.beat_id
       ) i  ON i.beat_id = b.beat_code
       LEFT JOIN (
         SELECT beat_id, COUNT(*) AS n
           FROM citations
          WHERE created_at >= datetime('now', ?)
          GROUP BY beat_id
       ) ci ON ci.beat_id = b.beat_code
      WHERE b.active = 1
      ORDER BY (COALESCE(c.n,0) + COALESCE(i.n,0) + COALESCE(ci.n,0)) DESC,
               b.beat_code ASC`,
    since, since, since
  );

  return c.json({ days, beats });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /api/reports/citation-revenue?days=30
// total_revenue: sum of payment.amount across the window.
// by_violation: top fine-generating statutes (sums payments per citation).
// by_month: yyyy-mm bucketed totals for trend chart.
reports.get('/citation-revenue', async (c) => {
  try {
  const db = getDb(c.env);
  const days = clampDays(c.req.query('days'), 30);
  const since = `-${days} days`;

  const total = await queryFirst<{ total_revenue: number; payment_count: number }>(
    db,
    `SELECT COALESCE(SUM(amount), 0) AS total_revenue,
            COUNT(*) AS payment_count
       FROM citation_payments
      WHERE COALESCE(payment_date, created_at) >= datetime('now', ?)`,
    since
  );
  const by_violation = await query<{
    statute_citation: string | null;
    violation_description: string | null;
    revenue: number;
    citations: number;
  }>(
    db,
    `SELECT c.statute_citation,
            c.violation_description,
            COALESCE(SUM(p.amount), 0) AS revenue,
            COUNT(DISTINCT c.id)       AS citations
       FROM citations c
       JOIN citation_payments p ON p.citation_id = c.id
      WHERE COALESCE(p.payment_date, p.created_at) >= datetime('now', ?)
      GROUP BY c.statute_citation, c.violation_description
      ORDER BY revenue DESC
      LIMIT 20`,
    since
  );
  const by_month = await query<{ month: string; revenue: number }>(
    db,
    `SELECT strftime('%Y-%m', COALESCE(payment_date, created_at)) AS month,
            COALESCE(SUM(amount), 0) AS revenue
       FROM citation_payments
      WHERE COALESCE(payment_date, created_at) >= datetime('now', ?)
      GROUP BY month
      ORDER BY month ASC`,
    since
  );

  return c.json({
    days,
    total_revenue: total?.total_revenue ?? 0,
    payment_count: total?.payment_count ?? 0,
    by_violation,
    by_month,
  });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /api/reports/schedules
// No report_schedules table exists yet. Saved-report scheduling is
// out of scope for v1 — the GET exists so the dashboard's schedules
// panel can mount without 404 spam. Return [] until a real table lands.
reports.get('/schedules', (c) => c.json([]));

// GET /api/reports/templates
// Same situation as /schedules — no report_templates table. Return [].
reports.get('/templates', (c) => c.json([]));

// GET /api/reports/statute-analytics?days=180
// Aggregates over citation_violations joined to utah_statutes so we
// can show statute code + section title + offense_level. Percentage
// is computed against the total within the window so each row's
// pct_of_total sums to ~100 (minor rounding ok).
reports.get('/statute-analytics', async (c) => {
  try {
  const db = getDb(c.env);
  const days = clampDays(c.req.query('days'), 180);
  const since = `-${days} days`;

  // Statute data lives on `citations` (statute_citation/statute_id/offense_level/
  // created_at), NOT `citation_violations` (which only carries violation_code/
  // description/fine_amount/points — no statute or created_at columns). Querying
  // citation_violations here 500'd in prod; the proxy stub masked it. Both
  // citations and utah_statutes expose offense_level, so the GROUP BY must use
  // the same COALESCE expression as the SELECT or D1 throws "ambiguous column".
  const total = await queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n
       FROM citations v
      WHERE v.created_at >= datetime('now', ?)`,
    since
  );
  const denom = Math.max(total?.n ?? 0, 1);

  const rows = await query<{
    statute_citation: string | null;
    short_title: string | null;
    offense_level: string | null;
    category: string | null;
    count: number;
  }>(
    db,
    `SELECT v.statute_citation,
            s.short_title,
            COALESCE(s.offense_level, v.offense_level) AS offense_level,
            s.category,
            COUNT(*) AS count
       FROM citations v
  LEFT JOIN utah_statutes s ON s.id = v.statute_id
      WHERE v.created_at >= datetime('now', ?)
      GROUP BY v.statute_citation, s.short_title, COALESCE(s.offense_level, v.offense_level), s.category
      ORDER BY count DESC
      LIMIT 25`,
    since
  );

  const top_statutes = rows.map((r) => ({
    statute_citation: r.statute_citation,
    short_title: r.short_title,
    offense_level: r.offense_level,
    count: r.count,
    pct_of_total: Math.round((r.count / denom) * 10000) / 100,
  }));

  const by_category = await query<{ category: string | null; count: number }>(
    db,
    `SELECT s.category, COUNT(*) AS count
       FROM citations v
  LEFT JOIN utah_statutes s ON s.id = v.statute_id
      WHERE v.created_at >= datetime('now', ?)
      GROUP BY s.category
      ORDER BY count DESC`,
    since
  );

  return c.json({ days, total: total?.n ?? 0, top_statutes, by_category });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /api/reports/response-times
// Moved verbatim from src/routes/stubs.ts. Real dispatch-time math
// (arrived_at - dispatched_at) is a Phase 2 port — see the
// calls_for_service status-timestamp columns. Return [] until then.
reports.get('/response-times', (c) => c.json([]));

// GET /api/reports/command-center — live ops KPI roll-up for CommandCenterPage.
// The page reads data.kpis.* UNGUARDED, so kpis must always be a present object.
// Each metric is computed independently and falls back to 0 on any schema drift,
// so a single bad column can never 500 the whole block. Legacy had no handler
// (live sweep 2026-06-02 → 404).
reports.get('/command-center', async (c) => {
  const db = getDb(c.env);
  const one = async (sql: string): Promise<number> => {
    try { const r = await queryFirst<{ n: number }>(db, sql); return r?.n ?? 0; } catch { return 0; }
  };
  const list = async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
    try { return (await query<T>(db, sql)) || []; } catch { return []; }
  };

  const kpis = {
    calls_today: await one("SELECT COUNT(*) AS n FROM calls_for_service WHERE date(created_at) = date('now','localtime')"),
    active_calls: await one("SELECT COUNT(*) AS n FROM calls_for_service WHERE COALESCE(status,'') NOT IN ('cleared','closed','cancelled','archived','completed')"),
    avg_response_min: 0,
    units_available: await one("SELECT COUNT(*) AS n FROM units WHERE status = 'available'"),
    units_total: await one('SELECT COUNT(*) AS n FROM units'),
    active_bolos: await one("SELECT COUNT(*) AS n FROM bolos WHERE status = 'active'"),
    anomaly_alerts: await one("SELECT COUNT(*) AS n FROM anomaly_alerts WHERE COALESCE(acknowledged, 0) = 0"),
  };

  const active_calls = await list(
    "SELECT id, call_number, call_type, priority, status, address, created_at FROM calls_for_service WHERE COALESCE(status,'') NOT IN ('cleared','closed','cancelled','archived','completed') ORDER BY created_at DESC LIMIT 50",
  );
  const units = await list('SELECT id, unit_number, status, current_call_number FROM units ORDER BY unit_number LIMIT 200');
  const calls_by_hour = await list(
    "SELECT strftime('%H', created_at) AS hour, COUNT(*) AS count FROM calls_for_service WHERE date(created_at) = date('now','localtime') GROUP BY strftime('%H', created_at) ORDER BY hour",
  );
  const anomaly_alerts = await list('SELECT * FROM anomaly_alerts WHERE COALESCE(acknowledged, 0) = 0 ORDER BY created_at DESC LIMIT 20');

  return c.json({ kpis, active_calls, units, calls_by_hour, anomaly_alerts });
});

export default reports;
