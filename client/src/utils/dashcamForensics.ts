// ============================================================
// RMPG Flex — Dashcam forensic telemetry (pure helpers)
// ============================================================
// Drives the ForensicDashcamPlayer overlays from ClearPath's 1Hz GPS+speed
// track (lat/lng/speed/altitude per second over a ~20s clip). All pure + unit-
// tested: track stats (distance / g-force), SVG track normalization, and
// time→position interpolation synced to video playback. Speed is mph.
// ============================================================

export interface GpsPoint {
  latitude: number; longitude: number; speed: number; altitude: number; timestamp: number;
  bearing?: number | null;
}

const MPH_TO_MS = 0.44704;
const G = 9.80665;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance between two points, in metres. */
export function haversineMeters(a: GpsPoint, b: GpsPoint): number {
  const R = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude), lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing (degrees, 0=N) from a→b. */
export function bearingDeg(a: GpsPoint, b: GpsPoint): number {
  const y = Math.sin(toRad(b.longitude - a.longitude)) * Math.cos(toRad(b.latitude));
  const x = Math.cos(toRad(a.latitude)) * Math.sin(toRad(b.latitude))
    - Math.sin(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.cos(toRad(b.longitude - a.longitude));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export const COMPASS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compass(deg: number): string {
  return COMPASS_16[Math.round(((deg % 360) / 22.5)) % 16];
}

export interface TrackStats {
  points: number;
  durationSec: number;
  distanceMeters: number;
  distanceMiles: number;
  maxSpeed: number;
  minSpeed: number;
  avgSpeed: number;
  startSpeed: number;
  endSpeed: number;
  maxAccelG: number;   // hardest acceleration (+)
  maxBrakeG: number;   // hardest braking (magnitude, +)
}

/** Forensic summary of a GPS track. Safe on empty / single-point tracks. */
export function trackStats(gps: GpsPoint[]): TrackStats {
  const n = gps.length;
  if (n === 0) {
    return { points: 0, durationSec: 0, distanceMeters: 0, distanceMiles: 0, maxSpeed: 0, minSpeed: 0, avgSpeed: 0, startSpeed: 0, endSpeed: 0, maxAccelG: 0, maxBrakeG: 0 };
  }
  let dist = 0, sum = 0, max = -Infinity, min = Infinity, maxAccel = 0, maxBrake = 0;
  for (let i = 0; i < n; i++) {
    const s = Number(gps[i].speed) || 0;
    sum += s; max = Math.max(max, s); min = Math.min(min, s);
    if (i > 0) {
      dist += haversineMeters(gps[i - 1], gps[i]);
      const dt = Math.max(0.001, (gps[i].timestamp - gps[i - 1].timestamp) / 1000);
      const dv = (s - (Number(gps[i - 1].speed) || 0)) * MPH_TO_MS;   // m/s
      const gForce = dv / dt / G;
      if (gForce > maxAccel) maxAccel = gForce;
      if (-gForce > maxBrake) maxBrake = -gForce;
    }
  }
  const durationSec = (gps[n - 1].timestamp - gps[0].timestamp) / 1000;
  return {
    points: n, durationSec,
    distanceMeters: dist, distanceMiles: dist / 1609.344,
    maxSpeed: max === -Infinity ? 0 : max, minSpeed: min === Infinity ? 0 : min,
    avgSpeed: sum / n, startSpeed: Number(gps[0].speed) || 0, endSpeed: Number(gps[n - 1].speed) || 0,
    maxAccelG: maxAccel, maxBrakeG: maxBrake,
  };
}

export interface TrackPoint { x: number; y: number; speed: number; tSec: number }

/** Project the lat/lng track into a [pad, w-pad]×[pad, h-pad] SVG box, flipping
 *  y (north up) and preserving aspect ratio so the road shape isn't distorted. */
export function normalizeTrack(gps: GpsPoint[], w = 100, h = 100, pad = 6): TrackPoint[] {
  if (gps.length === 0) return [];
  const lats = gps.map((p) => p.latitude), lngs = gps.map((p) => p.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  // metres-ish span (lng compressed by cos(lat)) to keep aspect honest
  const midLat = (minLat + maxLat) / 2;
  const spanX = Math.max(1e-7, (maxLng - minLng) * Math.cos(toRad(midLat)));
  const spanY = Math.max(1e-7, maxLat - minLat);
  const span = Math.max(spanX, spanY);
  const innerW = w - 2 * pad, innerH = h - 2 * pad;
  const scale = Math.min(innerW, innerH) / span;
  const usedW = spanX * scale, usedH = spanY * scale;
  const offX = pad + (innerW - usedW) / 2, offY = pad + (innerH - usedH) / 2;
  const t0 = gps[0].timestamp;
  return gps.map((p) => ({
    x: offX + ((p.longitude - minLng) * Math.cos(toRad(midLat))) * scale,
    y: offY + (maxLat - p.latitude) * scale,   // flip: north up
    speed: Number(p.speed) || 0,
    tSec: (p.timestamp - t0) / 1000,
  }));
}

export interface InterpPos { latitude: number; longitude: number; speed: number; index: number; bearing: number }

/** Interpolated position + speed at `tSec` seconds into the clip (track starts
 *  at gps[0]). Clamps to the track ends; bearing derived from local heading. */
export function positionAtTime(gps: GpsPoint[], tSec: number): InterpPos | null {
  if (gps.length === 0) return null;
  if (gps.length === 1) return { latitude: gps[0].latitude, longitude: gps[0].longitude, speed: Number(gps[0].speed) || 0, index: 0, bearing: gps[0].bearing ?? 0 };
  const t0 = gps[0].timestamp;
  const targetMs = t0 + tSec * 1000;
  if (targetMs <= gps[0].timestamp) return { latitude: gps[0].latitude, longitude: gps[0].longitude, speed: Number(gps[0].speed) || 0, index: 0, bearing: bearingDeg(gps[0], gps[1]) };
  const last = gps.length - 1;
  if (targetMs >= gps[last].timestamp) return { latitude: gps[last].latitude, longitude: gps[last].longitude, speed: Number(gps[last].speed) || 0, index: last, bearing: bearingDeg(gps[last - 1], gps[last]) };
  let i = 0;
  while (i < last && gps[i + 1].timestamp <= targetMs) i++;
  const a = gps[i], b = gps[i + 1];
  const frac = (targetMs - a.timestamp) / Math.max(1, b.timestamp - a.timestamp);
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * frac,
    longitude: a.longitude + (b.longitude - a.longitude) * frac,
    speed: (Number(a.speed) || 0) + ((Number(b.speed) || 0) - (Number(a.speed) || 0)) * frac,
    index: i,
    bearing: bearingDeg(a, b),
  };
}

/** Green→amber→red ramp for a speed relative to the track max (for segment + HUD coloring). */
export function speedColor(speed: number, maxSpeed: number): string {
  const r = maxSpeed > 0 ? Math.max(0, Math.min(1, speed / maxSpeed)) : 0;
  if (r < 0.5) { // green→amber
    const t = r / 0.5; return `rgb(${Math.round(74 + t * (212 - 74))},${Math.round(222 - t * (62))},${Math.round(128 - t * 105)})`;
  }
  const t = (r - 0.5) / 0.5; // amber→red
  return `rgb(${Math.round(212 + t * (239 - 212))},${Math.round(160 - t * (160 - 68))},${Math.round(23 + t * (45))})`;
}

/** A short forensic verdict from the event type + telemetry. */
export function forensicVerdict(eventType: string | null, stats: TrackStats): string {
  const t = (eventType || '').toLowerCase();
  if (t.includes('collision') || t.includes('fcw')) {
    return stats.maxBrakeG > 0.35 ? `Forward-collision alert with hard braking (${stats.maxBrakeG.toFixed(2)}g) — likely genuine close call.`
      : `Forward-collision alert; no hard braking detected — possible early warning / clear.`;
  }
  if (t.includes('lane')) return `Lane-departure event at ${Math.round(stats.avgSpeed)} mph avg — review for drift vs. deliberate maneuver.`;
  if (t.includes('close follow') || t.includes('tailgat')) return `Close-following alert sustained at ${Math.round(stats.avgSpeed)} mph — following-distance violation.`;
  if (stats.maxBrakeG > 0.4) return `Hard braking detected (${stats.maxBrakeG.toFixed(2)}g).`;
  if (stats.maxAccelG > 0.4) return `Hard acceleration detected (${stats.maxAccelG.toFixed(2)}g).`;
  return `Routine telemetry — peak ${Math.round(stats.maxSpeed)} mph over ${stats.distanceMiles.toFixed(2)} mi.`;
}
