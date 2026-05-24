import { getDb } from '../models/database';
import { broadcast } from './websocket';

const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const MAX_LOG_AGE_DAYS = 7;

interface IntegrationProbe {
  id: string;
  name: string;
  configKeys: string[];
  testFn: () => Promise<{ ok: boolean; responseTimeMs: number; error?: string }>;
}

const failureCounts: Record<string, number> = {};
const previousHealth: Record<string, string> = {};

function isConfigured(db: any, configKeys: string[]): boolean {
  for (const key of configKeys) {
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1"
    ).get(key) as any;
    if (!row?.config_value) return false;
  }
  return true;
}

async function probeIntegration(probe: IntegrationProbe): Promise<void> {
  const db = getDb();
  if (!isConfigured(db, probe.configKeys)) {
    previousHealth[probe.id] = 'unconfigured';
    return;
  }

  const start = Date.now();
  let status = 'healthy';
  let errorMessage: string | null = null;
  let responseTimeMs = 0;

  try {
    const result = await probe.testFn();
    responseTimeMs = result.responseTimeMs;
    if (!result.ok) {
      status = 'error';
      errorMessage = result.error || 'Connection test failed';
    }
  } catch (err: any) {
    responseTimeMs = Date.now() - start;
    status = 'error';
    errorMessage = err.message || 'Unknown error';
  }

  db.prepare(
    'INSERT INTO integration_health_log (integration_id, status, response_time_ms, error_message) VALUES (?, ?, ?, ?)'
  ).run(probe.id, status, responseTimeMs, errorMessage);

  if (status === 'error') {
    failureCounts[probe.id] = (failureCounts[probe.id] || 0) + 1;
  } else {
    failureCounts[probe.id] = 0;
  }

  const prev = previousHealth[probe.id];
  if (prev && prev !== status) {
    broadcast('system', 'integration_health_alert', {
      integrationId: probe.id,
      integrationName: probe.name,
      previousHealth: prev,
      currentHealth: status,
      error: errorMessage,
      timestamp: new Date().toISOString(),
      consecutiveFailures: failureCounts[probe.id] || 0,
    });
  }
  previousHealth[probe.id] = status;

  if ((failureCounts[probe.id] || 0) >= CONSECUTIVE_FAILURE_THRESHOLD) {
    console.warn(`[HealthChecker] ${probe.name} has ${failureCounts[probe.id]} consecutive failures`);
  }
}

async function testClearPathGps(): Promise<{ ok: boolean; responseTimeMs: number; error?: string }> {
  const start = Date.now();
  try {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM cpgps_vehicles').get() as any)?.c;
    return { ok: count !== undefined, responseTimeMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, responseTimeMs: Date.now() - start, error: err.message };
  }
}

async function testServeManager(): Promise<{ ok: boolean; responseTimeMs: number; error?: string }> {
  const start = Date.now();
  try {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM sm_jobs').get() as any)?.c;
    return { ok: count !== undefined, responseTimeMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, responseTimeMs: Date.now() - start, error: err.message };
  }
}

async function testMicrobilt(): Promise<{ ok: boolean; responseTimeMs: number; error?: string }> {
  const start = Date.now();
  try {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM ofac_sdn_entries').get() as any)?.c;
    return { ok: count !== undefined, responseTimeMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, responseTimeMs: Date.now() - start, error: err.message };
  }
}

async function testIped(): Promise<{ ok: boolean; responseTimeMs: number; error?: string }> {
  const start = Date.now();
  try {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM forensic_cases').get() as any)?.c;
    return { ok: count !== undefined, responseTimeMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, responseTimeMs: Date.now() - start, error: err.message };
  }
}

const PROBES: IntegrationProbe[] = [
  { id: 'clearpathgps', name: 'ClearPathGPS', configKeys: ['clearpathgps_account', 'clearpathgps_user', 'clearpathgps_password'], testFn: testClearPathGps },
  { id: 'servemanager', name: 'ServeManager', configKeys: ['servemanager_api_key'], testFn: testServeManager },
  { id: 'microbilt', name: 'Microbilt', configKeys: ['microbilt_client_id', 'microbilt_client_secret'], testFn: testMicrobilt },
  { id: 'iped', name: 'IPED', configKeys: ['iped_base_url', 'iped_api_key'], testFn: testIped },
];

async function runHealthChecks(): Promise<void> {
  for (const probe of PROBES) {
    try {
      await probeIntegration(probe);
    } catch (err) {
      console.error(`[HealthChecker] Error probing ${probe.name}:`, err);
    }
  }

  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM integration_health_log WHERE checked_at < ?').run(cutoff);
  } catch { /* ignore cleanup errors */ }
}

let healthInterval: ReturnType<typeof setInterval> | null = null;

export function startHealthChecker(): void {
  console.log('[HealthChecker] Starting integration health monitoring (every 5 min)');
  setTimeout(() => {
    runHealthChecks();
    healthInterval = setInterval(runHealthChecks, HEALTH_CHECK_INTERVAL);
  }, 30_000);
}

export function stopHealthChecker(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}
