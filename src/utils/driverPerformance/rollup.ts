// Nightly rollup: one immutable snapshot row per officer per day.
//
// Exposure (unit_trips) is already officer-attributed. Only dashcam events
// need attribution resolution — that asymmetry is why the denominator is
// trustworthy from day one while the numerator carries a confidence flag.

import { query, execute, ensureDriverPerformanceColumns } from '../db';
import { log } from '../logger';
import { parseD1TimestampMs } from '../fleetio/sync';
import { denverDateStringToEpochMs } from '../denverTime';
import { resolveAttribution, type AssignmentWindow } from './attribution';
import { computeScore, SCORE_VERSION, type EventCounts } from './score';

const EMPTY_EVENTS = (): EventCounts => ({
  forwardCollision: 0, laneDeparture: 0, closeFollowing: 0,
  harshBrake: 0, harshAccel: 0, speeding: 0,
});

/**
 * Maps raw ClearPath event labels onto our counted buckets.
 *
 * ⚠️ Returning null is NOT "nothing happened" — it is "we saw a driving event
 * and do not know what it was". The caller must count it as doubt, never drop
 * it silently. ClearPath renaming "Harsh Braking" to "Hard Stop" would
 * otherwise make every such event vanish and every officer's score IMPROVE,
 * with no error anywhere.
 */
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
  /** Events on a unit this officer drove that could NOT be tied to a driver. */
  unattributed: number;
  miles: number;
  minutes: number;
  trips: number;
  fuelCost: number;
  fuelGallons: number;
  maintenanceCost: number;
}

const newAcc = (): Acc => ({
  events: EMPTY_EVENTS(),
  severity: { critical: 0, high: 0, moderate: 0, low: 0 },
  recorded: 0, inferred: 0, unattributed: 0,
  miles: 0, minutes: 0, trips: 0,
  fuelCost: 0, fuelGallons: 0, maintenanceCost: 0,
});

const METERS_PER_MILE = 1609.344;

/** Canonical D1 storage form: UTC, `YYYY-MM-DD HH:MM:SS`, matching `datetime('now')`. */
function toSqlUtc(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\..*$/, '');
}

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
  // Schema self-heal: covers EVERY caller (nightly cron, admin POST
  // /recompute, and any future one) from this single seam. Idempotent and
  // cached per-isolate (src/utils/db.ts), so the steady-state cost is one
  // PRAGMA check on a cold start — not a query per call. Without this, a
  // migration (e.g. 0222) that fails to reach live D1 silently (deploy.yml's
  // migration step is continue-on-error) turns into a permanent gap: the
  // cron only trails 3 days, so once a failed day ages out of that window
  // nothing ever recomputes it again.
  await ensureDriverPerformanceColumns(db);

  // ⚠️ `perf_date` IS A DENVER OPERATIONAL DAY, not a UTC one.
  //
  // Rocky Mountain Protective Group operates in America/Denver, and every
  // timestamp in D1 is stored as UTC. Bucketing a UTC calendar day splits a
  // normal Denver evening shift across two rows: a shift starting 17:30 Denver
  // (23:30 UTC) with harsh braking at 19:00 Denver (01:00 UTC the NEXT day)
  // stored the whole trip's mileage on day 1 with zero events — a perfect
  // 100.0 in the daily trend — and the events alone on day 2 with ~0 miles.
  // The officer's worst shift rendered as his best day.
  //
  // So the Denver calendar day is defined first, and its UTC instant bounds are
  // derived from it (DST-aware via denverDateStringToEpochMs — never hardcode
  // -07:00). Those SAME bounds are then applied to events, trips, fuel AND
  // maintenance, so all four sides of the ratio describe one operational day.
  //
  // Safe to change: no production snapshots exist yet.
  const dayStart = toSqlUtc(denverDateStringToEpochMs(perfDate, '00:00:00'));
  const dayEnd = toSqlUtc(denverDateStringToEpochMs(perfDate, '23:59:59'));

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

  // ⚠️ C1 — THE NUMERATOR AND THE DENOMINATOR MUST SHARE AN ATTRIBUTION SYSTEM.
  //
  // Events go through resolveAttribution (assignment windows keyed on the
  // NULLABLE fleet_assignments.unit_id). Miles come straight from
  // unit_trips.officer_id, which needs no attribution at all. When event
  // attribution failed, the events were dropped and the MILES SURVIVED — so an
  // officer who drove 900 miles and triggered 14 dashcam events (2 of them
  // forward-collision warnings) whose July assignment rows carried a NULL
  // officer_id was written as 900 miles / 0 events / recordedPct 1, rendered as
  // "100.0 · Excellent · 0 events · Recorded", and ranked ABOVE colleagues
  // whose events WERE attributable. The exposure floor cannot catch this: the
  // bug REQUIRES high mileage.
  //
  // The doubt is therefore counted per unit here, then (below) charged to the
  // officers who actually drove that unit that day, and finally forces the
  // day off "confidently clean". An honest "events exist that we could not tie
  // to a driver" always beats a reassuring score.
  const doubtByUnit = new Map<number, number>();
  let orphanDoubt = 0;            // doubt on an event with no unit at all
  const addDoubt = (unitId: number | null) => {
    if (unitId == null) { orphanDoubt += 1; return; }
    doubtByUnit.set(unitId, (doubtByUnit.get(unitId) ?? 0) + 1);
  };
  let unmatchedCount = 0;         // I1: events whose label we did not recognize
  const unmatchedLabels = new Set<string>();

  for (const e of eventRows) {
    const bucket = bucketFor(e.event_type);
    if (!bucket) {
      // I1: an unrecognized label is a KNOWN-UNKNOWN, not an absence. Count it,
      // remember the distinct label for one warning per rollup (not one per
      // event — a renamed ClearPath label would emit thousands), and charge it
      // to the same doubt pool as an unattributed event.
      unmatchedCount += 1;
      unmatchedLabels.add((e.event_type ?? '(null)').slice(0, 80));
      addDoubt(e.unit_id);
      continue;
    }
    const windows = e.unit_id != null ? (windowsByUnit.get(e.unit_id) ?? []) : [];
    const { officerId, source } = resolveAttribution(
      e.officer_id, parseD1TimestampMs(e.event_timestamp), windows,
    );
    if (officerId == null) { addDoubt(e.unit_id); continue; }
    const a = get(officerId);
    a.events[bucket] += 1;
    a.severity[SEVERITY_OF[bucket]] += 1;
    if (source === 'recorded') a.recorded += 1; else a.inferred += 1;
  }

  if (unmatchedCount > 0) {
    log.warn('driver-performance rollup saw unrecognized dashcam event labels', {
      perfDate,
      unmatchedCount,
      distinctLabels: [...unmatchedLabels].sort(),
    });
  }
  if (orphanDoubt > 0) {
    log.warn('driver-performance rollup saw events with no unit, chargeable to no driver', {
      perfDate, orphanDoubt,
    });
  }

  // ── Exposure (already officer-attributed) ──
  // `unit_id` is selected as well: it is the ONLY link back from a driver to
  // the vehicle whose unattributed events must be charged to them (verified
  // against migrations/0075_unit_trips.sql — unit_trips.unit_id INTEGER NOT NULL).
  const tripRows = await query<{ officer_id: number | null; unit_id: number | null; distance_m: number | null; duration_s: number | null }>(
    db,
    `SELECT officer_id, unit_id, distance_m, duration_s
       FROM unit_trips
      WHERE officer_id IS NOT NULL AND start_time >= ? AND start_time <= ?`,
    dayStart, dayEnd,
  );
  const driversOfUnit = new Map<number, Set<number>>();
  for (const t of tripRows) {
    if (t.officer_id == null) continue;
    const a = get(t.officer_id);
    a.miles += (t.distance_m ?? 0) / METERS_PER_MILE;
    a.minutes += (t.duration_s ?? 0) / 60;
    a.trips += 1;
    if (t.unit_id != null) {
      const set = driversOfUnit.get(t.unit_id) ?? new Set<number>();
      set.add(t.officer_id);
      driversOfUnit.set(t.unit_id, set);
    }
  }

  // Charge each unit's doubt to EVERY officer who drove it that day. When two
  // officers shared a unit we cannot say whose event it was — which is exactly
  // why it is unattributed — so both carry the doubt. Doubt is never scored;
  // it only downgrades confidence and is reported as its own number, so
  // charging it twice overstates uncertainty rather than blame.
  for (const [unitId, count] of doubtByUnit) {
    const drivers = driversOfUnit.get(unitId);
    if (!drivers || drivers.size === 0) continue; // nobody drove it: no one to warn
    for (const officerId of drivers) get(officerId).unattributed += count;
  }

  // ── Cost, attributed through the same assignment windows (lens 4) ──
  // Displayed beside the safety score, never folded into it: a driver
  // assigned an older, thirstier vehicle must not score as unsafe.
  // fleet_fuel_log.fuel_date is always written through normalizeToUtcTimestamp()
  // (src/routes/fleet.ts, src/routes/fleetio.ts), which returns a full
  // 'YYYY-MM-DD HH:MM:SS' UTC timestamp — even a date-only input becomes
  // Denver-midnight-as-UTC. Exact equality against a bare perfDate matches
  // nothing; use the same half-open day-range bounds as the event/trip queries.
  const fuelRows = await query<{ vehicle_id: number; total_cost: number | null; gallons: number | null }>(
    db,
    `SELECT vehicle_id, total_cost, gallons FROM fleet_fuel_log WHERE fuel_date >= ? AND fuel_date <= ?`,
    dayStart, dayEnd,
  );
  // Attribute a vehicle's cost only when exactly ONE distinct officer held it
  // during the day. A mid-shift swap means the vehicle covers two officers;
  // guessing which one owns the whole day's cost is exactly the ambiguity
  // resolveAttribution refuses to resolve for events, so cost follows the
  // same rule — ambiguous vehicles are excluded from cost attribution
  // entirely (2+ DISTINCT officers -> null/excluded; repeated rows for the
  // SAME officer are not ambiguous).
  const vehicleOfficers = new Map<number, Set<number>>();
  const vehAssign = await query<{ vehicle_id: number; officer_id: number | null }>(
    db,
    `SELECT vehicle_id, officer_id FROM fleet_assignments
      WHERE officer_id IS NOT NULL
        AND (assigned_at IS NULL OR assigned_at <= ?)
        AND (unassigned_at IS NULL OR unassigned_at >= ?)`,
    dayEnd, dayStart,
  );
  for (const v of vehAssign) {
    if (v.officer_id == null) continue;
    const set = vehicleOfficers.get(v.vehicle_id) ?? new Set<number>();
    set.add(v.officer_id);
    vehicleOfficers.set(v.vehicle_id, set);
  }
  const vehicleOfficer = new Map<number, number>();
  for (const [vehicleId, officers] of vehicleOfficers) {
    if (officers.size === 1) vehicleOfficer.set(vehicleId, [...officers][0]);
  }

  for (const f of fuelRows) {
    const officerId = vehicleOfficer.get(f.vehicle_id);
    if (officerId == null) continue;
    const a = get(officerId);
    a.fuelCost += f.total_cost ?? 0;
    a.fuelGallons += f.gallons ?? 0;
  }

  const maintRows = await query<{ vehicle_id: number; cost: number | null }>(
    db,
    // Same Denver-derived UTC bounds as events/trips/fuel. `date(performed_at)`
    // would have bucketed on the UTC calendar day, putting a Denver-evening
    // service record on the following operational day.
    `SELECT vehicle_id, cost FROM fleet_maintenance WHERE performed_at >= ? AND performed_at <= ?`,
    dayStart, dayEnd,
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
      // ⚠️ Do NOT default recordedPct to 1 on an empty set. `1` is an
      // assertion that every event was recorded at capture; over zero events
      // that is a confident claim about nothing, and it is precisely how the
      // C1 officer above earned a "Recorded" badge for a day whose events had
      // all failed attribution. When there is doubt and nothing attributed,
      // the day is INFERRED. Only a day with neither attributed events nor
      // doubt — genuinely nothing to be uncertain about — stays at 1.
      const totalAttributed = a.recorded + a.inferred;
      let recordedPct: number;
      let inferredPct: number;
      if (totalAttributed > 0) {
        recordedPct = a.recorded / totalAttributed;
        inferredPct = a.inferred / totalAttributed;
      } else if (a.unattributed > 0) {
        recordedPct = 0;
        inferredPct = 1;
      } else {
        recordedPct = 1;
        inferredPct = 0;
      }
      const result = computeScore({ milesDriven: a.miles, events: a.events, recordedPct });
      const score = result.status === 'scored' ? result.score : null;

      await execute(
        db,
        `INSERT INTO driver_performance_daily (
           officer_id, perf_date, miles_driven, drive_minutes, trip_count,
           events_critical, events_high, events_moderate, events_low,
           events_forward_collision, events_lane_departure, events_close_following,
           events_harsh_brake, events_harsh_accel, events_speeding,
           attribution_recorded_pct, attribution_inferred_pct, unattributed_events,
           fuel_cost, fuel_gallons, maintenance_cost,
           score, score_version, computed_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
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
           unattributed_events=excluded.unattributed_events,
           fuel_cost=excluded.fuel_cost, fuel_gallons=excluded.fuel_gallons,
           maintenance_cost=excluded.maintenance_cost,
           score=excluded.score, score_version=excluded.score_version,
           computed_at=datetime('now')`,
        officerId, perfDate, a.miles, a.minutes, a.trips,
        a.severity.critical, a.severity.high, a.severity.moderate, a.severity.low,
        a.events.forwardCollision, a.events.laneDeparture, a.events.closeFollowing,
        a.events.harshBrake, a.events.harshAccel, a.events.speeding,
        recordedPct, inferredPct, a.unattributed,
        a.fuelCost, a.fuelGallons, a.maintenanceCost,
        score, SCORE_VERSION,
      );
    } catch (err) {
      failures += 1;
      log.error('driver-performance rollup failed for officer', { officerId, perfDate }, err as Error);
    }
  }

  return { officersProcessed: acc.size, failures };
}
