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

    const rows = showAll
      ? db.prepare('SELECT * FROM geofences ORDER BY created_at DESC').all()
      : db.prepare('SELECT * FROM geofences WHERE is_active = 1 ORDER BY created_at DESC').all();

    res.json(rows);
  } catch (error: any) {
    console.error('[Geofences] list error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/map/geofences - Create a geofence
router.post('/', requireRole('admin', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, zone_type, polygon_coords, alert_on_enter, alert_on_exit, color } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (name.length > 200) {
      res.status(400).json({ error: 'name must be 200 characters or less' });
      return;
    }

    if (!polygon_coords) {
      res.status(400).json({ error: 'polygon_coords is required' });
      return;
    }

    // Validate polygon_coords is valid JSON array
    let coordsStr: string;
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
      req.user?.fullName || req.user?.username || null,
      now,
      now,
    );

    const newFence = db.prepare('SELECT * FROM geofences WHERE id = ?').get(result.lastInsertRowid);

    auditLog(req, 'CREATE', 'geofence', Number(result.lastInsertRowid), `Created geofence "${name.trim()}"`);

    broadcastDispatchUpdate({ action: 'geofence_created', geofence: newFence });

    res.json({ success: true, id: result.lastInsertRowid, geofence: newFence });
  } catch (error: any) {
    console.error('[Geofences] create error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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

    if (name !== undefined && (typeof name !== 'string' || name.length > 200)) {
      res.status(400).json({ error: 'name must be a string of 200 characters or less' });
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

    const updated = db.prepare('SELECT * FROM geofences WHERE id = ?').get(id);

    auditLog(req, 'UPDATE', 'geofence', id, `Updated geofence "${existing.name}"`);

    broadcastDispatchUpdate({ action: 'geofence_updated', geofence: updated });

    res.json({ success: true, geofence: updated });
  } catch (error: any) {
    console.error('[Geofences] update error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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

    auditLog(req, 'DELETE', 'geofence', id, `Deleted geofence "${existing.name}"`);

    broadcastDispatchUpdate({ action: 'geofence_deleted', geofence_id: id });

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Geofences] delete error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
