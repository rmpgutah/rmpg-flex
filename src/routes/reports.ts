// ============================================================
// RMPG Flex — Reports router (crime analysis + CSV export)
// ============================================================
// Replaces the /api/reports/crime-analysis stub. Two endpoints:
//
//   GET /crime-analysis?days=90 | start_date=YYYY-MM-DD&end_date=...
//       [&property_id=N]
//     Aggregates incidents joined to incident_offenses ↔ nibrs_offense_codes
//     and calls_for_service ↔ properties. Returns BOTH the task-spec
//     shape (totals, by_type, by_day, by_hour, by_property) AND the
//     legacy shape the existing CrimeAnalysisPage.tsx reads
//     (topOffenses, hotspots, dayOfWeek, timeOfDay, trendData,
//      clearanceRate, responseMetrics, repeatOffenders) — single SQL
//     pass per axis, two field projections.
//
//   GET /crime-analysis/export?format=csv&...   (same filters)
//     Streams one row per incident, capped at 50,000 rows. Primary
//     offense = MIN(incident_offenses.id) per incident (stable default;
//     the row inserted first).
//
// Both routes require admin | manager | supervisor. Other report
// prefixes (/api/reports/incidents-summary, /response-times, etc.)
// fall through to the stubs router; this file owns ONLY /crime-analysis.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { requireRole } from '../middleware/auth';
import { getDb, query, queryFirst } from '../utils/db';

const reports = new Hono<Env>();

reports.use('/crime-analysis', requireRole('admin', 'manager', 'supervisor'));
reports.use('/crime-analysis/*', requireRole('admin', 'manager', 'supervisor'));

// ── Filter parsing ───────────────────────────────────────────
// `days` is the SPA's default control. `start_date`/`end_date` win
// if both are present (custom-range selector). property_id is an
// optional filter on the joined call's property.
interface Filters {
  start: string;          // 'YYYY-MM-DD HH:MM:SS' SQLite datetime
  end: string;
  property_id: number | null;
  // For Content-Disposition + UI display — keep YYYY-MM-DD slugs.
  startSlug: string;
  endSlug: string;
}

function parseFilters(c: any): Filters {
  const url = new URL(c.req.url);
  const qDays = url.searchParams.get('days');
  const qStart = url.searchParams.get('start_date');
  const qEnd = url.searchParams.get('end_date');
  const qProp = url.searchParams.get('property_id');

  let startSlug: string;
  let endSlug: string;
  if (qStart && qEnd) {
    startSlug = qStart;
    endSlug = qEnd;
  } else {
    const days = Math.max(1, Math.min(parseInt(qDays || '90', 10) || 90, 3650));
    const now = new Date();
    const start = new Date(now);
    start.setUTCDate(now.getUTCDate() - days);
    startSlug = start.toISOString().slice(0, 10);
    endSlug = now.toISOString().slice(0, 10);
  }
  return {
    start: `${startSlug} 00:00:00`,
    end: `${endSlug} 23:59:59`,
    property_id: qProp ? parseInt(qProp, 10) || null : null,
    startSlug,
    endSlug,
  };
}

// Build the WHERE fragment + binding list used by every aggregation.
// Centralised so adding a new filter (e.g. district_id) lands in one
// place instead of N copies. Returns ' AND ...' suffixes so the
// caller controls the base FROM/JOIN.
function whereClause(f: Filters): { sql: string; bindings: unknown[] } {
  const parts: string[] = ['i.created_at BETWEEN ? AND ?'];
  const bindings: unknown[] = [f.start, f.end];
  if (f.property_id != null) {
    parts.push('cfs.property_id = ?');
    bindings.push(f.property_id);
  }
  return { sql: parts.join(' AND '), bindings };
}

// ── GET /crime-analysis ──────────────────────────────────────
reports.get('/crime-analysis', async (c) => {
  const db = getDb(c.env);
  const f = parseFilters(c);
  const w = whereClause(f);

  // FROM/JOIN block reused across most queries. incidents is at 84 cols
  // on live D1, but we never `SELECT i.*` — only a few projections, so
  // we're nowhere near the D1 100-column result-set cap.
  const FROM = `
    FROM incidents i
    LEFT JOIN calls_for_service cfs ON cfs.id = i.call_id
  `;

  // 1. Totals — single row aggregate
  const totalsRow = await queryFirst<Record<string, number | null>>(db, `
    SELECT
      COUNT(DISTINCT i.id)         AS total_incidents,
      COUNT(DISTINCT cfs.property_id) AS unique_properties,
      COUNT(DISTINCT i.officer_id) AS unique_officers,
      SUM(CASE WHEN i.priority = 'P1' THEN 1 ELSE 0 END) AS p1,
      SUM(CASE WHEN i.priority = 'P2' THEN 1 ELSE 0 END) AS p2,
      SUM(CASE WHEN i.priority = 'P3' THEN 1 ELSE 0 END) AS p3,
      SUM(CASE WHEN i.priority = 'P4' THEN 1 ELSE 0 END) AS p4,
      SUM(CASE WHEN i.status = 'approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN i.status IN ('submitted','under_review','approved','returned') THEN 1 ELSE 0 END) AS reviewable
    ${FROM} WHERE ${w.sql}
  `, ...w.bindings);

  const totalOffensesRow = await queryFirst<{ total_offenses: number }>(db, `
    SELECT COUNT(*) AS total_offenses
    FROM incident_offenses io
    JOIN incidents i ON i.id = io.incident_id
    LEFT JOIN calls_for_service cfs ON cfs.id = i.call_id
    WHERE ${w.sql}
  `, ...w.bindings);

  const totalIncidents = Number(totalsRow?.total_incidents || 0);
  const totalOffenses = Number(totalOffensesRow?.total_offenses || 0);
  const approved = Number(totalsRow?.approved || 0);
  const reviewable = Number(totalsRow?.reviewable || 0);
  const clearanceRate = reviewable > 0 ? Math.round((approved / reviewable) * 1000) / 10 : 0;

  // 2. by_type — JOIN to nibrs_offense_codes via io.code (PR #667 column).
  // LEFT JOIN: incidents with offenses that have no NIBRS mapping still
  // show up under description from incident_offenses, with null code.
  const typeRows = await query<Record<string, unknown>>(db, `
    SELECT
      io.code                                AS nibrs_code,
      COALESCE(noc.description, io.description, io.offense_type, 'Unknown') AS description,
      COALESCE(noc.category, 'Uncategorized') AS category,
      COUNT(*)                               AS count
    FROM incident_offenses io
    JOIN incidents i ON i.id = io.incident_id
    LEFT JOIN calls_for_service cfs ON cfs.id = i.call_id
    LEFT JOIN nibrs_offense_codes noc ON noc.code = io.code
    WHERE ${w.sql}
    GROUP BY io.code, COALESCE(noc.description, io.description, io.offense_type),
             COALESCE(noc.category, 'Uncategorized')
    ORDER BY count DESC
    LIMIT 20
  `, ...w.bindings);

  const by_type = typeRows.map((r) => ({
    nibrs_code: r.nibrs_code as string | null,
    description: r.description as string,
    category: r.category as string,
    count: Number(r.count),
    pct: totalOffenses > 0 ? Math.round((Number(r.count) / totalOffenses) * 1000) / 10 : 0,
  }));

  // 3. by_day — date + priority breakdown
  const dayRows = await query<Record<string, unknown>>(db, `
    SELECT
      date(i.created_at) AS date,
      i.priority         AS priority,
      COUNT(*)           AS count
    ${FROM} WHERE ${w.sql}
    GROUP BY date(i.created_at), i.priority
    ORDER BY date(i.created_at) ASC
  `, ...w.bindings);

  const byDayMap = new Map<string, { date: string; total: number; by_priority: Record<string, number> }>();
  for (const r of dayRows) {
    const date = String(r.date);
    const pri = String(r.priority ?? 'P3');
    const count = Number(r.count);
    let bucket = byDayMap.get(date);
    if (!bucket) {
      bucket = { date, total: 0, by_priority: { P1: 0, P2: 0, P3: 0, P4: 0 } };
      byDayMap.set(date, bucket);
    }
    bucket.total += count;
    if (bucket.by_priority[pri] != null) bucket.by_priority[pri] += count;
  }
  const by_day = [...byDayMap.values()];

  // 4. by_hour — hour 0-23 with day-of-week breakdown
  // SQLite strftime('%w') returns 0=Sun..6=Sat.
  const hourRows = await query<Record<string, unknown>>(db, `
    SELECT
      CAST(strftime('%H', i.created_at) AS INTEGER) AS hour,
      CAST(strftime('%w', i.created_at) AS INTEGER) AS dow,
      COUNT(*) AS count
    ${FROM} WHERE ${w.sql}
    GROUP BY hour, dow
  `, ...w.bindings);

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const byHourArr: Array<{ hour: number; count: number; dow: Record<string, number> }> = [];
  for (let h = 0; h < 24; h++) {
    byHourArr.push({ hour: h, count: 0, dow: { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 } });
  }
  for (const r of hourRows) {
    const h = Number(r.hour);
    const d = Number(r.dow);
    const cnt = Number(r.count);
    if (h >= 0 && h < 24) {
      byHourArr[h].count += cnt;
      byHourArr[h].dow[DAY_NAMES[d]] = (byHourArr[h].dow[DAY_NAMES[d]] || 0) + cnt;
    }
  }

  // 5. by_property — top 25 by incident count. top_types lookup runs as a
  // second pass to avoid an N+M correlated subquery. property_id is read
  // through cfs since incidents.property_id doesn't exist (per migration
  // 0001 and the spec confirmed before writing this).
  const propRows = await query<Record<string, unknown>>(db, `
    SELECT
      cfs.property_id      AS property_id,
      p.name               AS property_name,
      COUNT(DISTINCT i.id) AS count
    ${FROM}
    JOIN properties p ON p.id = cfs.property_id
    WHERE ${w.sql} AND cfs.property_id IS NOT NULL
    GROUP BY cfs.property_id, p.name
    ORDER BY count DESC
    LIMIT 25
  `, ...w.bindings);

  // top_types per property — small follow-up query per top property.
  // 25 round-trips at this scale is acceptable (each query is a tiny
  // GROUP BY on indexed FKs). For >100 properties we'd consolidate.
  const by_property: Array<{
    property_id: number;
    property_name: string;
    count: number;
    top_types: string[];
  }> = [];
  for (const pr of propRows) {
    const pid = Number(pr.property_id);
    const topTypeRows = await query<{ description: string }>(db, `
      SELECT COALESCE(noc.description, io.description, io.offense_type, 'Unknown') AS description
      FROM incident_offenses io
      JOIN incidents i ON i.id = io.incident_id
      LEFT JOIN calls_for_service cfs ON cfs.id = i.call_id
      LEFT JOIN nibrs_offense_codes noc ON noc.code = io.code
      WHERE ${w.sql} AND cfs.property_id = ?
      GROUP BY description
      ORDER BY COUNT(*) DESC
      LIMIT 3
    `, ...w.bindings, pid);
    by_property.push({
      property_id: pid,
      property_name: String(pr.property_name || `Property #${pid}`),
      count: Number(pr.count),
      top_types: topTypeRows.map((t) => t.description),
    });
  }

  // ── Legacy-shape axes (CrimeAnalysisPage.tsx) ───────────────
  // Hotspots: top locations by raw incident count. Pulled from
  // incidents.location_address with averaged lat/lng.
  const hotspots = await query<Record<string, unknown>>(db, `
    SELECT
      i.location_address AS location,
      AVG(i.latitude)    AS lat,
      AVG(i.longitude)   AS lng,
      COUNT(*)           AS count
    ${FROM} WHERE ${w.sql} AND i.location_address IS NOT NULL AND TRIM(i.location_address) != ''
    GROUP BY i.location_address
    ORDER BY count DESC
    LIMIT 10
  `, ...w.bindings);

  // Day of week — flat array {day_of_week 0-6, count}.
  const dowRows = await query<Record<string, unknown>>(db, `
    SELECT CAST(strftime('%w', i.created_at) AS INTEGER) AS day_of_week, COUNT(*) AS count
    ${FROM} WHERE ${w.sql}
    GROUP BY day_of_week ORDER BY day_of_week
  `, ...w.bindings);

  // Time of day — {hour, count}.
  const todRows = await query<Record<string, unknown>>(db, `
    SELECT CAST(strftime('%H', i.created_at) AS INTEGER) AS hour, COUNT(*) AS count
    ${FROM} WHERE ${w.sql}
    GROUP BY hour ORDER BY hour
  `, ...w.bindings);

  // Monthly trend — {month: 'YYYY-MM', count}.
  const trendRows = await query<Record<string, unknown>>(db, `
    SELECT strftime('%Y-%m', i.created_at) AS month, COUNT(*) AS count
    ${FROM} WHERE ${w.sql}
    GROUP BY month ORDER BY month
  `, ...w.bindings);

  // Response metrics — average dispatched→onscene minutes per priority,
  // sourced from the same calls_for_service rows backing the incidents
  // (so the metric matches the filtered window). Only count calls where
  // both timestamps exist.
  const respRows = await query<Record<string, unknown>>(db, `
    SELECT
      LOWER(CASE i.priority
        WHEN 'P1' THEN 'critical'
        WHEN 'P2' THEN 'high'
        WHEN 'P3' THEN 'normal'
        WHEN 'P4' THEN 'low'
        ELSE 'normal' END) AS priority,
      ROUND(AVG(
        (julianday(cfs.onscene_at) - julianday(cfs.dispatched_at)) * 24 * 60
      ), 1) AS avg_minutes,
      COUNT(*) AS call_count
    ${FROM}
    WHERE ${w.sql}
      AND cfs.dispatched_at IS NOT NULL
      AND cfs.onscene_at    IS NOT NULL
    GROUP BY priority
    ORDER BY i.priority
  `, ...w.bindings);

  // Repeat offenders — persons linked to ≥3 incidents in window as
  // suspect/arrestee. Joined to persons for display name.
  const repeatRows = await query<Record<string, unknown>>(db, `
    SELECT
      p.id                                          AS person_id,
      TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')) AS name,
      COUNT(DISTINCT i.id)                          AS incident_count
    FROM incident_persons ip
    JOIN persons p ON p.id = ip.person_id
    JOIN incidents i ON i.id = ip.incident_id
    LEFT JOIN calls_for_service cfs ON cfs.id = i.call_id
    WHERE ${w.sql}
      AND ip.role IN ('suspect','arrestee')
    GROUP BY p.id, name
    HAVING incident_count >= 3
    ORDER BY incident_count DESC
    LIMIT 25
  `, ...w.bindings);

  return c.json({
    data: {
      // ── Task-spec shape ──
      totals: {
        total_incidents: totalIncidents,
        total_offenses: totalOffenses,
        unique_properties: Number(totalsRow?.unique_properties || 0),
        unique_officers: Number(totalsRow?.unique_officers || 0),
        by_priority: {
          P1: Number(totalsRow?.p1 || 0),
          P2: Number(totalsRow?.p2 || 0),
          P3: Number(totalsRow?.p3 || 0),
          P4: Number(totalsRow?.p4 || 0),
        },
      },
      by_type,
      by_day,
      by_hour: byHourArr,
      by_property,
      generated_at: new Date().toISOString(),

      // ── Legacy shape (CrimeAnalysisPage.tsx) ──
      topOffenses: by_type.map((t) => ({ offense_type: t.description, count: t.count })),
      hotspots: hotspots.map((h) => ({
        location: h.location,
        lat: h.lat,
        lng: h.lng,
        count: Number(h.count),
      })),
      dayOfWeek: dowRows.map((r) => ({ day_of_week: Number(r.day_of_week), count: Number(r.count) })),
      timeOfDay: todRows.map((r) => ({ hour: Number(r.hour), count: Number(r.count) })),
      trendData: trendRows.map((r) => ({ month: r.month, count: Number(r.count) })),
      clearanceRate: { rate: clearanceRate },
      responseMetrics: respRows.map((r) => ({
        priority: r.priority,
        avg_minutes: r.avg_minutes,
        call_count: Number(r.call_count),
      })),
      repeatOffenders: repeatRows.map((r) => ({
        person_id: Number(r.person_id),
        name: r.name || 'Unknown',
        incident_count: Number(r.incident_count),
      })),
    },
  });
});

// ── GET /crime-analysis/export?format=csv ────────────────────
// One row per incident, primary offense = MIN(incident_offenses.id).
// 50,000-row cap is enforced via LIMIT in the SQL rather than a runtime
// counter so D1 never ships rows we'd just discard.
const CSV_ROW_CAP = 50_000;

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

reports.get('/crime-analysis/export', async (c) => {
  const format = new URL(c.req.url).searchParams.get('format') || 'csv';
  if (format !== 'csv') {
    return c.json({ error: 'Only format=csv is supported' }, 400);
  }
  const db = getDb(c.env);
  const f = parseFilters(c);
  const w = whereClause(f);

  // Correlated subquery picks MIN(id) per incident — the offense row
  // inserted first. This is the deterministic stand-in for a "primary"
  // designation since incident_offenses has no is_primary flag.
  const rows = await query<Record<string, unknown>>(db, `
    SELECT
      i.id                AS incident_id,
      i.incident_number   AS incident_number,
      i.created_at        AS date,
      io.code             AS type_code,
      COALESCE(noc.description, io.description, io.offense_type, '') AS type_description,
      i.priority          AS priority,
      COALESCE(p.name, '') AS property_name,
      i.status            AS status,
      COALESCE(u.full_name, u.username, '') AS primary_officer,
      COALESCE(i.location_address, '') AS location_address
    FROM incidents i
    LEFT JOIN calls_for_service cfs ON cfs.id = i.call_id
    LEFT JOIN properties p ON p.id = cfs.property_id
    LEFT JOIN users u ON u.id = i.officer_id
    LEFT JOIN incident_offenses io ON io.id = (
      SELECT MIN(id) FROM incident_offenses WHERE incident_id = i.id
    )
    LEFT JOIN nibrs_offense_codes noc ON noc.code = io.code
    WHERE ${w.sql}
    ORDER BY i.created_at DESC
    LIMIT ?
  `, ...w.bindings, CSV_ROW_CAP);

  const header = [
    'incident_id', 'incident_number', 'date', 'type_code', 'type_description',
    'priority', 'property_name', 'status', 'primary_officer', 'location_address',
  ];
  const lines: string[] = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.incident_id, r.incident_number, r.date, r.type_code, r.type_description,
      r.priority, r.property_name, r.status, r.primary_officer, r.location_address,
    ].map(csvEscape).join(','));
  }
  const body = lines.join('\r\n');

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename=crime-analysis-${f.startSlug}-${f.endSlug}.csv`,
      'cache-control': 'private, no-store',
    },
  });
});

export default reports;
