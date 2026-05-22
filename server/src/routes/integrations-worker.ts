// Integrations routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow } from '../worker-middleware/d1Helpers';

// ── Web Crypto helpers (Workers-compatible AES-256-GCM + HMAC) ──

async function deriveCryptoKey(jwtSecret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest('SHA-256', encoder.encode(jwtSecret));
  return await crypto.subtle.importKey('raw', keyMaterial, 'AES-256-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptApiKeyWeb(plaintext: string, jwtSecret: string): Promise<string> {
  const key = await deriveCryptoKey(jwtSecret);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext));
  const encBuf = new Uint8Array(encrypted);
  const authTag = encBuf.slice(-16);
  const ciphertext = encBuf.slice(0, -16);
  const toHex = (buf: Uint8Array) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${toHex(iv)}:${toHex(authTag)}:${toHex(ciphertext)}`;
}

async function decryptApiKeyWeb(stored: string, jwtSecret: string): Promise<string> {
  const key = await deriveCryptoKey(jwtSecret);
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

async function hashApiKeyWeb(apiKey: string, jwtSecret: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(jwtSecret + apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const INTEGRATIONS = [
  {
    id: 'clearpathgps',
    name: 'ClearPathGPS',
    description: 'Fleet vehicle GPS tracking, trip history, and location monitoring',
    configKeys: ['clearpathgps_account', 'clearpathgps_user', 'clearpathgps_password'],
    syncLogTable: 'cpgps_sync_log',
    syncLogTimeColumn: 'started_at',
    statsQueries: {
      vehicles: 'SELECT COUNT(*) as c FROM cpgps_vehicles',
      trips: 'SELECT COUNT(*) as c FROM cpgps_trips',
      locations: 'SELECT COUNT(*) as c FROM cpgps_locations',
      alerts: 'SELECT COUNT(*) as c FROM cpgps_alerts',
    },
  },
  {
    id: 'servemanager',
    name: 'ServeManager',
    description: 'Service of process job tracking and server attempt monitoring',
    configKeys: ['servemanager_api_key'],
    syncLogTable: 'sm_sync_log',
    syncLogTimeColumn: 'started_at',
    statsQueries: {
      jobs: 'SELECT COUNT(*) as c FROM sm_jobs',
      attempts: 'SELECT COUNT(*) as c FROM sm_attempts',
    },
  },
  {
    id: 'microbilt',
    name: 'Microbilt',
    description: 'Background screening, DL verification, and OFAC SDN watch list',
    configKeys: ['microbilt_client_id', 'microbilt_client_secret'],
    syncLogTable: 'ofac_sync_log',
    syncLogTimeColumn: 'started_at',
    statsQueries: {
      sdn_entries: 'SELECT COUNT(*) as c FROM ofac_sdn_entries',
      dl_records: 'SELECT COUNT(*) as c FROM dl_records',
    },
  },
  {
    id: 'iped',
    name: 'IPED Digital Forensics',
    description: 'Digital forensics case management, evidence indexing, and findings import',
    configKeys: ['iped_base_url', 'iped_api_key'],
    syncLogTable: null as string | null,
    syncLogTimeColumn: null as string | null,
    statsQueries: {
      cases: 'SELECT COUNT(*) as c FROM forensic_cases',
      exhibits: 'SELECT COUNT(*) as c FROM forensic_exhibits',
    },
  },
];

async function isConfigured(db: D1Db, configKeys: string[]): Promise<boolean> {
  for (const key of configKeys) {
    const row = await db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1"
    ).get(key) as any;
    if (!row?.config_value) return false;
  }
  return true;
}

async function getLastSync(db: D1Db, table: string | null, timeCol: string | null): Promise<string | null> {
  if (!table || !timeCol) return null;
  try {
    const row = await db.prepare(`SELECT ${timeCol} as ts FROM ${table} ORDER BY id DESC LIMIT 1`).get() as any;
    return row?.ts || null;
  } catch { return null; }
}

async function getStats(db: D1Db, queries: { [key: string]: string }): Promise<Record<string, number>> {
  const stats: Record<string, number> = {};
  for (const [key, sql] of Object.entries(queries)) {
    try {
      stats[key] = (await db.prepare(sql).get() as any)?.c || 0;
    } catch { stats[key] = 0; }
  }
  return stats;
}

async function getIntegrationConfigValue(db: D1Db, key: string, jwtSecret: string): Promise<string | null> {
  const row = await db.prepare(
    "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1"
  ).get(key) as { config_value?: string } | undefined;
  if (!row?.config_value) return null;
  try {
    return await decryptApiKeyWeb(row.config_value, jwtSecret);
  } catch {
    return row.config_value;
  }
}

async function getHealth(db: D1Db, integrationId: string, configured: boolean): Promise<{
  health: string; lastHealthCheck: string | null; lastError: string | null;
  uptimePercent: number | null; connected: boolean;
}> {
  if (!configured) return { health: 'unconfigured', lastHealthCheck: null, lastError: null, uptimePercent: null, connected: false };
  const latest = await db.prepare(
    'SELECT * FROM integration_health_log WHERE integration_id = ? ORDER BY checked_at DESC LIMIT 1'
  ).get(integrationId) as any;
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const checks = await db.prepare(
    'SELECT status FROM integration_health_log WHERE integration_id = ? AND checked_at > ?'
  ).all(integrationId, twentyFourHoursAgo) as any[];
  let uptimePercent: number | null = null;
  if (checks.length > 0) {
    const healthy = checks.filter((c: any) => c.status === 'healthy').length;
    uptimePercent = Math.round((healthy / checks.length) * 100);
  }
  let health = 'healthy';
  if (latest?.status === 'error') health = 'error';
  else if (latest?.status === 'degraded') health = 'degraded';
  else if (!latest) health = 'degraded';
  return { health, lastHealthCheck: latest?.checked_at || null, lastError: latest?.status === 'error' ? latest.error_message : null, uptimePercent, connected: health === 'healthy' };
}

export function mountIntegrationsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  api.get('/status', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const statuses = await Promise.all(INTEGRATIONS.map(async (intg) => {
        const configured = await isConfigured(db, intg.configKeys);
        const lastSync = await getLastSync(db, intg.syncLogTable, intg.syncLogTimeColumn);
        const stats = await getStats(db, intg.statsQueries as unknown as { [key: string]: string });
        const healthInfo = await getHealth(db, intg.id, configured);
        return {
          id: intg.id, name: intg.name, description: intg.description, configured,
          connected: healthInfo.connected, lastSync, lastError: healthInfo.lastError,
          lastHealthCheck: healthInfo.lastHealthCheck, health: healthInfo.health,
          syncing: false, syncProgress: null, uptimePercent: healthInfo.uptimePercent, stats,
        };
      }));
      return c.json({ integrations: statuses });
    } catch {
      return c.json({ error: 'Failed to fetch integration status', code: 'FAILED_TO_FETCH_INTEGRATION' }, 500);
    }
  });

  api.get('/mapbox/client-token', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const envToken = ((c.env as any).MAPBOX_ACCESS_TOKEN || '').trim();
      const storedToken = await getIntegrationConfigValue(db, 'mapbox_access_token', c.env.JWT_SECRET) || null;
      const accessToken = envToken || storedToken || '';
      return c.json({
        configured: accessToken.length > 0,
        accessToken: accessToken || undefined,
        source: envToken ? 'env' : storedToken ? 'system_config' : 'missing',
      });
    } catch {
      return c.json({ configured: false, error: 'Failed to fetch Mapbox access token', code: 'FAILED_TO_FETCH_MAPBOX_TOKEN' }, 500);
    }
  });

  api.get('/health-log/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = c.req.param('id');
      const logs = await db.prepare(
        'SELECT * FROM integration_health_log WHERE integration_id = ? ORDER BY checked_at DESC LIMIT 50'
      ).all(id);
      return c.json({ logs });
    } catch {
      return c.json({ error: 'Failed to fetch health log', code: 'FAILED_TO_FETCH_HEALTH' }, 500);
    }
  });

  api.get('/keys', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const keys = await db.prepare(`
        SELECT id, name, key_prefix, is_active, scopes, last_used_at, request_count, created_at
        FROM integration_api_keys ORDER BY created_at DESC LIMIT 1000
      `).all() as any[];
      const mapped = keys.map((k: any) => ({
        id: k.id, name: k.name, key_prefix: k.key_prefix,
        status: k.is_active ? 'active' : 'revoked', scopes: k.scopes,
        last_used_at: k.last_used_at, request_count: k.request_count, created_at: k.created_at,
      }));
      return c.json(mapped);
    } catch (err: any) {
      if (err?.message?.includes('no such table')) return c.json([]);
      return c.json({ error: 'Failed to list API keys', code: 'FAILED_TO_LIST_API' }, 500);
    }
  });

  api.post('/keys', requireRole('admin'), async (c) => {
    try {
      const body = await c.req.json() as { name?: string; scopes?: string[] };
      const { name, scopes } = body;
      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        return c.json({ error: 'Name is required (min 2 characters)', code: 'NAME_IS_REQUIRED_MIN' }, 400);
      }
      const db = new D1Db(c.env.DB);
      const rawKey = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
      const fullKey = `rmpg_ps_${rawKey}`;
      const keyPrefix = `rmpg_ps_${rawKey.slice(0, 8)}...`;
      const keyHash = await hashApiKeyWeb(fullKey, c.env.JWT_SECRET);
      const scopeList = Array.isArray(scopes) ? JSON.stringify(scopes) : '["service_request"]';
      const user = c.get('user');
      const now = localNow();
      const result = await db.prepare(`
        INSERT INTO integration_api_keys (name, key_prefix, key_hash, is_active, scopes, created_by, created_at)
        VALUES (?, ?, ?, 1, ?, ?, ?)
      `).run(name.trim(), keyPrefix, keyHash, scopeList, user.userId, now);
      const id = Number(result.meta.last_row_id);
      return c.json({ success: true, id, name: name.trim(), key: fullKey, key_prefix: keyPrefix });
    } catch {
      return c.json({ error: 'Failed to create API key', code: 'FAILED_TO_CREATE_API' }, 500);
    }
  });

  api.patch('/keys/:id/revoke', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const existing = await db.prepare('SELECT id, name, is_active FROM integration_api_keys WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'API key not found', code: 'API_KEY_NOT_FOUND' }, 404);
      await db.prepare('UPDATE integration_api_keys SET is_active = 0 WHERE id = ?').run(id);
      return c.json({ success: true, message: `API key "${existing.name}" revoked` });
    } catch {
      return c.json({ error: 'Failed to revoke API key', code: 'FAILED_TO_REVOKE_API' }, 500);
    }
  });

  api.patch('/keys/:id/activate', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const existing = await db.prepare('SELECT id, name, is_active FROM integration_api_keys WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'API key not found', code: 'API_KEY_NOT_FOUND' }, 404);
      await db.prepare('UPDATE integration_api_keys SET is_active = 1 WHERE id = ?').run(id);
      return c.json({ success: true, message: `API key "${existing.name}" activated` });
    } catch {
      return c.json({ error: 'Failed to activate API key', code: 'FAILED_TO_ACTIVATE_API' }, 500);
    }
  });

  api.delete('/keys/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const existing = await db.prepare('SELECT id, name FROM integration_api_keys WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'API key not found', code: 'API_KEY_NOT_FOUND' }, 404);
      await db.prepare('DELETE FROM integration_api_keys WHERE id = ?').run(id);
      return c.json({ success: true, message: `API key "${existing.name}" deleted` });
    } catch {
      return c.json({ error: 'Failed to delete API key', code: 'FAILED_TO_DELETE_API' }, 500);
    }
  });

  api.get('/keys/request-log', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const logs = await db.prepare(`
        SELECT id, action, entity_type, entity_id, details, ip_address, created_at
        FROM activity_log WHERE entity_type = 'api_key' OR entity_type = 'service_request'
        ORDER BY created_at DESC LIMIT 100
      `).all() as any[];
      const mapped = logs.map((l: any) => ({
        id: l.id, created_at: l.created_at, details: l.details || l.action,
        ip_address: l.ip_address, entity_id: l.entity_id ? String(l.entity_id) : null,
      }));
      return c.json(mapped);
    } catch {
      return c.json({ error: 'Failed to fetch request log', code: 'FAILED_TO_FETCH_REQUEST' }, 500);
    }
  });

  api.get('/services/rmpgutahps', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const keyRow = await db.prepare(
        "SELECT config_value FROM system_config WHERE config_key = 'rmpgutahps_api_key' AND category = 'integrations' AND is_active = 1 LIMIT 1"
      ).get() as { config_value: string } | undefined;
      const urlRow = await db.prepare(
        "SELECT config_value FROM system_config WHERE config_key = 'rmpgutahps_url' AND category = 'integrations' AND is_active = 1 LIMIT 1"
      ).get() as { config_value: string } | undefined;
      let keyPreview: string | null = null;
      if (keyRow) {
        try {
          const decrypted = await decryptApiKeyWeb(keyRow.config_value, c.env.JWT_SECRET);
          keyPreview = '••••••••' + decrypted.slice(-8);
        } catch { keyPreview = '••••••••'; }
      }
      return c.json({
        configured: !!keyRow, url: urlRow?.config_value || 'https://rmpgutahps.us', key_preview: keyPreview,
      });
    } catch {
      return c.json({ error: 'Failed to get service config.', code: 'FAILED_TO_GET_SERVICE' }, 500);
    }
  });

  api.put('/services/rmpgutahps', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json() as { api_key?: string; url?: string };
      const { api_key, url } = body;
      const now = localNow();
      if (!api_key || typeof api_key !== 'string' || !api_key.trim()) {
        return c.json({ error: 'api_key is required.', code: 'APIKEY_IS_REQUIRED' }, 400);
      }
      const encrypted = await encryptApiKeyWeb(api_key.trim(), c.env.JWT_SECRET);
      await db.prepare("DELETE FROM system_config WHERE config_key = 'rmpgutahps_api_key' AND category = 'integrations'").run();
      await db.prepare(`
        INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at)
        VALUES ('rmpgutahps_api_key', ?, 'integrations', 0, 1, ?, ?)
      `).run(encrypted, now, now);
      const siteUrl = (url && typeof url === 'string' && url.trim()) ? url.trim() : 'https://rmpgutahps.us';
      await db.prepare("DELETE FROM system_config WHERE config_key = 'rmpgutahps_url' AND category = 'integrations'").run();
      await db.prepare(`
        INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at)
        VALUES ('rmpgutahps_url', ?, 'integrations', 0, 1, ?, ?)
      `).run(siteUrl, now, now);
      return c.json({ success: true, message: 'rmpgutahps.us API key saved.' });
    } catch {
      return c.json({ error: 'Failed to save service config.', code: 'FAILED_TO_SAVE_SERVICE' }, 500);
    }
  });

  api.delete('/services/rmpgutahps', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      await db.prepare(
        "DELETE FROM system_config WHERE config_key IN ('rmpgutahps_api_key', 'rmpgutahps_url') AND category = 'integrations'"
      ).run();
      return c.json({ success: true, message: 'rmpgutahps.us API key cleared.' });
    } catch {
      return c.json({ error: 'Failed to clear service config.', code: 'FAILED_TO_CLEAR_SERVICE' }, 500);
    }
  });

  app.route('/api/integrations', api);
}
