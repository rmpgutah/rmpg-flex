// ============================================================
// ClearPathGPS Poller — Second-by-Second Capture
// ============================================================
// Background service that polls the ClearPathGPS fleet API
// and writes hardware GPS positions into the dispatch system.
// Follows the patrolMonitor.ts start/stop pattern.
//
// Captures EVERY event as a dashcam record with raw JSON data,
// deep-scans for video URLs, and stores second-by-second
// telemetry for complete vehicle tracking and video retrieval.

import { getDb } from '../models/database';
import { broadcastUnitUpdate } from './websocket';
import { localNow } from './timeUtils';
import {
  getFleetLatest,
  getDeviceHistory,
  isConfigured,
  isEnabled,
  getConfigValue,
  CONFIG_KEYS,
  type CpgFleetEvent,
  type CpgEventData,
} from './clearPathGpsClient';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startClearPathGpsPoller(intervalMs?: number): void {
  if (intervalHandle) return; // Already running

  const pollMs = intervalMs ?? getPollIntervalMs();
  console.log(`[ClearPathGPS] Starting poller — every ${pollMs / 1000}s`);

  intervalHandle = setInterval(() => {
    pollFleetPositions().catch(err => {
      console.error('[ClearPathGPS] Poll error:', err.message || err);
    });
  }, pollMs);

  // Run once after a short delay (let server finish startup)
  setTimeout(() => {
    pollFleetPositions().catch(err => {
      console.error('[ClearPathGPS] Initial poll error:', err.message || err);
    });
  }, 10_000);
}

export function stopClearPathGpsPoller(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[ClearPathGPS] Poller stopped');
  }
}

export function restartClearPathGpsPoller(): void {
  stopClearPathGpsPoller();
  startClearPathGpsPoller();
}

function getPollIntervalMs(): number {
  const val = getConfigValue(CONFIG_KEYS.pollInterval);
  const seconds = val ? parseInt(val, 10) : 5;
  return Math.max(3, seconds) * 1000; // Floor: 3s for near-real-time capture
}

// Status codes that indicate dashcam/camera events
const DASHCAM_STATUS_CODES = new Set([
  'VIDEO_START', 'VIDEO_STOP', 'VIDEO_ALARM', 'VIDEO_LOST',
  'CAMERA_MOTION', 'CAMERA_TRIGGERED',
]);

// Status code text patterns that suggest dashcam events
const DASHCAM_TEXT_PATTERNS = [
  /video/i, /camera/i, /dashcam/i, /recording/i, /footage/i,
  /impact/i, /collision/i, /panic/i,
];

// Status codes for driving behavior events (also captured as dashcam events)
const DRIVING_EVENT_CODES = new Set([
  'HARD_BRAKE', 'HARD_ACCEL', 'HARD_TURN', 'HARD_CORNERING',
  'SPEEDING', 'IMPACT', 'TAMPER', 'PANIC', 'SOS',
]);

/** Known field names that contain video URLs. */
const VIDEO_URL_KEYS = new Set([
  'videourl', 'video_url', 'clipurl', 'clip_url',
  'mediaurl', 'media_url', 'videolink', 'video_link',
  'recordingurl', 'recording_url', 'footageurl', 'footage_url',
  'playbackurl', 'playback_url', 'streamurl', 'stream_url',
  'downloadurl', 'download_url', 'fileurl', 'file_url',
  'url', 'href', 'src',
]);

/** Deep-scan an object for video URLs — checks top-level keys by name,
 *  then recursively walks nested objects/arrays up to 3 levels. */
function extractVideoUrl(ed: CpgEventData): string | null {
  function isVideoUrl(val: unknown): val is string {
    return typeof val === 'string' &&
      (val.startsWith('http://') || val.startsWith('https://')) &&
      // Quick heuristic: URL contains a video-related path segment or file extension
      (/\.(mp4|avi|mov|mkv|webm|m3u8|ts|flv|wmv|3gp)/i.test(val) ||
       /video|clip|record|footage|media|camera|dashcam|stream|playback/i.test(val));
  }

  function scan(obj: any, depth: number): string | null {
    if (depth > 3 || obj == null || typeof obj !== 'object') return null;

    // Check each key
    const keys = Array.isArray(obj) ? obj.map((_, i) => String(i)) : Object.keys(obj);
    for (const key of keys) {
      const val = Array.isArray(obj) ? obj[Number(key)] : obj[key];

      // Known key name → check if value is any URL
      if (VIDEO_URL_KEYS.has(key.toLowerCase())) {
        if (typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://'))) {
          return val;
        }
      }

      // Any string that looks like a video URL
      if (isVideoUrl(val)) return val;

      // Recurse into objects / arrays
      if (typeof val === 'object' && val !== null) {
        const found = scan(val, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  return scan(ed, 0);
}

/** Classify every event — never returns null.
 *  Known dashcam / driving-behavior codes get their canonical label;
 *  everything else uses the raw status code or 'position_update'. */
function getEventType(ed: CpgEventData): string {
  const code = String(ed.statusCode ?? '').toUpperCase().replace(/[\s-]/g, '_');
  const text = String(ed.statusCodeText ?? '');

  // Known dashcam event
  if (DASHCAM_STATUS_CODES.has(code)) return code.toLowerCase();
  // Known driving behavior event
  if (DRIVING_EVENT_CODES.has(code)) return code.toLowerCase();

  // Text pattern match (camera / video keywords)
  for (const pattern of DASHCAM_TEXT_PATTERNS) {
    if (pattern.test(text) || pattern.test(code)) {
      return text.toLowerCase().replace(/\s+/g, '_').substring(0, 50) || 'camera_event';
    }
  }

  // Fall back to the raw status code itself (e.g. "InMotion" → "inmotion")
  if (code && code.length > 0) {
    return code.toLowerCase().replace(/[^a-z0-9_]/g, '_').substring(0, 50);
  }

  return 'position_update';
}

function formatTimestamp(ts: string | number | undefined): string {
  if (!ts) return localNow();
  if (typeof ts === 'number') {
    return new Date(ts).toISOString().replace('T', ' ').replace('Z', '');
  }
  return new Date(ts).toISOString().replace('T', ' ').replace('Z', '');
}

async function pollFleetPositions(): Promise<void> {
  // Silently skip if not configured or not enabled
  if (!isConfigured() || !isEnabled()) return;

  const db = getDb();

  // Load active device-to-unit mappings
  const mappings = db.prepare(`
    SELECT m.id, m.cpg_device_id, m.unit_id, m.last_synced_at
    FROM cpg_device_mappings m
    WHERE m.is_active = 1
  `).all() as { id: number; cpg_device_id: string; unit_id: number; last_synced_at: string | null }[];

  if (mappings.length === 0) return;

  // Build lookup: cpg_device_id → mapping
  const mappingByDevice = new Map(mappings.map(m => [m.cpg_device_id, m]));

  // Fetch latest fleet positions from ClearPathGPS
  const events = await getFleetLatest();

  if (events.length === 0) return;

  const now = localNow();
  let updatedCount = 0;

  const updateUnit = db.prepare(`
    UPDATE units SET latitude = ?, longitude = ?, gps_source = 'clearpathgps'
    WHERE id = ?
  `);

  const insertBreadcrumb = db.prepare(`
    INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed,
      unit_status, call_sign, officer_name, badge_number, current_call_id, current_call_number, current_call_type,
      road_name, nearest_intersection, gps_source, recorded_at, odometer, satellite_count, ignition)
    VALUES (?, ?, ?, ?, NULL, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, NULL, 'clearpathgps', ?, ?, ?, ?)
  `);

  const updateSyncTime = db.prepare(`
    UPDATE cpg_device_mappings SET last_synced_at = ?, updated_at = ? WHERE id = ?
  `);

  const getUnitFull = db.prepare(`
    SELECT u.*, usr.full_name as officer_name, usr.badge_number,
      c.call_number, c.incident_type as current_call_type, c.location_address as current_call_location
    FROM units u
    LEFT JOIN users usr ON u.officer_id = usr.id
    LEFT JOIN calls_for_service c ON u.current_call_id = c.id
    WHERE u.id = ?
  `);

  const insertDashcamEvent = db.prepare(`
    INSERT OR IGNORE INTO dashcam_events (cpg_device_id, unit_id, dashcam_id, event_type, event_timestamp,
      latitude, longitude, heading, speed_mph, address, status_code, status_code_text, video_available,
      cpg_raw_data, video_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Check if history backfill is enabled (default: true)
  const backfillEnabled = getConfigValue('clearpathgps_history_backfill') !== 'false';

  // Track which timestamps we inserted from getFleetLatest to avoid duplication
  const insertedTimestamps = new Map<string, Set<string>>(); // deviceId → set of timestamps

  // Wrap all DB writes in a single transaction
  const processEvents = db.transaction((items: CpgFleetEvent[]) => {
    for (const event of items) {
      const ed = event.eventData?.[0];
      if (!ed) continue;

      const deviceId = ed.deviceId;
      const mapping = mappingByDevice.get(deviceId);
      if (!mapping) continue;

      const lat = ed.latitude;
      const lng = ed.longitude;
      if (lat == null || lng == null || lat === 0 || lng === 0) continue;

      // Update unit position (always use latest)
      updateUnit.run(lat, lng, mapping.unit_id);

      // Get full unit info for breadcrumb + broadcast
      const unit = getUnitFull.get(mapping.unit_id) as any;
      if (!unit) continue;

      // Insert breadcrumb for latest position
      const recordedAt = formatTimestamp(ed.timestamp);

      insertBreadcrumb.run(
        mapping.unit_id, unit.officer_id || null,
        lat, lng,
        ed.heading ?? null, ed.speedMph ?? null,
        unit.status, unit.call_sign,
        unit.officer_name || null, unit.badge_number || null,
        unit.current_call_id || null, unit.call_number || null, unit.current_call_type || null,
        ed.address || null,
        recordedAt,
        ed.reportedOdometer ?? null,
        ed.satelliteCount ?? null,
        ed.ignition != null ? (ed.ignition ? 1 : 0) : null,
      );

      // Track this timestamp for dedup
      if (!insertedTimestamps.has(deviceId)) insertedTimestamps.set(deviceId, new Set());
      insertedTimestamps.get(deviceId)!.add(recordedAt);

      // ── Capture EVERY event as a dashcam record (second-by-second) ──
      const eventType = getEventType(ed);
      const device = event.device;
      const videoUrl = extractVideoUrl(ed);
      const rawData = JSON.stringify(ed);
      insertDashcamEvent.run(
        deviceId, mapping.unit_id,
        device?.camera?.dashcamId || null,
        eventType, recordedAt,
        lat, lng, ed.heading ?? null, ed.speedMph ?? null,
        ed.address || null, String(ed.statusCode ?? '') || null, String(ed.statusCodeText ?? '') || null,
        videoUrl ? 1 : (device?.camera ? 1 : 0),
        rawData, videoUrl,
      );

      // Update sync time + enriched device data
      updateSyncTime.run(now, now, mapping.id);

      // Sync enriched device data from ClearPathGPS to mapping record
      if (device) {
        try {
          db.prepare(`
            UPDATE cpg_device_mappings SET
              vehicle_make = COALESCE(?, vehicle_make),
              vehicle_model = COALESCE(?, vehicle_model),
              vehicle_vin = COALESCE(?, vehicle_vin),
              license_plate = COALESCE(?, license_plate),
              ignition_state = ?,
              last_odometer = COALESCE(?, last_odometer),
              driver_name = COALESCE(?, driver_name),
              gts_device_id = COALESCE(?, gts_device_id)
            WHERE cpg_device_id = ?
          `).run(
            device.vehicleMake || null,
            device.vehicleModel || null,
            device.vehicleID || null,
            device.licensePlate || null,
            device.ignitionState || (ed.ignition != null ? (ed.ignition ? 'on' : 'off') : null),
            ed.reportedOdometer || null,
            ed.driverName || device.driverName || null,
            device.gtsDeviceId || null,
            deviceId,
          );
        } catch { /* non-critical enrichment */ }
      }

      // Broadcast position update (same event as browser GPS)
      broadcastUnitUpdate({ action: 'unit_position_update', unit: { ...unit, latitude: lat, longitude: lng, gps_source: 'clearpathgps' } });

      updatedCount++;
    }
  });

  processEvents(events);

  if (updatedCount > 0) {
    console.log(`[ClearPathGPS] Updated ${updatedCount} unit(s)`);
  }

  // ── History backfill: fetch all GPS points since last sync ──
  if (backfillEnabled) {
    await backfillHistory(mappings, insertBreadcrumb, insertDashcamEvent, getUnitFull, updateSyncTime, insertedTimestamps);
  }
}

async function backfillHistory(
  mappings: { id: number; cpg_device_id: string; unit_id: number; last_synced_at: string | null }[],
  insertBreadcrumb: any,
  insertDashcamEvent: any,
  getUnitFull: any,
  updateSyncTime: any,
  insertedTimestamps: Map<string, Set<string>>,
): Promise<void> {
  const db = getDb();
  const now = localNow();
  const nowISO = new Date().toISOString();

  for (const mapping of mappings) {
    const lastSync = mapping.last_synced_at;
    if (!lastSync) continue; // No previous sync — skip first time, next poll will backfill

    // Convert last_synced_at to ISO for API call
    let fromISO: string;
    try {
      // last_synced_at is stored as "YYYY-MM-DD HH:MM:SS" (local time)
      fromISO = new Date(lastSync.replace(' ', 'T') + 'Z').toISOString();
    } catch {
      continue;
    }

    try {
      const historyEvents = await getDeviceHistory(mapping.cpg_device_id, fromISO, nowISO);

      if (historyEvents.length === 0) continue;

      const unit = getUnitFull.get(mapping.unit_id) as any;
      if (!unit) continue;

      const alreadyInserted = insertedTimestamps.get(mapping.cpg_device_id) || new Set();
      let backfillCount = 0;
      let dashcamCount = 0;

      const processHistory = db.transaction((events: CpgFleetEvent[]) => {
        for (const event of events) {
          const eventDataList = event.eventData || [];

          for (const ed of eventDataList) {
            const lat = ed.latitude;
            const lng = ed.longitude;
            if (lat == null || lng == null || lat === 0 || lng === 0) continue;

            const recordedAt = formatTimestamp(ed.timestamp);

            // Skip if already inserted from getFleetLatest
            if (alreadyInserted.has(recordedAt)) continue;

            // Insert breadcrumb
            insertBreadcrumb.run(
              mapping.unit_id, unit.officer_id || null,
              lat, lng,
              ed.heading ?? null, ed.speedMph ?? null,
              unit.status, unit.call_sign,
              unit.officer_name || null, unit.badge_number || null,
              unit.current_call_id || null, unit.call_number || null, unit.current_call_type || null,
              ed.address || ed.streetAddress || null,
              recordedAt,
              ed.reportedOdometer ?? null,
              ed.satelliteCount ?? null,
              ed.ignition != null ? (ed.ignition ? 1 : 0) : null,
            );
            backfillCount++;

            // ── Capture EVERY event as dashcam record (second-by-second) ──
            const eventType = getEventType(ed);
            const videoUrl = extractVideoUrl(ed);
            const rawData = JSON.stringify(ed);
            insertDashcamEvent.run(
              mapping.cpg_device_id, mapping.unit_id,
              null, // dashcamId not available in history events
              eventType, recordedAt,
              lat, lng, ed.heading ?? null, ed.speedMph ?? null,
              ed.address || ed.streetAddress || null,
              String(ed.statusCode ?? '') || null, String(ed.statusCodeText ?? '') || null,
              videoUrl ? 1 : 0,
              rawData, videoUrl,
            );
            dashcamCount++;
          }
        }
      });

      processHistory(historyEvents);

      // Update sync time to latest event timestamp
      updateSyncTime.run(now, now, mapping.id);

      if (backfillCount > 0) {
        console.log(`[ClearPathGPS] History backfill: ${backfillCount} point(s) for ${mapping.cpg_device_id}`);
      }
      if (dashcamCount > 0) {
        console.log(`[ClearPathGPS] Dashcam events: ${dashcamCount} event(s) for ${mapping.cpg_device_id}`);
      }
    } catch (err: any) {
      console.error(`[ClearPathGPS] History backfill error for ${mapping.cpg_device_id}:`, err.message || err);
    }
  }
}
