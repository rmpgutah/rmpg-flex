// Pure analysis helpers shared by useOlBreadcrumbs for the advanced
// derived layers (stops, speed warnings, status flags, hard brakes,
// milestones, hull). Kept side-effect-free so it's trivial to test
// and cheap to call on every refetch.

import type { BreadcrumbPoint } from '../hooks/useOlBreadcrumbs';

const EARTH_R_M = 6371000;
const SPEED_LIMIT_MPH = 80;
const HARD_BRAKE_MS_DELTA = 6.7;   // ~15 mph in m/s
const HARD_BRAKE_WINDOW_MS = 5000;
const STOP_SPEED_MPS = 0.45;       // ~1 mph
const STOP_MIN_DURATION_MS = 5 * 60 * 1000; // 5 min
const ARROW_EVERY_N = 20;
const MILESTONE_INTERVAL_M = 1609.344; // 1 mile

function toRad(deg: number): number { return deg * Math.PI / 180; }

/** Great-circle distance in meters between two lat/lng points. */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(h));
}

function timeMs(p: BreadcrumbPoint): number {
  if (!p.time) return 0;
  const t = Date.parse(p.time);
  return isNaN(t) ? 0 : t;
}

// ─── Per-trail summary ────────────────────────────────────────

export interface TrailSummary {
  pointCount: number;
  /** Total distance in meters (haversine sum of consecutive points) */
  distanceM: number;
  /** Duration in ms between first and last point time */
  durationMs: number;
  /** Avg speed in m/s, derived from distance / duration */
  avgSpeedMps: number;
  /** Max instantaneous speed in m/s from any point */
  maxSpeedMps: number;
  startTime: string | undefined;
  endTime: string | undefined;
}

export function summarizeTrail(points: BreadcrumbPoint[]): TrailSummary {
  let distanceM = 0;
  let maxSpeedMps = 0;
  for (let i = 1; i < points.length; i++) {
    distanceM += haversineMeters(points[i - 1], points[i]);
  }
  for (const p of points) {
    if (typeof p.speed === 'number' && Number.isFinite(p.speed) && p.speed > maxSpeedMps) {
      maxSpeedMps = p.speed;
    }
  }
  const startMs = points[0] ? timeMs(points[0]) : 0;
  const endMs = points[points.length - 1] ? timeMs(points[points.length - 1]) : 0;
  const durationMs = endMs && startMs ? Math.max(0, endMs - startMs) : 0;
  const avgSpeedMps = durationMs > 0 ? distanceM / (durationMs / 1000) : 0;
  return {
    pointCount: points.length,
    distanceM,
    durationMs,
    avgSpeedMps,
    maxSpeedMps,
    startTime: points[0]?.time,
    endTime: points[points.length - 1]?.time,
  };
}

// ─── Per-point analysis (returns subsets) ─────────────────────

/** Points where speed exceeded the configured limit. */
export function findSpeedWarnings(points: BreadcrumbPoint[]): BreadcrumbPoint[] {
  const limitMps = SPEED_LIMIT_MPH / 2.237;
  return points.filter((p) => typeof p.speed === 'number' && p.speed >= limitMps);
}

/** Points where consecutive speed dropped > HARD_BRAKE_MS_DELTA m/s
 *  (~15 mph) within HARD_BRAKE_WINDOW_MS (5s). */
export function findHardBrakes(points: BreadcrumbPoint[]): BreadcrumbPoint[] {
  const out: BreadcrumbPoint[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (typeof a.speed !== 'number' || typeof b.speed !== 'number') continue;
    const dt = (timeMs(b) - timeMs(a));
    if (dt <= 0 || dt > HARD_BRAKE_WINDOW_MS) continue;
    if (a.speed - b.speed >= HARD_BRAKE_MS_DELTA) {
      out.push(b);
    }
  }
  return out;
}

/** Points where status changes from the previous one. */
export function findStatusChanges(points: BreadcrumbPoint[]): BreadcrumbPoint[] {
  const out: BreadcrumbPoint[] = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i].status && points[i - 1].status && points[i].status !== points[i - 1].status) {
      out.push(points[i]);
    }
  }
  return out;
}

/** Detects stretches where speed stayed below STOP_SPEED_MPS for
 *  STOP_MIN_DURATION_MS+ — returns one centroid point per stretch. */
export function findStops(points: BreadcrumbPoint[]): BreadcrumbPoint[] {
  const out: BreadcrumbPoint[] = [];
  let runStart = -1;
  for (let i = 0; i < points.length; i++) {
    const slow = typeof points[i].speed === 'number' && (points[i].speed as number) < STOP_SPEED_MPS;
    if (slow) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      const startT = timeMs(points[runStart]);
      const endT = timeMs(points[i - 1]);
      if (startT && endT && endT - startT >= STOP_MIN_DURATION_MS) {
        // Use middle of stretch as the stop marker
        const midIdx = Math.floor((runStart + i - 1) / 2);
        out.push({
          ...points[midIdx],
          // Annotate dwell duration so the popup can show it
          dwell_minutes: Math.round((endT - startT) / 60000),
        } as BreadcrumbPoint & { dwell_minutes: number });
      }
      runStart = -1;
    }
  }
  return out;
}

/** Every Nth point as a "direction arrow" reference — used by the
 *  rendering layer to drop chevrons along the trail. */
export function findArrowAnchors(points: BreadcrumbPoint[]): BreadcrumbPoint[] {
  const out: BreadcrumbPoint[] = [];
  for (let i = ARROW_EVERY_N; i < points.length; i += ARROW_EVERY_N) {
    if (typeof points[i].heading === 'number') out.push(points[i]);
  }
  return out;
}

/** Cumulative-distance milestones (every 1 mile). Returns the points
 *  closest to each milestone boundary, with a 1-based mile number. */
export function findMilestones(points: BreadcrumbPoint[]): (BreadcrumbPoint & { mile: number })[] {
  const out: (BreadcrumbPoint & { mile: number })[] = [];
  let cumM = 0;
  let nextMile = 1;
  for (let i = 1; i < points.length; i++) {
    cumM += haversineMeters(points[i - 1], points[i]);
    if (cumM >= nextMile * MILESTONE_INTERVAL_M) {
      out.push({ ...points[i], mile: nextMile });
      nextMile++;
    }
  }
  return out;
}

// ─── Convex hull (Andrew's monotone chain) ────────────────────

function cross(O: [number, number], A: [number, number], B: [number, number]): number {
  return (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
}

/** Convex-hull polygon of the trail's points as [lng, lat] tuples,
 *  closed (first point repeated at end). */
export function convexHull(points: BreadcrumbPoint[]): [number, number][] {
  const pts: [number, number][] = points
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => [p.lng, p.lat]);
  if (pts.length < 3) return pts;
  pts.sort((a, b) => a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop(); lower.pop();
  const hull = lower.concat(upper);
  if (hull.length > 0) hull.push(hull[0]);
  return hull;
}

// ─── GPX export ───────────────────────────────────────────────

interface TrailLike { call_sign: string; officer_name?: string; points: BreadcrumbPoint[]; }

/** Builds a GPX 1.1 XML string for the supplied trails. Each trail is
 *  one <trk>; each point is one <trkpt> with optional time + speed
 *  extension. Browser-safe (no DOMParser; pure string concat). */
export function trailsToGpx(trails: TrailLike[]): string {
  const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c] as string));
  let out = '<?xml version="1.0" encoding="UTF-8"?>\n';
  out += '<gpx version="1.1" creator="RMPG Flex /map-v2" xmlns="http://www.topografix.com/GPX/1/1">\n';
  for (const t of trails) {
    out += `  <trk>\n    <name>${esc(t.call_sign || 'Unit')}</name>\n`;
    if (t.officer_name) out += `    <desc>${esc(t.officer_name)}</desc>\n`;
    out += '    <trkseg>\n';
    for (const p of t.points) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      out += `      <trkpt lat="${p.lat}" lon="${p.lng}">\n`;
      if (p.time) out += `        <time>${esc(p.time)}</time>\n`;
      if (typeof p.speed === 'number') {
        out += `        <extensions><speed>${p.speed.toFixed(2)}</speed></extensions>\n`;
      }
      out += '      </trkpt>\n';
    }
    out += '    </trkseg>\n  </trk>\n';
  }
  out += '</gpx>\n';
  return out;
}

/** Trigger a browser download of the GPX string as a .gpx file. */
export function downloadGpx(trails: TrailLike[]): void {
  const xml = trailsToGpx(trails);
  const blob = new Blob([xml], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  a.href = url;
  a.download = `breadcrumbs-${ts}.gpx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Time-of-day filter ───────────────────────────────────────

/** Filter points whose Date.getHours() falls in the inclusive [from, to]
 *  range. Wrap-around supported (e.g. 22..6 = night shift). */
export function filterByHourRange(points: BreadcrumbPoint[], fromHour: number, toHour: number): BreadcrumbPoint[] {
  if (fromHour === toHour) return points;
  return points.filter((p) => {
    const ms = timeMs(p);
    if (!ms) return true;
    const h = new Date(ms).getHours();
    if (fromHour < toHour) return h >= fromHour && h <= toHour;
    return h >= fromHour || h <= toHour;
  });
}
