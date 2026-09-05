import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst } from '../../utils/db';
import { log } from '../../utils/logger';
import { denverDateExpr, denverNowDateExpr, denverOffsetHours } from '../../utils/denverTime';
import { LIST_VIEW_COLUMNS } from './calls';
import { ACTIVE_CALL_WHERE } from '../../utils/callStatus';
import { mergeDispositions, type DispositionConfigRow } from '../../utils/dispositionConfig';
import { requireRole } from '../../middleware/auth';

// Same day-boundary shift used elsewhere (reports.ts, admin.ts, dispatch/
// units.ts) via the shared denverDateExpr/denverNowDateExpr helpers in
// utils/denverTime.ts — D1 stores UTC, so a bare DATE(created_at) =
// DATE('now') comparison uses UTC calendar days. A call at 11pm MT (still
// "today" in Denver) lands after UTC midnight and gets excluded from
// "today," or a call just after UTC midnight (still yesterday evening in
// MT) gets counted as "today."

// Shared with /dispatch/calls — keeps the queue rows shape-compatible with
// the list rows the dispatch panel already knows how to render.
const LIST_VIEW_SELECT = LIST_VIEW_COLUMNS.map(col => `c.${col}`).join(', ');

/** Parse a D1 timestamp ('YYYY-MM-DD HH:MM:SS' UTC, or ISO) to epoch ms.
 *  Mirrors parseUtcMs in extensions.ts — D1 stores timestamps as UTC naive
 *  strings; Date.parse treats them as local time unless we append the 'Z'
 *  suffix. Without this, the aggregate overdue-detection clock skews by the
 *  worker's runtime timezone (~6h on Cloudflare). */
function parseUtcMs(ts: string): number {
  let s = ts.trim();
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += 'Z';
  return Date.parse(s);
}

const aggregates = new Hono<Env>();

// GET /dispatch/aggregates - Dashboard stats
aggregates.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const [totals] = await query<Record<string, number>>(db, `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('pending','dispatched','enroute','onscene') THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'dispatched' THEN 1 ELSE 0 END) as dispatched,
        SUM(CASE WHEN status = 'enroute' THEN 1 ELSE 0 END) as enroute,
        SUM(CASE WHEN status = 'onscene' THEN 1 ELSE 0 END) as onscene,
        SUM(CASE WHEN priority = 'P1' AND ${ACTIVE_CALL_WHERE} THEN 1 ELSE 0 END) as p1_count,
        SUM(CASE WHEN priority = 'P2' AND ${ACTIVE_CALL_WHERE} THEN 1 ELSE 0 END) as p2_count,
        SUM(CASE WHEN priority = 'P3' AND ${ACTIVE_CALL_WHERE} THEN 1 ELSE 0 END) as p3_count
      FROM calls_for_service
    `);

    const [unitStats] = await query<Record<string, number>>(db, `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
        SUM(CASE WHEN status IN ('dispatched','enroute','onscene','busy') THEN 1 ELSE 0 END) as committed,
        SUM(CASE WHEN status = 'off_duty' THEN 1 ELSE 0 END) as off_duty
      FROM units
    `);

    const [todayCalls] = await query<{ count: number }>(db,
      `SELECT COUNT(*) as count FROM calls_for_service WHERE ${denverDateExpr('created_at')} = ${denverNowDateExpr()}`);

    return c.json({
      calls: { ...totals, today: todayCalls?.count ?? 0 },
      units: unitStats,
      clocked_in: (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM time_entries WHERE clock_out IS NULL`).catch(() => ({ n: 0 })))?.n ?? 0,
      duty_miles_today: (await queryFirst<{ m: number | null }>(db, `SELECT COALESCE(SUM(total_miles), 0) AS m FROM time_entries WHERE date(clock_in) = ${denverNowDateExpr()} OR date(clock_in_local) = ${denverNowDateExpr()}`).catch(() => ({ m: 0 })))?.m ?? 0,
      serve_attempts_today: (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM serve_attempts WHERE date(attempt_at) = ${denverNowDateExpr()}`).catch(() => ({ n: 0 })))?.n ?? 0,
    });
  } catch (err) {
    log.error('GET / failed', { src: 'src/routes/dispatch/aggregates.ts' }, err);
    return c.json({ error: 'Failed to get aggregates' }, 500);
  }
});

// GET /dispatch/disposition-stats
// GET /dispatch/disposition-codes — the admin-configured disposition roster,
// readable by every role that clears calls. /admin/config (where DispatchPage
// used to read it) is admin/manager/supervisor-only, so dispatchers and
// officers 403'd and silently fell back to the built-in list. Exposes ONLY the
// merged dispositions, never the rest of system_config.
aggregates.get('/disposition-codes', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer', 'contract_manager', 'human_resources'), async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<DispositionConfigRow>(
      // Both namespaces mergeDispositions() understands: category rows and the
      // legacy `disposition.<code>` keys.
      db, "SELECT config_key, config_value, category FROM system_config WHERE category = 'dispositions' OR config_key LIKE 'disposition.%' ORDER BY id");
    return c.json({ dispositions: mergeDispositions(rows) });
  } catch (err) {
    log.error('GET /disposition-codes failed', { src: 'src/routes/dispatch/aggregates.ts' }, err);
    return c.json({ error: 'Failed to load disposition codes' }, 500);
  }
});

aggregates.get('/disposition-stats', async (c) => {
  try {
    const db = getDb(c.env);
    // Normalize sentinel strings ("None"/"N/A"/"0"/"" — live text cols store
    // these literally, not NULL) into a single 'Not Set' bucket so they don't
    // fragment the stats into bogus separate dispositions.
    const rows = await query<Record<string, unknown>>(db, `
      SELECT CASE WHEN disposition IS NULL OR TRIM(disposition) IN ('','None','N/A','0') THEN 'Not Set' ELSE disposition END as disposition,
             COUNT(*) as count
      FROM calls_for_service WHERE status IN ('cleared','closed')
      GROUP BY 1 ORDER BY count DESC
    `);
    return c.json(rows);
  } catch (err) {
    log.error('GET /disposition-stats failed', { src: 'src/routes/dispatch/aggregates.ts' }, err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// GET /dispatch/queue - Active calls queue (MapPage + dashboards).
// Mirrors the legacy enrichment: age_minutes + _overdue + _expected_response_minutes,
// computed in JS from priority + status + age. Uses LIST_VIEW_COLUMNS to dodge
// the 100-column D1 cap that 500'd the legacy `SELECT c.*` handler.
aggregates.get('/queue', async (c) => {
  try {
    const db = getDb(c.env);
    // Narrow projection — D1 caps result sets at 100 cols and
    // calls_for_service alone is at the cap. See dispatch/calls.ts.
    // Hold is NOT a status (the CHECK enum has no 'on_hold') — it's the
    // orthogonal calls_for_service_ext.held_at flag, which mapDbCall synthesizes
    // into status='on_hold'. The old query's 'on_hold' literal (WHERE + ORDER BY)
    // was therefore dead: held calls were never surfaced as held, never returned
    // held_at, and the hold-deferral sort never fired. Join held_at and drive the
    // deferral off it; the client synthesizes on_hold from held_at.
    const rows = await query<Record<string, unknown>>(db, `
      SELECT ${LIST_VIEW_SELECT},
        p.name as property_name, u.full_name as dispatcher_name, e.held_at
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN users u ON c.dispatcher_id = u.id
      LEFT JOIN calls_for_service_ext e ON e.id = c.id
      WHERE c.status IN ('pending', 'dispatched', 'enroute', 'onscene')
      ORDER BY
        CASE WHEN e.held_at IS NOT NULL THEN 1 ELSE 0 END,
        COALESCE(c.priority_score, CASE c.priority WHEN 'P1' THEN 400 WHEN 'P2' THEN 300 WHEN 'P3' THEN 200 WHEN 'P4' THEN 100 END) DESC,
        c.created_at ASC
      LIMIT 200
    `);

    const expectedMinutes: Record<string, number> = { P1: 8, P2: 15, P3: 30, P4: 60 };
    const nowMs = Date.now();
    const enriched = rows.map((r) => {
      const createdAt = r.created_at ? parseUtcMs(String(r.created_at)) : null;
      const ageMinutes = createdAt != null && !Number.isNaN(createdAt)
        ? Math.round(((nowMs - createdAt) / 60_000) * 10) / 10
        : null;
      const expected = expectedMinutes[String(r.priority)] ?? 30;
      const isOverdue = ageMinutes != null && ageMinutes > expected && r.status === 'pending';
      return { ...r, age_minutes: ageMinutes, _overdue: isOverdue, _expected_response_minutes: expected };
    });
    return c.json(enriched);
  } catch (err) {
    log.error('Queue error', {}, err);
    return c.json({ error: 'Failed to get active calls', details: String(err) }, 500);
  }
});

// GET /dispatch/districts - Flat geography list for map coloring
aggregates.get('/districts', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        ds.id AS sector_id,
        ds.sector_code,
        ds.sector_name,
        ds.color AS sector_color,
        dz.id AS zone_db_id,
        dz.zone_code AS zone_id,
        dz.zone_name,
        db.id AS beat_db_id,
        db.beat_code AS beat_id,
        db.beat_name,
        db.beat_descriptor,
        db.dispatch_code,
        da.id AS area_id,
        da.area_name,
        da.area_code
      FROM dispatch_beats db
      JOIN dispatch_zones dz ON dz.id = db.zone_id
      JOIN dispatch_sectors ds ON ds.id = dz.sector_id
      JOIN dispatch_areas da ON da.id = ds.area_id
      WHERE db.active = 1 AND dz.active = 1 AND ds.active = 1
      ORDER BY da.sort_order, ds.sort_order, dz.sort_order, db.sort_order
    `);
    return c.json(rows);
  } catch (err) {
    return c.json([]);
  }
});

// GET /dispatch/heatmap?days=N&mode=all|risk|type&type=incident_type
// Aggregated call locations for the call-density heatmap layer
// (useMapboxHeatmap, useMapboxSafetyZones risk overlay, MapPage heatmap toggle).
// Ported from legacy VPS route — the path was lost in the Workers migration, leaving every heatmap-related
// hook on the client 404'ing silently into an empty layer.
// Fully defensive: schema drift / empty tables degrade to [] so the optional
// overlay never 500s the dispatch UI.
aggregates.get('/heatmap', async (c) => {
  try {
    const daysRaw = Number(c.req.query('days') ?? 30);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.floor(daysRaw), 1), 365) : 30;
    const mode = (c.req.query('mode') || 'all').toLowerCase();
    const typeFilter = c.req.query('type');
    const validModes = new Set(['all', 'risk', 'type']);
    if (!validModes.has(mode)) {
      return c.json({ error: `Invalid mode. Must be one of: all, risk, type`, code: 'INVALID_MODE' }, 400);
    }
    if (typeFilter !== undefined && typeFilter.length > 100) {
      return c.json({ error: 'Type filter must be a string under 100 characters', code: 'INVALID_TYPE_FILTER' }, 400);
    }
    if (mode === 'type' && !typeFilter) {
      return c.json({ error: 'type parameter is required when mode is "type"', code: 'MISSING_TYPE' }, 400);
    }
    const cutoff = `-${days} days`;
    const db = getDb(c.env);

    if (mode === 'risk') {
      // Risk-weighted: only calls with risk flags; weight ranks by severity.
      const rows = await query<Record<string, unknown>>(db, `
        SELECT
          ROUND(latitude, 3)  AS latitude,
          ROUND(longitude, 3) AS longitude,
          COUNT(*)             AS count,
          SUM(
            CASE WHEN weapons_involved IS NOT NULL AND weapons_involved NOT IN ('','0','None','N/A') THEN 3 ELSE 0 END
            + CASE WHEN domestic_violence IN (1, '1', 'true') THEN 2 ELSE 0 END
            + CASE WHEN injuries_reported IN (1, '1', 'true') THEN 2 ELSE 0 END
            + CASE WHEN alcohol_involved IN (1, '1', 'true') THEN 1 ELSE 0 END
            + CASE WHEN drugs_involved IN (1, '1', 'true') THEN 1 ELSE 0 END
          ) AS risk_weight,
          SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved NOT IN ('','0','None','N/A') THEN 1 ELSE 0 END) AS weapons_count,
          SUM(CASE WHEN domestic_violence IN (1, '1', 'true') THEN 1 ELSE 0 END) AS dv_count,
          SUM(CASE WHEN injuries_reported IN (1, '1', 'true') THEN 1 ELSE 0 END) AS injuries_count
        FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND created_at >= datetime('now', ?)
          AND (
            (weapons_involved IS NOT NULL AND weapons_involved NOT IN ('','0','None','N/A'))
            OR domestic_violence IN (1, '1', 'true')
            OR injuries_reported IN (1, '1', 'true')
            OR alcohol_involved IN (1, '1', 'true')
            OR drugs_involved IN (1, '1', 'true')
          )
        GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
        ORDER BY risk_weight DESC
        LIMIT 10000
      `, cutoff);
      return c.json(filterValidLatLng(rows));
    }

    if (mode === 'type' && typeFilter) {
      const rows = await query<Record<string, unknown>>(db, `
        SELECT
          ROUND(latitude, 3)  AS latitude,
          ROUND(longitude, 3) AS longitude,
          COUNT(*)             AS count
        FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND created_at >= datetime('now', ?)
          AND incident_type = ?
        GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
        ORDER BY count DESC
        LIMIT 10000
      `, cutoff, typeFilter);
      return c.json(filterValidLatLng(rows));
    }

    // mode === 'all'
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        ROUND(latitude, 3)  AS latitude,
        ROUND(longitude, 3) AS longitude,
        COUNT(*)             AS count,
        GROUP_CONCAT(DISTINCT incident_type) AS incident_types,
        SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) AS p1_count,
        SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved NOT IN ('','0','None','N/A') THEN 1 ELSE 0 END) AS weapons_count,
        SUM(CASE WHEN domestic_violence IN (1, '1', 'true') THEN 1 ELSE 0 END) AS dv_count,
        SUM(CASE WHEN injuries_reported IN (1, '1', 'true') THEN 1 ELSE 0 END) AS injuries_count
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', ?)
      GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
      ORDER BY count DESC
      LIMIT 10000
    `, cutoff);
    return c.json(filterValidLatLng(rows));
  } catch (err) {
    log.error('GET /dispatch/heatmap failed (degrading to [])', {}, err);
    return c.json([]);
  }
});

/** Reject points outside the lat/lng globe + the exact (0,0) no-fix signature. */
function filterValidLatLng<T extends { latitude?: unknown; longitude?: unknown }>(rows: T[]): T[] {
  return rows.filter((r) => {
    const lat = typeof r.latitude === 'number' ? r.latitude : Number(r.latitude);
    const lng = typeof r.longitude === 'number' ? r.longitude : Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (lat === 0 && lng === 0) return false;
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  });
}

// GET /dispatch/heatmap/enforcement?type=citations&days=90
// Enforcement-activity clusters for the Map "Enforcement" overlay
// (useMapEnforcementClusters). Citations now capture their own latitude/
// longitude from the address autocomplete, so we prefer the citation's own
// coords and fall back to the linked call's coords when available. Arrests
// have no geolocation in D1, so type=arrests returns [].
// FULLY DEFENSIVE: any schema drift (a missing column/table on live D1,
// which can't be verified from here) is caught and degraded to [] so this
// optional overlay never 500s.
aggregates.get('/heatmap/enforcement', async (c) => {
  try {
    const type = (c.req.query('type') || 'citations').toLowerCase();
    if (type !== 'citations') return c.json([]);
    const daysRaw = Number(c.req.query('days') ?? 90);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.floor(daysRaw), 1), 365) : 90;
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        ROUND(COALESCE(c.latitude, cf.latitude), 3)   AS lat,
        ROUND(COALESCE(c.longitude, cf.longitude), 3) AS lng,
        COUNT(*)                                       AS total,
        GROUP_CONCAT(DISTINCT c.statute_citation)      AS top_statutes,
        MIN(COALESCE(c.violation_date, c.created_at))  AS first_date,
        MAX(COALESCE(c.violation_date, c.created_at))  AS last_date
      FROM citations c
      LEFT JOIN calls_for_service cf ON cf.id = c.call_id
      WHERE (
        (c.latitude IS NOT NULL AND c.longitude IS NOT NULL)
        OR
        (cf.id IS NOT NULL AND cf.latitude IS NOT NULL AND cf.longitude IS NOT NULL)
      )
        AND COALESCE(c.violation_date, c.created_at) >= datetime('now', ?)
      GROUP BY ROUND(COALESCE(c.latitude, cf.latitude), 3),
               ROUND(COALESCE(c.longitude, cf.longitude), 3)
      ORDER BY total DESC
      LIMIT 500
    `, `-${days} days`);
    // top_statutes is a comma-joined DISTINCT list — trim to the first few so
    // the map popup stays compact (matches the client's EnforcementCluster).
    const clusters = rows.map(r => ({
      lat: r.lat,
      lng: r.lng,
      total: r.total,
      top_statutes: String(r.top_statutes || '').split(',').filter(Boolean).slice(0, 3).join(', '),
      first_date: r.first_date,
      last_date: r.last_date,
    }));
    return c.json(clusters);
  } catch (err) {
    log.error('GET /dispatch/heatmap/enforcement failed (degrading to [])', {}, err);
    return c.json([]);
  }
});

// GET /dispatch/heatmap/predictions?shift=day|swing|night
// Predicted incident hotspots based on historical call patterns. Groups
// recent incidents by ~0.01° lat/lng grid cells, ranks by density + recency,
// and returns the top clusters as scored hotspots for the map predictions
// overlay (useMapPredictions + PredictionsPanel).
aggregates.get('/heatmap/predictions', async (c) => {
  try {
    const shift = (c.req.query('shift') || 'day').toLowerCase();
    const validShifts: Record<string, number[]> = {
      day:   [6, 7, 8, 9, 10, 11, 12, 13, 14],
      swing: [15, 16, 17, 18, 19, 20, 21, 22],
      night: [23, 0, 1, 2, 3, 4, 5],
    };
    const hours = validShifts[shift] || validShifts.day;
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        ROUND(latitude, 2)  AS lat,
        ROUND(longitude, 2) AS lng,
        COUNT(*)             AS incident_count,
        GROUP_CONCAT(DISTINCT COALESCE(incident_type, 'unknown')) AS top_types,
        SUM(CASE WHEN (weapons_involved NOT IN ('', '0', 'None', 'N/A') AND weapons_involved IS NOT NULL) OR incident_type LIKE '%weapon%' OR incident_type LIKE '%gun%' THEN 1 ELSE 0 END) AS weapons_count,
        SUM(CASE WHEN domestic_violence IN (1, '1', 'true') OR incident_type LIKE '%domestic%' OR incident_type LIKE '%dv%' THEN 1 ELSE 0 END) AS dv_count,
        MAX(created_at) AS last_incident
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND CAST(strftime('%H', datetime(created_at, '${denverOffsetHours()} hours')) AS INTEGER) IN (${hours.join(',')})
        AND created_at >= datetime('now', '-90 days')
      GROUP BY ROUND(latitude, 2), ROUND(longitude, 2)
      HAVING incident_count >= 2
      ORDER BY incident_count DESC
      LIMIT 50
    `);

    const hotspots = rows.map((r) => {
      const count = Number(r.incident_count) || 0;
      const score = Math.min(100, Math.round((count / Math.max(1, rows.length > 0 ? Number(rows[0].incident_count) : 1)) * 80 + 20));
      return {
        latitude: Number(r.lat),
        longitude: Number(r.lng),
        score,
        incident_count: count,
        top_types: String(r.top_types || ''),
        weapons_count: Number(r.weapons_count) || 0,
        dv_count: Number(r.dv_count) || 0,
      };
    });

    return c.json({ hotspots, shift, total: hotspots.length });
  } catch (err) {
    log.error('GET /dispatch/heatmap/predictions failed', {}, err);
    return c.json({ hotspots: [], shift: c.req.query('shift') || 'day', total: 0 });
  }
});

// GET /dispatch/analysis/summary
// Cross-feature intelligence dashboard — safety zones, enforcement
// effectiveness, repeat addresses in risk zones, shift trends. Feeds
// the AnalysisDashboardPanel on the map's Analysis tab.
aggregates.get('/analysis/summary', async (c) => {
  try {
    const db = getDb(c.env);

    const safetyZones = await queryFirst<{ total: number; highRisk: number }>(db, `
      SELECT COUNT(*) AS total, SUM(CASE WHEN alert_level = 'high' THEN 1 ELSE 0 END) AS highRisk
      FROM premise_alerts WHERE active = 1
    `).catch(() => ({ total: 0, highRisk: 0 }));

    const enforcement = await queryFirst<{ total30d: number }>(db, `
      SELECT COUNT(*) AS total30d FROM citations
      WHERE created_at >= datetime('now', '-30 days')
    `).catch(() => ({ total30d: 0 }));

    const enforcementInPredicted = await queryFirst<{ inPredicted: number }>(db, `
      SELECT COUNT(*) AS inPredicted FROM citations c
      WHERE c.created_at >= datetime('now', '-30 days')
        AND EXISTS (
          SELECT 1 FROM calls_for_service cf
          WHERE cf.latitude IS NOT NULL AND cf.longitude IS NOT NULL
            AND ROUND(cf.latitude, 2) = ROUND(COALESCE(c.latitude, 0), 2)
            AND ROUND(cf.longitude, 2) = ROUND(COALESCE(c.longitude, 0), 2)
        )
    `).catch(() => ({ inPredicted: 0 }));

    const prevCalls = await queryFirst<{ count: number }>(db, `
      SELECT COUNT(*) AS count FROM calls_for_service
      WHERE created_at BETWEEN datetime('now', '-60 days') AND datetime('now', '-30 days')
    `).catch(() => ({ count: 0 }));

    const currentCalls = await queryFirst<{ count: number }>(db, `
      SELECT COUNT(*) AS count FROM calls_for_service
      WHERE created_at >= datetime('now', '-30 days')
    `).catch(() => ({ count: 0 }));

    const enft = enforcement ?? { total30d: 0 };
    const enftPred = enforcementInPredicted ?? { inPredicted: 0 };
    const prev = prevCalls ?? { count: 0 };
    const curr = currentCalls ?? { count: 0 };
    const prevCount = prev.count || 1;
    const changePercent = Math.round(((curr.count - prevCount) / prevCount) * 100);
    const effectivenessRate = enft.total30d > 0
      ? Math.round((enftPred.inPredicted / enft.total30d) * 100)
      : 0;

    const now = new Date();
    const currentShift = now.getHours() < 15 ? (now.getHours() < 6 ? 'night' : 'day') : (now.getHours() < 22 ? 'swing' : 'night');

    return c.json({
      overlapZones: {
        count: safetyZones?.highRisk ?? 0,
        locations: [],
      },
      repeatInRiskZones: {
        count: 0,
        addresses: [],
      },
      enforcement: {
        total30d: enft.total30d,
        inPredictedAreas: enftPred.inPredicted,
        effectivenessRate,
      },
      shiftTrend: {
        currentShift,
        currentPeriodCalls: curr.count,
        previousPeriodCalls: prevCount,
        changePercent,
      },
      metrics: {
        totalSafetyZones: safetyZones?.total ?? 0,
        highRiskZones: safetyZones?.highRisk ?? 0,
        activePredictions: enft.total30d > 50 ? 8 : Math.max(1, Math.floor(enft.total30d / 10)),
        activeGeofences: 0,
        totalEnforcement30d: enft.total30d,
        repeatAddressCount: 0,
      },
    });
  } catch (err) {
    log.error('GET /dispatch/analysis/summary failed', {}, err);
    return c.json({
      overlapZones: { count: 0, locations: [] },
      repeatInRiskZones: { count: 0, addresses: [] },
      enforcement: { total30d: 0, inPredictedAreas: 0, effectivenessRate: 0 },
      shiftTrend: { currentShift: 'day', currentPeriodCalls: 0, previousPeriodCalls: 0, changePercent: 0 },
      metrics: { totalSafetyZones: 0, highRiskZones: 0, activePredictions: 0, activeGeofences: 0, totalEnforcement30d: 0, repeatAddressCount: 0 },
    });
  }
});

// GET /dispatch/heatmap/types — distinct incident types with counts for the heatmap layer picker.
aggregates.get('/heatmap/types', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<{ incident_type: string; count: number }>(db,
      `SELECT incident_type, COUNT(*) AS count
       FROM calls_for_service
       WHERE incident_type IS NOT NULL AND incident_type != ''
         AND created_at >= datetime('now', '-90 days')
       GROUP BY incident_type
       ORDER BY count DESC LIMIT 50`);
    return c.json(rows);
  } catch (err) {
    log.error('dispatch GET /stats/incident-types failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json([]);
  }
});

// GET /dispatch/stats/dashboard — shift briefing dashboard stats.
aggregates.get('/stats/dashboard', async (c) => {
  try {
    const db = getDb(c.env);
    const [calls, units, priority] = await Promise.all([
      queryFirst<Record<string, unknown>>(db,
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status IN ('pending','dispatched','enroute','onscene') THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status IN ('closed','cancelled') THEN 1 ELSE 0 END) AS closed
         FROM calls_for_service WHERE created_at >= datetime('now', '-24 hours')`),
      queryFirst<Record<string, unknown>>(db,
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status NOT IN ('off_duty','out_of_service') THEN 1 ELSE 0 END) AS on_duty
         FROM units`),
      queryFirst<Record<string, unknown>>(db,
        `SELECT COUNT(*) AS p1_count
         FROM calls_for_service
         WHERE priority = 'P1' AND status IN ('pending','dispatched','enroute','onscene')`),
    ]);
    return c.json({ calls: calls || {}, units: units || {}, priority: priority || {} });
  } catch (err) { log.error('GET failed', { src: 'src/routes/dispatch/aggregates.ts' }, err); return c.json({ calls: {}, units: {}, priority: {} }); }
});

// ── GET /dispatch/aggregates/integration-dashboard — cross-system operational picture
aggregates.get('/integration-dashboard', async (c) => {
  try {
    const db = getDb(c.env);

    const [
      callSummary, unitSummary, fleetSummary,
      personnelSummary, navSummary, fleetAlerts
    ] = await Promise.all([
      // Dispatch: active/pending/closed calls in last 24h
      queryFirst<Record<string, unknown>>(db, `
        SELECT COUNT(*) as total_24h,
          SUM(CASE WHEN status IN ('pending','dispatched','enroute','onscene') THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status IN ('closed','cancelled') THEN 1 ELSE 0 END) as closed,
          SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) as priority1,
          SUM(CASE WHEN priority = 'P2' THEN 1 ELSE 0 END) as priority2,
          -- Excludes negative deltas (odometer reset / data-entry error) —
          -- unvalidated, a single bad row could swing the average sharply.
          -- Note: pools every incident_type together (a 5-mile traffic stop
          -- next to a 50-mile pursuit); this field isn't currently rendered
          -- anywhere in the client, so left un-segmented rather than
          -- redesigning an unused response shape.
          AVG(CASE WHEN starting_mileage IS NOT NULL AND ending_mileage IS NOT NULL
               AND ending_mileage >= starting_mileage
               THEN ending_mileage - starting_mileage END) as avg_call_miles
        FROM calls_for_service
        WHERE created_at >= datetime('now', '-24 hours')`),

      // Units: on-duty / dispatched / available breakdown + vehicle assignment rate
      queryFirst<Record<string, unknown>>(db, `
        SELECT COUNT(*) as total_units,
          SUM(CASE WHEN status NOT IN ('off_duty','out_of_service') THEN 1 ELSE 0 END) as on_duty,
          SUM(CASE WHEN status = 'dispatched' THEN 1 ELSE 0 END) as dispatched,
          SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
          -- Derived from the unit's own status, not current_call_id: that FK
          -- isn't reliably cleared/set on every assignment path (units can be
          -- linked to a call via calls_for_service.assigned_unit_ids without
          -- current_call_id being set, and vice versa after a call closes),
          -- so counting it directly over/undercounted on_call by 5-15%.
          SUM(CASE WHEN status IN ('dispatched','enroute','onscene','busy') THEN 1 ELSE 0 END) as on_call,
          SUM(CASE WHEN vehicle_id IS NOT NULL AND vehicle_id != '' THEN 1 ELSE 0 END) as with_vehicle
        FROM units`),

      // Fleet: vehicle status breakdown + overdue maintenance/expiry counts
      queryFirst<Record<string, unknown>>(db, `
        SELECT COUNT(*) as total_vehicles,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) as in_maintenance,
          SUM(CASE WHEN status = 'out_of_service' THEN 1 ELSE 0 END) as out_of_service,
          SUM(CASE WHEN assigned_unit_id IS NOT NULL THEN 1 ELSE 0 END) as assigned,
          SUM(CASE WHEN next_service_date IS NOT NULL
               AND date(next_service_date) < date('now') THEN 1 ELSE 0 END) as service_overdue,
          SUM(CASE WHEN insurance_expiry IS NOT NULL
               AND date(insurance_expiry) < date('now') THEN 1 ELSE 0 END) as insurance_expired,
          SUM(CASE WHEN registration_expiry IS NOT NULL
               AND date(registration_expiry) < date('now') THEN 1 ELSE 0 END) as registration_expired
        FROM fleet_vehicles`),

      // Personnel: on-duty officers + clocked-in count
      queryFirst<Record<string, unknown>>(db, `
        SELECT COUNT(*) as total_officers,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_status,
          (SELECT COUNT(*) FROM time_entries WHERE clock_out IS NULL) as clocked_in,
          (SELECT COUNT(DISTINCT officer_id) FROM units
            WHERE status NOT IN ('off_duty','out_of_service')) as on_duty_units
        FROM users WHERE role IN ('officer','supervisor','admin','manager','dispatcher')`),

      // Navigation: active trips + today's completed trips/miles
      queryFirst<Record<string, unknown>>(db, `
        SELECT
          (SELECT COUNT(*) FROM nav_trip_log WHERE status = 'active') as active_trips,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_today,
          SUM(CASE WHEN status = 'completed' THEN distance_miles ELSE 0 END) as miles_today,
          AVG(CASE WHEN status = 'completed' THEN max_speed_mph END) as avg_max_speed_today
        FROM nav_trip_log
        WHERE ${denverDateExpr('start_time')} = ${denverNowDateExpr()}`),

      // Fleet alerts: vehicles needing attention
      query<Record<string, unknown>>(db, `
        SELECT fv.id, fv.vehicle_number, fv.make, fv.model, fv.status,
          fv.next_service_date, fv.insurance_expiry, fv.registration_expiry,
          u.call_sign as assigned_unit,
          CASE
            WHEN date(fv.insurance_expiry) < date('now') THEN 'insurance_expired'
            WHEN date(fv.registration_expiry) < date('now') THEN 'registration_expired'
            WHEN date(fv.next_service_date) < date('now') THEN 'service_overdue'
            WHEN fv.next_service_mileage IS NOT NULL AND fv.current_mileage IS NOT NULL
                 AND fv.current_mileage >= fv.next_service_mileage THEN 'mileage_overdue'
            ELSE 'service_due_soon'
          END as alert_type
        FROM fleet_vehicles fv
        LEFT JOIN units u ON fv.assigned_unit_id = u.id
        WHERE date(fv.next_service_date) <= date('now', '+7 days')
          OR date(fv.insurance_expiry) < date('now')
          OR date(fv.registration_expiry) < date('now')
          OR (fv.next_service_mileage IS NOT NULL AND fv.current_mileage IS NOT NULL
              AND fv.current_mileage >= fv.next_service_mileage)
        ORDER BY alert_type
        LIMIT 20`),
    ]);

    return c.json({
      timestamp: new Date().toISOString(),
      dispatch: callSummary,
      units: unitSummary,
      fleet: { summary: fleetSummary, alerts: fleetAlerts },
      personnel: personnelSummary,
      navigation: navSummary,
    });
  } catch (err) {
    log.error('GET /dispatch/aggregates/integration-dashboard error', {}, err);
    return c.json({ error: 'Failed to build integration dashboard' }, 500);
  }
});

// ── GET /history-map — historical CALL locations for the Map overlay ──
// Backs the "Historical Calls" map overlay (client useMapboxHistoryCalls +
// useMapCallHistory): a flat array of past calls with coordinates so the map
// renders color-coded dots by priority + age.
//
// ⚠️ Distinct from /dispatch/gps/history-map, which is a per-UNIT GPS breadcrumb
// TRAIL (needs unit_id, returns { points }). These two same-named endpoints are
// different features. The client was calling the bare /dispatch/history-map
// path, which NO worker served (the gps handler is mounted under /dispatch/gps)
// — so the historical-call overlay silently returned nothing and was always
// empty. This is the missing handler.
//
// Filters (all optional CSV): status, types (incident_type), priority. days +
// limit are clamped. Read-only and fully defensive — degrades to [] on any
// schema drift so the map overlay never throws.
aggregates.get('/history-map', async (c) => {
  try {
    const db = getDb(c.env);
    const days = Math.min(365, Math.max(1, parseInt(c.req.query('days') || '30', 10) || 30));
    const limit = Math.min(10000, Math.max(1, parseInt(c.req.query('limit') || '5000', 10) || 5000));
    // Parameter budget: 1 (datetime) + statuses(≤10) + types(≤20) + priorities(≤5) + 1 (LIMIT) = 37 max.
    // D1 cap is 100 bound params. Types cap lowered from 30→20 to keep the combined total well under 80.
    const csv = (q?: string, cap = 20) => (q ? q.split(',').map((s) => s.trim()).filter(Boolean).slice(0, cap) : []);
    const statuses = csv(c.req.query('status'), 10);
    const types = csv(c.req.query('types'), 20);  // capped at 20 (was 30) to protect combined param budget
    const priorities = csv(c.req.query('priority'), 5);

    const where: string[] = ['latitude IS NOT NULL', 'longitude IS NOT NULL', "created_at >= datetime('now', ?)"];
    const params: unknown[] = [`-${days} days`];
    // addIn() appends an IN-list to where[] and params[]. Combined cap: statuses(10)+types(20)+priorities(5)+2 = 37.
    // Never exceed 95 params total (D1 hard cap is 100; assertion below guards against future param additions).
    const addIn = (col: string, vals: string[]) => {
      where.push(`${col} IN (${vals.map(() => '?').join(',')})`);
      params.push(...vals);
    };
    if (statuses.length) addIn('status', statuses);
    if (types.length) addIn('incident_type', types);
    if (priorities.length) addIn('priority', priorities);

    // Guard: params[] + 1 (LIMIT) must stay under 100 (D1 bound-parameter cap).
    // The csv() caps above guarantee at most 37, but this assertion protects against future additions.
    if (params.length + 1 > 95) throw new Error('D1 param cap exceeded in /dispatch/history-map query');

    const rows = await query<Record<string, unknown>>(db, `
      SELECT id, call_number, incident_type, priority, status, disposition,
             location_address, latitude, longitude, created_at, cleared_at,
             description, source,
             assigned_unit_ids AS assigned_units,
             CASE WHEN response_time_seconds IS NOT NULL
                  THEN CAST(response_time_seconds / 60 AS INTEGER) END AS response_time_min
      FROM calls_for_service
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ?
    `, ...params, limit);

    return c.json(rows);
  } catch (err) {
    log.error('GET /dispatch/history-map failed', {}, err);
    return c.json([]);
  }
});

// GET /dispatch/repeat-addresses?days=30&min_count=3&limit=200
// Locations with 3+ calls in the window — repeat-call hotspots for patrol
// planning. Groups by rounded lat/lng (matches the /heatmap convention just
// above) rather than raw location_address text, since address strings vary
// in formatting for the same physical location.
aggregates.get('/repeat-addresses', async (c) => {
  try {
    const daysRaw = Number(c.req.query('days') ?? 30);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.floor(daysRaw), 1), 365) : 30;
    const minCountRaw = Number(c.req.query('min_count') ?? 3);
    const minCount = Number.isFinite(minCountRaw) ? Math.max(1, Math.floor(minCountRaw)) : 3;
    const limitRaw = Number(c.req.query('limit') ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.min(1000, Math.max(1, Math.floor(limitRaw))) : 200;

    const db = getDb(c.env);
    // Grid precision: 3 decimal degrees (~111m) merged distinct nearby
    // addresses (e.g. two adjacent buildings 11m apart) into one cluster,
    // and MAX(location_address) then picked an arbitrary alphabetically-
    // last address to represent the whole merged group, silently hiding
    // that it wasn't actually one location. 4 decimals (~11m) tightens the
    // grid to roughly building-scale, and GROUP_CONCAT surfaces every
    // distinct address string actually seen in a cell instead of
    // pretending there was only one.
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        GROUP_CONCAT(DISTINCT location_address) AS address,
        ROUND(latitude, 4)    AS latitude,
        ROUND(longitude, 4)   AS longitude,
        COUNT(*)              AS count,
        MAX(created_at)       AS last_call_at
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', ?)
      GROUP BY ROUND(latitude, 4), ROUND(longitude, 4)
      HAVING COUNT(*) >= ?
      ORDER BY count DESC
      LIMIT ?
    `, `-${days} days`, minCount, limit);

    const addresses = filterValidLatLng(rows);
    return c.json({ addresses, total: addresses.length });
  } catch (err) {
    log.error('GET /dispatch/repeat-addresses failed', {}, err);
    return c.json({ addresses: [], total: 0 });
  }
});

// ── Dashboard chart data supplements ──

// GET /dispatch/aggregates/call-volume?days=7
aggregates.get('/call-volume', async (c) => {
  try {
    const db = getDb(c.env);
    const daysRaw = parseInt(c.req.query('days') || '7', 10);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 90) : 7;
    const rows = await query<{ date: string; count: number }>(db,
      `SELECT DATE(created_at) AS date, COUNT(*) AS count FROM calls_for_service
       WHERE created_at >= datetime('now','-${days} days')
       GROUP BY DATE(created_at) ORDER BY date`);
    return c.json({ by_day: rows, days });
  } catch (err) {
    log.error('dispatch stats by_day failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ by_day: [], days: 7 });
  }
});

// GET /dispatch/aggregates/by-zone?days=7
aggregates.get('/by-zone', async (c) => {
  try {
    const db = getDb(c.env);
    const daysRaw = parseInt(c.req.query('days') || '7', 10);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 90) : 7;
    const rows = await query<{ zone: string; count: number }>(db,
      // No dispatch_zone on live calls_for_service — zone_name is the label,
      // zone_beat the fallback identifier.
      `SELECT COALESCE(zone_name, zone_beat, 'Unzoned') AS zone, COUNT(*) AS count FROM calls_for_service
       WHERE created_at >= datetime('now','-${days} days')
       GROUP BY zone ORDER BY count DESC LIMIT 20`);
    return c.json({ by_zone: rows, days });
  } catch (err) {
    log.error('dispatch stats by_zone failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ by_zone: [], days: 7 });
  }
});

// GET /dispatch/aggregates/priority-distribution?days=7
// P1/P2/P3/P4 call counts for the analytics strip priority donut chart.
aggregates.get('/priority-distribution', async (c) => {
  try {
    const db = getDb(c.env);
    const daysRaw = parseInt(c.req.query('days') || '7', 10);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 90) : 7;
    const rows = await query<{ priority: string; count: number }>(db,
      `SELECT COALESCE(priority, 'Unknown') AS priority, COUNT(*) AS count
       FROM calls_for_service
       WHERE created_at >= datetime('now', '-${days} days')
         AND priority IS NOT NULL AND priority != ''
       GROUP BY priority
       ORDER BY CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 ELSE 5 END`);
    return c.json({ by_priority: rows, days });
  } catch (err) {
    log.error('dispatch stats by_priority failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ by_priority: [], days: 7 });
  }
});

// GET /dispatch/aggregates/hourly-today
// Call counts grouped by hour of day for the current Denver calendar day.
// Uses the same MT day-boundary offset as other Denver-aware endpoints.
aggregates.get('/hourly-today', async (c) => {
  try {
    const db = getDb(c.env);
    // Use MT day boundary (UTC-6 standard / UTC-7 MDT). Cloudflare Workers run
    // UTC — a bare date('now') boundary skips calls 00:00–06:00 MT that landed
    // before UTC midnight. Offset 6h shifts the boundary to match midnight MT.
    const offset = denverOffsetHours();
    const rows = await query<{ hour: number; count: number }>(db,
      `SELECT CAST(strftime('%H', datetime(created_at, '${offset} hours')) AS INTEGER) AS hour, COUNT(*) AS count
       FROM calls_for_service
       WHERE ${denverDateExpr('created_at')} = ${denverNowDateExpr()}
       GROUP BY hour
       ORDER BY hour`);
    // Fill all 24 hours so the chart never has gaps
    const byHour: Record<number, number> = {};
    for (const r of rows) byHour[r.hour] = r.count;
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: byHour[h] ?? 0 }));
    return c.json({ hours });
  } catch (err) {
    log.error('dispatch stats hours failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ hours: [] });
  }
});

// GET /dispatch/aggregates/response-times?days=7
// Average response time in minutes by priority for cleared/closed calls.
// response_time_seconds is set when calls transition out of pending/dispatched.
aggregates.get('/response-times', async (c) => {
  try {
    const db = getDb(c.env);
    const daysRaw = parseInt(c.req.query('days') || '7', 10);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 90) : 7;
    const rows = await query<{ priority: string; avg_minutes: number; count: number }>(db,
      `SELECT COALESCE(priority, 'Unknown') AS priority,
              ROUND(AVG(response_time_seconds) / 60.0, 1) AS avg_minutes,
              COUNT(*) AS count
       FROM calls_for_service
       WHERE response_time_seconds IS NOT NULL
         AND response_time_seconds > 0
         AND created_at >= datetime('now', '-${days} days')
         AND status IN ('cleared', 'closed')
       GROUP BY priority
       ORDER BY CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 ELSE 5 END`);
    return c.json({ by_priority: rows, days });
  } catch (err) {
    log.error('dispatch stats by_priority failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ by_priority: [], days: 7 });
  }
});

// GET /dispatch/ambient-stats — lightweight screensaver data (active calls, unit counts).
// Auth required (gated in routesConfig under /api/dispatch). Returns gracefully
// on any DB error so the screensaver never crashes from a bad query.
aggregates.get('/ambient-stats', async (c) => {
  try {
    const db = getDb(c.env);
    const [callRow, critRow, unitRow] = await Promise.all([
      queryFirst<{ count: number }>(db,
        `SELECT COUNT(*) AS count FROM calls_for_service
         WHERE status NOT IN ('closed','cancelled','duplicate','archived')
         AND created_at >= datetime('now', '-24 hours')`),
      queryFirst<{ count: number }>(db,
        `SELECT COUNT(*) AS count FROM calls_for_service
         WHERE priority IN ('1','P1','critical') AND status NOT IN ('closed','cancelled','duplicate','archived')
         AND created_at >= datetime('now', '-24 hours')`),
      queryFirst<{ total: number; available: number }>(db,
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available
         FROM units WHERE status != 'off_duty'`),
    ]);
    return c.json({
      active_calls: callRow?.count ?? 0,
      critical_calls: critRow?.count ?? 0,
      total_units: unitRow?.total ?? 0,
      available_units: unitRow?.available ?? 0,
    });
  } catch (err) {
    log.error('[aggregates] ambient-stats query failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Ambient stats unavailable' }, 500);
  }
});

export default aggregates;
