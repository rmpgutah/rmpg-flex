// ============================================================
// ClearPathGPS Poller — v3.0 API
// ============================================================
// Background service that polls the ClearPathGPS v3.0 fleet API
// and writes hardware GPS positions into the dispatch system.
// Uses proper v3.0 Media endpoints for video URL retrieval
// instead of hacky deep-scan URL extraction.

import { getDb } from '../models/database';
import { broadcastUnitUpdate } from './websocket';
import { localNow } from './timeUtils';
import {
  getFleetLatest,
  getDeviceHistory,
  getDeviceLatest,
  getDevices,
  getMediaList,
  getGeozones,
  getDrivers,
  getDeviceGroups,
  getStatusCodes,
  getActiveApiVersion,
  isConfigured,
  isEnabled,
  getConfigValue,
  CONFIG_KEYS,
  parseLat,
  parseLng,
  parseIgnition,
  parseOdometer,
  formatEventTimestamp,
  toEpochSeconds,
  testConnection,
  type CpgFleetEvent,
  type CpgEventData,
} from './clearPathGpsClient';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startClearPathGpsPoller(intervalMs?: number): void {
  if (intervalHandle) return;

  const pollMs = intervalMs ?? getPollIntervalMs();
  console.log(`[ClearPathGPS] Starting v3.0 poller — every ${pollMs / 1000}s`);

  intervalHandle = setInterval(() => {
    pollFleetPositions().catch(err => {
      console.error('[ClearPathGPS] Poll error:', err.message || err);
    });
  }, pollMs);

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
  return Math.max(3, seconds) * 1000;
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

// Status codes for driving behavior events
const DRIVING_EVENT_CODES = new Set([
  'HARD_BRAKE', 'HARD_ACCEL', 'HARD_TURN', 'HARD_CORNERING',
  'SPEEDING', 'IMPACT', 'TAMPER', 'PANIC', 'SOS',
]);

/** Classify event by status code. */
function getEventType(ed: CpgEventData): string {
  const code = String(ed.statusCode ?? '').toUpperCase().replace(/[\s-]/g, '_');
  const text = String(ed.statusCodeText ?? '');

  if (DASHCAM_STATUS_CODES.has(code)) return code.toLowerCase();
  if (DRIVING_EVENT_CODES.has(code)) return code.toLowerCase();

  for (const pattern of DASHCAM_TEXT_PATTERNS) {
    if (pattern.test(text) || pattern.test(code)) {
      return text.toLowerCase().replace(/\s+/g, '_').substring(0, 50) || 'camera_event';
    }
  }

  if (code && code.length > 0) {
    return code.toLowerCase().replace(/[^a-z0-9_]/g, '_').substring(0, 50);
  }

  return 'position_update';
}

/** Force an immediate poll — bypasses isEnabled() check for admin-triggered syncs. */
export async function forcePoll(): Promise<void> {
  if (!isConfigured()) throw new Error('ClearPathGPS credentials not configured');
  return pollFleetPositions(true);
}

let _lastSkipLog = 0;

async function pollFleetPositions(force = false): Promise<void> {
  if (!force) {
    if (!isConfigured()) {
      // Log once per minute instead of every 5s
      if (!_lastSkipLog || Date.now() - _lastSkipLog > 60_000) {
        console.log('[ClearPathGPS] Skipping poll — credentials not configured. Set email/password/accountId in Admin → Integrations.');
        _lastSkipLog = Date.now();
      }
      return;
    }
    if (!isEnabled()) {
      if (!_lastSkipLog || Date.now() - _lastSkipLog > 60_000) {
        console.log('[ClearPathGPS] Skipping poll — integration disabled. Enable in Admin → Integrations.');
        _lastSkipLog = Date.now();
      }
      return;
    }
  }

  const db = getDb();

  const mappings = db.prepare(`
    SELECT m.id, m.cpg_device_id, m.unit_id, m.last_synced_at
    FROM cpg_device_mappings m
    WHERE m.is_active = 1
  `).all() as { id: number; cpg_device_id: string; unit_id: number; last_synced_at: string | null }[];

  if (mappings.length === 0) {
    if (!_lastSkipLog || Date.now() - _lastSkipLog > 60_000) {
      console.log('[ClearPathGPS] Skipping poll — no device-to-unit mappings. Map devices in Admin → ClearPathGPS → Mappings.');
      _lastSkipLog = Date.now();
    }
    return;
  }

  const mappingByDevice = new Map(mappings.map(m => [m.cpg_device_id, m]));

  // v3.0: getFleetLatest returns EventDataSetModel[] (one per device)
  console.log(`[ClearPathGPS] Polling fleet positions for ${mappings.length} mapped device(s)...`);
  const events = await getFleetLatest();
  if (events.length === 0) {
    console.log('[ClearPathGPS] API returned 0 fleet events');
    return;
  }
  console.log(`[ClearPathGPS] Received ${events.length} fleet event(s) from API`);

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

  const backfillEnabled = getConfigValue('clearpathgps_history_backfill') !== 'false';
  const insertedTimestamps = new Map<string, Set<string>>();

  // Collect deviceIds that have media-enabled events for async media fetch
  const mediaDeviceIds = new Set<string>();

  const processEvents = db.transaction((items: CpgFleetEvent[]) => {
    for (const event of items) {
      const ed = event.eventData?.[0];
      if (!ed) continue;

      // v3.0: deviceId comes from the event wrapper's id field or from eventData
      const deviceId = ed.deviceId || event.id || '';
      const mapping = mappingByDevice.get(deviceId);
      if (!mapping) continue;

      // v3.0: lat/lng are strings — parse to numbers
      const lat = parseLat(ed);
      const lng = parseLng(ed);
      if (!lat || !lng || lat === 0 || lng === 0) continue;

      updateUnit.run(lat, lng, mapping.unit_id);

      const unit = getUnitFull.get(mapping.unit_id) as any;
      if (!unit) continue;

      // v3.0: timestamp is epoch integer
      const recordedAt = formatEventTimestamp(ed.timestamp);

      insertBreadcrumb.run(
        mapping.unit_id, unit.officer_id || null,
        lat, lng,
        ed.heading ?? null, ed.speedMph ?? null,
        unit.status, unit.call_sign,
        unit.officer_name || null, unit.badge_number || null,
        unit.current_call_id || null, unit.call_number || null, unit.current_call_type || null,
        ed.address || null,
        recordedAt,
        parseOdometer(ed),
        ed.satelliteCount ?? null,
        parseIgnition(ed) ? 1 : 0,
      );

      if (!insertedTimestamps.has(deviceId)) insertedTimestamps.set(deviceId, new Set());
      insertedTimestamps.get(deviceId)!.add(recordedAt);

      // Capture event as dashcam record
      const eventType = getEventType(ed);
      const rawData = JSON.stringify(ed);

      // v3.0: No more hacky URL deep-scan — video URLs come from /media/list endpoint
      insertDashcamEvent.run(
        deviceId, mapping.unit_id,
        null,
        eventType, recordedAt,
        lat, lng, ed.heading ?? null, ed.speedMph ?? null,
        ed.address || null, String(ed.statusCode ?? '') || null, String(ed.statusCodeText ?? '') || null,
        event.mediaEnabled ? 1 : 0,
        rawData, null, // video_url populated async via media API
      );

      updateSyncTime.run(now, now, mapping.id);

      // Track media-enabled devices for async video URL fetch
      if (event.mediaEnabled) {
        mediaDeviceIds.add(deviceId);
      }

      // Sync enriched device data from v3.0 event metadata
      if (event.displayName || event.driverName) {
        try {
          db.prepare(`
            UPDATE cpg_device_mappings SET
              driver_name = COALESCE(?, driver_name),
              last_odometer = COALESCE(?, last_odometer)
            WHERE cpg_device_id = ?
          `).run(
            event.driverName || null,
            event.lastOdometerKM || null,
            deviceId,
          );
        } catch { /* non-critical */ }
      }

      broadcastUnitUpdate({ action: 'unit_position_update', unit: { ...unit, latitude: lat, longitude: lng, gps_source: 'clearpathgps' } });

      updatedCount++;
    }
  });

  processEvents(events);

  if (updatedCount > 0) {
    console.log(`[ClearPathGPS] Updated ${updatedCount} unit(s) via v3.0 API`);
  }

  // Async: fetch video URLs from media API for media-enabled devices
  if (mediaDeviceIds.size > 0) {
    fetchMediaUrls(mediaDeviceIds).catch(err => {
      console.error('[ClearPathGPS] Media URL fetch error:', err.message || err);
    });
  }

  if (backfillEnabled) {
    await backfillHistory(mappings, insertBreadcrumb, insertDashcamEvent, getUnitFull, updateSyncTime, insertedTimestamps);
  }
}

/** Fetch video URLs from the v3.0 /media/list endpoint and update dashcam_events. */
async function fetchMediaUrls(deviceIds: Set<string>): Promise<void> {
  const db = getDb();
  const fiveMinAgo = toEpochSeconds(new Date(Date.now() - 5 * 60 * 1000));
  const nowEpoch = toEpochSeconds(new Date());

  const updateVideoUrl = db.prepare(`
    UPDATE dashcam_events SET video_url = ?, video_available = 1
    WHERE cpg_device_id = ? AND event_timestamp >= ? AND video_url IS NULL
    ORDER BY event_timestamp DESC LIMIT 1
  `);

  for (const deviceId of deviceIds) {
    try {
      const mediaResponse = await getMediaList(deviceId, fiveMinAgo, nowEpoch, {
        mediaType: 'video',
        pageSize: 5,
      });

      if (!mediaResponse.pageData?.length) continue;

      for (const mediaEvent of mediaResponse.pageData) {
        for (const obj of mediaEvent.mediaObject || []) {
          if (obj.accessUrl) {
            const ts = formatEventTimestamp(mediaEvent.eventTimestamp);
            updateVideoUrl.run(obj.accessUrl, deviceId, ts);
          }
        }
      }
    } catch {
      // Non-critical — video URLs are supplementary
    }
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
  const nowEpoch = toEpochSeconds(new Date());

  for (const mapping of mappings) {
    const lastSync = mapping.last_synced_at;
    if (!lastSync) continue;

    let fromEpoch: number;
    try {
      fromEpoch = toEpochSeconds(new Date(lastSync.replace(' ', 'T') + 'Z'));
    } catch {
      continue;
    }

    try {
      // v3.0: pass epoch integers directly
      const historyEvents = await getDeviceHistory(mapping.cpg_device_id, fromEpoch, nowEpoch);

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
            // v3.0: parse string lat/lng
            const lat = parseLat(ed);
            const lng = parseLng(ed);
            if (!lat || !lng || lat === 0 || lng === 0) continue;

            const recordedAt = formatEventTimestamp(ed.timestamp);
            if (alreadyInserted.has(recordedAt)) continue;

            insertBreadcrumb.run(
              mapping.unit_id, unit.officer_id || null,
              lat, lng,
              ed.heading ?? null, ed.speedMph ?? null,
              unit.status, unit.call_sign,
              unit.officer_name || null, unit.badge_number || null,
              unit.current_call_id || null, unit.call_number || null, unit.current_call_type || null,
              ed.address || ed.streetAddress || null,
              recordedAt,
              parseOdometer(ed),
              ed.satelliteCount ?? null,
              parseIgnition(ed) ? 1 : 0,
            );
            backfillCount++;

            const eventType = getEventType(ed);
            const rawData = JSON.stringify(ed);
            insertDashcamEvent.run(
              mapping.cpg_device_id, mapping.unit_id,
              null,
              eventType, recordedAt,
              lat, lng, ed.heading ?? null, ed.speedMph ?? null,
              ed.address || ed.streetAddress || null,
              String(ed.statusCode ?? '') || null, String(ed.statusCodeText ?? '') || null,
              0, // video_available — will be populated by media API
              rawData, null,
            );
            dashcamCount++;
          }
        }
      });

      processHistory(historyEvents);
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

// ============================================================
// Full Sync — comprehensive data pull from all endpoints
// ============================================================

export interface FullSyncResult {
  apiVersion: string;
  connection: { success: boolean; error?: string };
  devices: { count: number; items: any[]; error?: string };
  fleetPositions: { count: number; unitsUpdated: number; breadcrumbsInserted: number; error?: string };
  deviceHistory: { devicesPolled: number; totalPoints: number; error?: string };
  media: { devicesChecked: number; mediaEvents: number; videoUrls: number; error?: string };
  geozones: { count: number; items: any[]; error?: string };
  drivers: { count: number; items: any[]; error?: string };
  groups: { count: number; items: any[]; error?: string };
  statusCodes: { fetched: boolean; error?: string };
  duration_ms: number;
}

/** Mandatory comprehensive sync — pulls ALL available data from ClearPathGPS.
 *  Bypasses enabled check. Requires credentials to be configured. */
export async function fullSync(): Promise<FullSyncResult> {
  const startTime = Date.now();

  if (!isConfigured()) {
    throw new Error('ClearPathGPS credentials not configured');
  }

  const result: FullSyncResult = {
    apiVersion: 'unknown',
    connection: { success: false },
    devices: { count: 0, items: [] },
    fleetPositions: { count: 0, unitsUpdated: 0, breadcrumbsInserted: 0 },
    deviceHistory: { devicesPolled: 0, totalPoints: 0 },
    media: { devicesChecked: 0, mediaEvents: 0, videoUrls: 0 },
    geozones: { count: 0, items: [] },
    drivers: { count: 0, items: [] },
    groups: { count: 0, items: [] },
    statusCodes: { fetched: false },
    duration_ms: 0,
  };

  // ── 1. Test connection ──
  console.log('[ClearPathGPS] ═══ FULL SYNC STARTED ═══');
  try {
    const conn = await testConnection();
    result.connection = { success: conn.success, error: conn.error };
    result.apiVersion = conn.apiVersion;
    console.log(`[ClearPathGPS] Connection: ${conn.success ? 'OK' : 'FAILED'} (API ${conn.apiVersion}, ${conn.deviceCount} devices)`);
    if (!conn.success) {
      result.duration_ms = Date.now() - startTime;
      return result;
    }
  } catch (err: any) {
    result.connection = { success: false, error: err.message };
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  result.apiVersion = getActiveApiVersion();

  // ── 2. Fetch all devices ──
  try {
    const devices = await getDevices();
    result.devices = { count: devices.length, items: devices };
    console.log(`[ClearPathGPS] Devices: ${devices.length} found`);
  } catch (err: any) {
    result.devices.error = err.message;
    console.error('[ClearPathGPS] Devices fetch failed:', err.message);
  }

  // ── 3. Force poll fleet positions (writes breadcrumbs + updates units) ──
  try {
    await pollFleetPositions(true);
    // Count what was written
    const db = getDb();
    const recentBreadcrumbs = (db.prepare(
      "SELECT COUNT(*) as cnt FROM gps_breadcrumbs WHERE gps_source = 'clearpathgps' AND recorded_at >= datetime('now', '-2 minutes')"
    ).get() as any)?.cnt || 0;
    const mappedUnits = (db.prepare(
      "SELECT COUNT(*) as cnt FROM units WHERE gps_source = 'clearpathgps'"
    ).get() as any)?.cnt || 0;
    result.fleetPositions = { count: result.devices.count, unitsUpdated: mappedUnits, breadcrumbsInserted: recentBreadcrumbs };
    console.log(`[ClearPathGPS] Fleet positions: ${mappedUnits} units updated, ${recentBreadcrumbs} breadcrumbs`);
  } catch (err: any) {
    result.fleetPositions.error = err.message;
    console.error('[ClearPathGPS] Fleet poll failed:', err.message);
  }

  // ── 4. Pull 20-day history + 7-day media IN PARALLEL per device ──
  try {
    const db = getDb();
    const mappings = db.prepare(
      'SELECT cpg_device_id, unit_id FROM cpg_device_mappings WHERE is_active = 1'
    ).all() as { cpg_device_id: string; unit_id: number }[];

    const twentyDaysAgo = toEpochSeconds(new Date(Date.now() - 20 * 24 * 60 * 60 * 1000));
    const sevenDaysAgo = toEpochSeconds(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const nowEpoch = toEpochSeconds(new Date());

    const updateVideoUrl = db.prepare(`
      UPDATE dashcam_events SET video_url = ?, video_available = 1
      WHERE cpg_device_id = ? AND event_timestamp LIKE ? AND video_url IS NULL
    `);

    // Process devices in parallel batches of 4
    const BATCH_SIZE = 4;
    for (let i = 0; i < mappings.length; i += BATCH_SIZE) {
      const batch = mappings.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(batch.map(async (mapping) => {
        const deviceResult = { history: 0, media: 0, videoUrls: 0 };

        // History fetch
        try {
          const events = await getDeviceHistory(mapping.cpg_device_id, twentyDaysAgo, nowEpoch);
          deviceResult.history = events.reduce((sum, e) => sum + (e.eventData?.length || 0), 0);
          console.log(`[ClearPathGPS] History: ${mapping.cpg_device_id} → ${deviceResult.history} points`);
        } catch (err: any) {
          console.error(`[ClearPathGPS] History failed for ${mapping.cpg_device_id}:`, err.message);
        }

        // Media fetch
        try {
          const mediaResponse = await getMediaList(mapping.cpg_device_id, sevenDaysAgo, nowEpoch, { pageSize: 100 });
          deviceResult.media = mediaResponse.pageData?.length || 0;

          if (mediaResponse.pageData) {
            for (const mediaEvent of mediaResponse.pageData) {
              for (const obj of mediaEvent.mediaObject || []) {
                if (obj.accessUrl) {
                  deviceResult.videoUrls++;
                  const ts = formatEventTimestamp(mediaEvent.eventTimestamp);
                  const tsPrefix = ts.substring(0, 16);
                  try { updateVideoUrl.run(obj.accessUrl, mapping.cpg_device_id, `${tsPrefix}%`); } catch { /* non-critical */ }
                }
              }
            }
          }
          console.log(`[ClearPathGPS] Media: ${mapping.cpg_device_id} → ${deviceResult.media} events`);
        } catch {
          // Media may not be available for all devices
        }

        return deviceResult;
      }));

      for (const res of batchResults) {
        if (res.status === 'fulfilled') {
          result.deviceHistory.devicesPolled++;
          result.deviceHistory.totalPoints += res.value.history;
          result.media.devicesChecked++;
          result.media.mediaEvents += res.value.media;
          result.media.videoUrls += res.value.videoUrls;
        }
      }
    }

    console.log(`[ClearPathGPS] History total: ${result.deviceHistory.devicesPolled} devices, ${result.deviceHistory.totalPoints} points`);
    console.log(`[ClearPathGPS] Media total: ${result.media.devicesChecked} devices, ${result.media.mediaEvents} events, ${result.media.videoUrls} video URLs`);
  } catch (err: any) {
    result.deviceHistory.error = err.message;
    result.media.error = err.message;
  }

  // ── 5. Fetch geozones, drivers, groups, status codes IN PARALLEL ──
  const [geoRes, drvRes, grpRes, codeRes] = await Promise.allSettled([
    getGeozones().then(g => { result.geozones = { count: Array.isArray(g) ? g.length : 0, items: g || [] }; console.log(`[ClearPathGPS] Geozones: ${result.geozones.count}`); }),
    getDrivers().then(d => { result.drivers = { count: Array.isArray(d) ? d.length : 0, items: d || [] }; console.log(`[ClearPathGPS] Drivers: ${result.drivers.count}`); }),
    getDeviceGroups(true).then(g => { result.groups = { count: Array.isArray(g) ? g.length : 0, items: g || [] }; console.log(`[ClearPathGPS] Device groups: ${result.groups.count}`); }),
    getStatusCodes().then(() => { result.statusCodes = { fetched: true }; console.log('[ClearPathGPS] Status codes: fetched'); }),
  ]);

  if (geoRes.status === 'rejected') { result.geozones.error = geoRes.reason?.message; console.log(`[ClearPathGPS] Geozones unavailable: ${geoRes.reason?.message}`); }
  if (drvRes.status === 'rejected') { result.drivers.error = drvRes.reason?.message; console.log(`[ClearPathGPS] Drivers unavailable: ${drvRes.reason?.message}`); }
  if (grpRes.status === 'rejected') { result.groups.error = grpRes.reason?.message; console.log(`[ClearPathGPS] Groups unavailable: ${grpRes.reason?.message}`); }
  if (codeRes.status === 'rejected') { result.statusCodes = { fetched: false, error: codeRes.reason?.message }; console.log(`[ClearPathGPS] Status codes unavailable: ${codeRes.reason?.message}`); }

  result.duration_ms = Date.now() - startTime;
  console.log(`[ClearPathGPS] ═══ FULL SYNC COMPLETE — ${(result.duration_ms / 1000).toFixed(1)}s ═══`);

  return result;
}
