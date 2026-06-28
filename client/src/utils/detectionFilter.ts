// ============================================================
// RMPG Flex — Detection plausibility filter (pure)
// ============================================================
// COCO-SSD on a night dashcam frame false-fires on glare, headlights, and
// traffic/street lights — producing boxes in the sky band, tiny specks, frame-
// filling washes, and aspect-ratio slivers. This is a deterministic geometric
// gate that drops implausible vehicle/person detections before they become
// overlay boxes or redaction regions. Shared by aiVehicleTracking.detectVehicles
// and the redaction scan. Pure + unit-tested.
// ============================================================
import type { Detection } from './drivingPrediction';

export interface PlausibleOpts {
  minScore?: number;     // confidence floor (default 0.5 — night-safe vs the old 0.4)
  skyFracMax?: number;   // a box centre above this fraction of the frame = "sky" → drop (default 0.32)
  minAreaFrac?: number;  // smaller than this fraction of the frame = speck → drop (default 0.0006)
  maxAreaFrac?: number;  // larger than this = ego-hood/glare wash → drop (default 0.55)
  maxAspect?: number;    // wider/taller than this ratio = light streak → drop (default 5)
}

/** True if a detection is a plausible on-road vehicle/person (not glare/light). */
export function isPlausibleDetection(d: Detection, viewW: number, viewH: number, opts: PlausibleOpts = {}): boolean {
  const minScore = opts.minScore ?? 0.5;
  const skyFracMax = opts.skyFracMax ?? 0.32;
  const minAreaFrac = opts.minAreaFrac ?? 0.0006;
  const maxAreaFrac = opts.maxAreaFrac ?? 0.55;
  const maxAspect = opts.maxAspect ?? 5;

  const [x, y, w, h] = d.bbox;
  if (!(w > 0) || !(h > 0) || !(viewW > 0) || !(viewH > 0)) return false;
  if (d.score < minScore) return false;

  const areaFrac = (w * h) / (viewW * viewH);
  if (areaFrac < minAreaFrac || areaFrac > maxAreaFrac) return false;

  const centreYFrac = (y + h / 2) / viewH;
  if (centreYFrac < skyFracMax) return false;   // centre sits in the sky band

  const aspect = Math.max(w / h, h / w);
  if (aspect > maxAspect) return false;

  return true;
}

/** Keep only the plausible detections. */
export function filterDetections(dets: Detection[], viewW: number, viewH: number, opts: PlausibleOpts = {}): Detection[] {
  return dets.filter((d) => isPlausibleDetection(d, viewW, viewH, opts));
}
