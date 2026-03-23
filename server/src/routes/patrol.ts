import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcastPatrolUpdate } from '../utils/websocket';
import { sendCsv } from '../utils/csvExport';
import { localNow, localToday } from '../utils/timeUtils';

const router = Router();

router.use(authenticateToken);

// GET /api/patrol/checkpoints - List all checkpoints
router.get('/checkpoints', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const checkpoints = db.prepare(`
      SELECT
        pc.*,
        p.name as property_name
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      ORDER BY pc.created_at DESC
      LIMIT 1000
    `).all();

    res.json(checkpoints);
  } catch (error) {
    console.error('Error fetching checkpoints:', error);
    res.status(500).json({ error: 'Failed to fetch checkpoints', code: 'FAILED_TO_FETCH_CHECKPOINTS' });
  }
});

// GET /api/patrol/checkpoints/property/:propertyId - Checkpoints for a specific property
router.get('/checkpoints/property/:propertyId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const propertyId = parseInt(req.params.propertyId, 10);
    if (isNaN(propertyId)) {
      res.status(400).json({ error: 'Invalid property ID', code: 'INVALID_PROPERTY_ID' });
      return;
    }
    const checkpoints = db.prepare(`
      SELECT
        pc.*,
        p.name as property_name
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE pc.property_id = ?
      ORDER BY pc.name
      LIMIT 500
    `).all(propertyId);

    res.json(checkpoints);
  } catch (error) {
    console.error('Error fetching property checkpoints:', error);
    res.status(500).json({ error: 'Failed to fetch property checkpoints', code: 'FAILED_TO_FETCH_PROPERTY' });
  }
});

// POST /api/patrol/checkpoints - Create checkpoint
router.post('/checkpoints', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const { property_id, name, description, latitude, longitude, scan_required_interval_minutes, is_active } = req.body;

    if (!property_id || !name || !scan_required_interval_minutes) {
      res.status(400).json({ error: 'Missing required fields: property_id, name, scan_required_interval_minutes', code: 'MISSING_REQUIRED_FIELDS_PROPERTYID' });
      return;
    }

    const db = getDb();
    const qr_code = crypto.randomUUID();

    const result = db.prepare(`
      INSERT INTO patrol_checkpoints (
        property_id, name, description, qr_code, latitude, longitude,
        scan_required_interval_minutes, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      property_id,
      name,
      description || null,
      qr_code,
      latitude || null,
      longitude || null,
      scan_required_interval_minutes,
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
      localNow()
    );

    const checkpoint = db.prepare(`
      SELECT pc.*, p.name as property_name
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE pc.id = ?
    `).get(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'checkpoint_created', 'patrol_checkpoint', ?, ?, ?, ?)
    `).run(
      req.user!.userId,
      result.lastInsertRowid,
      `Created checkpoint: ${name}`,
      req.ip || 'unknown',
      localNow()
    );

    res.status(201).json(checkpoint);
  } catch (error) {
    console.error('Error creating checkpoint:', error);
    res.status(500).json({ error: 'Failed to create checkpoint', code: 'FAILED_TO_CREATE_CHECKPOINT' });
  }
});

// PUT /api/patrol/checkpoints/:id - Update checkpoint
router.put('/checkpoints/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { property_id, name, description, latitude, longitude, scan_required_interval_minutes, is_active } = req.body;

    const db = getDb();

    const existing = db.prepare('SELECT * FROM patrol_checkpoints WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Checkpoint not found', code: 'CHECKPOINT_NOT_FOUND' });
      return;
    }

    // Build dynamic SET clause — only update fields explicitly provided
    const cpFields: string[] = [];
    const cpValues: any[] = [];
    const cpBodyKeys = Object.keys(req.body);

    const cpFieldMap: Record<string, (v: any) => any> = {
      property_id: v => v ?? null, name: v => v ?? null, description: v => v ?? null,
      latitude: v => v ?? null, longitude: v => v ?? null,
      scan_required_interval_minutes: v => v ?? null,
      is_active: v => v ? 1 : 0,
    };

    for (const [key, transform] of Object.entries(cpFieldMap)) {
      if (cpBodyKeys.includes(key)) {
        cpFields.push(`${key} = ?`);
        cpValues.push(transform(req.body[key]));
      }
    }

    if (cpFields.length > 0) {
      cpValues.push(id);
      db.prepare(`UPDATE patrol_checkpoints SET ${cpFields.join(', ')} WHERE id = ?`).run(...cpValues);
    }

    // Activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'checkpoint_updated', 'patrol_checkpoint', ?, ?, ?)
    `).run(req.user!.userId, id, `Updated checkpoint: ${existing.name}`, req.ip || 'unknown');

    const updated = db.prepare(`
      SELECT pc.*, p.name as property_name
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE pc.id = ?
    `).get(id);

    broadcastPatrolUpdate({ type: 'checkpoint_updated', id: parseInt(id) });
    res.json({ data: updated });
  } catch (error) {
    console.error('Error updating checkpoint:', error);
    res.status(500).json({ error: 'Failed to update checkpoint', code: 'UPDATE_CHECKPOINT_ERROR' });
  }
});

// DELETE /api/patrol/checkpoints/:id - Delete checkpoint
router.delete('/checkpoints/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const existing = db.prepare('SELECT * FROM patrol_checkpoints WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Checkpoint not found', code: 'CHECKPOINT_NOT_FOUND' });
      return;
    }

    db.prepare('DELETE FROM patrol_checkpoints WHERE id = ?').run(id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'checkpoint_deleted', 'patrol_checkpoint', ?, ?, ?, ?)
    `).run(
      req.user!.userId,
      id,
      `Deleted checkpoint: ${existing.name}`,
      req.ip || 'unknown',
      localNow()
    );

    res.json({ message: 'Checkpoint deleted successfully' });
  } catch (error) {
    console.error('Error deleting checkpoint:', error);
    res.status(500).json({ error: 'Failed to delete checkpoint', code: 'FAILED_TO_DELETE_CHECKPOINT' });
  }
});

// POST /api/patrol/checkpoints/:id/archive
router.post('/checkpoints/:id/archive', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const checkpoint = db.prepare('SELECT * FROM patrol_checkpoints WHERE id = ?').get(req.params.id) as any;
    if (!checkpoint) { res.status(404).json({ error: 'Checkpoint not found', code: 'CHECKPOINT_NOT_FOUND' }); return; }
    if (checkpoint.archived_at) { res.status(400).json({ error: 'Checkpoint is already archived', code: 'CHECKPOINT_IS_ALREADY_ARCHIVED' }); return; }

    const now = localNow();
    db.prepare('UPDATE patrol_checkpoints SET archived_at = ? WHERE id = ?').run(now, checkpoint.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'checkpoint_archived', 'patrol_checkpoint', ?, ?, ?)`).run(
      req.user!.userId, checkpoint.id, `Archived checkpoint: ${checkpoint.name}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT pc.*, p.name as property_name FROM patrol_checkpoints pc LEFT JOIN properties p ON pc.property_id = p.id WHERE pc.id = ?').get(checkpoint.id);
    broadcastPatrolUpdate({ type: 'checkpoint_archived', id: checkpoint.id });
    res.json({ data: updated });
  } catch (error: any) {
    console.error('Archive checkpoint error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'ARCHIVE_CHECKPOINT_ERROR' });
  }
});

// POST /api/patrol/checkpoints/:id/unarchive
router.post('/checkpoints/:id/unarchive', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const checkpoint = db.prepare('SELECT * FROM patrol_checkpoints WHERE id = ?').get(req.params.id) as any;
    if (!checkpoint) { res.status(404).json({ error: 'Checkpoint not found', code: 'CHECKPOINT_NOT_FOUND' }); return; }
    if (!checkpoint.archived_at) { res.status(400).json({ error: 'Checkpoint is not archived', code: 'CHECKPOINT_IS_NOT_ARCHIVED' }); return; }

    db.prepare('UPDATE patrol_checkpoints SET archived_at = NULL WHERE id = ?').run(checkpoint.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'checkpoint_unarchived', 'patrol_checkpoint', ?, ?, ?)`).run(
      req.user!.userId, checkpoint.id, `Unarchived checkpoint: ${checkpoint.name}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT pc.*, p.name as property_name FROM patrol_checkpoints pc LEFT JOIN properties p ON pc.property_id = p.id WHERE pc.id = ?').get(checkpoint.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Unarchive checkpoint error:', error);
    res.status(500).json({ error: 'Failed to unarchive checkpoint', code: 'UNARCHIVE_CHECKPOINT_ERROR' });
  }
});

// POST /api/patrol/scan - Record a scan
router.post('/scan', (req: Request, res: Response) => {
  try {
    const { qr_code, latitude, longitude, notes } = req.body;

    if (!qr_code) {
      res.status(400).json({ error: 'Missing required field: qr_code', code: 'MISSING_REQUIRED_FIELD_QRCODE' });
      return;
    }

    const db = getDb();

    const checkpoint = db.prepare('SELECT * FROM patrol_checkpoints WHERE qr_code = ? AND is_active = 1').get(qr_code) as any;

    if (!checkpoint) {
      res.status(404).json({ error: 'Invalid or inactive checkpoint', code: 'INVALID_OR_INACTIVE_CHECKPOINT' });
      return;
    }

    // Get last scan for this checkpoint
    const lastScan = db.prepare(`
      SELECT * FROM patrol_scans
      WHERE checkpoint_id = ?
      ORDER BY scanned_at DESC
      LIMIT 1
    `).get(checkpoint.id) as any;

    // Determine status based on interval
    let status = 'on_time';
    if (lastScan) {
      const lastScanTime = new Date(lastScan.scanned_at).getTime();
      const now = Date.now();
      const intervalMs = checkpoint.scan_required_interval_minutes * 60 * 1000;
      const timeSinceLastScan = now - lastScanTime;

      if (timeSinceLastScan > intervalMs) {
        status = 'late';
      }
    }

    const result = db.prepare(`
      INSERT INTO patrol_scans (
        checkpoint_id, officer_id, scanned_at, latitude, longitude, notes, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      checkpoint.id,
      req.user!.userId,
      localNow(),
      latitude || null,
      longitude || null,
      notes || null,
      status
    );

    const scan = db.prepare('SELECT * FROM patrol_scans WHERE id = ?').get(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'patrol_scan', 'patrol_checkpoint', ?, ?, ?, ?)
    `).run(
      req.user!.userId,
      checkpoint.id,
      `Scanned checkpoint: ${checkpoint.name} (${status})`,
      req.ip || 'unknown',
      localNow()
    );

    broadcastPatrolUpdate({ type: 'patrol_scan', checkpoint_id: checkpoint.id, checkpoint_name: checkpoint.name, status });
    res.status(201).json({ data: { ...(scan as any), checkpoint_name: checkpoint.name, status } });
  } catch (error) {
    console.error('Error recording scan:', error);
    res.status(500).json({ error: 'Failed to record scan', code: 'SCAN_ERROR' });
  }
});

// GET /api/patrol/scans/export - Export patrol scans as CSV
router.get('/scans/export', (req: Request, res: Response) => {
  try {
    const { checkpointId, officerId, startDate, endDate } = req.query;

    const db = getDb();
    const conditions: string[] = [];
    const params: any[] = [];

    if (checkpointId) {
      conditions.push('ps.checkpoint_id = ?');
      params.push(checkpointId);
    }
    if (officerId) {
      conditions.push('ps.officer_id = ?');
      params.push(officerId);
    }
    if (startDate) {
      conditions.push('ps.scanned_at >= ?');
      params.push(startDate);
    }
    if (endDate) {
      conditions.push('ps.scanned_at <= ?');
      params.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT pc.name as checkpoint_name, u.full_name as officer_name,
        ps.scanned_at, ps.status, ps.notes
      FROM patrol_scans ps
      LEFT JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      LEFT JOIN users u ON ps.officer_id = u.id
      ${whereClause}
      ORDER BY ps.scanned_at DESC
      LIMIT 5000
    `).all(...params);

    sendCsv(res, 'patrol_scans_export.csv', [
      { key: 'checkpoint_name', header: 'Checkpoint Name' },
      { key: 'officer_name', header: 'Officer Name' },
      { key: 'scanned_at', header: 'Scanned At' },
      { key: 'status', header: 'Status' },
      { key: 'notes', header: 'Notes' },
    ], rows);
  } catch (error: any) {
    console.error('Export patrol scans error:', error);
    res.status(500).json({ error: 'Failed to export patrol scans', code: 'EXPORT_PATROL_SCANS_ERROR' });
  }
});

// GET /api/patrol/scans - List recent scans
router.get('/scans', (req: Request, res: Response) => {
  try {
    const { checkpointId, officerId, startDate, endDate, limit = '100' } = req.query;

    const db = getDb();
    const conditions: string[] = [];
    const params: any[] = [];

    if (checkpointId) {
      conditions.push('ps.checkpoint_id = ?');
      params.push(checkpointId);
    }

    if (officerId) {
      conditions.push('ps.officer_id = ?');
      params.push(officerId);
    }

    if (startDate) {
      conditions.push('ps.scanned_at >= ?');
      params.push(startDate);
    }

    if (endDate) {
      conditions.push('ps.scanned_at <= ?');
      params.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const scans = db.prepare(`
      SELECT
        ps.*,
        pc.name as checkpoint_name,
        p.name as property_name,
        u.full_name as officer_name
      FROM patrol_scans ps
      LEFT JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      LEFT JOIN properties p ON pc.property_id = p.id
      LEFT JOIN users u ON ps.officer_id = u.id
      ${whereClause}
      ORDER BY ps.scanned_at DESC
      LIMIT ?
    `).all(...params, parseInt(limit as string));

    res.json(scans);
  } catch (error) {
    console.error('Error fetching scans:', error);
    res.status(500).json({ error: 'Failed to fetch scans', code: 'FAILED_TO_FETCH_SCANS' });
  }
});

// GET /api/patrol/compliance - Patrol compliance stats
router.get('/compliance', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const checkpoints = db.prepare(`
      SELECT
        pc.*,
        p.name as property_name
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE pc.is_active = 1
      ORDER BY p.name, pc.name
    
      LIMIT 1000
    `).all() as any[];

    const compliance = checkpoints.map((checkpoint) => {
      const todayScans = db.prepare(`
        SELECT COUNT(*) as count
        FROM patrol_scans
        WHERE checkpoint_id = ?
        AND date(scanned_at) = date('now')
      `).get(checkpoint.id) as any;

      const lastScan = db.prepare(`
        SELECT scanned_at
        FROM patrol_scans
        WHERE checkpoint_id = ?
        ORDER BY scanned_at DESC
        LIMIT 1
      `).get(checkpoint.id) as any;

      const complianceStats = db.prepare(`
        SELECT
          COUNT(*) as total_scans,
          SUM(CASE WHEN status = 'on_time' THEN 1 ELSE 0 END) as on_time_scans
        FROM patrol_scans
        WHERE checkpoint_id = ?
        AND scanned_at >= ?
      `).get(checkpoint.id, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) as any;

      const complianceRate = complianceStats.total_scans > 0
        ? (complianceStats.on_time_scans / complianceStats.total_scans) * 100
        : 0;

      let nextScanDue = null;
      if (lastScan) {
        const lastScanTime = new Date(lastScan.scanned_at);
        const nextDue = new Date(lastScanTime.getTime() + checkpoint.scan_required_interval_minutes * 60 * 1000);
        nextScanDue = nextDue.toISOString();
      }

      return {
        checkpoint_id: checkpoint.id,
        checkpoint_name: checkpoint.name,
        property_name: checkpoint.property_name,
        scans_today: todayScans.count,
        last_scan_time: lastScan ? lastScan.scanned_at : null,
        compliance_rate: Math.round(complianceRate * 10) / 10,
        next_scan_due: nextScanDue,
        scan_interval_minutes: checkpoint.scan_required_interval_minutes
      };
    });

    res.json(compliance);
  } catch (error) {
    console.error('Error fetching compliance stats:', error);
    res.status(500).json({ error: 'Failed to fetch compliance stats', code: 'FAILED_TO_FETCH_COMPLIANCE' });
  }
});

// GET /api/patrol/checkpoints/map - Checkpoint data for map overlay with last scan info
router.get('/checkpoints/map', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT pc.id, pc.name, pc.latitude, pc.longitude, pc.property_id, pc.sequence_order,
             pc.scan_required_interval_minutes,
             ps.scanned_at AS last_scanned, u.full_name AS scanned_by_name, p.name AS property_name
      FROM patrol_checkpoints pc
      LEFT JOIN (
        SELECT checkpoint_id, MAX(scanned_at) AS scanned_at, officer_id
        FROM patrol_scans GROUP BY checkpoint_id
      ) ps ON ps.checkpoint_id = pc.id
      LEFT JOIN users u ON u.id = ps.officer_id
      LEFT JOIN properties p ON p.id = pc.property_id
      WHERE pc.is_active = 1 AND pc.latitude IS NOT NULL AND pc.longitude IS NOT NULL
      ORDER BY pc.property_id, pc.sequence_order
    `).all();

    res.json(rows);
  } catch (error) {
    console.error('Error fetching checkpoint map data:', error);
    res.status(500).json({ error: 'Failed to fetch checkpoint map data', code: 'FAILED_TO_FETCH_CHECKPOINT' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 1: Patrol Route Optimization (nearest-neighbor)
// ════════════════════════════════════════════════════════════

router.get('/optimize-route', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { property_id, start_lat, start_lng } = req.query;

    let where = 'WHERE pc.is_active = 1 AND pc.latitude IS NOT NULL AND pc.longitude IS NOT NULL';
    const params: any[] = [];
    if (property_id) { where += ' AND pc.property_id = ?'; params.push(property_id); }

    const checkpoints = db.prepare(`
      SELECT pc.id, pc.name, pc.latitude, pc.longitude, pc.property_id, p.name as property_name
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      ${where}
    
      LIMIT 1000
    `).all(...params) as any[];

    if (checkpoints.length === 0) {
      res.json({ optimized_order: [], total_distance_km: 0 });
      return;
    }

    // Haversine distance in km
    function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // Nearest-neighbor algorithm
    const startLat = parseFloat(start_lat as string) || checkpoints[0].latitude;
    const startLng = parseFloat(start_lng as string) || checkpoints[0].longitude;
    const visited = new Set<number>();
    const order: any[] = [];
    let currentLat = startLat;
    let currentLng = startLng;
    let totalDist = 0;

    while (visited.size < checkpoints.length) {
      let nearest: any = null;
      let nearestDist = Infinity;
      for (const cp of checkpoints) {
        if (visited.has(cp.id)) continue;
        const dist = haversine(currentLat, currentLng, cp.latitude, cp.longitude);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = cp;
        }
      }
      if (!nearest) break;
      visited.add(nearest.id);
      order.push({ ...nearest, distance_from_previous_km: Math.round(nearestDist * 100) / 100 });
      totalDist += nearestDist;
      currentLat = nearest.latitude;
      currentLng = nearest.longitude;
    }

    res.json({ optimized_order: order, total_distance_km: Math.round(totalDist * 100) / 100 });
  } catch (error) {
    console.error('Error optimizing route:', error);
    res.status(500).json({ error: 'Failed to optimize route', code: 'FAILED_TO_OPTIMIZE_ROUTE' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 2: Patrol Log Auto-generation
// ════════════════════════════════════════════════════════════

router.get('/log/generate', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, date } = req.query;
    const targetDate = date as string || localToday();
    const officerId = officer_id ? parseInt(officer_id as string, 10) : req.user!.userId;

    const officer = db.prepare('SELECT full_name, badge_number FROM users WHERE id = ?').get(officerId) as any;

    const dayScans = db.prepare(`
      SELECT ps.*, pc.name as checkpoint_name, p.name as property_name,
             pc.latitude as cp_lat, pc.longitude as cp_lng
      FROM patrol_scans ps
      LEFT JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE ps.officer_id = ? AND DATE(ps.scanned_at) = ?
      ORDER BY ps.scanned_at ASC
    
      LIMIT 1000
    `).all(officerId, targetDate) as any[];

    // Calculate patrol stats
    let totalTimeMinutes = 0;
    const checkpointTimes: { checkpoint: string; property: string; time: string; status: string; notes: string; time_since_prev_min: number | null }[] = [];
    for (let i = 0; i < dayScans.length; i++) {
      const scan = dayScans[i];
      let timeSincePrev: number | null = null;
      if (i > 0) {
        const prev = new Date(dayScans[i - 1].scanned_at).getTime();
        const curr = new Date(scan.scanned_at).getTime();
        timeSincePrev = Math.round((curr - prev) / 60000);
        totalTimeMinutes += timeSincePrev;
      }
      checkpointTimes.push({
        checkpoint: scan.checkpoint_name,
        property: scan.property_name || '',
        time: scan.scanned_at,
        status: scan.status,
        notes: scan.notes || '',
        time_since_prev_min: timeSincePrev,
      });
    }

    const startTime = dayScans.length > 0 ? dayScans[0].scanned_at : null;
    const endTime = dayScans.length > 0 ? dayScans[dayScans.length - 1].scanned_at : null;
    const onTimeCount = dayScans.filter((s: any) => s.status === 'on_time').length;
    const lateCount = dayScans.filter((s: any) => s.status === 'late').length;

    res.json({
      officer_name: officer?.full_name || 'Unknown',
      badge_number: officer?.badge_number || '',
      date: targetDate,
      total_checkpoints_scanned: dayScans.length,
      total_time_minutes: totalTimeMinutes,
      start_time: startTime,
      end_time: endTime,
      on_time: onTimeCount,
      late: lateCount,
      compliance_rate: dayScans.length > 0 ? Math.round((onTimeCount / dayScans.length) * 100) : 0,
      entries: checkpointTimes,
    });
  } catch (error) {
    console.error('Error generating patrol log:', error);
    res.status(500).json({ error: 'Failed to generate patrol log', code: 'FAILED_TO_GENERATE_PATROL' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 3: Incident Report from Scan
// ════════════════════════════════════════════════════════════

router.post('/scan/:scanId/create-incident', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const scan = db.prepare(`
      SELECT ps.*, pc.name as checkpoint_name, pc.property_id, pc.latitude, pc.longitude,
             p.name as property_name
      FROM patrol_scans ps
      LEFT JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE ps.id = ?
    `).get(req.params.scanId) as any;

    if (!scan) {
      res.status(404).json({ error: 'Scan not found', code: 'SCAN_NOT_FOUND' });
      return;
    }

    const { incident_type, description, priority } = req.body;

    // Generate incident number
    const yy = String(new Date().getFullYear()).slice(-2);
    const prefix = `INC-${yy}-`;
    const last = db.prepare(`SELECT incident_number FROM incidents WHERE incident_number LIKE ? ORDER BY id DESC LIMIT 1`).get(`${prefix}%`) as any;
    let seq = 1;
    if (last) { const m = last.incident_number.match(/INC-\d{2}-(\d{5})/); if (m) seq = parseInt(m[1], 10) + 1; }
    const incidentNumber = `${prefix}${String(seq).padStart(5, '0')}`;

    const now = localNow();
    const info = db.prepare(`
      INSERT INTO incidents (
        incident_number, incident_type, status, priority, description,
        location, latitude, longitude, reporting_officer_id, property_id,
        occurred_at, reported_at, created_at, updated_at
      ) VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      incidentNumber,
      incident_type || 'patrol_observation',
      priority || 'low',
      description || `Incident observed during patrol scan at ${scan.checkpoint_name}`,
      scan.property_name || scan.checkpoint_name,
      scan.latitude, scan.longitude,
      req.user!.userId,
      scan.property_id || null,
      scan.scanned_at, now, now, now
    );

    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(info.lastInsertRowid);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'incident_from_patrol_scan', 'incident', ?, ?, ?, ?)
    `).run(req.user!.userId, info.lastInsertRowid, `Created incident ${incidentNumber} from patrol scan #${req.params.scanId}`, req.ip || 'unknown', now);

    res.status(201).json(incident);
  } catch (error) {
    console.error('Error creating incident from scan:', error);
    res.status(500).json({ error: 'Failed to create incident', code: 'FAILED_TO_CREATE_INCIDENT' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 4: Patrol Coverage Heat Map data
// ════════════════════════════════════════════════════════════

router.get('/coverage-heatmap', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '7' } = req.query;
    const daysNum = Math.min(90, Math.max(1, parseInt(days as string, 10) || 7));
    const cutoff = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000).toISOString();

    const points = db.prepare(`
      SELECT ps.latitude, ps.longitude, COUNT(*) as weight,
             pc.name as checkpoint_name, p.name as property_name,
             MAX(ps.scanned_at) as last_scan
      FROM patrol_scans ps
      LEFT JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE ps.latitude IS NOT NULL AND ps.longitude IS NOT NULL
        AND ps.scanned_at >= ?
      GROUP BY ROUND(ps.latitude, 4), ROUND(ps.longitude, 4)
      ORDER BY weight DESC
    `).all(cutoff);

    // Also get checkpoints with no scans in the period (coverage gaps)
    const unpatrolled = db.prepare(`
      SELECT pc.id, pc.name, pc.latitude, pc.longitude, p.name as property_name
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE pc.is_active = 1 AND pc.latitude IS NOT NULL
        AND pc.id NOT IN (
          SELECT DISTINCT checkpoint_id FROM patrol_scans WHERE scanned_at >= ?
        )
    
      LIMIT 1000
    `).all(cutoff);

    res.json({ heatmap_points: points, unpatrolled_checkpoints: unpatrolled, days: daysNum });
  } catch (error) {
    console.error('Error fetching coverage heatmap:', error);
    res.status(500).json({ error: 'Failed to fetch coverage data', code: 'FAILED_TO_FETCH_COVERAGE' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 5: Guard Tour Verification (supervisor sign-off)
// ════════════════════════════════════════════════════════════

router.post('/verify-tour', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, date, notes, status } = req.body;

    if (!officer_id || !date) {
      res.status(400).json({ error: 'officer_id and date are required', code: 'OFFICERID_AND_DATE_ARE' });
      return;
    }

    const now = localNow();

    // Check if verification already exists
    const existing = db.prepare(
      'SELECT id FROM patrol_tour_verifications WHERE officer_id = ? AND tour_date = ?'
    ).get(officer_id, date) as any;

    if (existing) {
      db.prepare(`
        UPDATE patrol_tour_verifications
        SET verified_by = ?, verified_at = ?, status = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(req.user!.userId, now, status || 'approved', notes || '', now, existing.id);
      const updated = db.prepare('SELECT * FROM patrol_tour_verifications WHERE id = ?').get(existing.id);
      res.json(updated);
    } else {
      // Get scan stats for this tour
      const scanStats = db.prepare(`
        SELECT COUNT(*) as total, SUM(CASE WHEN status = 'on_time' THEN 1 ELSE 0 END) as on_time
        FROM patrol_scans WHERE officer_id = ? AND DATE(scanned_at) = ?
      `).get(officer_id, date) as any;

      const info = db.prepare(`
        INSERT INTO patrol_tour_verifications (
          officer_id, tour_date, verified_by, verified_at, status, notes,
          total_scans, on_time_scans, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(officer_id, date, req.user!.userId, now, status || 'approved', notes || '',
        scanStats?.total || 0, scanStats?.on_time || 0, now, now);

      const verification = db.prepare('SELECT * FROM patrol_tour_verifications WHERE id = ?').get(info.lastInsertRowid);
      res.status(201).json(verification);
    }

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'patrol_tour_verified', 'patrol_verification', ?, ?, ?, ?)
    `).run(req.user!.userId, officer_id, `Tour verification for ${date}: ${status || 'approved'}`, req.ip || 'unknown', now);

    res.status(200);
  } catch (error) {
    console.error('Error verifying tour:', error);
    res.status(500).json({ error: 'Failed to verify tour', code: 'FAILED_TO_VERIFY_TOUR' });
  }
});

router.get('/verifications', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, start_date, end_date } = req.query;
    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (officer_id) { where += ' AND ptv.officer_id = ?'; params.push(officer_id); }
    if (start_date) { where += ' AND ptv.tour_date >= ?'; params.push(start_date); }
    if (end_date) { where += ' AND ptv.tour_date <= ?'; params.push(end_date); }

    const rows = db.prepare(`
      SELECT ptv.*, u.full_name as officer_name, v.full_name as verified_by_name
      FROM patrol_tour_verifications ptv
      LEFT JOIN users u ON ptv.officer_id = u.id
      LEFT JOIN users v ON ptv.verified_by = v.id
      ${where}
      ORDER BY ptv.tour_date DESC
      LIMIT 200
    `).all(...params);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching verifications:', error);
    res.status(500).json({ error: 'Failed to fetch verifications', code: 'FAILED_TO_FETCH_VERIFICATIONS' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 6: Patrol Exception Report
// ════════════════════════════════════════════════════════════

router.get('/exceptions', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '7' } = req.query;
    const daysNum = Math.min(90, Math.max(1, parseInt(days as string, 10) || 7));
    const cutoff = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000).toISOString();

    // Late scans
    const lateScans = db.prepare(`
      SELECT ps.*, pc.name as checkpoint_name, p.name as property_name,
             u.full_name as officer_name, pc.scan_required_interval_minutes
      FROM patrol_scans ps
      LEFT JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      LEFT JOIN properties p ON pc.property_id = p.id
      LEFT JOIN users u ON ps.officer_id = u.id
      WHERE ps.status = 'late' AND ps.scanned_at >= ?
      ORDER BY ps.scanned_at DESC
    
      LIMIT 1000
    `).all(cutoff) as any[];

    // Missed checkpoints (active checkpoints with no scans in last interval)
    const missedCheckpoints = db.prepare(`
      SELECT pc.id, pc.name, p.name as property_name, pc.scan_required_interval_minutes,
             MAX(ps.scanned_at) as last_scan
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      LEFT JOIN patrol_scans ps ON ps.checkpoint_id = pc.id
      WHERE pc.is_active = 1
      GROUP BY pc.id
      HAVING last_scan IS NULL OR last_scan < datetime('now', '-' || pc.scan_required_interval_minutes || ' minutes')
    `).all() as any[];

    // Summary stats
    const totalScans = db.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_count
      FROM patrol_scans WHERE scanned_at >= ?
    `).get(cutoff) as any;

    res.json({
      late_scans: lateScans,
      missed_checkpoints: missedCheckpoints,
      period_days: daysNum,
      total_scans: totalScans?.total || 0,
      late_count: totalScans?.late_count || 0,
      late_rate: totalScans?.total > 0 ? Math.round((totalScans.late_count / totalScans.total) * 100) : 0,
    });
  } catch (error) {
    console.error('Error fetching exceptions:', error);
    res.status(500).json({ error: 'Failed to fetch exception report', code: 'FAILED_TO_FETCH_EXCEPTION' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 7: Patrol Time Tracking
// ════════════════════════════════════════════════════════════

router.get('/time-tracking', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { officer_id, date } = req.query;
    const targetDate = date as string || localToday();
    const officerId = officer_id ? parseInt(officer_id as string, 10) : req.user!.userId;

    const dayScans = db.prepare(`
      SELECT ps.scanned_at, pc.name as checkpoint_name, p.name as property_name
      FROM patrol_scans ps
      LEFT JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE ps.officer_id = ? AND DATE(ps.scanned_at) = ?
      ORDER BY ps.scanned_at ASC
    
      LIMIT 1000
    `).all(officerId, targetDate) as any[];

    const segments: { from: string; to: string; from_time: string; to_time: string; duration_minutes: number }[] = [];
    let totalPatrolMinutes = 0;
    let longestGapMinutes = 0;
    let shortestGapMinutes = Infinity;

    for (let i = 1; i < dayScans.length; i++) {
      const prev = dayScans[i - 1];
      const curr = dayScans[i];
      const diffMs = new Date(curr.scanned_at).getTime() - new Date(prev.scanned_at).getTime();
      const diffMin = Math.round(diffMs / 60000);
      totalPatrolMinutes += diffMin;
      if (diffMin > longestGapMinutes) longestGapMinutes = diffMin;
      if (diffMin < shortestGapMinutes) shortestGapMinutes = diffMin;
      segments.push({
        from: prev.checkpoint_name,
        to: curr.checkpoint_name,
        from_time: prev.scanned_at,
        to_time: curr.scanned_at,
        duration_minutes: diffMin,
      });
    }

    res.json({
      date: targetDate,
      officer_id: officerId,
      total_patrol_minutes: totalPatrolMinutes,
      total_checkpoints: dayScans.length,
      average_between_minutes: segments.length > 0 ? Math.round(totalPatrolMinutes / segments.length) : 0,
      longest_gap_minutes: longestGapMinutes,
      shortest_gap_minutes: shortestGapMinutes === Infinity ? 0 : shortestGapMinutes,
      first_scan: dayScans.length > 0 ? dayScans[0].scanned_at : null,
      last_scan: dayScans.length > 0 ? dayScans[dayScans.length - 1].scanned_at : null,
      segments,
    });
  } catch (error) {
    console.error('Error fetching time tracking:', error);
    res.status(500).json({ error: 'Failed to fetch time tracking', code: 'FAILED_TO_FETCH_TIME' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 8: Weather Conditions Logging
// ════════════════════════════════════════════════════════════

router.post('/scan/:scanId/weather', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const scan = db.prepare('SELECT * FROM patrol_scans WHERE id = ?').get(req.params.scanId) as any;
    if (!scan) {
      res.status(404).json({ error: 'Scan not found', code: 'SCAN_NOT_FOUND' });
      return;
    }

    const { conditions, temperature_f, wind_mph, visibility, precipitation, humidity_pct } = req.body;

    // Store weather data in scan notes as structured JSON
    const weatherData = {
      conditions: conditions || 'clear',
      temperature_f: temperature_f ?? null,
      wind_mph: wind_mph ?? null,
      visibility: visibility || 'good',
      precipitation: precipitation || 'none',
      humidity_pct: humidity_pct ?? null,
      recorded_at: localNow(),
      recorded_by: req.user!.userId,
    };

    // Append weather data to existing notes
    const existingNotes = scan.notes || '';
    const updatedNotes = existingNotes
      ? `${existingNotes}\n[WEATHER] ${JSON.stringify(weatherData)}`
      : `[WEATHER] ${JSON.stringify(weatherData)}`;

    db.prepare('UPDATE patrol_scans SET notes = ? WHERE id = ?').run(updatedNotes, scan.id);

    // Also try to store in a dedicated weather column if it exists
    try {
      db.prepare('UPDATE patrol_scans SET weather_json = ? WHERE id = ?').run(JSON.stringify(weatherData), scan.id);
    } catch { /* column may not exist yet */ }

    res.json({ success: true, weather: weatherData });
  } catch (error) {
    console.error('Error logging weather:', error);
    res.status(500).json({ error: 'Failed to log weather conditions', code: 'FAILED_TO_LOG_WEATHER' });
  }
});

// ── Feature 11: Patrol shift summary ──────────────────────────────
// GET /api/patrol/shift-summary - Auto-generate end-of-shift summary
router.get('/shift-summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date, officer_id } = req.query;
    const targetDate = date || localNow().split('T')[0];
    const officerId = officer_id || req.user!.userId;

    // Scans today
    const scans = db.prepare(`
      SELECT ps.*, pc.name as checkpoint_name, p.name as property_name
      FROM patrol_scans ps
      JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE ps.officer_id = ? AND DATE(ps.scanned_at) = ?
      ORDER BY ps.scanned_at ASC
    
      LIMIT 1000
    `).all(officerId, targetDate) as any[];

    const onTime = scans.filter((s: any) => s.status === 'on_time').length;
    const late = scans.filter((s: any) => s.status === 'late').length;

    // Incidents created today
    const incidents = db.prepare(`
      SELECT id, incident_number, incident_type, status
      FROM incidents WHERE officer_id = ? AND DATE(created_at) = ?
    
      LIMIT 1000
    `).all(officerId, targetDate) as any[];

    // Mileage from GPS breadcrumbs (rough calculation from distance between consecutive points)
    let totalMileage = 0;
    try {
      const breadcrumbs = db.prepare(`
        SELECT latitude, longitude FROM gps_breadcrumbs
        WHERE officer_id = ? AND DATE(recorded_at) = ?
        ORDER BY recorded_at ASC
      
        LIMIT 1000
      `).all(officerId, targetDate) as any[];

      for (let i = 1; i < breadcrumbs.length; i++) {
        const prev = breadcrumbs[i - 1];
        const curr = breadcrumbs[i];
        const R = 3959; // miles
        const dLat = (curr.latitude - prev.latitude) * Math.PI / 180;
        const dLon = (curr.longitude - prev.longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(prev.latitude * Math.PI / 180) * Math.cos(curr.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        totalMileage += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }
    } catch { /* breadcrumbs may not exist */ }

    // Breaks today
    let breaks: any[] = [];
    try {
      breaks = db.prepare(`
        SELECT * FROM patrol_breaks WHERE officer_id = ? AND shift_date = ?
      
        LIMIT 1000
      `).all(officerId, targetDate) as any[];
    } catch { /* table may not exist */ }

    res.json({
      date: targetDate,
      officer_id: officerId,
      scans_total: scans.length,
      scans_on_time: onTime,
      scans_late: late,
      incidents_count: incidents.length,
      incidents,
      estimated_mileage: Math.round(totalMileage * 10) / 10,
      breaks_count: breaks.length,
      total_break_minutes: breaks.reduce((sum: number, b: any) => sum + (b.duration_minutes || 0), 0),
      properties_visited: [...new Set(scans.map((s: any) => s.property_name))],
    });
  } catch (error: any) {
    console.error('Shift summary error:', error);
    res.status(500).json({ error: 'Failed to generate shift summary', code: 'FAILED_TO_GENERATE_SHIFT' });
  }
});

// ── Feature 12: Property special instructions ─────────────────────
// GET /api/patrol/checkpoints/:id/instructions - Get special instructions
router.get('/checkpoints/:id/instructions', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const checkpoint = db.prepare(`
      SELECT pc.special_instructions, pc.name, pc.description,
        p.gate_code, p.alarm_code, p.hazard_notes, p.post_orders, p.emergency_contact, p.access_instructions
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE pc.id = ?
    `).get(req.params.id) as any;

    if (!checkpoint) { res.status(404).json({ error: 'Checkpoint not found', code: 'CHECKPOINT_NOT_FOUND' }); return; }

    res.json({
      checkpoint_name: checkpoint.name,
      checkpoint_description: checkpoint.description,
      special_instructions: checkpoint.special_instructions,
      gate_code: checkpoint.gate_code,
      alarm_code: checkpoint.alarm_code,
      hazard_notes: checkpoint.hazard_notes,
      post_orders: checkpoint.post_orders,
      emergency_contact: checkpoint.emergency_contact,
      access_instructions: checkpoint.access_instructions,
    });
  } catch (error: any) {
    console.error('Get instructions error:', error);
    res.status(500).json({ error: 'Failed to get instructions', code: 'GET_INSTRUCTIONS_ERROR' });
  }
});

// ── Feature 13: Patrol break tracking ─────────────────────────────
// POST /api/patrol/breaks/start - Start a break
router.post('/breaks/start', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { break_type } = req.body;
    const now = localNow();
    const today = now.split('T')[0];

    // Check for active break
    const active = db.prepare('SELECT * FROM patrol_breaks WHERE officer_id = ? AND shift_date = ? AND break_end IS NULL').get(req.user!.userId, today) as any;
    if (active) { res.status(400).json({ error: 'Already on a break. End current break first.', code: 'ALREADY_ON_A_BREAK' }); return; }

    const result = db.prepare(`
      INSERT INTO patrol_breaks (officer_id, shift_date, break_start, break_type)
      VALUES (?, ?, ?, ?)
    `).run(req.user!.userId, today, now, break_type || 'break');

    res.status(201).json({ id: result.lastInsertRowid, break_start: now });
  } catch (error: any) {
    console.error('Start break error:', error);
    res.status(500).json({ error: 'Failed to start break', code: 'START_BREAK_ERROR' });
  }
});

// POST /api/patrol/breaks/end - End current break
router.post('/breaks/end', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const today = now.split('T')[0];

    const active = db.prepare('SELECT * FROM patrol_breaks WHERE officer_id = ? AND shift_date = ? AND break_end IS NULL').get(req.user!.userId, today) as any;
    if (!active) { res.status(400).json({ error: 'No active break to end', code: 'NO_ACTIVE_BREAK_TO' }); return; }

    const startTime = new Date(active.break_start).getTime();
    const endTime = new Date(now).getTime();
    const durationMinutes = Math.round((endTime - startTime) / 60000 * 10) / 10;

    db.prepare('UPDATE patrol_breaks SET break_end = ?, duration_minutes = ? WHERE id = ?').run(now, durationMinutes, active.id);

    res.json({ success: true, duration_minutes: durationMinutes });
  } catch (error: any) {
    console.error('End break error:', error);
    res.status(500).json({ error: 'Failed to end break', code: 'END_BREAK_ERROR' });
  }
});

// GET /api/patrol/breaks - Get breaks for current shift
router.get('/breaks', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date, officer_id } = req.query;
    const targetDate = date || localNow().split('T')[0];
    const officerId = officer_id || req.user!.userId;

    const breaks = db.prepare(`
      SELECT pb.*, u.full_name as officer_name
      FROM patrol_breaks pb
      LEFT JOIN users u ON pb.officer_id = u.id
      WHERE pb.officer_id = ? AND pb.shift_date = ?
      ORDER BY pb.break_start ASC
    
      LIMIT 1000
    `).all(officerId, targetDate);

    res.json(breaks);
  } catch (error: any) {
    console.error('Get breaks error:', error);
    res.status(500).json({ error: 'Failed to get breaks', code: 'GET_BREAKS_ERROR' });
  }
});

// ── Feature 14: Incident proximity alert ──────────────────────────
// POST /api/patrol/proximity-check - Check if active calls are near a location
router.post('/proximity-check', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { latitude, longitude, radius_miles } = req.body;
    if (!latitude || !longitude) { res.status(400).json({ error: 'latitude and longitude required', code: 'LATITUDE_AND_LONGITUDE_REQUIRED' }); return; }

    const radiusMi = radius_miles || 0.5; // default 0.5 miles
    // Approximate: 1 degree lat ~= 69 miles
    const latDelta = radiusMi / 69;
    const lngDelta = radiusMi / (69 * Math.cos(latitude * Math.PI / 180));

    const activeCalls = db.prepare(`
      SELECT id, call_number, incident_type, priority, status, location_address, latitude, longitude
      FROM calls_for_service
      WHERE status IN ('pending', 'dispatched', 'enroute', 'onscene')
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
    
      LIMIT 1000
    `).all(
      latitude - latDelta, latitude + latDelta,
      longitude - lngDelta, longitude + lngDelta
    );

    res.json({ nearby_calls: activeCalls, count: activeCalls.length });
  } catch (error: any) {
    console.error('Proximity check error:', error);
    res.status(500).json({ error: 'Failed to proximity check', code: 'PROXIMITY_CHECK_ERROR' });
  }
});

// ── Feature 15: Patrol efficiency score ───────────────────────────
// GET /api/patrol/efficiency - Calculate patrol efficiency score
router.get('/efficiency', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date, officer_id } = req.query;
    const targetDate = date || localNow().split('T')[0];
    const officerId = officer_id || req.user!.userId;

    // Total assigned checkpoints (active ones at properties officer patrols)
    const totalCheckpoints = db.prepare(`
      SELECT COUNT(*) as total FROM patrol_checkpoints WHERE is_active = 1 AND archived_at IS NULL
    `).get() as any;

    // Scans made today
    const scansToday = db.prepare(`
      SELECT ps.status, COUNT(*) as count
      FROM patrol_scans ps
      WHERE ps.officer_id = ? AND DATE(ps.scanned_at) = ?
      GROUP BY ps.status
    `).all(officerId, targetDate) as any[];

    const onTime = scansToday.find((s: any) => s.status === 'on_time')?.count || 0;
    const late = scansToday.find((s: any) => s.status === 'late')?.count || 0;
    const totalScans = onTime + late;
    const totalAssigned = totalCheckpoints.total || 1;

    const efficiency = {
      officer_id: officerId,
      date: targetDate,
      total_assigned: totalAssigned,
      scans_completed: totalScans,
      scans_on_time: onTime,
      scans_late: late,
      completion_rate: Math.round((totalScans / totalAssigned) * 100),
      on_time_rate: totalScans > 0 ? Math.round((onTime / totalScans) * 100) : 0,
      efficiency_score: Math.round(((onTime * 1.0 + late * 0.5) / totalAssigned) * 100),
    };

    res.json(efficiency);
  } catch (error: any) {
    console.error('Efficiency score error:', error);
    res.status(500).json({ error: 'Failed to efficiency score', code: 'EFFICIENCY_SCORE_ERROR' });
  }
});

export default router;
