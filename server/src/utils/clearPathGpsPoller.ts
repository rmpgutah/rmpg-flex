// ============================================================
// ClearPathGPS Poller
// ============================================================
// Background service that polls the ClearPathGPS fleet API
// and writes hardware GPS positions into the dispatch system.
// Follows the patrolMonitor.ts start/stop pattern.

import { getDb } from '../models/database';
import { broadcastUnitUpdate } from './websocket';
import { localNow } from './timeUtils';
import {
  getFleetLatest,
  isConfigured,
  isEnabled,
  getConfigValue,
  CONFIG_KEYS,
  type CpgFleetEvent,
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

async function pollFleetPositions(): Promise<void> {
  // Silently skip if not configured or not enabled
  if (!isConfigured() || !isEnabled()) return;

  const db = getDb();

  // Load active device-to-unit mappings
  const mappings = db.prepare(`
    SELECT m.id, m.cpg_device_id, m.unit_id
    FROM cpg_device_mappings m
    WHERE m.is_active = 1
  `).all() as { id: number; cpg_device_id: string; unit_id: number }[];

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
      road_name, nearest_intersection, recorded_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, NULL, ?)
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

      // Update unit position
      updateUnit.run(lat, lng, mapping.unit_id);

      // Get full unit info for breadcrumb + broadcast
      const unit = getUnitFull.get(mapping.unit_id) as any;
      if (!unit) continue;

      // Insert breadcrumb
      const recordedAt = ed.timestamp
        ? new Date(ed.timestamp).toISOString().replace('T', ' ').replace('Z', '')
        : now;

      insertBreadcrumb.run(
        mapping.unit_id, unit.officer_id || null,
        lat, lng,
        ed.heading ?? null, ed.speedMph ?? null,
        unit.status, unit.call_sign,
        unit.officer_name || null, unit.badge_number || null,
        unit.current_call_id || null, unit.call_number || null, unit.current_call_type || null,
        ed.address || null,
        recordedAt,
      );

      // Update sync time
      updateSyncTime.run(now, now, mapping.id);

      // Broadcast position update (same event as browser GPS)
      broadcastUnitUpdate({ action: 'unit_position_update', unit: { ...unit, latitude: lat, longitude: lng, gps_source: 'clearpathgps' } });

      updatedCount++;
    }
  });

  processEvents(events);

  if (updatedCount > 0) {
    console.log(`[ClearPathGPS] Updated ${updatedCount} unit(s)`);
  }
}
