import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateParamId } from '../middleware/sanitize';
import { sendCsv } from '../utils/csvExport';
import { localNow } from '../utils/timeUtils';
import { broadcast } from '../utils/websocket';

const router = Router();

router.use(authenticateToken);

// GET /api/patrol/checkpoints - List all checkpoints
router.get('/checkpoints', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const checkpoints = db.prepare(`
      SELECT
        pc.*,
        p.name as property_name
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      ORDER BY pc.created_at DESC
    `).all();

    res.json(checkpoints);
  } catch (error: any) {
    console.error('Error fetching checkpoints:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch checkpoints' });
  }
});

// GET /api/patrol/checkpoints/property/:propertyId - Checkpoints for a specific property
router.get('/checkpoints/property/:propertyId', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const checkpoints = db.prepare(`
      SELECT
        pc.*,
        p.name as property_name
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE pc.property_id = ?
      ORDER BY pc.name
    `).all(req.params.propertyId);

    res.json(checkpoints);
  } catch (error: any) {
    console.error('Error fetching property checkpoints:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch property checkpoints' });
  }
});

// POST /api/patrol/checkpoints - Create checkpoint
router.post('/checkpoints', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const { property_id, name, description, latitude, longitude, scan_required_interval_minutes, is_active } = req.body;

    if (!property_id || !name || !scan_required_interval_minutes) {
      res.status(400).json({ error: 'Missing required fields: property_id, name, scan_required_interval_minutes' });
      return;
    }

    if (latitude !== undefined && latitude !== null && (typeof latitude !== 'number' || isNaN(latitude))) {
      res.status(400).json({ error: 'latitude must be a valid number' });
      return;
    }
    if (longitude !== undefined && longitude !== null && (typeof longitude !== 'number' || isNaN(longitude))) {
      res.status(400).json({ error: 'longitude must be a valid number' });
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
      latitude ?? null,
      longitude ?? null,
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
    if (!checkpoint) { res.status(500).json({ error: 'Failed to retrieve created checkpoint' }); return; }

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

    broadcast('patrol', 'checkpoint:created', checkpoint);
    res.status(201).json(checkpoint);
  } catch (error: any) {
    console.error('Error creating checkpoint:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to create checkpoint' });
  }
});

// PUT /api/patrol/checkpoints/:id - Update checkpoint
router.put('/checkpoints/:id', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { property_id, name, description, latitude, longitude, scan_required_interval_minutes, is_active } = req.body;

    const db = getDb();

    const existing = db.prepare('SELECT * FROM patrol_checkpoints WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Checkpoint not found' });
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
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, 'checkpoint_updated', 'patrol_checkpoint', ?, ?, ?, ?)
    `).run(req.user!.userId, id, `Updated checkpoint: ${existing.name}`, req.ip || 'unknown', localNow());

    const updated = db.prepare(`
      SELECT pc.*, p.name as property_name
      FROM patrol_checkpoints pc
      LEFT JOIN properties p ON pc.property_id = p.id
      WHERE pc.id = ?
    `).get(id);

    broadcast('patrol', 'checkpoint:updated', updated);
    res.json(updated);
  } catch (error: any) {
    console.error('Error updating checkpoint:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to update checkpoint' });
  }
});

// DELETE /api/patrol/checkpoints/:id - Delete checkpoint
router.delete('/checkpoints/:id', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const existing = db.prepare('SELECT * FROM patrol_checkpoints WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Checkpoint not found' });
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

    broadcast('patrol', 'checkpoint:deleted', { id: Number(id) });
    res.json({ message: 'Checkpoint deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting checkpoint:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to delete checkpoint' });
  }
});

// POST /api/patrol/checkpoints/:id/archive
router.post('/checkpoints/:id/archive', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const checkpoint = db.prepare('SELECT * FROM patrol_checkpoints WHERE id = ?').get(req.params.id) as any;
    if (!checkpoint) { res.status(404).json({ error: 'Checkpoint not found' }); return; }
    if (checkpoint.archived_at) { res.status(400).json({ error: 'Checkpoint is already archived' }); return; }

    const now = localNow();
    db.prepare('UPDATE patrol_checkpoints SET archived_at = ? WHERE id = ?').run(now, checkpoint.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'checkpoint_archived', 'patrol_checkpoint', ?, ?, ?)`).run(
      req.user!.userId, checkpoint.id, `Archived checkpoint: ${checkpoint.name}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT pc.*, p.name as property_name FROM patrol_checkpoints pc LEFT JOIN properties p ON pc.property_id = p.id WHERE pc.id = ?').get(checkpoint.id);
    broadcast('patrol', 'checkpoint:updated', updated);
    res.json(updated);
  } catch (error: any) {
    console.error('Archive checkpoint error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/patrol/checkpoints/:id/unarchive
router.post('/checkpoints/:id/unarchive', validateParamId, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const checkpoint = db.prepare('SELECT * FROM patrol_checkpoints WHERE id = ?').get(req.params.id) as any;
    if (!checkpoint) { res.status(404).json({ error: 'Checkpoint not found' }); return; }
    if (!checkpoint.archived_at) { res.status(400).json({ error: 'Checkpoint is not archived' }); return; }

    db.prepare('UPDATE patrol_checkpoints SET archived_at = NULL WHERE id = ?').run(checkpoint.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'checkpoint_unarchived', 'patrol_checkpoint', ?, ?, ?)`).run(
      req.user!.userId, checkpoint.id, `Unarchived checkpoint: ${checkpoint.name}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT pc.*, p.name as property_name FROM patrol_checkpoints pc LEFT JOIN properties p ON pc.property_id = p.id WHERE pc.id = ?').get(checkpoint.id);
    broadcast('patrol', 'checkpoint:updated', updated);
    res.json(updated);
  } catch (error: any) {
    console.error('Unarchive checkpoint error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/patrol/scan - Record a scan
router.post('/scan', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const { qr_code, latitude, longitude, notes } = req.body;

    if (!qr_code) {
      res.status(400).json({ error: 'Missing required field: qr_code' });
      return;
    }

    const db = getDb();

    const checkpoint = db.prepare('SELECT * FROM patrol_checkpoints WHERE qr_code = ? AND is_active = 1').get(qr_code) as any;

    if (!checkpoint) {
      res.status(404).json({ error: 'Invalid or inactive checkpoint' });
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
      if (!isNaN(lastScanTime)) {
        const now = Date.now();
        const intervalMs = checkpoint.scan_required_interval_minutes * 60 * 1000;
        const timeSinceLastScan = now - lastScanTime;

        if (timeSinceLastScan > intervalMs) {
          status = 'late';
        }
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
      latitude ?? null,
      longitude ?? null,
      notes || null,
      status
    );

    const scan = db.prepare('SELECT * FROM patrol_scans WHERE id = ?').get(result.lastInsertRowid);
    if (!scan) { res.status(500).json({ error: 'Failed to retrieve created scan' }); return; }

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

    const scanData = { ...(scan as any), checkpoint_name: checkpoint.name, status };
    broadcast('patrol', 'patrol:scanned', scanData);
    res.status(201).json(scanData);
  } catch (error: any) {
    console.error('Error recording scan:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to record scan' });
  }
});

// GET /api/patrol/scans/export - Export patrol scans as CSV
router.get('/scans/export', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
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
      LIMIT 50000
    `).all(...params);

    sendCsv(res, 'patrol_scans_export.csv', [
      { key: 'checkpoint_name', header: 'Checkpoint Name' },
      { key: 'officer_name', header: 'Officer Name' },
      { key: 'scanned_at', header: 'Scanned At' },
      { key: 'status', header: 'Status' },
      { key: 'notes', header: 'Notes' },
    ], rows);
  } catch (error: any) {
    console.error('Export patrol scans error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/patrol/scans - List recent scans
router.get('/scans', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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
    `).all(...params, Math.min(200, Math.max(1, (() => { const n = parseInt(limit as string, 10); return isNaN(n) ? 50 : n; })())));


    res.json(scans);
  } catch (error: any) {
    console.error('Error fetching scans:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch scans' });
  }
});

// GET /api/patrol/compliance - Patrol compliance stats
router.get('/compliance', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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
    `).all() as any[];

    const compliance = checkpoints.map((checkpoint) => {
      const todayScans = db.prepare(`
        SELECT COUNT(*) as count
        FROM patrol_scans
        WHERE checkpoint_id = ?
        AND date(scanned_at) = date('now', 'localtime')
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
        AND scanned_at >= datetime('now', 'localtime', '-30 days')
      `).get(checkpoint.id) as any;

      const complianceRate = complianceStats.total_scans > 0
        ? (complianceStats.on_time_scans / complianceStats.total_scans) * 100
        : 0;

      let nextScanDue = null;
      if (lastScan) {
        const lastScanTimeMs = new Date(lastScan.scanned_at).getTime();
        if (!isNaN(lastScanTimeMs)) {
          const nextDue = new Date(lastScanTimeMs + checkpoint.scan_required_interval_minutes * 60 * 1000);
          nextScanDue = nextDue.toISOString();
        }
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
  } catch (error: any) {
    console.error('Error fetching compliance stats:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch compliance stats' });
  }
});

export default router;
