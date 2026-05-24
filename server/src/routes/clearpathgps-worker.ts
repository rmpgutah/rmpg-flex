// ClearPathGPS routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow } from '../worker-middleware/d1Helpers';

// ── Web Crypto helpers ──
async function deriveKey(jwtSecret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest('SHA-256', encoder.encode(jwtSecret));
  return await crypto.subtle.importKey('raw', keyMaterial, 'AES-256-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptWeb(plaintext: string, jwtSecret: string): Promise<string> {
  const key = await deriveKey(jwtSecret);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext));
  const encBuf = new Uint8Array(encrypted);
  const authTag = encBuf.slice(-16);
  const ciphertext = encBuf.slice(0, -16);
  const toHex = (buf: Uint8Array) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${toHex(iv)}:${toHex(authTag)}:${toHex(ciphertext)}`;
}

async function decryptWeb(stored: string, jwtSecret: string): Promise<string> {
  const key = await deriveKey(jwtSecret);
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const iv = fromHex(parts[0]);
  const authTag = fromHex(parts[1]);
  const ciphertext = fromHex(parts[2]);
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);
  return new TextDecoder().decode(decrypted);
}

async function getConfigValue(db: D1Db, key: string, jwtSecret: string): Promise<string | null> {
  const row = await db.prepare("SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1").get(key) as { config_value?: string } | undefined;
  if (!row?.config_value) return null;
  // Try to decrypt, fall back to raw value
  try { return await decryptWeb(row.config_value, jwtSecret); } catch { return row.config_value; }
}

async function getConfigValueRaw(db: D1Db, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1").get(key) as { config_value?: string } | undefined;
  return row?.config_value || null;
}

async function setConfigValue(db: D1Db, key: string, value: string, encrypted: boolean, jwtSecret: string): Promise<void> {
  const stored = encrypted ? await encryptWeb(value, jwtSecret) : value;
  const existing = await db.prepare("SELECT id FROM system_config WHERE config_key = ? AND category = 'integrations'").get(key) as any;
  if (existing) {
    await db.prepare("UPDATE system_config SET config_value = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(stored, existing.id);
  } else {
    await db.prepare("INSERT INTO system_config (config_key, config_value, category, is_active) VALUES (?, ?, 'integrations', 1)").run(key, stored);
  }
}

async function removeConfigValues(db: D1Db, keys: string[]): Promise<void> {
  for (const key of keys) {
    await db.prepare("DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'").run(key);
  }
}

async function isConfigured(db: D1Db): Promise<boolean> {
  const acct = await getConfigValueRaw(db, 'clearpathgps_account');
  const user = await getConfigValueRaw(db, 'clearpathgps_user');
  const pass = await getConfigValueRaw(db, 'clearpathgps_password');
  return !!(acct && user && pass);
}

interface ClearPathGpsCredentials {
  account: string;
  user: string;
  password: string;
  baseUrl: string;
}

async function getCredentials(db: D1Db, jwtSecret: string): Promise<ClearPathGpsCredentials | null> {
  const account = await getConfigValue(db, 'clearpathgps_account', jwtSecret);
  const user = await getConfigValue(db, 'clearpathgps_user', jwtSecret);
  const password = await getConfigValue(db, 'clearpathgps_password', jwtSecret);
  const baseUrl = await getConfigValueRaw(db, 'clearpathgps_base_url');
  if (!account || !user || !password) return null;
  return { account, user, password, baseUrl: baseUrl || 'https://api.clearpathgps.com:8443' };
}

async function testConnection(creds: ClearPathGpsCredentials): Promise<boolean> {
  try {
    const auth = Buffer.from(`${creds.user}:${creds.password}`).toString('base64');
    const resp = await fetch(`${creds.baseUrl}/api/v1/vehicles`, {
      headers: { 'Authorization': `Basic ${auth}` },
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function getVehicles(creds: ClearPathGpsCredentials): Promise<any[]> {
  const auth = Buffer.from(`${creds.user}:${creds.password}`).toString('base64');
  const resp = await fetch(`${creds.baseUrl}/api/v1/vehicles`, {
    headers: { 'Authorization': `Basic ${auth}` },
  });
  if (!resp.ok) return [];
  return resp.json();
}

export function mountClearpathgpsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  api.get('/status', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const configured = await isConfigured(db);
      const lastSync = await db.prepare("SELECT * FROM cpgps_sync_log ORDER BY started_at DESC LIMIT 1").get() as any;
      const vehicleCount = (await db.prepare('SELECT COUNT(*) as c FROM cpgps_vehicles').get() as any)?.c || 0;
      const tripCount = (await db.prepare('SELECT COUNT(*) as c FROM cpgps_trips').get() as any)?.c || 0;
      const locationCount = (await db.prepare('SELECT COUNT(*) as c FROM cpgps_locations').get() as any)?.c || 0;
      const alertCount = (await db.prepare('SELECT COUNT(*) as c FROM cpgps_alerts').get() as any)?.c || 0;
      return c.json({ configured, lastSync: lastSync || null, counts: { vehicles: vehicleCount, trips: tripCount, locations: locationCount, alerts: alertCount } });
    } catch {
      return c.json({ error: 'Failed to clearpathgps status', code: 'CLEARPATHGPS_STATUS_ERROR' }, 500);
    }
  });

  api.post('/configure', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { account, user, password, base_url } = body;
      if (!account || !user || !password) return c.json({ error: 'account, user, and password are required', code: 'ACCOUNT_USER_AND_PASSWORD' }, 400);
      await setConfigValue(db, 'clearpathgps_account', account, true, c.env.JWT_SECRET);
      await setConfigValue(db, 'clearpathgps_user', user, true, c.env.JWT_SECRET);
      await setConfigValue(db, 'clearpathgps_password', password, true, c.env.JWT_SECRET);
      await setConfigValue(db, 'clearpathgps_base_url', base_url || 'https://api.clearpathgps.com:8443', false, c.env.JWT_SECRET);
      const userObj = c.get('user');
      await db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, details, ip_address) VALUES (?, 'configure_clearpathgps', 'integration', 'ClearPathGPS credentials configured', ?)`).run(userObj.userId, c.req.header('CF-Connecting-IP') || 'unknown');
      return c.json({ message: 'ClearPathGPS credentials saved' });
    } catch {
      return c.json({ error: 'Failed to clearpathgps configure', code: 'CLEARPATHGPS_CONFIGURE_ERROR' }, 500);
    }
  });

  api.post('/test', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      let creds: ClearPathGpsCredentials | null = null;
      if (body.account && body.user && body.password) {
        creds = { account: body.account, user: body.user, password: body.password, baseUrl: body.base_url || 'https://api.clearpathgps.com:8443' };
      } else {
        creds = await getCredentials(db, c.env.JWT_SECRET);
      }
      if (!creds) return c.json({ error: 'No credentials configured', code: 'NO_CREDENTIALS_CONFIGURED' }, 400);
      const success = await testConnection(creds);
      return c.json({ success, message: success ? 'Connection successful' : 'Connection failed' });
    } catch (err: any) {
      return c.json({ success: false, message: err?.message || 'Connection failed' });
    }
  });

  api.delete('/configure', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      await removeConfigValues(db, ['clearpathgps_account', 'clearpathgps_user', 'clearpathgps_password', 'clearpathgps_base_url']);
      return c.json({ message: 'ClearPathGPS credentials removed' });
    } catch {
      return c.json({ error: 'Failed to clearpathgps remove config', code: 'CLEARPATHGPS_REMOVE_CONFIG_ERROR' }, 500);
    }
  });

  api.get('/vehicles', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const vehicles = await db.prepare(`
        SELECT cv.*, fv.vehicle_number AS fleet_vehicle_number, fv.make AS fleet_make, fv.model AS fleet_model, fv.year AS fleet_year
        FROM cpgps_vehicles cv LEFT JOIN fleet_vehicles fv ON cv.vehicle_id = fv.id ORDER BY cv.name ASC LIMIT 1000
      `).all();
      return c.json(vehicles);
    } catch {
      return c.json({ error: 'Failed to clearpathgps vehicles', code: 'CLEARPATHGPS_VEHICLES_ERROR' }, 500);
    }
  });

  api.get('/vehicles/:id/trips', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const cpgpsVehicle = await db.prepare('SELECT * FROM cpgps_vehicles WHERE id = ?').get(id) as any;
      if (!cpgpsVehicle) return c.json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }, 404);
      const q = c.req.query();
      const pageNum = parseInt(q.page || '1', 10) || 1;
      const perPage = Math.min(100000, Math.max(1, parseInt(q.per_page || '100000', 10) || 100000));
      const offset = (pageNum - 1) * perPage;
      const total = (await db.prepare('SELECT COUNT(*) as c FROM cpgps_trips WHERE cpgps_vehicle_id = ?').get(cpgpsVehicle.cpgps_id) as any)?.c || 0;
      const trips = await db.prepare('SELECT * FROM cpgps_trips WHERE cpgps_vehicle_id = ? ORDER BY trip_start DESC LIMIT ? OFFSET ?').all(cpgpsVehicle.cpgps_id, perPage, offset);
      return c.json({ trips, total, page: pageNum, per_page: perPage });
    } catch {
      return c.json({ error: 'Failed to clearpathgps trips', code: 'CLEARPATHGPS_TRIPS_ERROR' }, 500);
    }
  });

  api.get('/vehicles/:id/locations', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const cpgpsVehicle = await db.prepare('SELECT * FROM cpgps_vehicles WHERE id = ?').get(id) as any;
      if (!cpgpsVehicle) return c.json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }, 404);
      const q = c.req.query();
      const limit = parseInt(q.limit || '100000', 10) || 200;
      const locations = await db.prepare('SELECT * FROM cpgps_locations WHERE cpgps_vehicle_id = ? ORDER BY reported_at DESC LIMIT ?').all(cpgpsVehicle.cpgps_id, limit);
      return c.json(locations);
    } catch {
      return c.json({ error: 'Failed to clearpathgps locations', code: 'CLEARPATHGPS_LOCATIONS_ERROR' }, 500);
    }
  });

  api.get('/vehicles/:id/alerts', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const cpgpsVehicle = await db.prepare('SELECT * FROM cpgps_vehicles WHERE id = ?').get(id) as any;
      if (!cpgpsVehicle) return c.json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }, 404);
      const q = c.req.query();
      const limit = parseInt(q.limit || '100000', 10) || 100;
      const alerts = await db.prepare('SELECT * FROM cpgps_alerts WHERE cpgps_vehicle_id = ? ORDER BY triggered_at DESC LIMIT ?').all(cpgpsVehicle.cpgps_id, limit);
      return c.json(alerts);
    } catch {
      return c.json({ error: 'Failed to clearpathgps alerts', code: 'CLEARPATHGPS_ALERTS_ERROR' }, 500);
    }
  });

  api.post('/link-vehicle', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { cpgps_vehicle_id, fleet_vehicle_id } = body;
      if (!cpgps_vehicle_id) return c.json({ error: 'cpgps_vehicle_id required', code: 'CPGPSVEHICLEID_REQUIRED' }, 400);
      await db.prepare('UPDATE cpgps_vehicles SET vehicle_id = ? WHERE id = ?').run(fleet_vehicle_id || null, cpgps_vehicle_id);
      const cpgps = await db.prepare('SELECT cpgps_id FROM cpgps_vehicles WHERE id = ?').get(cpgps_vehicle_id) as any;
      if (cpgps) {
        const vid = fleet_vehicle_id || null;
        await db.prepare('UPDATE cpgps_trips SET vehicle_id = ? WHERE cpgps_vehicle_id = ?').run(vid, cpgps.cpgps_id);
        await db.prepare('UPDATE cpgps_locations SET vehicle_id = ? WHERE cpgps_vehicle_id = ?').run(vid, cpgps.cpgps_id);
        await db.prepare('UPDATE cpgps_alerts SET vehicle_id = ? WHERE cpgps_vehicle_id = ?').run(vid, cpgps.cpgps_id);
      }
      return c.json({ message: 'Vehicle linked' });
    } catch {
      return c.json({ error: 'Failed to clearpathgps link vehicle', code: 'CLEARPATHGPS_LINK_VEHICLE_ERROR' }, 500);
    }
  });

  // Sync — quick sync only (no background scrape in Workers)
  api.post('/sync', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const creds = await getCredentials(db, c.env.JWT_SECRET);
      if (!creds) return c.json({ error: 'ClearPathGPS not configured', code: 'CLEARPATHGPS_NOT_CONFIGURED' }, 400);
      const syncLog = await db.prepare("INSERT INTO cpgps_sync_log (sync_type, status) VALUES ('quick', 'running')").run();
      const syncId = Number(syncLog.meta.last_row_id);
      try {
        const vehicles = await getVehicles(creds);
        let stored = 0;
        for (const v of vehicles) {
          const vid = String(v.id || v.vehicleId || v.vehicle_id || '');
          if (!vid) continue;
          const existing = await db.prepare('SELECT id, vehicle_id FROM cpgps_vehicles WHERE cpgps_id = ?').get(vid) as any;
          if (existing) {
            await db.prepare(`UPDATE cpgps_vehicles SET name = ?, vin = ?, make = ?, model = ?, year = ?, license_plate = ?, device_serial = ?, last_lat = ?, last_lon = ?, last_speed = ?, last_heading = ?, last_reported_at = ?, odometer = ?, engine_hours = ?, raw_json = ?, synced_at = ? WHERE cpgps_id = ?`).run(
              v.name || v.description || null, v.vin || null, v.make || null, v.model || null, v.year || null,
              v.licensePlate || v.license_plate || null, v.deviceSerial || v.device_serial || null,
              v.latitude || v.lat || null, v.longitude || v.lon || null, v.speed || null, v.heading || null,
              v.lastReportedAt || v.last_reported_at || null, v.odometer || null, v.engineHours || v.engine_hours || null,
              JSON.stringify(v), localNow(), vid,
            );
          } else {
            await db.prepare(`INSERT INTO cpgps_vehicles (cpgps_id, name, vin, make, model, year, license_plate, device_serial, last_lat, last_lon, last_speed, last_heading, last_reported_at, odometer, engine_hours, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
              vid, v.name || v.description || null, v.vin || null, v.make || null, v.model || null, v.year || null,
              v.licensePlate || v.license_plate || null, v.deviceSerial || v.device_serial || null,
              v.latitude || v.lat || null, v.longitude || v.lon || null, v.speed || null, v.heading || null,
              v.lastReportedAt || v.last_reported_at || null, v.odometer || null, v.engineHours || v.engine_hours || null,
              JSON.stringify(v),
            );
          }
          stored++;
        }
        await db.prepare("UPDATE cpgps_sync_log SET status = 'completed', records_fetched = ?, records_stored = ?, completed_at = ? WHERE id = ?").run(vehicles.length, stored, localNow(), syncId);
        return c.json({ success: true, fetched: vehicles.length, stored });
      } catch (syncErr: any) {
        await db.prepare("UPDATE cpgps_sync_log SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?").run(syncErr?.message || 'Unknown error', localNow(), syncId);
        throw syncErr;
      }
    } catch (error: any) {
      return c.json({ error: error?.message || 'Sync failed' }, 500);
    }
  });

  // Scrape — not available in Workers (no long-running background tasks)
  api.post('/scrape', requireRole('admin'), async (c) => {
    return c.json({ message: 'Historical scrape not available in Workers runtime. Use /sync for quick vehicle sync.', stub: true });
  });

  api.get('/sync/status', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const logs = await db.prepare('SELECT * FROM cpgps_sync_log ORDER BY started_at DESC LIMIT 10').all();
      return c.json({ running: false, progress: { stage: 'idle', vehicleIndex: 0, vehicleTotal: 0, chunksProcessed: 0, chunksTotal: 0 }, logs });
    } catch {
      return c.json({ error: 'Failed to clearpathgps sync status', code: 'CLEARPATHGPS_SYNC_STATUS_ERROR' }, 500);
    }
  });

  api.post('/credentials', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { account, username, password, base_url } = body;
      if (!account || !username || !password) return c.json({ error: 'account, username, and password are required', code: 'ACCOUNT_USERNAME_AND_PASSWORD' }, 400);
      await setConfigValue(db, 'clearpathgps_account', account, true, c.env.JWT_SECRET);
      await setConfigValue(db, 'clearpathgps_user', username, true, c.env.JWT_SECRET);
      await setConfigValue(db, 'clearpathgps_password', password, true, c.env.JWT_SECRET);
      if (base_url) await setConfigValue(db, 'clearpathgps_base_url', base_url, false, c.env.JWT_SECRET);
      const userObj = c.get('user');
      await db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, details, ip_address) VALUES (?, 'configure_clearpathgps', 'integration', 'ClearPathGPS credentials configured', ?)`).run(userObj.userId, c.req.header('CF-Connecting-IP') || 'unknown');
      return c.json({ success: true, message: 'ClearPathGPS credentials saved' });
    } catch {
      return c.json({ error: 'Failed to clearpathgps save credentials', code: 'CLEARPATHGPS_SAVE_CREDENTIALS_ERROR' }, 500);
    }
  });

  api.delete('/credentials', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      await removeConfigValues(db, ['clearpathgps_account', 'clearpathgps_user', 'clearpathgps_password', 'clearpathgps_base_url']);
      return c.json({ success: true, message: 'ClearPathGPS credentials removed' });
    } catch {
      return c.json({ error: 'Failed to clearpathgps remove credentials', code: 'CLEARPATHGPS_REMOVE_CREDENTIALS_ERROR' }, 500);
    }
  });

  api.post('/test-connection', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      let creds: ClearPathGpsCredentials | null = null;
      if (body.account && body.username && body.password) {
        creds = { account: body.account, user: body.username, password: body.password, baseUrl: body.base_url || 'https://api.clearpathgps.com:8443' };
      } else {
        creds = await getCredentials(db, c.env.JWT_SECRET);
      }
      if (!creds) return c.json({ success: false, error: 'No credentials configured' }, 400);
      const success = await testConnection(creds);
      if (success) {
        const vehicles = await getVehicles(creds);
        return c.json({ success: true, deviceCount: vehicles.length });
      }
      return c.json({ success: false, error: 'Connection failed — check credentials' });
    } catch (error: any) {
      return c.json({ success: false, error: error?.message || 'Connection failed' });
    }
  });

  api.post('/discover-accounts', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const creds = await getCredentials(db, c.env.JWT_SECRET);
      if (!creds) return c.json({ error: 'Not configured', code: 'NOT_CONFIGURED' }, 400);
      return c.json({ accounts: [{ accountId: creds.account, accountName: creds.account, description: 'Primary Account' }] });
    } catch (error: any) {
      return c.json({ accounts: [], error: error?.message || 'Failed to discover accounts' });
    }
  });

  api.post('/enable', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { enabled, accountId } = body;
      const existing = await db.prepare("SELECT id FROM system_config WHERE config_key = 'clearpathgps_enabled' AND category = 'integrations'").get() as any;
      if (existing) {
        await db.prepare("UPDATE system_config SET config_value = ? WHERE id = ?").run(enabled ? '1' : '0', existing.id);
      } else {
        await db.prepare("INSERT INTO system_config (config_key, config_value, category, is_active) VALUES ('clearpathgps_enabled', ?, 'integrations', 1)").run(enabled ? '1' : '0');
      }
      if (accountId) await setConfigValue(db, 'clearpathgps_active_account', String(accountId), false, c.env.JWT_SECRET);
      return c.json({ success: true, enabled });
    } catch {
      return c.json({ error: 'Failed to clearpathgps enable', code: 'CLEARPATHGPS_ENABLE_ERROR' }, 500);
    }
  });

  api.get('/devices', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const devices = await db.prepare(`
        SELECT cv.*, fv.vehicle_number as fleet_vehicle_number, fv.unit_label as fleet_unit_label
        FROM cpgps_vehicles cv LEFT JOIN fleet_vehicles fv ON cv.vehicle_id = fv.id ORDER BY cv.name LIMIT 1000
      `).all();
      return c.json({ devices });
    } catch {
      return c.json({ error: 'Failed to clearpathgps devices', code: 'CLEARPATHGPS_DEVICES_ERROR' }, 500);
    }
  });

  api.get('/mappings', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const mappings = await db.prepare(`
        SELECT m.*, u.full_name as officer_name, u.badge_number, cv.name as vehicle_name, cv.cpgps_id
        FROM cpgps_officer_mappings m LEFT JOIN users u ON m.officer_id = u.id LEFT JOIN cpgps_vehicles cv ON m.cpgps_vehicle_id = cv.cpgps_id
        WHERE m.active = 1 ORDER BY u.full_name LIMIT 1000
      `).all();
      return c.json({ mappings });
    } catch {
      return c.json({ error: 'Failed to clearpathgps mappings', code: 'CLEARPATHGPS_MAPPINGS_ERROR' }, 500);
    }
  });

  api.post('/mappings', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      let officer_id = body.officer_id;
      const cpgps_vehicle_id = body.cpgps_vehicle_id || body.cpg_device_id;
      const call_sign = body.call_sign || body.cpg_display_name || null;
      if (!officer_id && body.unit_id) {
        const unit = await db.prepare('SELECT officer_id FROM units WHERE id = ?').get(Number(body.unit_id)) as { officer_id?: number } | undefined;
        if (unit?.officer_id) officer_id = unit.officer_id;
      }
      if (!officer_id || !cpgps_vehicle_id) {
        return c.json({ error: 'officer_id (or unit_id) and cpgps_vehicle_id (or cpg_device_id) required', code: 'OFFICERID_AND_CPGPSVEHICLEID_REQUIRED', hint: 'Provide officer_id directly or unit_id (will be resolved to officer_id), plus cpgps_vehicle_id or cpg_device_id.' }, 400);
      }
      await db.prepare(`INSERT OR REPLACE INTO cpgps_officer_mappings (officer_id, cpgps_vehicle_id, call_sign, active) VALUES (?, ?, ?, 1)`).run(officer_id, cpgps_vehicle_id, call_sign);
      return c.json({ success: true, officer_id, cpgps_vehicle_id });
    } catch {
      return c.json({ error: 'Failed to clearpathgps create mapping', code: 'CLEARPATHGPS_CREATE_MAPPING_ERROR' }, 500);
    }
  });

  api.delete('/mappings/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      await db.prepare('UPDATE cpgps_officer_mappings SET active = 0 WHERE id = ?').run(id);
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Failed to clearpathgps delete mapping', code: 'CLEARPATHGPS_DELETE_MAPPING_ERROR' }, 500);
    }
  });

  api.get('/settings', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const historyBackfill = await db.prepare("SELECT config_value FROM system_config WHERE config_key = 'clearpathgps_history_backfill' AND category = 'integrations'").get() as any;
      return c.json({ history_backfill: historyBackfill?.config_value === '1' });
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  api.post('/settings', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { history_backfill } = body;
      await setConfigValue(db, 'clearpathgps_history_backfill', history_backfill ? '1' : '0', false, c.env.JWT_SECRET);
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  api.get('/dashcam-events', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const limit = Math.min(100000, Math.max(1, parseInt(q.limit || '100000', 10) || 100000));
      const offset = parseInt(q.offset || '0', 10) || 0;
      const events = await db.prepare(`
        SELECT de.*, u.full_name as officer_name, cv.name as vehicle_name
        FROM cpgps_dashcam_events de LEFT JOIN users u ON de.officer_id = u.id LEFT JOIN cpgps_vehicles cv ON de.cpgps_vehicle_id = cv.cpgps_id
        ORDER BY de.event_at DESC LIMIT ? OFFSET ?
      `).all(limit, offset);
      const total = (await db.prepare('SELECT COUNT(*) as cnt FROM cpgps_dashcam_events').get() as any)?.cnt || 0;
      return c.json({ events, total });
    } catch {
      return c.json({ error: 'Failed to clearpathgps dashcam events', code: 'CLEARPATHGPS_DASHCAM_EVENTS_ERROR' }, 500);
    }
  });

  api.get('/dashcam-events/by-officer/:officerId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const officerId = paramNum(c.req.param('officerId'));
      const events = await db.prepare(`
        SELECT de.*, cv.name as vehicle_name FROM cpgps_dashcam_events de LEFT JOIN cpgps_vehicles cv ON de.cpgps_vehicle_id = cv.cpgps_id
        WHERE de.officer_id = ? ORDER BY de.event_at DESC LIMIT 100
      `).all(officerId);
      return c.json(events);
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  api.get('/dashcam-events/export', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const events = await db.prepare(`
        SELECT de.*, u.full_name as officer_name, cv.name as vehicle_name
        FROM cpgps_dashcam_events de LEFT JOIN users u ON de.officer_id = u.id LEFT JOIN cpgps_vehicles cv ON de.cpgps_vehicle_id = cv.cpgps_id
        ORDER BY de.event_at DESC LIMIT 1000
      `).all() as any[];
      const headers = ['Event Type', 'Severity', 'Description', 'Officer', 'Vehicle', 'Speed', 'Lat', 'Lon', 'Event Time'];
      const rows = events.map((e: any) => [e.event_type, e.severity, (e.description || '').replace(/"/g, '""'), e.officer_name || '', e.vehicle_name || '', e.speed || '', e.lat || '', e.lon || '', e.event_at || '']);
      const csv = [headers.join(','), ...rows.map((r: any[]) => r.map((v: any) => `"${v}"`).join(','))].join('\n');
      return c.body(csv, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="dashcam-events.csv"' });
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  api.get('/media-status', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const totalEvents = (await db.prepare('SELECT COUNT(*) as cnt FROM cpgps_dashcam_events WHERE media_url IS NOT NULL').get() as any)?.cnt || 0;
      const syncedEvents = (await db.prepare('SELECT COUNT(*) as cnt FROM cpgps_dashcam_events WHERE media_synced = 1').get() as any)?.cnt || 0;
      return c.json({ total: totalEvents, synced: syncedEvents, pending: totalEvents - syncedEvents, lastSyncAt: null, enabled: false });
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  api.post('/media-settings', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { enabled, syncInterval, downloadPath } = body;
      if (enabled !== undefined) await setConfigValue(db, 'clearpathgps_media_enabled', enabled ? '1' : '0', false, c.env.JWT_SECRET);
      if (syncInterval) await setConfigValue(db, 'clearpathgps_media_interval', String(syncInterval), false, c.env.JWT_SECRET);
      if (downloadPath) await setConfigValue(db, 'clearpathgps_media_path', downloadPath, false, c.env.JWT_SECRET);
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  api.post('/media-sync-now', requireRole('admin'), async (c) => {
    return c.json({ synced: 0, errors: 0, message: 'Media sync not yet configured — add ClearPathGPS media credentials first' });
  });

  app.route('/api/clearpathgps', api);
}
