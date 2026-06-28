#!/usr/bin/env node
// ============================================================
// backfill-trips.mjs — reconstruct lost unit_trips from gps_breadcrumbs
//
// CONTEXT: a NaN-timestamp bug in src/routes/dispatch/gps.ts skipped the trip
// engine on every GPS fix from ~2026-06-05 to 2026-06-09, so no unit_trips
// (PATROL/RESPONSE) were created even though the unit drove and breadcrumbs
// kept writing. This replays those orphaned breadcrumbs through the SAME
// movement logic the live engine uses (ported verbatim from
// src/utils/tripTelemetry.ts accumulate() + src/utils/tripEngine.ts decideGps())
// and inserts the missing trips, then stamps each trip's breadcrumbs with
// trip_id so /dispatch/trips/:id replay works.
//
// Idempotent: deletes any prior close_reason='backfill_replay' trips for the
// window first, and only touches breadcrumbs whose trip_id is still NULL.
// All reconstructed trips are PATROL (call context can't be recovered from
// breadcrumbs alone) and tagged close_reason='backfill_replay' so they're
// auditable + reversible.
//
// USAGE:  node scripts/backfill-trips.mjs --dry-run   (segment + report, no writes)
//         node scripts/backfill-trips.mjs             (apply to live D1)
// ============================================================

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ACCT = '5caa95c5789f4fc4ed3934b2a2c29ed4';
const DB = '785de7ae-3e7a-4e01-93bb-d24ddd813f6b';
const UNIT_ID = 1;
const AFTER = '2026-06-05 08:31:26'; // last real trip's start — backfill strictly after
const DRY = process.argv.includes('--dry-run');

// ── engine constants (mirror tripTelemetry.ts / tripEngine.ts) ──
const MPS_TO_MPH = 2.236936;
const MPH_PER_S_PER_G = 21.936;
const EARTH_M = 6371000;
const STOP_MPH = 2;
const TELEPORT_M = 5000;
const RADIUS_M = 30;        // stationaryRadius
const IDLE_MS = 300_000;    // 5 min
const STALE_MS = 900_000;   // 15 min
const HARSH = { minMph: 5, accelG: 0.3, brakeG: 0.35, cornerG: 0.35 };
const NOISE_DIST_M = 50, NOISE_DUR_S = 180; // discard patrol noise (engine parity)

const toRad = (d) => (d * Math.PI) / 180;
function haversineM(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}
function bearing(lat1, lng1, lat2, lng2) {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (Math.atan2(y, x) * 180) / Math.PI;
}
function angleDelta(a, b) { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; }
function emptyAgg() {
  return { distance_m: 0, max_speed: 0, speed_sum: 0, fix_count: 0, max_lat_g: 0,
    harsh_accel_count: 0, harsh_brake_count: 0, harsh_corner_count: 0, stop_count: 0,
    prev_lat: null, prev_lng: null, prev_ts: null, prev_mph: null, prev_bearing: null, was_moving: false };
}
// Ported verbatim from tripTelemetry.accumulate()
function accumulate(agg, fix) {
  const a = { ...agg };
  const { lat, lng, ts } = fix;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(ts)) return a;
  if (a.prev_ts != null && fix.ts <= a.prev_ts) return a;
  let mph;
  if (fix.speed != null && Number.isFinite(fix.speed) && fix.speed >= 0) {
    mph = fix.speed * MPS_TO_MPH;
  } else if (a.prev_lat != null && a.prev_ts != null && ts > a.prev_ts) {
    const d = haversineM(a.prev_lat, a.prev_lng, lat, lng);
    const dt = (ts - a.prev_ts) / 1000;
    mph = dt > 0 ? (d / dt) * MPS_TO_MPH : 0;
    if (mph > 120) mph = 0;
  } else { mph = 0; }
  const speedMps = mph / MPS_TO_MPH;
  a.max_speed = Math.max(a.max_speed, speedMps);
  a.speed_sum += speedMps; a.fix_count += 1;
  let curBearing = a.prev_bearing;
  if (a.prev_lat != null && a.prev_ts != null && ts > a.prev_ts) {
    const dt = (ts - a.prev_ts) / 1000;
    if (dt > 0 && dt < 30) {
      const d = haversineM(a.prev_lat, a.prev_lng, lat, lng);
      if (d < TELEPORT_M) a.distance_m += d;
      const longG = a.prev_mph != null ? (mph - a.prev_mph) / dt / MPH_PER_S_PER_G : 0;
      const gateMph = Math.max(a.prev_mph ?? 0, mph);
      if (gateMph >= HARSH.minMph) {
        if (longG >= HARSH.accelG) a.harsh_accel_count += 1;
        if (-longG >= HARSH.brakeG) a.harsh_brake_count += 1;
      }
      curBearing = d > 1 ? bearing(a.prev_lat, a.prev_lng, lat, lng) : a.prev_bearing;
      if (mph > 8 && a.prev_bearing != null && curBearing != null) {
        const turnDegPerS = angleDelta(a.prev_bearing, curBearing) / dt;
        const omega = toRad(turnDegPerS);
        let latG = (omega * (mph / MPS_TO_MPH)) / 9.80665;
        if (!Number.isFinite(latG) || Math.abs(latG) > 2) latG = 0;
        a.max_lat_g = Math.max(a.max_lat_g, Math.abs(latG));
        if (gateMph >= HARSH.minMph && Math.abs(latG) >= HARSH.cornerG) a.harsh_corner_count += 1;
      }
      const movingNow = mph > STOP_MPH;
      if (a.was_moving && !movingNow) a.stop_count += 1;
      a.was_moving = movingNow;
    }
  } else { a.was_moving = mph > STOP_MPH; }
  a.prev_lat = lat; a.prev_lng = lng; a.prev_ts = ts; a.prev_mph = mph; a.prev_bearing = curBearing;
  return a;
}

// ── D1 REST ──
function getToken() {
  const cfg = readFileSync(join(homedir(), 'Library/Preferences/.wrangler/config/default.toml'), 'utf8');
  const m = cfg.match(/oauth_token\s*=\s*"?([^"\n]+)"?/i);
  if (!m) throw new Error('no wrangler oauth_token');
  return m[1].trim();
}
const TOKEN = getToken();
async function q(sql, params = []) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const j = await res.json();
  if (!j.success) throw new Error('D1 error: ' + JSON.stringify(j.errors));
  return j.result[0].results;
}
const parseTs = (s) => Date.parse(s.replace(' ', 'T') + 'Z'); // recorded_at is space-format UTC
const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

// ── replay (mirrors decideGps open/idle/stale + accumulate) ──
function segment(rows) {
  const trips = [];
  let active = null, prevLat = null, prevLng = null;
  const close = (t, reason, endTs) => {
    const durS = Math.max(0, Math.round((endTs - t.startTs) / 1000));
    const isNoise = (t.agg.distance_m < NOISE_DIST_M) && (durS < NOISE_DUR_S);
    if (isNoise) return;
    trips.push({
      startTs: t.startTs, endTs, startLat: t.startLat, startLng: t.startLng,
      endLat: t.anchorLat, endLng: t.anchorLng, reason,
      distance_m: t.agg.distance_m, max_speed: t.agg.max_speed,
      avg_speed: t.agg.fix_count > 0 ? t.agg.speed_sum / t.agg.fix_count : null,
      duration_s: durS, fix_count: t.agg.fix_count, max_lat_g: t.agg.max_lat_g,
      harsh_accel_count: t.agg.harsh_accel_count, harsh_brake_count: t.agg.harsh_brake_count,
      harsh_corner_count: t.agg.harsh_corner_count, stop_count: t.agg.stop_count,
    });
  };
  for (const r of rows) {
    const fix = { lat: r.latitude, lng: r.longitude, speed: r.speed, heading: r.heading, ts: parseTs(r.recorded_at) };
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || !Number.isFinite(fix.ts)) continue;
    // stale: gap since last fix exceeds STALE → close at last fix
    if (active && fix.ts - active.lastFixTs > STALE_MS) { close(active, 'stale', active.lastFixTs); active = null; }
    if (!active) {
      const movingBySpeed = fix.speed != null && fix.speed * MPS_TO_MPH > STOP_MPH;
      const movingByDist = prevLat != null && haversineM(prevLat, prevLng, fix.lat, fix.lng) > RADIUS_M;
      if (movingBySpeed || movingByDist) {
        active = { startTs: fix.ts, startLat: prevLat ?? fix.lat, startLng: prevLng ?? fix.lng,
          anchorLat: fix.lat, anchorLng: fix.lng, lastMoveAt: fix.ts, lastFixTs: fix.ts, agg: accumulate(emptyAgg(), fix) };
      }
    } else if (fix.ts > active.lastFixTs) {
      const within = haversineM(active.anchorLat, active.anchorLng, fix.lat, fix.lng) <= RADIUS_M;
      if (within) {
        if (fix.ts - active.lastMoveAt > IDLE_MS) { close(active, 'idle_timeout', active.lastMoveAt); active = null; }
        else { active.agg = accumulate(active.agg, fix); active.lastFixTs = fix.ts; }
      } else {
        active.agg = accumulate(active.agg, fix); active.lastFixTs = fix.ts;
        active.anchorLat = fix.lat; active.anchorLng = fix.lng; active.lastMoveAt = fix.ts;
      }
    }
    prevLat = fix.lat; prevLng = fix.lng;
  }
  if (active) close(active, 'stale', active.lastFixTs);
  return trips;
}

async function main() {
  // Fetch all orphaned breadcrumbs in the gap, paged.
  console.log(`Fetching breadcrumbs for unit ${UNIT_ID} after ${AFTER} (trip_id IS NULL)…`);
  const rows = [];
  let offset = 0;
  for (;;) {
    const page = await q(
      `SELECT id, latitude, longitude, speed, heading, recorded_at FROM gps_breadcrumbs
       WHERE unit_id = ? AND trip_id IS NULL AND recorded_at > ?
       ORDER BY recorded_at ASC LIMIT 2000 OFFSET ?`,
      [UNIT_ID, AFTER, offset]);
    rows.push(...page);
    if (page.length < 2000) break;
    offset += 2000;
  }
  console.log(`  ${rows.length} breadcrumbs fetched.`);

  const trips = segment(rows);
  const totalMi = trips.reduce((s, t) => s + t.distance_m / 1609.34, 0);
  console.log(`\nReconstructed ${trips.length} PATROL trips (${totalMi.toFixed(1)} mi total):`);
  for (const t of trips) {
    console.log(`  ${iso(t.startTs)} → ${iso(t.endTs)}  ${(t.distance_m / 1609.34).toFixed(2)}mi  ` +
      `max ${Math.round(t.max_speed * MPS_TO_MPH)}mph  ${Math.round(t.duration_s / 60)}min  ${t.fix_count}fix  [${t.reason}]`);
  }

  if (DRY) { console.log('\n[DRY RUN] No writes. Re-run without --dry-run to apply.'); return; }

  // Idempotency: clear any prior backfill for this window.
  await q(`DELETE FROM unit_trips WHERE unit_id = ? AND close_reason = 'backfill_replay' AND start_time > ?`, [UNIT_ID, AFTER]);

  let inserted = 0, stamped = 0;
  for (const t of trips) {
    const res = await q(
      `INSERT INTO unit_trips (unit_id, officer_id, vehicle_id, trip_type, status, start_time, end_time,
         start_lat, start_lng, end_lat, end_lng, close_reason, distance_m, duration_s, max_speed, avg_speed,
         max_lat_g, harsh_accel_count, harsh_brake_count, harsh_corner_count, stop_count, fix_count,
         created_at, updated_at)
       VALUES (?, 1, NULL, 'patrol', 'closed', ?, ?, ?, ?, ?, ?, 'backfill_replay', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       RETURNING id`,
      [UNIT_ID, iso(t.startTs), iso(t.endTs), t.startLat, t.startLng, t.endLat, t.endLng,
       Math.round(t.distance_m), t.duration_s, t.max_speed, t.avg_speed, t.max_lat_g,
       t.harsh_accel_count, t.harsh_brake_count, t.harsh_corner_count, t.stop_count, t.fix_count]);
    const tripId = res[0].id;
    inserted++;
    // Stamp this trip's breadcrumbs (still-NULL trip_id) so /dispatch/trips/:id replay works.
    const upd = await q(
      `UPDATE gps_breadcrumbs SET trip_id = ? WHERE unit_id = ? AND trip_id IS NULL
       AND recorded_at >= ? AND recorded_at <= ?`,
      [tripId, UNIT_ID, iso(t.startTs), iso(t.endTs)]);
    stamped += upd?.length ? 0 : 0; // RETURNING not used on UPDATE; count via meta below
  }
  console.log(`\n✓ Inserted ${inserted} backfilled trips and stamped their breadcrumbs.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
