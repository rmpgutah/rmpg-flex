// Traccar routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow } from '../worker-middleware/d1Helpers';

const CONFIG_KEYS = {
  url: 'traccar_url',
  email: 'traccar_email',
  password: 'traccar_password',
  enabled: 'traccar_enabled',
  pollInterval: 'traccar_poll_interval',
} as const;

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
  try { return await decryptWeb(row.config_value, jwtSecret); } catch { return row.config_value; }
}

async function getConfigValueRaw(db: D1Db, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1").get(key) as { config_value?: string } | undefined;
  return row?.config_value || null;
}

async function setConfigValue(db: D1Db, key: string, value: string, shouldEncrypt: boolean, jwtSecret: string): Promise<void> {
  const stored = shouldEncrypt ? await encryptWeb(value, jwtSecret) : value;
  await db.prepare("DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'").run(key);
  await db.prepare("INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'integrations', 0, 1, ?, ?)").run(key, stored, localNow(), localNow());
}

async function deleteConfigValue(db: D1Db, key: string): Promise<void> {
  await db.prepare("DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'").run(key);
}

async function isConfigured(db: D1Db, jwtSecret: string): Promise<boolean> {
  const url = await getConfigValueRaw(db, CONFIG_KEYS.url);
  const email = await getConfigValue(db, CONFIG_KEYS.email, jwtSecret);
  const password = await getConfigValue(db, CONFIG_KEYS.password, jwtSecret);
  return !!(url && email && password);
}

async function isEnabled(db: D1Db): Promise<boolean> {
  const val = await getConfigValueRaw(db, CONFIG_KEYS.enabled);
  return val === 'true' || val === '1';
}

async function testConnection(db: D1Db, jwtSecret: string): Promise<{ success: boolean; deviceCount?: number; error?: string }> {
  const url = await getConfigValueRaw(db, CONFIG_KEYS.url);
  const email = await getConfigValue(db, CONFIG_KEYS.email, jwtSecret);
  const password = await getConfigValue(db, CONFIG_KEYS.password, jwtSecret);
  if (!url || !email || !password) return { success: false, error: 'Not configured' };
  try {
    const resp = await fetch(`${url}/api/devices`, { headers: { 'Authorization': `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}` } });
    if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
    const devices = await resp.json() as any[];
    return { success: true, deviceCount: devices.length };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Connection failed' };
  }
}

async function getDevices(db: D1Db, jwtSecret: string): Promise<any[]> {
  const url = await getConfigValueRaw(db, CONFIG_KEYS.url);
  const email = await getConfigValue(db, CONFIG_KEYS.email, jwtSecret);
  const password = await getConfigValue(db, CONFIG_KEYS.password, jwtSecret);
  if (!url || !email || !password) return [];
  const resp = await fetch(`${url}/api/devices`, { headers: { 'Authorization': `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}` } });
  if (!resp.ok) return [];
  return resp.json();
}

async function getPositionHistory(db: D1Db, jwtSecret: string, deviceId: number, from: string, to: string): Promise<any[]> {
  const url = await getConfigValueRaw(db, CONFIG_KEYS.url);
  const email = await getConfigValue(db, CONFIG_KEYS.email, jwtSecret);
  const password = await getConfigValue(db, CONFIG_KEYS.password, jwtSecret);
  if (!url || !email || !password) return [];
  const resp = await fetch(`${url}/api/positions?deviceId=${deviceId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
    headers: { 'Authorization': `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}` },
  });
  if (!resp.ok) return [];
  return resp.json();
}

export function mountTraccarRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  api.get('/status', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const configured = await isConfigured(db, c.env.JWT_SECRET);
      const enabled = await isEnabled(db);
      const pollInterval = await getConfigValueRaw(db, CONFIG_KEYS.pollInterval) || '30';
      const mappingCount = (await db.prepare('SELECT COUNT(*) as cnt FROM cpg_device_mappings WHERE is_active = 1').get() as any)?.cnt || 0;
      const lastSync = (await db.prepare('SELECT MAX(last_synced_at) as ts FROM cpg_device_mappings WHERE is_active = 1').get() as any)?.ts || null;
      return c.json({ configured, enabled, poll_interval_seconds: parseInt(pollInterval, 10), active_mappings: mappingCount, last_sync: lastSync });
    } catch {
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  api.put('/credentials', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { url, email, password } = body;
      if (!url || !email || !password) return c.json({ error: 'url, email, and password are required' }, 400);
      await setConfigValue(db, CONFIG_KEYS.url, url, false, c.env.JWT_SECRET);
      await setConfigValue(db, CONFIG_KEYS.email, email, true, c.env.JWT_SECRET);
      await setConfigValue(db, CONFIG_KEYS.password, password, true, c.env.JWT_SECRET);
      const user = c.get('user');
      await db.prepare("INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'traccar_credentials_updated', 'integration', 0, ?, ?)").run(user.userId, 'Updated Traccar GPS credentials', c.req.header('CF-Connecting-IP') || 'unknown');
      return c.json({ message: 'Credentials saved' });
    } catch {
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  api.delete('/credentials', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      for (const key of Object.values(CONFIG_KEYS)) await deleteConfigValue(db, key);
      const user = c.get('user');
      await db.prepare("INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'traccar_credentials_cleared', 'integration', 0, ?, ?)").run(user.userId, 'Cleared Traccar GPS credentials', c.req.header('CF-Connecting-IP') || 'unknown');
      return c.json({ message: 'Credentials and configuration cleared' });
    } catch {
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  api.post('/test-connection', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const result = await testConnection(db, c.env.JWT_SECRET);
      return c.json(result);
    } catch (error: any) {
      return c.json({ success: false, deviceCount: 0, error: error.message || 'Connection test failed' });
    }
  });

  api.put('/enable', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { enabled, poll_interval_seconds } = body;
      if (typeof enabled !== 'boolean') return c.json({ error: 'enabled must be a boolean' }, 400);
      await setConfigValue(db, CONFIG_KEYS.enabled, String(enabled), false, c.env.JWT_SECRET);
      if (poll_interval_seconds != null) {
        const interval = Math.max(15, Math.min(300, parseInt(poll_interval_seconds, 10) || 30));
        await setConfigValue(db, CONFIG_KEYS.pollInterval, String(interval), false, c.env.JWT_SECRET);
      }
      if (!enabled) {
        await db.prepare("UPDATE units SET gps_source = 'browser' WHERE gps_source = 'traccar'").run();
      }
      const user = c.get('user');
      await db.prepare("INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'traccar_toggled', 'integration', 0, ?, ?)").run(user.userId, `Traccar GPS ${enabled ? 'enabled' : 'disabled'}`, c.req.header('CF-Connecting-IP') || 'unknown');
      return c.json({ message: `Traccar GPS ${enabled ? 'enabled' : 'disabled'}` });
    } catch {
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  api.get('/devices', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      if (!await isConfigured(db, c.env.JWT_SECRET)) return c.json({ error: 'Traccar not configured' }, 400);
      const devices = await getDevices(db, c.env.JWT_SECRET);
      return c.json({ devices });
    } catch (error: any) {
      return c.json({ error: error.message || 'Failed to fetch devices' }, 500);
    }
  });

  api.get('/mappings', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const mappings = await db.prepare(`
        SELECT m.*, u.call_sign, u.status as unit_status, usr.full_name as officer_name, usr.id as officer_id
        FROM cpg_device_mappings m LEFT JOIN units u ON m.unit_id = u.id LEFT JOIN users usr ON u.officer_id = usr.id
        WHERE m.is_active = 1 ORDER BY m.cpg_display_name
      `).all();
      return c.json({ mappings });
    } catch {
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  api.post('/mappings', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { device_unique_id, device_name, traccar_device_id, unit_id } = body;
      if (!device_unique_id || !unit_id) return c.json({ error: 'device_unique_id and unit_id are required' }, 400);
      const now = localNow();
      const unit = await db.prepare('SELECT id, call_sign FROM units WHERE id = ?').get(unit_id) as any;
      if (!unit) return c.json({ error: 'Unit not found' }, 404);
      const existing = await db.prepare('SELECT id FROM cpg_device_mappings WHERE cpg_device_id = ?').get(device_unique_id) as any;
      if (existing) {
        await db.prepare(`UPDATE cpg_device_mappings SET unit_id = ?, cpg_display_name = ?, traccar_device_id = ?, is_active = 1, updated_at = ? WHERE id = ?`).run(unit_id, device_name || null, traccar_device_id || null, now, existing.id);
      } else {
        await db.prepare(`INSERT INTO cpg_device_mappings (cpg_device_id, cpg_display_name, traccar_device_id, unit_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`).run(device_unique_id, device_name || null, traccar_device_id || null, unit_id, now, now);
      }
      await db.prepare("UPDATE units SET gps_source = 'traccar' WHERE id = ?").run(unit_id);
      const user = c.get('user');
      await db.prepare("INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'traccar_mapping_created', 'gps_device_mapping', ?, ?, ?)").run(user.userId, unit_id, `Mapped device ${device_name || device_unique_id} → ${unit.call_sign}`, c.req.header('CF-Connecting-IP') || 'unknown');
      return c.json({ message: 'Mapping created', unit_call_sign: unit.call_sign });
    } catch {
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  api.delete('/mappings/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const mapping = await db.prepare('SELECT * FROM cpg_device_mappings WHERE id = ?').get(id) as any;
      if (!mapping) return c.json({ error: 'Mapping not found' }, 404);
      await db.prepare("UPDATE cpg_device_mappings SET is_active = 0, updated_at = ? WHERE id = ?").run(localNow(), id);
      await db.prepare("UPDATE units SET gps_source = 'browser' WHERE id = ?").run(mapping.unit_id);
      const user = c.get('user');
      await db.prepare("INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'traccar_mapping_removed', 'gps_device_mapping', ?, ?, ?)").run(user.userId, mapping.unit_id, `Unmapped device ${mapping.cpg_display_name || mapping.cpg_device_id}`, c.req.header('CF-Connecting-IP') || 'unknown');
      return c.json({ message: 'Mapping removed' });
    } catch {
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  api.get('/settings', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const historyBackfill = await getConfigValueRaw(db, 'traccar_history_backfill');
      return c.json({ history_backfill: historyBackfill !== 'false' });
    } catch {
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  api.put('/settings', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { history_backfill } = body;
      if (typeof history_backfill === 'boolean') await setConfigValue(db, 'traccar_history_backfill', String(history_backfill), false, c.env.JWT_SECRET);
      const user = c.get('user');
      await db.prepare("INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'traccar_settings_updated', 'integration', 0, ?, ?)").run(user.userId, `History backfill: ${history_backfill}`, c.req.header('CF-Connecting-IP') || 'unknown');
      return c.json({ message: 'Settings updated' });
    } catch {
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  api.get('/history/:deviceId', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      if (!await isConfigured(db, c.env.JWT_SECRET)) return c.json({ error: 'Traccar not configured' }, 400);
      const deviceId = parseInt(c.req.param('deviceId') || '0', 10);
      if (isNaN(deviceId)) return c.json({ error: 'Invalid device ID' }, 400);
      const q = c.req.query();
      const from = q.from;
      const to = q.to;
      if (!from || !to) return c.json({ error: 'from and to query parameters are required (ISO date strings)' }, 400);
      const positions = await getPositionHistory(db, c.env.JWT_SECRET, deviceId, from, to);
      return c.json({ positions, count: positions.length });
    } catch (error: any) {
      return c.json({ error: error.message || 'Failed to fetch position history' }, 500);
    }
  });

  api.get('/dashcam-events', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const limit = Math.min(100000, Math.max(1, parseInt(q.limit || '100000', 10) || 100000));
      let query = `SELECT d.*, u.call_sign, usr.full_name as officer_name FROM dashcam_events d LEFT JOIN units u ON d.unit_id = u.id LEFT JOIN users usr ON u.officer_id = usr.id WHERE 1=1`;
      const params: any[] = [];
      if (q.from) { query += ' AND d.event_timestamp >= ?'; params.push(q.from); }
      if (q.to) { query += ' AND d.event_timestamp <= ?'; params.push(q.to); }
      if (q.device_id) { query += ' AND d.cpg_device_id = ?'; params.push(q.device_id); }
      if (q.event_type) { query += ' AND d.event_type = ?'; params.push(q.event_type); }
      query += ' ORDER BY d.event_timestamp DESC LIMIT ?';
      params.push(limit);
      const events = await db.prepare(query).all(...params);
      const total = (await db.prepare('SELECT COUNT(*) as cnt FROM dashcam_events').get() as any)?.cnt || 0;
      return c.json({ events, total });
    } catch {
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  api.get('/dashcam-events/by-officer/:officerId', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const officerId = parseInt(c.req.param('officerId') || '0', 10);
      if (isNaN(officerId)) return c.json({ error: 'Invalid officer ID' }, 400);
      const q = c.req.query();
      const limit = Math.min(100000, Math.max(1, parseInt(q.limit || '100000', 10) || 100000));
      const units = await db.prepare('SELECT id FROM units WHERE officer_id = ?').all(officerId) as { id: number }[];
      if (units.length === 0) return c.json({ events: [], total: 0 });
      const unitIds = units.map(u => u.id);
      const placeholders = unitIds.map(() => '?').join(',');
      let query = `SELECT d.*, u.call_sign, m.cpg_display_name as device_name FROM dashcam_events d LEFT JOIN units u ON d.unit_id = u.id LEFT JOIN cpg_device_mappings m ON d.cpg_device_id = m.cpg_device_id AND m.is_active = 1 WHERE d.unit_id IN (${placeholders})`;
      const params: any[] = [...unitIds];
      if (q.from) { query += ' AND d.event_timestamp >= ?'; params.push(String(q.from)); }
      if (q.to) { query += ' AND d.event_timestamp <= ?'; params.push(String(q.to)); }
      if (q.event_type) { query += ' AND d.event_type = ?'; params.push(String(q.event_type)); }
      query += ' ORDER BY d.event_timestamp DESC LIMIT ?';
      params.push(limit);
      const events = await db.prepare(query).all(...params);
      return c.json({ events, total: events.length });
    } catch {
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  api.get('/dashcam-events/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const event = await db.prepare(`
        SELECT d.*, u.call_sign, usr.full_name as officer_name FROM dashcam_events d LEFT JOIN units u ON d.unit_id = u.id LEFT JOIN users usr ON u.officer_id = usr.id WHERE d.id = ?
      `).get(id);
      if (!event) return c.json({ error: 'Telemetry event not found' }, 404);
      return c.json(event);
    } catch {
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  app.route('/api/traccar', api);
}
