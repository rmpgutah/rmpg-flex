import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';

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

function getStats(db: any, queries: Record<string, string>): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const [key, sql] of Object.entries(queries)) {
    try {
      stats[key] = (db.prepare(sql).get() as any)?.c || 0;
    } catch { stats[key] = 0; }
  }
  return stats;
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
      const stats = getStats(db, intg.statsQueries);
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
    res.status(500).json({ error: 'Failed to fetch integration status' });
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
    res.status(500).json({ error: 'Failed to fetch health log' });
  }
});

export default router;
