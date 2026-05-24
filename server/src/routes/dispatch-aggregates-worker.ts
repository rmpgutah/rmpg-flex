// Dispatch Aggregates — heatmap, history-map, repeat-addresses, geography stats
// Ported from server/src/routes/dispatch/aggregates.ts for Cloudflare Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, localNow } from '../worker-middleware/d1Helpers';

const AGGR_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];

function filterValidCoords(points: any[]): any[] {
  return points.filter((p: any) =>
    p.latitude != null && p.longitude != null &&
    Number.isFinite(Number(p.latitude)) && Number(p.latitude) >= -90 && Number(p.latitude) <= 90 &&
    Number.isFinite(Number(p.longitude)) && Number(p.longitude) >= -180 && Number(p.longitude) <= 180
  );
}

export function mountDispatchAggregatesRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // ─── Heatmap ──────────────────────────────────────────
  // GET /api/dispatch/heatmap?days=30&mode=all|risk|type&type=X
  api.get('/heatmap', requireRole(...AGGR_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    const days = Math.max(1, Math.min(365, parseInt(c.req.query('days') || '30', 10) || 30));
    const mode = c.req.query('mode') || 'all';
    const typeFilter = c.req.query('type') || '';
    const cutoff = `-${days}`;

    try {
      if (mode === 'risk') {
        try {
          const points = await db.prepare(`
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
            GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
            HAVING risk_weight > 0
            ORDER BY risk_weight DESC
            LIMIT 10000
          `).all(cutoff) as any[];
          return c.json(filterValidCoords(points));
        } catch { /* risk columns may not exist yet, fall through to all mode */ }
      }

      if (mode === 'type' && typeFilter) {
        const points = await db.prepare(`
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
        return c.json(filterValidCoords(points));
      }

      // mode === 'all' — default
      const points = await db.prepare(`
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
      return c.json(filterValidCoords(points));
    } catch (err: any) {
      if (err?.message?.includes('no such table')) return c.json([]);
      return c.json({ error: 'Heatmap query failed' }, 500);
    }
  });

  // ─── History Map ─────────────────────────────────────
  // GET /api/dispatch/history-map?days=7&status=cleared,closed&types&priority&limit=100000
  api.get('/history-map', requireRole(...AGGR_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    const days = Math.max(1, Math.min(365, parseInt(c.req.query('days') || '7', 10) || 7));
    const limit = Math.min(100000, Math.max(1, parseInt(c.req.query('limit') || '100000', 10) || 100000));

    const statuses = c.req.query('status')
      ? c.req.query('status')!.split(',').filter(s => ['cleared', 'closed', 'archived'].includes(s))
      : ['cleared', 'closed', 'archived'];

    const types = c.req.query('types')
      ? c.req.query('types')!.split(',').filter(t => t.length > 0 && t.length < 100).slice(0, 30)
      : [];

    const priorities = c.req.query('priority')
      ? c.req.query('priority')!.split(',').filter(p => ['P1', 'P2', 'P3', 'P4'].includes(p))
      : [];

    try {
      const conditions: string[] = [
        'c.latitude IS NOT NULL',
        'c.longitude IS NOT NULL',
        "c.created_at >= datetime('now', 'localtime', ? || ' days')"
      ];
      const params: any[] = [`-${days}`];

      conditions.push(`c.status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);

      if (types.length > 0) {
        conditions.push(`c.incident_type IN (${types.map(() => '?').join(',')})`);
        params.push(...types);
      }
      if (priorities.length > 0) {
        conditions.push(`c.priority IN (${priorities.map(() => '?').join(',')})`);
        params.push(...priorities);
      }

      const rows = await db.prepare(`
        SELECT
          c.id, c.call_number, c.incident_type, c.priority, c.status, c.disposition,
          c.location_address, c.latitude, c.longitude, c.created_at, c.cleared_at, c.onscene_at,
          c.description, c.source,
          CASE
            WHEN c.onscene_at IS NOT NULL THEN ROUND((julianday(c.onscene_at) - julianday(c.created_at)) * 24 * 60, 1)
            WHEN c.cleared_at IS NOT NULL THEN ROUND((julianday(c.cleared_at) - julianday(c.created_at)) * 24 * 60, 1)
            ELSE NULL
          END as response_time_min
        FROM calls_for_service c
        WHERE ${conditions.join(' AND ')}
        ORDER BY c.created_at DESC
        LIMIT ?
      `).all(...params, limit) as any[];

      return c.json(rows);
    } catch (err: any) {
      return c.json({ error: 'History map query failed' }, 500);
    }
  });

  // ─── Repeat Addresses ─────────────────────────────────
  // GET /api/dispatch/repeat-addresses?days=30&min_count=3&page=1&limit=100
  api.get('/repeat-addresses', requireRole(...AGGR_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    const days = Math.max(1, Math.min(365, parseInt(c.req.query('days') || '30', 10) || 30));
    const minCount = Math.max(2, Math.min(100, parseInt(c.req.query('min_count') || '3', 10) || 3));
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') || '100', 10) || 100));
    const offset = (page - 1) * limit;

    try {
      const rows = await db.prepare(`
        SELECT
          location_address,
          ROUND(AVG(latitude), 5) as lat,
          ROUND(AVG(longitude), 5) as lng,
          COUNT(*) as call_count,
          GROUP_CONCAT(DISTINCT incident_type) as incident_types,
          MAX(created_at) as last_call,
          MIN(created_at) as first_call
        FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND location_address IS NOT NULL AND location_address != ''
          AND created_at >= datetime('now', 'localtime', ? || ' days')
        GROUP BY location_address
        HAVING COUNT(*) >= ?
        ORDER BY call_count DESC
        LIMIT ? OFFSET ?
      `).all(`-${days}`, minCount, limit, offset) as any[];

      // Get total count
      const totalRow = await db.prepare(`
        SELECT COUNT(*) as total FROM (
          SELECT location_address FROM calls_for_service
          WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            AND location_address IS NOT NULL AND location_address != ''
            AND created_at >= datetime('now', 'localtime', ? || ' days')
          GROUP BY location_address
          HAVING COUNT(*) >= ?
        )
      `).get(`-${days}`, minCount) as any;

      return c.json({
        addresses: rows,
        total: totalRow?.total || 0,
        page,
        limit,
        hasMore: offset + limit < (totalRow?.total || 0),
      });
    } catch (err: any) {
      return c.json({ addresses: [], total: 0, page: 1, limit, hasMore: false });
    }
  });

  // ─── Districts List ──────────────────────────────────
  // GET /api/dispatch/districts - List all 3-tier dispatch districts
  api.get('/districts', requireRole(...AGGR_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    const search = c.req.query('search') || '';
    const limit = Math.min(100000, Math.max(1, parseInt(c.req.query('limit') || '100000', 10) || 100000));

    try {
      let query = `
        SELECT db2.id, ds.sector_code as sector_id, dz.zone_code as zone_id, db2.beat_code as beat_id,
               db2.beat_code as dispatch_code, ds.sector_name, dz.zone_name,
               db2.beat_name, db2.beat_descriptor
        FROM dispatch_beats db2
        LEFT JOIN dispatch_zones dz ON dz.id = db2.zone_id
        LEFT JOIN dispatch_sectors ds ON ds.id = dz.sector_id
      `;
      const params: any[] = [];
      if (search && typeof search === 'string' && search.length >= 1 && search.length <= 100) {
        query += ` WHERE dz.zone_name LIKE ? ESCAPE '\\' OR db2.beat_name LIKE ? ESCAPE '\\' OR ds.sector_name LIKE ? ESCAPE '\\'`;
        const s = `%${search.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
        params.push(s, s, s);
      }
      query += ' ORDER BY ds.sector_code, dz.zone_code, db2.beat_code LIMIT ?';
      params.push(limit);

      const districts = await db.prepare(query).all(...params) as any[];
      return c.json(districts);
    } catch (err: any) {
      if (err?.message?.includes('no such table')) return c.json([]);
      return c.json({ error: 'Districts list failed' }, 500);
    }
  });

  // ─── Call Density per Beat ──────────────────────────────
  // GET /api/dispatch/districts/call-density?range=24h|7d|30d
  api.get('/districts/call-density', requireRole(...AGGR_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    const range = c.req.query('range') || '24h';
    let cutoff: string;
    if (range === '24h') cutoff = '-1';
    else if (range === '7d') cutoff = '-7';
    else cutoff = '-30';

    try {
      const rows = await db.prepare(`
        SELECT
          COALESCE(db2.beat_code, 'Unknown') as zone_beat,
          COUNT(*) as call_count
        FROM calls_for_service c
        LEFT JOIN dispatch_beats db2 ON
          c.latitude BETWEEN db2.min_lat AND db2.max_lat
          AND c.longitude BETWEEN db2.min_lng AND db2.max_lng
        WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
          AND c.created_at >= datetime('now', 'localtime', ? || ' days')
        GROUP BY zone_beat
        ORDER BY call_count DESC
        LIMIT 500
      `).all(cutoff) as any[];

      return c.json(rows);
    } catch {
      return c.json([]);
    }
  });

  // ─── District Identify (point-in-beat) ─────────────────
  // GET /api/dispatch/districts/identify?lat=X&lng=Y
  api.get('/districts/identify', requireRole(...AGGR_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    const lat = parseFloat(c.req.query('lat') || '');
    const lng = parseFloat(c.req.query('lng') || '');
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return c.json({ found: false, error: 'Invalid coordinates' });
    }

    try {
      // Find containing beat via bounding box + exact polygon match.
      // Fixed `dc.*` -> `dz.*` typo (the JOIN alias is `dz`, not `dc`);
      // previously every exact-match call threw `no such column: dc.zone_code`
      // and silently fell through to the nearest-beat fallback below.
      const beat = await db.prepare(`
        SELECT db2.beat_code, db2.beat_name, db2.beat_descriptor,
               dz.zone_code, dz.zone_name, ds.sector_code, ds.sector_name
        FROM dispatch_beats db2
        LEFT JOIN dispatch_zones dz ON dz.id = db2.zone_id
        LEFT JOIN dispatch_sectors ds ON ds.id = dz.sector_id
        WHERE db2.min_lat IS NOT NULL AND db2.max_lat IS NOT NULL
          AND ? BETWEEN db2.min_lat AND db2.max_lat
          AND ? BETWEEN db2.min_lng AND db2.max_lng
        -- City/municipal beats win over county-unincorp catch-alls.
        -- Pattern: 29 unincorp beats per county are all named XXX-UNINC
        -- with "Co. Unincorp." in beat_name. Anything not matching is treated
        -- as municipal. If RMPG ever adds an unincorp beat that does not
        -- follow this naming convention, both this CASE and the seed would
        -- need updating - alternative is adding an is_unincorp flag column.
        ORDER BY (CASE WHEN db2.beat_name LIKE '%Unincorp%' OR db2.beat_code LIKE '%UNINC%' THEN 1 ELSE 0 END) ASC
        LIMIT 1
      `).get(lat, lng) as any;

      if (beat) {
        return c.json({
          found: true, exact: true,
          beat_code: beat.beat_code,
          beat_name: beat.beat_name,
          zone_code: beat.zone_code,
          zone_name: beat.zone_name,
          sector_code: beat.sector_code,
          sector_name: beat.sector_name,
        });
      }

      // Fallback: nearest beat
      const nearest = await db.prepare(`
        SELECT beat_code, beat_name, beat_descriptor,
          ((? - min_lat) * (? - min_lat) + (? - min_lng) * (? - min_lng)) as dist
        FROM dispatch_beats
        WHERE min_lat IS NOT NULL
        ORDER BY dist ASC LIMIT 1
      `).get(lat, lat, lng, lng) as any;

      if (nearest) {
        return c.json({
          found: true, exact: false,
          beat_code: nearest.beat_code,
          beat_name: nearest.beat_name,
        });
      }

      return c.json({ found: false });
    } catch (err: any) {
      // If tables don't exist, just return not found
      if (err?.message?.includes('no such table')) return c.json({ found: false });
      return c.json({ found: false, error: 'Query failed' });
    }
  });

  // ─── Beat Activity ─────────────────────────────────────
  // GET /api/dispatch/beat-activity?days=30
  api.get('/beat-activity', requireRole(...AGGR_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    const days = Math.max(1, Math.min(365, parseInt(c.req.query('days') || '30', 10) || 30));

    try {
      const rows = await db.prepare(`
        SELECT
          COALESCE(db2.beat_code, 'Unknown') as beat,
          COUNT(DISTINCT c.id) as calls,
          COUNT(DISTINCT i.id) as incidents,
          COUNT(DISTINCT ci.id) as citations,
          COUNT(DISTINCT a.id) as arrests,
          AVG(CASE WHEN c.onscene_at IS NOT NULL THEN (julianday(c.onscene_at) - julianday(c.created_at)) * 24 * 60 END) as avg_response_min,
          GROUP_CONCAT(DISTINCT c.incident_type) as incident_types
        FROM dispatch_beats db2
        LEFT JOIN calls_for_service c ON
          c.latitude BETWEEN db2.min_lat AND db2.max_lat
          AND c.longitude BETWEEN db2.min_lng AND db2.max_lng
          AND c.created_at >= datetime('now', 'localtime', ? || ' days')
        LEFT JOIN incidents i ON
          i.latitude BETWEEN db2.min_lat AND db2.max_lat
          AND i.longitude BETWEEN db2.min_lng AND db2.max_lng
          AND i.created_at >= datetime('now', 'localtime', ? || ' days')
        LEFT JOIN citations ci ON
          ci.latitude BETWEEN db2.min_lat AND db2.max_lat
          AND ci.longitude BETWEEN db2.min_lng AND db2.max_lng
          AND ci.created_at >= datetime('now', 'localtime', ? || ' days')
        LEFT JOIN arrest_records a ON
          a.latitude BETWEEN db2.min_lat AND db2.max_lat
          AND a.longitude BETWEEN db2.min_lng AND db2.max_lng
          AND a.created_at >= datetime('now', 'localtime', ? || ' days')
        WHERE db2.beat_code IS NOT NULL
        GROUP BY db2.beat_code
        ORDER BY calls DESC
        LIMIT 500
      `).all(`-${days}`, `-${days}`, `-${days}`, `-${days}`) as any[];

      return c.json({ period_days: days, beats: rows });
    } catch (err: any) {
      if (err?.message?.includes('no such table')) return c.json({ period_days: days, beats: [] });
      return c.json({ period_days: days, beats: [], error: 'Query failed' });
    }
  });

  // ─── Heatmap Types ───────────────────────────────────
  // GET /api/dispatch/heatmap/types — available incident types for filtering
  api.get('/heatmap/types', requireRole(...AGGR_ROLES), async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const rows = await db.prepare(`
        SELECT incident_type, COUNT(*) as count
        FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND created_at >= datetime('now', 'localtime', '-90 days')
        GROUP BY incident_type
        ORDER BY count DESC
        LIMIT 100
      `).all() as any[];
      return c.json(rows);
    } catch {
      return c.json([]);
    }
  });

  // ─── Heatmap Advanced ─────────────────────────────────
  // GET /api/dispatch/heatmap/advanced - Enhanced heatmap with filtering, clustering, comparison
  api.get('/heatmap/advanced', requireRole(...AGGR_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const days = Math.max(1, Math.min(365, parseInt(c.req.query('days') || '30', 10) || 30));
      const mode = c.req.query('mode') || 'density'; // density | risk | temporal | comparison
      const typesRaw = c.req.query('types'); // comma-separated
      const hourStart = parseInt(c.req.query('hourStart') || '', 10);
      const hourEnd = parseInt(c.req.query('hourEnd') || '', 10);
      const dayFilterRaw = c.req.query('dayFilter'); // comma-separated 0-6
      const resolution = c.req.query('resolution') || 'medium'; // fine=0.001, medium=0.003, coarse=0.005
      const comparisonDays = parseInt(c.req.query('comparisonDays') || '', 10) || days;
      const temporalHour = parseInt(c.req.query('temporalHour') || '', 10); // for temporal mode single-hour

      const validAdvancedModes = ['density', 'risk', 'temporal', 'comparison'];
      if (!validAdvancedModes.includes(mode)) {
        return c.json({ error: `Invalid mode. Must be one of: ${validAdvancedModes.join(', ')}`, code: 'INVALID_MODE' }, 400);
      }

      if (!isNaN(hourStart) && (hourStart < 0 || hourStart > 23)) {
        return c.json({ error: 'hourStart must be between 0 and 23', code: 'INVALID_HOUR_START' }, 400);
      }
      if (!isNaN(hourEnd) && (hourEnd < 0 || hourEnd > 23)) {
        return c.json({ error: 'hourEnd must be between 0 and 23', code: 'INVALID_HOUR_END' }, 400);
      }

      const validResolutions = ['fine', 'medium', 'coarse'];
      if (!validResolutions.includes(resolution)) {
        return c.json({ error: `Invalid resolution. Must be one of: ${validResolutions.join(', ')}`, code: 'INVALID_RESOLUTION' }, 400);
      }

      const resMap: Record<string, number> = { fine: 1, medium: 3, coarse: 5 };
      const roundDigits = resMap[resolution] || 3;
      const types = typesRaw ? typesRaw.split(',').filter(t => t.length > 0 && t.length < 100).slice(0, 20) : [];
      const dayFilter = dayFilterRaw ? dayFilterRaw.split(',').map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6) : [];

      if (dayFilterRaw && dayFilter.length === 0) {
        return c.json({ error: 'dayFilter must contain valid day-of-week values (0=Sunday through 6=Saturday)', code: 'INVALID_DAY_FILTER' }, 400);
      }

      const conditions: string[] = [
        'latitude IS NOT NULL',
        'longitude IS NOT NULL',
        `created_at >= datetime('now', 'localtime', ? || ' days')`,
      ];
      const params: any[] = [`-${days}`];

      const hasHourFilter = !isNaN(hourStart) && !isNaN(hourEnd) && hourStart >= 0 && hourStart <= 23 && hourEnd >= 0 && hourEnd <= 23;
      if (hasHourFilter) {
        if (hourStart <= hourEnd) {
          conditions.push(`CAST(strftime('%H', created_at) AS INTEGER) >= ? AND CAST(strftime('%H', created_at) AS INTEGER) <= ?`);
          params.push(hourStart, hourEnd);
        } else {
          conditions.push(`(CAST(strftime('%H', created_at) AS INTEGER) >= ? OR CAST(strftime('%H', created_at) AS INTEGER) <= ?)`);
          params.push(hourStart, hourEnd);
        }
      }

      if (dayFilter.length > 0 && dayFilter.length < 7) {
        const placeholders = dayFilter.map(() => '?').join(',');
        conditions.push(`CAST(strftime('%w', created_at) AS INTEGER) IN (${placeholders})`);
        params.push(...dayFilter);
      }

      if (types.length > 0) {
        const placeholders = types.map(() => '?').join(',');
        conditions.push(`incident_type IN (${placeholders})`);
        params.push(...types);
      }

      const whereClause = conditions.join(' AND ');
      const latRound = resolution === 'coarse' ? 2 : 3;
      const lngRound = resolution === 'coarse' ? 2 : 3;

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

      const points = await db.prepare(pointsQuery).all(...params, ...temporalParams) as any[];

      const formattedPoints = points.map((p: any) => ({
        lat: p.latitude,
        lng: p.longitude,
        weight: mode === 'risk' ? Math.max(p.riskScore || 1, p.count) : (p.count || 1),
        count: p.count,
        types: p.types || '',
        riskScore: p.riskScore || 0,
      }));

      // DBSCAN cluster grouping
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
            radius: Math.max(maxDist * 111000, 200),
            count: totalCount,
            avgRisk: Math.round(avgRisk * 10) / 10,
          });
        }
      }

      // Stats
      const totalRow = await db.prepare(`SELECT COUNT(*) as total FROM calls_for_service WHERE ${whereClause}${temporalConditions}`).get(...params, ...temporalParams) as any;

      const topTypes = await db.prepare(`
        SELECT incident_type, COUNT(*) as count
        FROM calls_for_service
        WHERE ${whereClause}${temporalConditions} AND incident_type IS NOT NULL AND incident_type != ''
        GROUP BY incident_type
        ORDER BY count DESC
        LIMIT 5
      `).all(...params, ...temporalParams) as any[];

      const peakHourRow = await db.prepare(`
        SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
        FROM calls_for_service
        WHERE ${whereClause}${temporalConditions}
        GROUP BY hour
        ORDER BY count DESC
        LIMIT 1
      `).get(...params, ...temporalParams) as any;

      const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const peakDayRow = await db.prepare(`
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

      let comparisonPoints: any[] = [];
      if (mode === 'comparison') {
        const compCutoffStart = `-${days + comparisonDays}`;
        const compCutoffEnd = `-${days}`;

        const compConditions = conditions.map(c => {
          if (c.includes('created_at >=')) {
            return `created_at >= datetime('now', 'localtime', ? || ' days') AND created_at < datetime('now', 'localtime', ? || ' days')`;
          }
          return c;
        });

        const compParams: any[] = [compCutoffStart, compCutoffEnd, ...params.slice(1)];
        const compWhere = compConditions.join(' AND ');

        const compPoints = await db.prepare(`
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

      return c.json({
        points: filterValidCoords(formattedPoints),
        comparisonPoints: mode === 'comparison' ? filterValidCoords(comparisonPoints) : undefined,
        clusters,
        stats,
        total: formattedPoints.length,
      });
    } catch (error: any) {
      if (error?.message?.includes('no such table')) {
        return c.json({ points: [], clusters: [], stats: { total: 0, topTypes: [], peakHour: null, peakDay: null }, total: 0 });
      }
      return c.json({ error: 'Internal server error', code: 'ADVANCED_HEATMAP_ERROR' }, 500);
    }
  });

  // ─── Heatmap Timelapse ────────────────────────────────
  // GET /api/dispatch/heatmap/timelapse - Animated heatmap data sliced by time
  api.get('/heatmap/timelapse', requireRole(...AGGR_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const days = Math.max(1, Math.min(90, parseInt(c.req.query('days') || '7', 10) || 7));
      const mode = c.req.query('mode') || 'all';
      const validModes = ['all', 'risk'];
      if (!validModes.includes(mode)) {
        return c.json({ error: `Invalid mode. Must be one of: ${validModes.join(', ')}`, code: 'INVALID_MODE' }, 400);
      }

      let sliceHours: number;
      if (c.req.query('slices')) {
        const totalHours = days * 24;
        const requestedSlices = Math.max(1, Math.min(500, parseInt(c.req.query('slices') || '24', 10) || 24));
        sliceHours = Math.max(1, Math.floor(totalHours / requestedSlices));
      } else if (days <= 7) {
        sliceHours = 1;
      } else if (days <= 30) {
        sliceHours = 6;
      } else {
        sliceHours = 24;
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

        const points = await db.prepare(`
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
        `).all(startStr, endStr) as any[];

        slices.push({ start: startStr, end: endStr, points: filterValidCoords(points) });
      }

      return c.json({ slices, total_slices: slices.length, days, mode });
    } catch (error: any) {
      if (error?.message?.includes('no such table')) {
        return c.json({ slices: [], total_slices: 0 });
      }
      return c.json({ error: 'Internal server error', code: 'TIMELAPSE_ERROR' }, 500);
    }
  });

  // ─── Heatmap Predictions ──────────────────────────────
  // GET /api/dispatch/heatmap/predictions - Predictive hotspot analysis
  api.get('/heatmap/predictions', requireRole(...AGGR_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const shiftParam = c.req.query('shift');
      const validShifts = ['day', 'swing', 'night'];
      let targetShift: string;

      if (shiftParam && validShifts.includes(shiftParam)) {
        targetShift = shiftParam;
      } else {
        // Auto-detect based on current Mountain Time hour
        // worker runtime timezone offset america/denver can be computed
        const localHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Denver' })).getHours();
        if (localHour >= 6 && localHour < 14) targetShift = 'day';
        else if (localHour >= 14 && localHour < 22) targetShift = 'swing';
        else targetShift = 'night';
      }

      const shiftHours: Record<string, [number, number]> = {
        day: [6, 14],
        swing: [14, 22],
        night: [22, 6],
      };
      const [shiftStart, shiftEnd] = shiftHours[targetShift];
      const todayDow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Denver' })).getDay();

      const rows = await db.prepare(`
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

        let weight = 1;
        const callDate = new Date(row.created_at);
        const ageMs = now - callDate.getTime();
        const ageDays = ageMs / msPerDay;
        if (ageDays <= 7) weight = 3;
        else if (ageDays <= 30) weight = 2;

        if (callDate.getDay() === todayDow) {
          weight *= 1.5;
        }

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

      return c.json({ shift: targetShift, hotspots: filterValidCoords(hotspots), total: hotspots.length });
    } catch (error: any) {
      if (error?.message?.includes('no such table')) {
        return c.json({ shift: 'unknown', hotspots: [], total: 0 });
      }
      return c.json({ error: 'Internal server error', code: 'PREDICTIONS_ERROR' }, 500);
    }
  });

  // ─── Heatmap Safety Zones ─────────────────────────────
  // GET /api/dispatch/heatmap/safety-zones - High-risk safety zones
  api.get('/heatmap/safety-zones', requireRole(...AGGR_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const days = Math.max(1, Math.min(365, parseInt(c.req.query('days') || '90', 10) || 90));
      const cutoff = `-${days}`;

      const zones = await db.prepare(`
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

      return c.json({ zones: filterValidCoords(result), total: result.length });
    } catch (error: any) {
      if (error?.message?.includes('no such table')) {
        return c.json({ zones: [], total: 0 });
      }
      return c.json({ error: 'Internal server error', code: 'SAFETY_ZONES_ERROR' }, 500);
    }
  });

  // ─── Analysis Summary ─────────────────────────────────
  // GET /api/dispatch/analysis/summary - Cross-feature intelligence dashboard
  api.get('/analysis/summary', requireRole(...AGGR_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);

      const safetyZones = await db.prepare(`
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

      const localHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Denver' })).getHours();
      const shift = localHour >= 6 && localHour < 14 ? 'day' : localHour >= 14 && localHour < 22 ? 'swing' : 'night';

      const predictions = await db.prepare(`
        SELECT ROUND(latitude, 3) as lat, ROUND(longitude, 3) as lng,
          COUNT(*) as incident_count
        FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND created_at >= datetime('now', 'localtime', '-90 days')
        GROUP BY ROUND(latitude, 3), ROUND(longitude, 3)
        HAVING COUNT(*) >= 3
        ORDER BY incident_count DESC LIMIT 20
      `).all() as any[];

      const predGrid = new Set(predictions.map((p: any) => `${p.lat},${p.lng}`));
      const overlapLocations = safetyZones
        .filter((z: any) => predGrid.has(`${z.lat},${z.lng}`))
        .map((z: any) => ({
          latitude: z.lat, longitude: z.lng,
          safetyRisk: (z.weapons >= 2 || z.total_flagged >= 3) ? 'high' : 'moderate',
          predictionScore: predictions.find((p: any) => p.lat === z.lat && p.lng === z.lng)?.incident_count || 0,
          totalFlagged: z.total_flagged,
        }));

      const repeats = await db.prepare(`
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

      let enforcementTotal = 0;
      try {
        const enfRow = await db.prepare(`
          SELECT COUNT(*) as cnt FROM calls_for_service
          WHERE created_at >= datetime('now', 'localtime', '-30 days')
            AND (disposition LIKE '%arrest%' OR disposition LIKE '%cite%' OR disposition LIKE '%citation%')
        `).get() as any;
        enforcementTotal = enfRow?.cnt || 0;
      } catch { /* skip */ }

      const enfInPredicted = repeats.filter((r: any) => predGrid.has(`${r.lat},${r.lng}`)).length;

      const currentPeriod = await db.prepare(`
        SELECT COUNT(*) as cnt FROM calls_for_service
        WHERE created_at >= datetime('now', 'localtime', '-7 days')
      `).get() as any;
      const previousPeriod = await db.prepare(`
        SELECT COUNT(*) as cnt FROM calls_for_service
        WHERE created_at >= datetime('now', 'localtime', '-14 days')
          AND created_at < datetime('now', 'localtime', '-7 days')
      `).get() as any;

      const currentCalls = currentPeriod?.cnt || 0;
      const previousCalls = previousPeriod?.cnt || 0;
      const changePercent = previousCalls > 0 ? Math.round(((currentCalls - previousCalls) / previousCalls) * 100) : 0;

      let activeGeofences = 0;
      try {
        const geoRow = await db.prepare('SELECT COUNT(*) as cnt FROM geofences WHERE is_active = 1').get() as any;
        activeGeofences = geoRow?.cnt || 0;
      } catch { /* skip */ }

      const repeatCount = repeats.length;

      return c.json({
        overlapZones: { count: overlapLocations.length, locations: filterValidCoords(overlapLocations) },
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
    } catch {
      return c.json({ error: 'Internal server error', code: 'ANALYSIS_SUMMARY_ERROR' }, 500);
    }
  });

  app.route('/api/dispatch', api);
}
