// ============================================================
// RMPG Flex — ClearPath media sync (Worker-native, Phase B)
// ============================================================
// Cloudflare-Worker port of legacy/server-vps/src/utils/clearPathGpsMediaPoller.ts.
// Differences from the VPS poller:
//   • No setInterval — driven by the per-minute cron (maybeRunClearpathMediaSync),
//     self-throttled by clearpathgps_last_media_sync vs the configured interval.
//   • No fs/streams — the pre-signed S3 clip body is streamed straight into R2
//     (env.UPLOADS) under the dashcam/ prefix; no buffering of whole videos.
//   • Rate-limit cooldown is kept in KV (Workers are stateless), not a module global.
//
// Each synced clip → a dashcam_videos row (+ R2 object); each media event →
// a dashcam_events row. Phase C ALPRs the outside-channel clips off this loop.
// ============================================================

import type { Bindings } from '../types';
import { getDb, query, queryFirst, execute, columnExists } from './db';
import {
  getApiConfig, isEnabled, getConfigValue, setConfigValue, CPG_KEYS,
  listCameras, listAllMedia,
  CpgRateLimitError,
  type CpgClient, type CpgCamera, type CpgMediaEvent, type CpgMediaObject,
} from './clearpathGps';

type DB = D1Database;

const R2_PREFIX = 'dashcam/';
const COOLDOWN_KV_KEY = 'cpg:media:cooldown_until';
const MAX_CLIPS_PER_RUN = 40;          // bound work per cron tick
const LOOKBACK_FIRST_SYNC_MS = 7 * 24 * 60 * 60 * 1000; // 7 days on first sync

// ── Pure helpers (exported for tests) ────────────────────────

/** ClearPath GPS speed is km/h; convert to mph (rounded). null-safe. */
export function kmhToMph(kmh: number | null | undefined): number | null {
  if (kmh == null || !Number.isFinite(kmh) || kmh < 0) return null;
  return Math.round(kmh * 0.621371);
}

/** Normalised channel — "outside" (road/front) vs "inside" (cabin). */
export function channelOf(mo: CpgMediaObject): string {
  return (mo.channel || 'outside').toLowerCase();
}

/** True for the road-facing camera the ALPR pipeline reads. */
export function isOutsideChannel(channel: string): boolean {
  const c = channel.toLowerCase();
  return c !== 'inside' && c !== 'interior' && c !== 'cabin';
}

/** Downloadable VIDEO objects from a media event, expiring-soon first. */
export function pickVideoObjects(event: CpgMediaEvent): CpgMediaObject[] {
  return (event.mediaObject || [])
    .filter((mo) => mo.type === 'VIDEO' && mo.status === 'AVAILABLE' && !!mo.accessUrl)
    .sort((a, b) => (b.expiringSoon ? 1 : 0) - (a.expiringSoon ? 1 : 0));
}

/** A stable dedupe key for a (device, event-time, channel) clip. */
export function mediaDedupeKey(deviceId: string, timestampMs: number, channel: string): string {
  return `${deviceId}|${timestampMs}|${channel}`;
}

/** ISO-ish UTC timestamp 'YYYY-MM-DD HH:MM:SS' from epoch ms. */
export function formatTs(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('T', ' ').replace(/\..*$/, '');
}

/** R2 object key for a clip. */
export function r2KeyFor(deviceId: string, timestampMs: number, channel: string): string {
  const safeDevice = deviceId.replace(/[^a-zA-Z0-9_-]/g, '');
  return `${R2_PREFIX}${safeDevice}/${timestampMs}_${channel}.mp4`;
}

// ── Schema reconcile (backstop if 0117 didn't reach live) ────

let mediaSchemaReady = false;
async function ensureMediaSchema(db: DB): Promise<void> {
  if (mediaSchemaReady) return;
  const cols: Array<[string, string]> = [
    ['cpg_device_id', 'TEXT'], ['cpg_camera_id', 'INTEGER'], ['cpg_media_timestamp', 'INTEGER'],
    ['cpg_channel', 'TEXT'], ['cpg_event_type', 'TEXT'], ['cpg_access_url', 'TEXT'],
    ['cpg_thumbnail_url', 'TEXT'], ['cpg_gps_track', 'TEXT'], ['r2_key', 'TEXT'],
    ['linked_dashcam_event_id', 'INTEGER'], ['alpr_status', 'TEXT'],
  ];
  for (const [name, type] of cols) {
    try { if (!(await columnExists(db, 'dashcam_videos', name))) await execute(db, `ALTER TABLE dashcam_videos ADD COLUMN ${name} ${type}`); }
    catch { /* race / absent — best effort */ }
  }
  await execute(db, `CREATE TABLE IF NOT EXISTS dashcam_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cpg_device_id TEXT NOT NULL, unit_id INTEGER, dashcam_id TEXT,
    event_type TEXT NOT NULL, event_timestamp TEXT NOT NULL, cpg_media_timestamp INTEGER,
    latitude REAL, longitude REAL, speed_mph REAL, address TEXT,
    status_code TEXT, status_code_text TEXT, video_available INTEGER DEFAULT 0,
    source TEXT DEFAULT 'clearpathgps', created_at TEXT DEFAULT (datetime('now'))
  )`);
  mediaSchemaReady = true;
}

// ── Camera-id resolution ─────────────────────────────────────

interface MappingRow {
  id: number; cpg_device_id: string; cpg_display_name: string | null;
  unit_id: number | null; cpg_camera_id: number | null; last_media_synced_at: string | null;
}

async function resolveCameraId(db: DB, m: MappingRow, cameras: CpgCamera[] | null): Promise<number | null> {
  if (m.cpg_camera_id) return m.cpg_camera_id;
  if (!cameras?.length) return null;
  const name = (m.cpg_display_name || '').toLowerCase();
  const byName = name ? cameras.find((c) => c.name.toLowerCase() === name) : undefined;
  const byProvider = cameras.find((c) => c.providerId === m.cpg_device_id);
  const cam = byName || byProvider;
  if (!cam) return null;
  try { await execute(db, 'UPDATE cpg_device_mappings SET cpg_camera_id = ? WHERE id = ?', cam.id, m.id); } catch { /* non-fatal */ }
  return cam.id;
}

// ── Download one clip → R2 → dashcam_videos ──────────────────

async function storeClip(
  env: Bindings, db: DB, m: MappingRow, cameraId: number,
  event: CpgMediaEvent, mo: CpgMediaObject,
): Promise<{ videoId: number; channel: string; r2Key: string } | null> {
  const timestamp = event.eventTimestamp;
  const channel = channelOf(mo);
  const r2Key = r2KeyFor(m.cpg_device_id, timestamp, channel);

  // Stream the pre-signed S3 body straight into R2 (no buffering).
  const resp = await fetch(mo.accessUrl, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!resp.ok || !resp.body) throw new Error(`S3 download ${resp.status}`);
  const contentType = resp.headers.get('content-type') || 'video/mp4';
  const put = await env.UPLOADS.put(r2Key, resp.body, { httpMetadata: { contentType } });
  const fileSize = put?.size ?? parseInt(resp.headers.get('content-length') || '0', 10);

  const lat = mo.location?.lat ?? mo.gps?.[0]?.latitude ?? null;
  const lng = mo.location?.lng ?? mo.gps?.[0]?.longitude ?? null;
  const speedMph = kmhToMph(mo.gps?.[0]?.speed);
  const gpsTrack = mo.gps?.length ? JSON.stringify(mo.gps) : null;
  const eventLabel = mo.eventType || mo.title || 'Camera Event';
  const deviceName = m.cpg_display_name || m.cpg_device_id;
  const title = `${deviceName} — ${isOutsideChannel(channel) ? 'Front' : 'Cabin'} — ${eventLabel}`;
  const alprStatus = isOutsideChannel(channel) ? 'pending' : 'skipped';

  const r = await execute(db, `
    INSERT INTO dashcam_videos
      (vehicle_id, unit_id, title, file_path, file_size, mime_type, recorded_at,
       speed_mph, latitude, longitude, address, notes, source, classification,
       cpg_device_id, cpg_camera_id, cpg_media_timestamp, cpg_channel, cpg_event_type,
       cpg_access_url, cpg_thumbnail_url, cpg_gps_track, r2_key, alpr_status, created_at, updated_at)
    VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'clearpathgps', 'routine',
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `,
    m.unit_id, title, r2Key, fileSize, contentType, formatTs(timestamp),
    speedMph, lat, lng, event.address || null,
    `Auto-synced from ClearPath. Event: ${eventLabel}. Device: ${deviceName}. Camera: ${cameraId}.`,
    m.cpg_device_id, cameraId, timestamp, channel, mo.eventType || '',
    mo.accessUrl || null, mo.thumbnailUrl || null, gpsTrack, r2Key, alprStatus,
  );
  return { videoId: Number(r.meta.last_row_id), channel, r2Key };
}

/** Upsert a dashcam_events row for a media event; returns its id. */
async function upsertEvent(db: DB, m: MappingRow, event: CpgMediaEvent): Promise<number | null> {
  const ts = event.eventTimestamp;
  try {
    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM dashcam_events WHERE cpg_device_id = ? AND cpg_media_timestamp = ? LIMIT 1',
      m.cpg_device_id, ts,
    );
    if (existing) return existing.id;
    const first = event.mediaObject?.[0];
    const lat = first?.location?.lat ?? first?.gps?.[0]?.latitude ?? null;
    const lng = first?.location?.lng ?? first?.gps?.[0]?.longitude ?? null;
    const r = await execute(db, `
      INSERT INTO dashcam_events
        (cpg_device_id, unit_id, event_type, event_timestamp, cpg_media_timestamp,
         latitude, longitude, speed_mph, address, video_available, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'clearpathgps')
    `,
      m.cpg_device_id, m.unit_id, first?.eventType || 'Camera Event', formatTs(ts), ts,
      lat, lng, kmhToMph(first?.gps?.[0]?.speed), event.address || null,
    );
    return Number(r.meta.last_row_id);
  } catch { return null; }
}

// ── Per-device sync ──────────────────────────────────────────

async function syncDevice(
  env: Bindings, db: DB, client: CpgClient, m: MappingRow, cameraId: number, budget: { left: number },
): Promise<number> {
  const now = Date.now();
  let fromMs = m.last_media_synced_at ? Date.parse(m.last_media_synced_at) : now - LOOKBACK_FIRST_SYNC_MS;
  const cap = now - 30 * 24 * 60 * 60 * 1000; // ClearPath retains ~30 days
  if (!Number.isFinite(fromMs) || fromMs < cap) fromMs = cap;

  // `cameraId` here is the GPS-Insight assetId (the media API key).
  const events = await listAllMedia(env, client, cameraId, fromMs, now);
  let synced = 0;
  for (const event of events) {
    const eventRowId = await upsertEvent(db, m, event);
    for (const mo of pickVideoObjects(event)) {
      if (budget.left <= 0) break;
      const channel = channelOf(mo);
      const dup = await queryFirst<{ id: number }>(
        db, 'SELECT id FROM dashcam_videos WHERE cpg_device_id = ? AND cpg_media_timestamp = ? AND cpg_channel = ? LIMIT 1',
        m.cpg_device_id, event.eventTimestamp, channel,
      );
      if (dup) continue;
      try {
        const stored = await storeClip(env, db, m, cameraId, event, mo);
        if (!stored) continue;
        synced++; budget.left--;
        if (eventRowId) {
          await execute(db, 'UPDATE dashcam_videos SET linked_dashcam_event_id = ? WHERE id = ?', eventRowId, stored.videoId);
          await execute(db, 'UPDATE dashcam_events SET video_available = 1 WHERE id = ?', eventRowId);
        }
        // Phase C: ALPR the outside-channel clip (best-effort, off the loop).
        if (isOutsideChannel(stored.channel)) {
          try {
            const { alprDashcamClip } = await import('./clearpathAlpr');
            await alprDashcamClip(env, db, { videoId: stored.videoId, r2Key: stored.r2Key, mapping: m, event });
          } catch (err) { console.error('[cpg-alpr] clip failed:', (err as Error)?.message); }
        }
      } catch (err) {
        if (err instanceof CpgRateLimitError) throw err;
        console.error(`[cpg-media] download failed ${m.cpg_device_id}/${event.eventTimestamp}/${channel}:`, (err as Error)?.message);
      }
    }
    if (budget.left <= 0) break;
  }
  try { await execute(db, 'UPDATE cpg_device_mappings SET last_media_synced_at = ? WHERE id = ?', formatTs(now), m.id); } catch { /* non-fatal */ }
  return synced;
}

// ── Orchestrator ─────────────────────────────────────────────

export async function syncClearpathMedia(env: Bindings): Promise<{ synced: number; errors: number; skipped?: string }> {
  const db = getDb(env);
  const client = await getApiConfig(db, env).catch(() => null);
  if (!client) return { synced: 0, errors: 0, skipped: 'not_configured' };
  if (!(await isEnabled(db))) return { synced: 0, errors: 0, skipped: 'disabled' };
  if ((await getConfigValue(db, CPG_KEYS.mediaEnabled)) !== 'true') return { synced: 0, errors: 0, skipped: 'media_disabled' };
  await ensureMediaSchema(db);

  // KV rate-limit cooldown.
  try {
    const until = await env.KV.get(COOLDOWN_KV_KEY);
    if (until && Date.now() < parseInt(until, 10)) return { synced: 0, errors: 0, skipped: 'cooldown' };
  } catch { /* KV optional */ }

  const mappings = await query<MappingRow>(db, `
    SELECT id, cpg_device_id, cpg_display_name, unit_id, cpg_camera_id, last_media_synced_at
    FROM cpg_device_mappings WHERE is_active = 1
  `).catch(() => [] as MappingRow[]);
  if (!mappings.length) return { synced: 0, errors: 0, skipped: 'no_mappings' };

  let cameras: CpgCamera[] | null = null;
  if (mappings.some((m) => !m.cpg_camera_id)) {
    try { cameras = await listCameras(env, client); } catch (err) { console.warn('[cpg-media] camera list failed:', (err as Error)?.message); }
  }

  const budget = { left: MAX_CLIPS_PER_RUN };
  let synced = 0, errors = 0;
  for (const m of mappings) {
    if (budget.left <= 0) break;
    try {
      const cameraId = await resolveCameraId(db, m, cameras);
      if (!cameraId) continue;
      synced += await syncDevice(env, db, client, m, cameraId, budget);
    } catch (err) {
      if (err instanceof CpgRateLimitError) {
        try { await env.KV.put(COOLDOWN_KV_KEY, String(Date.now() + err.retryAfterSeconds * 1000), { expirationTtl: Math.max(60, err.retryAfterSeconds) }); } catch { /* */ }
        break;
      }
      errors++;
      console.error(`[cpg-media] device ${m.cpg_device_id} error:`, (err as Error)?.message);
    }
  }
  try { await setConfigValue(db, 'clearpathgps_last_media_sync', new Date().toISOString()); } catch { /* */ }
  return { synced, errors };
}

/** Per-minute cron entry: throttle on clearpathgps_last_media_sync vs interval. */
export async function maybeRunClearpathMediaSync(env: Bindings): Promise<void> {
  const db = getDb(env);
  const enabled = await getConfigValue(db, CPG_KEYS.mediaEnabled).catch(() => null);
  if (enabled !== 'true') return;
  const interval = parseInt((await getConfigValue(db, CPG_KEYS.mediaPollInterval)) || '300', 10);
  const last = await getConfigValue(db, 'clearpathgps_last_media_sync');
  if (last) {
    const t = Date.parse(last);
    if (Number.isFinite(t) && Date.now() - t < interval * 1000) return;
  }
  const r = await syncClearpathMedia(env);
  if (r.synced || r.errors) console.log(`[cpg-media] synced=${r.synced} errors=${r.errors}`);
}
