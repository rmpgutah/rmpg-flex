import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { localNow } from '../utils/timeUtils';
import { broadcastDispatchUpdate } from '../utils/websocket';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// GET /api/map/geofences - List all geofences (active only by default, ?all=true for all)
router.get('/', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const showAll = req.query.all === 'true';
    // Fix 41: Search/filter by name on GET geofences
    const search = req.query.search as string | undefined;

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

    const rows = db.prepare(query).all(...params) as any[];

    // Fix 43: Return geofence with computed vertex count
    const enriched = rows.map((row: any) => {
      let vertex_count = 0;
      try {
        const coords = JSON.parse(row.polygon_coords || '[]');
        vertex_count = Array.isArray(coords) ? coords.length : 0;
      } catch { /* ignore */ }
      return { ...row, vertex_count };
    });

    // Fix 48: Structured response with metadata
    res.json(enriched);
  } catch (error: any) {
    console.error('[Geofences] list error:', error?.message || 'Unknown error');
    if (error?.message?.includes('no such table')) {
      res.json([]);
      return;
    }
    res.status(500).json({ error: 'Internal server error', code: 'GEOFENCE_LIST_ERROR' });
  }
});

// POST /api/map/geofences - Create a geofence
router.post('/', requireRole('admin', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, zone_type, polygon_coords, alert_on_enter, alert_on_exit, color } = req.body;

    // Fix 37: Validate geofence name length (max 100 chars)
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'name is required', code: 'MISSING_NAME' });
      return;
    }
    if (name.length > 100) {
      res.status(400).json({ error: 'name must be 100 characters or less', code: 'NAME_TOO_LONG' });
      return;
    }
    // Fix 38: Validate geofence color format (#hex)
    if (color !== undefined && typeof color === 'string' && !/^#[0-9a-fA-F]{3,8}$/.test(color)) {
      res.status(400).json({ error: 'color must be a valid hex color (e.g. #ef4444)', code: 'INVALID_COLOR' });
      return;
    }
    // Fix 45: Validate zone_type against enum
    const VALID_ZONE_TYPES = ['patrol', 'restricted', 'high_risk', 'school', 'hospital', 'government', 'custom', 'perimeter'];
    if (zone_type && typeof zone_type === 'string' && !VALID_ZONE_TYPES.includes(zone_type)) {
      res.status(400).json({ error: `zone_type must be one of: ${VALID_ZONE_TYPES.join(', ')}`, code: 'INVALID_ZONE_TYPE' });
      return;
    }

    if (!polygon_coords) {
      res.status(400).json({ error: 'polygon_coords is required' });
      return;
    }

    // Validate polygon_coords is valid JSON array of {lat, lng} with at least 3 points
    let coordsStr: string;
    let parsedCoords: any;
    if (typeof polygon_coords === 'string') {
      try {
        parsedCoords = JSON.parse(polygon_coords);
        coordsStr = polygon_coords;
      } catch {
        res.status(400).json({ error: 'polygon_coords must be valid JSON' });
        return;
      }
    } else {
      parsedCoords = polygon_coords;
      coordsStr = JSON.stringify(polygon_coords);
    }

    if (!Array.isArray(parsedCoords) || parsedCoords.length < 3) {
      res.status(400).json({ error: 'polygon_coords must be an array with at least 3 points' });
      return;
    }
    for (const pt of parsedCoords) {
      if (typeof pt !== 'object' || pt === null ||
          typeof pt.lat !== 'number' || typeof pt.lng !== 'number' ||
          !Number.isFinite(pt.lat) || !Number.isFinite(pt.lng)) {
        res.status(400).json({ error: 'Each point in polygon_coords must have numeric lat and lng' });
        return;
      }
    }

    const now = localNow();
    const result = db.prepare(`
      INSERT INTO geofences (name, zone_type, polygon_coords, alert_on_enter, alert_on_exit, color, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name.trim(),
      (typeof zone_type === 'string' && zone_type.length <= 50) ? zone_type : 'custom',
      coordsStr,
      alert_on_enter ? 1 : 0,
      alert_on_exit ? 1 : 0,
      (typeof color === 'string' && color.length <= 20) ? color : '#ef4444',
      req.user?.userId ?? null,
      now,
      now,
    );

    const newFence = db.prepare('SELECT * FROM geofences WHERE id = ?').get(result.lastInsertRowid) as any;

    // Fix 44: Audit logging on geofence CRUD
    auditLog(req, 'CREATE', 'geofence', Number(result.lastInsertRowid), `Created geofence "${name.trim()}" (zone_type: ${zone_type || 'custom'})`);

    broadcastDispatchUpdate({ action: 'geofence_created', geofence: newFence });

    // Fix 43: Return geofence with computed vertex count
    // Fix 48: Structured response
    res.json({
      success: true,
      id: Number(result.lastInsertRowid),
      geofence: { ...newFence, vertex_count: parsedCoords.length },
    });
  } catch (error: any) {
    console.error('[Geofences] create error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'GEOFENCE_CREATE_ERROR' });
  }
});

// PUT /api/map/geofences/:id - Update a geofence
router.put('/:id', requireRole('admin', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid geofence ID' });
      return;
    }

    const existing = db.prepare('SELECT * FROM geofences WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Geofence not found' });
      return;
    }

    const { name, zone_type, polygon_coords, alert_on_enter, alert_on_exit, color, is_active } = req.body;

    // Validate polygon_coords if provided
    let coordsStr: string | undefined;
    if (polygon_coords !== undefined) {
      if (typeof polygon_coords === 'string') {
        try {
          JSON.parse(polygon_coords);
          coordsStr = polygon_coords;
        } catch {
          res.status(400).json({ error: 'polygon_coords must be valid JSON' });
          return;
        }
      } else {
        coordsStr = JSON.stringify(polygon_coords);
      }
    }

    // Fix 37: Validate name length (max 100 chars)
    if (name !== undefined && (typeof name !== 'string' || name.length > 100)) {
      res.status(400).json({ error: 'name must be a string of 100 characters or less', code: 'NAME_TOO_LONG' });
      return;
    }
    // Fix 38: Validate color format
    if (color !== undefined && typeof color === 'string' && !/^#[0-9a-fA-F]{3,8}$/.test(color)) {
      res.status(400).json({ error: 'color must be a valid hex color', code: 'INVALID_COLOR' });
      return;
    }
    // Fix 45: Validate zone_type
    const VALID_ZONE_TYPES = ['patrol', 'restricted', 'high_risk', 'school', 'hospital', 'government', 'custom', 'perimeter'];
    if (zone_type !== undefined && typeof zone_type === 'string' && !VALID_ZONE_TYPES.includes(zone_type)) {
      res.status(400).json({ error: `zone_type must be one of: ${VALID_ZONE_TYPES.join(', ')}`, code: 'INVALID_ZONE_TYPE' });
      return;
    }

    const now = localNow();
    db.prepare(`
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

    const updated = db.prepare('SELECT * FROM geofences WHERE id = ?').get(id) as any;

    // Fix 44: Audit logging on geofence CRUD
    auditLog(req, 'UPDATE', 'geofence', id, `Updated geofence "${existing.name}" → "${updated?.name || existing.name}"`);

    broadcastDispatchUpdate({ action: 'geofence_updated', geofence: updated });

    // Fix 43: Return geofence with computed vertex count
    let vertex_count = 0;
    try {
      const coords = JSON.parse(updated?.polygon_coords || '[]');
      vertex_count = Array.isArray(coords) ? coords.length : 0;
    } catch { /* ignore */ }

    // Fix 42: updated_at timestamp is already set in the SQL above
    res.json({ success: true, geofence: { ...updated, vertex_count } });
  } catch (error: any) {
    console.error('[Geofences] update error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'GEOFENCE_UPDATE_ERROR' });
  }
});

// DELETE /api/map/geofences/:id - Delete a geofence
router.delete('/:id', requireRole('admin', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid geofence ID' });
      return;
    }

    const existing = db.prepare('SELECT * FROM geofences WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Geofence not found' });
      return;
    }

    db.prepare('DELETE FROM geofences WHERE id = ?').run(id);

    // Fix 44: Audit logging on geofence CRUD
    auditLog(req, 'DELETE', 'geofence', id, `Deleted geofence "${existing.name}" (zone_type: ${existing.zone_type || 'custom'})`);

    broadcastDispatchUpdate({ action: 'geofence_deleted', geofence_id: id });

    // Fix 79: Structured logging for map data mutations
    console.log(`[Geofences] Deleted geofence ${id} "${existing.name}" by user ${req.user?.userId}`);

    res.json({ success: true, deleted_id: id });
  } catch (error: any) {
    console.error('[Geofences] delete error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'GEOFENCE_DELETE_ERROR' });
  }
});

export default router;
