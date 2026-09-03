// ============================================================
// RMPG Flex — /api/reports/* aggregations
// ============================================================
// Dashboard endpoints that summarise incidents, citations, and beat
// activity over rolling windows. Replaces the empty-shape stubs from
// src/routes/stubs.ts so the Reports dashboard renders real numbers.
//
// All handlers gated to admin/manager/supervisor — these expose
// org-wide rollups, not officer-level data. Exceptions: /calls-near (the
// patrol-view geo filter every officer hits from the dashboard) and
// /daily-reports/* (the Fleet Daily Blotter), which is NOT open to every
// authenticated user — it is restricted to internal operational roles
// (admin/manager/supervisor/officer/dispatcher; see BLOTTER_ROLES below)
// because the PDF carries call addresses, dispositions, officer names,
// and citations. See the router-level gate below.
//
// Time windows are user-supplied via ?days=N (clamped to [1, 365]).
// SQL filters on created_at (when the record entered the system) —
// not approved_at / disposition_date — so freshly-entered work is
// reflected immediately on the dashboard.
// ============================================================

import { Hono } from 'hono';
import { requireRole } from '../middleware/auth';
import { getDb, query, queryFirst } from '../utils/db';
import { denverDateExpr, denverNowDateExpr, denverHourExpr } from '../utils/denverTime';
import { ACTIVE_CALL_WHERE } from '../utils/callStatus';
import type { Env } from '../types';

import { log } from '../utils/logger';
import { containsClause } from '../utils/searchText';
import dailyReports from './dailyReports';
const reports = new Hono<Env>();

const ANALYTICS_ROLES = ['admin', 'manager', 'supervisor'];

/** Internal operational roles. Deliberately excludes the outward-facing
 *  client_viewer and contract_manager, and human_resources — a blotter is
 *  operational law-enforcement detail, not a client-facing or personnel
 *  document. */
const BLOTTER_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];

// All /reports/* routes are org-wide rollups → elevated roles only, EXCEPT
// /shift-activity/:officerId, which is an officer's own end-of-shift report
// (an officer must be able to pull it from the MDT), and /dashboard, which
// is the top-level tile rollup that every authenticated user sees on the
// homepage. Those routes authorize self-or-open inside their own handler.
reports.use('*', async (c, next) => {
  if (c.req.path.includes('/shift-activity/')) return next();
  if (c.req.path.endsWith('/dashboard')) return next();
  // /calls-near is the patrol-view geo filter — every officer hits it from
  // the dashboard, not just analytics roles.
  if (c.req.path.endsWith('/calls-near')) return next();
  // /daily-reports/* (Fleet Daily Blotter) is not an analytics rollup, so it
  // does not take ANALYTICS_ROLES — but it is NOT open to every authenticated
  // user either. The PDF carries every call's address, disposition and
  // responding officer plus all citations for the day, so outward-facing
  // accounts (client_viewer, contract_manager) and human_resources are
  // excluded. POST /generate is separately gated to admin inside the
  // sub-router (src/routes/dailyReports.ts).
  //
  // ANCHORED deliberately: a bare `.includes('/daily-reports')` also matches
  // any future sibling whose name merely contains that substring (e.g.
  // /api/reports/non-daily-reports-summary), silently widening this gate.
  // Verified c.req.path is the FULL request path (e.g.
  // "/api/reports/daily-reports/by-month"), not a router-relative path, so
  // startsWith with the full mount prefix is correct here — but a bare
  // startsWith('/api/reports/daily-reports') ALSO matches a hypothetical
  // sibling like /api/reports/daily-reports-summary (no path-boundary
  // check), so require an exact match or a '/'-delimited subpath.
  const dailyReportsPath = c.req.path;
  if (dailyReportsPath === '/api/reports/daily-reports'
    || dailyReportsPath.startsWith('/api/reports/daily-reports/')) {
    return requireRole(...BLOTTER_ROLES)(c, next);
  }
  return requireRole(...ANALYTICS_ROLES)(c, next);
});

function clampDays(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 365);
}

// created_at is stored UTC, but "today"/"yesterday" dashboard tiles mean
// Mountain Time. `datetime('now','start of day')` and `DATE('now')` both
// resolve in UTC, so a call made at, say, 11pm MDT (05:00 UTC the NEXT
// day) was silently excluded from "today," or a call from just after UTC
// midnight (still yesterday evening in MT) was counted as "today." Shift
// both sides of every DATE(...)/datetime(...) day comparison via the
// shared denverDateExpr/denverNowDateExpr helpers (utils/denverTime.ts) so
// they compare in Denver-local calendar days — and so this file's DST
// tradeoff can never drift out of sync with the other route files using
// the same pattern.

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
  } catch (err) {
    log.error('GET /incidents-summary failed', { src: 'src/routes/reports.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// GET /api/reports/dashboard-unified-stats
// Feeds the Dashboard's Warrants/Incidents summary panel
// (client/src/pages/DashboardPage.tsx `unifiedStats`). That panel was built
// against this exact shape but nothing ever fetched it, so it rendered
// nothing — see project memory for the 2026-08 dispatch/dashboard audit.
reports.get('/dashboard-unified-stats', async (c) => {
  try {
    const db = getDb(c.env);

    const warrantsActive = await queryFirst<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM warrants WHERE status = 'active'`
    );
    const warrantsByType = await query<{ type: string; count: number }>(
      db,
      `SELECT type, COUNT(*) AS count
         FROM warrants
        WHERE status = 'active'
        GROUP BY type
        ORDER BY count DESC`
    );
    const warrantsServed30d = await queryFirst<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM warrants WHERE status = 'served' AND served_at >= datetime('now', '-30 days')`
    );

    const incidentsByStatus = await query<{ status: string; count: number }>(
      db,
      `SELECT status, COUNT(*) AS count
         FROM incidents
        WHERE created_at >= datetime('now', '-30 days')
        GROUP BY status
        ORDER BY count DESC`
    );
    const incidentsByType = await query<{ type: string; count: number }>(
      db,
      `SELECT incident_type AS type, COUNT(*) AS count
         FROM incidents
        WHERE created_at >= datetime('now', '-30 days')
        GROUP BY incident_type
        ORDER BY count DESC`
    );

    return c.json({
      warrants: {
        active: warrantsActive?.n ?? 0,
        by_type: Object.fromEntries(warrantsByType.map(r => [r.type, r.count])),
        served_30d: warrantsServed30d?.n ?? 0,
      },
      incidents: {
        by_status: incidentsByStatus,
        by_type: incidentsByType,
      },
    });
  } catch (err) {
    log.error('GET /dashboard-unified-stats failed', { src: 'src/routes/reports.ts' }, err);
    return c.json({ error: 'Failed' }, 500);
  }
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

  // Build a month-over-month comparison table for the CrimeTrendCard:
  // each row = { type, current(this month), previous(prev month), momChange%,
  //              lastYear(same month prev year), yoyChange% }.
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevMonth = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const sameMonthLastYear = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const byTypeMonth = await query<{ type: string; month: string; count: number }>(
    db,
    `SELECT incident_type AS type, strftime('%Y-%m', created_at) AS month, COUNT(*) AS count
       FROM incidents
      WHERE created_at >= datetime('now', '-${Math.max(days, 365)} days')
      GROUP BY incident_type, strftime('%Y-%m', created_at)`,
  );
  // Pivot: type -> month -> count
  const pivot: Record<string, Record<string, number>> = {};
  for (const r of byTypeMonth) {
    if (!pivot[r.type]) pivot[r.type] = {};
    pivot[r.type][r.month] = r.count;
  }
  const trendRows = Object.entries(pivot)
    .map(([type, months]) => {
      const current = months[thisMonth] ?? 0;
      const previous = months[prevMonth] ?? 0;
      const lastYear = months[sameMonthLastYear] ?? 0;
      const momChange = previous > 0 ? Math.round(((current - previous) / previous) * 100) : (current > 0 ? 100 : 0);
      const yoyChange = lastYear > 0 ? Math.round(((current - lastYear) / lastYear) * 100) : (current > 0 ? 100 : 0);
      return { type, current, previous, momChange, lastYear, yoyChange };
    })
    .filter(r => r.current > 0 || r.previous > 0)
    .sort((a, b) => b.current - a.current)
    .slice(0, 15);

  // monthlyTrend: aggregate all types per month for the area chart
  const monthlyMap: Record<string, number> = {};
  for (const r of byTypeMonth) {
    monthlyMap[r.month] = (monthlyMap[r.month] ?? 0) + r.count;
  }
  const monthlyTrend = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));

  return c.json({ days, trends: trendRows, monthlyTrend, top_categories });
  } catch (err) {
    log.error('GET /crime-trends failed', { src: 'src/routes/reports.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

// GET /api/reports/beat-activity?days=30
// One row per active beat with call/incident/citation counts + average
// response time (minutes). Joins:
//   calls    — calls_for_service.beat_id = dispatch_beats.beat_code
//   incidents — via calls_for_service (incidents have no beat_id of their own)
//   citations — citations.beat_id = dispatch_beats.beat_code
//   response — AVG(calls_for_service.response_time_seconds) per beat, minutes.
//     response_time_seconds is populated on arrival (see dispatch/calls.ts's
//     onscene handler: (julianday(onscene_at) - julianday(dispatched_at)) *
//     86400), so this is real observed dispatch-to-arrival time, not a
//     theoretical drive-time estimate. Beats with zero arrived calls in the
//     window get avg_response_min: null (the client's map layer already
//     treats null distinctly from 0 — see useMapboxResponseTime.ts).
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
    avg_response_min: number | null;
  }>(
    db,
    `SELECT b.beat_code,
            b.beat_name,
            b.district_letter,
            COALESCE(c.n, 0)  AS calls,
            COALESCE(i.n, 0)  AS incidents,
            COALESCE(ci.n, 0) AS citations,
            r.avg_min AS avg_response_min
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
       LEFT JOIN (
         SELECT beat_id, AVG(response_time_seconds) / 60.0 AS avg_min
           FROM calls_for_service
          WHERE created_at >= datetime('now', ?)
            AND response_time_seconds IS NOT NULL
          GROUP BY beat_id
       ) r  ON r.beat_id = b.beat_code
      WHERE b.active = 1
      ORDER BY (COALESCE(c.n,0) + COALESCE(i.n,0) + COALESCE(ci.n,0)) DESC,
               b.beat_code ASC`,
    since, since, since, since
  );

  return c.json({ days, beats });
  } catch (err) {
    log.error('GET /beat-activity failed', { src: 'src/routes/reports.ts' }, err); return c.json({ error: 'Failed' }, 500); }
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

  // Return the shape the CitationRevenueCard client reads:
  // summary.{total_fines, collected, outstanding, dismissed} + monthlyRevenue[].
  // The citation_payments table tracks individual payments; citations.status
  // tells us whether a fine was dismissed.  "Collected" = payments received,
  // "Outstanding" = unpaid non-dismissed citations, "Dismissed" = waived.
  const totalFines = await queryFirst<{ n: number }>(
    db, `SELECT COALESCE(SUM(COALESCE(fine_amount,0)),0) AS n FROM citations WHERE created_at >= datetime('now', ?)`, since
  );
  const outstanding = await queryFirst<{ n: number }>(
    db, `SELECT COALESCE(SUM(COALESCE(fine_amount,0)),0) AS n FROM citations WHERE status NOT IN ('dismissed','paid','waived') AND created_at >= datetime('now', ?)`, since
  );
  const dismissed = await queryFirst<{ n: number }>(
    db, `SELECT COALESCE(SUM(COALESCE(fine_amount,0)),0) AS n FROM citations WHERE status IN ('dismissed','waived') AND created_at >= datetime('now', ?)`, since
  );

  return c.json({
    days,
    summary: {
      total_fines: totalFines?.n ?? 0,
      collected: total?.total_revenue ?? 0,
      outstanding: outstanding?.n ?? 0,
      dismissed: dismissed?.n ?? 0,
    },
    monthlyRevenue: by_month.map(r => ({ month: r.month, collected: r.revenue, outstanding: 0 })),
    by_violation,
    payment_count: total?.payment_count ?? 0,
  });
  } catch (err) {
    log.error('GET /citation-revenue failed', { src: 'src/routes/reports.ts' }, err); return c.json({ error: 'Failed' }, 500); }
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
  } catch (err) {
    log.error('GET /statute-analytics failed', { src: 'src/routes/reports.ts' }, err); return c.json({ error: 'Failed' }, 500); }
});

/**
 * Response-time SLA target, in minutes. Single source of truth.
 *
 * Returned to the client as `overall.slaTargetMinutes` so the dashboard tile
 * and the trend chart's target line cannot drift from the value the compliance
 * percentage is actually computed against — ReportsPage previously hardcoded
 * `<= 5` in one place and `targetMinutes: 5` in another, with nothing tying
 * them to the server.
 */
const SLA_TARGET_MINUTES = 5;

// GET /api/reports/response-times?days=N
// Computes avg/min/max response minutes from calls_for_service using
// COALESCE(response_time_seconds/60, onscene_at-created_at) with ?days=N
// window (default 30). Returns the ResponseTimesData shape the client reads.
reports.get('/response-times', async (c) => {
  try {
    const db = getDb(c.env);
    const days = clampDays(c.req.query('days'), 30);
    const since = `-${days} days`;
    const RESP = `COALESCE(response_time_seconds / 60.0, CASE WHEN dispatched_at IS NOT NULL THEN (julianday(onscene_at) - julianday(dispatched_at)) * 1440 END)`;

    const overall = await queryFirst<{
      avgDispatch: number | null;
      avgTotal: number | null;
      minResp: number | null;
      maxResp: number | null;
      total: number;
      slaMetCount: number;
    }>(db, `
      SELECT
        ROUND(AVG(${RESP}), 1) AS avgTotal,
        ROUND(MIN(${RESP}), 1) AS minResp,
        ROUND(MAX(${RESP}), 1) AS maxResp,
        COUNT(*) AS total,
        SUM(CASE WHEN ${RESP} <= ${SLA_TARGET_MINUTES} THEN 1 ELSE 0 END) AS slaMetCount
      FROM calls_for_service
      WHERE created_at >= datetime('now', ?)
        AND (response_time_seconds IS NOT NULL OR onscene_at IS NOT NULL)
    `, since);

    const byPriority = await query<{ priority: string; avg_response_minutes: number; count: number }>(
      db,
      `SELECT priority,
              ROUND(AVG(${RESP}), 1) AS avg_response_minutes,
              COUNT(*) AS count
         FROM calls_for_service
        WHERE created_at >= datetime('now', ?)
          AND (response_time_seconds IS NOT NULL OR onscene_at IS NOT NULL)
          AND priority IS NOT NULL
        GROUP BY priority
        ORDER BY priority`,
      since,
    );

    const dailyTrend = await query<{ date: string; avg_response_minutes: number; count: number }>(
      db,
      `SELECT date(created_at) AS date,
              ROUND(AVG(${RESP}), 1) AS avg_response_minutes,
              COUNT(*) AS count
         FROM calls_for_service
        WHERE created_at >= datetime('now', ?)
          AND (response_time_seconds IS NOT NULL OR onscene_at IS NOT NULL)
        GROUP BY date(created_at)
        ORDER BY date ASC`,
      since,
    );

    return c.json({
      overall: {
        avgDispatchMinutes: overall?.avgTotal ?? 0,
        avgTotalResponseMinutes: overall?.avgTotal ?? 0,
        minResponseMinutes: overall?.minResp ?? 0,
        maxResponseMinutes: overall?.maxResp ?? 0,
        totalCalls: overall?.total ?? 0,
        // PER-CALL SLA compliance. ReportsPage previously derived this from
        // dailyTrend by counting a whole day's calls as met when that DAY'S
        // AVERAGE was <= target -- wrong in both directions: a day averaging
        // 4.9 credited every call even if several took 20 minutes, and a day
        // averaging 5.1 credited none even if most were under target. The
        // client cannot fix it alone, because dailyTrend carries only averages.
        slaMetCount: overall?.slaMetCount ?? 0,
        slaTargetMinutes: SLA_TARGET_MINUTES,
      },
      byPriority,
      dailyTrend,
    });
  } catch {
    return c.json({ overall: { avgDispatchMinutes: 0, avgTotalResponseMinutes: 0, minResponseMinutes: 0, maxResponseMinutes: 0, totalCalls: 0, slaMetCount: 0, slaTargetMinutes: SLA_TARGET_MINUTES }, byPriority: [], dailyTrend: [] });
  }
});

reports.get('/officer-activity', async (c) => {
  const db = getDb(c.env);
  try {
    const rows = await query<Record<string, unknown>>(db, `
      SELECT u.officer_id, usr.full_name, usr.badge_number,
        (SELECT COUNT(*) FROM incidents i WHERE i.officer_id = u.officer_id) AS incidents_written,
        -- assigned_unit_ids is a JSON array ('[1,12,21]'); a substring LIKE
        -- made unit 1 match 11/21/100 and inflated low-id units' counts.
        (SELECT COUNT(*) FROM calls_for_service c
           WHERE EXISTS (SELECT 1 FROM json_each(c.assigned_unit_ids) je WHERE je.value = u.id)) AS calls_responded,
        -- Was a hardcoded 0, so this column read "0 hours" for every officer
        -- on the report even though time_entries has the real total (one
        -- officer on live has 498.8 logged hours). A hardcoded metric is worse
        -- than an empty one: it renders as data and looks authoritative.
        (SELECT ROUND(COALESCE(SUM(te.total_hours), 0), 1)
           FROM time_entries te WHERE te.officer_id = u.officer_id) AS total_hours
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.officer_id IS NOT NULL
      ORDER BY usr.full_name
    `);
    return c.json(rows.map(r => ({
      officer_id: r.officer_id ?? 0,
      full_name: r.full_name ?? 'Unknown',
      badge_number: r.badge_number ?? '',
      incidents_written: r.incidents_written ?? 0,
      calls_responded: r.calls_responded ?? 0,
      total_hours: r.total_hours ?? 0,
    })));
  } catch {
    return c.json([]);
  }
});

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
    calls_today: await one(`SELECT COUNT(*) AS n FROM calls_for_service WHERE ${denverDateExpr('created_at')} = ${denverNowDateExpr()}`),
    active_calls: await one(`SELECT COUNT(*) AS n FROM calls_for_service WHERE ${ACTIVE_CALL_WHERE}`),
    avg_response_min: 0,
    units_available: await one("SELECT COUNT(*) AS n FROM units WHERE status = 'available'"),
    units_total: await one('SELECT COUNT(*) AS n FROM units'),
    active_bolos: await one("SELECT COUNT(*) AS n FROM bolos WHERE status = 'active'"),
    // anomaly_alerts has no boolean `acknowledged` — acknowledged_at is the flag.
    anomaly_alerts: await one('SELECT COUNT(*) AS n FROM anomaly_alerts WHERE acknowledged_at IS NULL'),
  };

  // calls_for_service has no call_type/address columns — it's incident_type/
  // location_address (see shift-activity below, anomalies.ts). Those wrong
  // names made this SELECT throw on every request; list()'s catch swallowed
  // it to [], while kpis.active_calls (a plain COUNT with no such columns)
  // kept succeeding — so the KPI tile and the call-queue panel permanently
  // disagreed (e.g. "2 ACTIVE CALLS" next to an empty "ACTIVE CALLS (0)"
  // queue). CommandCenterPage.tsx already reads call.incident_type/
  // call.location_address with a call_type/address fallback, so this fix
  // alone is enough — no client change needed.
  const active_calls = await list(
    `SELECT id, call_number, incident_type, priority, status, location_address, created_at FROM calls_for_service WHERE ${ACTIVE_CALL_WHERE} ORDER BY created_at DESC LIMIT 50`,
  );
  // units has call_sign / current_call_id — no unit_number or
  // current_call_number — so this threw "no such column: unit_number".
  // Aliased to keep the response shape this code intended.
  const units = await list('SELECT id, call_sign AS unit_number, status, current_call_id AS current_call_number FROM units ORDER BY call_sign LIMIT 200');
  const calls_by_hour = await list(
    // Both the day bucket AND the hour label must be Denver-local: the hour is
    // what the chart's x-axis shows an operator, and raw strftime('%H') reads
    // the UTC hour, shifting every call 6-7 hours from when it actually
    // happened. Sibling queries in this file were already converted; this one
    // was missed.
    `SELECT ${denverHourExpr('created_at')} AS hour, COUNT(*) AS count
       FROM calls_for_service
      WHERE ${denverDateExpr('created_at')} = ${denverNowDateExpr()}
      GROUP BY hour ORDER BY hour`,
  );
  // No boolean `acknowledged` column — acknowledged_at is the flag.
  const anomaly_alerts = await list('SELECT * FROM anomaly_alerts WHERE acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 20');

  return c.json({ kpis, active_calls, units, calls_by_hour, anomaly_alerts });
});

// GET /api/reports/shift-activity/:officerId?date=YYYY-MM-DD
// Officer end-of-shift report (MDT "Generate End-of-Shift Report"). Returns the
// EXACT shape MdtPage consumes: officer, date, calls[], incidents[], scans[],
// citations[], fieldInterviews[], and a summary of counts. Self-or-elevated
// access (this route is exempted from the org-wide gate above). All referenced
// columns verified present on live D1 (calls_for_service, incidents,
// patrol_scans+patrol_checkpoints, citations, field_interviews all key on
// officer_id / created_at; field_interviews has subject_first/last_name +
// contact_reason — NOT subject_name/reason).
reports.get('/shift-activity/:officerId', async (c) => {
  const officerId = c.req.param('officerId');
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);
  const actor = c.get('user') as { id: number; role: string } | undefined;
  const elevated = !!actor && ['admin', 'manager', 'supervisor', 'dispatcher'].includes(actor.role);
  if (!actor || (!elevated && String(actor.id) !== String(officerId))) {
    return c.json({ error: 'Forbidden', code: 'NOT_SELF_OR_ELEVATED' }, 403);
  }
  try {
    const db = getDb(c.env);
    const officer = await queryFirst<Record<string, unknown>>(
      db, 'SELECT id, full_name, badge_number, email, role FROM users WHERE id = ?', officerId);
    if (!officer) return c.json({ error: 'Officer not found', code: 'OFFICER_NOT_FOUND' }, 404);

    // Resolve the officer's unit so calls assigned to that unit are attributed.
    const unit = await queryFirst<{ id: number }>(db, 'SELECT id FROM units WHERE officer_id = ? LIMIT 1', officerId);
    const unitId = unit?.id != null ? String(unit.id) : ''; // sentinel that never matches

    const safeList = async <T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> => {
      try { return (await query<T>(db, sql, ...params)) || []; } catch (e) { console.error('shift-activity sub-query failed:', e); return []; }
    };

    const calls = await safeList(
      `SELECT id, call_number, incident_type, priority, status, location_address, created_at
       FROM calls_for_service
       WHERE date(created_at) = ?
         AND (dispatcher_id = ? OR reporting_officer_id = ?
              OR (SELECT COUNT(*) FROM json_each(assigned_unit_ids) WHERE CAST(value AS TEXT) = ?) > 0)
       ORDER BY created_at ASC LIMIT 1000`, date, officerId, officerId, String(unitId));
    const incidents = await safeList(
      `SELECT id, incident_number, incident_type, priority, status, location_address, narrative, created_at
       FROM incidents WHERE date(created_at) = ? AND officer_id = ?
       ORDER BY created_at ASC LIMIT 1000`, date, officerId);
    const scans = await safeList(
      `SELECT ps.id, ps.scanned_at, ps.status, pc.name AS checkpoint_name
       FROM patrol_scans ps LEFT JOIN patrol_checkpoints pc ON pc.id = ps.checkpoint_id
       WHERE date(ps.scanned_at) = ? AND ps.officer_id = ?
       ORDER BY ps.scanned_at ASC LIMIT 1000`, date, officerId);
    const citations = await safeList(
      `SELECT id, citation_number, violation_description, location, status, created_at
       FROM citations WHERE date(created_at) = ? AND (officer_id = ? OR issuing_officer_id = ?)
       ORDER BY created_at ASC LIMIT 1000`, date, officerId, officerId);
    const fieldInterviews = await safeList(
      `SELECT id, fi_number,
              TRIM(COALESCE(subject_first_name,'') || ' ' || COALESCE(subject_last_name,'')) AS subject_name,
              location, contact_reason, created_at
       FROM field_interviews WHERE date(created_at) = ? AND officer_id = ?
       ORDER BY created_at ASC LIMIT 1000`, date, officerId);

    return c.json({
      officer, date, calls, incidents, scans, citations, fieldInterviews,
      summary: {
        totalCalls: calls.length,
        totalIncidents: incidents.length,
        totalScans: scans.length,
        totalCitations: citations.length,
        totalFieldInterviews: fieldInterviews.length,
      },
    });
  } catch (err) {
    console.error('GET /reports/shift-activity failed:', err);
    return c.json({ error: 'Failed to build shift report', code: 'SHIFT_ACTIVITY_ERROR' }, 500);
  }
});

// GET /api/reports/dashboard — top-level tiles for the DashboardPage +
// GET /dashboard — main Dashboard KPI tiles. Client expects DashboardApiResponse shape.
reports.get('/dashboard', async (c) => {
  try {
    const db = getDb(c.env);
    const [calls, unitsOn, totalUnits, pending, bolos, avgResp, byPriority, byStatus, byHour, officers] = await Promise.all([
      queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM calls_for_service WHERE ${ACTIVE_CALL_WHERE}`),
      queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM units WHERE status NOT IN ('off_duty','out_of_service')"),
      queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM units'),
      queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM incidents WHERE status IN ('draft','submitted','under_review')"),
      queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM bolos WHERE status = 'active'"),
      // Live column is response_time_seconds (NOT _sec — that typo made this
      // query throw "no such column", which rejected the whole Promise.all and
      // served every dashboard tile from the all-zeros catch fallback). The
      // column is also NULL on all current live rows, so fall back to the
      // onscene_at − created_at delta when it's missing.
      queryFirst<{ avg: number | null }>(db, "SELECT ROUND(AVG(COALESCE(response_time_seconds / 60.0, CASE WHEN dispatched_at IS NOT NULL THEN (julianday(onscene_at) - julianday(dispatched_at)) * 1440 END)), 1) AS avg FROM calls_for_service WHERE (response_time_seconds IS NOT NULL OR onscene_at IS NOT NULL) AND created_at >= datetime('now','-24 hours')"),
      query<{ priority: string; count: number }>(db, `SELECT priority, COUNT(*) AS count FROM calls_for_service WHERE ${ACTIVE_CALL_WHERE} GROUP BY priority`),
      query<{ status: string; count: number }>(db, "SELECT status, COUNT(*) AS count FROM calls_for_service GROUP BY status"),
      query<{ hour: string; count: number }>(db, "SELECT strftime('%H', created_at) AS hour, COUNT(*) AS count FROM calls_for_service WHERE created_at >= datetime('now','-24 hours') GROUP BY hour ORDER BY hour"),
      query<Record<string, unknown>>(db, "SELECT u.id, usr.full_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.status NOT IN ('off_duty','out_of_service')"),
    ]);
    const todayCalls = await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM calls_for_service WHERE ${denverDateExpr('created_at')} = ${denverNowDateExpr()}`);
    // incidents_today was never computed server-side — the client defaulted it
    // to pendingReports (open_incidents), so the dashboard tile showed "all
    // open incidents" under a "today" label regardless of when they were
    // created. Real count, incidents table.
    const incidentsToday = await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM incidents WHERE ${denverDateExpr('created_at')} = ${denverNowDateExpr()}`);
    // Secondary stat-card metrics (added 2026-06-21 — the DashboardPage Status
    // Summary row reads these but they were never returned, so 3 of 4 cards
    // permanently showed 0). Tolerant of missing tables/cols on dev/empty
    // databases so a single missing schema element can't blank the whole tile.
    const safeCount = async (sql: string): Promise<number> => {
      try { return (await queryFirst<{ n: number }>(db, sql))?.n ?? 0; } catch { return 0; }
    };
    const [activeWarrants, pendingServe, openCases, totalPersons] = await Promise.all([
      safeCount("SELECT COUNT(*) AS n FROM warrants WHERE status='active' AND archived_at IS NULL"),
      safeCount("SELECT COUNT(*) AS n FROM serve_queue WHERE status='pending'"),
      safeCount("SELECT COUNT(*) AS n FROM cases WHERE status NOT LIKE 'closed%' AND archived_at IS NULL"),
      safeCount('SELECT COUNT(*) AS n FROM persons'),
    ]);
    return c.json({
      activeCalls: calls?.n ?? 0,
      todayCalls: todayCalls?.n ?? 0,
      incidentsToday: incidentsToday?.n ?? 0,
      unitsOnDuty: unitsOn?.n ?? 0,
      totalUnits: totalUnits?.n ?? 0,
      pendingReports: pending?.n ?? 0,
      activeBolos: bolos?.n ?? 0,
      unreadMessages: 0,
      avgResponseMinutes: avgResp?.avg ?? null,
      callsByPriority: byPriority,
      callsByStatus: byStatus,
      recentActivity: [],
      officersOnDuty: officers,
      callsByHour: byHour,
      activeWarrants,
      pendingServe,
      openCases,
      totalPersons,
    });
  } catch (err) {
    console.error('[reports] GET /dashboard failed:', err);
    return c.json({ activeCalls: 0, todayCalls: 0, unitsOnDuty: 0, totalUnits: 0, pendingReports: 0, activeBolos: 0, unreadMessages: 0, avgResponseMinutes: null, callsByPriority: [], callsByStatus: [], recentActivity: [], officersOnDuty: [], callsByHour: [], activeWarrants: 0, pendingServe: 0, openCases: 0, totalPersons: 0 });
  }
});

// GET /api/reports/calls-near — patrol-view geo filter for the dashboard's
// "Calls Near Me" panel. Returns currently-active calls within `radius_mi`
// of the supplied coordinates, ordered by distance.
//
// Haversine in SQLite: cheap enough for our call volume (~hundreds of open
// rows max). Filters callers without lat/lng out (they can't be "near"
// anything geographically). Default radius is 5 miles — enough to cover an
// urban beat without flooding the panel.
reports.get('/calls-near', async (c) => {
  const latRaw = c.req.query('lat');
  const lngRaw = c.req.query('lng');
  const radiusRaw = c.req.query('radius_mi');
  const lat = latRaw != null ? Number(latRaw) : NaN;
  const lng = lngRaw != null ? Number(lngRaw) : NaN;
  const radius = Math.max(0.25, Math.min(50, radiusRaw != null ? Number(radiusRaw) || 5 : 5));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ error: 'lat and lng query params are required' }, 400);
  }
  try {
    const db = getDb(c.env);
    // Pre-filter in SQL with a cheap bounding box, then refine with exact
    // haversine in JS. Avoids relying on D1's math functions (SIN/RADIANS),
    // which aren't universally guaranteed across SQLite builds. The box
    // overscan is tiny — N candidate rows × tiny math = negligible work.
    const latDeg = radius / 69; // 1° latitude ≈ 69 mi
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const lngDeg = radius / (69 * Math.max(0.0001, Math.abs(cosLat)));
    const latMin = lat - latDeg, latMax = lat + latDeg;
    const lngMin = lng - lngDeg, lngMax = lng + lngDeg;
    const candidates = await query<{
      id: number; call_number: string; priority: string; status: string;
      location_address: string | null; description: string | null;
      latitude: number; longitude: number; created_at: string;
    }>(db, `
      SELECT id, call_number, priority, status, location_address, description,
             latitude, longitude, created_at
      FROM calls_for_service
      WHERE ${ACTIVE_CALL_WHERE}
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
      LIMIT 200
    `, latMin, latMax, lngMin, lngMax);
    const toRad = (d: number) => (d * Math.PI) / 180;
    const haversineMi = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
      const R = 3959;
      const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
      const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.asin(Math.sqrt(a));
    };
    const calls = candidates
      .map((r) => ({ ...r, distance_mi: haversineMi(lat, lng, r.latitude, r.longitude) }))
      .filter((r) => r.distance_mi <= radius)
      .sort((a, b) => a.distance_mi - b.distance_mi)
      .slice(0, 25);
    return c.json({ calls, origin: { lat, lng }, radius_mi: radius });
  } catch (err) {
    console.error('[reports] GET /calls-near failed:', err);
    return c.json({ calls: [], origin: { lat, lng }, radius_mi: radius }, 200);
  }
});

// ────────────────────────────────────────────────────────────
// GET /api/reports/crime-analysis — ILP dashboard (CrimeAnalysisPage)
//
// The page shipped fully built but the endpoint was only ever a proxy STUB
// ("no crime-analysis report yet") whose flat shape didn't match the client
// contract, so /crime-analysis rendered a permanent "No data available".
// This is the real handler. Client contract (see CrimeAnalysisPage.tsx):
//   { data: { topOffenses[], hotspots[], dayOfWeek[], timeOfDay[],
//             trendData[], clearanceRate{rate}, responseMetrics[],
//             repeatOffenders[] } }
//
// Window: ?days=N (clamped 1–365, default 90) or ?start_date&end_date
// (YYYY-MM-DD). Everything filters calls_for_service.created_at.
//
// Live-schema notes (verified on D1 785de7ae 2026-06-09):
//   • response_time_seconds is NULL on all rows → derive minutes from
//     onscene_at − created_at when missing.
//   • "cleared" = non-empty disposition (free-text codes: RTF, PS Served…).
//   • priority values are P1–P4 → map to the client's
//     critical/high/normal/low target buckets.
// ────────────────────────────────────────────────────────────

/** Build the created_at WHERE clause + binds from ?days / ?start_date&end_date. */
function crimeWindow(c: { req: { query: (k: string) => string | undefined } }): { where: string; binds: string[] } {
  const start = c.req.query('start_date');
  const end = c.req.query('end_date');
  if (start && end && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
    // end_date is inclusive — compare against the start of the NEXT day.
    return { where: "created_at >= ? AND created_at < datetime(?, '+1 day')", binds: [start, end] };
  }
  const days = clampDays(c.req.query('days'), 90);
  return { where: "created_at >= datetime('now', ?)", binds: [`-${days} days`] };
}

// Shared SELECT expression: response minutes with the timestamp fallback.
// Fallback measures dispatched_at -> onscene_at (actual dispatch-to-arrival),
// NOT created_at -> onscene_at (which also bakes in queue-wait time before a
// unit was ever assigned). response_time_seconds is now populated going
// forward (see the /:id/status handler); this fallback only covers rows
// created before that, or where dispatched_at was never recorded.
const RESPONSE_MINUTES =
  "COALESCE(response_time_seconds / 60.0, CASE WHEN dispatched_at IS NOT NULL THEN (julianday(onscene_at) - julianday(dispatched_at)) * 1440 END)";

async function buildCrimeAnalysis(db: D1Database, where: string, binds: string[]) {
  const [topOffenses, hotspots, dayOfWeek, timeOfDay, trendData, clearance, responseRaw, repeatOffenders] =
    await Promise.all([
      query<{ offense_type: string; count: number }>(
        db,
        `SELECT COALESCE(NULLIF(TRIM(incident_type), ''), 'Unknown') AS offense_type, COUNT(*) AS count
           FROM calls_for_service WHERE ${where}
          GROUP BY offense_type ORDER BY count DESC LIMIT 15`,
        ...binds
      ),
      query<{ location: string; count: number; lat: number | null; lng: number | null }>(
        db,
        `SELECT COALESCE(NULLIF(TRIM(location_address), ''), 'Unknown') AS location, COUNT(*) AS count,
                AVG(latitude) AS lat, AVG(longitude) AS lng
           FROM calls_for_service WHERE ${where}
          GROUP BY location ORDER BY count DESC LIMIT 15`,
        ...binds
      ),
      query<{ day_of_week: number; count: number }>(
        db,
        `SELECT CAST(strftime('%w', created_at) AS INTEGER) AS day_of_week, COUNT(*) AS count
           FROM calls_for_service WHERE ${where}
          GROUP BY day_of_week ORDER BY day_of_week`,
        ...binds
      ),
      query<{ hour: number; count: number }>(
        db,
        `SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS count
           FROM calls_for_service WHERE ${where}
          GROUP BY hour ORDER BY hour`,
        ...binds
      ),
      query<{ month: string; count: number }>(
        db,
        `SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count
           FROM calls_for_service WHERE ${where}
          GROUP BY month ORDER BY month`,
        ...binds
      ),
      queryFirst<{ total: number; cleared: number }>(
        db,
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN disposition IS NOT NULL AND TRIM(disposition) != '' THEN 1 ELSE 0 END) AS cleared
           FROM calls_for_service WHERE ${where}`,
        ...binds
      ),
      query<{ priority: string; avg_minutes: number | null; call_count: number }>(
        db,
        `SELECT priority, ROUND(AVG(${RESPONSE_MINUTES}), 1) AS avg_minutes, COUNT(*) AS call_count
           FROM calls_for_service
          WHERE ${where} AND priority IS NOT NULL
            AND (response_time_seconds IS NOT NULL OR onscene_at IS NOT NULL)
          GROUP BY priority ORDER BY priority`,
        ...binds
      ),
      // Repeat offenders: distinct calls + incidents a person is linked to
      // inside the window, 3+ events. Role-filtered to 'involved' — live
      // call_persons roles also include serve_recipient(_agent) and
      // incident_persons has witness, none of which are "offenders". UNION
      // (not UNION ALL) dedupes a person linked to the same event twice.
      // EVERY created_at in the window clause must be table-qualified —
      // call_persons has its own created_at, so an unqualified reference is
      // ambiguous.
      query<{ name: string; incident_count: number }>(
        db,
        `SELECT TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS name,
                COUNT(*) AS incident_count
           FROM (
             SELECT cp.person_id, 'c' || cp.call_id AS evt
               FROM call_persons cp JOIN calls_for_service cfs ON cfs.id = cp.call_id
              WHERE cp.role = 'involved' AND ${where.replaceAll('created_at', 'cfs.created_at')}
             UNION
             SELECT ip.person_id, 'i' || ip.incident_id
               FROM incident_persons ip JOIN incidents i ON i.id = ip.incident_id
              WHERE ip.role = 'involved' AND ${where.replaceAll('created_at', 'i.created_at')}
           ) ev
           JOIN persons p ON p.id = ev.person_id
          GROUP BY ev.person_id HAVING COUNT(*) >= 3
          ORDER BY incident_count DESC LIMIT 25`,
        ...binds, ...binds
      ),
    ]);

  // P1–P4 → the client's responseTargets/label buckets.
  const prioLabel: Record<string, string> = { P1: 'critical', P2: 'high', P3: 'normal', P4: 'low' };
  const responseMetrics = responseRaw.map((m) => ({
    priority: prioLabel[m.priority] ?? String(m.priority ?? '').toLowerCase(),
    avg_minutes: m.avg_minutes,
    call_count: m.call_count,
  }));

  const total = clearance?.total ?? 0;
  const cleared = clearance?.cleared ?? 0;
  return {
    topOffenses,
    hotspots,
    dayOfWeek,
    timeOfDay,
    trendData,
    clearanceRate: { rate: total > 0 ? Math.round((cleared / total) * 100) : 0, cleared, total },
    responseMetrics,
    repeatOffenders,
  };
}

reports.get('/crime-analysis', async (c) => {
  try {
    const db = getDb(c.env);
    const { where, binds } = crimeWindow(c);
    const data = await buildCrimeAnalysis(db, where, binds);
    return c.json({ data });
  } catch (err) {
    console.error('[reports] GET /crime-analysis failed:', err);
    return c.json({ error: 'Failed to build crime analysis', code: 'CRIME_ANALYSIS_ERROR' }, 500);
  }
});

// GET /api/reports/crime-analysis/export?format=csv — ExportButton target.
reports.get('/crime-analysis/export', async (c) => {
  try {
    const db = getDb(c.env);
    const { where, binds } = crimeWindow(c);
    const d = await buildCrimeAnalysis(db, where, binds);
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    };
    const lines: string[] = ['section,name,value'];
    lines.push(`summary,total_incidents,${d.clearanceRate.total}`);
    lines.push(`summary,clearance_rate_pct,${d.clearanceRate.rate}`);
    for (const o of d.topOffenses) lines.push(`top_offenses,${esc(o.offense_type)},${o.count}`);
    for (const h of d.hotspots) lines.push(`hotspots,${esc(h.location)},${h.count}`);
    for (const r of d.dayOfWeek) lines.push(`day_of_week,${r.day_of_week},${r.count}`);
    for (const t of d.timeOfDay) lines.push(`time_of_day,${t.hour},${t.count}`);
    for (const m of d.trendData) lines.push(`monthly_trend,${m.month},${m.count}`);
    for (const m of d.responseMetrics) lines.push(`response_avg_minutes,${esc(m.priority)},${m.avg_minutes ?? ''}`);
    for (const p of d.repeatOffenders) lines.push(`repeat_offenders,${esc(p.name)},${p.incident_count}`);
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="crime_analysis.csv"',
      },
    });
  } catch (err) {
    console.error('[reports] GET /crime-analysis/export failed:', err);
    return c.json({ error: 'Failed to export crime analysis', code: 'CRIME_ANALYSIS_EXPORT_ERROR' }, 500);
  }
});

// ────────────────────────────────────────────────────────────
// GET /api/reports/comparison?period=week
// Week-over-week (or month-over-month) comparison of calls, incidents,
// citations, and avg response time. The ReportsPage comparison panel
// reads: { calls:{current,previous,change}, incidents:{…}, citations:{…},
// responseTime:{current,previous,change} }.
// ────────────────────────────────────────────────────────────
reports.get('/comparison', async (c) => {
  try {
    const db = getDb(c.env);
    const period = c.req.query('period') ?? 'week';
    const days = period === 'month' ? 30 : 7;
    const currentSince = `-${days} days`;
    const previousSince = `-${days * 2} days`;
    const RESP = `COALESCE(response_time_seconds / 60.0, CASE WHEN dispatched_at IS NOT NULL THEN (julianday(onscene_at) - julianday(dispatched_at)) * 1440 END)`;

    const safe1 = async (sql: string, ...p: string[]): Promise<number> => {
      try { return (await queryFirst<{ n: number }>(db, sql, ...p))?.n ?? 0; } catch { return 0; }
    };
    const safeAvg = async (sql: string, ...p: string[]): Promise<number | null> => {
      try { return (await queryFirst<{ v: number | null }>(db, sql, ...p))?.v ?? null; } catch { return null; }
    };

    const [callsCur, callsPrev, incCur, incPrev, citCur, citPrev] = await Promise.all([
      safe1(`SELECT COUNT(*) AS n FROM calls_for_service WHERE created_at >= datetime('now',?)`, currentSince),
      safe1(`SELECT COUNT(*) AS n FROM calls_for_service WHERE created_at >= datetime('now',?) AND created_at < datetime('now',?)`, previousSince, currentSince),
      safe1(`SELECT COUNT(*) AS n FROM incidents WHERE created_at >= datetime('now',?)`, currentSince),
      safe1(`SELECT COUNT(*) AS n FROM incidents WHERE created_at >= datetime('now',?) AND created_at < datetime('now',?)`, previousSince, currentSince),
      safe1(`SELECT COUNT(*) AS n FROM citations WHERE created_at >= datetime('now',?)`, currentSince),
      safe1(`SELECT COUNT(*) AS n FROM citations WHERE created_at >= datetime('now',?) AND created_at < datetime('now',?)`, previousSince, currentSince),
    ]);
    const [rtCur, rtPrev] = await Promise.all([
      safeAvg(`SELECT ROUND(AVG(${RESP}),1) AS v FROM calls_for_service WHERE created_at >= datetime('now',?) AND (response_time_seconds IS NOT NULL OR onscene_at IS NOT NULL)`, currentSince),
      safeAvg(`SELECT ROUND(AVG(${RESP}),1) AS v FROM calls_for_service WHERE created_at >= datetime('now',?) AND created_at < datetime('now',?) AND (response_time_seconds IS NOT NULL OR onscene_at IS NOT NULL)`, previousSince, currentSince),
    ]);

    const pct = (cur: number, prev: number) =>
      prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : 0);
    const pctNull = (cur: number | null, prev: number | null) =>
      cur != null && prev != null && prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;

    return c.json({
      period,
      calls: { current: callsCur, previous: callsPrev, change: pct(callsCur, callsPrev) },
      incidents: { current: incCur, previous: incPrev, change: pct(incCur, incPrev) },
      citations: { current: citCur, previous: citPrev, change: pct(citCur, citPrev) },
      responseTime: { current: rtCur, previous: rtPrev, change: pctNull(rtCur, rtPrev) },
    });
  } catch (err) {
    console.error('[reports] GET /comparison failed:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// ────────────────────────────────────────────────────────────
// GET /api/reports/daily-briefing
// Shift-start summary: previous-day stats, active BOLOs, active warrants,
// trending incident types, and currently on-duty personnel.
// ────────────────────────────────────────────────────────────
reports.get('/daily-briefing', async (c) => {
  try {
    const db = getDb(c.env);
    const safe1 = async (sql: string, ...p: unknown[]): Promise<Record<string, unknown>> => {
      try { return (await queryFirst<Record<string, unknown>>(db, sql, ...p)) ?? {}; } catch { return {}; }
    };
    const safeList = async <T = Record<string, unknown>>(sql: string, ...p: unknown[]): Promise<T[]> => {
      try { return (await query<T>(db, sql, ...p)) ?? []; } catch { return []; }
    };

    const [prevDayStats, activeBolos, activeWarrants, trendingIncidents, personnelOnDuty] = await Promise.all([
      safe1(`SELECT COUNT(*) AS total_calls,
               SUM(CASE WHEN priority='P1' THEN 1 ELSE 0 END) AS p1_calls,
               SUM(CASE WHEN priority='P2' THEN 1 ELSE 0 END) AS p2_calls,
               ROUND(AVG(COALESCE(response_time_seconds/60.0, CASE WHEN dispatched_at IS NOT NULL THEN (julianday(onscene_at)-julianday(dispatched_at))*1440 END)),1) AS avg_response
             FROM calls_for_service WHERE date(created_at)=date('now','-1 day')`),
      // bolos has `type`, not `category`; warrants has `issued_date`, not `date_issued`.
      safeList(`SELECT id, bolo_number, title, priority, type AS category FROM bolos WHERE status='active' ORDER BY priority ASC, created_at DESC LIMIT 10`),
      safeList(`SELECT id, warrant_number, charge_description, status FROM warrants WHERE status='active' AND archived_at IS NULL ORDER BY issued_date DESC LIMIT 10`),
      safeList(`SELECT incident_type, COUNT(*) AS count FROM incidents WHERE created_at >= datetime('now','-7 days') GROUP BY incident_type ORDER BY count DESC LIMIT 5`),
      safeList(`SELECT u.call_sign, usr.full_name FROM units u LEFT JOIN users usr ON usr.id=u.officer_id WHERE u.status NOT IN ('off_duty','out_of_service') ORDER BY u.call_sign LIMIT 30`),
    ]);

    return c.json({ prevDayStats, activeBolos, activeWarrants, trendingIncidents, personnelOnDuty });
  } catch (err) {
    console.error('[reports] GET /daily-briefing failed:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// ────────────────────────────────────────────────────────────
// GET /api/reports/weekly-digest
// 7-day summary with by-day call volume and top incident types.
// ────────────────────────────────────────────────────────────
reports.get('/weekly-digest', async (c) => {
  try {
    const db = getDb(c.env);
    const safeList = async <T = Record<string, unknown>>(sql: string, ...p: unknown[]): Promise<T[]> => {
      try { return (await query<T>(db, sql, ...p)) ?? []; } catch { return []; }
    };
    const safe1 = async (sql: string, ...p: unknown[]): Promise<number> => {
      try { return (await queryFirst<{ n: number }>(db, sql, ...p))?.n ?? 0; } catch { return 0; }
    };

    const since7 = '-7 days';
    const [totalCalls, totalIncidents, totalCitations, totalArrests, avgResp, byDay, topIncidentTypes] = await Promise.all([
      safe1(`SELECT COUNT(*) AS n FROM calls_for_service WHERE created_at >= datetime('now',?)`, since7),
      safe1(`SELECT COUNT(*) AS n FROM incidents WHERE created_at >= datetime('now',?)`, since7),
      safe1(`SELECT COUNT(*) AS n FROM citations WHERE created_at >= datetime('now',?)`, since7),
      // No `arrests` table on live D1 — it's arrest_records.
      safe1(`SELECT COUNT(*) AS n FROM arrest_records WHERE created_at >= datetime('now',?)`, since7),
      (async () => {
        try {
          const r = await queryFirst<{ v: number | null }>(db, `SELECT ROUND(AVG(COALESCE(response_time_seconds/60.0, CASE WHEN dispatched_at IS NOT NULL THEN (julianday(onscene_at)-julianday(dispatched_at))*1440 END)),1) AS v FROM calls_for_service WHERE created_at >= datetime('now',?) AND (response_time_seconds IS NOT NULL OR onscene_at IS NOT NULL)`, since7);
          return r?.v ?? null;
        } catch { return null; }
      })(),
      safeList(`SELECT date(created_at) AS day, COUNT(*) AS count FROM calls_for_service WHERE created_at >= datetime('now',?) GROUP BY day ORDER BY day`, since7),
      safeList(`SELECT incident_type, COUNT(*) AS count FROM incidents WHERE created_at >= datetime('now',?) GROUP BY incident_type ORDER BY count DESC LIMIT 10`, since7),
    ]);

    return c.json({
      summary: { totalCalls, totalIncidents, totalCitations, totalArrests, avgResponseMinutes: avgResp },
      byDay,
      topIncidentTypes,
    });
  } catch (err) {
    console.error('[reports] GET /weekly-digest failed:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// ────────────────────────────────────────────────────────────
// GET /api/reports/patrol-tracking
// GPS breadcrumb trail for one or all units over the requested window.
// Returns { trails[], total_units, total_points } for PDF generation.
// ────────────────────────────────────────────────────────────
reports.get('/patrol-tracking', async (c) => {
  try {
    const db = getDb(c.env);
    const hoursParam = c.req.query('hours');
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');
    const unitId = c.req.query('unitId');
    const geocode = c.req.query('geocode') === 'true';

    let since: string;
    let until: string | undefined;
    if (startDate && endDate) {
      since = startDate;
      until = endDate;
    } else {
      const hours = Math.max(1, Math.min(72, Number(hoursParam) || 8));
      since = new Date(Date.now() - hours * 3600_000).toISOString();
    }

    const unitFilter = unitId ? 'AND g.unit_id = ?' : '';
    const untilFilter = until ? 'AND g.recorded_at <= ?' : '';
    const binds: (string | number)[] = [since];
    if (until) binds.push(until);
    if (unitId) binds.push(Number(unitId));

    const points = await query<{
      unit_id: number; call_sign: string | null;
      latitude: number; longitude: number;
      speed_mph: number | null; heading: number | null;
      recorded_at: string; location_address: string | null;
    }>(db, `
      -- gps_breadcrumbs has speed (not speed_mph) and no location_address --
      -- road_name / nearest_intersection are the only place data on the row.
      SELECT g.unit_id, u.call_sign, g.latitude, g.longitude,
             g.speed AS speed_mph, g.heading, g.recorded_at,
             ${geocode ? 'COALESCE(g.road_name, g.nearest_intersection) AS location_address' : 'NULL AS location_address'}
        FROM gps_breadcrumbs g
        LEFT JOIN units u ON u.id = g.unit_id
       WHERE g.recorded_at >= ? ${untilFilter} ${unitFilter}
       ORDER BY g.unit_id ASC, g.recorded_at ASC
       LIMIT 10000
    `, ...binds);

    // Group by unit
    const unitMap = new Map<number, typeof points>();
    for (const pt of points) {
      if (!unitMap.has(pt.unit_id)) unitMap.set(pt.unit_id, []);
      unitMap.get(pt.unit_id)!.push(pt);
    }

    const trails = Array.from(unitMap.entries()).map(([unitId, pts]) => {
      const firstPt = pts[0];
      const lastPt = pts[pts.length - 1];
      const start = new Date(firstPt.recorded_at).getTime();
      const end = new Date(lastPt.recorded_at).getTime();
      const durationMinutes = Math.round((end - start) / 60_000);

      // Rough distance in miles (sum of haversine between consecutive points)
      let totalDistanceMiles = 0;
      for (let i = 1; i < pts.length; i++) {
        const p1 = pts[i - 1], p2 = pts[i];
        const R = 3959;
        const dLat = ((p2.latitude - p1.latitude) * Math.PI) / 180;
        const dLng = ((p2.longitude - p1.longitude) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos((p1.latitude * Math.PI) / 180) * Math.cos((p2.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
        totalDistanceMiles += R * 2 * Math.asin(Math.sqrt(a));
      }

      return {
        unit_id: unitId,
        call_sign: firstPt.call_sign ?? `Unit ${unitId}`,
        points: pts,
        stats: {
          total_points: pts.length,
          total_distance_miles: Math.round(totalDistanceMiles * 100) / 100,
          duration_minutes: durationMinutes,
          avg_speed_mph: pts.reduce((s, p) => s + (p.speed_mph ?? 0), 0) / pts.length || 0,
          start_time: firstPt.recorded_at,
          end_time: lastPt.recorded_at,
        },
      };
    });

    return c.json({
      trails,
      total_units: trails.length,
      total_points: points.length,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[reports] GET /patrol-tracking failed:', err);
    return c.json({ error: 'Failed to fetch patrol tracking data', code: 'PATROL_TRACKING_ERROR' }, 500);
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/reports/custom
// Ad-hoc query builder endpoint. Accepts { source, columns[], filters[],
// sortBy?, sortDir?, limit? } and returns { data:[], columns:[], count }.
// Allowlist of tables + columns prevents SQL injection.
// ────────────────────────────────────────────────────────────

const ALLOWED_SOURCES: Record<string, string[]> = {
  calls_for_service: ['id','call_number','incident_type','priority','status','caller_name','location_address','zone_beat','beat_id','zone_id','sector_id','disposition','created_at','dispatched_at','onscene_at','cleared_at'],
  incidents: ['id','incident_number','incident_type','priority','status','location_address','narrative','officer_id','created_at','occurred_date','zone_beat','beat_id','zone_id','disposition','domestic_violence','weapons_involved'],
  citations: ['id','citation_number','type','violation_description','statute_citation','offense_level','location','status','fine_amount','officer_id','violation_date','created_at'],
  warrants: ['id','warrant_number','type','status','offense_level','charge_description','statute_citation','court_name','bail_amount','date_issued','expires_at','served_at','created_at'],
  bolos: ['id','subject_name','description','priority','status','category','vehicle_info','location_last_seen','issued_by','created_at','expires_at'],
  evidence: ['id','evidence_number','incident_id','description','category','storage_location','chain_of_custody','collected_by','collected_at','created_at'],
  time_entries: ['id','officer_id','shift_date','clock_in','clock_out','hours_worked','overtime_hours','status','notes','approved_by'],
  training_records: ['id','officer_id','title','category','status','hours','completed_date','expiry_date','instructor','score'],
  field_interviews: ['id','subject_name','location','reason','officer_id','created_at'],
  patrol_scans: ['id','checkpoint_id','officer_id','scanned_at','gps_latitude','gps_longitude'],
};

const ALLOWED_OPS = new Set(['eq', 'contains', 'gte', 'lte']);

reports.post('/custom', async (c) => {
  try {
    const body = await c.req.json() as {
      source?: string;
      columns?: string[];
      filters?: Array<{ column: string; operator: string; value: string }>;
      sortBy?: string;
      sortDir?: 'asc' | 'desc';
      limit?: number;
    };
    const { source, columns = [], filters = [], sortBy, sortDir = 'desc', limit = 200 } = body;

    if (!source || !ALLOWED_SOURCES[source]) {
      return c.json({ error: 'Invalid source', code: 'INVALID_SOURCE' }, 400);
    }
    const allowedCols = ALLOWED_SOURCES[source];

    // Sanitize column selection — only keep explicitly allowed column names.
    const safeCols = columns.filter(col => allowedCols.includes(col));
    if (safeCols.length === 0) {
      return c.json({ error: 'No valid columns selected', code: 'NO_COLUMNS' }, 400);
    }

    // Build WHERE clause from filters.
    const whereParts: string[] = [];
    const binds: (string | number)[] = [];
    for (const f of filters) {
      if (!allowedCols.includes(f.column)) continue;
      if (!ALLOWED_OPS.has(f.operator)) continue;
      if (!f.value) continue;
      switch (f.operator) {
        case 'eq':       whereParts.push(`${f.column} = ?`);           binds.push(f.value); break;
        case 'contains': { const m = containsClause(f.column); whereParts.push(m.sql); binds.push(m.bind(f.value)); break; }
        case 'gte':      whereParts.push(`${f.column} >= ?`);           binds.push(f.value); break;
        case 'lte':      whereParts.push(`${f.column} <= ?`);           binds.push(f.value); break;
      }
    }

    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
    const order = sortBy && allowedCols.includes(sortBy)
      ? `ORDER BY ${sortBy} ${sortDir === 'asc' ? 'ASC' : 'DESC'}`
      : '';
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));

    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT ${safeCols.join(', ')} FROM ${source} ${where} ${order} LIMIT ${safeLimit}`,
      ...binds,
    );

    return c.json({ data: rows, columns: safeCols, count: rows.length });
  } catch (err) {
    console.error('[reports] POST /custom failed:', err);
    return c.json({ error: 'Query failed', code: 'QUERY_ERROR' }, 500);
  }
});

// ── Dashboard widget supplements (missing endpoints previously 404'd silently) ──

// GET /reports/dashboard-weekly-trend
reports.get('/dashboard-weekly-trend', async (c) => {
  try {
    const db = getDb(c.env);
    const daily = await query<{ date: string; count: number }>(db,
      `SELECT ${denverDateExpr('created_at')} AS date, COUNT(*) AS count FROM calls_for_service
       WHERE created_at >= datetime('now','-14 days') GROUP BY date ORDER BY date`);
    const todayN = (await queryFirst<{ n: number }>(db,
      `SELECT COUNT(*) AS n FROM calls_for_service WHERE ${denverDateExpr('created_at')} = ${denverNowDateExpr()}`))?.n ?? 0;
    const yesterdayN = (await queryFirst<{ n: number }>(db,
      `SELECT COUNT(*) AS n FROM calls_for_service WHERE ${denverDateExpr('created_at')} = ${denverNowDateExpr('-1 day')}`))?.n ?? 0;
    const lastWeekN = (await queryFirst<{ n: number }>(db,
      `SELECT COUNT(*) AS n FROM calls_for_service WHERE ${denverDateExpr('created_at')} = ${denverNowDateExpr('-7 days')}`))?.n ?? 0;
    return c.json({ dailyTrend: daily, today: todayN, yesterday: yesterdayN, lastWeekSameDay: lastWeekN });
  } catch { return c.json({ dailyTrend: [], today: 0, yesterday: 0, lastWeekSameDay: 0 }); }
});

// GET /reports/dashboard-calls-by-type
reports.get('/dashboard-calls-by-type', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<{ type: string; count: number }>(db,
      `SELECT incident_type AS type, COUNT(*) AS count FROM calls_for_service
       WHERE ${denverDateExpr('created_at')} = ${denverNowDateExpr()} GROUP BY incident_type ORDER BY count DESC LIMIT 15`);
    return c.json(rows);
  } catch { return c.json([]); }
});

// GET /reports/dashboard-unit-status
reports.get('/dashboard-unit-status', async (c) => {
  try {
    const db = getDb(c.env);
    const statusCounts = await query<{ status: string; count: number }>(db,
      'SELECT status, COUNT(*) AS count FROM units WHERE status IS NOT NULL GROUP BY status');
    const activeUnits = await query<Record<string, unknown>>(db,
      `SELECT u.id, u.call_sign, u.status, usr.full_name AS officer_name, usr.badge_number,
              fv.vehicle_number FROM units u LEFT JOIN users usr ON u.officer_id = usr.id
       LEFT JOIN fleet_vehicles fv ON fv.assigned_unit_id = u.id
       WHERE u.status NOT IN ('off_duty','out_of_service') ORDER BY u.call_sign`);
    return c.json({ statusCounts: statusCounts.map(s => ({ status: s.status, count: s.count })), activeUnits });
  } catch { return c.json({ statusCounts: [], activeUnits: [] }); }
});

// GET /reports/shift-comparison
reports.get('/shift-comparison', async (c) => {
  try {
    const db = getDb(c.env);
    const days = parseInt(c.req.query('days') || '30', 10);
    // Shift hours (Day=0600-1359, Swing=1400-2159, Night=2200-0559) are Mountain
    // Time, but created_at is stored UTC and strftime('%H', created_at) read the
    // UTC hour directly — a call at 13:00 UTC (06:00 MDT, start of Day shift)
    // was bucketed as Night. denverHourExpr shifts the timestamp into Denver
    // wall-clock before extracting the hour (see utils/denverTime.ts for the
    // shared DST tradeoff note).
    const shiftedHour = denverHourExpr('created_at');
    const rows = await query<{ shift: string; calls: number; incidents: number; avg_resp_min: number; hours: number }>(db,
      `SELECT CASE WHEN ${shiftedHour} BETWEEN 6 AND 13 THEN 'Day'
                   WHEN ${shiftedHour} BETWEEN 14 AND 21 THEN 'Swing'
                   ELSE 'Night' END AS shift,
              COUNT(*) AS calls,
              COALESCE(SUM(CASE WHEN incident_type IS NOT NULL THEN 1 ELSE 0 END), 0) AS incidents,
              ROUND(AVG(COALESCE(response_time_seconds/60.0, CASE WHEN dispatched_at IS NOT NULL THEN (julianday(onscene_at)-julianday(dispatched_at))*1440 END)),1) AS avg_resp_min,
              COUNT(DISTINCT DATE(created_at)) * 8 AS hours
       FROM calls_for_service WHERE created_at >= datetime('now','-${days} days') GROUP BY shift`);
    return c.json({ shifts: rows, period_days: days });
  } catch { return c.json({ shifts: [], period_days: 30 }); }
});

// GET /reports/clearance-rate
reports.get('/clearance-rate', async (c) => {
  try {
    const db = getDb(c.env);
    const days = parseInt(c.req.query('days') || '30', 10);
    const cleared = (await queryFirst<{ n: number }>(db,
      `SELECT COUNT(*) AS n FROM incidents WHERE status = 'closed' AND created_at >= datetime('now','-${days} days')`))?.n ?? 0;
    const total = (await queryFirst<{ n: number }>(db,
      `SELECT COUNT(*) AS n FROM incidents WHERE created_at >= datetime('now','-${days} days')`))?.n ?? 1;
    // "Pending" (report not yet submitted for review) vs. "Active" (submitted,
    // awaiting disposition) — split out of the incidents.status CHECK enum
    // ('draft','submitted','under_review','approved','returned') so the
    // Dashboard clearance-rate donut (DashboardPage.tsx incidentPieData) can
    // render its 3rd wedge instead of reading a field this endpoint never sent.
    const pending = (await queryFirst<{ n: number }>(db,
      `SELECT COUNT(*) AS n FROM incidents WHERE status = 'draft' AND created_at >= datetime('now','-${days} days')`))?.n ?? 0;
    const active = total - cleared - pending;
    return c.json({ rate: Math.round((cleared / Math.max(total, 1)) * 100), cleared, total, active, pending, days });
  } catch { return c.json({ rate: 0, cleared: 0, total: 0, active: 0, days: 30 }); }
});

// GET /reports/patrol-coverage
reports.get('/patrol-coverage', async (c) => {
  try {
    const db = getDb(c.env);
    const totalBeats = (await queryFirst<{ n: number }>(db,
      // No dispatch_geography table exists (in rmpg-flex or rmpg-geo) —
      // dispatch_beats is the beat registry.
      'SELECT COUNT(*) AS n FROM dispatch_beats WHERE COALESCE(active, 1) = 1'))?.n ?? 0;
    const coveredBeats = (await queryFirst<{ n: number }>(db,
      `SELECT COUNT(DISTINCT u.assigned_beat) AS n FROM units u WHERE u.status = 'available' AND u.assigned_beat IS NOT NULL`))?.n ?? 0;
    return c.json({ coverage: totalBeats ? Math.round((coveredBeats / totalBeats) * 100) : 0, coveredBeats, totalBeats });
  } catch { return c.json({ coverage: 0, coveredBeats: 0, totalBeats: 0 }); }
});

// GET /reports/evidence-pending
reports.get('/evidence-pending', async (c) => {
  try {
    const db = getDb(c.env);
    const pending = (await queryFirst<{ n: number }>(db,
      "SELECT COUNT(*) AS n FROM field_photos WHERE reviewed_at IS NULL"))?.n ?? 0;
    const total = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM field_photos'))?.n ?? 0;
    const reviewed = (await queryFirst<{ n: number }>(db,
      "SELECT COUNT(*) AS n FROM field_photos WHERE reviewed_at IS NOT NULL"))?.n ?? 0;
    // checked_out / pending_disposal are the evidence-locker tab of this
    // widget (client/src/pages/DashboardPage.tsx EvidenceSummary), distinct
    // from the field_photos review-queue counts above. 'checked_out' is the
    // status POST /records/evidence/:id/checkout writes, cleared back to
    // 'checked_in' on check-in; 'pending_disposition' is the status
    // PUT /records/evidence/:id/disposition writes for disposition==='pending'
    // (see records.ts).
    const checkedOut = (await queryFirst<{ n: number }>(db,
      "SELECT COUNT(*) AS n FROM evidence WHERE status = 'checked_out'"))?.n ?? 0;
    const pendingDisposal = (await queryFirst<{ n: number }>(db,
      "SELECT COUNT(*) AS n FROM evidence WHERE status = 'pending_disposition'"))?.n ?? 0;
    return c.json({ pending, total, reviewed, checked_out: checkedOut, pending_disposal: pendingDisposal });
  } catch { return c.json({ pending: 0, total: 0, reviewed: 0, checked_out: 0, pending_disposal: 0 }); }
});

// GET /reports/upcoming-court
reports.get('/upcoming-court', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<{ date: string; time: string; case_number: string; officer_name: string }>(db,
      // Live court_events: event_date / event_time / court_case_number, and no
      // officer_id — created_by is the only user FK (same as admin.ts).
      `SELECT ce.event_date AS date, ce.event_time AS time,
              ce.court_case_number AS case_number, COALESCE(u.full_name, 'Unassigned') AS officer_name
       FROM court_events ce LEFT JOIN users u ON u.id = ce.created_by
       WHERE ce.event_date >= DATE('now') AND ce.event_date <= DATE('now','+7 days')
       ORDER BY ce.event_date, ce.event_time LIMIT 30`);
    return c.json({ upcoming: rows });
  } catch { return c.json({ upcoming: [] }); }
});

// GET /reports/overdue-reports
reports.get('/overdue-reports', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<{ id: number; title: string; officer_name: string; days_overdue: number }>(db,
      `SELECT i.id, COALESCE(i.incident_number, 'INC-' || i.id) AS title,
              COALESCE(u.full_name, 'Unassigned') AS officer_name,
              CAST(julianday('now') - julianday(i.created_at) AS INTEGER) AS days_overdue
       FROM incidents i LEFT JOIN users u ON u.id = i.officer_id
       WHERE i.status = 'draft' AND i.created_at <= datetime('now','-7 days')
       ORDER BY i.created_at LIMIT 20`);
    return c.json({ count: rows.length, items: rows });
  } catch { return c.json({ count: 0, items: [] }); }
});

// Mounted here rather than in routesConfig so it inherits /api/reports'
// auth:'required'. Declaration order matters in Hono — verified 2026-08-01
// that no route above is a bare /:param that could shadow this.
reports.route('/daily-reports', dailyReports);

export default reports;
