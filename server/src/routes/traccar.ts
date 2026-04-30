// ============================================================
// Traccar GPS Integration Routes
// ============================================================
// Admin endpoints for configuring Traccar credentials, managing
// device-to-unit mappings, and controlling the GPS poller.
// Replaces the ClearPathGPS routes with identical functionality.

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import {
  CONFIG_KEYS,
  getConfigValue,
  setConfigValue,
  deleteConfigValue,
  isConfigured,
  isEnabled,
  testConnection,
  getDevices,
  getPositionHistory,
} from '../utils/traccarClient';
import {
  startTraccarPoller,
  stopTraccarPoller,
  restartTraccarPoller,
} from '../utils/traccarPoller';

const router = Router();
router.use(authenticateToken);

// ============================================================
// GET /api/traccar/status — connection + poller status
// ============================================================
router.get('/status', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const configured = isConfigured();
    const enabled = isEnabled();
    const pollInterval = getConfigValue(CONFIG_KEYS.pollInterval) || '30';

    const mappingCount = (db.prepare(
      'SELECT COUNT(*) as cnt FROM cpg_device_mappings WHERE is_active = 1'
    ).get() as any)?.cnt || 0;

    const lastSync = (db.prepare(
      'SELECT MAX(last_synced_at) as ts FROM cpg_device_mappings WHERE is_active = 1'
    ).get() as any)?.ts || null;

    res.json({
      configured,
      enabled,
      poll_interval_seconds: parseInt(pollInterval, 10),
      active_mappings: mappingCount,
      last_sync: lastSync,
    });
  } catch (error: any) {
    console.error('Traccar status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// PUT /api/traccar/credentials — save encrypted credentials
// ============================================================
router.put('/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { url, email, password } = req.body;

    if (!url || !email || !password) {
      res.status(400).json({ error: 'url, email, and password are required' });
      return;
    }

    setConfigValue(CONFIG_KEYS.url, url, false); // URL doesn't need encryption
    setConfigValue(CONFIG_KEYS.email, email, true);
    setConfigValue(CONFIG_KEYS.password, password, true);

    const db = getDb();
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'traccar_credentials_updated', 'integration', 0, ?, ?)"
    ).run(req.user!.userId, 'Updated Traccar GPS credentials', req.ip || 'unknown');

    res.json({ message: 'Credentials saved' });
  } catch (error: any) {
    console.error('Traccar save credentials error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// DELETE /api/traccar/credentials — clear all config
// ============================================================
router.delete('/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    Object.values(CONFIG_KEYS).forEach(key => deleteConfigValue(key));
    stopTraccarPoller();

    const db = getDb();
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'traccar_credentials_cleared', 'integration', 0, ?, ?)"
    ).run(req.user!.userId, 'Cleared Traccar GPS credentials', req.ip || 'unknown');

    res.json({ message: 'Credentials and configuration cleared' });
  } catch (error: any) {
    console.error('Traccar clear credentials error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /api/traccar/test-connection — test API auth
// ============================================================
router.post('/test-connection', requireRole('admin', 'manager'), async (_req: Request, res: Response) => {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (error: any) {
    res.json({ success: false, deviceCount: 0, error: error.message || 'Connection test failed' });
  }
});

// ============================================================
// PUT /api/traccar/enable — toggle integration + interval
// ============================================================
router.put('/enable', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { enabled, poll_interval_seconds } = req.body;

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }

    setConfigValue(CONFIG_KEYS.enabled, String(enabled), false);

    if (poll_interval_seconds != null) {
      const interval = Math.max(15, Math.min(300, parseInt(poll_interval_seconds, 10) || 30));
      setConfigValue(CONFIG_KEYS.pollInterval, String(interval), false);
    }

    if (enabled && isConfigured()) {
      restartTraccarPoller();
    } else {
      stopTraccarPoller();
      // Reset gps_source for all units back to browser
      if (!enabled) {
        const db = getDb();
        db.prepare("UPDATE units SET gps_source = 'browser' WHERE gps_source = 'traccar'").run();
      }
    }

    const db = getDb();
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'traccar_toggled', 'integration', 0, ?, ?)"
    ).run(req.user!.userId, `Traccar GPS ${enabled ? 'enabled' : 'disabled'}`, req.ip || 'unknown');

    res.json({ message: `Traccar GPS ${enabled ? 'enabled' : 'disabled'}` });
  } catch (error: any) {
    console.error('Traccar enable/disable error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/traccar/devices — fetch device list from Traccar API
// ============================================================
router.get('/devices', requireRole('admin', 'manager'), async (_req: Request, res: Response) => {
  try {
    if (!isConfigured()) {
      res.status(400).json({ error: 'Traccar not configured' });
      return;
    }

    const devices = await getDevices();
    res.json({ devices });
  } catch (error: any) {
    console.error('Traccar fetch devices error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch devices' });
  }
});

// ============================================================
// GET /api/traccar/mappings — list device-to-unit mappings
// ============================================================
router.get('/mappings', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const mappings = db.prepare(`
      SELECT m.*, u.call_sign, u.status as unit_status,
        usr.full_name as officer_name, usr.id as officer_id
      FROM cpg_device_mappings m
      LEFT JOIN units u ON m.unit_id = u.id
      LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE m.is_active = 1
      ORDER BY m.cpg_display_name
    `).all();

    res.json({ mappings });
  } catch (error: any) {
    console.error('Traccar fetch mappings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /api/traccar/mappings — create device→unit mapping
// ============================================================
router.post('/mappings', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { device_unique_id, device_name, traccar_device_id, unit_id } = req.body;

    if (!device_unique_id || !unit_id) {
      res.status(400).json({ error: 'device_unique_id and unit_id are required' });
      return;
    }

    const db = getDb();
    const now = localNow();

    // Check unit exists
    const unit = db.prepare('SELECT id, call_sign FROM units WHERE id = ?').get(unit_id) as any;
    if (!unit) {
      res.status(404).json({ error: 'Unit not found' });
      return;
    }

    // Upsert mapping (update if device already mapped)
    const existing = db.prepare(
      'SELECT id FROM cpg_device_mappings WHERE cpg_device_id = ?'
    ).get(device_unique_id) as any;

    if (existing) {
      db.prepare(`
        UPDATE cpg_device_mappings
        SET unit_id = ?, cpg_display_name = ?, traccar_device_id = ?, is_active = 1, updated_at = ?
        WHERE id = ?
      `).run(unit_id, device_name || null, traccar_device_id || null, now, existing.id);
    } else {
      db.prepare(`
        INSERT INTO cpg_device_mappings (cpg_device_id, cpg_display_name, traccar_device_id, unit_id, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run(device_unique_id, device_name || null, traccar_device_id || null, unit_id, now, now);
    }

    // Set unit's GPS source to traccar
    db.prepare("UPDATE units SET gps_source = 'traccar' WHERE id = ?").run(unit_id);

    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'traccar_mapping_created', 'gps_device_mapping', ?, ?, ?)"
    ).run(req.user!.userId, unit_id, `Mapped device ${device_name || device_unique_id} → ${unit.call_sign}`, req.ip || 'unknown');

    res.json({ message: 'Mapping created', unit_call_sign: unit.call_sign });
  } catch (error: any) {
    console.error('Traccar create mapping error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// DELETE /api/traccar/mappings/:id — remove mapping
// ============================================================
router.delete('/mappings/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const mapping = db.prepare(
      'SELECT * FROM cpg_device_mappings WHERE id = ?'
    ).get(req.params.id) as any;

    if (!mapping) {
      res.status(404).json({ error: 'Mapping not found' });
      return;
    }

    // Deactivate mapping
    db.prepare(
      "UPDATE cpg_device_mappings SET is_active = 0, updated_at = ? WHERE id = ?"
    ).run(localNow(), mapping.id);

    // Reset unit's GPS source back to browser
    db.prepare("UPDATE units SET gps_source = 'browser' WHERE id = ?").run(mapping.unit_id);

    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'traccar_mapping_removed', 'gps_device_mapping', ?, ?, ?)"
    ).run(req.user!.userId, mapping.unit_id, `Unmapped device ${mapping.cpg_display_name || mapping.cpg_device_id}`, req.ip || 'unknown');

    res.json({ message: 'Mapping removed' });
  } catch (error: any) {
    console.error('Traccar remove mapping error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/traccar/settings — get integration settings
// ============================================================
router.get('/settings', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    const historyBackfill = getConfigValue('traccar_history_backfill');
    res.json({
      history_backfill: historyBackfill !== 'false', // default true
    });
  } catch (error: any) {
    console.error('Traccar get settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// PUT /api/traccar/settings — update integration settings
// ============================================================
router.put('/settings', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { history_backfill } = req.body;

    if (typeof history_backfill === 'boolean') {
      setConfigValue('traccar_history_backfill', String(history_backfill), false);
    }

    const db = getDb();
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'traccar_settings_updated', 'integration', 0, ?, ?)"
    ).run(req.user!.userId, `History backfill: ${history_backfill}`, req.ip || 'unknown');

    res.json({ message: 'Settings updated' });
  } catch (error: any) {
    console.error('Traccar update settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/traccar/history/:deviceId — fetch position history
// ============================================================
router.get('/history/:deviceId', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!isConfigured()) {
      res.status(400).json({ error: 'Traccar not configured' });
      return;
    }

    const deviceId = parseInt(String(req.params.deviceId), 10);
    if (isNaN(deviceId)) {
      res.status(400).json({ error: 'Invalid device ID' });
      return;
    }

    const from = req.query.from as string;
    const to = req.query.to as string;

    if (!from || !to) {
      res.status(400).json({ error: 'from and to query parameters are required (ISO date strings)' });
      return;
    }

    const positions = await getPositionHistory(deviceId, String(from), String(to));
    res.json({ positions, count: positions.length });
  } catch (error: any) {
    console.error('Traccar fetch history error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch position history' });
  }
});

// ============================================================
// GET /api/traccar/dashcam-events — list telemetry events
// ============================================================
router.get('/dashcam-events', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { from, to, device_id, event_type, limit: limitStr } = req.query;
    const limit = Math.min(100000, Math.max(1, (parseInt(limitStr as string, 10)) || 100000));

    let query = `
      SELECT d.*, u.call_sign, usr.full_name as officer_name
      FROM dashcam_events d
      LEFT JOIN units u ON d.unit_id = u.id
      LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (from) {
      query += ' AND d.event_timestamp >= ?';
      params.push(from);
    }
    if (to) {
      query += ' AND d.event_timestamp <= ?';
      params.push(to);
    }
    if (device_id) {
      query += ' AND d.cpg_device_id = ?';
      params.push(device_id);
    }
    if (event_type) {
      query += ' AND d.event_type = ?';
      params.push(event_type);
    }

    query += ' ORDER BY d.event_timestamp DESC LIMIT ?';
    params.push(limit);

    const events = db.prepare(query).all(...params);
    const total = (db.prepare(
      'SELECT COUNT(*) as cnt FROM dashcam_events'
    ).get() as any)?.cnt || 0;

    res.json({ events, total });
  } catch (error: any) {
    console.error('Traccar fetch dashcam events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/traccar/dashcam-events/by-officer/:officerId
// ============================================================
router.get('/dashcam-events/by-officer/:officerId', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const officerId = parseInt(String(req.params.officerId), 10);
    if (isNaN(officerId)) { res.status(400).json({ error: 'Invalid officer ID' }); return; }

    const { from, to, event_type, limit: limitStr } = req.query;
    const limit = Math.min(100000, Math.max(1, (parseInt(String(limitStr), 10)) || 100000));

    const units = db.prepare('SELECT id FROM units WHERE officer_id = ?').all(officerId) as { id: number }[];
    if (units.length === 0) { res.json({ events: [], total: 0 }); return; }

    const unitIds = units.map(u => u.id);
    const placeholders = unitIds.map(() => '?').join(',');

    let query = `
      SELECT d.*, u.call_sign, m.cpg_display_name as device_name
      FROM dashcam_events d
      LEFT JOIN units u ON d.unit_id = u.id
      LEFT JOIN cpg_device_mappings m ON d.cpg_device_id = m.cpg_device_id AND m.is_active = 1
      WHERE d.unit_id IN (${placeholders})
    `;
    const params: any[] = [...unitIds];

    if (from) { query += ' AND d.event_timestamp >= ?'; params.push(String(from)); }
    if (to) { query += ' AND d.event_timestamp <= ?'; params.push(String(to)); }
    if (event_type) { query += ' AND d.event_type = ?'; params.push(String(event_type)); }

    query += ' ORDER BY d.event_timestamp DESC LIMIT ?';
    params.push(limit);

    const events = db.prepare(query).all(...params);
    res.json({ events, total: events.length });
  } catch (error: any) {
    console.error('Traccar fetch officer dashcam events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/traccar/dashcam-events/:id — single event detail
// ============================================================
router.get('/dashcam-events/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const event = db.prepare(`
      SELECT d.*, u.call_sign, usr.full_name as officer_name
      FROM dashcam_events d
      LEFT JOIN units u ON d.unit_id = u.id
      LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE d.id = ?
    `).get(req.params.id);

    if (!event) {
      res.status(404).json({ error: 'Telemetry event not found' });
      return;
    }

    res.json(event);
  } catch (error: any) {
    console.error('Traccar fetch dashcam event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// Historical Bulk Import — preserves all Traccar columns
// ============================================================
// Targets traccar_devices, traccar_positions, traccar_events,
// traccar_trips, traccar_stops, traccar_geofences (see
// server/src/models/traccarSchema.ts).

import {
  startHistoricalSync,
  getSyncJob,
  listSyncJobs,
  cancelSyncJob,
} from '../utils/traccarHistoricalSync';
import { paramStr } from '../utils/reqHelpers';

router.post('/historical/sync', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { from, to, deviceIds, include } = req.body ?? {};
    if (!from || !to) {
      res.status(400).json({ error: 'from and to (ISO 8601) are required' });
      return;
    }
    const jobId = await startHistoricalSync({
      fromIso: String(from),
      toIso: String(to),
      deviceIds: Array.isArray(deviceIds) ? deviceIds.map(Number).filter(n => !Number.isNaN(n)) : undefined,
      include,
      triggeredByUserId: req.user!.userId,
    });
    res.json({ success: true, jobId });
  } catch (err: any) {
    console.error('Traccar historical sync start error:', err);
    res.status(500).json({ error: err?.message || 'Failed to start historical sync' });
  }
});

router.get('/historical/jobs', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try { res.json(listSyncJobs(50)); } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

router.get('/historical/jobs/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  const job = getSyncJob(parseInt(paramStr(req.params.id), 10));
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  res.json(job);
});

router.post('/historical/jobs/:id/cancel', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  const ok = cancelSyncJob(parseInt(paramStr(req.params.id), 10));
  res.json({ success: ok });
});

router.get('/historical/devices', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT d.*, fv.vehicle_number AS fleet_unit_number, fv.license_plate AS fleet_plate
       FROM traccar_devices d
       LEFT JOIN fleet_vehicles fv ON d.vehicle_id = fv.id
       ORDER BY d.name ASC`
    ).all();
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed' }); }
});

router.post('/historical/link', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  const { traccarId, vehicleId } = req.body ?? {};
  if (typeof traccarId !== 'number') { res.status(400).json({ error: 'traccarId required' }); return; }
  const db = getDb();
  db.prepare(`UPDATE traccar_devices SET vehicle_id = ? WHERE traccar_id = ?`).run(vehicleId ?? null, traccarId);
  db.prepare(`UPDATE traccar_positions SET vehicle_id = ? WHERE traccar_device_id = ?`).run(vehicleId ?? null, traccarId);
  db.prepare(`UPDATE traccar_events SET vehicle_id = ? WHERE traccar_device_id = ?`).run(vehicleId ?? null, traccarId);
  db.prepare(`UPDATE traccar_trips SET vehicle_id = ? WHERE traccar_device_id = ?`).run(vehicleId ?? null, traccarId);
  db.prepare(`UPDATE traccar_stops SET vehicle_id = ? WHERE traccar_device_id = ?`).run(vehicleId ?? null, traccarId);
  res.json({ success: true });
});

router.get('/historical/positions', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const deviceId = req.query.deviceId ? parseInt(String(req.query.deviceId), 10) : null;
    const vehicleId = req.query.vehicleId ? parseInt(String(req.query.vehicleId), 10) : null;
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const limit = Math.min(parseInt(String(req.query.limit ?? '5000'), 10) || 5000, 50000);
    if (!from || !to) { res.status(400).json({ error: 'from and to (ISO) are required' }); return; }
    const where: string[] = [`fix_time BETWEEN ? AND ?`];
    const args: any[] = [from, to];
    if (deviceId) { where.push(`traccar_device_id = ?`); args.push(deviceId); }
    if (vehicleId) { where.push(`vehicle_id = ?`); args.push(vehicleId); }
    const rows = db.prepare(
      `SELECT id, traccar_id, traccar_device_id, vehicle_id, fix_time, latitude, longitude,
              altitude, speed, course, address, accuracy, attributes_json
       FROM traccar_positions WHERE ${where.join(' AND ')}
       ORDER BY fix_time ASC LIMIT ?`
    ).all(...args, limit);
    res.json({ count: rows.length, positions: rows });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Query failed' }); }
});

router.get('/historical/stats', requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const stats = {
      devices: (db.prepare(`SELECT COUNT(*) AS n FROM traccar_devices`).get() as any).n,
      positions: (db.prepare(`SELECT COUNT(*) AS n FROM traccar_positions`).get() as any).n,
      events: (db.prepare(`SELECT COUNT(*) AS n FROM traccar_events`).get() as any).n,
      trips: (db.prepare(`SELECT COUNT(*) AS n FROM traccar_trips`).get() as any).n,
      stops: (db.prepare(`SELECT COUNT(*) AS n FROM traccar_stops`).get() as any).n,
      geofences: (db.prepare(`SELECT COUNT(*) AS n FROM traccar_geofences`).get() as any).n,
      earliest: (db.prepare(`SELECT MIN(fix_time) AS t FROM traccar_positions`).get() as any).t,
      latest: (db.prepare(`SELECT MAX(fix_time) AS t FROM traccar_positions`).get() as any).t,
    };
    res.json(stats);
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Stats failed' }); }
});

export default router;
