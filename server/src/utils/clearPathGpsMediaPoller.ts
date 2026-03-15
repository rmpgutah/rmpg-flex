// ============================================================
// ClearPathGPS Media Poller
// ============================================================
// Background service that polls the ClearPathGPS v2.0 Media API
// to discover and download dashcam video clips automatically.
// Follows the same start/stop/restart pattern as clearPathGpsPoller.ts.
//
// Camera ID resolution:
//   v1.0 devices use string IDs like "cp160817"
//   v2.0 media API uses numeric camera IDs like 140702
//   We resolve by matching display names, then cache in cpg_device_mappings.cpg_camera_id

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { getDb } from '../models/database';
import { broadcast } from './websocket';
import { localNow } from './timeUtils';
import {
  isConfigured,
  isEnabled,
  getConfigValue,
  CONFIG_KEYS,
} from './clearPathGpsClient';
import {
  listAllMedia,
  listCameras,
  downloadFromAccessUrl,
  RateLimitError,
  type CpgMediaEvent,
  type CpgMediaObject,
  type CpgCamera,
} from './clearPathGpsMediaClient';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config keys ──────────────────────────────────────────────

const MEDIA_CONFIG = {
  enabled: 'clearpathgps_media_sync_enabled',
  pollInterval: 'clearpathgps_media_poll_interval',
} as const;

// ── Upload directory ─────────────────────────────────────────

const DASHCAM_DIR = process.env.RMPG_UPLOADS_DIR
  ? path.join(process.env.RMPG_UPLOADS_DIR, 'dashcam')
  : path.resolve(__dirname, '../../uploads/dashcam');

// Camera channel → subdirectory mapping
// "outside" = front-facing road camera → front/
// "inside"  = interior/prisoner camera  → outer/
function channelSubdir(channel: string): string {
  const ch = channel.toLowerCase();
  if (ch === 'inside' || ch === 'interior' || ch === 'cabin') return 'outer';
  return 'front'; // "outside", "exterior", or any other value → front
}

// ── Interval handle ──────────────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let rateLimitCooldownUntil = 0;

// ── Public lifecycle ─────────────────────────────────────────

export function startClearPathGpsMediaPoller(intervalMs?: number): void {
  if (intervalHandle) return; // Already running

  const pollMs = intervalMs ?? getMediaPollIntervalMs();
  console.log(`[ClearPathGPS Media] Starting poller — every ${pollMs / 1000}s`);

  intervalHandle = setInterval(() => {
    syncMediaClips().catch(err => {
      console.error('[ClearPathGPS Media] Poll error:', err.message || err);
    });
  }, pollMs);

  // Delay first run to let server finish startup
  setTimeout(() => {
    syncMediaClips().catch(err => {
      console.error('[ClearPathGPS Media] Initial sync error:', err.message || err);
    });
  }, 30_000); // 30s delay — let GPS poller go first
}

export function stopClearPathGpsMediaPoller(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[ClearPathGPS Media] Poller stopped');
  }
}

export function restartClearPathGpsMediaPoller(): void {
  stopClearPathGpsMediaPoller();
  startClearPathGpsMediaPoller();
}

/** Run a single sync cycle immediately (for admin "Sync Now" button). */
export async function triggerMediaSync(): Promise<{ synced: number; errors: number }> {
  return syncMediaClips();
}

// ── Internal helpers ─────────────────────────────────────────

function getMediaPollIntervalMs(): number {
  const val = getConfigValue(MEDIA_CONFIG.pollInterval);
  const seconds = val ? parseInt(val, 10) : 300; // Default: 5 min (300s)
  return Math.max(60, Math.min(seconds, 900)) * 1000; // 1 min – 15 min range
}

function isMediaSyncEnabled(): boolean {
  return getConfigValue(MEDIA_CONFIG.enabled) === 'true';
}

function formatTs(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('T', ' ').replace('Z', '');
}

/** Check available disk space. Returns bytes free. */
function getFreeDiskSpace(): number {
  try {
    const stats = fs.statfsSync(DASHCAM_DIR);
    return stats.bfree * stats.bsize;
  } catch {
    return Infinity; // Can't check — assume enough space
  }
}

const MIN_FREE_SPACE = 1024 * 1024 * 1024; // 1 GB
const INTER_DEVICE_DELAY_MS = 2000; // 2s between devices
const MAX_CONSECUTIVE_ERRORS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Camera ID resolution ─────────────────────────────────────

/** Resolve numeric v2.0 camera ID for a device mapping.
 *  Checks cached cpg_camera_id first, then queries v2.0 camera list. */
async function resolveCameraId(
  db: ReturnType<typeof getDb>,
  mapping: { id: number; cpg_device_id: string; cpg_display_name: string | null; cpg_camera_id: number | null },
  cameras: CpgCamera[] | null,
): Promise<number | null> {
  // Use cached camera ID if available
  if (mapping.cpg_camera_id) return mapping.cpg_camera_id;

  // Need to resolve — fetch camera list if not already fetched
  if (!cameras || cameras.length === 0) return null;

  // Match by display name (e.g. "S19" in both systems)
  const displayName = mapping.cpg_display_name;
  if (!displayName) return null;

  const camera = cameras.find(
    c => c.name.toLowerCase() === displayName.toLowerCase(),
  );

  if (!camera) {
    console.warn(
      `[ClearPathGPS Media] No camera match for device "${mapping.cpg_device_id}" (display: "${displayName}")`,
    );
    return null;
  }

  // Cache the camera ID for future syncs
  db.prepare(
    'UPDATE cpg_device_mappings SET cpg_camera_id = ? WHERE id = ?',
  ).run(camera.id, mapping.id);

  console.log(
    `[ClearPathGPS Media] Resolved camera ID ${camera.id} for device "${displayName}" (${mapping.cpg_device_id})`,
  );

  return camera.id;
}

// ── Main sync logic ──────────────────────────────────────────

async function syncMediaClips(): Promise<{ synced: number; errors: number }> {
  // Guard checks
  if (!isConfigured() || !isEnabled() || !isMediaSyncEnabled()) {
    return { synced: 0, errors: 0 };
  }

  // Respect rate-limit cooldown
  if (Date.now() < rateLimitCooldownUntil) {
    const remaining = Math.ceil((rateLimitCooldownUntil - Date.now()) / 1000);
    console.log(`[ClearPathGPS Media] Rate-limit cooldown — ${remaining}s remaining`);
    return { synced: 0, errors: 0 };
  }

  // Ensure upload directories exist (front/ and outer/ subdirs)
  for (const sub of ['front', 'outer']) {
    const dir = path.join(DASHCAM_DIR, sub);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const db = getDb();
  let totalSynced = 0;
  let totalErrors = 0;

  // Load active device mappings
  const mappings = db.prepare(`
    SELECT m.id, m.cpg_device_id, m.cpg_display_name, m.unit_id,
           m.last_media_synced_at, m.media_sync_errors, m.cpg_camera_id
    FROM cpg_device_mappings m
    WHERE m.is_active = 1
  `).all() as Array<{
    id: number;
    cpg_device_id: string;
    cpg_display_name: string | null;
    unit_id: number;
    last_media_synced_at: string | null;
    media_sync_errors: number | null;
    cpg_camera_id: number | null;
  }>;

  if (mappings.length === 0) return { synced: 0, errors: 0 };

  // Fetch camera list once for camera ID resolution
  let cameras: CpgCamera[] | null = null;
  const needsResolution = mappings.some(m => !m.cpg_camera_id);
  if (needsResolution) {
    try {
      cameras = await listCameras();
      console.log(`[ClearPathGPS Media] Fetched ${cameras.length} camera(s) for ID resolution`);
    } catch (err: any) {
      if (err instanceof RateLimitError) throw err;
      console.warn('[ClearPathGPS Media] Could not fetch camera list:', err.message);
    }
  }

  for (const mapping of mappings) {
    // Skip devices with too many consecutive errors — but auto-reset after 1 hour
    // so transient auth failures don't permanently lock out a device
    const errorCount = mapping.media_sync_errors || 0;
    if (errorCount >= MAX_CONSECUTIVE_ERRORS) {
      const lastSync = mapping.last_media_synced_at;
      const hourAgo = Date.now() - 60 * 60 * 1000;
      const lastSyncTime = lastSync ? new Date(lastSync).getTime() : 0;
      if (lastSyncTime > hourAgo) {
        continue; // Still within cooldown window
      }
      // Auto-reset error counter after 1 hour cooldown
      console.log(`[ClearPathGPS Media] Resetting error counter for ${mapping.cpg_device_id} after 1h cooldown`);
      db.prepare('UPDATE cpg_device_mappings SET media_sync_errors = 0 WHERE id = ?').run(mapping.id);
    }

    try {
      // Resolve camera ID (v2.0 uses numeric IDs, not v1.0 string device IDs)
      const cameraId = await resolveCameraId(db, mapping, cameras);
      if (!cameraId) {
        console.warn(
          `[ClearPathGPS Media] Skipping device ${mapping.cpg_device_id} — no camera ID`,
        );
        continue;
      }

      const deviceSynced = await syncDeviceMedia(db, mapping, cameraId);
      totalSynced += deviceSynced;

      // Reset error counter on success
      if (errorCount > 0) {
        db.prepare(
          'UPDATE cpg_device_mappings SET media_sync_errors = 0 WHERE id = ?'
        ).run(mapping.id);
      }
    } catch (err: any) {
      if (err instanceof RateLimitError) {
        rateLimitCooldownUntil = Date.now() + (err.retryAfterSeconds * 1000);
        console.warn(
          `[ClearPathGPS Media] Rate limited — cooling down for ${err.retryAfterSeconds}s`
        );
        break; // Stop processing remaining devices
      }

      totalErrors++;
      // Log detailed error info for debugging (especially 401 auth failures)
      const errDetail = err?.status === 401
        ? `401 Unauthorized — body: ${err.body || '(empty)'}, url: ${err.url || '?'}`
        : (err.message || JSON.stringify(err));
      console.error(`[ClearPathGPS Media] Device ${mapping.cpg_device_id} error: ${errDetail}`);

      // Increment error counter
      db.prepare(
        'UPDATE cpg_device_mappings SET media_sync_errors = COALESCE(media_sync_errors, 0) + 1 WHERE id = ?'
      ).run(mapping.id);
    }

    // Gentle delay between devices
    if (mappings.indexOf(mapping) < mappings.length - 1) {
      await sleep(INTER_DEVICE_DELAY_MS);
    }
  }

  if (totalSynced > 0 || totalErrors > 0) {
    console.log(
      `[ClearPathGPS Media] Synced ${totalSynced} new clip(s) across ${mappings.length} device(s)` +
      (totalErrors > 0 ? ` (${totalErrors} error(s))` : ''),
    );
  }

  return { synced: totalSynced, errors: totalErrors };
}

/** Sync media for a single device. Returns number of clips downloaded. */
async function syncDeviceMedia(
  db: ReturnType<typeof getDb>,
  mapping: {
    id: number;
    cpg_device_id: string;
    cpg_display_name: string | null;
    unit_id: number;
    last_media_synced_at: string | null;
  },
  cameraId: number,
): Promise<number> {
  const now = Date.now();

  // Determine time window
  let fromMs: number;
  if (mapping.last_media_synced_at) {
    fromMs = new Date(mapping.last_media_synced_at).getTime();
    // Cap to 30 days back (ClearPath retains ~30 days of footage)
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    if (fromMs < thirtyDaysAgo) fromMs = thirtyDaysAgo;
  } else {
    // First sync — look back 30 days to capture all available history
    fromMs = now - 30 * 24 * 60 * 60 * 1000;
  }

  // Fetch all media events from ClearPathGPS v2.0
  const mediaEvents = await listAllMedia(cameraId, fromMs, now);

  if (mediaEvents.length === 0) {
    // Update sync timestamp even when no new media
    db.prepare(
      'UPDATE cpg_device_mappings SET last_media_synced_at = ? WHERE id = ?'
    ).run(localNow(), mapping.id);
    return 0;
  }

  // Collect all video objects, prioritizing expiring-soon items
  const videoItems: Array<{
    event: CpgMediaEvent;
    media: CpgMediaObject;
    expiringSoon: boolean;
  }> = [];

  for (const event of mediaEvents) {
    if (!event.mediaObject?.length) continue;
    for (const mo of event.mediaObject) {
      if (mo.type !== 'VIDEO') continue;        // v2.0 uses uppercase
      if (mo.status !== 'AVAILABLE') continue;   // Only download ready clips
      if (!mo.accessUrl) continue;               // Need a download URL
      videoItems.push({
        event,
        media: mo,
        expiringSoon: mo.expiringSoon || event.expiringSoon,
      });
    }
  }

  // Sort: expiring-soon first
  videoItems.sort((a, b) => (b.expiringSoon ? 1 : 0) - (a.expiringSoon ? 1 : 0));

  let synced = 0;

  for (const item of videoItems) {
    const { event, media } = item;
    const timestamp = event.eventTimestamp;       // v2.0 event-level timestamp
    const channel = (media.channel || 'outside').toLowerCase();

    // Dedup check
    const existing = db.prepare(`
      SELECT id, speed_mph, cpg_gps_track FROM dashcam_videos
      WHERE cpg_device_id = ? AND cpg_media_timestamp = ? AND cpg_channel = ?
    `).get(mapping.cpg_device_id, timestamp, channel) as any;

    if (existing) {
      // Backfill speed + GPS track for clips synced before these features existed
      const updates: string[] = [];
      const updateParams: any[] = [];

      if (existing.speed_mph == null && media.gps?.length) {
        const rawSpeed = media.gps[0].speed;
        if (rawSpeed != null && rawSpeed >= 0) {
          updates.push('speed_mph = ?');
          updateParams.push(Math.round(rawSpeed * 0.621371));
        }
      }

      if (!existing.cpg_gps_track && media.gps?.length) {
        updates.push('cpg_gps_track = ?');
        updateParams.push(JSON.stringify(media.gps));
      }

      if (updates.length > 0) {
        updateParams.push(existing.id);
        db.prepare(`UPDATE dashcam_videos SET ${updates.join(', ')} WHERE id = ?`)
          .run(...updateParams);
      }

      continue; // Already downloaded
    }

    // Check disk space
    if (getFreeDiskSpace() < MIN_FREE_SPACE) {
      console.warn('[ClearPathGPS Media] Low disk space — skipping downloads');
      broadcast('alerts', 'alert', {
        type: 'disk_space_warning',
        message: 'Dashcam media sync paused — low disk space (< 1 GB free)',
      });
      break;
    }

    // Download the clip from pre-signed S3 URL
    try {
      const videoId = await downloadAndStore(db, mapping, event, media, cameraId);
      if (videoId) synced++;
    } catch (err: any) {
      if (err instanceof RateLimitError) throw err; // Bubble up for global cooldown
      console.error(
        `[ClearPathGPS Media] Failed to download clip ${mapping.cpg_device_id}/${timestamp}/${channel}:`,
        err.message || err,
      );
    }
  }

  // Update sync timestamp
  db.prepare(
    'UPDATE cpg_device_mappings SET last_media_synced_at = ? WHERE id = ?'
  ).run(localNow(), mapping.id);

  return synced;
}

/** Download a single video clip from S3 and insert into dashcam_videos. */
async function downloadAndStore(
  db: ReturnType<typeof getDb>,
  mapping: { id: number; cpg_device_id: string; cpg_display_name: string | null; unit_id: number },
  event: CpgMediaEvent,
  media: CpgMediaObject,
  cameraId: number,
): Promise<number | null> {
  const timestamp = event.eventTimestamp;
  const channel = (media.channel || 'outside').toLowerCase();
  const subdir = channelSubdir(channel);            // "front" or "outer"
  const randHex = crypto.randomBytes(4).toString('hex');
  const filename = `cpg_${mapping.cpg_device_id}_${timestamp}_${channel}_${randHex}.mp4`;
  const relPath = path.join(subdir, filename);       // e.g. "front/cpg_cp160817_…mp4"
  const absDir = path.join(DASHCAM_DIR, subdir);
  const tmpPath = path.join(absDir, `${filename}.tmp`);
  const finalPath = path.join(absDir, filename);

  // Ensure camera subdir exists
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });

  try {
    // Download from pre-signed S3 URL (no API auth needed)
    const { stream, contentType, contentLength } = await downloadFromAccessUrl(
      media.accessUrl,
    );

    const writeStream = fs.createWriteStream(tmpPath);
    await pipeline(stream, writeStream);

    // Get actual file size
    const stats = fs.statSync(tmpPath);
    const fileSize = stats.size;

    // Rename .tmp → final (atomic)
    fs.renameSync(tmpPath, finalPath);

    // Determine location + speed from GPS data
    const lat = media.location?.lat ?? media.gps?.[0]?.latitude ?? null;
    const lng = media.location?.lng ?? media.gps?.[0]?.longitude ?? null;

    // Extract speed from GPS array (v2.0 provides timestamped GPS points with speed)
    // Speed in GPS data is typically in km/h — convert to mph
    let speedMph: number | null = null;
    if (media.gps?.length) {
      // Use the first GPS point's speed (event trigger moment)
      const rawSpeed = media.gps[0].speed;
      if (rawSpeed != null && rawSpeed >= 0) {
        speedMph = Math.round(rawSpeed * 0.621371); // km/h → mph
      }
    }

    // Store full GPS track for real-time playback overlay
    const gpsTrack = media.gps?.length ? JSON.stringify(media.gps) : null;

    // Resolve vehicle & unit info for metadata
    let vehicleId: number | null = null;
    let vehicleDesc = '';
    let unitCallSign = '';
    const fv = db.prepare(
      'SELECT id, year, make, model FROM fleet_vehicles WHERE assigned_unit_id = ?'
    ).get(mapping.unit_id) as any;
    if (fv) {
      vehicleId = fv.id;
      vehicleDesc = [fv.year, fv.make, fv.model].filter(Boolean).join(' ');
    }
    const unitRow = db.prepare('SELECT call_sign FROM units WHERE id = ?').get(mapping.unit_id) as any;
    if (unitRow) unitCallSign = unitRow.call_sign || '';

    // Build title from v2.0 fields
    const eventLabel = media.eventType || media.title || 'Camera Event';
    const channelLabel = subdir === 'front' ? 'Front' : 'Outer';
    const deviceName = mapping.cpg_display_name || mapping.cpg_device_id;
    const title = `${deviceName} — ${channelLabel} — ${eventLabel}`;

    const now = localNow();
    const recordedAtStr = formatTs(timestamp);

    // ── Write companion .txt metadata record ──
    const txtFilename = filename.replace(/\.mp4$/, '.txt');
    const txtPath = path.join(absDir, txtFilename);
    const recordDate = new Date(timestamp);
    const txtContent = [
      '═══════════════════════════════════════════════════════════',
      '  RMPG FLEX — MVR VIDEO METADATA RECORD',
      '═══════════════════════════════════════════════════════════',
      '',
      `  VIDEO FILE:     ${filename}`,
      `  CAMERA:         ${channelLabel} (${channel})`,
      `  DEVICE:         ${deviceName} (${mapping.cpg_device_id})`,
      `  CAMERA ID:      ${cameraId}`,
      '',
      `  UNIT:           ${unitCallSign || 'N/A'}`,
      `  VEHICLE:        ${vehicleDesc || 'N/A'}`,
      '',
      `  RECORDED:       ${recordDate.toLocaleDateString('en-US', { timeZone: 'America/Denver' })} ${recordDate.toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour12: false })} MT`,
      `  TIMESTAMP (UTC): ${recordedAtStr}`,
      `  EPOCH MS:       ${timestamp}`,
      '',
      `  EVENT TYPE:     ${eventLabel}`,
      `  CLASSIFICATION: routine`,
      `  SOURCE:         ClearPathGPS Auto-Sync`,
      '',
      `  SPEED:          ${speedMph != null ? speedMph + ' MPH' : 'N/A'}`,
      `  LATITUDE:       ${lat != null ? lat.toFixed(6) : 'N/A'}`,
      `  LONGITUDE:      ${lng != null ? lng.toFixed(6) : 'N/A'}`,
      `  ADDRESS:        ${event.address || 'N/A'}`,
      '',
      `  FILE SIZE:      ${(fileSize / (1024 * 1024)).toFixed(2)} MB`,
      `  FORMAT:         ${contentType || 'video/mp4'}`,
      '',
    ];

    // Append GPS track points if available
    if (media.gps?.length) {
      txtContent.push('─── GPS TRACK ────────────────────────────────────────────');
      txtContent.push(`  POINTS:         ${media.gps.length}`);
      txtContent.push('');
      txtContent.push('  TIMESTAMP (UTC)          LAT          LNG       SPD(mph)  ALT(m)');
      txtContent.push('  ──────────────────────── ──────────── ──────────── ──────── ──────');
      for (const pt of media.gps) {
        const ptTime = formatTs(pt.timestamp);
        const ptSpeed = pt.speed != null ? Math.round(pt.speed * 0.621371).toString() : '—';
        const ptAlt = pt.altitude != null ? pt.altitude.toFixed(0) : '—';
        txtContent.push(
          `  ${ptTime.padEnd(24)} ${pt.latitude.toFixed(6).padStart(12)} ${pt.longitude.toFixed(6).padStart(12)} ${ptSpeed.padStart(8)} ${ptAlt.padStart(6)}`
        );
      }
      txtContent.push('');
    }

    txtContent.push('═══════════════════════════════════════════════════════════');
    txtContent.push(`  Generated: ${now}`);
    txtContent.push('═══════════════════════════════════════════════════════════');
    txtContent.push('');

    try {
      fs.writeFileSync(txtPath, txtContent.join('\n'), 'utf-8');
    } catch (txtErr: any) {
      console.warn(`[ClearPathGPS Media] Failed to write .txt metadata: ${txtErr.message}`);
    }

    // Insert dashcam_videos record (file_path includes subdir)
    const result = db.prepare(`
      INSERT INTO dashcam_videos
        (vehicle_id, unit_id, title, file_path, file_size, mime_type,
         recorded_at, speed_mph, latitude, longitude, address,
         notes, source, uploaded_by, classification,
         cpg_device_id, cpg_media_timestamp, cpg_channel,
         cpg_event_type, cpg_access_url, cpg_thumbnail_url, cpg_gps_track,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'clearpathgps', 'media_sync', 'routine',
              ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      vehicleId,
      mapping.unit_id,
      title,
      relPath,  // e.g. "front/cpg_cp160817_…mp4" (includes subdir)
      fileSize,
      contentType || 'video/mp4',
      recordedAtStr,
      speedMph,
      lat,
      lng,
      event.address || null,
      `Auto-synced from ClearPathGPS. Event: ${eventLabel}. Camera: ${channelLabel}. Device: ${deviceName}. Camera ID: ${cameraId}.`,
      // CPG-specific fields
      mapping.cpg_device_id,
      timestamp,
      channel,
      media.eventType || '',
      media.accessUrl || null,
      media.thumbnailUrl || null,
      gpsTrack,
      now,
      now,
    );

    const videoId = Number(result.lastInsertRowid);

    // Try to link to an existing dashcam_event
    linkToEvent(db, mapping.cpg_device_id, timestamp, videoId);

    // Broadcast
    broadcast('fleet', 'dashcam_uploaded', {
      id: videoId,
      title,
      source: 'clearpathgps',
      channel: subdir,  // "front" or "outer"
    });

    return videoId;
  } catch (err) {
    // Clean up .tmp file on failure
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

/** Link a downloaded video to the nearest dashcam_event (within ±120 seconds). */
function linkToEvent(
  db: ReturnType<typeof getDb>,
  deviceId: string,
  timestampMs: number,
  videoId: number,
): void {
  try {
    // Find closest dashcam event within ±2 minutes
    const timestampSec = Math.floor(timestampMs / 1000);
    const event = db.prepare(`
      SELECT id FROM dashcam_events
      WHERE cpg_device_id = ?
        AND ABS(
          CAST(strftime('%s', event_timestamp) AS INTEGER) - ?
        ) < 120
      ORDER BY ABS(
        CAST(strftime('%s', event_timestamp) AS INTEGER) - ?
      ) ASC
      LIMIT 1
    `).get(deviceId, timestampSec, timestampSec) as any;

    if (event) {
      // Mark event as having video
      db.prepare(
        'UPDATE dashcam_events SET video_available = 1 WHERE id = ?'
      ).run(event.id);

      // Link video to event
      db.prepare(
        'UPDATE dashcam_videos SET linked_dashcam_event_id = ? WHERE id = ?'
      ).run(event.id, videoId);
    }
  } catch (err: any) {
    // Non-fatal — just log
    console.warn('[ClearPathGPS Media] Event linking warning:', err.message);
  }
}
