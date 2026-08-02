// Nightly rollup: one immutable snapshot row per officer per day.
//
// EVENT SOURCE: `gps_breadcrumbs` (internal MDT capture). ClearPath's
// `dashcam_events` was the original source and was DROPPED — its credentials
// (clearpathgps_user/_password/_base_url) are absent from system_config, so
// getCredentials() returned null and the sync silently no-opped for weeks
// while `unit_trips` kept recording miles. That combination is the worst
// possible one for this feature: a live denominator over a dead numerator
// hands every officer a perfect 100/Excellent with no error anywhere.
//
// ATTRIBUTION IS NO LONGER INFERRED FOR THE NUMERATOR. `gps_breadcrumbs`
// carries `officer_id` STAMPED AT CAPTURE, so the assignment-window resolver
// (and the unattributed-doubt machinery that existed only because dashcam
// events lacked an officer) is gone from the event path. `attribution.ts` is
// retained — cost attribution still uses its distinct-officer reasoning.

import { query, execute, ensureDriverPerformanceColumns } from '../db';
import { log } from '../logger';
import { parseD1TimestampMs } from '../fleetio/sync';
import { denverDateStringToEpochMs } from '../denverTime';
import { deriveSpeedEvents, type SpeedSample, type SpeedEventCounts } from './speedEvents';
import { computeScore, SCORE_VERSION } from './score';

const EMPTY_EVENTS = (): SpeedEventCounts => ({
  speedHigh: 0, speedVeryHigh: 0, speedExtreme: 0,
});

/**
 * Speed tier → the snapshot's severity buckets. The severity columns predate
 * the speed rewrite and are still read by officer detail and the PDF, so they
 * are kept populated rather than left silently at zero.
 */
const SEVERITY_OF: Record<keyof SpeedEventCounts, 'critical' | 'high' | 'moderate' | 'low'> = {
  speedExtreme: 'critical',
  speedVeryHigh: 'high',
  speedHigh: 'moderate',
};

/**
 * ⚠️ `gps_breadcrumbs.speed` IS METERS PER SECOND, NOT MPH.
 *
 * It is written straight through from the W3C Geolocation `coords.speed`
 * (src/routes/dispatch/gps.ts), whose unit is m/s. Confirmed on live D1:
 * 210,333 non-null samples cliff hard at ~40 (89 mph) with a negligible tail —
 * the signature of m/s, not mph. Feeding the raw column into 70/80/90-mph
 * thresholds makes every threshold ~2.24x too high, nobody ever trips one,
 * and every officer scores a perfect 100 — the exact failure this rewrite
 * exists to eliminate. Convert here, once, at the only seam that reads it.
 */
const MPH_PER_MPS = 2.2369362921;

interface Acc {
  events: SpeedEventCounts;
  severity: { critical: number; high: number; moderate: number; low: number };
  /**
   * RAW GPS samples observed for this officer on this day, BEFORE the
   * emergency-response exclusion. This is what the dead-feed guard below
   * uses: 0 here with miles > 0 means the FEED produced nothing. It must
   * never be conflated with the post-exclusion count — an officer whose
   * entire day was lawful code-3 response also lands at 0 post-exclusion,
   * and that is a working feed on a legitimately unscoreable day, not a
   * dead one.
   */
  breadcrumbSamples: number;
  /** Of `breadcrumbSamples`, how many were excluded as emergency response. */
  excludedCallSamples: number;
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
  breadcrumbSamples: 0,
  excludedCallSamples: 0,
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
  // migration that fails to reach live D1 silently (deploy.yml's migration
  // step is continue-on-error) turns into a permanent gap: the cron only
  // trails 3 days, so once a failed day ages out of that window nothing ever
  // recomputes it again.
  await ensureDriverPerformanceColumns(db);

  // ⚠️ `perf_date` IS A DENVER OPERATIONAL DAY, not a UTC one.
  //
  // Rocky Mountain Protective Group operates in America/Denver, and every
  // timestamp in D1 is stored as UTC. Bucketing a UTC calendar day splits a
  // normal Denver evening shift across two rows: a shift starting 17:30 Denver
  // (23:30 UTC) with speeding at 19:00 Denver (01:00 UTC the NEXT day)
  // stored the whole trip's mileage on day 1 with zero events — a perfect
  // 100.0 in the daily trend — and the events alone on day 2 with ~0 miles.
  // The officer's worst shift rendered as his best day.
  //
  // So the Denver calendar day is defined first, and its UTC instant bounds are
  // derived from it (DST-aware via denverDateStringToEpochMs — never hardcode
  // -07:00). Those SAME bounds are then applied to breadcrumbs, trips, fuel AND
  // maintenance, so all four sides of the ratio describe one operational day.
  const dayStart = toSqlUtc(denverDateStringToEpochMs(perfDate, '00:00:00'));
  const dayEnd = toSqlUtc(denverDateStringToEpochMs(perfDate, '23:59:59'));

  const acc = new Map<number, Acc>();
  const get = (id: number): Acc => {
    let a = acc.get(id);
    if (!a) { a = newAcc(); acc.set(id, a); }
    return a;
  };

  // ── Events: directly-observed speed from MDT breadcrumbs ──
  //
  // ⚠️ BOUNDED AND NARROW BY DESIGN. `gps_breadcrumbs` is a 265k-row table
  // ingesting continuously; this query must never widen past one operational
  // day, and selects only the three columns the derivation actually reads.
  // ORDER BY officer_id, recorded_at gives deriveSpeedEvents the ascending
  // order it expects without a second in-memory sort per officer.
  // ⚠️ EMERGENCY-RESPONSE EXCLUSION. Patrol officers lawfully exceed posted
  // limits responding code-3 — a statutory exemption, not a violation. A
  // sample is excluded from event derivation when it carries `current_call_id`
  // (actively assigned to a call) OR `unit_status` in one of the active
  // response states. Vocabulary is the SAME string set the dispatch routes
  // already write/validate against (src/routes/dispatch/units.ts:320,
  // src/routes/dispatch/extensions.ts:480) — 'dispatched' (assigned, en
  // route to be en route), 'enroute' (actively driving to the call), and
  // 'onscene' (arrived, may still be maneuvering under call context). The
  // other statuses ('available', 'busy', 'off_duty', 'out_of_service',
  // 'on_patrol', 'unavailable') do not describe an active call response and
  // are left in scope.
  //
  // As of 2026-08-01 BOTH columns are populated in ZERO of 91,382 live
  // gps_breadcrumbs rows (see src/utils/driverPerformance/score.ts,
  // SCORING_ENABLED), so this filter excludes nothing today. That is
  // expected — it is not silently assumed to be working, it is measured and
  // logged below so the day the feed starts populating shows up as a visible
  // change in this count rather than as an unexplained score shift.
  const ACTIVE_RESPONSE_STATUSES = new Set(['dispatched', 'enroute', 'onscene']);

  const crumbRows = await query<{
    officer_id: number | null; recorded_at: string | null; speed: number | null;
    current_call_id: number | string | null; unit_status: string | null;
  }>(
    db,
    `SELECT officer_id, recorded_at, speed, current_call_id, unit_status
       FROM gps_breadcrumbs
      WHERE officer_id IS NOT NULL
        AND recorded_at >= ? AND recorded_at <= ?
      ORDER BY officer_id, recorded_at`,
    dayStart, dayEnd,
  );

  let excludedForCallContext = 0;
  const filteredCrumbRows = crumbRows.filter((r) => {
    const onCall = r.current_call_id != null
      || (typeof r.unit_status === 'string' && ACTIVE_RESPONSE_STATUSES.has(r.unit_status));
    if (onCall) excludedForCallContext += 1;
    return !onCall;
  });
  log.info('driver-performance rollup: emergency-response samples excluded from speed-event derivation', {
    perfDate,
    totalSamples: crumbRows.length,
    excludedForCallContext,
  });

  // RAW per-officer sample counts — BEFORE exclusion. This, not the
  // post-exclusion count, is what the dead-feed guard below must use: an
  // officer whose day was entirely code-3 has every sample excluded and
  // would otherwise land at 0, indistinguishable from a genuinely dead feed.
  const rawSamplesByOfficer = new Map<number, number>();
  for (const r of crumbRows) {
    if (r.officer_id == null) continue;
    rawSamplesByOfficer.set(r.officer_id, (rawSamplesByOfficer.get(r.officer_id) ?? 0) + 1);
  }
  for (const [officerId, count] of rawSamplesByOfficer) {
    get(officerId).breadcrumbSamples = count;
  }

  const samplesByOfficer = new Map<number, SpeedSample[]>();
  for (const r of filteredCrumbRows) {
    if (r.officer_id == null) continue;
    const ms = parseD1TimestampMs(r.recorded_at);
    if (ms == null) continue;
    const list = samplesByOfficer.get(r.officer_id) ?? [];
    list.push({
      recordedAtMs: ms,
      speedMph: typeof r.speed === 'number' && Number.isFinite(r.speed)
        ? r.speed * MPH_PER_MPS
        : null,
    });
    samplesByOfficer.set(r.officer_id, list);
  }

  for (const [officerId, list] of samplesByOfficer) {
    const a = get(officerId);
    a.excludedCallSamples = a.breadcrumbSamples - list.length;
    a.events = deriveSpeedEvents(list);
    for (const tier of Object.keys(a.events) as (keyof SpeedEventCounts)[]) {
      a.severity[SEVERITY_OF[tier]] += a.events[tier];
    }
  }
  // An officer whose RAW samples were ALL excluded never appears in
  // samplesByOfficer (the filtered list is empty), so excludedCallSamples
  // would be left at its 0 default despite every raw sample having been
  // excluded. Backfill from the raw count for exactly that case.
  for (const [officerId, rawCount] of rawSamplesByOfficer) {
    const a = get(officerId);
    if (!samplesByOfficer.has(officerId)) a.excludedCallSamples = rawCount;
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

  // ⚠️ DEAD-FEED DETECTION uses the RAW sample count, never the post-exclusion
  // one. Miles with zero RAW breadcrumb samples is the same class of failure
  // that made ClearPath unusable: the denominator kept flowing while the
  // numerator went silent, and silence scores 100. It is recorded on the
  // snapshot (breadcrumb_samples = 0), forces the day to be non-scoring via
  // computeScore, and is warned about here so the outage is visible in logs
  // rather than only inferable from a suspiciously clean roster.
  //
  // A SEPARATE, non-dead-feed case: raw samples > 0 but every one of them was
  // emergency response, so the post-exclusion count is 0. That is a working
  // feed on a day with nothing scoreable — the officer's driving is genuinely
  // unscoreable, but the INSTRUMENTATION is not at fault, and logging it as a
  // dead feed would send someone hunting for a broken MDT that works fine.
  const deadFeedOfficers = [...acc.entries()]
    .filter(([, a]) => a.miles > 0 && a.breadcrumbSamples === 0)
    .map(([officerId]) => officerId);
  if (deadFeedOfficers.length > 0) {
    log.warn('driver-performance rollup: trip miles with NO GPS breadcrumbs (dead feed) — day forced non-scoring', {
      perfDate,
      officerIds: deadFeedOfficers,
    });
  }
  const allEmergencyResponseOfficers = [...acc.entries()]
    .filter(([, a]) => a.breadcrumbSamples > 0 && a.excludedCallSamples === a.breadcrumbSamples)
    .map(([officerId]) => officerId);
  if (allEmergencyResponseOfficers.length > 0) {
    log.info('driver-performance rollup: every GPS sample this day was emergency response — feed is alive, day is unscoreable', {
      perfDate,
      officerIds: allEmergencyResponseOfficers,
    });
  }

  // ── Cost, attributed through assignment windows (lens 4) ──
  // Displayed beside the safety score, never folded into it: a driver
  // assigned an older, thirstier vehicle must not score as unsafe.
  // fleet_fuel_log.fuel_date is always written through normalizeToUtcTimestamp()
  // (src/routes/fleet.ts, src/routes/fleetio.ts), which returns a full
  // 'YYYY-MM-DD HH:MM:SS' UTC timestamp — even a date-only input becomes
  // Denver-midnight-as-UTC. Exact equality against a bare perfDate matches
  // nothing; use the same day-range bounds as the breadcrumb/trip queries.
  const fuelRows = await query<{ vehicle_id: number; total_cost: number | null; gallons: number | null }>(
    db,
    `SELECT vehicle_id, total_cost, gallons FROM fleet_fuel_log WHERE fuel_date >= ? AND fuel_date <= ?`,
    dayStart, dayEnd,
  );
  // Attribute a vehicle's cost only when exactly ONE distinct officer held it
  // during the day. A mid-shift swap means the vehicle covers two officers;
  // guessing which one owns the whole day's cost is an ambiguity we refuse to
  // resolve, so ambiguous vehicles are excluded from cost attribution entirely
  // (2+ DISTINCT officers -> excluded; repeated rows for the SAME officer are
  // not ambiguous).
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
    // Same Denver-derived UTC bounds as breadcrumbs/trips/fuel. `date(performed_at)`
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
      // Breadcrumbs carry officer_id STAMPED AT CAPTURE, so every event that
      // exists is recorded — there is no inference step left to be wrong about.
      // This is set from the actual data, not asserted: a day with no samples
      // has nothing recorded, and says so (0), rather than claiming 1.0 over
      // an empty set.
      const recordedPct = a.breadcrumbSamples > 0 ? 1 : 0;
      const inferredPct = 0;

      const result = computeScore({
        milesDriven: a.miles,
        events: a.events,
        recordedPct,
        breadcrumbSamples: a.breadcrumbSamples,
      });
      const score = result.status === 'scored' ? result.score : null;

      await execute(
        db,
        `INSERT INTO driver_performance_daily (
           officer_id, perf_date, miles_driven, drive_minutes, trip_count,
           events_critical, events_high, events_moderate, events_low,
           events_speed_high, events_speed_very_high, events_speed_extreme,
           breadcrumb_samples, excluded_call_samples,
           attribution_recorded_pct, attribution_inferred_pct,
           fuel_cost, fuel_gallons, maintenance_cost,
           score, score_version, computed_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
         ON CONFLICT(officer_id, perf_date) DO UPDATE SET
           miles_driven=excluded.miles_driven, drive_minutes=excluded.drive_minutes,
           trip_count=excluded.trip_count,
           events_critical=excluded.events_critical, events_high=excluded.events_high,
           events_moderate=excluded.events_moderate, events_low=excluded.events_low,
           events_speed_high=excluded.events_speed_high,
           events_speed_very_high=excluded.events_speed_very_high,
           events_speed_extreme=excluded.events_speed_extreme,
           breadcrumb_samples=excluded.breadcrumb_samples,
           excluded_call_samples=excluded.excluded_call_samples,
           attribution_recorded_pct=excluded.attribution_recorded_pct,
           attribution_inferred_pct=excluded.attribution_inferred_pct,
           fuel_cost=excluded.fuel_cost, fuel_gallons=excluded.fuel_gallons,
           maintenance_cost=excluded.maintenance_cost,
           score=excluded.score, score_version=excluded.score_version,
           computed_at=datetime('now')`,
        officerId, perfDate, a.miles, a.minutes, a.trips,
        a.severity.critical, a.severity.high, a.severity.moderate, a.severity.low,
        a.events.speedHigh, a.events.speedVeryHigh, a.events.speedExtreme,
        a.breadcrumbSamples, a.excludedCallSamples,
        recordedPct, inferredPct,
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
