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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/clearpathgps/configure — Save credentials
router.post('/configure', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { account, user, password, base_url } = req.body;
    if (!account || !user || !password) {
      res.status(400).json({ error: 'account, user, and password are required' });
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
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(400).json({ error: 'No credentials configured' });
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
    res.status(500).json({ error: 'Internal server error' });
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
    `).all();
    res.json(vehicles);
  } catch (error: any) {
    console.error('ClearPathGPS vehicles error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/clearpathgps/vehicles/:id/trips
router.get('/vehicles/:id/trips', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const cpgpsVehicle = db.prepare('SELECT * FROM cpgps_vehicles WHERE id = ?').get(req.params.id) as any;
    if (!cpgpsVehicle) { res.status(404).json({ error: 'Vehicle not found' }); return; }
    const { page = '1', per_page = '50' } = req.query;
    const pageNum = parseInt(page as string, 10) || 1;
    const perPage = parseInt(per_page as string, 10) || 50;
    const offset = (pageNum - 1) * perPage;
    const total = (db.prepare('SELECT COUNT(*) as c FROM cpgps_trips WHERE cpgps_vehicle_id = ?').get(cpgpsVehicle.cpgps_id) as any)?.c || 0;
    const trips = db.prepare(
      'SELECT * FROM cpgps_trips WHERE cpgps_vehicle_id = ? ORDER BY trip_start DESC LIMIT ? OFFSET ?'
    ).all(cpgpsVehicle.cpgps_id, perPage, offset);
    res.json({ trips, total, page: pageNum, per_page: perPage });
  } catch (error: any) {
    console.error('ClearPathGPS trips error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/clearpathgps/vehicles/:id/locations
router.get('/vehicles/:id/locations', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const cpgpsVehicle = db.prepare('SELECT * FROM cpgps_vehicles WHERE id = ?').get(req.params.id) as any;
    if (!cpgpsVehicle) { res.status(404).json({ error: 'Vehicle not found' }); return; }
    const { limit = '200' } = req.query;
    const locations = db.prepare(
      'SELECT * FROM cpgps_locations WHERE cpgps_vehicle_id = ? ORDER BY reported_at DESC LIMIT ?'
    ).all(cpgpsVehicle.cpgps_id, parseInt(limit as string, 10) || 200);
    res.json(locations);
  } catch (error: any) {
    console.error('ClearPathGPS locations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/clearpathgps/vehicles/:id/alerts
router.get('/vehicles/:id/alerts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const cpgpsVehicle = db.prepare('SELECT * FROM cpgps_vehicles WHERE id = ?').get(req.params.id) as any;
    if (!cpgpsVehicle) { res.status(404).json({ error: 'Vehicle not found' }); return; }
    const { limit = '100' } = req.query;
    const alerts = db.prepare(
      'SELECT * FROM cpgps_alerts WHERE cpgps_vehicle_id = ? ORDER BY triggered_at DESC LIMIT ?'
    ).all(cpgpsVehicle.cpgps_id, parseInt(limit as string, 10) || 100);
    res.json(alerts);
  } catch (error: any) {
    console.error('ClearPathGPS alerts error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(400).json({ error: 'cpgps_vehicle_id required' });
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
    res.status(500).json({ error: 'Internal server error' });
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
    if (!creds) { res.status(400).json({ error: 'ClearPathGPS not configured' }); return; }

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
  if (!creds) { res.status(400).json({ error: 'ClearPathGPS not configured' }); return; }

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
