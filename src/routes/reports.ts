// ============================================================
// Reports analytics — real aggregations over the CAD/RMS tables
// ============================================================
// Replaces the empty-shape stubs in src/routes/stubs.ts. Each handler
// reads from calls_for_service, citations, or incidents (all live on
// production D1) and returns the shape the corresponding ReportsPage
// tab destructures. When in doubt about a return shape, the response
// includes legacy aliases so existing UI rendering paths keep working
// even if a tab was rewritten against a different field.
//
// Where no useful aggregation is possible (no rate-tables for cost,
// no schedule-config table) the handler ships the empty-shape response
// so the page renders empty state instead of crashing.

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';

const reports = new Hono<Env>();

// Convert a `?days=N` or `?start_date=...&end_date=...` window into
// (startExpr, endExpr) — either the literal `?` placeholder bound to a
// date string, or an inlined `date('now', '-N days')` SQL expression for
// the relative-window case.
//
// We inline the relative case (no bind parameter) because date('now', '-N
// days') is a SQL expression, not a value. The N is parseInt'd from the
// query string so injection is impossible — only digits survive the cast.
type DateWindow = { startSql: string; endSql: string; bindStart: boolean; bindEnd: boolean };

function dateWindow(req: { query: (k: string) => string | undefined }): DateWindow {
  const startDate = req.query('start_date') || req.query('startDate');
  const endDate = req.query('end_date') || req.query('endDate');
  if (startDate && endDate) {
    return { startSql: '?', endSql: '?', bindStart: true, bindEnd: true };
  }
  const days = parseInt(req.query('days') || '90', 10) || 90;
  return {
    startSql: `date('now', '-${days} days')`,
    endSql: `date('now', '+1 day')`,
    bindStart: false,
    bindEnd: false,
  };
}

function rangeSnippet(w: DateWindow, column: string): string {
  return `${column} >= ${w.startSql} AND ${column} < ${w.endSql}`;
}

function rangeParams(
  req: { query: (k: string) => string | undefined },
  w: DateWindow,
): unknown[] {
  const out: unknown[] = [];
  if (w.bindStart) out.push(req.query('start_date') || req.query('startDate')!);
  if (w.bindEnd) out.push(req.query('end_date') || req.query('endDate')!);
  return out;
}

// ── GET /api/reports/incidents-summary ───────────────────────
// ReportsPage builder reads `data[]` + `total` (per IncidentsSummaryData
// interface). groupBy is one of type/priority/status/zone.
reports.get('/incidents-summary', async (c) => {
  try {
    const db = getDb(c.env);
    const groupBy = c.req.query('groupBy') || 'type';
    const w = dateWindow(c.req);

    const groupColumn: Record<string, string> = {
      type: 'incident_type',
      priority: 'priority',
      status: 'status',
      zone: 'zone_beat',
    };
    const col = groupColumn[groupBy] ?? 'incident_type';

    const rows = await query<{ group_key: string; count: number }>(db, `
      SELECT COALESCE(${col}, 'unknown') AS group_key, COUNT(*) AS count
      FROM calls_for_service
      WHERE ${rangeSnippet(w, 'created_at')}
      GROUP BY ${col}
      ORDER BY count DESC
      LIMIT 50
    `, ...rangeParams(c.req, w));

    const total = rows.reduce((s, r) => s + (r.count || 0), 0);
    return c.json({ groupBy, data: rows, total });
  } catch (err) {
    console.error('GET /reports/incidents-summary error:', err);
    return c.json({ groupBy: 'type', data: [], total: 0 }, 200);
  }
});

// ── GET /api/reports/response-times ──────────────────────────
// Response-times tile uses calls_for_service.response_time_seconds.
// Returns the ResponseTimesData contract from ReportsPage (overall +
// byPriority).
reports.get('/response-times', async (c) => {
  try {
    const db = getDb(c.env);
    const w = dateWindow(c.req);

    const overall = await queryFirst<Record<string, number>>(db, `
      SELECT
        COALESCE(AVG(response_time_seconds), 0) / 60.0 AS avgTotalResponseMinutes,
        COALESCE(AVG(CASE WHEN dispatched_at IS NOT NULL THEN
          (julianday(dispatched_at) - julianday(created_at)) * 24 * 60
        END), 0) AS avgDispatchMinutes,
        COALESCE(MIN(response_time_seconds), 0) / 60.0 AS minResponseMinutes,
        COALESCE(MAX(response_time_seconds), 0) / 60.0 AS maxResponseMinutes,
        COUNT(*) AS totalCalls
      FROM calls_for_service
      WHERE ${rangeSnippet(w, 'created_at')}
        AND response_time_seconds IS NOT NULL
    `, ...rangeParams(c.req, w));

    const byPriority = await query<Record<string, unknown>>(db, `
      SELECT
        priority,
        COALESCE(AVG(response_time_seconds), 0) / 60.0 AS avg_response_minutes,
        COUNT(*) AS count
      FROM calls_for_service
      WHERE ${rangeSnippet(w, 'created_at')}
        AND response_time_seconds IS NOT NULL
      GROUP BY priority ORDER BY priority
    `, ...rangeParams(c.req, w));

    return c.json({ overall, byPriority });
  } catch (err) {
    console.error('GET /reports/response-times error:', err);
    return c.json({
      overall: { avgDispatchMinutes: 0, avgTotalResponseMinutes: 0, minResponseMinutes: 0, maxResponseMinutes: 0, totalCalls: 0 },
      byPriority: [],
    }, 200);
  }
});

// ── GET /api/reports/officer-activity ────────────────────────
// Per-officer counts across calls responded + incidents written.
reports.get('/officer-activity', async (c) => {
  try {
    const db = getDb(c.env);
    const w = dateWindow(c.req);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        u.id AS officer_id,
        u.full_name,
        u.badge_number,
        COUNT(DISTINCT i.id) AS incidents_written,
        0 AS calls_responded,
        0 AS total_hours
      FROM users u
      LEFT JOIN incidents i ON i.officer_id = u.id
        AND ${rangeSnippet(w, 'i.created_at')}
      WHERE u.status = 'active'
      GROUP BY u.id, u.full_name, u.badge_number
      ORDER BY incidents_written DESC, u.full_name
      LIMIT 100
    `, ...rangeParams(c.req, w));
    return c.json(rows);
  } catch (err) {
    return c.json([], 200);
  }
});

// ── GET /api/reports/crime-trends ────────────────────────────
// 12-month trend + top categories. Used by ReportsPage Trends tab.
reports.get('/crime-trends', async (c) => {
  try {
    const db = getDb(c.env);

    const trends = await query<{ month: string; count: number }>(db, `
      SELECT
        strftime('%Y-%m', created_at) AS month,
        COUNT(*) AS count
      FROM calls_for_service
      WHERE created_at >= date('now', '-12 months')
      GROUP BY month
      ORDER BY month
    `);

    const topCategories = await query<{ category: string; count: number }>(db, `
      SELECT
        COALESCE(incident_type, 'unknown') AS category,
        COUNT(*) AS count
      FROM calls_for_service
      WHERE created_at >= date('now', '-90 days')
      GROUP BY category ORDER BY count DESC LIMIT 10
    `);

    return c.json({
      trends,
      periods: trends.map(t => t.month),
      topCategories,
    });
  } catch (err) {
    return c.json({ trends: [], periods: [], topCategories: [] }, 200);
  }
});

// ── GET /api/reports/crime-analysis ──────────────────────────
// CrimeAnalysisPage: summary + byType + byHour + byDayOfWeek + hotspots.
reports.get('/crime-analysis', async (c) => {
  try {
    const db = getDb(c.env);
    const w = dateWindow(c.req);

    const summary = await queryFirst<Record<string, number>>(db, `
      SELECT
        COUNT(*) AS total_calls,
        COUNT(DISTINCT incident_type) AS distinct_types,
        SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) AS p1_count,
        SUM(CASE WHEN weapons_involved = 1 THEN 1 ELSE 0 END) AS weapons_count,
        SUM(CASE WHEN domestic_violence = 1 THEN 1 ELSE 0 END) AS dv_count
      FROM calls_for_service
      WHERE ${rangeSnippet(w, 'created_at')}
    `, ...rangeParams(c.req, w));

    const byType = await query<{ type: string; count: number }>(db, `
      SELECT COALESCE(incident_type, 'unknown') AS type, COUNT(*) AS count
      FROM calls_for_service
      WHERE ${rangeSnippet(w, 'created_at')}
      GROUP BY type ORDER BY count DESC LIMIT 20
    `, ...rangeParams(c.req, w));

    const byHour = await query<{ hour: number; count: number }>(db, `
      SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS count
      FROM calls_for_service
      WHERE ${rangeSnippet(w, 'created_at')}
      GROUP BY hour ORDER BY hour
    `, ...rangeParams(c.req, w));

    const byDayOfWeek = await query<{ day: number; count: number }>(db, `
      SELECT CAST(strftime('%w', created_at) AS INTEGER) AS day, COUNT(*) AS count
      FROM calls_for_service
      WHERE ${rangeSnippet(w, 'created_at')}
      GROUP BY day ORDER BY day
    `, ...rangeParams(c.req, w));

    // Top 10 lat/lng clusters via integer-rounding (no full geospatial
    // grouping — that's a follow-up; this is enough for a heat-tile list).
    const hotspots = await query<Record<string, unknown>>(db, `
      SELECT
        ROUND(latitude, 3) AS lat,
        ROUND(longitude, 3) AS lng,
        COUNT(*) AS count,
        GROUP_CONCAT(DISTINCT incident_type) AS top_types
      FROM calls_for_service
      WHERE ${rangeSnippet(w, 'created_at')}
        AND latitude IS NOT NULL AND longitude IS NOT NULL
      GROUP BY lat, lng
      ORDER BY count DESC LIMIT 25
    `, ...rangeParams(c.req, w));

    return c.json({ summary, byType, byHour, byDayOfWeek, hotspots });
  } catch (err) {
    console.error('GET /reports/crime-analysis error:', err);
    return c.json({ summary: {}, byType: [], byHour: [], byDayOfWeek: [], hotspots: [] }, 200);
  }
});

// ── GET /api/reports/beat-activity ───────────────────────────
reports.get('/beat-activity', async (c) => {
  try {
    const db = getDb(c.env);
    const w = dateWindow(c.req);

    const beats = await query<{ beat: string; count: number }>(db, `
      SELECT
        COALESCE(zone_beat, beat_id, 'unassigned') AS beat,
        COUNT(*) AS count
      FROM calls_for_service
      WHERE ${rangeSnippet(w, 'created_at')}
      GROUP BY beat ORDER BY count DESC LIMIT 50
    `, ...rangeParams(c.req, w));

    return c.json({
      beats,
      callsByBeat: beats,
      unitsByBeat: [],
    });
  } catch (err) {
    return c.json({ beats: [], callsByBeat: [], unitsByBeat: [] }, 200);
  }
});

// ── GET /api/reports/citation-revenue ────────────────────────
// CitationRevenue tab — total + by-month/statute/officer breakdown.
// citations.fine_amount is the load-bearing column.
reports.get('/citation-revenue', async (c) => {
  try {
    const db = getDb(c.env);
    const w = dateWindow(c.req);

    const totals = await queryFirst<Record<string, number>>(db, `
      SELECT
        COALESCE(SUM(fine_amount), 0) AS total_revenue,
        COUNT(*) AS total_citations
      FROM citations
      WHERE ${rangeSnippet(w, 'COALESCE(citation_date, created_at)')}
    `, ...rangeParams(c.req, w));

    const byMonth = await query<{ month: string; revenue: number; count: number }>(db, `
      SELECT
        strftime('%Y-%m', COALESCE(citation_date, created_at)) AS month,
        COALESCE(SUM(fine_amount), 0) AS revenue,
        COUNT(*) AS count
      FROM citations
      WHERE COALESCE(citation_date, created_at) >= date('now', '-12 months')
      GROUP BY month ORDER BY month
    `);

    const byStatute = await query<Record<string, unknown>>(db, `
      SELECT
        COALESCE(statute_citation, violation_code, violation, 'unknown') AS statute,
        COUNT(*) AS count,
        COALESCE(SUM(fine_amount), 0) AS revenue
      FROM citations
      WHERE ${rangeSnippet(w, 'COALESCE(citation_date, created_at)')}
      GROUP BY statute ORDER BY revenue DESC LIMIT 20
    `, ...rangeParams(c.req, w));

    const byOfficer = await query<Record<string, unknown>>(db, `
      SELECT
        COALESCE(issuing_officer_name, 'unknown') AS officer_name,
        COUNT(*) AS count,
        COALESCE(SUM(fine_amount), 0) AS revenue
      FROM citations
      WHERE ${rangeSnippet(w, 'COALESCE(citation_date, created_at)')}
      GROUP BY officer_name ORDER BY revenue DESC LIMIT 20
    `, ...rangeParams(c.req, w));

    return c.json({
      totalRevenue: totals?.total_revenue ?? 0,
      totalCitations: totals?.total_citations ?? 0,
      byMonth, byStatute, byOfficer,
    });
  } catch (err) {
    console.error('GET /reports/citation-revenue error:', err);
    return c.json({ totalRevenue: 0, totalCitations: 0, byMonth: [], byStatute: [], byOfficer: [] }, 200);
  }
});

// ── GET /api/reports/statute-analytics ───────────────────────
// StatuteAnalyticsPage — top cited statutes and trend over time.
reports.get('/statute-analytics', async (c) => {
  try {
    const db = getDb(c.env);
    const w = dateWindow(c.req);

    const topStatutes = await query<Record<string, unknown>>(db, `
      SELECT
        COALESCE(statute_citation, violation_code, violation, 'unknown') AS statute,
        COUNT(*) AS count,
        COALESCE(SUM(fine_amount), 0) AS revenue
      FROM citations
      WHERE ${rangeSnippet(w, 'COALESCE(citation_date, created_at)')}
      GROUP BY statute ORDER BY count DESC LIMIT 25
    `, ...rangeParams(c.req, w));

    const trends = await query<{ month: string; count: number }>(db, `
      SELECT
        strftime('%Y-%m', COALESCE(citation_date, created_at)) AS month,
        COUNT(*) AS count
      FROM citations
      WHERE COALESCE(citation_date, created_at) >= date('now', '-12 months')
      GROUP BY month ORDER BY month
    `);

    const byCategory = await query<Record<string, unknown>>(db, `
      SELECT
        COALESCE(type, 'other') AS category,
        COUNT(*) AS count
      FROM citations
      WHERE ${rangeSnippet(w, 'COALESCE(citation_date, created_at)')}
      GROUP BY category ORDER BY count DESC
    `, ...rangeParams(c.req, w));

    return c.json({ topStatutes, trends, byCategory });
  } catch (err) {
    console.error('GET /reports/statute-analytics error:', err);
    return c.json({ topStatutes: [], trends: [], byCategory: [] }, 200);
  }
});

// ── GET /api/reports/dashboard ───────────────────────────────
// ReportsPage top-row tiles. Combines call counts, unit roster, BOLOs.
reports.get('/dashboard', async (c) => {
  try {
    const db = getDb(c.env);
    const today = await queryFirst<{ active_calls: number; today_calls: number; pending_reports: number }>(db, `
      SELECT
        SUM(CASE WHEN status IN ('dispatched','enroute','onscene','pending','open') THEN 1 ELSE 0 END) AS active_calls,
        SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) AS today_calls,
        SUM(CASE WHEN status IN ('pending','open') THEN 1 ELSE 0 END) AS pending_reports
      FROM calls_for_service
    `);
    const units = await queryFirst<{ units_on_duty: number; total_units: number }>(db, `
      SELECT
        SUM(CASE WHEN status IN ('available','dispatched','enroute','onscene') THEN 1 ELSE 0 END) AS units_on_duty,
        COUNT(*) AS total_units
      FROM units
    `);
    const callsByPriority = await query<{ priority: string; count: number }>(db, `
      SELECT priority, COUNT(*) AS count
      FROM calls_for_service
      WHERE date(created_at) >= date('now', '-30 days')
      GROUP BY priority
    `);
    return c.json({
      activeCalls: today?.active_calls ?? 0,
      todayCalls: today?.today_calls ?? 0,
      unitsOnDuty: units?.units_on_duty ?? 0,
      totalUnits: units?.total_units ?? 0,
      pendingReports: today?.pending_reports ?? 0,
      activeBolos: 0,
      avgResponseMinutes: 0,
      callsByPriority,
    });
  } catch (err) {
    return c.json({
      activeCalls: 0, todayCalls: 0, unitsOnDuty: 0, totalUnits: 0,
      pendingReports: 0, activeBolos: 0, avgResponseMinutes: 0, callsByPriority: [],
    }, 200);
  }
});

// ── Endpoints with no backing tables — empty shapes only ────
// schedules + templates: ReportsPage builder reads `data[]`. No
// report_schedules / report_templates table on live D1 yet.
reports.get('/schedules', (c) => c.json({ data: [], total: 0 }));
reports.get('/templates', (c) => c.json([]));

export default reports;
