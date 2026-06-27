// client/src/utils/redaction/regions.ts
// Pure region model for the Redaction Studio. A region carries KEYFRAMED boxes
// (so a moving plate/face stays covered) over [tStart,tEnd]. Everything here is
// deterministic + unit-tested; canvas/ffmpeg consume it.

/** [x, y, w, h] in fractional 0..1 frame coordinates. */
export type NormBox = [number, number, number, number];
export interface Keyframe { t: number; box: NormBox }
export type RedactionKind = 'plate' | 'face' | 'person' | 'manual';
export type RedactionStyle = 'blur' | 'pixelate' | 'box';

export interface RedactionRegion {
  id: string;
  kind: RedactionKind;
  keyframes: Keyframe[];     // sorted by t, length >= 1
  tStart: number;
  tEnd: number;
  style: RedactionStyle;
  strength: number;          // blur px radius / pixelate block size
  source: 'auto' | 'manual';
  enabled: boolean;
}

export interface DetectorSample { kind: RedactionKind; box: NormBox; t: number }

/** Intersection-over-union of two fractional boxes. */
export function iou(a: NormBox, b: NormBox): number {
  const ax2 = a[0] + a[2], ay2 = a[1] + a[3], bx2 = b[0] + b[2], by2 = b[1] + b[3];
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  const inter = ix * iy, uni = a[2] * a[3] + b[2] * b[3] - inter;
  return uni <= 0 ? 0 : inter / uni;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/** Interpolate a region's box at time t (clamps outside the keyframe range). */
export function interpBox(region: RedactionRegion, t: number): NormBox {
  const k = region.keyframes;
  if (k.length === 1 || t <= k[0].t) return k[0].box;
  if (t >= k[k.length - 1].t) return k[k.length - 1].box;
  let i = 0; while (i < k.length - 1 && k[i + 1].t <= t) i++;
  const a = k[i], b = k[i + 1];
  const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
  return [lerp(a.box[0], b.box[0], f), lerp(a.box[1], b.box[1], f), lerp(a.box[2], b.box[2], f), lerp(a.box[3], b.box[3], f)];
}

/** Enabled regions whose [tStart,tEnd] covers t. */
export function activeRegionsAt(regions: RedactionRegion[], t: number): RedactionRegion[] {
  return regions.filter((r) => r.enabled && t >= r.tStart && t <= r.tEnd);
}

let _seq = 0;
const nextId = () => `auto_${Date.now().toString(36)}_${_seq++}`;

export interface MergeOpts { scanInterval?: number; iouThresh?: number; defaultStyle?: RedactionStyle; strength?: number }

/** Group temporally-consecutive, spatially-overlapping same-kind samples into
 *  keyframed regions. A lone sample is padded by ±scanInterval/2. */
export function mergeSamples(samples: DetectorSample[], opts: MergeOpts = {}): RedactionRegion[] {
  const scanInterval = opts.scanInterval ?? 0.25;
  const iouThresh = opts.iouThresh ?? 0.2;
  const style = opts.defaultStyle ?? 'blur';
  const strength = opts.strength ?? 12;
  const sorted = [...samples].sort((a, b) => a.t - b.t);

  interface Open { region: RedactionRegion; lastT: number; lastBox: NormBox }
  const open: Open[] = [];
  const done: RedactionRegion[] = [];

  for (const s of sorted) {
    let best: Open | null = null, bestIou = iouThresh;
    for (const o of open) {
      if (o.region.kind !== s.kind) continue;
      if (s.t - o.lastT > scanInterval * 2.5) continue;
      const ov = iou(o.lastBox, s.box);
      if (ov >= bestIou) { bestIou = ov; best = o; }
    }
    if (best) {
      best.region.keyframes.push({ t: s.t, box: s.box });
      best.region.tEnd = s.t; best.lastT = s.t; best.lastBox = s.box;
    } else {
      const region: RedactionRegion = {
        id: nextId(), kind: s.kind, keyframes: [{ t: s.t, box: s.box }],
        tStart: s.t, tEnd: s.t, style, strength, source: 'auto', enabled: true,
      };
      open.push({ region, lastT: s.t, lastBox: s.box });
    }
  }
  for (const o of open) {
    const r = o.region;
    if (r.keyframes.length === 1) { r.tStart = r.tStart - scanInterval / 2; r.tEnd = r.tEnd + scanInterval / 2; }
    done.push(r);
  }
  return done;
}

/** Fractional box → natural px (and back). */
export const denormBox = (b: NormBox, w: number, h: number): NormBox => [b[0] * w, b[1] * h, b[2] * w, b[3] * h];
export const normBox = (b: NormBox, w: number, h: number): NormBox => [b[0] / w, b[1] / h, b[2] / w, b[3] / h];
