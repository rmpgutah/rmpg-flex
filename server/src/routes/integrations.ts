import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { localNow } from '../utils/timeUtils';
import { encryptApiKey, decryptApiKey } from '../utils/serveManagerClient';
import { hashApiKey } from '../utils/apiKeyHash';

const router = Router();
router.use(authenticateToken);

// Integration metadata registry
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

function isConfigured(db: any, configKeys: string[]): boolean {
  for (const key of configKeys) {
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1"
    ).get(key) as any;
    if (!row?.config_value) return false;
  }
  return true;
}

function getLastSync(db: any, table: string | null, timeCol: string | null): string | null {
  if (!table || !timeCol) return null;
  try {
    const row = db.prepare(`SELECT ${timeCol} as ts FROM ${table} ORDER BY id DESC LIMIT 1`).get() as any;
    return row?.ts || null;
  } catch { return null; }
}

function getStats(db: any, queries: { [key: string]: string }): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const [key, sql] of Object.entries(queries)) {
    try {
      stats[key] = (db.prepare(sql).get() as any)?.c || 0;
    } catch { stats[key] = 0; }
  }
  return stats;
}

function getIntegrationConfigValue(db: any, key: string): string | null {
  const row = db.prepare(
    "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1"
  ).get(key) as { config_value?: string } | undefined;
  if (!row?.config_value) return null;
  try {
    return decryptApiKey(row.config_value);
  } catch {
    return row.config_value;
  }
}

function getHealth(db: any, integrationId: string, configured: boolean): {
  health: string; lastHealthCheck: string | null; lastError: string | null;
  uptimePercent: number | null; connected: boolean;
} {
  if (!configured) return { health: 'unconfigured', lastHealthCheck: null, lastError: null, uptimePercent: null, connected: false };

  const latest = db.prepare(
    'SELECT * FROM integration_health_log WHERE integration_id = ? ORDER BY checked_at DESC LIMIT 1'
  ).get(integrationId) as any;

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const checks = db.prepare(
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

  return {
    health,
    lastHealthCheck: latest?.checked_at || null,
    lastError: latest?.status === 'error' ? latest.error_message : null,
    uptimePercent,
    connected: health === 'healthy',
  };
}

// GET /api/integrations/status
router.get('/status', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const statuses = INTEGRATIONS.map(intg => {
      const configured = isConfigured(db, intg.configKeys);
      const lastSync = getLastSync(db, intg.syncLogTable, intg.syncLogTimeColumn);
      const stats = getStats(db, intg.statsQueries as unknown as { [key: string]: string });
      const healthInfo = getHealth(db, intg.id, configured);

      return {
        id: intg.id,
        name: intg.name,
        description: intg.description,
        configured,
        connected: healthInfo.connected,
        lastSync,
        lastError: healthInfo.lastError,
        lastHealthCheck: healthInfo.lastHealthCheck,
        health: healthInfo.health,
        syncing: false,
        syncProgress: null,
        uptimePercent: healthInfo.uptimePercent,
        stats,
      };
    });

    res.json({ integrations: statuses });
  } catch (error: any) {
    console.error('Integration status error:', error);
    res.status(500).json({ error: 'Failed to fetch integration status', code: 'FAILED_TO_FETCH_INTEGRATION' });
  }
});

// GET /api/integrations/google-maps/client-key
// Exposes the browser-safe Maps JS key to authenticated app users so
// live production maps do not depend on a build-time Vite env var.
router.get('/google-maps/client-key', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const envKey = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
    const storedKey =
      getIntegrationConfigValue(db, 'google_maps_api_key')
      || getIntegrationConfigValue(db, 'google_maps_browser_key')
      || null;

    const apiKey = envKey || storedKey || '';

    res.json({
      configured: apiKey.length > 0,
      apiKey: apiKey || undefined,
      source: envKey ? 'env' : storedKey ? 'system_config' : 'missing',
    });
  } catch (error: any) {
    console.error('Google Maps key fetch error:', error);
    res.status(500).json({
      configured: false,
      error: 'Failed to fetch Google Maps key',
      code: 'FAILED_TO_FETCH_GOOGLE_MAPS_KEY',
    });
  }
});

// GET /api/integrations/health-log/:id
router.get('/health-log/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const logs = db.prepare(
      'SELECT * FROM integration_health_log WHERE integration_id = ? ORDER BY checked_at DESC LIMIT 50'
    ).all(req.params.id);
    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch health log', code: 'FAILED_TO_FETCH_HEALTH' });
  }
});

// ── API Key Management ──────────────────────────────────────

// GET /api/integrations/keys — List all API keys
router.get('/keys', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const keys = db.prepare(`
      SELECT id, name, key_prefix, is_active, scopes, last_used_at, request_count, created_at
      FROM integration_api_keys
      ORDER BY created_at DESC
    
      LIMIT 1000
    `).all() as any[];

    const mapped = keys.map((k: any) => ({
      id: k.id,
      name: k.name,
      key_prefix: k.key_prefix,
      status: k.is_active ? 'active' : 'revoked',
      scopes: k.scopes,
      last_used_at: k.last_used_at,
      request_count: k.request_count,
      created_at: k.created_at,
    }));

    res.json(mapped);
  } catch (error: any) {
    console.error('List API keys error:', error);
    res.status(500).json({ error: 'Failed to list API keys', code: 'FAILED_TO_LIST_API' });
  }
});

// POST /api/integrations/keys — Create a new API key
router.post('/keys', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { name, scopes } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Name is required (min 2 characters)', code: 'NAME_IS_REQUIRED_MIN' });
    }

    const db = getDb();

    // Generate the API key: rmpg_ps_ prefix + 32 random hex chars
    const rawKey = crypto.randomBytes(32).toString('hex');
    const fullKey = `rmpg_ps_${rawKey}`;
    const keyPrefix = `rmpg_ps_${rawKey.slice(0, 8)}...`;
    const keyHash = hashApiKey(fullKey);

    const scopeList = Array.isArray(scopes) ? JSON.stringify(scopes) : '["service_request"]';
    const userId = (req as any).user?.id || null;
    const now = localNow();

    const result = db.prepare(`
      INSERT INTO integration_api_keys (name, key_prefix, key_hash, is_active, scopes, created_by, created_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)
    `).run(name.trim(), keyPrefix, keyHash, scopeList, userId, now);

    auditLog(req, 'api_key_created', 'api_key', Number(result.lastInsertRowid), `Created API key: ${name.trim()}`);

    res.json({
      success: true,
      id: Number(result.lastInsertRowid),
      name: name.trim(),
      key: fullKey,
      key_prefix: keyPrefix,
    });
  } catch (error: any) {
    console.error('Create API key error:', error);
    res.status(500).json({ error: 'Failed to create API key', code: 'FAILED_TO_CREATE_API' });
  }
});

// PATCH /api/integrations/keys/:id/revoke — Revoke an API key
router.patch('/keys/:id/revoke', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);

    const existing = db.prepare('SELECT id, name, is_active FROM integration_api_keys WHERE id = ?').get(id) as any;
    if (!existing) {
      return res.status(404).json({ error: 'API key not found', code: 'API_KEY_NOT_FOUND' });
    }

    db.prepare('UPDATE integration_api_keys SET is_active = 0 WHERE id = ?').run(id);
    auditLog(req, 'api_key_revoked', 'api_key', id, `Revoked API key: ${existing.name}`);

    res.json({ success: true, message: `API key "${existing.name}" revoked` });
  } catch (error: any) {
    console.error('Revoke API key error:', error);
    res.status(500).json({ error: 'Failed to revoke API key', code: 'FAILED_TO_REVOKE_API' });
  }
});

// PATCH /api/integrations/keys/:id/activate — Activate a revoked API key
router.patch('/keys/:id/activate', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);

    const existing = db.prepare('SELECT id, name, is_active FROM integration_api_keys WHERE id = ?').get(id) as any;
    if (!existing) {
      return res.status(404).json({ error: 'API key not found', code: 'API_KEY_NOT_FOUND' });
    }

    db.prepare('UPDATE integration_api_keys SET is_active = 1 WHERE id = ?').run(id);
    auditLog(req, 'api_key_activated', 'api_key', id, `Activated API key: ${existing.name}`);

    res.json({ success: true, message: `API key "${existing.name}" activated` });
  } catch (error: any) {
    console.error('Activate API key error:', error);
    res.status(500).json({ error: 'Failed to activate API key', code: 'FAILED_TO_ACTIVATE_API' });
  }
});

// DELETE /api/integrations/keys/:id — Delete an API key
router.delete('/keys/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);

    const existing = db.prepare('SELECT id, name FROM integration_api_keys WHERE id = ?').get(id) as any;
    if (!existing) {
      return res.status(404).json({ error: 'API key not found', code: 'API_KEY_NOT_FOUND' });
    }

    db.prepare('DELETE FROM integration_api_keys WHERE id = ?').run(id);
    auditLog(req, 'api_key_deleted', 'api_key', id, `Deleted API key: ${existing.name}`);

    res.json({ success: true, message: `API key "${existing.name}" deleted` });
  } catch (error: any) {
    console.error('Delete API key error:', error);
    res.status(500).json({ error: 'Failed to delete API key', code: 'FAILED_TO_DELETE_API' });
  }
});

// GET /api/integrations/keys/request-log — Fetch API request log
router.get('/keys/request-log', requireRole('admin'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const logs = db.prepare(`
      SELECT id, action, entity_type, entity_id, details, ip_address, created_at
      FROM activity_log
      WHERE entity_type = 'api_key' OR entity_type = 'service_request'
      ORDER BY created_at DESC
      LIMIT 100
    `).all() as any[];

    const mapped = logs.map((l: any) => ({
      id: l.id,
      created_at: l.created_at,
      details: l.details || l.action,
      ip_address: l.ip_address,
      entity_id: l.entity_id ? String(l.entity_id) : null,
    }));

    res.json(mapped);
  } catch (error: any) {
    console.error('Request log error:', error);
    res.status(500).json({ error: 'Failed to fetch request log', code: 'FAILED_TO_FETCH_REQUEST' });
  }
});

// ── Connected Services: rmpgutahps.us Config ─────────────────

// GET /api/integrations/services/rmpgutahps — Connection status
router.get('/services/rmpgutahps', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const keyRow = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'rmpgutahps_api_key' AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get() as { config_value: string } | undefined;

    const urlRow = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'rmpgutahps_url' AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get() as { config_value: string } | undefined;

    res.json({
      configured: !!keyRow,
      url: urlRow?.config_value || 'https://rmpgutahps.us',
      key_preview: keyRow ? '••••••••' + decryptApiKey(keyRow.config_value).slice(-8) : null,
    });
  } catch (err: any) {
    console.error('[Integrations] Get rmpgutahps config error:', err);
    res.status(500).json({ error: 'Failed to get service config.', code: 'FAILED_TO_GET_SERVICE' });
  }
});

// PUT /api/integrations/services/rmpgutahps — Save API key + URL
router.put('/services/rmpgutahps', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { api_key, url } = req.body;
    const now = localNow();

    if (!api_key || typeof api_key !== 'string' || !api_key.trim()) {
      return res.status(400).json({ error: 'api_key is required.', code: 'APIKEY_IS_REQUIRED' });
    }

    const encrypted = encryptApiKey(api_key.trim());

    db.prepare("DELETE FROM system_config WHERE config_key = 'rmpgutahps_api_key' AND category = 'integrations'").run();
    db.prepare(`
      INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at)
      VALUES ('rmpgutahps_api_key', ?, 'integrations', 0, 1, ?, ?)
    `).run(encrypted, now, now);

    const siteUrl = (url && typeof url === 'string' && url.trim()) ? url.trim() : 'https://rmpgutahps.us';
    db.prepare("DELETE FROM system_config WHERE config_key = 'rmpgutahps_url' AND category = 'integrations'").run();
    db.prepare(`
      INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at)
      VALUES ('rmpgutahps_url', ?, 'integrations', 0, 1, ?, ?)
    `).run(siteUrl, now, now);

    auditLog(req, 'config_updated', 'config', 0, `Updated rmpgutahps.us API key and URL (${siteUrl})`);

    res.json({ success: true, message: 'rmpgutahps.us API key saved.' });
  } catch (err: any) {
    console.error('[Integrations] Save rmpgutahps config error:', err);
    res.status(500).json({ error: 'Failed to save service config.', code: 'FAILED_TO_SAVE_SERVICE' });
  }
});

// DELETE /api/integrations/services/rmpgutahps — Clear API key
router.delete('/services/rmpgutahps', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(
      "DELETE FROM system_config WHERE config_key IN ('rmpgutahps_api_key', 'rmpgutahps_url') AND category = 'integrations'"
    ).run();

    auditLog(req, 'config_updated', 'config', 0, 'Cleared rmpgutahps.us API key');

    res.json({ success: true, message: 'rmpgutahps.us API key cleared.' });
  } catch (err: any) {
    console.error('[Integrations] Clear rmpgutahps config error:', err);
    res.status(500).json({ error: 'Failed to clear service config.', code: 'FAILED_TO_CLEAR_SERVICE' });
  }
});

export default router;
