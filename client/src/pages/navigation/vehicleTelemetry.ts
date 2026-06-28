// ============================================================
// Vehicle telemetry engine — turns the raw GPS track into a rich
// movement report for the NAVIGATE screen's "TRIP" drawer.
//
// WHY this exists: device `speed` is null on cellular/WiFi positioning
// (only a true GPS chip reports instantaneous speed-over-ground), so the
// stock dashboard shows "awaiting speed…" in most vehicles. Everything
// here DERIVES motion from consecutive fix positions + timestamps, so
// speed / acceleration / cornering work on any device that gets a fix.
//
// Pure + framework-free (no React, no DOM) → unit-testable; the drawer
// just renders what buildMovementReport() returns.
// ============================================================

/** One accepted GPS fix, as returned by useGpsTracking().getCapturedTrack().
 *  Typed structurally so we don't depend on the hook's internal QueuedPoint. */
export interface FixPoint {
  lat: number;
  lng: number;
  /** device speed in m/s, or null when the platform can't measure it */
  speed: number | null;
  /** device heading in degrees (0–360), or null */
  heading: number | null;
  accuracy: number | null;
  /** ISO 8601 timestamp of the fix */
  timestamp: string;
}

export type DrivingEventKind = 'accel' | 'brake' | 'corner';

export interface DrivingEvent {
  kind: DrivingEventKind;
  /** 1 = notable, 2 = aggressive, 3 = severe */
  severity: 1 | 2 | 3;
  /** epoch ms of the event */
  t: number;
  /** speed at the event (mph) */
  mph: number;
  /** the g magnitude that triggered it (longitudinal for accel/brake, lateral for corner) */
  g: number;
  lat: number;
  lng: number;
}

export interface SpeedSample {
  /** epoch ms */
  t: number;
  /** mph (device value when present, else derived from position) */
  mph: number;
  /** longitudinal g at this sample (+accel / −brake) */
  longG: number;
  /** lateral g at this sample — SIGNED (− = left turn, + = right turn) */
  latG: number;
}

export interface MovementReport {
  /** Down-sampled speed/g series for charting (oldest → newest). */
  series: SpeedSample[];
  /** Harsh accel / brake / cornering events, newest first. */
  events: DrivingEvent[];
  totalMi: number;
  movingMs: number;
  idleMs: number;
  /** count of distinct stops (moving → stopped transitions) */
  stops: number;
  maxMph: number;
  /** average speed while actually moving (mph) */
  avgMovingMph: number;
  /** peak forward acceleration (g, ≥ 0) */
  maxAccelG: number;
  /** peak braking deceleration (g, ≥ 0, reported as a positive magnitude) */
  maxBrakeG: number;
  /** peak lateral / cornering load (g, ≥ 0) */
  maxLatG: number;
  /** total elapsed time covered by the track (ms) */
  durationMs: number;
  /** how the speed was sourced — informs the UI whether the chip is real GPS */
  speedSource: 'device' | 'derived' | 'mixed' | 'none';
}

const MPS_TO_MPH = 2.236936;
/** 1 g of longitudinal accel = 9.80665 m/s² = 21.936 mph/s. */
const MPH_PER_S_PER_G = 21.936;
const EARTH_M = 6371000;

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Great-circle distance in meters between two lat/lng. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing (deg, 0–360) from point 1 to point 2. */
function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (Math.atan2(y, x) * 180) / Math.PI; // -180..180; only used as a delta below
}

/** Smallest signed angle between two bearings, in degrees (−180..180]. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

// ────────────────────────────────────────────────────────────
//  TUNABLE: what counts as a "harsh" driving event.
//
//  These thresholds shape the event log + driver-behavior scoring on the
//  TRIP drawer. They're deliberately a single, isolated block so they can
//  be matched to RMPG's emergency-vehicle-operations / pursuit policy —
//  Code-3 driving legitimately pulls higher g than civilian limits, so the
//  defaults below are set for trained LE drivers (a civilian fleet would
//  use ~0.30 g brake / ~0.25 g accel). g values are magnitudes (≥ 0).
//
//  Returns the kind + severity for the strongest event a sample triggers,
//  or null when the motion is unremarkable. mph gate avoids flagging the
//  GPS jitter that looks like motion while parked.
// ────────────────────────────────────────────────────────────
export const HARSH = {
  /** ignore everything below this speed (mph) — kills standstill jitter */
  minMph: 5,
  /** forward acceleration (g): [notable, aggressive, severe] */
  accel: [0.3, 0.42, 0.55] as const,
  /** braking deceleration (g): [notable, aggressive, severe] */
  brake: [0.35, 0.47, 0.62] as const,
  /** lateral / cornering load (g): [notable, aggressive, severe] */
  corner: [0.35, 0.48, 0.62] as const,
};

function severityFor(mag: number, bands: readonly [number, number, number]): 1 | 2 | 3 | 0 {
  if (mag >= bands[2]) return 3;
  if (mag >= bands[1]) return 2;
  if (mag >= bands[0]) return 1;
  return 0;
}

/** Classify one sample's longitudinal + lateral g into a driving event (or null).
 *  The strongest of {brake, accel, corner} wins. Pure — see HARSH for tuning. */
export function classifyDrivingEvent(
  longG: number,
  latG: number,
  mph: number,
): { kind: DrivingEventKind; severity: 1 | 2 | 3; g: number } | null {
  if (!Number.isFinite(longG) || !Number.isFinite(latG) || mph < HARSH.minMph) return null;

  const brakeSev = longG < 0 ? severityFor(-longG, HARSH.brake) : 0;
  const accelSev = longG > 0 ? severityFor(longG, HARSH.accel) : 0;
  const cornerSev = severityFor(Math.abs(latG), HARSH.corner);

  // Pick the most severe; break ties brake > corner > accel (safety-ordered).
  const candidates: { kind: DrivingEventKind; severity: 1 | 2 | 3 | 0; g: number }[] = [
    { kind: 'brake', severity: brakeSev, g: Math.abs(longG) },
    { kind: 'corner', severity: cornerSev, g: Math.abs(latG) },
    { kind: 'accel', severity: accelSev, g: Math.abs(longG) },
  ];
  const best = candidates.reduce((a, b) => (b.severity > a.severity ? b : a));
  return best.severity === 0 ? null : { kind: best.kind, severity: best.severity, g: best.g };
}

const SERIES_MAX = 180; // chart resolution cap (keeps SVG light)
const STOP_MPH = 2; // at/below this we consider the vehicle stopped
const EVENT_THROTTLE_MS = 2500; // collapse repeated same-kind events within this window
const EVENTS_KEEP = 40;

/**
 * Build a full movement report from the captured GPS track.
 * Derives speed from position when the device speed is null, so it works
 * on cellular/WiFi devices that never report a speed-over-ground.
 */
export function buildMovementReport(track: FixPoint[]): MovementReport {
  const empty: MovementReport = {
    series: [], events: [], totalMi: 0, movingMs: 0, idleMs: 0, stops: 0,
    maxMph: 0, avgMovingMph: 0, maxAccelG: 0, maxBrakeG: 0, maxLatG: 0,
    durationMs: 0, speedSource: 'none',
  };
  if (!track || track.length < 2) return empty;

  // Normalize to {t, lat, lng, mph, heading} with derived speed where needed.
  type Step = { t: number; lat: number; lng: number; mph: number; heading: number | null; derived: boolean };
  const steps: Step[] = [];
  let prev: FixPoint | null = null;
  let prevT = 0;
  let sawDevice = false;
  let sawDerived = false;

  for (const p of track) {
    const t = Date.parse(p.timestamp);
    if (!Number.isFinite(t) || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    let mph: number;
    let derived = false;
    if (p.speed != null && Number.isFinite(p.speed) && p.speed >= 0) {
      mph = p.speed * MPS_TO_MPH;
      sawDevice = true;
    } else if (prev && t > prevT) {
      const d = haversineM(prev.lat, prev.lng, p.lat, p.lng);
      const dt = (t - prevT) / 1000;
      mph = dt > 0 ? (d / dt) * MPS_TO_MPH : 0;
      // Reject teleport spikes (bad fix): >120 mph between fixes is noise.
      if (mph > 120) mph = 0;
      derived = true;
      sawDerived = true;
    } else {
      mph = 0;
    }
    steps.push({ t, lat: p.lat, lng: p.lng, mph, heading: p.heading, derived });
    prev = p;
    prevT = t;
  }
  if (steps.length < 2) return empty;

  // Walk the steps accumulating distance, time-in-state, g-forces, events.
  let totalM = 0;
  let movingMs = 0;
  let idleMs = 0;
  let stops = 0;
  let maxMph = 0;
  let maxAccelG = 0;
  let maxBrakeG = 0;
  let maxLatG = 0;
  let wasMoving = false;
  const samples: SpeedSample[] = [];
  const events: DrivingEvent[] = [];
  const lastEventAt: Record<DrivingEventKind, number> = { accel: 0, brake: 0, corner: 0 };

  for (let i = 0; i < steps.length; i++) {
    const cur = steps[i];
    maxMph = Math.max(maxMph, cur.mph);

    let longG = 0;
    let latG = 0;
    if (i > 0) {
      const p = steps[i - 1];
      const dt = (cur.t - p.t) / 1000;
      if (dt > 0 && dt < 30) {
        // distance + dwell-state
        const d = haversineM(p.lat, p.lng, cur.lat, cur.lng);
        if (d < 5000) totalM += d; // ignore teleports
        const dwellMs = cur.t - p.t;
        if (cur.mph > STOP_MPH) movingMs += dwellMs;
        else idleMs += dwellMs;

        // longitudinal g from the speed delta
        longG = (cur.mph - p.mph) / dt / MPH_PER_S_PER_G;

        // lateral g from turn rate × speed. Prefer course-over-ground bearing
        // (derived from the two positions) — far steadier than device heading,
        // which jitters when stationary. ω(rad/s) · v(m/s) / 9.80665 = g.
        if (cur.mph > 8 && i > 1) {
          const pp = steps[i - 2];
          const b1 = bearing(pp.lat, pp.lng, p.lat, p.lng);
          const b2 = bearing(p.lat, p.lng, cur.lat, cur.lng);
          const turnDegPerS = angleDelta(b1, b2) / dt;
          const omega = toRad(turnDegPerS); // signed: + right, − left
          const vMs = cur.mph / MPS_TO_MPH;
          latG = (omega * vMs) / 9.80665;
          if (!Number.isFinite(latG) || Math.abs(latG) > 2) latG = 0; // clamp GPS noise
        }
      }
    }

    if (longG > 0) maxAccelG = Math.max(maxAccelG, longG);
    if (longG < 0) maxBrakeG = Math.max(maxBrakeG, -longG);
    maxLatG = Math.max(maxLatG, Math.abs(latG));

    samples.push({ t: cur.t, mph: cur.mph, longG, latG });

    // stop detection (moving → stopped transition)
    const movingNow = cur.mph > STOP_MPH;
    if (wasMoving && !movingNow) stops += 1;
    wasMoving = movingNow;

    // event detection (throttled per kind). Gate on the FASTER of entry/exit
    // speed so a hard brake to a near-stop (ends below the speed gate) still
    // registers — the event happened while the vehicle was moving.
    const gateMph = i > 0 ? Math.max(steps[i - 1].mph, cur.mph) : cur.mph;
    const ev = classifyDrivingEvent(longG, latG, gateMph);
    if (ev && cur.t - lastEventAt[ev.kind] >= EVENT_THROTTLE_MS) {
      lastEventAt[ev.kind] = cur.t;
      events.push({ kind: ev.kind, severity: ev.severity, t: cur.t, mph: Math.round(cur.mph), g: ev.g, lat: cur.lat, lng: cur.lng });
    }
  }

  const durationMs = steps[steps.length - 1].t - steps[0].t;
  const totalMi = totalM / 1609.34;
  const avgMovingMph = movingMs > 1000 ? totalMi / (movingMs / 3600000) : 0;

  // Down-sample the series for the chart (keep newest detail by even stride).
  let series = samples;
  if (samples.length > SERIES_MAX) {
    const stride = Math.ceil(samples.length / SERIES_MAX);
    series = samples.filter((_, i) => i % stride === 0 || i === samples.length - 1);
  }

  const speedSource: MovementReport['speedSource'] =
    sawDevice && sawDerived ? 'mixed' : sawDevice ? 'device' : sawDerived ? 'derived' : 'none';

  return {
    series,
    events: events.slice(-EVENTS_KEEP).reverse(), // newest first
    totalMi,
    movingMs,
    idleMs,
    stops,
    maxMph: Math.round(maxMph),
    avgMovingMph,
    maxAccelG,
    maxBrakeG,
    maxLatG,
    durationMs,
    speedSource,
  };
}
