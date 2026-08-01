// Nightly rollup: one immutable snapshot row per officer per day.
//
// Exposure (unit_trips) is already officer-attributed. Only dashcam events
// need attribution resolution — that asymmetry is why the denominator is
// trustworthy from day one while the numerator carries a confidence flag.

import { query, execute } from '../db';
import { log } from '../logger';
import { parseD1TimestampMs } from '../fleetio/sync';
import { resolveAttribution, type AssignmentWindow } from './attribution';
import { computeScore, SCORE_VERSION, type EventCounts } from './score';

const EMPTY_EVENTS = (): EventCounts => ({
  forwardCollision: 0, laneDeparture: 0, closeFollowing: 0,
  harshBrake: 0, harshAccel: 0, speeding: 0,
});

/** Maps raw ClearPath event labels onto our counted buckets. */
function bucketFor(rawType: string | null): keyof EventCounts | null {
  const t = (rawType || '').toLowerCase();
  if (t.includes('forward') || t.includes('fcw') || t.includes('collision')) return 'forwardCollision';
  if (t.includes('lane')) return 'laneDeparture';
  if (t.includes('following') || t.includes('headway')) return 'closeFollowing';
  if (t.includes('brak')) return 'harshBrake';
  if (t.includes('accel')) return 'harshAccel';
  if (t.includes('speed')) return 'speeding';
  return null;
}

const SEVERITY_OF: Record<keyof EventCounts, 'critical' | 'high' | 'moderate' | 'low'> = {
  forwardCollision: 'critical',
  harshBrake: 'high',
  closeFollowing: 'high',
  laneDeparture: 'moderate',
  speeding: 'moderate',
  harshAccel: 'low',
};

interface Acc {
  events: EventCounts;
  severity: { critical: number; high: number; moderate: number; low: number };
  recorded: number;
  inferred: number;
  miles: number;
  minutes: number;
  trips: number;
  fuelCost: number;
  fuelGallons: number;
  maintenanceCost: number;
  damageCost: number;
}

const newAcc = (): Acc => ({
  events: EMPTY_EVENTS(),
  severity: { critical: 0, high: 0, moderate: 0, low: 0 },
  recorded: 0, inferred: 0,
  miles: 0, minutes: 0, trips: 0,
  fuelCost: 0, fuelGallons: 0, maintenanceCost: 0, damageCost: 0,
});

const METERS_PER_MILE = 1609.344;

/**
 * Recompute one day. Idempotent — upserts on (officer_id, perf_date).
 *
 * A failure on one officer is logged and skipped; the batch continues. That
 * day then has NO snapshot, which is visible as a gap. It is never written
 * as a zero, because a zero-event day reads as good driving.
 */
export async function rollupDay(
  db: D1Database,
  perfDate: string,
): Promise<{ officersProcessed: number; failures: number }> {
  const dayStart = `${perfDate} 00:00:00`;
  const dayEnd = `${perfDate} 23:59:59`;

  // Assignment windows overlapping this day, for event attribution.
  const assignRows = await query<{ officer_id: number | null; unit_id: number | null; assigned_at: string | null; unassigned_at: string | null }>(
    db,
    `SELECT officer_id, unit_id, assigned_at, unassigned_at
       FROM fleet_assignments
      WHERE officer_id IS NOT NULL
        AND (assigned_at IS NULL OR assigned_at <= ?)
        AND (unassigned_at IS NULL OR unassigned_at >= ?)`,
    dayEnd, dayStart,
  );

  const windowsByUnit = new Map<number, AssignmentWindow[]>();
  for (const r of assignRows) {
    if (r.unit_id == null || r.officer_id == null) continue;
    const startMs = parseD1TimestampMs(r.assigned_at);
    if (startMs == null) continue;
    const list = windowsByUnit.get(r.unit_id) ?? [];
    list.push({ officerId: r.officer_id, startMs, endMs: parseD1TimestampMs(r.unassigned_at) });
    windowsByUnit.set(r.unit_id, list);
  }

  const acc = new Map<number, Acc>();
  const get = (id: number): Acc => {
    let a = acc.get(id);
    if (!a) { a = newAcc(); acc.set(id, a); }
    return a;
  };

  // ── Events (need attribution) ──
  const eventRows = await query<{ unit_id: number | null; officer_id: number | null; event_type: string | null; event_timestamp: string | null }>(
    db,
    `SELECT unit_id, officer_id, event_type, event_timestamp
       FROM dashcam_events
      WHERE event_timestamp >= ? AND event_timestamp <= ?`,
    dayStart, dayEnd,
  );

  for (const e of eventRows) {
    const bucket = bucketFor(e.event_type);
    if (!bucket) continue;
    const windows = e.unit_id != null ? (windowsByUnit.get(e.unit_id) ?? []) : [];
    const { officerId, source } = resolveAttribution(
      e.officer_id, parseD1TimestampMs(e.event_timestamp), windows,
    );
    if (officerId == null) continue; // unattributed: excluded from BOTH sides
    const a = get(officerId);
    a.events[bucket] += 1;
    a.severity[SEVERITY_OF[bucket]] += 1;
    if (source === 'recorded') a.recorded += 1; else a.inferred += 1;
  }

  // ── Exposure (already officer-attributed) ──
  const tripRows = await query<{ officer_id: number | null; distance_m: number | null; duration_s: number | null }>(
    db,
    `SELECT officer_id, distance_m, duration_s
       FROM unit_trips
      WHERE officer_id IS NOT NULL AND start_time >= ? AND start_time <= ?`,
    dayStart, dayEnd,
  );
  for (const t of tripRows) {
    if (t.officer_id == null) continue;
    const a = get(t.officer_id);
    a.miles += (t.distance_m ?? 0) / METERS_PER_MILE;
    a.minutes += (t.duration_s ?? 0) / 60;
    a.trips += 1;
  }

  // ── Cost, attributed through the same assignment windows (lens 4) ──
  // Displayed beside the safety score, never folded into it: a driver
  // assigned an older, thirstier vehicle must not score as unsafe.
  const fuelRows = await query<{ vehicle_id: number; total_cost: number | null; gallons: number | null }>(
    db,
    `SELECT vehicle_id, total_cost, gallons FROM fleet_fuel_log WHERE fuel_date = ?`,
    perfDate,
  );
  const vehicleOfficer = new Map<number, number>();
  const vehAssign = await query<{ vehicle_id: number; officer_id: number | null }>(
    db,
    `SELECT vehicle_id, officer_id FROM fleet_assignments
      WHERE officer_id IS NOT NULL
        AND (assigned_at IS NULL OR assigned_at <= ?)
        AND (unassigned_at IS NULL OR unassigned_at >= ?)`,
    dayEnd, dayStart,
  );
  for (const v of vehAssign) if (v.officer_id != null) vehicleOfficer.set(v.vehicle_id, v.officer_id);

  for (const f of fuelRows) {
    const officerId = vehicleOfficer.get(f.vehicle_id);
    if (officerId == null) continue;
    const a = get(officerId);
    a.fuelCost += f.total_cost ?? 0;
    a.fuelGallons += f.gallons ?? 0;
  }

  const maintRows = await query<{ vehicle_id: number; cost: number | null }>(
    db,
    `SELECT vehicle_id, cost FROM fleet_maintenance WHERE date(performed_at) = ?`,
    perfDate,
  );
  for (const m of maintRows) {
    const officerId = vehicleOfficer.get(m.vehicle_id);
    if (officerId == null) continue;
    get(officerId).maintenanceCost += m.cost ?? 0;
  }

  // ── Write snapshots ──
  let failures = 0;
  for (const [officerId, a] of acc) {
    try {
      const totalAttributed = a.recorded + a.inferred;
      const recordedPct = totalAttributed > 0 ? a.recorded / totalAttributed : 1;
      const inferredPct = totalAttributed > 0 ? a.inferred / totalAttributed : 0;
      const result = computeScore({ milesDriven: a.miles, events: a.events, recordedPct });
      const score = result.status === 'scored' ? result.score : null;

      await execute(
        db,
        `INSERT INTO driver_performance_daily (
           officer_id, perf_date, miles_driven, drive_minutes, trip_count,
           events_critical, events_high, events_moderate, events_low,
           events_forward_collision, events_lane_departure, events_close_following,
           events_harsh_brake, events_harsh_accel, events_speeding,
           attribution_recorded_pct, attribution_inferred_pct,
           fuel_cost, fuel_gallons, maintenance_cost, damage_cost,
           score, score_version, computed_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
         ON CONFLICT(officer_id, perf_date) DO UPDATE SET
           miles_driven=excluded.miles_driven, drive_minutes=excluded.drive_minutes,
           trip_count=excluded.trip_count,
           events_critical=excluded.events_critical, events_high=excluded.events_high,
           events_moderate=excluded.events_moderate, events_low=excluded.events_low,
           events_forward_collision=excluded.events_forward_collision,
           events_lane_departure=excluded.events_lane_departure,
           events_close_following=excluded.events_close_following,
           events_harsh_brake=excluded.events_harsh_brake,
           events_harsh_accel=excluded.events_harsh_accel,
           events_speeding=excluded.events_speeding,
           attribution_recorded_pct=excluded.attribution_recorded_pct,
           attribution_inferred_pct=excluded.attribution_inferred_pct,
           fuel_cost=excluded.fuel_cost, fuel_gallons=excluded.fuel_gallons,
           maintenance_cost=excluded.maintenance_cost, damage_cost=excluded.damage_cost,
           score=excluded.score, score_version=excluded.score_version,
           computed_at=datetime('now')`,
        officerId, perfDate, a.miles, a.minutes, a.trips,
        a.severity.critical, a.severity.high, a.severity.moderate, a.severity.low,
        a.events.forwardCollision, a.events.laneDeparture, a.events.closeFollowing,
        a.events.harshBrake, a.events.harshAccel, a.events.speeding,
        recordedPct, inferredPct,
        a.fuelCost, a.fuelGallons, a.maintenanceCost, a.damageCost,
        score, SCORE_VERSION,
      );
    } catch (err) {
      failures += 1;
      log.error('driver-performance rollup failed for officer', { officerId, perfDate }, err as Error);
    }
  }

  return { officersProcessed: acc.size, failures };
}
