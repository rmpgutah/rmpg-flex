import { Hono } from 'hono';
import { getDb } from '../utils/db';
import { log } from '../utils/logger';
import type { Bindings, Variables } from '../types';

const health = new Hono<{ Bindings: Bindings; Variables: Variables }>();

async function checkD1(db: D1Database): Promise<{ connected: boolean; version: string; users: number; latencyMs?: number }> {
  const start = Date.now();
  try {
    let dbVersion = 'unknown';
    try {
      const result = await db.prepare('SELECT config_value AS value FROM system_config WHERE config_key = ?').bind('db_version').first<{ value: string }>();
      dbVersion = result?.value ?? 'unknown';
    } catch { /* non-essential */ }
    const userCount = await db.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
    return {
      connected: true,
      version: dbVersion,
      users: userCount?.count ?? 0,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return { connected: false, version: 'error', users: 0, latencyMs: Date.now() - start };
  }
}

async function checkKV(kv: KVNamespace | undefined): Promise<{ connected: boolean; latencyMs?: number }> {
  if (!kv) return { connected: false };
  const start = Date.now();
  try {
    await kv.get('__health_probe');
    return { connected: true, latencyMs: Date.now() - start };
  } catch {
    return { connected: false, latencyMs: Date.now() - start };
  }
}

async function checkR2(bucket: R2Bucket | undefined, name: string): Promise<{ connected: boolean; latencyMs?: number }> {
  if (!bucket) return { connected: false };
  const start = Date.now();
  try {
    await bucket.head('__health_probe');
    return { connected: true, latencyMs: Date.now() - start };
  } catch {
    return { connected: false, latencyMs: Date.now() - start };
  }
}

async function checkDO(doNs: DurableObjectNamespace | undefined, name: string): Promise<{ connected: boolean }> {
  if (!doNs) return { connected: false };
  try {
    const stub = doNs.idFromName('__health_probe');
    return { connected: !!stub };
  } catch {
    return { connected: false };
  }
}

health.get('/', async (c) => {
  const db = getDb(c.env);
  const traceId = c.get('traceId') as string | undefined;

  const d1Promise = checkD1(db);
  const kvPromise = checkKV(c.env.KV);
  const mapDataPromise = checkR2(c.env.MAP_DATA, 'MAP_DATA');
  const uploadsPromise = checkR2(c.env.UPLOADS, 'UPLOADS');
  const downloadsPromise = checkR2(c.env.DOWNLOADS, 'DOWNLOADS');

  const [d1, kv, mapData, uploads, downloads] = await Promise.all([
    d1Promise, kvPromise, mapDataPromise, uploadsPromise, downloadsPromise,
  ]);

  // Durable Objects — lightweight existence check
  const doResults: Record<string, { connected: boolean }> = {};
  const doChecks: Array<[DurableObjectNamespace | undefined, string]> = [
    [c.env.WELFARE_WATCH, 'welfare_watch'],
    [c.env.VOICE_HUB, 'voice_hub'],
    [c.env.ALERT_HUB, 'alert_hub'],
    [c.env.DEEP_RESEARCH, 'deep_research'],
    [c.env.PERSON_INTEL_DO, 'person_intel'],
    [c.env.FLEXCAM_REMUX, 'flexcam_remux'],
  ];
  for (const [ns, name] of doChecks) {
    doResults[name] = await checkDO(ns, name);
  }

  const allOk = d1.connected && kv.connected && mapData.connected && uploads.connected && downloads.connected
    && Object.values(doResults).every((r) => r.connected);

  log.info('Health check', { traceId, d1: d1.connected, kv: kv.connected, status: allOk ? 'ok' : 'degraded' });

  if (!allOk) {
    return c.json({
      status: 'degraded',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      services: { d1, kv, map_data: mapData, uploads, downloads, durable_objects: doResults },
    }, 200); // 200 still — this is a health probe, not a user-facing error
  }

  return c.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    services: { d1, kv, map_data: mapData, uploads, downloads, durable_objects: doResults },
  });
});

export default health;
