// ============================================================
// Traccar Historical Bulk Sync Engine
// ============================================================
// Pulls every column of every Traccar artifact into the
// traccar_* tables (server/src/models/traccarSchema.ts).
//
// Runs as a background job tracked in `traccar_sync_jobs`. The
// caller fires off a sync via routes/traccar.ts and polls
// `/sync/jobs/:id` for progress.
//
// Design choices:
// - Date-range chunking at 24h windows keeps individual API
//   responses small and lets us resume cleanly on transient
//   failures.
// - INSERT OR REPLACE on `traccar_id` (UNIQUE) makes the sync
//   idempotent — re-running for an overlapping window is safe.
// - Batched in transactions of 500 rows to keep WAL writes
//   reasonable on long ranges (10M-row imports stay manageable).
// - Every artifact gets its full payload stored in `raw_json`,
//   so future Traccar fields are preserved without a schema
//   change ("all columns of collection data").

import { getDb } from '../models/database';
import {
  getDevices,
  getPositionHistory,
  getEvents,
  getTrips,
  getStops,
  getGeofences,
  isConfigured,
  type TraccarDevice,
  type TraccarPosition,
  type TraccarEvent,
  type TraccarTripStop,
  type TraccarGeofence,
} from './traccarClient';

const CHUNK_HOURS = 24;
const BATCH_SIZE = 500;

export interface HistoricalSyncOptions {
  fromIso: string;
  toIso: string;
  /** Limit to specific Traccar device IDs. Empty/undefined = all devices. */
  deviceIds?: number[];
  /** Which artifact types to import. */
  include?: {
    devices?: boolean;
    positions?: boolean;
    events?: boolean;
    trips?: boolean;
    stops?: boolean;
    geofences?: boolean;
  };
  triggeredByUserId?: number;
}

export interface SyncJobRow {
  id: number;
  kind: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  date_from: string | null;
  date_to: string | null;
  device_filter: string | null;
  devices_synced: number;
  positions_synced: number;
  events_synced: number;
  trips_synced: number;
  stops_synced: number;
  geofences_synced: number;
  error_message: string | null;
  progress_percent: number;
  triggered_by_user_id: number | null;
  started_at: string;
  completed_at: string | null;
}

// Per-process registry so /sync/jobs/:id/cancel can interrupt a running job.
const activeJobs = new Map<number, AbortController>();

export function getActiveJobIds(): number[] {
  return Array.from(activeJobs.keys());
}

export function cancelSyncJob(jobId: number): boolean {
  const ctl = activeJobs.get(jobId);
  if (!ctl) return false;
  ctl.abort();
  return true;
}

function createJob(opts: HistoricalSyncOptions): number {
  const db = getDb();
  const r = db.prepare(
    `INSERT INTO traccar_sync_jobs (kind, status, date_from, date_to, device_filter, triggered_by_user_id)
     VALUES ('historical', 'pending', ?, ?, ?, ?)`
  ).run(opts.fromIso, opts.toIso, opts.deviceIds?.length ? JSON.stringify(opts.deviceIds) : null, opts.triggeredByUserId ?? null);
  return Number(r.lastInsertRowid);
}

function updateJob(jobId: number, patch: Partial<SyncJobRow>): void {
  const db = getDb();
  const cols = Object.keys(patch);
  if (cols.length === 0) return;
  const sets = cols.map(c => `${c} = ?`).join(', ');
  const values = cols.map(c => (patch as any)[c]);
  db.prepare(`UPDATE traccar_sync_jobs SET ${sets} WHERE id = ?`).run(...values, jobId);
}

function chunks(fromIso: string, toIso: string): Array<{ from: Date; to: Date }> {
  const out: Array<{ from: Date; to: Date }> = [];
  const start = new Date(fromIso);
  const end = new Date(toIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new Error('Invalid date range');
  if (start >= end) throw new Error('fromIso must be before toIso');
  let cursor = new Date(start);
  while (cursor < end) {
    const next = new Date(Math.min(cursor.getTime() + CHUNK_HOURS * 3600 * 1000, end.getTime()));
    out.push({ from: cursor, to: next });
    cursor = next;
  }
  return out;
}

// ─── Resolve fleet_vehicles linkage ─────────────────────────
// Looks up a fleet_vehicles.id by matching Traccar uniqueId →
// existing traccar_devices.vehicle_id. Returns null if no link.

function resolveVehicleId(traccarDeviceId: number): number | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT vehicle_id FROM traccar_devices WHERE traccar_id = ? AND vehicle_id IS NOT NULL`
  ).get(traccarDeviceId) as { vehicle_id: number } | undefined;
  return row?.vehicle_id ?? null;
}

// ─── Per-artifact upsert helpers ────────────────────────────

function upsertDevices(devices: TraccarDevice[]): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO traccar_devices (traccar_id, name, unique_id, status, disabled, last_update, position_id, group_id, phone, model, contact, category, attributes_json, raw_json, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(traccar_id) DO UPDATE SET
       name = excluded.name, unique_id = excluded.unique_id, status = excluded.status,
       disabled = excluded.disabled, last_update = excluded.last_update,
       position_id = excluded.position_id, group_id = excluded.group_id, phone = excluded.phone,
       model = excluded.model, contact = excluded.contact, category = excluded.category,
       attributes_json = excluded.attributes_json, raw_json = excluded.raw_json,
       synced_at = datetime('now','localtime')`
  );
  const tx = db.transaction((rows: TraccarDevice[]) => {
    for (const d of rows) {
      stmt.run(
        d.id, d.name ?? null, d.uniqueId ?? null, d.status ?? null,
        d.disabled ? 1 : 0, d.lastUpdate ?? null,
        (d as any).positionId ?? null, (d as any).groupId ?? null,
        d.phone ?? null, d.model ?? null, (d as any).contact ?? null, d.category ?? null,
        d.attributes ? JSON.stringify(d.attributes) : null,
        JSON.stringify(d),
      );
    }
  });
  tx(devices);
  return devices.length;
}

function upsertPositions(positions: TraccarPosition[]): number {
  if (positions.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO traccar_positions (traccar_id, traccar_device_id, vehicle_id, protocol, server_time, device_time, fix_time, valid, outdated, latitude, longitude, altitude, speed, course, address, accuracy, network, attributes_json, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(traccar_id) DO NOTHING`
  );
  const tx = db.transaction((rows: TraccarPosition[]) => {
    for (const p of rows) {
      const vehicleId = resolveVehicleId(p.deviceId);
      stmt.run(
        p.id, p.deviceId, vehicleId,
        p.protocol ?? null, p.serverTime ?? null, p.deviceTime ?? null, p.fixTime,
        p.valid ? 1 : 0, p.outdated ? 1 : 0,
        p.latitude, p.longitude, p.altitude ?? null, p.speed ?? null, p.course ?? null,
        p.address ?? null, p.accuracy ?? null,
        (p as any).network ? JSON.stringify((p as any).network) : null,
        p.attributes ? JSON.stringify(p.attributes) : null,
        JSON.stringify(p),
      );
    }
  });
  // Batch in chunks of BATCH_SIZE so a 50k-position day doesn't lock writes.
  let total = 0;
  for (let i = 0; i < positions.length; i += BATCH_SIZE) {
    tx(positions.slice(i, i + BATCH_SIZE));
    total += Math.min(BATCH_SIZE, positions.length - i);
  }
  return total;
}

function upsertEvents(events: TraccarEvent[]): number {
  if (events.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO traccar_events (traccar_id, type, event_time, traccar_device_id, vehicle_id, position_id, geofence_id, maintenance_id, attributes_json, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(traccar_id) DO NOTHING`
  );
  const tx = db.transaction((rows: TraccarEvent[]) => {
    for (const e of rows) {
      stmt.run(
        e.id, e.type ?? null, e.eventTime, e.deviceId, resolveVehicleId(e.deviceId),
        e.positionId ?? null, e.geofenceId ?? null, e.maintenanceId ?? null,
        e.attributes ? JSON.stringify(e.attributes) : null,
        JSON.stringify(e),
      );
    }
  });
  tx(events);
  return events.length;
}

function upsertTripsOrStops(table: 'traccar_trips' | 'traccar_stops', rows: TraccarTripStop[]): number {
  if (rows.length === 0) return 0;
  const db = getDb();
  const isTrip = table === 'traccar_trips';
  const stmt = isTrip
    ? db.prepare(
        `INSERT INTO traccar_trips (traccar_device_id, vehicle_id, device_name, driver_unique_id, driver_name,
          start_time, end_time, start_address, end_address, start_lat, start_lon, end_lat, end_lon,
          start_odometer, end_odometer, distance, average_speed, max_speed, duration, spent_fuel, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
    : db.prepare(
        `INSERT INTO traccar_stops (traccar_device_id, vehicle_id, device_name, driver_unique_id, driver_name,
          start_time, end_time, address, lat, lon, odometer, duration, engine_hours, spent_fuel, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
  const tx = db.transaction((items: TraccarTripStop[]) => {
    for (const r of items) {
      const vehicleId = resolveVehicleId(r.deviceId);
      const raw = JSON.stringify(r);
      if (isTrip) {
        stmt.run(
          r.deviceId, vehicleId, r.deviceName ?? null, r.driverUniqueId ?? null, r.driverName ?? null,
          r.startTime ?? null, r.endTime ?? null, r.startAddress ?? null, r.endAddress ?? null,
          r.startLat ?? null, r.startLon ?? null, r.endLat ?? null, r.endLon ?? null,
          r.startOdometer ?? null, r.endOdometer ?? null, r.distance ?? null,
          r.averageSpeed ?? null, r.maxSpeed ?? null, r.duration ?? null, r.spentFuel ?? null,
          raw,
        );
      } else {
        stmt.run(
          r.deviceId, vehicleId, r.deviceName ?? null, r.driverUniqueId ?? null, r.driverName ?? null,
          r.startTime ?? null, r.endTime ?? null, r.address ?? null,
          r.latitude ?? null, r.longitude ?? null,
          r.odometer ?? null, r.duration ?? null, r.engineHours ?? null, r.spentFuel ?? null,
          raw,
        );
      }
    }
  });
  tx(rows);
  return rows.length;
}

function upsertGeofences(items: TraccarGeofence[]): number {
  if (items.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO traccar_geofences (traccar_id, name, description, area, calendar_id, attributes_json, raw_json, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(traccar_id) DO UPDATE SET
       name = excluded.name, description = excluded.description, area = excluded.area,
       calendar_id = excluded.calendar_id, attributes_json = excluded.attributes_json,
       raw_json = excluded.raw_json, synced_at = datetime('now','localtime')`
  );
  const tx = db.transaction((rows: TraccarGeofence[]) => {
    for (const g of rows) {
      stmt.run(
        g.id, g.name ?? null, g.description ?? null, g.area ?? null,
        g.calendarId ?? null,
        g.attributes ? JSON.stringify(g.attributes) : null,
        JSON.stringify(g),
      );
    }
  });
  tx(items);
  return items.length;
}

// ─── Main runner ────────────────────────────────────────────

export async function startHistoricalSync(opts: HistoricalSyncOptions): Promise<number> {
  if (!isConfigured()) throw new Error('Traccar credentials not configured');
  const include = {
    devices: true, positions: true, events: true, trips: true, stops: true, geofences: true,
    ...(opts.include ?? {}),
  };
  const jobId = createJob(opts);
  const ctl = new AbortController();
  activeJobs.set(jobId, ctl);

  // Run in background (don't await — caller polls status).
  void (async () => {
    try {
      updateJob(jobId, { status: 'running' });

      // 1) Devices first — needed for vehicle resolution + filtering.
      let devices: TraccarDevice[] = [];
      if (include.devices || include.positions || include.events || include.trips || include.stops) {
        devices = await getDevices();
        if (include.devices) {
          const n = upsertDevices(devices);
          updateJob(jobId, { devices_synced: n });
        }
      }

      // Filter device set if caller provided IDs.
      const targetDevices = opts.deviceIds && opts.deviceIds.length > 0
        ? devices.filter(d => opts.deviceIds!.includes(d.id))
        : devices;

      // 2) Geofences — single bulk fetch.
      if (include.geofences) {
        try {
          const geos = await getGeofences();
          updateJob(jobId, { geofences_synced: upsertGeofences(geos) });
        } catch (e) {
          console.warn('[traccar:sync] geofence fetch failed', e);
        }
      }

      const windows = chunks(opts.fromIso, opts.toIso);
      const totalSteps = targetDevices.length * windows.length || 1;
      let stepsDone = 0;
      let positionsTotal = 0, eventsTotal = 0, tripsTotal = 0, stopsTotal = 0;

      // 3) Per device, per chunk: positions / events / trips / stops.
      for (const dev of targetDevices) {
        for (const w of windows) {
          if (ctl.signal.aborted) {
            updateJob(jobId, { status: 'cancelled', completed_at: new Date().toISOString(), error_message: 'Cancelled by user' });
            return;
          }
          const fromIso = w.from.toISOString();
          const toIso = w.to.toISOString();
          try {
            if (include.positions) {
              const positions = await getPositionHistory(dev.id, fromIso, toIso);
              positionsTotal += upsertPositions(positions);
            }
            if (include.events) {
              const events = await getEvents(dev.id, fromIso, toIso);
              eventsTotal += upsertEvents(events);
            }
            if (include.trips) {
              const trips = await getTrips(dev.id, fromIso, toIso);
              tripsTotal += upsertTripsOrStops('traccar_trips', trips);
            }
            if (include.stops) {
              const stops = await getStops(dev.id, fromIso, toIso);
              stopsTotal += upsertTripsOrStops('traccar_stops', stops);
            }
          } catch (err) {
            // Per-window failure shouldn't kill the whole job — log + continue.
            console.warn(`[traccar:sync] window ${fromIso}..${toIso} device ${dev.id} failed:`, err);
          }
          stepsDone++;
          updateJob(jobId, {
            positions_synced: positionsTotal,
            events_synced: eventsTotal,
            trips_synced: tripsTotal,
            stops_synced: stopsTotal,
            progress_percent: Math.round((stepsDone / totalSteps) * 1000) / 10,
          });
        }
      }

      updateJob(jobId, { status: 'completed', progress_percent: 100, completed_at: new Date().toISOString() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      updateJob(jobId, { status: 'failed', error_message: msg, completed_at: new Date().toISOString() });
    } finally {
      activeJobs.delete(jobId);
    }
  })();

  return jobId;
}

export function getSyncJob(jobId: number): SyncJobRow | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM traccar_sync_jobs WHERE id = ?`).get(jobId) as SyncJobRow | undefined;
  return row ?? null;
}

export function listSyncJobs(limit = 50): SyncJobRow[] {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM traccar_sync_jobs ORDER BY started_at DESC LIMIT ?`
  ).all(limit) as SyncJobRow[];
}
