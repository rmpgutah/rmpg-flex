import { Hono } from 'hono';
import { getDb, withD1Retry } from '../utils/db';
import { log } from '../utils/logger';
import type { Bindings, Variables } from '../types';

const health = new Hono<{ Bindings: Bindings; Variables: Variables }>();

async function checkD1(db: D1Database): Promise<{ connected: boolean; version: string; users: number; latencyMs?: number; code?: string }> {
  const start = Date.now();
  try {
    let dbVersion = 'unknown';
    try {
      const result = await withD1Retry(() =>
        db.prepare('SELECT config_value AS value FROM system_config WHERE config_key = ?').bind('db_version').first<{ value: string }>(),
      );
      dbVersion = result?.value ?? 'unknown';
    } catch { /* non-essential */ }
    const userCount = await withD1Retry(() =>
      db.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>(),
    );
    return {
      connected: true,
      version: dbVersion,
      users: userCount?.count ?? 0,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    log.warn('Health D1 probe failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return { connected: false, version: 'error', users: 0, latencyMs: Date.now() - start, code: 'query_failed' };
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

// `bound: false` is only emitted when the binding is absent from the env, so an
// unbound OPTIONAL bucket (KIOSK_DEVICES on a preview deploy / local wrangler dev)
// is distinguishable from a bound bucket whose R2 call actually failed. Both still
// report connected:false; callers decide whether "absent" counts against health.
// Output for the always-bound buckets is unchanged — they never take this branch.
async function checkR2(bucket: R2Bucket | undefined, name: string): Promise<{ connected: boolean; latencyMs?: number; bound?: boolean }> {
  if (!bucket) return { connected: false, bound: false };
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
  const kioskDevicesPromise = checkR2(c.env.KIOSK_DEVICES, 'KIOSK_DEVICES');

  const [d1, kv, mapData, uploads, downloads, kioskDevices] = await Promise.all([
    d1Promise, kvPromise, mapDataPromise, uploadsPromise, downloadsPromise, kioskDevicesPromise,
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

  // kiosk_devices is deliberately REPORT-ONLY — it is reported in `services` but
  // never contributes to `allOk`, in any of its three states (reachable /
  // unbound / bound-but-throwing). Two reasons:
  //   1. KIOSK_DEVICES is an optional binding, so envs that don't bind it
  //      (preview deploys, local wrangler dev) would otherwise be permanently
  //      `degraded` for a bucket they were never meant to have.
  //   2. A broken kiosk-fleet bucket is not an API outage. `status` here means
  //      "the API is serving", and a deploy-time R2 auth failure on this bucket
  //      already fails loudly at `wrangler deploy` (the Deploy Worker step has
  //      no continue-on-error) — that, not this probe, is the real gate. See the
  //      2026-07-24 kiosk-linux-devices token-scope incident.
  // Operators reading the payload still see the bucket's true state.
  const allOk = d1.connected && kv.connected && mapData.connected && uploads.connected && downloads.connected
    && Object.values(doResults).every((r) => r.connected);

  log.info('Health check', { traceId, d1: d1.connected, kv: kv.connected, status: allOk ? 'ok' : 'degraded' });

  // Built ONCE and shared by both the ok and degraded responses. These were
  // previously two hand-maintained literals, which silently diverged: a field
  // added to the degraded branch only was invisible in prod (which serves `ok`)
  // while tests passed against the degraded branch. Keep this single-source.
  const payload = {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    services: {
      d1,
      kv,
      map_data: mapData,
      uploads,
      downloads,
      kiosk_devices: kioskDevices,
      durable_objects: doResults,
    },
  };

  // 200 in both cases — this is a health probe, not a user-facing error.
  return c.json({ status: allOk ? 'ok' : 'degraded', ...payload }, 200);
});

export default health;
