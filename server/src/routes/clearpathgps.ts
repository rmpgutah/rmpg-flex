// ============================================================
// ClearPathGPS Integration Routes — v3.0 API
// ============================================================
// Admin endpoints for configuring credentials, managing
// device-to-unit mappings, controlling the GPS poller,
// and accessing v3.0 Media/Geozone/Driver endpoints.

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
  getDeviceLatest,
  discoverAccounts,
  getMediaList,
  getMediaDetail,
  downloadMedia,
  cpgStreamTo,
  requestMedia,
  pingCamera,
  getGeozones,
  getDrivers,
  getStatusCodes,
  getDeviceGroups,
  search,
  toEpochSeconds,
} from '../utils/clearPathGpsClient';
import {
  startClearPathGpsPoller,
  stopClearPathGpsPoller,
  restartClearPathGpsPoller,
  forcePoll,
  fullSync,
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
      api_version: '3.0',
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
// POST /api/clearpathgps/poll-now — force immediate position poll
// ============================================================
router.post('/poll-now', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    console.log(`[ClearPathGPS] Manual poll triggered by user ${req.user!.userId}`);
    await forcePoll();

    const db = getDb();
    const recentBreadcrumbs = (db.prepare(
      "SELECT COUNT(*) as cnt FROM gps_breadcrumbs WHERE gps_source = 'clearpathgps' AND recorded_at >= datetime('now', '-2 minutes')"
    ).get() as any)?.cnt || 0;
    const mappedUnits = (db.prepare(
      "SELECT COUNT(*) as cnt FROM units WHERE gps_source = 'clearpathgps'"
    ).get() as any)?.cnt || 0;

    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'clearpathgps_manual_poll', 'integration', 0, ?, ?)"
    ).run(req.user!.userId, `Manual poll: ${mappedUnits} units, ${recentBreadcrumbs} breadcrumbs`, req.ip || 'unknown');

    res.json({ success: true, units_updated: mappedUnits, breadcrumbs: recentBreadcrumbs });
  } catch (error: any) {
    console.error('ClearPathGPS manual poll error:', error);
    res.status(500).json({ success: false, error: error.message || 'Poll failed' });
  }
});

// ============================================================
// POST /api/clearpathgps/full-sync — mandatory comprehensive data pull
// ============================================================
router.post('/full-sync', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    console.log(`[ClearPathGPS] Full sync triggered by user ${req.user!.userId}`);

    const result = await fullSync();

    const db = getDb();
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'clearpathgps_full_sync', 'integration', 0, ?, ?)"
    ).run(
      req.user!.userId,
      `Full sync: API ${result.apiVersion}, ${result.devices.count} devices, ${result.fleetPositions.breadcrumbsInserted} breadcrumbs, ${result.deviceHistory.totalPoints} history pts, ${result.media.videoUrls} videos, ${result.geozones.count} geozones, ${result.drivers.count} drivers — ${(result.duration_ms / 1000).toFixed(1)}s`,
      req.ip || 'unknown'
    );

    res.json(result);
  } catch (error: any) {
    console.error('ClearPathGPS full sync error:', error);
    res.status(500).json({ error: error.message || 'Full sync failed' });
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
        usr.full_name as officer_name, usr.id as officer_id
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
// GET /api/clearpathgps/history/:deviceId — fetch device history (v3.0)
// Accepts from/to as ISO strings or epoch seconds
// ============================================================
router.get('/history/:deviceId', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!isConfigured()) {
      res.status(400).json({ error: 'ClearPathGPS not configured' });
      return;
    }

    const { deviceId } = req.params;
    const fromRaw = req.query.from as string;
    const toRaw = req.query.to as string;

    if (!fromRaw || !toRaw) {
      res.status(400).json({ error: 'from and to query parameters are required (ISO date strings or epoch seconds)' });
      return;
    }

    // Accept both ISO strings and epoch integers
    const from = /^\d+$/.test(fromRaw) ? Number(fromRaw) : fromRaw;
    const to = /^\d+$/.test(toRaw) ? Number(toRaw) : toRaw;

    const events = await getDeviceHistory(deviceId, from, to);
    res.json({ events, count: events.length });
  } catch (error: any) {
    console.error('ClearPathGPS fetch history error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch device history' });
  }
});

// ============================================================
// GET /api/clearpathgps/device/:deviceId/latest — latest event for one device
// ============================================================
router.get('/device/:deviceId/latest', requireRole('admin', 'manager', 'supervisor'), async (req: Request, res: Response) => {
  try {
    if (!isConfigured()) {
      res.status(400).json({ error: 'ClearPathGPS not configured' });
      return;
    }

    const event = await getDeviceLatest(req.params.deviceId);
    if (!event) {
      res.status(404).json({ error: 'No events found for device' });
      return;
    }
    res.json(event);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch device latest' });
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

// ============================================================
// v3.0 Media Endpoints
// ============================================================

// GET /api/clearpathgps/media/:deviceId — list media events
router.get('/media/:deviceId', requireRole('admin', 'manager', 'supervisor', 'officer'), async (req: Request, res: Response) => {
  try {
    if (!isConfigured()) { res.status(400).json({ error: 'ClearPathGPS not configured' }); return; }

    const { deviceId } = req.params;
    const fromRaw = req.query.from as string;
    const toRaw = req.query.to as string;
    const mediaType = req.query.mediaType as 'image' | 'video' | undefined;
    const eventType = req.query.eventType as string | undefined;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : undefined;

    // Default: last 24 hours
    const now = Math.floor(Date.now() / 1000);
    const from = fromRaw ? (/^\d+$/.test(fromRaw) ? Number(fromRaw) : toEpochSeconds(fromRaw)) : now - 86400;
    const to = toRaw ? (/^\d+$/.test(toRaw) ? Number(toRaw) : toEpochSeconds(toRaw)) : now;

    const result = await getMediaList(deviceId, from, to, { mediaType, eventType, page, pageSize });
    res.json(result);
  } catch (error: any) {
    console.error('ClearPathGPS media list error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch media list' });
  }
});

// GET /api/clearpathgps/media/:deviceId/detail — get media for specific timestamp
router.get('/media/:deviceId/detail', requireRole('admin', 'manager', 'supervisor', 'officer'), async (req: Request, res: Response) => {
  try {
    if (!isConfigured()) { res.status(400).json({ error: 'ClearPathGPS not configured' }); return; }

    const timestamp = parseInt(req.query.timestamp as string, 10);
    if (isNaN(timestamp)) { res.status(400).json({ error: 'timestamp query parameter required (epoch)' }); return; }

    const result = await getMediaDetail(req.params.deviceId, timestamp);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch media detail' });
  }
});

// GET /api/clearpathgps/media/:deviceId/download — stream media download (no buffering)
router.get('/media/:deviceId/download', requireRole('admin', 'manager', 'supervisor', 'officer'), async (req: Request, res: Response) => {
  try {
    if (!isConfigured()) { res.status(400).json({ error: 'ClearPathGPS not configured' }); return; }

    const timestamp = parseInt(req.query.timestamp as string, 10);
    if (isNaN(timestamp)) { res.status(400).json({ error: 'timestamp query parameter required (epoch)' }); return; }

    // Stream directly from ClearPathGPS → client (no memory buffering)
    await cpgStreamTo(
      `/media/download/${encodeURIComponent(req.params.deviceId)}?timestamp=${timestamp}`,
      res
    );
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to download media' });
    }
  }
});

// POST /api/clearpathgps/media/:deviceId/request — request new recording
router.post('/media/:deviceId/request', requireRole('admin', 'manager', 'supervisor'), async (req: Request, res: Response) => {
  try {
    if (!isConfigured()) { res.status(400).json({ error: 'ClearPathGPS not configured' }); return; }

    const body = req.body || { insideCam: true, outsideCam: true, insideType: 'video', outsideType: 'video' };
    if (!body.timestamp) body.timestamp = Math.floor(Date.now() / 1000);

    const result = await requestMedia(req.params.deviceId, body);
    res.json({ message: 'Media request sent', result });
  } catch (error: any) {
    // 424 means camera unavailable
    const status = error.message?.includes('424') ? 424 : 500;
    res.status(status).json({ error: error.message || 'Failed to request media' });
  }
});

// GET /api/clearpathgps/media/:deviceId/ping — check camera status
router.get('/media/:deviceId/ping', requireRole('admin', 'manager', 'supervisor', 'officer'), async (req: Request, res: Response) => {
  try {
    if (!isConfigured()) { res.status(400).json({ error: 'ClearPathGPS not configured' }); return; }

    const result = await pingCamera(req.params.deviceId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to ping camera' });
  }
});

// ============================================================
// v3.0 Geozone Endpoints
// ============================================================

// GET /api/clearpathgps/geozones — list all geozones
router.get('/geozones', requireRole('admin', 'manager', 'supervisor'), async (_req: Request, res: Response) => {
  try {
    if (!isConfigured()) { res.status(400).json({ error: 'ClearPathGPS not configured' }); return; }
    const geozones = await getGeozones();
    res.json({ geozones });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch geozones' });
  }
});

// ============================================================
// v3.0 Driver Endpoints
// ============================================================

// GET /api/clearpathgps/drivers — list all drivers
router.get('/drivers', requireRole('admin', 'manager', 'supervisor'), async (_req: Request, res: Response) => {
  try {
    if (!isConfigured()) { res.status(400).json({ error: 'ClearPathGPS not configured' }); return; }
    const drivers = await getDrivers();
    res.json({ drivers });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch drivers' });
  }
});

// ============================================================
// v3.0 Device Groups
// ============================================================

// GET /api/clearpathgps/groups — list device groups
router.get('/groups', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    if (!isConfigured()) { res.status(400).json({ error: 'ClearPathGPS not configured' }); return; }
    const withDevices = req.query.withDevices === 'true';
    const groups = await getDeviceGroups(withDevices);
    res.json({ groups });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch groups' });
  }
});

// ============================================================
// v3.0 Status Codes + Search
// ============================================================

// GET /api/clearpathgps/status-codes — list all event status codes
router.get('/status-codes', requireRole('admin', 'manager'), async (_req: Request, res: Response) => {
  try {
    if (!isConfigured()) { res.status(400).json({ error: 'ClearPathGPS not configured' }); return; }
    const codes = await getStatusCodes();
    res.json(codes);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch status codes' });
  }
});

// GET /api/clearpathgps/search — search devices, groups, geozones, drivers
router.get('/search', requireRole('admin', 'manager', 'supervisor'), async (req: Request, res: Response) => {
  try {
    if (!isConfigured()) { res.status(400).json({ error: 'ClearPathGPS not configured' }); return; }
    const q = req.query.q as string;
    if (!q || q.length < 3) { res.status(400).json({ error: 'Search query must be at least 3 characters' }); return; }
    const results = await search(q);
    res.json({ results });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Search failed' });
  }
});

export default router;
