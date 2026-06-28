// ============================================================
// RMPG Flex — Temporal vehicle tracker (pure reducer)
// ============================================================
// Turns per-frame COCO-SSD detections into stable, smoothed tracks so the
// forensic player's boxes follow the vehicle instead of flickering. Greedy
// IoU association, EMA box smoothing, short "coast" through missed frames
// (with constant-velocity extrapolation), stable integer IDs, and a motion
// trail per track. Pure + deterministic → unit-tested.
// ============================================================

import type { Box, Detection } from './drivingPrediction';

export interface Track {
  id: number;
  bbox: Box;            // smoothed [x, y, w, h]
  cls: string;
  score: number;
  age: number;          // frames matched
  missed: number;       // consecutive frames without a match (0 = matched this step)
  vel: [number, number]; // centre velocity (px/step) for coasting
  trail: Array<[number, number]>; // recent centres (newest last)
}

export interface TrackerState { tracks: Track[]; nextId: number }

export interface TrackerOpts {
  iouThresh?: number;   // min IoU to associate (default 0.3)
  smooth?: number;      // EMA factor toward the new detection (0..1, default 0.5)
  maxMissed?: number;   // drop a track after this many missed frames (default 8)
  trailLen?: number;    // trail length (default 12)
}

export const emptyTrackerState = (): TrackerState => ({ tracks: [], nextId: 1 });

const cx = (b: Box) => b[0] + b[2] / 2;
const cy = (b: Box) => b[1] + b[3] / 2;

/** Intersection-over-union of two [x,y,w,h] boxes. */
export function iou(a: Box, b: Box): number {
  const ax2 = a[0] + a[2], ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2], by2 = b[1] + b[3];
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const uni = a[2] * a[3] + b[2] * b[3] - inter;
  return uni <= 0 ? 0 : inter / uni;
}

function lerpBox(a: Box, b: Box, t: number): Box {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

/** Advance the tracker by one frame of detections. Pure: returns new state. */
export function stepTracker(state: TrackerState, dets: Detection[], opts: TrackerOpts = {}): TrackerState {
  const iouThresh = opts.iouThresh ?? 0.3;
  const smooth = opts.smooth ?? 0.5;
  const maxMissed = opts.maxMissed ?? 8;
  const trailLen = opts.trailLen ?? 12;

  // Candidate (track, det) pairs above threshold, best-first (greedy).
  const pairs: Array<{ ti: number; di: number; iou: number }> = [];
  state.tracks.forEach((tr, ti) => dets.forEach((d, di) => {
    const ov = iou(tr.bbox, d.bbox);
    if (ov >= iouThresh) pairs.push({ ti, di, iou: ov });
  }));
  pairs.sort((p, q) => q.iou - p.iou);

  const usedT = new Set<number>(), usedD = new Set<number>();
  const matched = new Map<number, number>(); // ti -> di
  for (const p of pairs) {
    if (usedT.has(p.ti) || usedD.has(p.di)) continue;
    usedT.add(p.ti); usedD.add(p.di); matched.set(p.ti, p.di);
  }

  let nextId = state.nextId;
  const out: Track[] = [];

  state.tracks.forEach((tr, ti) => {
    if (matched.has(ti)) {
      const d = dets[matched.get(ti)!];
      const nb = lerpBox(tr.bbox, d.bbox, smooth);
      const vel: [number, number] = [cx(nb) - cx(tr.bbox), cy(nb) - cy(tr.bbox)];
      out.push({
        id: tr.id, bbox: nb, cls: d.cls, score: d.score, age: tr.age + 1, missed: 0, vel,
        trail: [...tr.trail, [cx(nb), cy(nb)] as [number, number]].slice(-trailLen),
      });
    } else if (tr.missed + 1 <= maxMissed) {
      // Coast: extrapolate by last velocity (damped) so the box doesn't freeze.
      const damp = 0.85;
      const nb: Box = [tr.bbox[0] + tr.vel[0] * damp, tr.bbox[1] + tr.vel[1] * damp, tr.bbox[2], tr.bbox[3]];
      out.push({
        ...tr, bbox: nb, missed: tr.missed + 1, vel: [tr.vel[0] * damp, tr.vel[1] * damp],
        trail: [...tr.trail, [cx(nb), cy(nb)] as [number, number]].slice(-trailLen),
      });
    }
    // else: dropped
  });

  // New tracks for unmatched detections.
  dets.forEach((d, di) => {
    if (usedD.has(di)) return;
    out.push({ id: nextId++, bbox: [...d.bbox] as Box, cls: d.cls, score: d.score, age: 1, missed: 0, vel: [0, 0], trail: [[cx(d.bbox), cy(d.bbox)]] });
  });

  return { tracks: out, nextId };
}

/** Tracks worth drawing: confirmed (age≥2) OR freshly seen, and not coasting too long. */
export function visibleTracks(state: TrackerState, maxMissedShow = 3): Track[] {
  return state.tracks.filter((t) => t.missed <= maxMissedShow && (t.age >= 2 || t.missed === 0));
}

/** Pick the vehicle track to tag (largest, central, low/near) — temporally
 *  stable. Pedestrians are tracked but never get the LP/vehicle tag. */
export function primaryTrack(tracks: Track[], viewW: number, viewH: number): Track | null {
  const vehicles = tracks.filter((t) => t.cls !== 'person');
  if (!vehicles.length) return null;
  let best: Track | null = null, bestScore = -Infinity;
  for (const t of vehicles) {
    const [x, y, w, h] = t.bbox;
    const area = (w * h) / (viewW * viewH);
    const centrality = 1 - Math.min(1, Math.abs((x + w / 2) - viewW / 2) / (viewW / 2));
    const lowness = (y + h) / viewH;
    const stability = Math.min(1, t.age / 8);   // prefer well-established tracks
    const s = area * 2 + centrality * 0.8 + lowness * 0.5 + stability * 0.6;
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return best;
}
