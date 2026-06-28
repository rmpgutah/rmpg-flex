// ============================================================
// RMPG Flex — ALPR capture overlay + gallery filtering (pure)
// ============================================================
// Pure helpers behind <AlprCaptureGallery>: classify a capture's source,
// derive its confidence/hit tone, normalize a detection box to fractional
// image coordinates (so it scales to any rendered size), and filter a set of
// captures by the gallery's filter bar. All unit-tested — no DOM here.
// ============================================================

export interface GalleryCapture {
  id: number;
  plate: string | null;
  state: string | null;
  confidence: number | null;
  accepted: boolean | null;
  alerted: boolean;
  source?: string | null;            // 'dashcam' | 'field' | 'manual'
  engine?: string | null;
  event_type?: string | null;
  device_name?: string | null;
  location_text?: string | null;
  created_at?: string | null;
  image_url: string | null;
  annotated_image_url: string | null;
  detections?: unknown[];
  [k: string]: unknown;
}

export type CaptureSource = 'dashcam' | 'field' | 'manual';
export type ConfidenceBand = 'high' | 'low';
export type HitTone = 'hit' | 'clean';

/** Normalized capture source for badges + filtering. */
export function captureSource(cap: Pick<GalleryCapture, 'source'>): CaptureSource {
  const s = (cap.source || '').toLowerCase();
  if (s === 'dashcam' || s === 'field' || s === 'manual') return s;
  return 'manual';
}

export function sourceLabel(source: CaptureSource): string {
  return source === 'dashcam' ? 'DASHCAM' : source === 'field' ? 'FIELD CAM' : 'MANUAL';
}

/** ≥0.85 is the acceptance gate everywhere else in the ALPR pipeline. */
export function confidenceBand(conf: number | null | undefined, accepted?: boolean | null): ConfidenceBand {
  if (accepted === true) return 'high';
  if (accepted === false) return 'low';
  return (conf ?? 0) >= 0.85 ? 'high' : 'low';
}

export function hitTone(cap: Pick<GalleryCapture, 'alerted'>): HitTone {
  return cap.alerted ? 'hit' : 'clean';
}

/** A fractional box in [0,1] relative to the image — renders at any size. */
export interface FractionBox { left: number; top: number; width: number; height: number; label?: string | null; confidence?: number | null }

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Normalize one raw detection (Roboflow / generic shapes) into a fractional
 *  box. `natW`/`natH` are the natural pixel size of the rendered image; pass
 *  them when the detection coords are pixels. Returns null when geometry is
 *  unusable. Handles:
 *   • center+size  { x, y, width, height }            (Roboflow predictions)
 *   • corner box   { x1, y1, x2, y2 } / [x1,y1,x2,y2]
 *   • {left,top,right,bottom}
 *  Coords already in [0,1] are treated as fractions (natW/natH ignored). */
export function normalizeDetection(det: any, natW?: number | null, natH?: number | null): FractionBox | null {
  if (!det || typeof det !== 'object') return null;
  const label = det.class ?? det.label ?? det.plate ?? null;
  const confidence = typeof det.confidence === 'number' ? det.confidence : null;

  const arr = Array.isArray(det) ? det : (Array.isArray(det.bbox) ? det.bbox : null);
  let x1: number | undefined, y1: number | undefined, x2: number | undefined, y2: number | undefined;

  if (arr && arr.length === 4) {
    [x1, y1, x2, y2] = arr.map(Number);
  } else if ([det.x1, det.y1, det.x2, det.y2].every((v) => typeof v === 'number')) {
    x1 = det.x1; y1 = det.y1; x2 = det.x2; y2 = det.y2;
  } else if ([det.left, det.top, det.right, det.bottom].every((v) => typeof v === 'number')) {
    x1 = det.left; y1 = det.top; x2 = det.right; y2 = det.bottom;
  } else if ([det.x, det.y, det.width, det.height].every((v) => typeof v === 'number')) {
    x1 = det.x - det.width / 2; y1 = det.y - det.height / 2;
    x2 = det.x + det.width / 2; y2 = det.y + det.height / 2;
  } else {
    return null;
  }
  if ([x1, y1, x2, y2].some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;

  // Decide whether coords are already fractional or pixels. Real normalized
  // coords sit in [0,1]; anything larger is pixel-space and can't be normalized
  // without the natural image size, so omit the box until dimensions exist
  // (the caller recomputes once onLoad fires) rather than crushing it to a
  // full-frame garbage rectangle.
  const maxVal = Math.max(x1!, y1!, x2!, y2!);
  if (maxVal > 1.0 && (!natW || !natH)) return null;
  const asFraction = maxVal <= 1.0;
  const fx = asFraction ? 1 : 1 / (natW as number);
  const fy = asFraction ? 1 : 1 / (natH as number);

  let left = clamp01(Math.min(x1!, x2!) * fx);
  let top = clamp01(Math.min(y1!, y2!) * fy);
  const width = clamp01(Math.abs(x2! - x1!) * fx);
  const height = clamp01(Math.abs(y2! - y1!) * fy);
  if (left + width > 1) left = clamp01(1 - width);
  if (top + height > 1) top = clamp01(1 - height);
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height, label, confidence };
}

/** Map a set of raw detections to fractional boxes, dropping the unusable ones. */
export function detectionBoxes(detections: unknown[] | undefined, natW?: number | null, natH?: number | null): FractionBox[] {
  if (!Array.isArray(detections)) return [];
  return detections.map((d) => normalizeDetection(d, natW, natH)).filter((b): b is FractionBox => !!b);
}

// ── Filtering ─────────────────────────────────────────────────

export interface CaptureFilter {
  source?: CaptureSource | 'all';
  band?: ConfidenceBand | 'all';
  hits?: 'hits' | 'all';
  plate?: string;
  eventType?: string;        // substring match on event_type
  from?: string | null;      // ISO date (inclusive)
  to?: string | null;        // ISO date (inclusive, end-of-day handled by caller)
}

/** True when a capture passes every active filter. Pure — drives the gallery. */
export function captureMatches(cap: GalleryCapture, f: CaptureFilter): boolean {
  if (f.source && f.source !== 'all' && captureSource(cap) !== f.source) return false;
  if (f.band && f.band !== 'all' && confidenceBand(cap.confidence, cap.accepted) !== f.band) return false;
  if (f.hits === 'hits' && !cap.alerted) return false;
  if (f.plate) {
    const needle = f.plate.toUpperCase().replace(/[\s-]/g, '');
    if (!(cap.plate || '').toUpperCase().replace(/[\s-]/g, '').includes(needle)) return false;
  }
  if (f.eventType) {
    if (!((cap.event_type || '').toLowerCase().includes(f.eventType.toLowerCase()))) return false;
  }
  if (f.from && (cap.created_at || '') < f.from) return false;
  if (f.to && (cap.created_at || '') > f.to) return false;
  return true;
}

export function filterCaptures(caps: GalleryCapture[], f: CaptureFilter): GalleryCapture[] {
  return caps.filter((c) => captureMatches(c, f));
}

/** Distinct, sorted event types present in a capture set (for the filter dropdown). */
export function eventTypeOptions(caps: GalleryCapture[]): string[] {
  const set = new Set<string>();
  for (const c of caps) if (c.event_type) set.add(c.event_type);
  return Array.from(set).sort();
}
