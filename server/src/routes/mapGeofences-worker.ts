// Map Geofences routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow } from '../worker-middleware/d1Helpers';
import { auditLog } from '../worker-middleware/auditLogger';

const VALID_ZONE_TYPES = ['patrol', 'restricted', 'high_risk', 'school', 'hospital', 'government', 'custom', 'perimeter'];

function enrichGeofence(row: any): any {
  let vertex_count = 0;
  try {
    const coords = JSON.parse(row.polygon_coords || '[]');
    vertex_count = Array.isArray(coords) ? coords.length : 0;
  } catch { /* ignore */ }
  return { ...row, vertex_count };
}

export function mountMapGeofencesRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/map/geofences - List all geofences
  api.get('/', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const showAll = c.req.query('all') === 'true';
      const search = c.req.query('search');

      let query: string;
      const params: any[] = [];

      if (search && typeof search === 'string' && search.length >= 1 && search.length <= 100) {
        const searchTerm = `%${search}%`;
        if (showAll) {
          query = 'SELECT * FROM geofences WHERE name LIKE ? ORDER BY created_at DESC LIMIT 500';
          params.push(searchTerm);
        } else {
          query = 'SELECT * FROM geofences WHERE is_active = 1 AND name LIKE ? ORDER BY created_at DESC LIMIT 500';
          params.push(searchTerm);
        }
      } else {
        query = showAll
          ? 'SELECT * FROM geofences ORDER BY created_at DESC LIMIT 500'
          : 'SELECT * FROM geofences WHERE is_active = 1 ORDER BY created_at DESC LIMIT 500';
      }

      const rows = await db.prepare(query).all(...params);
      const enriched = rows.map(enrichGeofence);

      return c.json(enriched);
    } catch (error: any) {
      if (error?.message?.includes('no such table')) {
        return c.json([]);
      }
      return c.json({ error: 'Internal server error', code: 'GEOFENCE_LIST_ERROR' }, 500);
    }
  });

  // POST /api/map/geofences - Create a geofence
  api.post('/', requireRole('admin', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { name, zone_type, polygon_coords, alert_on_enter, alert_on_exit, color } = body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return c.json({ error: 'name is required', code: 'MISSING_NAME' }, 400);
      }
      if (name.length > 100) {
        return c.json({ error: 'name must be 100 characters or less', code: 'NAME_TOO_LONG' }, 400);
      }
      if (color !== undefined && typeof color === 'string' && !/^#[0-9a-fA-F]{3,8}$/.test(color)) {
        return c.json({ error: 'color must be a valid hex color (e.g. #ef4444)', code: 'INVALID_COLOR' }, 400);
      }
      if (zone_type && typeof zone_type === 'string' && !VALID_ZONE_TYPES.includes(zone_type)) {
        return c.json({ error: `zone_type must be one of: ${VALID_ZONE_TYPES.join(', ')}`, code: 'INVALID_ZONE_TYPE' }, 400);
      }

      if (!polygon_coords) {
        return c.json({ error: 'polygon_coords is required', code: 'POLYGONCOORDS_IS_REQUIRED' }, 400);
      }

      let coordsStr: string;
      let parsedCoords: any;
      if (typeof polygon_coords === 'string') {
        try {
          parsedCoords = JSON.parse(polygon_coords);
          coordsStr = polygon_coords;
        } catch {
          return c.json({ error: 'polygon_coords must be valid JSON', code: 'POLYGONCOORDS_MUST_BE_VALID' }, 400);
        }
      } else {
        parsedCoords = polygon_coords;
        coordsStr = JSON.stringify(polygon_coords);
      }

      if (!Array.isArray(parsedCoords) || parsedCoords.length < 3) {
        return c.json({ error: 'polygon_coords must be an array with at least 3 points', code: 'POLYGONCOORDS_MUST_BE_AN' }, 400);
      }
      for (const pt of parsedCoords) {
        if (typeof pt !== 'object' || pt === null ||
            typeof pt.lat !== 'number' || typeof pt.lng !== 'number' ||
            !Number.isFinite(pt.lat) || !Number.isFinite(pt.lng)) {
          return c.json({ error: 'Each point in polygon_coords must have numeric lat and lng', code: 'EACH_POINT_IN_POLYGONCOORDS' }, 400);
        }
      }

      const now = localNow();
      const result = await db.prepare(`
        INSERT INTO geofences (name, zone_type, polygon_coords, alert_on_enter, alert_on_exit, color, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name.trim(),
        (typeof zone_type === 'string' && zone_type.length <= 50) ? zone_type : 'custom',
        coordsStr,
        alert_on_enter ? 1 : 0,
        alert_on_exit ? 1 : 0,
        (typeof color === 'string' && color.length <= 20) ? color : '#ef4444',
        c.get('user')?.userId ?? null,
        now,
        now,
      );

      const newFence = await db.prepare('SELECT * FROM geofences WHERE id = ?').get(Number(result.meta.last_row_id)) as any;
      const id = Number(result.meta.last_row_id);

      await auditLog(db, c, 'CREATE', 'geofence', id, `Created geofence "${name.trim()}" (zone_type: ${zone_type || 'custom'})`);

      return c.json({
        success: true,
        id,
        geofence: { ...newFence, vertex_count: parsedCoords.length },
      });
    } catch {
      return c.json({ error: 'Internal server error', code: 'GEOFENCE_CREATE_ERROR' }, 500);
    }
  });

  // PUT /api/map/geofences/:id - Update a geofence
  api.put('/:id', requireRole('admin', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) {
        return c.json({ error: 'Invalid geofence ID', code: 'INVALID_GEOFENCE_ID' }, 400);
      }

      const existing = await db.prepare('SELECT * FROM geofences WHERE id = ?').get(id) as any;
      if (!existing) {
        return c.json({ error: 'Geofence not found', code: 'GEOFENCE_NOT_FOUND' }, 404);
      }

      const body = await c.req.json();
      const { name, zone_type, polygon_coords, alert_on_enter, alert_on_exit, color, is_active } = body;

      let coordsStr: string | undefined;
      if (polygon_coords !== undefined) {
        if (typeof polygon_coords === 'string') {
          try {
            JSON.parse(polygon_coords);
            coordsStr = polygon_coords;
          } catch {
            return c.json({ error: 'polygon_coords must be valid JSON', code: 'POLYGONCOORDS_MUST_BE_VALID' }, 400);
          }
        } else {
          coordsStr = JSON.stringify(polygon_coords);
        }
      }

      if (name !== undefined && (typeof name !== 'string' || name.length > 100)) {
        return c.json({ error: 'name must be a string of 100 characters or less', code: 'NAME_TOO_LONG' }, 400);
      }
      if (color !== undefined && typeof color === 'string' && !/^#[0-9a-fA-F]{3,8}$/.test(color)) {
        return c.json({ error: 'color must be a valid hex color', code: 'INVALID_COLOR' }, 400);
      }
      if (zone_type !== undefined && typeof zone_type === 'string' && !VALID_ZONE_TYPES.includes(zone_type)) {
        return c.json({ error: `zone_type must be one of: ${VALID_ZONE_TYPES.join(', ')}`, code: 'INVALID_ZONE_TYPE' }, 400);
      }

      const now = localNow();
      await db.prepare(`
        UPDATE geofences SET
          name = COALESCE(?, name),
          zone_type = COALESCE(?, zone_type),
          polygon_coords = COALESCE(?, polygon_coords),
          alert_on_enter = COALESCE(?, alert_on_enter),
          alert_on_exit = COALESCE(?, alert_on_exit),
          color = COALESCE(?, color),
          is_active = COALESCE(?, is_active),
          updated_at = ?
        WHERE id = ?
      `).run(
        name !== undefined ? name.trim() : null,
        (zone_type !== undefined && typeof zone_type === 'string') ? zone_type : null,
        coordsStr ?? null,
        alert_on_enter !== undefined ? (alert_on_enter ? 1 : 0) : null,
        alert_on_exit !== undefined ? (alert_on_exit ? 1 : 0) : null,
        (color !== undefined && typeof color === 'string') ? color : null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        now,
        id,
      );

      const updated = await db.prepare('SELECT * FROM geofences WHERE id = ?').get(id) as any;

      await auditLog(db, c, 'UPDATE', 'geofence', id, `Updated geofence "${existing.name}" → "${updated?.name || existing.name}"`);

      let vertex_count = 0;
      try {
        const coords = JSON.parse(updated?.polygon_coords || '[]');
        vertex_count = Array.isArray(coords) ? coords.length : 0;
      } catch { /* ignore */ }

      return c.json({ success: true, geofence: { ...updated, vertex_count } });
    } catch {
      return c.json({ error: 'Internal server error', code: 'GEOFENCE_UPDATE_ERROR' }, 500);
    }
  });

  // DELETE /api/map/geofences/:id - Delete a geofence
  api.delete('/:id', requireRole('admin', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) {
        return c.json({ error: 'Invalid geofence ID', code: 'INVALID_GEOFENCE_ID' }, 400);
      }

      const existing = await db.prepare('SELECT * FROM geofences WHERE id = ?').get(id) as any;
      if (!existing) {
        return c.json({ error: 'Geofence not found', code: 'GEOFENCE_NOT_FOUND' }, 404);
      }

      await db.prepare('DELETE FROM geofences WHERE id = ?').run(id);

      await auditLog(db, c, 'DELETE', 'geofence', id, `Deleted geofence "${existing.name}" (zone_type: ${existing.zone_type || 'custom'})`);

      return c.json({ success: true, deleted_id: id });
    } catch {
      return c.json({ error: 'Internal server error', code: 'GEOFENCE_DELETE_ERROR' }, 500);
    }
  });

  app.route('/api/map/geofences', api);
}
