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

// All /reports/* routes are org-wide rollups → elevated roles only, EXCEPT
// /shift-activity/:officerId, which is an officer's own end-of-shift report
// (an officer must be able to pull it from the MDT), and /dashboard, which
// is the top-level tile rollup that every authenticated user sees on the
// homepage. Those routes authorize self-or-open inside their own handler.
reports.use('*', async (c, next) => {
  if (c.req.path.includes('/shift-activity/')) return next();
  if (c.req.path.endsWith('/dashboard')) return next();
  return requireRole(...ANALYTICS_ROLES)(c, next);
});

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

reports.get('/officer-activity', async (c) => {
  const db = getDb(c.env);
  try {
    const rows = await query<Record<string, unknown>>(db, `
      SELECT u.officer_id, usr.full_name, usr.badge_number,
        (SELECT COUNT(*) FROM incidents i WHERE i.reporting_officer_id = u.officer_id) AS incidents_written,
        (SELECT COUNT(*) FROM calls_for_service c WHERE c.assigned_unit_ids LIKE '%' || CAST(u.id AS TEXT) || '%') AS calls_responded,
        0 AS total_hours
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
      queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM calls_for_service WHERE status NOT IN ('cleared','closed','cancelled')"),
      queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM units WHERE status NOT IN ('off_duty','out_of_service')"),
      queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM units'),
      queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM incidents WHERE status IN ('draft','submitted','under_review')"),
      queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM bolos WHERE status = 'active'"),
      // Live column is response_time_seconds (NOT _sec — that typo made this
      // query throw "no such column", which rejected the whole Promise.all and
      // served every dashboard tile from the all-zeros catch fallback). The
      // column is also NULL on all current live rows, so fall back to the
      // onscene_at − created_at delta when it's missing.
      queryFirst<{ avg: number | null }>(db, "SELECT ROUND(AVG(COALESCE(response_time_seconds / 60.0, (julianday(onscene_at) - julianday(created_at)) * 1440)), 1) AS avg FROM calls_for_service WHERE (response_time_seconds IS NOT NULL OR onscene_at IS NOT NULL) AND created_at >= datetime('now','-24 hours')"),
      query<{ priority: string; count: number }>(db, "SELECT priority, COUNT(*) AS count FROM calls_for_service WHERE status NOT IN ('cleared','closed','cancelled') GROUP BY priority"),
      query<{ status: string; count: number }>(db, "SELECT status, COUNT(*) AS count FROM calls_for_service GROUP BY status"),
      query<{ hour: string; count: number }>(db, "SELECT strftime('%H', created_at) AS hour, COUNT(*) AS count FROM calls_for_service WHERE created_at >= datetime('now','-24 hours') GROUP BY hour ORDER BY hour"),
      query<Record<string, unknown>>(db, "SELECT u.id, usr.full_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.status NOT IN ('off_duty','out_of_service')"),
    ]);
    const todayCalls = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM calls_for_service WHERE created_at >= datetime('now','start of day')");
    return c.json({
      activeCalls: calls?.n ?? 0,
      todayCalls: todayCalls?.n ?? 0,
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
    });
  } catch (err) {
    console.error('[reports] GET /dashboard failed:', err);
    return c.json({ activeCalls: 0, todayCalls: 0, unitsOnDuty: 0, totalUnits: 0, pendingReports: 0, activeBolos: 0, unreadMessages: 0, avgResponseMinutes: null, callsByPriority: [], callsByStatus: [], recentActivity: [], officersOnDuty: [], callsByHour: [] });
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
const RESPONSE_MINUTES =
  'COALESCE(response_time_seconds / 60.0, (julianday(onscene_at) - julianday(created_at)) * 1440)';

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

export default reports;
