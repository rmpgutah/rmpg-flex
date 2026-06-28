// src/utils/footage/turns.ts
// Pure GPS turn / direction-change detection for FlexCam timeline pins. A turn is
// a cumulative heading change beyond a threshold, collapsed to one marker (so a
// sweeping turn = one pin, not many). Reuses haversineM + bearing from
// tripTelemetry. Unit-tested in tests/footageTurns.test.ts.
import { haversineM, bearing } from '../tripTelemetry';

export interface GpsPoint { lat: number; lng: number; ts: number; } // ts epoch ms
export interface TurnMarker { ts: number; turnDir: 'left' | 'right'; headingDeg: number; deltaDeg: number; }

/** Signed smallest angle a→b in [-180,180], wrap-aware. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Detect turns from a GPS track. Builds reliable segment bearings between points
 *  ≥ minSegM apart (drops GPS jitter), then accumulates signed heading change;
 *  when |accumulated| ≥ thresholdDeg it emits one marker (dir by sign) and
 *  re-anchors to the new heading. A direction reversal resets the accumulator so
 *  consecutive opposite turns are separate pins. Pure. */
export function detectTurns(points: GpsPoint[], opts?: { thresholdDeg?: number; minSegM?: number }): TurnMarker[] {
  const thresholdDeg = opts?.thresholdDeg ?? 35;
  const minSegM = opts?.minSegM ?? 12;
  const pts = [...points].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).sort((a, b) => a.ts - b.ts);

  // Reliable segment bearings (skip near-stationary hops below minSegM).
  const segs: Array<{ heading: number; ts: number }> = [];
  let prev: GpsPoint | null = null;
  for (const p of pts) {
    if (!prev) { prev = p; continue; }
    if (haversineM(prev.lat, prev.lng, p.lat, p.lng) >= minSegM) {
      segs.push({ heading: bearing(prev.lat, prev.lng, p.lat, p.lng), ts: p.ts });
      prev = p;
    }
  }
  if (segs.length < 2) return [];

  const turns: TurnMarker[] = [];
  let accum = 0;
  for (let i = 1; i < segs.length; i++) {
    const step = angleDelta(segs[i - 1].heading, segs[i].heading);
    // Reset accumulation if the step reverses the in-progress turn direction.
    if (accum !== 0 && Math.sign(step) !== Math.sign(accum) && Math.abs(step) > 5) accum = 0;
    accum += step;
    if (Math.abs(accum) >= thresholdDeg) {
      const headingDeg = ((segs[i].heading % 360) + 360) % 360;
      turns.push({ ts: segs[i].ts, turnDir: accum > 0 ? 'right' : 'left', headingDeg, deltaDeg: accum });
      accum = 0;
    }
  }
  return turns;
}
