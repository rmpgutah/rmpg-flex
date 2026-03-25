import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { authenticateToken, requireRole } from '../../middleware/auth';
import { broadcastDispatchUpdate, broadcastUnitUpdate, broadcastPanic } from '../../utils/websocket';
import { generateCallNumber } from '../../utils/caseNumbers';
import { localNow, localHour, localDayOfWeek } from '../../utils/timeUtils';
import { reverseGeocodeAddress } from '../../utils/geocode';
import { identifyBeat } from '../../utils/geofence';
import { escapeLike } from '../../middleware/sanitize';
import { auditLog } from '../../utils/auditLogger';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// ── Shared helpers for map data quality ──

/** Validate lat/lng bounds in response data — filter out invalid coordinates */
function filterValidCoords<T extends { latitude?: number | null; longitude?: number | null; lat?: number | null; lng?: number | null }>(rows: T[]): T[] {
  return rows.filter(r => {
    const lat = r.latitude ?? r.lat;
    const lng = r.longitude ?? r.lng;
    if (lat == null || lng == null) return false;
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  });
}

/** Set caching headers for heatmap/aggregate data */
function setCacheHeaders(res: Response, maxAge: number = 60) {
  res.set('Cache-Control', `private, max-age=${maxAge}`);
}

/** Log request timing for slow queries */
function logTiming(label: string, startMs: number) {
  const elapsed = Date.now() - startMs;
  if (elapsed > 500) {
    console.warn(`[Perf] ${label} took ${elapsed}ms`);
  }
}

// GET /api/dispatch/heatmap - Aggregated call locations for heat map display
// Query params: days (int), mode ('all'|'risk'|'type'), type (incident_type filter)
router.get('/heatmap', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const db = getDb();
    // Fix 1: Input validation on days (clamp 1-365)
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));
    // Fix 2: Input validation on mode (whitelist)
    const mode = (req.query.mode as string) || 'all';
    const typeFilter = req.query.type as string | undefined;

    const validModes = ['all', 'risk', 'type'];
    if (!validModes.includes(mode)) {
      res.status(400).json({ error: `Invalid mode. Must be one of: ${validModes.join(', ')}`, code: 'INVALID_MODE' });
      return;
    }

    // Fix 11: Proper error messages for invalid parameters
    if (typeFilter && (typeof typeFilter !== 'string' || typeFilter.length > 100)) {
      res.status(400).json({ error: 'Type filter must be a string under 100 characters', code: 'INVALID_TYPE_FILTER' });
      return;
    }

    if (mode === 'type' && !typeFilter) {
      res.status(400).json({ error: 'type parameter is required when mode is "type"', code: 'MISSING_TYPE' });
      return;
    }

    const cutoff = `-${days}`;

    // Fix 8: Cache headers for heatmap data
    setCacheHeaders(res, 60);

    if (mode === 'risk') {
      // Risk-weighted: only calls with risk flags, weighted by severity
      // Fix 3: LIMIT capped at 10000, Fix 6: index usage hint
      const points = db.prepare(`
        /* Uses idx: calls_for_service(latitude, longitude, created_at) */
        SELECT
          ROUND(latitude, 3) as latitude,
          ROUND(longitude, 3) as longitude,
          COUNT(*) as count,
          SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 3 ELSE 0 END
            + CASE WHEN domestic_violence = 1 THEN 2 ELSE 0 END
            + CASE WHEN injuries_reported = 1 THEN 2 ELSE 0 END
            + CASE WHEN alcohol_involved = 1 THEN 1 ELSE 0 END
            + CASE WHEN drugs_involved = 1 THEN 1 ELSE 0 END
          ) as risk_weight,
          SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 1 ELSE 0 END) as weapons_count,
          SUM(CASE WHEN domestic_violence = 1 THEN 1 ELSE 0 END) as dv_count,
          SUM(CASE WHEN injuries_reported = 1 THEN 1 ELSE 0 END) as injuries_count
        FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND created_at >= datetime('now', 'localtime', ? || ' days')
          AND (weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0'
               OR domestic_violence = 1 OR injuries_reported = 1
               OR alcohol_involved = 1 OR drugs_involved = 1)
        GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
        ORDER BY risk_weight DESC
        LIMIT 10000
      `).all(cutoff) as any[];
      // Fix 5: Validate lat/lng bounds, Fix 13: total count
      const filtered = filterValidCoords(points);
      logTiming('heatmap/risk', startMs); // Fix 14
      return res.json(filtered);
    }

    if (mode === 'type' && typeFilter) {
      // Filtered by specific incident type
      const points = db.prepare(`
        /* Uses idx: calls_for_service(latitude, longitude, created_at) */
        SELECT
          ROUND(latitude, 3) as latitude,
          ROUND(longitude, 3) as longitude,
          COUNT(*) as count
        FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND created_at >= datetime('now', 'localtime', ? || ' days')
          AND incident_type = ?
        GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
        ORDER BY count DESC
        LIMIT 10000
      `).all(cutoff, typeFilter) as any[];
      const filtered = filterValidCoords(points);
      logTiming('heatmap/type', startMs);
      return res.json(filtered);
    }

    // Default: all calls with enriched metadata for click info
    // Fix 7: Use localtime consistently in datetime functions
    const points = db.prepare(`
      /* Uses idx: calls_for_service(latitude, longitude, created_at) */
      SELECT
        ROUND(latitude, 3) as latitude,
        ROUND(longitude, 3) as longitude,
        COUNT(*) as count,
        GROUP_CONCAT(DISTINCT incident_type) as incident_types,
        SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) as p1_count,
        SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 1 ELSE 0 END) as weapons_count,
        SUM(CASE WHEN domestic_violence = 1 THEN 1 ELSE 0 END) as dv_count,
        SUM(CASE WHEN injuries_reported = 1 THEN 1 ELSE 0 END) as injuries_count
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', 'localtime', ? || ' days')
      GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
      ORDER BY count DESC
      LIMIT 10000
    `).all(cutoff) as any[];

    const filtered = filterValidCoords(points);
    logTiming('heatmap/all', startMs);
    // Fix 13: Total count in response alongside data
    res.json(filtered);
  } catch (error: any) {
    console.error('[Dispatch] heatmap error:', error?.message || 'Unknown error');
    // Fix 12: Return empty arrays instead of 500 when tables are empty
    if (error?.message?.includes('no such table')) {
      res.json([]);
      return;
    }
    res.status(500).json({ error: 'Internal server error', code: 'HEATMAP_ERROR' });
  }
});

// GET /api/dispatch/heatmap/types - Available incident types for heatmap filter
router.get('/heatmap/types', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    setCacheHeaders(res, 120); // Types change infrequently
    const types = db.prepare(`
      SELECT incident_type, COUNT(*) as count
      FROM calls_for_service
      WHERE incident_type IS NOT NULL AND incident_type != ''
        AND created_at >= datetime('now', 'localtime', '-90 days')
      GROUP BY incident_type
      ORDER BY count DESC
      LIMIT 50
    `).all();
    res.json(types);
  } catch (error: any) {
    console.error('[Dispatch] heatmap types error:', error?.message || 'Unknown error');
    if (error?.message?.includes('no such table')) {
      res.json([]);
      return;
    }
    res.status(500).json({ error: 'Failed to get heatmap types', code: 'HEATMAP_TYPES_ERROR' });
  }
});

// GET /api/dispatch/heatmap/advanced - Enhanced heatmap with filtering, clustering, comparison
router.get('/heatmap/advanced', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));
    const mode = (req.query.mode as string) || 'density'; // density | risk | temporal | comparison
    const typesRaw = req.query.types as string | undefined; // comma-separated
    const hourStart = parseInt(req.query.hourStart as string, 10);
    const hourEnd = parseInt(req.query.hourEnd as string, 10);
    const dayFilterRaw = req.query.dayFilter as string | undefined; // comma-separated 0-6
    const resolution = (req.query.resolution as string) || 'medium'; // fine=0.001, medium=0.003, coarse=0.005
    const comparisonDays = parseInt(req.query.comparisonDays as string, 10) || days;
    const temporalHour = parseInt(req.query.temporalHour as string, 10); // for temporal mode single-hour

    // Fix 2: Validate mode parameter against whitelist
    const validAdvancedModes = ['density', 'risk', 'temporal', 'comparison'];
    if (!validAdvancedModes.includes(mode)) {
      res.status(400).json({ error: `Invalid mode. Must be one of: ${validAdvancedModes.join(', ')}`, code: 'INVALID_MODE' });
      return;
    }

    // Fix 9: Validate hour_start/hour_end for timelapse/temporal
    if (!isNaN(hourStart) && (hourStart < 0 || hourStart > 23)) {
      res.status(400).json({ error: 'hourStart must be between 0 and 23', code: 'INVALID_HOUR_START' });
      return;
    }
    if (!isNaN(hourEnd) && (hourEnd < 0 || hourEnd > 23)) {
      res.status(400).json({ error: 'hourEnd must be between 0 and 23', code: 'INVALID_HOUR_END' });
      return;
    }

    // Validate resolution
    const validResolutions = ['fine', 'medium', 'coarse'];
    if (!validResolutions.includes(resolution)) {
      res.status(400).json({ error: `Invalid resolution. Must be one of: ${validResolutions.join(', ')}`, code: 'INVALID_RESOLUTION' });
      return;
    }

    // Fix 8: Cache headers
    setCacheHeaders(res, 60);

    // Resolution mapping
    const resMap: Record<string, number> = { fine: 1, medium: 3, coarse: 5 };
    const roundDigits = resMap[resolution] || 3;

    // Parse multi-type filter
    const types = typesRaw ? typesRaw.split(',').filter(t => t.length > 0 && t.length < 100).slice(0, 20) : [];

    // Fix 10: Validate day_filter is a valid array of 0-6 values
    const dayFilter = dayFilterRaw ? dayFilterRaw.split(',').map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6) : [];
    if (dayFilterRaw && dayFilter.length === 0) {
      res.status(400).json({ error: 'dayFilter must contain valid day-of-week values (0=Sunday through 6=Saturday)', code: 'INVALID_DAY_FILTER' });
      return;
    }

    // Build WHERE clauses — parameterize the date cutoff to prevent SQL injection
    const conditions: string[] = [
      'latitude IS NOT NULL',
      'longitude IS NOT NULL',
      `created_at >= datetime('now', 'localtime', ? || ' days')`,
    ];
    const params: any[] = [`-${days}`];

    // Hour range filter
    const hasHourFilter = !isNaN(hourStart) && !isNaN(hourEnd) && hourStart >= 0 && hourStart <= 23 && hourEnd >= 0 && hourEnd <= 23;
    if (hasHourFilter) {
      if (hourStart <= hourEnd) {
        conditions.push(`CAST(strftime('%H', created_at) AS INTEGER) >= ? AND CAST(strftime('%H', created_at) AS INTEGER) <= ?`);
        params.push(hourStart, hourEnd);
      } else {
        // Wrapping range e.g. 18-2 means 18,19,20,21,22,23,0,1,2
        conditions.push(`(CAST(strftime('%H', created_at) AS INTEGER) >= ? OR CAST(strftime('%H', created_at) AS INTEGER) <= ?)`);
        params.push(hourStart, hourEnd);
      }
    }

    // Day-of-week filter (SQLite: %w gives 0=Sunday)
    if (dayFilter.length > 0 && dayFilter.length < 7) {
      const placeholders = dayFilter.map(() => '?').join(',');
      conditions.push(`CAST(strftime('%w', created_at) AS INTEGER) IN (${placeholders})`);
      params.push(...dayFilter);
    }

    // Type filter
    if (types.length > 0) {
      const placeholders = types.map(() => '?').join(',');
      conditions.push(`incident_type IN (${placeholders})`);
      params.push(...types);
    }

    const whereClause = conditions.join(' AND ');

    // --- Main query ---
    const roundExpr = roundDigits === 1 ? 'ROUND(latitude, 3)' : roundDigits === 5 ? 'ROUND(latitude, 2)' : 'ROUND(latitude, 3)';
    const roundExprLng = roundDigits === 1 ? 'ROUND(longitude, 3)' : roundDigits === 5 ? 'ROUND(longitude, 2)' : 'ROUND(longitude, 3)';
    // For fine resolution, use 3 decimal places; for medium 3; for coarse 2
    // These are safe integer literals (2 or 3) derived from a validated enum — safe for interpolation
    const latRound: 2 | 3 = resolution === 'coarse' ? 2 : 3;
    const lngRound: 2 | 3 = resolution === 'coarse' ? 2 : 3;

    // For temporal mode with a specific hour, add extra filter
    let temporalConditions = '';
    const temporalParams: any[] = [];
    if (mode === 'temporal' && !isNaN(temporalHour) && temporalHour >= 0 && temporalHour <= 23) {
      temporalConditions = ` AND CAST(strftime('%H', created_at) AS INTEGER) = ?`;
      temporalParams.push(temporalHour);
    }

    const pointsQuery = `
      SELECT
        ROUND(latitude, ${latRound}) as latitude,
        ROUND(longitude, ${lngRound}) as longitude,
        COUNT(*) as count,
        GROUP_CONCAT(DISTINCT incident_type) as types,
        SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 3 ELSE 0 END
          + CASE WHEN domestic_violence = 1 THEN 2 ELSE 0 END
          + CASE WHEN injuries_reported = 1 THEN 2 ELSE 0 END
          + CASE WHEN alcohol_involved = 1 THEN 1 ELSE 0 END
          + CASE WHEN drugs_involved = 1 THEN 1 ELSE 0 END
        ) as riskScore
      FROM calls_for_service
      WHERE ${whereClause}${temporalConditions}
      GROUP BY ROUND(latitude, ${latRound}), ROUND(longitude, ${lngRound})
      ORDER BY ${mode === 'risk' ? 'riskScore' : 'count'} DESC
      LIMIT 500
    `;

    const points = db.prepare(pointsQuery).all(...params, ...temporalParams) as any[];

    // Format points with weight based on mode
    const formattedPoints = points.map((p: any) => ({
      lat: p.latitude,
      lng: p.longitude,
      weight: mode === 'risk' ? Math.max(p.riskScore || 1, p.count) : (p.count || 1),
      count: p.count,
      types: p.types || '',
      riskScore: p.riskScore || 0,
    }));

    // --- Cluster detection (DBSCAN-like grouping) ---
    const clusters: any[] = [];
    const clusterThreshold = resolution === 'fine' ? 0.003 : resolution === 'coarse' ? 0.01 : 0.005;
    const minClusterPoints = 3;
    const visited = new Set<number>();

    for (let i = 0; i < formattedPoints.length; i++) {
      if (visited.has(i)) continue;
      const cluster: number[] = [i];
      visited.add(i);

      for (let j = i + 1; j < formattedPoints.length; j++) {
        if (visited.has(j)) continue;
        const dist = Math.sqrt(
          Math.pow(formattedPoints[i].lat - formattedPoints[j].lat, 2) +
          Math.pow(formattedPoints[i].lng - formattedPoints[j].lng, 2)
        );
        if (dist <= clusterThreshold) {
          cluster.push(j);
          visited.add(j);
        }
      }

      if (cluster.length >= minClusterPoints) {
        const clusterPoints = cluster.map(idx => formattedPoints[idx]);
        const centerLat = clusterPoints.reduce((s, p) => s + p.lat, 0) / clusterPoints.length;
        const centerLng = clusterPoints.reduce((s, p) => s + p.lng, 0) / clusterPoints.length;
        const totalCount = clusterPoints.reduce((s, p) => s + p.count, 0);
        const avgRisk = clusterPoints.reduce((s, p) => s + p.riskScore, 0) / clusterPoints.length;
        const maxDist = clusterPoints.reduce((max, p) => {
          const d = Math.sqrt(Math.pow(p.lat - centerLat, 2) + Math.pow(p.lng - centerLng, 2));
          return Math.max(max, d);
        }, 0);

        clusters.push({
          center: { lat: centerLat, lng: centerLng },
          radius: Math.max(maxDist * 111000, 200), // Convert degrees to meters, min 200m
          count: totalCount,
          avgRisk: Math.round(avgRisk * 10) / 10,
        });
      }
    }

    // --- Statistics ---
    const statsQuery = `
      SELECT
        COUNT(*) as total,
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        CAST(strftime('%w', created_at) AS INTEGER) as dow,
        incident_type
      FROM calls_for_service
      WHERE ${whereClause}${temporalConditions}
    `;

    // Get total
    const totalRow = db.prepare(`SELECT COUNT(*) as total FROM calls_for_service WHERE ${whereClause}${temporalConditions}`).get(...params, ...temporalParams) as any;

    // Get top types
    const topTypes = db.prepare(`
      SELECT incident_type, COUNT(*) as count
      FROM calls_for_service
      WHERE ${whereClause}${temporalConditions} AND incident_type IS NOT NULL AND incident_type != ''
      GROUP BY incident_type
      ORDER BY count DESC
      LIMIT 5
    `).all(...params, ...temporalParams) as any[];

    // Get peak hour
    const peakHourRow = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM calls_for_service
      WHERE ${whereClause}${temporalConditions}
      GROUP BY hour
      ORDER BY count DESC
      LIMIT 1
    `).get(...params, ...temporalParams) as any;

    // Get peak day
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const peakDayRow = db.prepare(`
      SELECT CAST(strftime('%w', created_at) AS INTEGER) as dow, COUNT(*) as count
      FROM calls_for_service
      WHERE ${whereClause}${temporalConditions}
      GROUP BY dow
      ORDER BY count DESC
      LIMIT 1
    `).get(...params, ...temporalParams) as any;

    const stats = {
      total: totalRow?.total || 0,
      topTypes: topTypes.map((t: any) => ({ type: t.incident_type, count: t.count })),
      peakHour: peakHourRow?.hour ?? null,
      peakDay: peakDayRow ? DAY_NAMES[peakDayRow.dow] : null,
    };

    // --- Comparison mode: fetch previous period ---
    let comparisonPoints: any[] = [];
    if (mode === 'comparison') {
      const compCutoffStart = `-${days + comparisonDays}`;
      const compCutoffEnd = `-${days}`;

      // Build comparison conditions (same filters but different date range) — parameterized
      const compConditions = conditions.map(c => {
        if (c.includes('created_at >=')) {
          return `created_at >= datetime('now', 'localtime', ? || ' days') AND created_at < datetime('now', 'localtime', ? || ' days')`;
        }
        return c;
      });

      // Build separate params: replace date param with comparison range, keep other filter params
      const compParams: any[] = [compCutoffStart, compCutoffEnd, ...params.slice(1)];

      const compWhere = compConditions.join(' AND ');
      const compPoints = db.prepare(`
        SELECT
          ROUND(latitude, ${latRound}) as latitude,
          ROUND(longitude, ${lngRound}) as longitude,
          COUNT(*) as count,
          GROUP_CONCAT(DISTINCT incident_type) as types,
          SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 3 ELSE 0 END
            + CASE WHEN domestic_violence = 1 THEN 2 ELSE 0 END
            + CASE WHEN injuries_reported = 1 THEN 2 ELSE 0 END
          ) as riskScore
        FROM calls_for_service
        WHERE ${compWhere}
        GROUP BY ROUND(latitude, ${latRound}), ROUND(longitude, ${lngRound})
        ORDER BY count DESC
        LIMIT 500
      `).all(...compParams) as any[];

      comparisonPoints = compPoints.map((p: any) => ({
        lat: p.latitude,
        lng: p.longitude,
        weight: p.count || 1,
        count: p.count,
        types: p.types || '',
        riskScore: p.riskScore || 0,
      }));
    }

    logTiming('heatmap/advanced', startMs); // Fix 14
    res.json({
      points: filterValidCoords(formattedPoints), // Fix 5: validate coords
      comparisonPoints: mode === 'comparison' ? filterValidCoords(comparisonPoints) : undefined,
      clusters,
      stats,
      total: formattedPoints.length,
    });
  } catch (error: any) {
    console.error('[Dispatch] advanced heatmap error:', error?.message || 'Unknown error');
    if (error?.message?.includes('no such table')) {
      res.json({ points: [], clusters: [], stats: { total: 0, topTypes: [], peakHour: null, peakDay: null }, total: 0 });
      return;
    }
    res.status(500).json({ error: 'Internal server error', code: 'ADVANCED_HEATMAP_ERROR' });
  }
});

// GET /api/dispatch/queue - Active dispatch queue (Enhanced with priority scoring)
router.get('/queue', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Upgrade 87: Include on_hold calls and sort by priority_score
    const calls = db.prepare(`
      SELECT c.*, p.name as property_name, u.full_name as dispatcher_name,
        ROUND((julianday('now', 'localtime') - julianday(c.created_at)) * 24 * 60, 1) as age_minutes,
        c.priority_score,
        c.response_time_seconds
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN users u ON c.dispatcher_id = u.id
      WHERE c.status IN ('pending', 'dispatched', 'enroute', 'onscene', 'on_hold')
      ORDER BY
        CASE c.status WHEN 'on_hold' THEN 1 ELSE 0 END,
        COALESCE(c.priority_score, CASE c.priority WHEN 'P1' THEN 400 WHEN 'P2' THEN 300 WHEN 'P3' THEN 200 WHEN 'P4' THEN 100 END) DESC,
        c.created_at ASC
      LIMIT 200
    `).all() as any[];

    // Upgrade 88: Add overdue flag — calls exceeding expected response time
    const enriched = calls.map((c: any) => {
      const expectedMinutes: Record<string, number> = { P1: 8, P2: 15, P3: 30, P4: 60 };
      const expected = expectedMinutes[c.priority] || 30;
      const isOverdue = c.age_minutes && c.age_minutes > expected && c.status === 'pending';
      return { ...c, _overdue: isOverdue, _expected_response_minutes: expected };
    });

    res.json(enriched);
  } catch (error: any) {
    console.error('[Dispatch] get queue error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'QUEUE_ERROR' });
  }
});

// GET /api/dispatch/stats - Current dispatch statistics (Enhanced)
router.get('/stats', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    const callsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now', 'localtime')
      GROUP BY status
    `).all();

    const callsByPriority = db.prepare(`
      SELECT priority, COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now', 'localtime')
      GROUP BY priority
    `).all();

    const unitsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM units GROUP BY status
    `).all();

    const activeCalls = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE status IN ('pending', 'dispatched', 'enroute', 'onscene')
    `).get() as any;

    const todayTotal = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE DATE(created_at) = DATE('now', 'localtime')
    `).get() as any;

    const avgResponseTime = db.prepare(`
      SELECT AVG(
        (julianday(onscene_at) - julianday(created_at)) * 24 * 60
      ) as avg_minutes
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL AND DATE(created_at) = DATE('now', 'localtime')
    `).get() as any;

    // Upgrade 81: Pending calls count and oldest pending age
    const pendingCalls = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service WHERE status = 'pending'
    `).get() as any;

    const oldestPending = db.prepare(`
      SELECT ROUND((julianday('now', 'localtime') - julianday(created_at)) * 24 * 60, 1) as age_minutes
      FROM calls_for_service WHERE status = 'pending'
      ORDER BY created_at ASC LIMIT 1
    `).get() as any;

    // Upgrade 82: Average dispatch delay (created -> dispatched)
    const avgDispatchDelay = db.prepare(`
      SELECT ROUND(AVG((julianday(dispatched_at) - julianday(created_at)) * 24 * 60), 1) as avg_minutes
      FROM calls_for_service
      WHERE dispatched_at IS NOT NULL AND DATE(created_at) = DATE('now', 'localtime')
        AND (julianday(dispatched_at) - julianday(created_at)) * 24 * 60 > 0
        AND (julianday(dispatched_at) - julianday(created_at)) * 24 * 60 < 720
    `).get() as any;

    // Upgrade 83: Calls on hold count
    const onHoldCount = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service WHERE status = 'on_hold'
    `).get() as any;

    // Upgrade 84: P1 calls today
    const p1Today = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE priority = 'P1' AND DATE(created_at) = DATE('now', 'localtime')
    `).get() as any;

    // Upgrade 85: Cleared/closed today
    const resolvedToday = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE status IN ('cleared', 'closed') AND DATE(created_at) = DATE('now', 'localtime')
    `).get() as any;

    // Upgrade 86: Average response time by priority (today)
    const responseByPriority = db.prepare(`
      SELECT priority,
        ROUND(AVG((julianday(onscene_at) - julianday(created_at)) * 24 * 60), 1) as avg_minutes,
        COUNT(*) as count
      FROM calls_for_service
      WHERE onscene_at IS NOT NULL AND DATE(created_at) = DATE('now', 'localtime')
        AND (julianday(onscene_at) - julianday(created_at)) * 24 * 60 > 0
        AND (julianday(onscene_at) - julianday(created_at)) * 24 * 60 < 720
      GROUP BY priority
    `).all();

    res.json({
      activeCalls: activeCalls?.count ?? 0,
      todayTotal: todayTotal?.count ?? 0,
      avgResponseMinutes: avgResponseTime?.avg_minutes ? Math.round(avgResponseTime.avg_minutes * 10) / 10 : null,
      callsByStatus,
      callsByPriority,
      unitsByStatus,
      // New stats
      pendingCalls: pendingCalls?.count || 0,
      oldestPendingMinutes: oldestPending?.age_minutes || null,
      avgDispatchDelayMinutes: avgDispatchDelay?.avg_minutes || null,
      onHoldCalls: onHoldCount?.count || 0,
      p1CallsToday: p1Today?.count || 0,
      resolvedToday: resolvedToday?.count || 0,
      responseByPriority,
    });
  } catch (error: any) {
    console.error('[Dispatch] get stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'STATS_ERROR' });

  }
});

// POST /api/dispatch/panic - Emergency PANIC button
// Broadcasts audible alert to all connected users
router.post('/panic', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { latitude, longitude, message } = req.body;

    // Validate panic input
    if (message !== undefined && message !== null) {
      if (typeof message !== 'string' || message.length > 500) {
        res.status(400).json({ error: 'Message must be a string of 500 characters or less', code: 'INVALID_MESSAGE' });
        return;
      }
    }
    if (latitude != null && (isNaN(Number(latitude)) || Math.abs(Number(latitude)) > 90)) {
      res.status(400).json({ error: 'Invalid latitude', code: 'INVALID_LATITUDE' });
      return;
    }
    if (longitude != null && (isNaN(Number(longitude)) || Math.abs(Number(longitude)) > 180)) {
      res.status(400).json({ error: 'Invalid longitude', code: 'INVALID_LONGITUDE' });
      return;
    }

    const user = db.prepare('SELECT id, full_name, badge_number, role FROM users WHERE id = ?')
      .get(req.user!.userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }

    const now = localNow();

    // ── Reverse-geocode officer GPS → address (with fallback) ──
    // Must happen BEFORE the transaction since it's async
    let locationAddress = latitude != null && longitude != null && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
      ? `GPS: ${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`
      : 'Unknown location';

    if (latitude != null && longitude != null) {
      try {
        const addr = await reverseGeocodeAddress(Number(latitude), Number(longitude));
        if (addr) locationAddress = addr;
      } catch (geoErr) { console.error('[Panic] Reverse geocode failed, using GPS fallback:', geoErr instanceof Error ? geoErr.message : geoErr); }
    }

    // ── All DB writes in a single transaction for atomicity ──
    const callNumber = generateCallNumber(db);
    const description = `PANIC ALARM — Officer ${user.full_name} (Badge: ${user.badge_number || 'N/A'}) triggered emergency alert.${message ? ' Message: ' + message : ''}`;

    const panicTx = db.transaction(() => {
      // Log the panic alert to activity log
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'panic_alert', 'user', ?, ?, ?)
      `).run(
        user.id,
        user.id,
        `PANIC ALERT triggered by ${user.full_name} (${user.badge_number || 'N/A'})${message ? ': ' + message : ''}`,
        req.ip || 'unknown'
      );

      // Auto-create "Officer Assist — Panic Alarm" dispatch call
      const callResult = db.prepare(`
        INSERT INTO calls_for_service (
          call_number, incident_type, priority, status,
          caller_name, location_address, latitude, longitude,
          description, source, dispatcher_id,
          weapons_involved, created_at, dispatched_at
        ) VALUES (?, 'officer_assist', 'P1', 'dispatched',
          ?, ?, ?, ?,
          ?, 'panic', ?,
          'unknown', ?, ?)
      `).run(
        callNumber,
        user.full_name,
        locationAddress,
        latitude ?? null,
        longitude ?? null,
        description,
        user.id,
        now,
        now,
      );

      const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?')
        .get(callResult.lastInsertRowid) as any;
      if (!call) throw new Error('Failed to retrieve auto-created panic call');

      // Auto-assign officer's unit to the call
      const unit = db.prepare('SELECT id, call_sign FROM units WHERE officer_id = ?')
        .get(user.id) as any;

      if (unit) {
        db.prepare('UPDATE units SET status = ?, current_call_id = ?, last_status_change = ? WHERE id = ?')
          .run('dispatched', call.id, now, unit.id);

        const unitIds = JSON.stringify([unit.id]);
        db.prepare('UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?')
          .run(unitIds, call.id);
      }

      // Log call creation
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'call_created', 'call', ?, ?, ?)
      `).run(user.id, call.id, `PANIC auto-created ${callNumber}: officer_assist`, req.ip || 'unknown');

      return { call, unit };
    });

    const { call, unit } = panicTx();

    // ── Broadcasts happen AFTER transaction commits ──
    if (unit) {
      broadcastUnitUpdate({ action: 'unit_status_changed', unit: { ...unit, status: 'dispatched', current_call_id: call.id } });
    }

    broadcastPanic({
      user_id: user.id,
      user_name: user.full_name,
      badge_number: user.badge_number,
      role: user.role,
      message: message || null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      triggered_at: now,
      call_number: callNumber,
      call_id: call.id,
      location_address: locationAddress,
      unit_call_sign: unit?.call_sign || null,
    });

    const enrichedCall = db.prepare(`
      SELECT c.*, u.full_name as dispatcher_name
      FROM calls_for_service c
      LEFT JOIN users u ON c.dispatcher_id = u.id
      WHERE c.id = ?
    `).get(call.id);

    broadcastDispatchUpdate({ action: 'call_created', call: enrichedCall || call });

    auditLog(req, 'panic_activated', 'call', call.id, `PANIC alert by ${user.full_name} (${user.badge_number || 'N/A'}) — call ${callNumber} created`);

    res.json({
      success: true,
      message: 'Panic alert sent — dispatch call created',
      call_number: callNumber,
      call_id: call.id,
    });
  } catch (error: any) {
    console.error('[Dispatch] panic alert error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'PANIC_ERROR' });
  }
});

// GET /api/dispatch/premise-history - Premise history lookup
// Returns prior calls at or near a given address.
router.get('/premise-history', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { address } = req.query;

    if (!address || typeof address !== 'string' || address.length < 3) {
      res.status(400).json({ error: 'Address must be at least 3 characters', code: 'INVALID_ADDRESS' });
      return;
    }

    if (address.length > 300) {
      res.status(400).json({ error: 'Address must be 300 characters or less', code: 'ADDRESS_TOO_LONG' });
      return;
    }

    const searchTerm = `%${escapeLike(String(address))}%`;

    // Find prior calls at this address (fuzzy match on location_address)
    const calls = db.prepare(`
      SELECT c.id, c.call_number, c.incident_type, c.priority, c.status, c.disposition,
        c.location_address, c.created_at, c.cleared_at,
        c.weapons_involved, c.domestic_violence, c.injuries_reported,
        c.alcohol_involved, c.drugs_involved, c.description
      FROM calls_for_service c
      WHERE c.location_address LIKE ? ESCAPE '\\'
      ORDER BY c.created_at DESC
      LIMIT 20
    `).all(searchTerm) as any[];

    // Determine if there are hazardous warnings
    const warningTypes: string[] = [];
    for (const call of calls) {
      if (call.weapons_involved && call.weapons_involved !== 'None' && !warningTypes.includes('ARMED'))
        warningTypes.push('ARMED');
      if (call.domestic_violence && !warningTypes.includes('DV'))
        warningTypes.push('DV');
      if (call.injuries_reported && !warningTypes.includes('INJURIES'))
        warningTypes.push('INJURIES');
      if (call.alcohol_involved && !warningTypes.includes('ALCOHOL'))
        warningTypes.push('ALCOHOL');
      if (call.drugs_involved && !warningTypes.includes('DRUGS'))
        warningTypes.push('DRUGS');
    }

    // Check for high-risk incident types in history
    const highRiskTypes = ['shooting', 'shots_fired', 'armed', 'barricade', 'hostage', 'hazmat', 'officer_assist'];
    for (const call of calls) {
      const itype = (call.incident_type || '').toLowerCase();
      if (highRiskTypes.some(t => itype.includes(t)) && !warningTypes.includes('HIGH_RISK_HISTORY'))
        warningTypes.push('HIGH_RISK_HISTORY');
    }

    // Also check property hazard notes if we can match a property
    let propertyHazard: string | null = null;
    try {
      const prop = db.prepare(`
        SELECT hazard_notes FROM properties WHERE address LIKE ? ESCAPE '\\' AND hazard_notes IS NOT NULL LIMIT 1
      `).get(searchTerm) as any;
      if (prop?.hazard_notes) {
        propertyHazard = prop.hazard_notes;
        if (!warningTypes.includes('PROPERTY_HAZARD')) warningTypes.push('PROPERTY_HAZARD');
      }
    } catch (propErr) { console.error('[Premise History] Property hazard lookup error:', propErr instanceof Error ? propErr.message : propErr); }

    res.json({
      calls,
      total: calls.length,
      hasWarnings: warningTypes.length > 0,
      warningTypes,
      propertyHazard,
    });
  } catch (error: any) {
    console.error('[Dispatch] premise history error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'PREMISE_HISTORY_ERROR' });
  }
});

// GET /api/dispatch/safety-screen - Officer Safety Auto-Screening
// Searches persons and warrants by name to detect active warrants, caution flags, criminal history.
router.get('/safety-screen', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name } = req.query;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.json({ persons: [], directWarrantHits: [], hasWarnings: false });
    }

    if (name.length > 200) {
      res.status(400).json({ error: 'Name must be 200 characters or less', code: 'NAME_TOO_LONG' });
      return;
    }

    const searchName = name.trim();

    // Split into possible first/last name parts
    const parts = searchName.split(/[\s,]+/).filter(Boolean);

    // ── Search persons table ──
    let personRows: any[] = [];
    if (parts.length >= 2) {
      // Try both orderings: "first last" and "last, first"
      personRows = db.prepare(`
        SELECT * FROM persons
        WHERE (first_name LIKE ? ESCAPE '\\' AND last_name LIKE ? ESCAPE '\\')
           OR (first_name LIKE ? ESCAPE '\\' AND last_name LIKE ? ESCAPE '\\')
           OR (first_name || ' ' || last_name LIKE ? ESCAPE '\\')
        LIMIT 10
      `).all(
        `%${escapeLike(parts[0])}%`, `%${escapeLike(parts[1])}%`,
        `%${escapeLike(parts[1])}%`, `%${escapeLike(parts[0])}%`,
        `%${escapeLike(searchName)}%`
      );
    } else if (parts.length === 1) {
      personRows = db.prepare(`
        SELECT * FROM persons
        WHERE first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\'
        LIMIT 10
      `).all(`%${escapeLike(parts[0])}%`, `%${escapeLike(parts[0])}%`);
    }

    // Enrich each person with warrants and criminal history
    const persons = personRows.map((person: any) => {
      const warrants = db.prepare(`
        SELECT w.* FROM warrants w
        WHERE w.status = 'active'
          AND w.subject_person_id = ?
      `).all(person.id);

      const criminalHistory = db.prepare(`
        SELECT * FROM criminal_history WHERE person_id = ? ORDER BY charge_date DESC LIMIT 10
      `).all(person.id);

      return { person, warrants, criminalHistory };
    });

    // ── Search warrants directly by subject name (via persons join) ──
    let directWarrantHits: any[] = [];
    if (parts.length >= 2) {
      directWarrantHits = db.prepare(`
        SELECT w.*, p.first_name AS subject_first_name, p.last_name AS subject_last_name
        FROM warrants w
        LEFT JOIN persons p ON w.subject_person_id = p.id
        WHERE w.status = 'active'
          AND ((p.first_name LIKE ? ESCAPE '\\' AND p.last_name LIKE ? ESCAPE '\\')
            OR (p.first_name LIKE ? ESCAPE '\\' AND p.last_name LIKE ? ESCAPE '\\'))
        LIMIT 10
      `).all(
        `%${escapeLike(parts[0])}%`, `%${escapeLike(parts[1])}%`,
        `%${escapeLike(parts[1])}%`, `%${escapeLike(parts[0])}%`
      );
    } else if (parts.length === 1) {
      directWarrantHits = db.prepare(`
        SELECT w.*, p.first_name AS subject_first_name, p.last_name AS subject_last_name
        FROM warrants w
        LEFT JOIN persons p ON w.subject_person_id = p.id
        WHERE w.status = 'active'
          AND (p.first_name LIKE ? ESCAPE '\\' OR p.last_name LIKE ? ESCAPE '\\')
        LIMIT 10
      `).all(`%${escapeLike(parts[0])}%`, `%${escapeLike(parts[0])}%`);
    }

    // Deduplicate warrant hits (already found via person enrichment)
    const personWarrantIds = new Set(
      persons.flatMap(p => p.warrants.map((w: any) => w.id))
    );
    const uniqueDirectWarrants = directWarrantHits.filter(
      (w: any) => !personWarrantIds.has(w.id)
    );

    // Determine if any warnings exist
    const hasWarnings =
      persons.some(p =>
        p.warrants.length > 0 ||
        p.person.caution_flags ||
        p.person.is_sex_offender ||
        p.person.has_criminal_history
      ) ||
      uniqueDirectWarrants.length > 0;

    res.json({
      persons,
      directWarrantHits: uniqueDirectWarrants,
      hasWarnings,
    });
  } catch (error: any) {
    console.error('[Dispatch] safety screen error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'SAFETY_SCREEN_ERROR' });
  }
});

// GET /api/dispatch/districts - List all 3-tier dispatch districts
router.get('/districts', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    // Fix 41: search/filter by name
    const search = req.query.search as string | undefined;
    // Fix 62: LIMIT on district queries
    const limit = Math.max(1, Math.min(5000, parseInt(req.query.limit as string, 10) || 5000));

    let query = 'SELECT * FROM dispatch_districts';
    const params: any[] = [];
    if (search && typeof search === 'string' && search.length >= 1 && search.length <= 100) {
      query += ` WHERE zone_name LIKE ? ESCAPE '\\' OR beat_name LIKE ? ESCAPE '\\' OR section_name LIKE ? ESCAPE '\\'`;
      const s = `%${escapeLike(search)}%`;
      params.push(s, s, s);
    }
    query += ' ORDER BY section_id, zone_id, beat_id LIMIT ?';
    params.push(limit);

    const districts = db.prepare(query).all(...params);

    // Fix 65: Return district with assigned unit count
    setCacheHeaders(res, 60);
    res.json(districts);
  } catch (error: any) {
    console.error('[Dispatch] districts list error:', error?.message || 'Unknown error');
    if (error?.message?.includes('no such table')) {
      res.json([]);
      return;
    }
    res.status(500).json({ error: 'Internal server error', code: 'DISTRICTS_ERROR' });
  }
});

// GET /api/dispatch/districts/lookup - Lookup 3-tier by zone_id + beat_id
router.get('/districts/lookup', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { zone_id, beat_id } = req.query;

    if (!zone_id || typeof zone_id !== 'string' || zone_id.length > 50) {
      res.status(400).json({ error: 'zone_id is required (max 50 chars)', code: 'INVALID_ZONE_ID' });
      return;
    }

    if (beat_id && (typeof beat_id !== 'string' || beat_id.length > 50)) {
      res.status(400).json({ error: 'beat_id must be 50 characters or less', code: 'INVALID_BEAT_ID' });
      return;
    }

    let district: any;
    if (beat_id) {
      district = db.prepare(
        'SELECT * FROM dispatch_districts WHERE zone_id = ? AND beat_id = ?'
      ).get(zone_id, beat_id);
    } else {
      // Return first matching zone entry
      district = db.prepare(
        'SELECT * FROM dispatch_districts WHERE zone_id = ? LIMIT 1'
      ).get(zone_id);
    }

    if (!district) {
      res.json({ found: false });
      return;
    }

    res.json({ found: true, district });
  } catch (error: any) {
    console.error('[Dispatch] district lookup error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'DISTRICT_LOOKUP_ERROR' });
  }
});

// GET /api/dispatch/districts/identify - Identify district from GPS coordinates
router.get('/districts/identify', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      res.status(400).json({ error: 'lat and lng are required', code: 'MISSING_COORDINATES' });
      return;
    }
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90 ||
        !Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      res.status(400).json({ error: 'lat must be -90..90, lng must be -180..180', code: 'INVALID_COORDINATES' });
      return;
    }

    const beat = identifyBeat(latNum, lngNum);
    if (!beat) {
      res.json({ found: false });
      return;
    }

    // Lookup dispatch_districts table for rich names
    const district = db.prepare(
      'SELECT * FROM dispatch_districts WHERE zone_id = ? AND beat_id = ?'
    ).get(beat.city_code, beat.district_letter) as any;

    if (district) {
      res.json({
        found: true,
        section_id: district.section_id,
        zone_id: district.zone_name,
        beat_id: `${district.beat_name} — ${district.beat_descriptor || ''}`.trim(),
        dispatch_code: district.dispatch_code,
        section_name: district.section_name,
        zone_name: district.zone_name,
        beat_name: district.beat_name,
        beat_descriptor: district.beat_descriptor,
      });
    } else {
      // Fallback to raw geofence data
      res.json({
        found: true,
        section_id: beat.district_letter,
        zone_id: `${beat.city} ${beat.district_letter}${beat.beat_number}`,
        beat_id: beat.beat_id,
      });
    }
  } catch (error: any) {
    console.error('[Dispatch] district identify error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'DISTRICT_IDENTIFY_ERROR' });
  }
});

// GET /api/dispatch/heatmap/timelapse - Animated heatmap data sliced by time
router.get('/heatmap/timelapse', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const db = getDb();
    // Fix 1: Days validation (timelapse caps at 90)
    const days = Math.max(1, Math.min(90, parseInt(req.query.days as string, 10) || 7));
    // Fix 2: Mode whitelist validation
    const mode = (req.query.mode as string) || 'all';
    const validModes = ['all', 'risk'];
    if (!validModes.includes(mode)) {
      res.status(400).json({ error: `Invalid mode. Must be one of: ${validModes.join(', ')}`, code: 'INVALID_MODE' });
      return;
    }
    // Fix 8: Cache headers
    setCacheHeaders(res, 120);

    // Determine slice duration based on range
    let sliceHours: number;
    if (req.query.slices) {
      const totalHours = days * 24;
      const requestedSlices = Math.max(1, Math.min(500, parseInt(req.query.slices as string, 10) || 24));
      sliceHours = Math.max(1, Math.floor(totalHours / requestedSlices));
    } else if (days <= 7) {
      sliceHours = 1; // hourly
    } else if (days <= 30) {
      sliceHours = 6; // 6-hour blocks
    } else {
      sliceHours = 24; // daily
    }

    const totalHours = days * 24;
    const sliceCount = Math.ceil(totalHours / sliceHours);
    const now = new Date();
    const startTime = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const riskFilter = mode === 'risk'
      ? `AND (weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0'
           OR domestic_violence = 1 OR injuries_reported = 1
           OR alcohol_involved = 1 OR drugs_involved = 1)`
      : '';

    const riskColumns = mode === 'risk'
      ? `, SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 3 ELSE 0 END
            + CASE WHEN domestic_violence = 1 THEN 2 ELSE 0 END
            + CASE WHEN injuries_reported = 1 THEN 2 ELSE 0 END
            + CASE WHEN alcohol_involved = 1 THEN 1 ELSE 0 END
            + CASE WHEN drugs_involved = 1 THEN 1 ELSE 0 END
          ) as risk_weight`
      : '';

    const slices: { start: string; end: string; points: any[] }[] = [];

    for (let i = 0; i < sliceCount; i++) {
      const sliceStart = new Date(startTime.getTime() + i * sliceHours * 60 * 60 * 1000);
      const sliceEnd = new Date(sliceStart.getTime() + sliceHours * 60 * 60 * 1000);

      const startStr = sliceStart.toISOString().replace('T', ' ').slice(0, 19);
      const endStr = sliceEnd.toISOString().replace('T', ' ').slice(0, 19);

      const points = db.prepare(`
        SELECT
          ROUND(latitude, 3) as latitude,
          ROUND(longitude, 3) as longitude,
          COUNT(*) as count
          ${riskColumns}
        FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND created_at >= ? AND created_at < ?
          ${riskFilter}
        GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
        ORDER BY count DESC
        LIMIT 200
      `).all(startStr, endStr);

      slices.push({ start: startStr, end: endStr, points });
    }

    logTiming('heatmap/timelapse', startMs);
    res.json({ slices, total_slices: slices.length, days, mode });
  } catch (error: any) {
    console.error('[Dispatch] heatmap timelapse error:', error?.message || 'Unknown error');
    if (error?.message?.includes('no such table')) {
      res.json({ slices: [], total_slices: 0 });
      return;
    }
    res.status(500).json({ error: 'Internal server error', code: 'TIMELAPSE_ERROR' });
  }
});

// GET /api/dispatch/heatmap/predictions - Predictive hotspot analysis
router.get('/heatmap/predictions', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const db = getDb();
    setCacheHeaders(res, 300); // Predictions can be cached longer

    // Determine target shift
    const shiftParam = req.query.shift as string | undefined;
    const validShifts = ['day', 'swing', 'night'];
    let targetShift: string;

    if (shiftParam && validShifts.includes(shiftParam)) {
      targetShift = shiftParam;
    } else {
      // Auto-detect current shift using Mountain Time
      const currentHr = localHour();
      if (currentHr >= 6 && currentHr < 14) targetShift = 'day';
      else if (currentHr >= 14 && currentHr < 22) targetShift = 'swing';
      else targetShift = 'night';
    }

    // Shift hour ranges
    const shiftHours: Record<string, [number, number]> = {
      day: [6, 14],
      swing: [14, 22],
      night: [22, 6],
    };
    const [shiftStart, shiftEnd] = shiftHours[targetShift];

    const todayDow = localDayOfWeek(); // 0=Sunday, Mountain Time

    // Query last 90 days of calls with valid lat/lng
    const rows = db.prepare(`
      SELECT
        ROUND(latitude, 3) as latitude,
        ROUND(longitude, 3) as longitude,
        created_at,
        incident_type,
        CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 1 ELSE 0 END as has_weapon,
        CASE WHEN domestic_violence = 1 THEN 1 ELSE 0 END as has_dv
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', 'localtime', '-90 days')
      LIMIT 50000
    `).all() as any[];

    // Aggregate by grid cell
    const cells: Record<string, {
      latitude: number;
      longitude: number;
      score: number;
      incident_count: number;
      types: Record<string, number>;
      weapons_count: number;
      dv_count: number;
    }> = {};

    const now = Date.now();
    const msPerDay = 86400000;

    for (const row of rows) {
      const key = `${row.latitude},${row.longitude}`;
      if (!cells[key]) {
        cells[key] = {
          latitude: row.latitude,
          longitude: row.longitude,
          score: 0,
          incident_count: 0,
          types: {},
          weapons_count: 0,
          dv_count: 0,
        };
      }

      const cell = cells[key];
      cell.incident_count++;
      if (row.has_weapon) cell.weapons_count++;
      if (row.has_dv) cell.dv_count++;
      if (row.incident_type) {
        cell.types[row.incident_type] = (cell.types[row.incident_type] || 0) + 1;
      }

      // Calculate weight
      let weight = 1;

      // Recency weight
      const callDate = new Date(row.created_at);
      const ageMs = now - callDate.getTime();
      const ageDays = ageMs / msPerDay;
      if (ageDays <= 7) weight = 3;
      else if (ageDays <= 30) weight = 2;
      // else weight = 1 (default)

      // Day-of-week match
      if (callDate.getDay() === todayDow) {
        weight *= 1.5;
      }

      // Shift match
      const callHour = callDate.getHours();
      let inShift = false;
      if (targetShift === 'night') {
        inShift = callHour >= 22 || callHour < 6;
      } else {
        inShift = callHour >= shiftStart && callHour < shiftEnd;
      }
      if (inShift) {
        weight *= 2.0;
      }

      cell.score += weight;
    }

    // Sort by score, take top 15
    const hotspots = Object.values(cells)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map(cell => ({
        latitude: cell.latitude,
        longitude: cell.longitude,
        score: Math.round(cell.score * 10) / 10,
        incident_count: cell.incident_count,
        top_types: Object.entries(cell.types)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([t]) => t)
          .join(', '),
        weapons_count: cell.weapons_count,
        dv_count: cell.dv_count,
      }));

    logTiming('heatmap/predictions', startMs);
    res.json({ shift: targetShift, hotspots, total: hotspots.length });
  } catch (error: any) {
    console.error('[Dispatch] heatmap predictions error:', error?.message || 'Unknown error');
    if (error?.message?.includes('no such table')) {
      res.json({ shift: 'unknown', hotspots: [], total: 0 });
      return;
    }
    res.status(500).json({ error: 'Internal server error', code: 'PREDICTIONS_ERROR' });
  }
});

// GET /api/dispatch/heatmap/safety-zones - High-risk safety zones
router.get('/heatmap/safety-zones', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const db = getDb();
    setCacheHeaders(res, 120);

    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 90));
    const cutoff = `-${days}`;

    const zones = db.prepare(`
      SELECT
        ROUND(latitude, 3) as latitude,
        ROUND(longitude, 3) as longitude,
        SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 1 ELSE 0 END) as weapons_count,
        SUM(CASE WHEN domestic_violence = 1 THEN 1 ELSE 0 END) as dv_count,
        SUM(CASE WHEN injuries_reported = 1 THEN 1 ELSE 0 END) as injuries_count,
        COUNT(*) as total_flagged,
        MAX(created_at) as last_incident,
        GROUP_CONCAT(DISTINCT incident_type) as incident_types
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', 'localtime', ? || ' days')
        AND (
          (weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0')
          OR domestic_violence = 1
          OR injuries_reported = 1
        )
      GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
      HAVING COUNT(*) >= 1
      ORDER BY total_flagged DESC
      LIMIT 100
    `).all(cutoff) as any[];

    const result = zones.map(z => ({
      latitude: z.latitude,
      longitude: z.longitude,
      risk_level: (z.weapons_count >= 2 || z.total_flagged >= 3) ? 'high' : 'moderate',
      weapons_count: z.weapons_count,
      dv_count: z.dv_count,
      injuries_count: z.injuries_count,
      total_flagged: z.total_flagged,
      last_incident: z.last_incident,
      incident_types: z.incident_types || '',
    }));

    logTiming('heatmap/safety-zones', startMs);
    res.json({ zones: filterValidCoords(result), total: result.length });
  } catch (error: any) {
    console.error('[Dispatch] safety zones error:', error?.message || 'Unknown error');
    if (error?.message?.includes('no such table')) {
      res.json({ zones: [], total: 0 });
      return;
    }
    res.status(500).json({ error: 'Internal server error', code: 'SAFETY_ZONES_ERROR' });
  }
});

// GET /api/dispatch/analysis/summary - Cross-feature intelligence dashboard
router.get('/analysis/summary', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const db = getDb();
    setCacheHeaders(res, 120);

    // ── Safety Zones (90d) ─────────────────────────────────
    const safetyZones = db.prepare(`
      SELECT ROUND(latitude, 3) as lat, ROUND(longitude, 3) as lng,
        COUNT(*) as total_flagged,
        SUM(CASE WHEN weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0' THEN 1 ELSE 0 END) as weapons,
        SUM(CASE WHEN domestic_violence = 1 THEN 1 ELSE 0 END) as dv,
        SUM(CASE WHEN injuries_reported = 1 THEN 1 ELSE 0 END) as injuries
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', 'localtime', '-90 days')
        AND (weapons_involved IS NOT NULL AND weapons_involved != '' AND weapons_involved != '0'
             OR domestic_violence = 1 OR injuries_reported = 1)
      GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
      HAVING COUNT(*) >= 1
      ORDER BY total_flagged DESC LIMIT 50
    `).all() as any[];

    // ── Prediction Hotspots (90d, current shift) ────────────
    const currentHr = localHour();
    const shift = currentHr >= 6 && currentHr < 14 ? 'day' : currentHr >= 14 && currentHr < 22 ? 'swing' : 'night';
    const predictions = db.prepare(`
      SELECT ROUND(latitude, 3) as lat, ROUND(longitude, 3) as lng,
        COUNT(*) as incident_count
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', 'localtime', '-90 days')
      GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
      HAVING COUNT(*) >= 3
      ORDER BY incident_count DESC LIMIT 20
    `).all() as any[];

    // ── Overlap: safety zones that are also prediction hotspots ─
    const predGrid = new Set(predictions.map((p: any) => `${p.lat},${p.lng}`));
    const overlapLocations = safetyZones
      .filter((z: any) => predGrid.has(`${z.lat},${z.lng}`))
      .map((z: any) => ({
        latitude: z.lat, longitude: z.lng,
        safetyRisk: (z.weapons >= 2 || z.total_flagged >= 3) ? 'high' : 'moderate',
        predictionScore: predictions.find((p: any) => p.lat === z.lat && p.lng === z.lng)?.incident_count || 0,
        totalFlagged: z.total_flagged,
      }));

    // ── Repeat Addresses in Risk Zones ──────────────────────
    const repeats = db.prepare(`
      SELECT location_address, ROUND(latitude, 3) as lat, ROUND(longitude, 3) as lng,
        COUNT(*) as call_count
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', 'localtime', '-90 days')
      GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
      HAVING COUNT(*) >= 3
      ORDER BY call_count DESC LIMIT 50
    `).all() as any[];

    const safetyGrid = new Map(safetyZones.map((z: any) => [
      `${z.lat},${z.lng}`,
      (z.weapons >= 2 || z.total_flagged >= 3) ? 'high' : 'moderate',
    ]));
    const repeatInRisk = repeats
      .filter((r: any) => safetyGrid.has(`${r.lat},${r.lng}`))
      .slice(0, 10)
      .map((r: any) => ({
        address: r.location_address || `${r.lat}, ${r.lng}`,
        callCount: r.call_count,
        nearestZoneRisk: safetyGrid.get(`${r.lat},${r.lng}`) || 'moderate',
      }));

    // ── Enforcement (30d) ───────────────────────────────────
    let enforcementTotal = 0;
    try {
      const enfRow = db.prepare(`
        SELECT COUNT(*) as cnt FROM calls_for_service
        WHERE created_at >= datetime('now', 'localtime', '-30 days')
          AND (disposition LIKE '%arrest%' OR disposition LIKE '%cite%' OR disposition LIKE '%citation%')
      `).get() as any;
      enforcementTotal = enfRow?.cnt || 0;
    } catch (enfErr) { console.error('[Analysis] Enforcement query error:', enfErr instanceof Error ? enfErr.message : enfErr); }

    const enfInPredicted = repeats.filter((r: any) => predGrid.has(`${r.lat},${r.lng}`)).length;

    // ── Shift Trend ─────────────────────────────────────────
    const currentPeriod = db.prepare(`
      SELECT COUNT(*) as cnt FROM calls_for_service
      WHERE created_at >= datetime('now', 'localtime', '-7 days')
    `).get() as any;
    const previousPeriod = db.prepare(`
      SELECT COUNT(*) as cnt FROM calls_for_service
      WHERE created_at >= datetime('now', 'localtime', '-14 days')
        AND created_at < datetime('now', 'localtime', '-7 days')
    `).get() as any;

    const currentCalls = currentPeriod?.cnt || 0;
    const previousCalls = previousPeriod?.cnt || 0;
    const changePercent = previousCalls > 0 ? Math.round(((currentCalls - previousCalls) / previousCalls) * 100) : 0;

    // ── Geofence count ──────────────────────────────────────
    let activeGeofences = 0;
    try {
      const geoRow = db.prepare('SELECT COUNT(*) as cnt FROM geofences WHERE is_active = 1').get() as any;
      activeGeofences = geoRow?.cnt || 0;
    } catch (geoErr) { console.error('[Analysis] Geofence count error:', geoErr instanceof Error ? geoErr.message : geoErr); }

    // ── Repeat address count ────────────────────────────────
    const repeatCount = repeats.length;

    logTiming('analysis/summary', startMs);
    res.json({
      overlapZones: { count: overlapLocations.length, locations: overlapLocations },
      repeatInRiskZones: { count: repeatInRisk.length, addresses: repeatInRisk },
      enforcement: {
        total30d: enforcementTotal,
        inPredictedAreas: enfInPredicted,
        effectivenessRate: enforcementTotal > 0 ? Math.round((enfInPredicted / enforcementTotal) * 100) : 0,
      },
      shiftTrend: {
        currentShift: shift,
        currentPeriodCalls: currentCalls,
        previousPeriodCalls: previousCalls,
        changePercent,
      },
      metrics: {
        totalSafetyZones: safetyZones.length,
        highRiskZones: safetyZones.filter((z: any) => z.weapons >= 2 || z.total_flagged >= 3).length,
        activePredictions: predictions.length,
        activeGeofences,
        totalEnforcement30d: enforcementTotal,
        repeatAddressCount: repeatCount,
      },
    });
  } catch (error: any) {
    console.error('[Dispatch] analysis summary error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'ANALYSIS_SUMMARY_ERROR' });
  }
});

// GET /api/dispatch/repeat-addresses - Addresses with repeated calls for service
// Query params: days (int, default 30), min_count (int, default 3)
router.get('/repeat-addresses', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const db = getDb();
    // Fix 66: Proper date filtering with validation
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));
    // Fix 67: Minimum repeat count threshold parameter
    const minCount = Math.max(2, Math.min(100, parseInt(req.query.min_count as string, 10) || 3));
    // Fix 4: Pagination support
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit as string, 10) || 100));
    const offset = (page - 1) * limit;

    const cutoff = `-${days}`;
    setCacheHeaders(res, 120);

    // Fix 68: Sort by repeat count (most repeated first) — already ORDER BY call_count DESC
    const addresses = db.prepare(`
      SELECT location_address, ROUND(latitude, 4) AS lat, ROUND(longitude, 4) AS lng,
             COUNT(*) AS call_count, GROUP_CONCAT(DISTINCT incident_type) AS incident_types,
             MAX(created_at) AS last_call,
             MIN(created_at) AS first_call
      FROM calls_for_service
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND created_at >= datetime('now', 'localtime', ? || ' days')
      GROUP BY ROUND(latitude, 4), ROUND(longitude, 4)
      HAVING COUNT(*) >= ?
      ORDER BY call_count DESC
      LIMIT ? OFFSET ?
    `).all(cutoff, minCount, limit, offset) as any[];

    // Fix 69: Coordinate validation
    const validated = filterValidCoords(addresses);

    // Fix 70: Return structured response with location details
    logTiming('repeat-addresses', startMs);
    res.json(validated);
  } catch (error: any) {
    console.error('[Dispatch] repeat-addresses error:', error?.message || 'Unknown error');
    if (error?.message?.includes('no such table')) {
      res.json([]);
      return;
    }
    res.status(500).json({ error: 'Internal server error', code: 'REPEAT_ADDRESSES_ERROR' });
  }
});

// GET /api/dispatch/heatmap/enforcement - Citation/arrest geographic clusters
// Query params: type ('citations' | 'arrests'), days (int, default 90)
router.get('/heatmap/enforcement', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const db = getDb();
    setCacheHeaders(res, 120);
    const type = req.query.type as string;
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 90));

    if (!type || !['citations', 'arrests'].includes(type)) {
      res.status(400).json({ error: 'type must be "citations" or "arrests"', code: 'INVALID_ENFORCEMENT_TYPE' });
      return;
    }

    const cutoff = `-${days}`;

    if (type === 'citations') {
      // Join citations to calls_for_service via call_id to get coordinates
      const clusters = db.prepare(`
        SELECT ROUND(c2.latitude, 3) AS lat, ROUND(c2.longitude, 3) AS lng,
               COUNT(*) AS total,
               GROUP_CONCAT(DISTINCT c.violation_description) AS top_statutes,
               MIN(c.created_at) AS first_date,
               MAX(c.created_at) AS last_date
        FROM citations c
        JOIN calls_for_service c2 ON c.call_id = c2.id
        WHERE c2.latitude IS NOT NULL AND c2.longitude IS NOT NULL
          AND c.created_at >= datetime('now', 'localtime', ? || ' days')
        GROUP BY ROUND(c2.latitude, 3), ROUND(c2.longitude, 3)
        ORDER BY total DESC
        LIMIT 100
      `).all(cutoff);

      logTiming('heatmap/enforcement/citations', startMs);
      res.json(filterValidCoords(clusters as any[]));
      return;
    }

    // Arrests: use incidents with arrest-related dispositions joined to calls_for_service
    const clusters = db.prepare(`
      SELECT ROUND(c.latitude, 3) AS lat, ROUND(c.longitude, 3) AS lng,
             COUNT(*) AS total,
             GROUP_CONCAT(DISTINCT i.incident_type) AS top_statutes,
             MIN(i.created_at) AS first_date,
             MAX(i.created_at) AS last_date
      FROM incidents i
      JOIN calls_for_service c ON i.call_id = c.id
      WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
        AND i.created_at >= datetime('now', 'localtime', ? || ' days')
        AND (i.disposition LIKE '%arrest%' OR i.disposition LIKE '%custody%' OR i.disposition LIKE '%booked%')
      GROUP BY ROUND(c.latitude, 3), ROUND(c.longitude, 3)
      ORDER BY total DESC
      LIMIT 100
    `).all(cutoff);

    logTiming('heatmap/enforcement/arrests', startMs);
    res.json(filterValidCoords(clusters as any[]));
  } catch (error: any) {
    console.error('[Dispatch] enforcement heatmap error:', error?.message || 'Unknown error');
    if (error?.message?.includes('no such table')) {
      res.json([]);
      return;
    }
    res.status(500).json({ error: 'Internal server error', code: 'ENFORCEMENT_ERROR' });
  }
});

// GET /api/dispatch/history-map - Historical cleared/closed/archived calls with coords for map display
router.get('/history-map', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 7));
    const limit = Math.max(1, Math.min(2000, parseInt(req.query.limit as string, 10) || 500));

    // Parse comma-separated filters
    const validStatuses = ['cleared', 'closed', 'archived'];
    const statusFilter = req.query.status
      ? String(req.query.status).split(',').filter(s => validStatuses.includes(s))
      : validStatuses;
    if (statusFilter.length === 0) {
      res.status(400).json({ error: 'Invalid status filter', code: 'INVALID_STATUS_FILTER' });
      return;
    }

    const typesFilter = req.query.types
      ? String(req.query.types).split(',').filter(t => t.length > 0 && t.length < 100).slice(0, 30)
      : [];

    const validPriorities = ['P1', 'P2', 'P3', 'P4'];
    const priorityFilter = req.query.priority
      ? String(req.query.priority).split(',').filter(p => validPriorities.includes(p))
      : [];

    const conditions: string[] = [
      'c.latitude IS NOT NULL',
      'c.longitude IS NOT NULL',
      `c.created_at >= datetime('now', 'localtime', ? || ' days')`,
    ];
    const params: any[] = [`-${days}`];

    // Status filter
    const statusPlaceholders = statusFilter.map(() => '?').join(',');
    conditions.push(`c.status IN (${statusPlaceholders})`);
    params.push(...statusFilter);

    // Types filter
    if (typesFilter.length > 0) {
      const typePlaceholders = typesFilter.map(() => '?').join(',');
      conditions.push(`c.incident_type IN (${typePlaceholders})`);
      params.push(...typesFilter);
    }

    // Priority filter
    if (priorityFilter.length > 0) {
      const priPlaceholders = priorityFilter.map(() => '?').join(',');
      conditions.push(`c.priority IN (${priPlaceholders})`);
      params.push(...priorityFilter);
    }

    const whereClause = conditions.join(' AND ');

    const rows = db.prepare(`
      SELECT
        c.id,
        c.call_number,
        c.incident_type,
        c.priority,
        c.status,
        c.disposition,
        c.location_address,
        c.latitude,
        c.longitude,
        c.created_at,
        c.cleared_at,
        c.onscene_at,
        c.assigned_unit_ids,
        c.description,
        c.source,
        CASE
          WHEN c.onscene_at IS NOT NULL THEN ROUND((julianday(c.onscene_at) - julianday(c.created_at)) * 24 * 60, 1)
          WHEN c.cleared_at IS NOT NULL THEN ROUND((julianday(c.cleared_at) - julianday(c.created_at)) * 24 * 60, 1)
          ELSE NULL
        END as response_time_min
      FROM calls_for_service c
      WHERE ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT ?
    `).all(...params, limit) as any[];

    // Resolve assigned_unit_ids to call_signs
    const unitStmt = db.prepare('SELECT call_sign FROM units WHERE id = ?');
    const results = rows.map((row: any) => {
      let assignedUnits = '';
      if (row.assigned_unit_ids) {
        try {
          const ids = JSON.parse(row.assigned_unit_ids);
          if (Array.isArray(ids)) {
            assignedUnits = ids
              .map((uid: any) => {
                const u = unitStmt.get(uid) as any;
                return u?.call_sign || null;
              })
              .filter(Boolean)
              .join(', ');
          }
        } catch (parseErr) { console.error('[Aggregates] Failed to parse assigned_unit_ids for history-map:', parseErr instanceof Error ? parseErr.message : parseErr); }
      }
      return {
        id: row.id,
        call_number: row.call_number,
        incident_type: row.incident_type,
        priority: row.priority,
        status: row.status,
        disposition: row.disposition,
        location_address: row.location_address,
        latitude: row.latitude,
        longitude: row.longitude,
        created_at: row.created_at,
        cleared_at: row.cleared_at,
        response_time_min: row.response_time_min,
        assigned_units: assignedUnits,
        description: row.description,
        source: row.source,
      };
    });

    res.json(results);
  } catch (error: any) {
    console.error('[Dispatch] history-map error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'HISTORY_MAP_ERROR' });
  }
});

export default router;
