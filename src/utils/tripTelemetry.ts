// src/utils/tripTelemetry.ts
// Incremental, pure telemetry accumulator for unit_trips. One fix at a time,
// state carried on TripAgg (because the cron-swept engine is stateless across
// HTTP requests). The constants + thresholds MIRROR
// client/src/pages/navigation/vehicleTelemetry.ts (HARSH, MPS_TO_MPH, etc.) —
// keep them in sync; the two trees share no build so this is a deliberate dup.

const MPS_TO_MPH = 2.236936;
const MPH_PER_S_PER_G = 21.936; // 1 g = 9.80665 m/s² = 21.936 mph/s
const EARTH_M = 6371000;
const STOP_MPH = 2;             // at/below = stopped
const TELEPORT_M = 5000;        // ignore distance jumps beyond this (bad fix)

// LE-driver tuned (mirror of vehicleTelemetry.HARSH). g magnitudes (≥0).
export const HARSH = {
  minMph: 5,
  accelG: 0.3,
  brakeG: 0.35,
  cornerG: 0.35,
};

const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (Math.atan2(y, x) * 180) / Math.PI; // -180..180
}

function angleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export interface IncomingFix {
  lat: number; lng: number;
  speed: number | null;   // m/s, device value or null
  heading: number | null; // unused (we derive bearing); kept for parity
  ts: number;             // epoch ms (server-derived)
}

export interface TripAgg {
  distance_m: number;
  max_speed: number;   // m/s
  speed_sum: number;   // m/s
  fix_count: number;
  max_lat_g: number;
  harsh_accel_count: number;
  harsh_brake_count: number;
  harsh_corner_count: number;
  stop_count: number;
  prev_lat: number | null;
  prev_lng: number | null;
  prev_ts: number | null;     // epoch ms
  prev_mph: number | null;
  prev_bearing: number | null;
  was_moving: boolean;
}

export function emptyAgg(): TripAgg {
  return {
    distance_m: 0, max_speed: 0, speed_sum: 0, fix_count: 0, max_lat_g: 0,
    harsh_accel_count: 0, harsh_brake_count: 0, harsh_corner_count: 0, stop_count: 0,
    prev_lat: null, prev_lng: null, prev_ts: null, prev_mph: null,
    prev_bearing: null, was_moving: false,
  };
}

/** Fold one fix into the running aggregate. Pure: returns a new TripAgg. */
export function accumulate(agg: TripAgg, fix: IncomingFix): TripAgg {
  const a: TripAgg = { ...agg };
  const { lat, lng, ts } = fix;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(ts)) return a;

  let mph: number;
  if (fix.speed != null && Number.isFinite(fix.speed) && fix.speed >= 0) {
    mph = fix.speed * MPS_TO_MPH;
  } else if (a.prev_lat != null && a.prev_ts != null && ts > a.prev_ts) {
    const d = haversineM(a.prev_lat, a.prev_lng!, lat, lng);
    const dt = (ts - a.prev_ts) / 1000;
    mph = dt > 0 ? (d / dt) * MPS_TO_MPH : 0;
    if (mph > 120) mph = 0; // teleport spike
  } else {
    mph = 0;
  }

  const speedMps = mph / MPS_TO_MPH;
  a.max_speed = Math.max(a.max_speed, speedMps);
  a.speed_sum += speedMps;
  a.fix_count += 1;

  let curBearing: number | null = a.prev_bearing;
  if (a.prev_lat != null && a.prev_ts != null && ts > a.prev_ts) {
    const dt = (ts - a.prev_ts) / 1000;
    if (dt > 0 && dt < 30) {
      const d = haversineM(a.prev_lat, a.prev_lng!, lat, lng);
      if (d < TELEPORT_M) a.distance_m += d;

      const longG = a.prev_mph != null ? (mph - a.prev_mph) / dt / MPH_PER_S_PER_G : 0;
      const gateMph = Math.max(a.prev_mph ?? 0, mph);
      if (gateMph >= HARSH.minMph) {
        if (longG >= HARSH.accelG) a.harsh_accel_count += 1;
        if (-longG >= HARSH.brakeG) a.harsh_brake_count += 1;
      }

      curBearing = d > 1 ? bearing(a.prev_lat, a.prev_lng!, lat, lng) : a.prev_bearing;
      if (mph > 8 && a.prev_bearing != null && curBearing != null) {
        const turnDegPerS = angleDelta(a.prev_bearing, curBearing) / dt;
        const omega = toRad(turnDegPerS);
        const vMs = mph / MPS_TO_MPH;
        let latG = (omega * vMs) / 9.80665;
        if (!Number.isFinite(latG) || Math.abs(latG) > 2) latG = 0;
        a.max_lat_g = Math.max(a.max_lat_g, Math.abs(latG));
        if (gateMph >= HARSH.minMph && Math.abs(latG) >= HARSH.cornerG) a.harsh_corner_count += 1;
      }

      const movingNow = mph > STOP_MPH;
      if (a.was_moving && !movingNow) a.stop_count += 1;
      a.was_moving = movingNow;
    }
  } else {
    a.was_moving = mph > STOP_MPH;
  }

  a.prev_lat = lat; a.prev_lng = lng; a.prev_ts = ts; a.prev_mph = mph;
  a.prev_bearing = curBearing;
  return a;
}
