// ============================================================
// ClearPathGPS Integration Routes
// ============================================================
// Manages ClearPathGPS fleet tracking credentials, connection
// testing, data sync, and historical data scraping.
// Credentials are encrypted with AES-256-GCM (same as MicroBilt).

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import config from '../config';
import {
  getCredentials, isConfigured, testConnection,
  getVehicles, getTrips, getLocations, getAlerts,
  generateDateChunks,
  type ClearPathGpsCredentials,
} from '../utils/clearPathGpsClient';

const router = Router();
router.use(authenticateToken);

// ─── Encryption helpers ─────────────────────────────────────

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

// ─── Config helpers ─────────────────────────────────────────

function setConfigValue(key: string, value: string, encrypted = false) {
  const db = getDb();
  const stored = encrypted ? encrypt(value) : value;
  const existing = db.prepare(
    "SELECT id FROM system_config WHERE config_key = ? AND category = 'integrations'"
  ).get(key) as any;
  if (existing) {
    db.prepare(
      "UPDATE system_config SET config_value = ?, updated_at = datetime('now','localtime') WHERE id = ?"
    ).run(stored, existing.id);
  } else {
    db.prepare(
      "INSERT INTO system_config (config_key, config_value, category, is_active) VALUES (?, ?, 'integrations', 1)"
    ).run(key, stored);
  }
}

function removeConfigValues(keys: string[]) {
  const db = getDb();
  for (const key of keys) {
    db.prepare("DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'").run(key);
  }
}

// ═══════════════════════════════════════════════════════════════
// Credential Management
// ═══════════════════════════════════════════════════════════════

// GET /api/clearpathgps/status — Connection status
router.get('/status', (req: Request, res: Response) => {
  try {
    const configured = isConfigured();
    const db = getDb();
    const lastSync = db.prepare(
      "SELECT * FROM cpgps_sync_log ORDER BY started_at DESC LIMIT 1"
    ).get() as any;
    const vehicleCount = (db.prepare('SELECT COUNT(*) as c FROM cpgps_vehicles').get() as any)?.c || 0;
    const tripCount = (db.prepare('SELECT COUNT(*) as c FROM cpgps_trips').get() as any)?.c || 0;
    const locationCount = (db.prepare('SELECT COUNT(*) as c FROM cpgps_locations').get() as any)?.c || 0;
    const alertCount = (db.prepare('SELECT COUNT(*) as c FROM cpgps_alerts').get() as any)?.c || 0;

    res.json({
      configured,
      lastSync: lastSync || null,
      counts: { vehicles: vehicleCount, trips: tripCount, locations: locationCount, alerts: alertCount },
    });
  } catch (error: any) {
    console.error('ClearPathGPS status error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps status', code: 'CLEARPATHGPS_STATUS_ERROR' });
  }
});

// POST /api/clearpathgps/configure — Save credentials
router.post('/configure', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { account, user, password, base_url } = req.body;
    if (!account || !user || !password) {
      res.status(400).json({ error: 'account, user, and password are required', code: 'ACCOUNT_USER_AND_PASSWORD' });
      return;
    }
    setConfigValue('clearpathgps_account', account, true);
    setConfigValue('clearpathgps_user', user, true);
    setConfigValue('clearpathgps_password', password, true);
    setConfigValue('clearpathgps_base_url', base_url || 'https://api.clearpathgps.com:8443', false);

    // Activity log
    const db = getDb();
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, details, ip_address)
      VALUES (?, 'configure_clearpathgps', 'integration', 'ClearPathGPS credentials configured', ?)
    `).run(req.user!.userId, req.ip || 'unknown');

    res.json({ message: 'ClearPathGPS credentials saved' });
  } catch (error: any) {
    console.error('ClearPathGPS configure error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps configure', code: 'CLEARPATHGPS_CONFIGURE_ERROR' });
  }
});

// POST /api/clearpathgps/test — Test connection
router.post('/test', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    // Allow testing with provided creds or stored creds
    let creds: ClearPathGpsCredentials | null = null;
    if (req.body.account && req.body.user && req.body.password) {
      creds = {
        account: req.body.account,
        user: req.body.user,
        password: req.body.password,
        baseUrl: req.body.base_url || 'https://api.clearpathgps.com:8443',
      };
    } else {
      creds = getCredentials();
    }

    if (!creds) {
      res.status(400).json({ error: 'No credentials configured', code: 'NO_CREDENTIALS_CONFIGURED' });
      return;
    }

    const success = await testConnection(creds);
    res.json({ success, message: success ? 'Connection successful' : 'Connection failed' });
  } catch (error: any) {
    res.json({ success: false, message: error?.message || 'Connection failed' });
  }
});

// DELETE /api/clearpathgps/configure — Remove credentials
router.delete('/configure', requireRole('admin'), (req: Request, res: Response) => {
  try {
    removeConfigValues(['clearpathgps_account', 'clearpathgps_user', 'clearpathgps_password', 'clearpathgps_base_url']);
    res.json({ message: 'ClearPathGPS credentials removed' });
  } catch (error: any) {
    console.error('ClearPathGPS remove config error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps remove config', code: 'CLEARPATHGPS_REMOVE_CONFIG_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Data Endpoints (read from local cache)
// ═══════════════════════════════════════════════════════════════

// GET /api/clearpathgps/vehicles — Cached vehicles
router.get('/vehicles', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicles = db.prepare(`
      SELECT cv.*, fv.vehicle_number AS fleet_vehicle_number,
        fv.make AS fleet_make, fv.model AS fleet_model, fv.year AS fleet_year
      FROM cpgps_vehicles cv
      LEFT JOIN fleet_vehicles fv ON cv.vehicle_id = fv.id
      ORDER BY cv.name ASC
    
      LIMIT 1000
    `).all();
    res.json(vehicles);
  } catch (error: any) {
    console.error('ClearPathGPS vehicles error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps vehicles', code: 'CLEARPATHGPS_VEHICLES_ERROR' });
  }
});

// GET /api/clearpathgps/vehicles/:id/trips
router.get('/vehicles/:id/trips', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const cpgpsVehicle = db.prepare('SELECT * FROM cpgps_vehicles WHERE id = ?').get(req.params.id) as any;
    if (!cpgpsVehicle) { res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }); return; }
    const { page = '1', per_page = '100000' } = req.query;
    const pageNum = parseInt(page as string, 10) || 1;
    const perPage = Math.min(100000, Math.max(1, (parseInt(per_page as string, 10)) || 100000));
    const offset = (pageNum - 1) * perPage;
    const total = (db.prepare('SELECT COUNT(*) as c FROM cpgps_trips WHERE cpgps_vehicle_id = ?').get(cpgpsVehicle.cpgps_id) as any)?.c || 0;
    const trips = db.prepare(
      'SELECT * FROM cpgps_trips WHERE cpgps_vehicle_id = ? ORDER BY trip_start DESC LIMIT ? OFFSET ?'
    ).all(cpgpsVehicle.cpgps_id, perPage, offset);
    res.json({ trips, total, page: pageNum, per_page: perPage });
  } catch (error: any) {
    console.error('ClearPathGPS trips error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps trips', code: 'CLEARPATHGPS_TRIPS_ERROR' });
  }
});

// GET /api/clearpathgps/vehicles/:id/locations
router.get('/vehicles/:id/locations', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const cpgpsVehicle = db.prepare('SELECT * FROM cpgps_vehicles WHERE id = ?').get(req.params.id) as any;
    if (!cpgpsVehicle) { res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }); return; }
    const { limit = '100000' } = req.query;
    const locations = db.prepare(
      'SELECT * FROM cpgps_locations WHERE cpgps_vehicle_id = ? ORDER BY reported_at DESC LIMIT ?'
    ).all(cpgpsVehicle.cpgps_id, parseInt(limit as string, 10) || 200);
    res.json(locations);
  } catch (error: any) {
    console.error('ClearPathGPS locations error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps locations', code: 'CLEARPATHGPS_LOCATIONS_ERROR' });
  }
});

// GET /api/clearpathgps/vehicles/:id/alerts
router.get('/vehicles/:id/alerts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const cpgpsVehicle = db.prepare('SELECT * FROM cpgps_vehicles WHERE id = ?').get(req.params.id) as any;
    if (!cpgpsVehicle) { res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }); return; }
    const { limit = '100000' } = req.query;
    const alerts = db.prepare(
      'SELECT * FROM cpgps_alerts WHERE cpgps_vehicle_id = ? ORDER BY triggered_at DESC LIMIT ?'
    ).all(cpgpsVehicle.cpgps_id, parseInt(limit as string, 10) || 100);
    res.json(alerts);
  } catch (error: any) {
    console.error('ClearPathGPS alerts error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps alerts', code: 'CLEARPATHGPS_ALERTS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Vehicle Linking
// ═══════════════════════════════════════════════════════════════

// POST /api/clearpathgps/link-vehicle — Link ClearPathGPS vehicle to fleet vehicle
router.post('/link-vehicle', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { cpgps_vehicle_id, fleet_vehicle_id } = req.body;
    if (!cpgps_vehicle_id) {
      res.status(400).json({ error: 'cpgps_vehicle_id required', code: 'CPGPSVEHICLEID_REQUIRED' });
      return;
    }
    db.prepare('UPDATE cpgps_vehicles SET vehicle_id = ? WHERE id = ?')
      .run(fleet_vehicle_id || null, cpgps_vehicle_id);
    // Also update trips, locations, alerts
    const cpgps = db.prepare('SELECT cpgps_id FROM cpgps_vehicles WHERE id = ?').get(cpgps_vehicle_id) as any;
    if (cpgps) {
      const vid = fleet_vehicle_id || null;
      db.prepare('UPDATE cpgps_trips SET vehicle_id = ? WHERE cpgps_vehicle_id = ?').run(vid, cpgps.cpgps_id);
      db.prepare('UPDATE cpgps_locations SET vehicle_id = ? WHERE cpgps_vehicle_id = ?').run(vid, cpgps.cpgps_id);
      db.prepare('UPDATE cpgps_alerts SET vehicle_id = ? WHERE cpgps_vehicle_id = ?').run(vid, cpgps.cpgps_id);
    }
    res.json({ message: 'Vehicle linked' });
  } catch (error: any) {
    console.error('ClearPathGPS link vehicle error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps link vehicle', code: 'CLEARPATHGPS_LINK_VEHICLE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Sync & Scrape
// ═══════════════════════════════════════════════════════════════

// Track running scrape
let scrapeRunning = false;
let scrapeProgress = { stage: '', vehicleIndex: 0, vehicleTotal: 0, chunksProcessed: 0, chunksTotal: 0 };

// POST /api/clearpathgps/sync — Quick sync (latest vehicle data)
router.post('/sync', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const creds = getCredentials();
    if (!creds) { res.status(400).json({ error: 'ClearPathGPS not configured', code: 'CLEARPATHGPS_NOT_CONFIGURED' }); return; }

    const db = getDb();
    const syncLog = db.prepare(
      "INSERT INTO cpgps_sync_log (sync_type, status) VALUES ('quick', 'running')"
    ).run();
    const syncId = syncLog.lastInsertRowid;

    try {
      const vehicles = await getVehicles(creds);
      let stored = 0;

      for (const v of vehicles) {
        const id = String(v.id || v.vehicleId || v.vehicle_id || '');
        if (!id) continue;
        const existing = db.prepare('SELECT id, vehicle_id FROM cpgps_vehicles WHERE cpgps_id = ?').get(id) as any;
        if (existing) {
          db.prepare(`
            UPDATE cpgps_vehicles SET
              name = ?, vin = ?, make = ?, model = ?, year = ?,
              license_plate = ?, device_serial = ?,
              last_lat = ?, last_lon = ?, last_speed = ?, last_heading = ?,
              last_reported_at = ?, odometer = ?, engine_hours = ?,
              raw_json = ?, synced_at = ?
            WHERE cpgps_id = ?
          `).run(
            v.name || v.description || null, v.vin || null, v.make || null, v.model || null, v.year || null,
            v.licensePlate || v.license_plate || null, v.deviceSerial || v.device_serial || null,
            v.latitude || v.lat || null, v.longitude || v.lon || null,
            v.speed || null, v.heading || null,
            v.lastReportedAt || v.last_reported_at || null,
            v.odometer || null, v.engineHours || v.engine_hours || null,
            JSON.stringify(v), localNow(), id,
          );
        } else {
          db.prepare(`
            INSERT INTO cpgps_vehicles (cpgps_id, name, vin, make, model, year, license_plate, device_serial,
              last_lat, last_lon, last_speed, last_heading, last_reported_at, odometer, engine_hours, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            id, v.name || v.description || null, v.vin || null, v.make || null, v.model || null, v.year || null,
            v.licensePlate || v.license_plate || null, v.deviceSerial || v.device_serial || null,
            v.latitude || v.lat || null, v.longitude || v.lon || null,
            v.speed || null, v.heading || null,
            v.lastReportedAt || v.last_reported_at || null,
            v.odometer || null, v.engineHours || v.engine_hours || null,
            JSON.stringify(v),
          );
        }
        stored++;
      }

      db.prepare(
        "UPDATE cpgps_sync_log SET status = 'completed', records_fetched = ?, records_stored = ?, completed_at = ? WHERE id = ?"
      ).run(vehicles.length, stored, localNow(), syncId);

      res.json({ success: true, fetched: vehicles.length, stored });
    } catch (syncErr: any) {
      db.prepare(
        "UPDATE cpgps_sync_log SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?"
      ).run(syncErr?.message || 'Unknown error', localNow(), syncId);
      throw syncErr;
    }
  } catch (error: any) {
    console.error('ClearPathGPS sync error:', error);
    res.status(500).json({ error: error?.message || 'Sync failed' });
  }
});

// POST /api/clearpathgps/scrape — Full historical scrape (runs in background)
router.post('/scrape', requireRole('admin'), async (req: Request, res: Response) => {
  if (scrapeRunning) {
    res.status(409).json({ error: 'A scrape is already in progress', progress: scrapeProgress });
    return;
  }

  const creds = getCredentials();
  if (!creds) { res.status(400).json({ error: 'ClearPathGPS not configured', code: 'CLEARPATHGPS_NOT_CONFIGURED' }); return; }

  scrapeRunning = true;
  scrapeProgress = { stage: 'starting', vehicleIndex: 0, vehicleTotal: 0, chunksProcessed: 0, chunksTotal: 0 };

  // Return immediately — scrape runs in background
  res.json({ message: 'Historical scrape started', status: 'running' });

  const db = getDb();
  const syncLog = db.prepare(
    "INSERT INTO cpgps_sync_log (sync_type, status) VALUES ('full_scrape', 'running')"
  ).run();
  const syncId = syncLog.lastInsertRowid;

  let totalFetched = 0;
  let totalStored = 0;
  let oldestRecord: string | null = null;
  let newestRecord: string | null = null;

  try {
    // Step 1: Sync vehicles
    scrapeProgress.stage = 'vehicles';
    const vehicles = await getVehicles(creds);

    for (const v of vehicles) {
      const id = String(v.id || v.vehicleId || v.vehicle_id || '');
      if (!id) continue;
      const existing = db.prepare('SELECT id FROM cpgps_vehicles WHERE cpgps_id = ?').get(id) as any;
      if (existing) {
        db.prepare(`
          UPDATE cpgps_vehicles SET name = ?, vin = ?, make = ?, model = ?, year = ?,
            license_plate = ?, device_serial = ?, last_lat = ?, last_lon = ?,
            last_speed = ?, last_heading = ?, last_reported_at = ?,
            odometer = ?, engine_hours = ?, raw_json = ?, synced_at = ?
          WHERE cpgps_id = ?
        `).run(
          v.name || v.description || null, v.vin || null, v.make || null, v.model || null, v.year || null,
          v.licensePlate || v.license_plate || null, v.deviceSerial || v.device_serial || null,
          v.latitude || v.lat || null, v.longitude || v.lon || null,
          v.speed || null, v.heading || null,
          v.lastReportedAt || v.last_reported_at || null,
          v.odometer || null, v.engineHours || v.engine_hours || null,
          JSON.stringify(v), localNow(), id,
        );
      } else {
        db.prepare(`
          INSERT INTO cpgps_vehicles (cpgps_id, name, vin, make, model, year, license_plate, device_serial,
            last_lat, last_lon, last_speed, last_heading, last_reported_at, odometer, engine_hours, raw_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, v.name || v.description || null, v.vin || null, v.make || null, v.model || null, v.year || null,
          v.licensePlate || v.license_plate || null, v.deviceSerial || v.device_serial || null,
          v.latitude || v.lat || null, v.longitude || v.lon || null,
          v.speed || null, v.heading || null,
          v.lastReportedAt || v.last_reported_at || null,
          v.odometer || null, v.engineHours || v.engine_hours || null,
          JSON.stringify(v),
        );
      }
    }

    // Step 2: For each vehicle, scrape trips + locations + alerts (up to 24 months)
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 24);
    const chunks = generateDateChunks(startDate);

    const vehicleIds = vehicles.map((v: any) => String(v.id || v.vehicleId || v.vehicle_id || '')).filter(Boolean);
    scrapeProgress.vehicleTotal = vehicleIds.length;
    scrapeProgress.chunksTotal = chunks.length;

    for (let vi = 0; vi < vehicleIds.length; vi++) {
      const vid = vehicleIds[vi];
      scrapeProgress.vehicleIndex = vi + 1;
      scrapeProgress.stage = `vehicle ${vi + 1}/${vehicleIds.length}`;

      // Get linked fleet vehicle id
      const cpgpsRow = db.prepare('SELECT vehicle_id FROM cpgps_vehicles WHERE cpgps_id = ?').get(vid) as any;
      const fleetVehicleId = cpgpsRow?.vehicle_id || null;

      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        scrapeProgress.chunksProcessed = ci + 1;

        try {
          // Trips
          const trips = await getTrips(creds, vid, chunk.start, chunk.end);
          for (const t of trips) {
            const tripStart = t.startTime || t.trip_start || t.start || null;
            const tripEnd = t.endTime || t.trip_end || t.end || null;
            if (tripStart && !oldestRecord) oldestRecord = tripStart;
            if (tripStart) newestRecord = tripStart;

            db.prepare(`
              INSERT OR IGNORE INTO cpgps_trips (cpgps_vehicle_id, vehicle_id, trip_start, trip_end,
                start_lat, start_lon, end_lat, end_lon, start_address, end_address,
                distance_miles, max_speed, avg_speed, idle_duration_seconds, drive_duration_seconds, raw_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              vid, fleetVehicleId, tripStart, tripEnd,
              t.startLatitude || t.start_lat || null, t.startLongitude || t.start_lon || null,
              t.endLatitude || t.end_lat || null, t.endLongitude || t.end_lon || null,
              t.startAddress || t.start_address || null, t.endAddress || t.end_address || null,
              t.distance || t.distance_miles || null, t.maxSpeed || t.max_speed || null,
              t.avgSpeed || t.avg_speed || null,
              t.idleDuration || t.idle_duration_seconds || null,
              t.driveDuration || t.drive_duration_seconds || null,
              JSON.stringify(t),
            );
            totalStored++;
          }
          totalFetched += trips.length;

          // Locations (sample — only store every Nth to avoid millions of rows)
          const locations = await getLocations(creds, vid, chunk.start, chunk.end);
          const step = Math.max(1, Math.floor(locations.length / 100)); // max 100 per chunk
          for (let li = 0; li < locations.length; li += step) {
            const loc = locations[li];
            db.prepare(`
              INSERT INTO cpgps_locations (cpgps_vehicle_id, vehicle_id, lat, lon, speed, heading,
                reported_at, address, ignition_on, raw_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              vid, fleetVehicleId,
              loc.latitude || loc.lat || null, loc.longitude || loc.lon || null,
              loc.speed || null, loc.heading || null,
              loc.reportedAt || loc.reported_at || loc.timestamp || null,
              loc.address || null, loc.ignitionOn != null ? (loc.ignitionOn ? 1 : 0) : null,
              JSON.stringify(loc),
            );
            totalStored++;
          }
          totalFetched += locations.length;

          // Alerts
          const alerts = await getAlerts(creds, vid, chunk.start, chunk.end);
          for (const a of alerts) {
            db.prepare(`
              INSERT INTO cpgps_alerts (cpgps_vehicle_id, vehicle_id, alert_type, severity,
                message, triggered_at, lat, lon, raw_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              vid, fleetVehicleId,
              a.type || a.alert_type || null, a.severity || null,
              a.message || a.description || null,
              a.triggeredAt || a.triggered_at || a.timestamp || null,
              a.latitude || a.lat || null, a.longitude || a.lon || null,
              JSON.stringify(a),
            );
            totalStored++;
          }
          totalFetched += alerts.length;

        } catch (chunkErr: any) {
          console.warn(`ClearPathGPS scrape chunk error (vehicle=${vid}, ${chunk.start}-${chunk.end}):`, chunkErr?.message);
        }

        // Brief pause between chunks to avoid rate limiting
        await new Promise(r => setTimeout(r, 200));
      }
    }

    db.prepare(`
      UPDATE cpgps_sync_log SET status = 'completed', records_fetched = ?, records_stored = ?,
        oldest_record = ?, newest_record = ?, completed_at = ? WHERE id = ?
    `).run(totalFetched, totalStored, oldestRecord, newestRecord, localNow(), syncId);

    console.log(`ClearPathGPS scrape completed: ${totalFetched} fetched, ${totalStored} stored`);
  } catch (error: any) {
    console.error('ClearPathGPS scrape error:', error);
    db.prepare(
      "UPDATE cpgps_sync_log SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?"
    ).run(error?.message || 'Unknown error', localNow(), syncId);
  } finally {
    scrapeRunning = false;
    scrapeProgress = { stage: 'done', vehicleIndex: 0, vehicleTotal: 0, chunksProcessed: 0, chunksTotal: 0 };
  }
});

// GET /api/clearpathgps/sync/status — Check scrape progress
router.get('/sync/status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const logs = db.prepare(
      'SELECT * FROM cpgps_sync_log ORDER BY started_at DESC LIMIT 10'
    ).all();
    res.json({
      running: scrapeRunning,
      progress: scrapeProgress,
      logs,
    });
  } catch (error: any) {
    console.error('ClearPathGPS sync status error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps sync status', code: 'CLEARPATHGPS_SYNC_STATUS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Admin Panel Endpoints (match AdminClearPathGpsTab.tsx)
// ═══════════════════════════════════════════════════════════════

// POST /api/clearpathgps/credentials — Save credentials (alias for /configure)
// Accept both POST (legacy) and PUT (current client). Client sends
// { email, password, account_id }; legacy senders may use
// { account, username, password, base_url }. Honor both shapes.
const credentialsHandler = (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const account = body.account ?? body.account_id;
    const username = body.username ?? body.email;
    const password = body.password;
    const base_url = body.base_url;
    if (!account || !username || !password) {
      res.status(400).json({ error: 'account, username, and password are required', code: 'ACCOUNT_USERNAME_AND_PASSWORD' });
      return;
    }
    setConfigValue('clearpathgps_account', account, true);
    setConfigValue('clearpathgps_user', username, true);
    setConfigValue('clearpathgps_password', password, true);
    if (base_url) setConfigValue('clearpathgps_base_url', base_url, false);

    const db = getDb();
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, details, ip_address)
      VALUES (?, 'configure_clearpathgps', 'integration', 'ClearPathGPS credentials configured', ?)
    `).run(req.user!.userId, req.ip || 'unknown');

    res.json({ success: true, message: 'ClearPathGPS credentials saved' });
  } catch (error: any) {
    console.error('ClearPathGPS save credentials error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps save credentials', code: 'CLEARPATHGPS_SAVE_CREDENTIALS_ERROR' });
  }
};
router.post('/credentials', requireRole('admin'), credentialsHandler);
router.put('/credentials', requireRole('admin'), credentialsHandler);

// DELETE /api/clearpathgps/credentials — Remove credentials
router.delete('/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    removeConfigValues(['clearpathgps_account', 'clearpathgps_user', 'clearpathgps_password', 'clearpathgps_base_url']);
    res.json({ success: true, message: 'ClearPathGPS credentials removed' });
  } catch (error: any) {
    console.error('ClearPathGPS remove credentials error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps remove credentials', code: 'CLEARPATHGPS_REMOVE_CREDENTIALS_ERROR' });
  }
});

// POST /api/clearpathgps/test-connection — Test connection
router.post('/test-connection', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    let creds: ClearPathGpsCredentials | null = null;
    if (req.body.account && req.body.username && req.body.password) {
      creds = {
        account: req.body.account,
        user: req.body.username,
        password: req.body.password,
        baseUrl: req.body.base_url || 'https://api.clearpathgps.com:8443',
      };
    } else {
      creds = getCredentials();
    }
    if (!creds) { res.status(400).json({ success: false, error: 'No credentials configured' }); return; }

    const success = await testConnection(creds);
    if (success) {
      const vehicles = await getVehicles(creds);
      res.json({ success: true, deviceCount: vehicles.length });
    } else {
      res.json({ success: false, error: 'Connection failed — check credentials' });
    }
  } catch (error: any) {
    res.json({ success: false, error: error?.message || 'Connection failed' });
  }
});

// POST /api/clearpathgps/discover-accounts — Discover available accounts
router.post('/discover-accounts', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const creds = getCredentials();
    if (!creds) { res.status(400).json({ error: 'Not configured', code: 'NOT_CONFIGURED' }); return; }

    // ClearPathGPS typically has a single account — return the configured one
    res.json({
      accounts: [{ accountId: creds.account, accountName: creds.account, description: 'Primary Account' }],
    });
  } catch (error: any) {
    res.json({ accounts: [], error: error?.message || 'Failed to discover accounts' });
  }
});

// POST/PUT /api/clearpathgps/enable — Enable/disable integration
// Accepts both methods. Client may also pass `poll_interval_seconds`.
const enableHandler = (req: Request, res: Response) => {
  try {
    const { enabled, accountId, poll_interval_seconds } = req.body || {};
    const db = getDb();

    const existing = db.prepare(
      "SELECT id FROM system_config WHERE config_key = 'clearpathgps_enabled' AND category = 'integrations'"
    ).get() as any;

    if (existing) {
      db.prepare("UPDATE system_config SET config_value = ? WHERE id = ?").run(enabled ? '1' : '0', existing.id);
    } else {
      db.prepare("INSERT INTO system_config (config_key, config_value, category, is_active) VALUES ('clearpathgps_enabled', ?, 'integrations', 1)").run(enabled ? '1' : '0');
    }

    if (accountId) {
      setConfigValue('clearpathgps_active_account', String(accountId), false);
    }

    // Persist poll interval if provided (matches the existing
    // clearpathgps_poll_interval system_config key).
    if (poll_interval_seconds !== undefined && poll_interval_seconds !== null) {
      const seconds = Math.max(5, parseInt(String(poll_interval_seconds), 10) || 15);
      setConfigValue('clearpathgps_poll_interval', String(seconds), false);
    }

    res.json({ success: true, enabled });
  } catch (error: any) {
    console.error('ClearPathGPS enable error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps enable', code: 'CLEARPATHGPS_ENABLE_ERROR' });
  }
};
router.post('/enable', requireRole('admin'), enableHandler);
router.put('/enable', requireRole('admin'), enableHandler);

// GET /api/clearpathgps/devices — List ClearPathGPS devices
router.get('/devices', (req: Request, res: Response) => {
  try {
    const db = getDb();
    // NOTE: fleet_vehicles has no unit_label column — derive it from the
    // assigned unit's call_sign instead. The original query selected
    // `fv.unit_label` directly which 500'd with `no such column` on prod.
    const devices = db.prepare(`
      SELECT cv.*,
             fv.vehicle_number as fleet_vehicle_number,
             u.call_sign as fleet_unit_label
      FROM cpgps_vehicles cv
      LEFT JOIN fleet_vehicles fv ON cv.vehicle_id = fv.id
      LEFT JOIN units u ON fv.assigned_unit_id = u.id
      ORDER BY cv.name
      LIMIT 1000
    `).all();
    res.json({ devices });
  } catch (error: any) {
    console.error('ClearPathGPS devices error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps devices', code: 'CLEARPATHGPS_DEVICES_ERROR' });
  }
});

// GET /api/clearpathgps/mappings — Officer-vehicle mappings
router.get('/mappings', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const mappings = db.prepare(`
      SELECT m.*, u.full_name as officer_name, u.badge_number,
        cv.name as vehicle_name, cv.cpgps_id
      FROM cpgps_officer_mappings m
      LEFT JOIN users u ON m.officer_id = u.id
      LEFT JOIN cpgps_vehicles cv ON m.cpgps_vehicle_id = cv.cpgps_id
      WHERE m.active = 1
      ORDER BY u.full_name
    
      LIMIT 1000
    `).all();
    res.json({ mappings });
  } catch (error: any) {
    console.error('ClearPathGPS mappings error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps mappings', code: 'CLEARPATHGPS_MAPPINGS_ERROR' });
  }
});

// POST /api/clearpathgps/mappings — Create officer-vehicle mapping
//
// Backward-compat: accept either canonical (officer_id, cpgps_vehicle_id)
// or legacy client field names (unit_id → resolved to officer_id via the
// units table; cpg_device_id → cpgps_vehicle_id; cpg_display_name →
// call_sign). Closes the field-name drift that was 400-ing the Admin →
// ClearPathGPS Integration "Save mapping" action.
router.post('/mappings', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const body = req.body || {};
    let officer_id = body.officer_id;
    const cpgps_vehicle_id = body.cpgps_vehicle_id || body.cpg_device_id;
    const call_sign = body.call_sign || body.cpg_display_name || null;

    if (!officer_id && body.unit_id) {
      const unit = db.prepare('SELECT officer_id FROM units WHERE id = ?')
        .get(Number(body.unit_id)) as { officer_id?: number } | undefined;
      if (unit?.officer_id) officer_id = unit.officer_id;
    }

    if (!officer_id || !cpgps_vehicle_id) {
      res.status(400).json({
        error: 'officer_id (or unit_id) and cpgps_vehicle_id (or cpg_device_id) required',
        code: 'OFFICERID_AND_CPGPSVEHICLEID_REQUIRED',
        hint: 'Provide officer_id directly or unit_id (will be resolved to officer_id), plus cpgps_vehicle_id or cpg_device_id.',
      });
      return;
    }
    db.prepare(`
      INSERT OR REPLACE INTO cpgps_officer_mappings (officer_id, cpgps_vehicle_id, call_sign, active)
      VALUES (?, ?, ?, 1)
    `).run(officer_id, cpgps_vehicle_id, call_sign);
    res.json({ success: true, officer_id, cpgps_vehicle_id });
  } catch (error: any) {
    console.error('ClearPathGPS create mapping error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps create mapping', code: 'CLEARPATHGPS_CREATE_MAPPING_ERROR' });
  }
});

// DELETE /api/clearpathgps/mappings/:id — Remove mapping
router.delete('/mappings/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('UPDATE cpgps_officer_mappings SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('ClearPathGPS delete mapping error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps delete mapping', code: 'CLEARPATHGPS_DELETE_MAPPING_ERROR' });
  }
});

// GET /api/clearpathgps/settings — Integration settings
router.get('/settings', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const historyBackfill = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'clearpathgps_history_backfill' AND category = 'integrations'"
    ).get() as any;
    res.json({ history_backfill: historyBackfill?.config_value === '1' });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// POST /api/clearpathgps/settings — Update settings
router.post('/settings', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { history_backfill } = req.body;
    setConfigValue('clearpathgps_history_backfill', history_backfill ? '1' : '0');
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// GET /api/clearpathgps/dashcam-events — List dashcam events
router.get('/dashcam-events', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(100000, Math.max(1, (parseInt(req.query.limit as string, 10)) || 100000));
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const events = db.prepare(`
      SELECT de.*, u.full_name as officer_name, cv.name as vehicle_name
      FROM cpgps_dashcam_events de
      LEFT JOIN users u ON de.officer_id = u.id
      LEFT JOIN cpgps_vehicles cv ON de.cpgps_vehicle_id = cv.cpgps_id
      ORDER BY de.event_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = (db.prepare('SELECT COUNT(*) as cnt FROM cpgps_dashcam_events').get() as any).cnt;

    res.json({ events, total });
  } catch (error: any) {
    console.error('ClearPathGPS dashcam events error:', error);
    res.status(500).json({ error: 'Failed to clearpathgps dashcam events', code: 'CLEARPATHGPS_DASHCAM_EVENTS_ERROR' });
  }
});

// GET /api/clearpathgps/dashcam-events/by-officer/:officerId — Events for specific officer
router.get('/dashcam-events/by-officer/:officerId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const events = db.prepare(`
      SELECT de.*, cv.name as vehicle_name
      FROM cpgps_dashcam_events de
      LEFT JOIN cpgps_vehicles cv ON de.cpgps_vehicle_id = cv.cpgps_id
      WHERE de.officer_id = ?
      ORDER BY de.event_at DESC
      LIMIT 100
    `).all(req.params.officerId);
    res.json(events);
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// GET /api/clearpathgps/dashcam-events/export — Export dashcam events CSV
router.get('/dashcam-events/export', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const events = db.prepare(`
      SELECT de.*, u.full_name as officer_name, cv.name as vehicle_name
      FROM cpgps_dashcam_events de
      LEFT JOIN users u ON de.officer_id = u.id
      LEFT JOIN cpgps_vehicles cv ON de.cpgps_vehicle_id = cv.cpgps_id
      ORDER BY de.event_at DESC
    
      LIMIT 1000
    `).all() as any[];

    const headers = ['Event Type', 'Severity', 'Description', 'Officer', 'Vehicle', 'Speed', 'Lat', 'Lon', 'Event Time'];
    const rows = events.map((e: any) => [
      e.event_type, e.severity, (e.description || '').replace(/"/g, '""'),
      e.officer_name || '', e.vehicle_name || '', e.speed || '', e.lat || '', e.lon || '', e.event_at || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map((v: any) => `"${v}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="dashcam-events.csv"');
    res.send(csv);
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// GET /api/clearpathgps/media-status — Media sync status
router.get('/media-status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const totalEvents = (db.prepare('SELECT COUNT(*) as cnt FROM cpgps_dashcam_events WHERE media_url IS NOT NULL').get() as any).cnt;
    const syncedEvents = (db.prepare('SELECT COUNT(*) as cnt FROM cpgps_dashcam_events WHERE media_synced = 1').get() as any).cnt;
    const pendingEvents = totalEvents - syncedEvents;

    res.json({
      total: totalEvents,
      synced: syncedEvents,
      pending: pendingEvents,
      lastSyncAt: null,
      enabled: false,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// POST /api/clearpathgps/media-settings — Update media sync settings
router.post('/media-settings', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { enabled, syncInterval, downloadPath } = req.body;
    if (enabled !== undefined) setConfigValue('clearpathgps_media_enabled', enabled ? '1' : '0');
    if (syncInterval) setConfigValue('clearpathgps_media_interval', String(syncInterval));
    if (downloadPath) setConfigValue('clearpathgps_media_path', downloadPath);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// POST /api/clearpathgps/media-sync-now — Trigger manual media sync
router.post('/media-sync-now', requireRole('admin'), (req: Request, res: Response) => {
  try {
    // Placeholder — media sync would download dashcam clips from ClearPathGPS
    res.json({ synced: 0, errors: 0, message: 'Media sync not yet configured — add ClearPathGPS media credentials first' });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

export default router;
