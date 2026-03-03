// ============================================================
// ClearPathGPS Poller
// ============================================================
// Background service that polls the ClearPathGPS fleet API
// and writes hardware GPS positions into the dispatch system.
// Follows the patrolMonitor.ts start/stop pattern.
//
// Enhancement: History backfill fetches ALL GPS points between
// polls (not just latest), and detects dashcam video events.

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
  const seconds = val ? parseInt(val, 10) : 30;
  return Math.max(15, seconds) * 1000;
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

function classifyDashcamEvent(ed: CpgEventData): string | null {
  const code = (ed.statusCode || '').toUpperCase().replace(/[\s-]/g, '_');
  const text = ed.statusCodeText || '';

  // Direct status code match
  if (DASHCAM_STATUS_CODES.has(code)) return code.toLowerCase();
  if (DRIVING_EVENT_CODES.has(code)) return code.toLowerCase();

  // Text pattern match
  for (const pattern of DASHCAM_TEXT_PATTERNS) {
    if (pattern.test(text) || pattern.test(code)) {
      return text.toLowerCase().replace(/\s+/g, '_').substring(0, 50) || 'camera_event';
    }
  }

  return null;
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
    INSERT INTO dashcam_events (cpg_device_id, unit_id, dashcam_id, event_type, event_timestamp,
      latitude, longitude, heading, speed_mph, address, status_code, status_code_text, video_available)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

      // Check for dashcam event in latest position
      const eventType = classifyDashcamEvent(ed);
      if (eventType) {
        const device = event.device;
        insertDashcamEvent.run(
          deviceId, mapping.unit_id,
          device?.camera?.dashcamId || null,
          eventType, recordedAt,
          lat, lng, ed.heading ?? null, ed.speedMph ?? null,
          ed.address || null, ed.statusCode || null, ed.statusCodeText || null,
          device?.camera ? 1 : 0,
        );
      }

      // Update sync time + enriched device data
      updateSyncTime.run(now, now, mapping.id);

      // Sync enriched device data from ClearPathGPS to mapping record
      const device = event.device;
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

            // Check for dashcam event
            const eventType = classifyDashcamEvent(ed);
            if (eventType) {
              insertDashcamEvent.run(
                mapping.cpg_device_id, mapping.unit_id,
                null, // dashcamId not available in history events
                eventType, recordedAt,
                lat, lng, ed.heading ?? null, ed.speedMph ?? null,
                ed.address || ed.streetAddress || null,
                ed.statusCode || null, ed.statusCodeText || null,
                0, // video_available unknown from history
              );
              dashcamCount++;
            }
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
