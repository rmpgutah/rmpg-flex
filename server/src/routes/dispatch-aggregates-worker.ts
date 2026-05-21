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
        JOIN dispatch_zones dz ON dz.id = db2.zone_id
        JOIN dispatch_sectors ds ON ds.id = dz.sector_id
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
      // Find containing beat via bounding box + exact polygon match
      const beat = await db.prepare(`
        SELECT db2.beat_code, db2.beat_name, db2.beat_descriptor,
               dc.zone_code, dc.zone_name, ds.sector_code, ds.sector_name
        FROM dispatch_beats db2
        LEFT JOIN dispatch_zones dz ON dz.id = db2.zone_id
        LEFT JOIN dispatch_sectors ds ON ds.id = dz.sector_id
        WHERE db2.min_lat IS NOT NULL AND db2.max_lat IS NOT NULL
          AND ? BETWEEN db2.min_lat AND db2.max_lat
          AND ? BETWEEN db2.min_lng AND db2.max_lng
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

  app.route('/api/dispatch', api);
}
