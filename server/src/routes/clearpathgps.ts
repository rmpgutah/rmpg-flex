// ============================================================
// ClearPathGPS Integration Routes
// ============================================================
// Admin endpoints for configuring credentials, managing
// device-to-unit mappings, and controlling the GPS poller.

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import {
  CONFIG_KEYS,
  getConfigValue,
  setConfigValue,
  deleteConfigValue,
  clearCachedAuth,
  isConfigured,
  isEnabled,
  testConnection,
  getDevices,
  getDeviceHistory,
  discoverAccounts,
} from '../utils/clearPathGpsClient';
import {
  startClearPathGpsPoller,
  stopClearPathGpsPoller,
  restartClearPathGpsPoller,
} from '../utils/clearPathGpsPoller';

const router = Router();
router.use(authenticateToken);

// ============================================================
// GET /api/clearpathgps/status — connection + poller status
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
    console.error('ClearPathGPS status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// PUT /api/clearpathgps/credentials — save encrypted credentials
// ============================================================
router.put('/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { email, password, account_id } = req.body;

    if (!email || !password || !account_id) {
      res.status(400).json({ error: 'email, password, and account_id are required' });
      return;
    }

    setConfigValue(CONFIG_KEYS.email, email, true);
    setConfigValue(CONFIG_KEYS.password, password, true);
    setConfigValue(CONFIG_KEYS.accountId, account_id, true);
    clearCachedAuth();

    const db = getDb();
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'clearpathgps_credentials_updated', 'integration', 0, ?, ?)"
    ).run(req.user!.userId, 'Updated ClearPathGPS credentials', req.ip || 'unknown');

    res.json({ message: 'Credentials saved' });
  } catch (error: any) {
    console.error('ClearPathGPS save credentials error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// DELETE /api/clearpathgps/credentials — clear all config
// ============================================================
router.delete('/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    Object.values(CONFIG_KEYS).forEach(key => deleteConfigValue(key));
    clearCachedAuth();
    stopClearPathGpsPoller();

    const db = getDb();
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'clearpathgps_credentials_cleared', 'integration', 0, ?, ?)"
    ).run(req.user!.userId, 'Cleared ClearPathGPS credentials', req.ip || 'unknown');

    res.json({ message: 'Credentials and configuration cleared' });
  } catch (error: any) {
    console.error('ClearPathGPS clear credentials error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /api/clearpathgps/test-connection — test API auth
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
// POST /api/clearpathgps/discover-accounts — find available accounts
// ============================================================
router.post('/discover-accounts', requireRole('admin'), async (_req: Request, res: Response) => {
  try {
    const accounts = await discoverAccounts();
    res.json({ accounts });
  } catch (error: any) {
    res.json({ accounts: [], error: error.message || 'Account discovery failed' });
  }
});

// ============================================================
// PUT /api/clearpathgps/enable — toggle integration + interval
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
      restartClearPathGpsPoller();
    } else {
      stopClearPathGpsPoller();
      // Reset gps_source for all units back to browser
      if (!enabled) {
        const db = getDb();
        db.prepare("UPDATE units SET gps_source = 'browser' WHERE gps_source = 'clearpathgps'").run();
      }
    }

    const db = getDb();
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'clearpathgps_toggled', 'integration', 0, ?, ?)"
    ).run(req.user!.userId, `ClearPathGPS ${enabled ? 'enabled' : 'disabled'}`, req.ip || 'unknown');

    res.json({ message: `ClearPathGPS ${enabled ? 'enabled' : 'disabled'}` });
  } catch (error: any) {
    console.error('ClearPathGPS enable/disable error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/clearpathgps/devices — fetch device list from API
// ============================================================
router.get('/devices', requireRole('admin', 'manager'), async (_req: Request, res: Response) => {
  try {
    if (!isConfigured()) {
      res.status(400).json({ error: 'ClearPathGPS not configured' });
      return;
    }

    const devices = await getDevices();
    res.json({ devices });
  } catch (error: any) {
    console.error('ClearPathGPS fetch devices error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch devices' });
  }
});

// ============================================================
// GET /api/clearpathgps/mappings — list device-to-unit mappings
// ============================================================
router.get('/mappings', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const mappings = db.prepare(`
      SELECT m.*, u.call_sign, u.status as unit_status,
        usr.full_name as officer_name
      FROM cpg_device_mappings m
      LEFT JOIN units u ON m.unit_id = u.id
      LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE m.is_active = 1
      ORDER BY m.cpg_display_name
    `).all();

    res.json({ mappings });
  } catch (error: any) {
    console.error('ClearPathGPS fetch mappings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /api/clearpathgps/mappings — create device→unit mapping
// ============================================================
router.post('/mappings', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { cpg_device_id, cpg_display_name, cpg_serial_number, unit_id } = req.body;

    if (!cpg_device_id || !unit_id) {
      res.status(400).json({ error: 'cpg_device_id and unit_id are required' });
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
    ).get(cpg_device_id) as any;

    if (existing) {
      db.prepare(`
        UPDATE cpg_device_mappings
        SET unit_id = ?, cpg_display_name = ?, cpg_serial_number = ?, is_active = 1, updated_at = ?
        WHERE id = ?
      `).run(unit_id, cpg_display_name || null, cpg_serial_number || null, now, existing.id);
    } else {
      db.prepare(`
        INSERT INTO cpg_device_mappings (cpg_device_id, cpg_display_name, cpg_serial_number, unit_id, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run(cpg_device_id, cpg_display_name || null, cpg_serial_number || null, unit_id, now, now);
    }

    // Set unit's GPS source to clearpathgps
    db.prepare("UPDATE units SET gps_source = 'clearpathgps' WHERE id = ?").run(unit_id);

    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'clearpathgps_mapping_created', 'cpg_device_mapping', ?, ?, ?)"
    ).run(req.user!.userId, unit_id, `Mapped device ${cpg_display_name || cpg_device_id} → ${unit.call_sign}`, req.ip || 'unknown');

    res.json({ message: 'Mapping created', unit_call_sign: unit.call_sign });
  } catch (error: any) {
    console.error('ClearPathGPS create mapping error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// DELETE /api/clearpathgps/mappings/:id — remove mapping
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
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'clearpathgps_mapping_removed', 'cpg_device_mapping', ?, ?, ?)"
    ).run(req.user!.userId, mapping.unit_id, `Unmapped device ${mapping.cpg_display_name || mapping.cpg_device_id}`, req.ip || 'unknown');

    res.json({ message: 'Mapping removed' });
  } catch (error: any) {
    console.error('ClearPathGPS remove mapping error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/clearpathgps/settings — get integration settings
// ============================================================
router.get('/settings', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    const historyBackfill = getConfigValue('clearpathgps_history_backfill');
    res.json({
      history_backfill: historyBackfill !== 'false', // default true
    });
  } catch (error: any) {
    console.error('ClearPathGPS get settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// PUT /api/clearpathgps/settings — update integration settings
// ============================================================
router.put('/settings', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { history_backfill } = req.body;

    if (typeof history_backfill === 'boolean') {
      setConfigValue('clearpathgps_history_backfill', String(history_backfill), false);
    }

    const db = getDb();
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'clearpathgps_settings_updated', 'integration', 0, ?, ?)"
    ).run(req.user!.userId, `History backfill: ${history_backfill}`, req.ip || 'unknown');

    res.json({ message: 'Settings updated' });
  } catch (error: any) {
    console.error('ClearPathGPS update settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/clearpathgps/history/:deviceId — fetch device history from API
// ============================================================
router.get('/history/:deviceId', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!isConfigured()) {
      res.status(400).json({ error: 'ClearPathGPS not configured' });
      return;
    }

    const { deviceId } = req.params;
    const from = req.query.from as string;
    const to = req.query.to as string;

    if (!from || !to) {
      res.status(400).json({ error: 'from and to query parameters are required (ISO date strings)' });
      return;
    }

    const events = await getDeviceHistory(deviceId, String(from), String(to));
    res.json({ events, count: events.length });
  } catch (error: any) {
    console.error('ClearPathGPS fetch history error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch device history' });
  }
});

// ============================================================
// GET /api/clearpathgps/dashcam-events — list dashcam events
// ============================================================
router.get('/dashcam-events', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { from, to, device_id, event_type, limit: limitStr } = req.query;
    const limit = Math.min(parseInt(limitStr as string, 10) || 100, 500);

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
    console.error('ClearPathGPS fetch dashcam events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/clearpathgps/dashcam-events/by-officer/:officerId
// Must be defined BEFORE /dashcam-events/:id to avoid Express
// matching "by-officer" as a numeric :id parameter.
// ============================================================
router.get('/dashcam-events/by-officer/:officerId', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const officerId = parseInt(req.params.officerId, 10);
    if (isNaN(officerId)) { res.status(400).json({ error: 'Invalid officer ID' }); return; }

    const { from, to, event_type, limit: limitStr } = req.query;
    const limit = Math.min(parseInt(String(limitStr), 10) || 100, 500);

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
    console.error('ClearPathGPS fetch officer dashcam events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /api/clearpathgps/dashcam-events/:id — single event detail
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
      res.status(404).json({ error: 'Dashcam event not found' });
      return;
    }

    res.json(event);
  } catch (error: any) {
    console.error('ClearPathGPS fetch dashcam event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
