// src/utils/redactionDeepScan.ts
// Pure per-frame parsing logic for POST /personnel/bodycam-videos/:id/deep-scan
// — validates and normalizes the vision model's raw per-frame face/plate
// bounding-box detections into the client's existing DetectorSample shape
// (client/src/utils/redaction/regions.ts), so the route's output plugs
// directly into the Redaction Studio's existing mergeSamples() pipeline with
// no new region model. Kept as a standalone pure function (no D1/AI
// dependencies) so it's testable with the Node vitest suite, unlike the
// route itself (Miniflare has no `ai` binding).

export type DeepScanKind = 'face' | 'plate';
/** [x, y, w, h] in fractional 0..1 frame coordinates — mirrors client NormBox. */
export type NormBox = [number, number, number, number];

export interface RawDeepScanDetection {
  kind: string;
  box: NormBox;
  confidence: number;
}

/** Mirrors client/src/utils/redaction/regions.ts's DetectorSample shape. */
export interface DetectorSample {
  kind: DeepScanKind;
  box: NormBox;
  t: number;
}

function isValidBox(b: unknown): b is NormBox {
  if (!Array.isArray(b) || b.length !== 4) return false;
  const [x, y, w, h] = b;
  if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  if (w <= 0 || h <= 0) return false;
  if (x < 0 || y < 0) return false;
  if (x + w > 1 || y + h > 1) return false;
  return true;
}

/** Parse one frame's raw model detections into validated DetectorSamples at
 *  timestamp `t`. Drops any detection with an unrecognized kind, a
 *  degenerate/out-of-range box, or confidence below `minConfidence` (after
 *  clamping confidence to [0,1] — an out-of-range value from the model is
 *  clamped and re-checked against the threshold, not dropped outright,
 *  since a model reporting e.g. 1.2 almost certainly means "very confident"
 *  rather than "invalid"). */
export function parseDeepScanFrame(detections: RawDeepScanDetection[], t: number, minConfidence = 0.3): DetectorSample[] {
  if (!Array.isArray(detections)) return [];
  const out: DetectorSample[] = [];
  for (const d of detections) {
    if (typeof d !== 'object' || d === null) continue;
    if (d.kind !== 'face' && d.kind !== 'plate') continue;
    if (!isValidBox(d.box)) continue;
    const confidence = Math.min(1, Math.max(0, Number(d.confidence) || 0));
    if (confidence < minConfidence) continue;
    out.push({ kind: d.kind, box: d.box, t });
  }
  return out;
}
