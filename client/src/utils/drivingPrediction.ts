// ============================================================
// RMPG Flex — Driving prediction + detection geometry (pure)
// ============================================================
// Powers the forensic player's predictive-path overlay and the AI vehicle-
// tracking box math. Predicts where the cruiser is heading from the 1Hz GPS
// track (constant-turn-rate + speed model), projects a perspective "road
// ahead" onto the video frame, and helps place/scale detection boxes. All
// pure + unit-tested. Speed is mph.
// ============================================================

import { bearingDeg, type GpsPoint } from './dashcamForensics';

const MPH_TO_MS = 0.44704;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Signed smallest angle a−b in degrees, in (−180, 180]. */
export function angleDelta(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

function posAt(gps: GpsPoint[], tSec: number): GpsPoint {
  if (gps.length === 0) throw new Error('empty');
  const t0 = gps[0].timestamp;
  const target = t0 + tSec * 1000;
  if (target <= gps[0].timestamp) return gps[0];
  const last = gps.length - 1;
  if (target >= gps[last].timestamp) return gps[last];
  let i = 0; while (i < last && gps[i + 1].timestamp <= target) i++;
  const a = gps[i], b = gps[i + 1];
  const f = (target - a.timestamp) / Math.max(1, b.timestamp - a.timestamp);
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * f,
    longitude: a.longitude + (b.longitude - a.longitude) * f,
    speed: (Number(a.speed) || 0) + ((Number(b.speed) || 0) - (Number(a.speed) || 0)) * f,
    altitude: a.altitude, timestamp: target,
  };
}

/** Heading (deg, 0=N) at a time, from a short local step. */
export function bearingAt(gps: GpsPoint[], tSec: number): number {
  if (gps.length < 2) return 0;
  const a = posAt(gps, Math.max(0, tSec - 0.4));
  const b = posAt(gps, tSec + 0.4);
  return bearingDeg(a, b);
}

/** Turn rate (deg/sec, +right/CW) around a time — the curvature signal. */
export function turnRateDegPerSec(gps: GpsPoint[], tSec: number, window = 1.2): number {
  if (gps.length < 3) return 0;
  const b0 = bearingAt(gps, tSec);
  const b1 = bearingAt(gps, tSec + window);
  return angleDelta(b1, b0) / window;
}

export interface PredictedPoint { latitude: number; longitude: number; tSec: number; speed: number }

/** Forward-project the path from `tSec` using current speed + heading + turn
 *  rate (constant-turn-rate kinematic model). Returns future GPS points. */
export function predictPath(gps: GpsPoint[], tSec: number, horizonSec = 4, stepSec = 0.5): PredictedPoint[] {
  if (gps.length < 2) return [];
  const p = posAt(gps, tSec);
  const speedMs = (Number(p.speed) || 0) * MPH_TO_MS;
  let heading = bearingAt(gps, tSec);
  const turn = turnRateDegPerSec(gps, tSec);
  let lat = p.latitude, lng = p.longitude;
  const out: PredictedPoint[] = [];
  for (let t = stepSec; t <= horizonSec + 1e-6; t += stepSec) {
    heading += turn * stepSec;
    const dist = speedMs * stepSec;                       // metres this step
    const dNorth = Math.cos(toRad(heading)) * dist;
    const dEast = Math.sin(toRad(heading)) * dist;
    lat += dNorth / 111320;
    lng += dEast / (111320 * Math.cos(toRad(lat)));
    out.push({ latitude: lat, longitude: lng, tSec: tSec + t, speed: Number(p.speed) || 0 });
  }
  return out;
}

/** Predicted heading `aheadSec` into the future. */
export function predictedHeadingIn(gps: GpsPoint[], tSec: number, aheadSec: number): number {
  return (bearingAt(gps, tSec) + turnRateDegPerSec(gps, tSec) * aheadSec + 360) % 360;
}

export interface PathSample { x: number; y: number; halfWidth: number }

/** A stylized perspective "road ahead" projected onto the video frame
 *  (natural px). Starts at bottom-centre, recedes to a vanishing point whose
 *  height grows with speed, and curves left/right with the turn rate. Returns
 *  centre samples with a per-sample half-width (lane narrows with distance). */
export function videoPredictivePath(turnRateDegPerSec: number, speedMph: number, viewW: number, viewH: number, steps = 14): PathSample[] {
  const turnNorm = Math.max(-1, Math.min(1, turnRateDegPerSec / 28));    // 28°/s ≈ sharp
  const speedNorm = Math.max(0.25, Math.min(1, speedMph / 55));          // faster → longer projection
  const topY = viewH * (0.55 - 0.12 * speedNorm);                        // vanishing height
  const baseX = viewW / 2;
  const laneHalf = viewW * 0.22;                                          // lane half-width at the hood
  const out: PathSample[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;                                                  // 0 hood → 1 vanishing
    const y = viewH - s * (viewH - topY);
    const x = baseX + turnNorm * s * s * (viewW * 0.55);                 // curve grows with distance²
    const halfWidth = Math.max(viewW * 0.012, laneHalf * (1 - s) ** 1.5); // perspective narrowing
    out.push({ x, y, halfWidth });
  }
  return out;
}

// ── Detection box helpers (coco-ssd bbox = [x, y, w, h] in natural px) ──

export type Box = [number, number, number, number];
export interface Detection { bbox: Box; score: number; cls: string }

/** Pick the vehicle to tag: largest, most central, lowest (closest) — weighted. */
export function pickPrimary(dets: Detection[], viewW: number, viewH: number): Detection | null {
  if (!dets.length) return null;
  let best: Detection | null = null, bestScore = -Infinity;
  for (const d of dets) {
    const [x, y, w, h] = d.bbox;
    const area = (w * h) / (viewW * viewH);                              // 0..1
    const cx = x + w / 2;
    const centrality = 1 - Math.min(1, Math.abs(cx - viewW / 2) / (viewW / 2));
    const lowness = (y + h) / viewH;                                     // closer to bottom = nearer
    const score = area * 2 + centrality * 0.8 + lowness * 0.5 + d.score * 0.3;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** Heuristic licence-plate sub-region within a vehicle box (lower-centre band). */
export function plateRegion(bbox: Box): Box {
  const [x, y, w, h] = bbox;
  return [x + w * 0.30, y + h * 0.72, w * 0.40, h * 0.18];
}

/** Clamp a box inside the frame (keeps labels/boxes on-screen). */
export function clampBox(bbox: Box, viewW: number, viewH: number): Box {
  let [x, y, w, h] = bbox;
  x = Math.max(0, Math.min(x, viewW)); y = Math.max(0, Math.min(y, viewH));
  w = Math.max(0, Math.min(w, viewW - x)); h = Math.max(0, Math.min(h, viewH - y));
  return [x, y, w, h];
}

/** One-line vehicle tag from ALPR attributes, e.g. "2019 Black Honda Civic". */
export function vehicleTag(v: { year?: number | null; color?: string | null; make?: string | null; model?: string | null } | null): string {
  if (!v) return '';
  return [v.year, v.color, v.make, v.model].filter(Boolean).join(' ').trim();
}
