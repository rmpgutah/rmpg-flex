// ============================================================
// Traccar GPS Poller — Fleet Position Capture
// ============================================================
// Background service that polls the Traccar REST API and writes
// hardware GPS positions into the dispatch system.
// Follows the same start/stop pattern as clearPathGpsPoller.ts.
//
// Captures positions as breadcrumbs and telemetry events,
// broadcasts WebSocket updates for real-time map tracking.

import { getDb } from '../models/database';
import { broadcastUnitUpdate } from './websocket';
import { localNow } from './timeUtils';
import {
  getPositions,
  getPositionHistory,
  isConfigured,
  isEnabled,
  getConfigValue,
  knotsToMph,
  metersToMiles,
  CONFIG_KEYS,
  type TraccarPosition,
} from './traccarClient';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startTraccarPoller(intervalMs?: number): void {
  if (intervalHandle) return; // Already running

  const pollMs = intervalMs ?? getPollIntervalMs();
  console.log(`[Traccar] Starting poller — every ${pollMs / 1000}s`);

  intervalHandle = setInterval(() => {
    pollFleetPositions().catch(err => {
      console.error('[Traccar] Poll error:', err.message || err);
    });
  }, pollMs);

  // Run once after a short delay (let server finish startup)
  setTimeout(() => {
    pollFleetPositions().catch(err => {
      console.error('[Traccar] Initial poll error:', err.message || err);
    });
  }, 10_000);
}

export function stopTraccarPoller(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[Traccar] Poller stopped');
  }
}

export function restartTraccarPoller(): void {
  stopTraccarPoller();
  startTraccarPoller();
}

function getPollIntervalMs(): number {
  const val = getConfigValue(CONFIG_KEYS.pollInterval);
  const seconds = val ? parseInt(val, 10) : 5;
  return Math.max(3, seconds) * 1000; // Floor: 3s for near-real-time capture
}

// ============================================================
// Alarm / event classification
// ============================================================

/** Known Traccar alarm types → canonical event names. */
const ALARM_MAP: Record<string, string> = {
  hardBraking: 'hard_brake',
  hardAcceleration: 'hard_accel',
  hardCornering: 'hard_turn',
  overspeed: 'speeding',
  sos: 'panic',
  tampering: 'tamper',
  lowBattery: 'low_battery',
  powerCut: 'power_cut',
  geofenceEnter: 'geofence_enter',
  geofenceExit: 'geofence_exit',
  accident: 'impact',
  shock: 'impact',
  vibration: 'vibration',
  idle: 'idle',
  powerOn: 'power_on',
  powerOff: 'power_off',
  ignitionOn: 'ignition_on',
  ignitionOff: 'ignition_off',
  movement: 'movement',
};

/** Classify a Traccar position into an event type. */
function getEventType(pos: TraccarPosition): string {
  // Check alarm attribute first (e.g. 'hardBraking', 'overspeed')
  const alarm = pos.attributes?.alarm;
  if (alarm && typeof alarm === 'string') {
    return ALARM_MAP[alarm] || alarm.toLowerCase().replace(/[^a-z0-9_]/g, '_').substring(0, 50);
  }

  // Check event attribute
  const event = pos.attributes?.event;
  if (event && typeof event === 'string') {
    return event.toLowerCase().replace(/[^a-z0-9_]/g, '_').substring(0, 50);
  }

  return 'position_update';
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return localNow();
  try {
    return new Date(iso).toISOString().replace('T', ' ').replace('Z', '');
  } catch {
    return localNow();
  }
}

// ============================================================
// Main poll logic
// ============================================================

async function pollFleetPositions(): Promise<void> {
  // Silently skip if not configured or not enabled
  if (!isConfigured() || !isEnabled()) return;

  const db = getDb();

  // Load active device-to-unit mappings
  // cpg_device_id stores the Traccar uniqueId (IMEI/serial)
  // traccar_device_id stores the Traccar numeric device ID
  const mappings = db.prepare(`
    SELECT m.id, m.cpg_device_id, m.traccar_device_id, m.unit_id, m.last_synced_at
    FROM cpg_device_mappings m
    WHERE m.is_active = 1
  `).all() as { id: number; cpg_device_id: string; traccar_device_id: number | null; unit_id: number; last_synced_at: string | null }[];

  if (mappings.length === 0) return;

  // Build lookups: traccar numeric deviceId → mapping AND uniqueId → mapping
  const mappingByTraccarId = new Map<number, typeof mappings[0]>();
  const mappingByUniqueId = new Map<string, typeof mappings[0]>();
  for (const m of mappings) {
    if (m.traccar_device_id) mappingByTraccarId.set(m.traccar_device_id, m);
    if (m.cpg_device_id) mappingByUniqueId.set(m.cpg_device_id, m);
  }

  // Fetch latest positions from Traccar
  const positions = await getPositions();

  if (positions.length === 0) return;

  const now = localNow();
  let updatedCount = 0;

  const updateUnit = db.prepare(`
    UPDATE units SET latitude = ?, longitude = ?, gps_source = 'traccar'
    WHERE id = ?
  `);

  const insertBreadcrumb = db.prepare(`
    INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed,
      unit_status, call_sign, officer_name, badge_number, current_call_id, current_call_number, current_call_type,
      road_name, nearest_intersection, gps_source, recorded_at, odometer, satellite_count, ignition)
    VALUES (?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, NULL, 'traccar', ?, ?, ?, ?)
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
  const backfillEnabled = getConfigValue('traccar_history_backfill') !== 'false';

  // Track which timestamps we inserted to avoid duplication in backfill
  const insertedTimestamps = new Map<number, Set<string>>(); // traccar deviceId → set of timestamps

  // Wrap all DB writes in a single transaction
  const processPositions = db.transaction((items: TraccarPosition[]) => {
    for (const pos of items) {
      // Find mapping by Traccar numeric device ID
      let mapping = mappingByTraccarId.get(pos.deviceId);

      // If no match, this device might not be mapped yet — skip
      if (!mapping) continue;

      const lat = pos.latitude;
      const lng = pos.longitude;
      if (lat == null || lng == null || lat === 0 || lng === 0) continue;
      if (!pos.valid) continue; // Skip invalid GPS fixes

      // Convert speed from knots to mph
      const speedMph = pos.speed != null ? knotsToMph(pos.speed) : null;
      const heading = pos.course ?? null;

      // Update unit position (always use latest)
      updateUnit.run(lat, lng, mapping.unit_id);

      // Get full unit info for breadcrumb + broadcast
      const unit = getUnitFull.get(mapping.unit_id) as any;
      if (!unit) continue;

      // Insert breadcrumb
      const recordedAt = formatTimestamp(pos.fixTime);
      const odometer = pos.attributes?.odometer != null ? metersToMiles(pos.attributes.odometer) : null;
      const satellites = pos.attributes?.satellites ?? null;
      const ignition = pos.attributes?.ignition != null ? (pos.attributes.ignition ? 1 : 0) : null;

      insertBreadcrumb.run(
        mapping.unit_id, unit.officer_id || null,
        lat, lng,
        pos.accuracy ?? null, heading, speedMph,
        unit.status, unit.call_sign,
        unit.officer_name || null, unit.badge_number || null,
        unit.current_call_id || null, unit.call_number || null, unit.current_call_type || null,
        pos.address || null,
        recordedAt,
        odometer, satellites, ignition,
      );

      // Track timestamp for dedup
      if (!insertedTimestamps.has(pos.deviceId)) insertedTimestamps.set(pos.deviceId, new Set());
      insertedTimestamps.get(pos.deviceId)!.add(recordedAt);

      // ── Capture as telemetry event ──
      const eventType = getEventType(pos);
      const rawData = JSON.stringify(pos);
      insertDashcamEvent.run(
        mapping.cpg_device_id, mapping.unit_id,
        null, // dashcamId not applicable for Traccar
        eventType, recordedAt,
        lat, lng, heading, speedMph,
        pos.address || null,
        pos.attributes?.alarm || pos.attributes?.event || null,
        pos.protocol || null,
        0, // video_available — Traccar doesn't handle video
        rawData, null, // no video URL
      );

      // Update sync time + enriched device data
      updateSyncTime.run(now, now, mapping.id);

      // Sync enriched data to mapping record
      try {
        db.prepare(`
          UPDATE cpg_device_mappings SET
            ignition_state = COALESCE(?, ignition_state),
            last_odometer = COALESCE(?, last_odometer)
          WHERE id = ?
        `).run(
          ignition != null ? (ignition ? 'on' : 'off') : null,
          odometer,
          mapping.id,
        );
      } catch { /* non-critical enrichment */ }

      // Broadcast position update via WebSocket
      broadcastUnitUpdate({
        action: 'unit_position_update',
        unit: { ...unit, latitude: lat, longitude: lng, gps_source: 'traccar' },
      });

      updatedCount++;
    }
  });

  processPositions(positions);

  if (updatedCount > 0) {
    console.log(`[Traccar] Updated ${updatedCount} unit(s)`);
  }

  // ── History backfill: fetch all GPS points since last sync ──
  if (backfillEnabled) {
    await backfillHistory(mappings, insertBreadcrumb, insertDashcamEvent, getUnitFull, updateSyncTime, insertedTimestamps);
  }
}

// ============================================================
// History backfill
// ============================================================

async function backfillHistory(
  mappings: { id: number; cpg_device_id: string; traccar_device_id: number | null; unit_id: number; last_synced_at: string | null }[],
  insertBreadcrumb: any,
  insertDashcamEvent: any,
  getUnitFull: any,
  updateSyncTime: any,
  insertedTimestamps: Map<number, Set<string>>,
): Promise<void> {
  const db = getDb();
  const now = localNow();
  const nowISO = new Date().toISOString();

  for (const mapping of mappings) {
    const lastSync = mapping.last_synced_at;
    if (!lastSync) continue; // No previous sync — skip first time
    if (!mapping.traccar_device_id) continue; // Need numeric ID for history query

    // Convert last_synced_at to ISO for API call
    let fromISO: string;
    try {
      fromISO = new Date(lastSync.replace(' ', 'T') + 'Z').toISOString();
    } catch {
      continue;
    }

    try {
      const historyPositions = await getPositionHistory(mapping.traccar_device_id, fromISO, nowISO);

      if (historyPositions.length === 0) continue;

      const unit = getUnitFull.get(mapping.unit_id) as any;
      if (!unit) continue;

      const alreadyInserted = insertedTimestamps.get(mapping.traccar_device_id) || new Set();
      let backfillCount = 0;
      let eventCount = 0;

      const processHistory = db.transaction((positions: TraccarPosition[]) => {
        for (const pos of positions) {
          const lat = pos.latitude;
          const lng = pos.longitude;
          if (lat == null || lng == null || lat === 0 || lng === 0) continue;
          if (!pos.valid) continue;

          const recordedAt = formatTimestamp(pos.fixTime);

          // Skip if already inserted from latest poll
          if (alreadyInserted.has(recordedAt)) continue;

          const speedMph = pos.speed != null ? knotsToMph(pos.speed) : null;
          const heading = pos.course ?? null;
          const odometer = pos.attributes?.odometer != null ? metersToMiles(pos.attributes.odometer) : null;
          const satellites = pos.attributes?.satellites ?? null;
          const ignition = pos.attributes?.ignition != null ? (pos.attributes.ignition ? 1 : 0) : null;

          // Insert breadcrumb
          insertBreadcrumb.run(
            mapping.unit_id, unit.officer_id || null,
            lat, lng,
            pos.accuracy ?? null, heading, speedMph,
            unit.status, unit.call_sign,
            unit.officer_name || null, unit.badge_number || null,
            unit.current_call_id || null, unit.call_number || null, unit.current_call_type || null,
            pos.address || null,
            recordedAt,
            odometer, satellites, ignition,
          );
          backfillCount++;

          // Telemetry event
          const eventType = getEventType(pos);
          const rawData = JSON.stringify(pos);
          insertDashcamEvent.run(
            mapping.cpg_device_id, mapping.unit_id,
            null,
            eventType, recordedAt,
            lat, lng, heading, speedMph,
            pos.address || null,
            pos.attributes?.alarm || pos.attributes?.event || null,
            pos.protocol || null,
            0, rawData, null,
          );
          eventCount++;
        }
      });

      processHistory(historyPositions);

      // Update sync time
      updateSyncTime.run(now, now, mapping.id);

      if (backfillCount > 0) {
        console.log(`[Traccar] History backfill: ${backfillCount} point(s) for device ${mapping.cpg_device_id}`);
      }
    } catch (err: any) {
      console.error(`[Traccar] History backfill error for ${mapping.cpg_device_id}:`, err.message || err);
    }
  }
}
