// ============================================================
// ClearPathGPS Integration Routes
// ============================================================
// Admin endpoints for configuring credentials, managing
// device-to-unit mappings, and controlling the GPS poller.

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import { auditLog } from '../utils/auditLogger';
import { broadcastAdminUpdate, broadcastFleetUpdate } from '../utils/websocket';
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
import {
  startClearPathGpsMediaPoller,
  stopClearPathGpsMediaPoller,
  restartClearPathGpsMediaPoller,
  triggerMediaSync,
} from '../utils/clearPathGpsMediaPoller';

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

    // Media sync status
    const mediaSyncEnabled = getConfigValue('clearpathgps_media_sync_enabled') === 'true';
    const mediaPollInterval = getConfigValue('clearpathgps_media_poll_interval') || '300';
    const lastMediaSync = (db.prepare(
      'SELECT MAX(last_media_synced_at) as ts FROM cpg_device_mappings WHERE is_active = 1'
    ).get() as any)?.ts || null;

    res.json({
      configured,
      enabled,
      poll_interval_seconds: parseInt(pollInterval, 10),
      active_mappings: mappingCount,
      last_sync: lastSync,
      media_sync_enabled: mediaSyncEnabled,
      media_poll_interval_seconds: parseInt(mediaPollInterval, 10),
      last_media_sync: lastMediaSync,
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

    auditLog(req, 'clearpathgps_credentials_updated', 'integration', 0, 'Updated ClearPathGPS credentials');
    broadcastAdminUpdate({ type: 'clearpathgps_credentials_updated' });

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

    auditLog(req, 'clearpathgps_credentials_cleared', 'integration', 0, 'Cleared ClearPathGPS credentials');
    broadcastAdminUpdate({ type: 'clearpathgps_credentials_cleared' });

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
    console.error('ClearPathGPS connection test error:', error.message);
    res.json({ success: false, deviceCount: 0, error: 'Connection test failed' });
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
    console.error('ClearPathGPS account discovery error:', error.message);
    res.json({ accounts: [], error: 'Account discovery failed' });
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

    auditLog(req, 'clearpathgps_toggled', 'integration', 0, `ClearPathGPS ${enabled ? 'enabled' : 'disabled'}`);
    broadcastAdminUpdate({ type: 'clearpathgps_toggled', enabled });

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
    res.status(500).json({ error: 'Failed to fetch devices' });
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

    auditLog(req, 'clearpathgps_mapping_created', 'integration', unit_id,
      `Mapped device ${cpg_display_name || cpg_device_id} → ${unit.call_sign}`);
    broadcastFleetUpdate({ type: 'clearpathgps_mapping_created', unitId: unit_id, callSign: unit.call_sign });

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

    auditLog(req, 'clearpathgps_mapping_removed', 'integration', mapping.unit_id,
      `Unmapped device ${mapping.cpg_display_name || mapping.cpg_device_id}`);
    broadcastFleetUpdate({ type: 'clearpathgps_mapping_removed', unitId: mapping.unit_id });

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

    auditLog(req, 'clearpathgps_settings_updated', 'integration', 0, `History backfill: ${history_backfill}`);
    broadcastAdminUpdate({ type: 'clearpathgps_settings_updated' });

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

    const deviceId = req.params.deviceId as string;
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
    res.status(500).json({ error: 'Failed to fetch device history' });
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
    const officerId = parseInt(req.params.officerId as string, 10);
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

// ============================================================
// GET /api/clearpathgps/media-status — media sync status
// ============================================================
router.get('/media-status', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const mediaSyncEnabled = getConfigValue('clearpathgps_media_sync_enabled') === 'true';
    const mediaPollInterval = getConfigValue('clearpathgps_media_poll_interval') || '300';

    const lastSync = (db.prepare(
      'SELECT MAX(last_media_synced_at) as ts FROM cpg_device_mappings WHERE is_active = 1'
    ).get() as any)?.ts || null;

    const stats = db.prepare(`
      SELECT COUNT(*) as total_clips,
             COALESCE(SUM(file_size), 0) as total_bytes
      FROM dashcam_videos
      WHERE source = 'clearpathgps'
    `).get() as any;

    const errorCount = (db.prepare(`
      SELECT COALESCE(SUM(media_sync_errors), 0) as total
      FROM cpg_device_mappings WHERE is_active = 1
    `).get() as any)?.total || 0;

    // Per-device sync status
    const devices = db.prepare(`
      SELECT m.cpg_device_id, m.cpg_display_name, m.last_media_synced_at,
             m.media_sync_errors, u.call_sign
      FROM cpg_device_mappings m
      LEFT JOIN units u ON m.unit_id = u.id
      WHERE m.is_active = 1
    `).all();

    res.json({
      media_sync_enabled: mediaSyncEnabled,
      media_poll_interval_seconds: parseInt(mediaPollInterval, 10),
      last_media_sync: lastSync,
      total_synced_clips: stats.total_clips || 0,
      total_synced_bytes: stats.total_bytes || 0,
      sync_errors: errorCount,
      devices,
    });
  } catch (error: any) {
    console.error('ClearPathGPS media status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// PUT /api/clearpathgps/media-settings — toggle + configure sync
// ============================================================
router.put('/media-settings', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { media_sync_enabled, media_poll_interval_seconds } = req.body;

    if (media_sync_enabled !== undefined) {
      setConfigValue('clearpathgps_media_sync_enabled', String(!!media_sync_enabled));
    }

    if (media_poll_interval_seconds !== undefined) {
      const interval = Math.max(60, Math.min(900, parseInt(String(media_poll_interval_seconds), 10) || 300));
      setConfigValue('clearpathgps_media_poll_interval', String(interval));
    }

    // Start/stop/restart the media poller based on new settings
    const nowEnabled = getConfigValue('clearpathgps_media_sync_enabled') === 'true';
    if (nowEnabled && isConfigured() && isEnabled()) {
      restartClearPathGpsMediaPoller();
    } else {
      stopClearPathGpsMediaPoller();
    }

    auditLog(req, 'clearpathgps_media_settings_updated', 'integration', 0,
      `Media sync ${nowEnabled ? 'enabled' : 'disabled'}, interval: ${media_poll_interval_seconds}s`,
    );

    broadcastAdminUpdate({ type: 'clearpathgps_media_toggled', enabled: nowEnabled });

    res.json({ success: true, media_sync_enabled: nowEnabled });
  } catch (error: any) {
    console.error('ClearPathGPS media settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /api/clearpathgps/media-sync-now — trigger immediate sync
// ============================================================
router.post('/media-sync-now', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    if (!isConfigured() || !isEnabled()) {
      res.status(400).json({ error: 'ClearPathGPS is not configured or not enabled' });
      return;
    }

    auditLog(req, 'clearpathgps_media_sync_triggered', 'integration', 0, 'Manual media sync triggered');

    // Run sync in background, return immediately
    const result = await triggerMediaSync();

    res.json({
      success: true,
      message: `Media sync completed: ${result.synced} clip(s) synced, ${result.errors} error(s)`,
      synced: result.synced,
      errors: result.errors,
    });
  } catch (error: any) {
    console.error('ClearPathGPS media sync-now error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
