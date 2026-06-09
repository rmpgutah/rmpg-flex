import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst } from '../../utils/db';
import { LIST_VIEW_COLUMNS } from './calls';

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
        SUM(CASE WHEN priority = 'P1' AND status NOT IN ('cleared','closed','cancelled','archived') THEN 1 ELSE 0 END) as p1_count,
        SUM(CASE WHEN priority = 'P2' AND status NOT IN ('cleared','closed','cancelled','archived') THEN 1 ELSE 0 END) as p2_count,
        SUM(CASE WHEN priority = 'P3' AND status NOT IN ('cleared','closed','cancelled','archived') THEN 1 ELSE 0 END) as p3_count
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

    const [todayCalls] = await query<{ count: number }>(db, "SELECT COUNT(*) as count FROM calls_for_service WHERE date(created_at) = date('now')");

    return c.json({
      calls: { ...totals, today: todayCalls?.count ?? 0 },
      units: unitStats,
    });
  } catch (err) {
    return c.json({ error: 'Failed to get aggregates' }, 500);
  }
});

// GET /dispatch/disposition-stats
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
    console.error('Queue error:', err);
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
    console.error('GET /dispatch/heatmap/enforcement failed (degrading to []):', err);
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
        AND CAST(strftime('%H', created_at) AS INTEGER) IN (${hours.join(',')})
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
    console.error('GET /dispatch/heatmap/predictions failed:', err);
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
    console.error('GET /dispatch/analysis/summary failed:', err);
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
  } catch (err) { return c.json([]); }
});

// GET /dispatch/stats/dashboard — shift briefing dashboard stats.
aggregates.get('/stats/dashboard', async (c) => {
  try {
    const db = getDb(c.env);
    const [calls, units, priority] = await Promise.all([
      queryFirst<Record<string, unknown>>(db,
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed
         FROM calls_for_service WHERE created_at >= datetime('now', '-24 hours')`),
      queryFirst<Record<string, unknown>>(db,
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status NOT IN ('off_duty','out_of_service') THEN 1 ELSE 0 END) AS on_duty
         FROM units`),
      queryFirst<Record<string, unknown>>(db,
        `SELECT COUNT(*) AS p1_count
         FROM calls_for_service
         WHERE priority = 'P1' AND status = 'active'`),
    ]);
    return c.json({ calls: calls || {}, units: units || {}, priority: priority || {} });
  } catch (err) { return c.json({ calls: {}, units: {}, priority: {} }); }
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
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
          SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) as priority1,
          SUM(CASE WHEN priority = 'P2' THEN 1 ELSE 0 END) as priority2,
          AVG(CASE WHEN starting_mileage IS NOT NULL AND ending_mileage IS NOT NULL
               THEN ending_mileage - starting_mileage END) as avg_call_miles
        FROM calls_for_service
        WHERE created_at >= datetime('now', '-24 hours')`),

      // Units: on-duty / dispatched / available breakdown + vehicle assignment rate
      queryFirst<Record<string, unknown>>(db, `
        SELECT COUNT(*) as total_units,
          SUM(CASE WHEN status NOT IN ('off_duty','out_of_service') THEN 1 ELSE 0 END) as on_duty,
          SUM(CASE WHEN status = 'dispatched' THEN 1 ELSE 0 END) as dispatched,
          SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
          SUM(CASE WHEN current_call_id IS NOT NULL THEN 1 ELSE 0 END) as on_call,
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
        WHERE date(start_time) = date('now', 'localtime')`),

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
    console.error('GET /dispatch/aggregates/integration-dashboard error:', err);
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
    const csv = (q?: string) => (q ? q.split(',').map((s) => s.trim()).filter(Boolean) : []);
    const statuses = csv(c.req.query('status'));
    const types = csv(c.req.query('types'));
    const priorities = csv(c.req.query('priority'));

    const where: string[] = ['latitude IS NOT NULL', 'longitude IS NOT NULL', "created_at >= datetime('now', ?)"];
    const params: unknown[] = [`-${days} days`];
    const addIn = (col: string, vals: string[]) => {
      where.push(`${col} IN (${vals.map(() => '?').join(',')})`);
      params.push(...vals);
    };
    if (statuses.length) addIn('status', statuses);
    if (types.length) addIn('incident_type', types);
    if (priorities.length) addIn('priority', priorities);

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
    console.error('GET /dispatch/history-map failed:', err);
    return c.json([]);
  }
});

export default aggregates;
