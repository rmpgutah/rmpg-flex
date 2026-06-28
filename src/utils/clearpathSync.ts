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

import { log } from './logger';
import type { Bindings } from '../types';
import { getDb, query, queryFirst, execute, columnExists } from './db';
import {
  getApiConfig, isEnabled, getConfigValue, setConfigValue, CPG_KEYS,
  listCameras, listAllMedia, listDevices, vehicleToCamera,
  CpgRateLimitError,
  type CpgClient, type CpgCamera, type CpgMediaEvent, type CpgMediaObject,
} from './clearpathGps';

type DB = D1Database;

const R2_PREFIX = 'dashcam/';
const COOLDOWN_KV_KEY = 'cpg:media:cooldown_until';
// Each clip = a multi-MB mp4 stream→R2 + an ALPR inference. Keep the per-run
// budget small so a single Worker invocation finishes within its subrequest/CPU
// limits and COMMITS what it pulled (clips persist incrementally); the cron then
// keeps chipping through the backlog every minute.
const MAX_CLIPS_PER_RUN = 6;
// Only fetch enough media pages to fill the per-run budget (50 events/page) —
// don't page the whole backlog (hundreds of events) up front each run.
const MEDIA_PAGES_PER_RUN = 2;
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

/** Decide whether the camera is currently offline (sleeping with the vehicle).
 *  ClearPath's on-demand pipeline accepts the POST instantly but the dashcam
 *  can only upload the mp4 when the LTE modem is awake — which requires the
 *  vehicle's ignition to be on. While the vehicle is parked, every requested
 *  clip sits in "Waiting for Camera…" on ClearPath's side, our poll returns
 *  zero candidates, and chunks burn through their poll-attempt budget and die
 *  as 'missing'. The fix: when the camera is offline, the poller skips the
 *  attempt-counter increment so requests survive the parking window and
 *  fulfill the next time the vehicle drives.
 *
 *  Heuristic (pure, given a mapping row + current epoch ms):
 *    • ignition_state='on'  → online (camera always uploads while driving).
 *    • ignition_state='off' AND last_synced_at older than `staleMinutes`
 *      → offline (GPS module also gone to sleep with the vehicle).
 *    • Anything else (unknown ignition, recent GPS) → online by default so a
 *      sensor blip can't suspend a healthy queue.
 *  staleMinutes defaults to 15 — ClearPath GPS modules stay awake for a few
 *  minutes after ignition off, so a fresher GPS sync means the camera might
 *  still be reachable. */
export function isCameraOfflineFromMapping(
  m: { ignition_state: string | null; last_synced_at: string | null },
  nowMs: number,
  staleMinutes = 15,
): boolean {
  const ignition = (m.ignition_state || '').toLowerCase();
  if (ignition === 'on') return false;
  if (ignition !== 'off') return false; // unknown — don't suspend
  if (!m.last_synced_at) return true;
  const lastMs = Date.parse(
    m.last_synced_at.includes('T') ? m.last_synced_at : m.last_synced_at.replace(' ', 'T') + 'Z',
  );
  if (!Number.isFinite(lastMs)) return true;
  return nowMs - lastMs > staleMinutes * 60_000;
}

/** Bulk lookup: which of the given cpg_device_ids have an offline camera right
 *  now? Returns a Set of device ids currently considered offline (matching
 *  isCameraOfflineFromMapping). Unmapped devices are treated as ONLINE
 *  (returning early-abandon behaviour) so an upstream bug can't suspend the
 *  whole queue. Single round-trip per poll batch.  */
export async function getOfflineCameraDeviceIds(
  db: D1Database, deviceIds: string[], nowMs = Date.now(),
): Promise<Set<string>> {
  const offline = new Set<string>();
  const ids = Array.from(new Set(deviceIds.filter(Boolean)));
  if (!ids.length) return offline;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await query<{ cpg_device_id: string; ignition_state: string | null; last_synced_at: string | null }>(
    db,
    `SELECT cpg_device_id, ignition_state, last_synced_at
       FROM cpg_device_mappings
      WHERE is_active = 1 AND cpg_device_id IN (${placeholders})`,
    ...ids,
  ).catch(() => [] as Array<{ cpg_device_id: string; ignition_state: string | null; last_synced_at: string | null }>);
  for (const r of rows) {
    if (isCameraOfflineFromMapping(r, nowMs)) offline.add(r.cpg_device_id);
  }
  return offline;
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

async function resolveCameraId(
  db: DB, m: MappingRow, cameras: CpgCamera[] | null,
  env?: Bindings, client?: CpgClient,
): Promise<number | null> {
  if (m.cpg_camera_id) return m.cpg_camera_id;
  // Try the mediaEnabled-filtered cameras list first.
  if (cameras?.length) {
    const name = (m.cpg_display_name || '').toLowerCase();
    const byName = name ? cameras.find((c) => c.name.toLowerCase() === name) : undefined;
    const byProvider = cameras.find((c) => c.providerId === m.cpg_device_id);
    const cam = byName || byProvider;
    if (cam) {
      try { await execute(db, 'UPDATE cpg_device_mappings SET cpg_camera_id = ? WHERE id = ?', cam.id, m.id); } catch { /* non-fatal */ }
      return cam.id;
    }
  }
  // Fallback: list ALL devices — some accounts don't report mediaEnabled:true but do
  // have an assetId. If the device is in the fleet list and has an assetId, use that.
  if (env && client) {
    try {
      const allDevices = await listDevices(env, client);
      const device = allDevices.find((d) =>
        d.deviceId === m.cpg_device_id ||
        (m.cpg_display_name && d.displayName?.toLowerCase() === m.cpg_display_name.toLowerCase()),
      );
      const cam = device ? vehicleToCamera(device) : null;
      if (cam) {
        try { await execute(db, 'UPDATE cpg_device_mappings SET cpg_camera_id = ? WHERE id = ?', cam.id, m.id); } catch { /* non-fatal */ }
        return cam.id;
      }
    } catch { /* non-fatal */ }
  }
  return null;
}

// ── Download one clip → R2 → dashcam_videos ──────────────────

async function storeClip(
  env: Bindings, db: DB, m: MappingRow, cameraId: number,
  event: CpgMediaEvent, mo: CpgMediaObject,
): Promise<{ videoId: number; channel: string; r2Key: string } | null> {
  const timestamp = event.eventTimestamp;
  const channel = channelOf(mo);
  const r2Key = r2KeyFor(m.cpg_device_id, timestamp, channel);

  // Stream the pre-signed S3 body straight into R2 (no buffering). Cap the
  // download at 90s so a slow/large clip can't hang the whole run.
  const resp = await fetch(mo.accessUrl, { signal: AbortSignal.timeout(90_000) });
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
  env: Bindings, db: DB, client: CpgClient, m: MappingRow, cameraId: number,
  budget: { left: number; errors: string[] },
  range?: { fromMs: number; toMs: number },
): Promise<number> {
  const now = Date.now();
  let fromMs: number;
  let toMs: number;
  let maxPages: number;

  if (range) {
    // Explicit time window — full paging, don't update last_media_synced_at.
    fromMs = range.fromMs;
    toMs = range.toMs;
    maxPages = 20;
  } else {
    // Incremental sync: pick up from the last successful sync.
    fromMs = m.last_media_synced_at ? Date.parse(m.last_media_synced_at) : now - LOOKBACK_FIRST_SYNC_MS;
    const cap = now - 30 * 24 * 60 * 60 * 1000; // ClearPath retains ~30 days
    if (!Number.isFinite(fromMs) || fromMs < cap) fromMs = cap;
    toMs = now;
    // Only pull a couple of pages — enough to fill the per-run clip budget.
    maxPages = MEDIA_PAGES_PER_RUN;
  }

  const events = await listAllMedia(env, client, cameraId, fromMs, toMs, maxPages);
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
          } catch (err) { log.error('clip failed', {}, err); }
        }
      } catch (err) {
        if (err instanceof CpgRateLimitError) throw err;
        const msg = (err as Error)?.message || 'unknown';
        if (budget.errors.length < 3) budget.errors.push(`${m.cpg_device_id}@${event.eventTimestamp}/${channel}: ${msg}`);
        log.error('download failed', { device: m.cpg_device_id, eventTimestamp: event.eventTimestamp, channel, msg });
      }
    }
    if (budget.left <= 0) break;
  }
  // Only advance the watermark for incremental syncs — range requests shouldn't
  // move the pointer and cause the next incremental sync to skip old events.
  if (!range) {
    try { await execute(db, 'UPDATE cpg_device_mappings SET last_media_synced_at = ? WHERE id = ?', formatTs(now), m.id); } catch { /* non-fatal */ }
  }
  return synced;
}

// ── Orchestrator ─────────────────────────────────────────────

export async function syncClearpathMedia(env: Bindings): Promise<{ synced: number; errors: number; skipped?: string; clip_errors?: string[] }> {
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
    try { cameras = await listCameras(env, client); } catch (err) { log.warn('camera list failed', { err }); }
  }

  const budget = { left: MAX_CLIPS_PER_RUN, errors: [] as string[] };
  let synced = 0, errors = 0;
  for (const m of mappings) {
    if (budget.left <= 0) break;
    try {
      const cameraId = await resolveCameraId(db, m, cameras, env, client);
      if (!cameraId) continue;
      synced += await syncDevice(env, db, client, m, cameraId, budget);
    } catch (err) {
      if (err instanceof CpgRateLimitError) {
        try { await env.KV.put(COOLDOWN_KV_KEY, String(Date.now() + err.retryAfterSeconds * 1000), { expirationTtl: Math.max(60, err.retryAfterSeconds) }); } catch { /* */ }
        break;
      }
      errors++;
      log.error('device error', { device: m.cpg_device_id }, err);
    }
  }
  try { await setConfigValue(db, 'clearpathgps_last_media_sync', new Date().toISOString()); } catch { /* */ }
  return { synced, errors, ...(budget.errors.length ? { clip_errors: budget.errors } : {}) };
}

// ── Full-drive range sync ─────────────────────────────────────
// Downloads ALL event clips for a specific time window (no per-run budget cap).
// Used by POST /clearpathgps/full-drive — fires via waitUntil so it doesn't
// block the HTTP response. Clips are deduplicated by device/timestamp/channel.

export async function syncClearpathMediaRange(
  env: Bindings,
  opts: { deviceId?: string; fromMs: number; toMs: number; maxClips?: number },
): Promise<{ synced: number; errors: number; skipped?: string }> {
  const db = getDb(env);
  const client = await getApiConfig(db, env).catch(() => null);
  if (!client) return { synced: 0, errors: 0, skipped: 'not_configured' };
  if (!(await isEnabled(db))) return { synced: 0, errors: 0, skipped: 'disabled' };
  await ensureMediaSchema(db);

  const mappings = await (opts.deviceId
    ? query<MappingRow>(db,
        'SELECT id, cpg_device_id, cpg_display_name, unit_id, cpg_camera_id, last_media_synced_at FROM cpg_device_mappings WHERE is_active = 1 AND cpg_device_id = ?',
        opts.deviceId)
    : query<MappingRow>(db,
        'SELECT id, cpg_device_id, cpg_display_name, unit_id, cpg_camera_id, last_media_synced_at FROM cpg_device_mappings WHERE is_active = 1')
  ).catch(() => [] as MappingRow[]);
  if (!mappings.length) return { synced: 0, errors: 0, skipped: 'no_mappings' };

  let cameras: CpgCamera[] | null = null;
  if (mappings.some((m) => !m.cpg_camera_id)) {
    try { cameras = await listCameras(env, client); } catch { /* non-fatal */ }
  }

  const budget = { left: opts.maxClips ?? 200, errors: [] as string[] };
  let synced = 0, errors = 0;
  for (const m of mappings) {
    if (budget.left <= 0) break;
    try {
      const cameraId = await resolveCameraId(db, m, cameras, env, client);
      if (!cameraId) { log.warn('no camera ID', { device: m.cpg_device_id }); continue; }
      synced += await syncDevice(env, db, client, m, cameraId, budget, { fromMs: opts.fromMs, toMs: opts.toMs });
    } catch (err) {
      if (err instanceof CpgRateLimitError) {
        try { await env.KV.put(COOLDOWN_KV_KEY, String(Date.now() + err.retryAfterSeconds * 1000), { expirationTtl: Math.max(60, err.retryAfterSeconds) }); } catch { /* */ }
        break;
      }
      errors++;
      log.error('device error', { device: m.cpg_device_id }, err);
    }
  }
  return { synced, errors };
}

// ── Lightweight still-only ALPR scan (powers the capture gallery) ─────
// Downloading full mp4 clips is heavy + slow for a Worker. The capture gallery
// only needs the small still IMAGE per event, so this scan skips video storage
// entirely: per media event it persists the still to R2 + runs ALPR + writes an
// alpr_captures row (with/without a plate). Bounded + idempotent (dedupes on the
// cpg_dashcam:<device>:<ts> capture_id). Runs far faster than the clip sync.
const MAX_ALPR_STILLS_PER_RUN = 12;       // coverage: stills processed per scan tick

export async function scanClearpathMediaAlpr(env: Bindings): Promise<{ scanned: number; captured: number; skipped?: string }> {
  const db = getDb(env);
  const client = await getApiConfig(db, env).catch(() => null);
  if (!client) return { scanned: 0, captured: 0, skipped: 'not_configured' };
  if (!(await isEnabled(db))) return { scanned: 0, captured: 0, skipped: 'disabled' };
  await ensureMediaSchema(db);

  const mappings = await query<MappingRow>(db, `
    SELECT id, cpg_device_id, cpg_display_name, unit_id, cpg_camera_id, last_media_synced_at
    FROM cpg_device_mappings WHERE is_active = 1`).catch(() => [] as MappingRow[]);
  if (!mappings.length) return { scanned: 0, captured: 0, skipped: 'no_mappings' };

  let cameras: CpgCamera[] | null = null;
  if (mappings.some((m) => !m.cpg_camera_id)) {
    try { cameras = await listCameras(env, client); } catch { /* */ }
  }

  const { alprDashcamClip, pickAlprImageUrl } = await import('./clearpathAlpr');
  const now = Date.now();
  const from = now - LOOKBACK_FIRST_SYNC_MS;
  let scanned = 0, captured = 0;
  for (const m of mappings) {
    if (captured >= MAX_ALPR_STILLS_PER_RUN) break;
    const cameraId = await resolveCameraId(db, m, cameras);
    if (!cameraId) continue;
    let events: CpgMediaEvent[];
    try { events = await listAllMedia(env, client, cameraId, from, now, 2); } catch { continue; }
    for (const event of events) {
      if (captured >= MAX_ALPR_STILLS_PER_RUN) break;
      if (!pickAlprImageUrl(event)) continue; // only outside stills become captures
      const captureId = `cpg_dashcam:${m.cpg_device_id}:${event.eventTimestamp}`;
      const exists = await queryFirst<{ id: number }>(db, 'SELECT id FROM alpr_captures WHERE capture_id = ? LIMIT 1', captureId).catch(() => null);
      if (exists) continue;
      scanned++;
      try { await alprDashcamClip(env, db, { mapping: m, event }); captured++; }
      catch (err) { log.error('alpr scan failed', {}, err); }
    }
  }
  try { await setConfigValue(db, 'clearpathgps_last_alpr_scan', new Date().toISOString()); } catch { /* */ }
  return { scanned, captured };
}

/** Per-minute cron entry. Runs the lightweight ALPR still-scan (powers the
 *  capture gallery — fast, reliable) every interval, then a bounded heavy clip
 *  sync (video evidence) — both throttled + independently fault-isolated so a
 *  slow clip download can't starve the gallery scan. */
export async function maybeRunClearpathMediaSync(env: Bindings): Promise<void> {
  const db = getDb(env);
  const enabled = await getConfigValue(db, CPG_KEYS.mediaEnabled).catch(() => null);
  if (enabled !== 'true') return;
  const interval = parseInt((await getConfigValue(db, CPG_KEYS.mediaPollInterval)) || '300', 10);

  // 1) Light ALPR still-scan — the gallery's source of truth.
  const lastScan = await getConfigValue(db, 'clearpathgps_last_alpr_scan');
  const scanDue = !lastScan || !Number.isFinite(Date.parse(lastScan)) || (Date.now() - Date.parse(lastScan) >= interval * 1000);
  if (scanDue) {
    try { const s = await scanClearpathMediaAlpr(env); if (s.scanned || s.captured) log.info('alpr scan complete', { scanned: s.scanned, captured: s.captured }); }
    catch (err) { log.error('alpr scan failed', {}, err); }
  }

  // 2) Full clip sync — runs on the same cadence as the ALPR scan.
  //    Enabling media sync (the toggle) is the opt-in; no extra config key needed.
  const lastClip = await getConfigValue(db, 'clearpathgps_last_media_sync');
  const clipDue = !lastClip || !Number.isFinite(Date.parse(lastClip)) || (Date.now() - Date.parse(lastClip) >= interval * 1000);
  if (!clipDue) return;
  try { const r = await syncClearpathMedia(env); if (r.synced || r.errors) log.info('media sync complete', { synced: r.synced, errors: r.errors }); }
  catch (err) { log.error('clip sync failed', {}, err); }
}
