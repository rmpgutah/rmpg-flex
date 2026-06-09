// ============================================================
// RMPG Flex — Trail Decimation & Age-Window Filter
// Keeps the on-map patrol trail bounded in time and vertex count
// without losing its shape or its endpoints. Pure — no React, no
// DOM. Reused by the live trail layer and the export pipeline.
// ============================================================

export interface TrailPoint {
  lat: number;
  lng: number;
  /** epoch ms of the fix. */
  t?: number;
}

/**
 * Drop points older than `maxMinutes` relative to `nowTs` (epoch ms).
 * Points without a timestamp are kept (we can't age them out).
 */
export function trimByAge<T extends TrailPoint>(
  points: T[],
  maxMinutes: number,
  nowTs: number,
): T[] {
  const list = Array.isArray(points) ? points : [];
  if (!Number.isFinite(maxMinutes) || maxMinutes <= 0) return list.slice();
  const cutoff = nowTs - maxMinutes * 60_000;
  return list.filter(p => p.t == null || p.t >= cutoff);
}

/** Perpendicular distance (in coordinate space) of p from segment a→b. */
function perpDist(p: TrailPoint, a: TrailPoint, b: TrailPoint): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = p.lng - a.lng;
    const ey = p.lat - a.lat;
    return Math.sqrt(ex * ex + ey * ey);
  }
  const tNum = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / len2;
  const projx = a.lng + tNum * dx;
  const projy = a.lat + tNum * dy;
  const ex = p.lng - projx;
  const ey = p.lat - projy;
  return Math.sqrt(ex * ex + ey * ey);
}

/**
 * Reduce a polyline to at most `maxVertices` points while preserving
 * endpoints and overall shape. Uses a ranked Douglas-Peucker-lite:
 * recursively keep the highest-deviation vertices until the budget
 * is reached, then fall back to uniform striding if still over.
 */
export function decimate<T extends TrailPoint>(points: T[], maxVertices: number): T[] {
  const list = Array.isArray(points) ? points : [];
  const cap = Number.isFinite(maxVertices) ? Math.max(2, Math.floor(maxVertices)) : 2;
  if (list.length <= cap) return list.slice();

  // Mark which indices to keep; always keep both endpoints.
  const keep = new Array<boolean>(list.length).fill(false);
  keep[0] = true;
  keep[list.length - 1] = true;
  let kept = 2;

  // Priority queue (simple array) of segments by max deviation.
  type Seg = { lo: number; hi: number; idx: number; dev: number };
  const findWorst = (lo: number, hi: number): { idx: number; dev: number } => {
    let idx = -1;
    let dev = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDist(list[i], list[lo], list[hi]);
      if (d > dev) {
        dev = d;
        idx = i;
      }
    }
    return { idx, dev };
  };

  const segs: Seg[] = [];
  const seed = findWorst(0, list.length - 1);
  if (seed.idx >= 0) segs.push({ lo: 0, hi: list.length - 1, ...seed });

  while (kept < cap && segs.length) {
    // pull the highest-deviation segment
    let bi = 0;
    for (let i = 1; i < segs.length; i++) if (segs[i].dev > segs[bi].dev) bi = i;
    const s = segs.splice(bi, 1)[0];
    if (s.idx < 0 || keep[s.idx]) continue;
    keep[s.idx] = true;
    kept++;
    const left = findWorst(s.lo, s.idx);
    if (left.idx >= 0) segs.push({ lo: s.lo, hi: s.idx, ...left });
    const right = findWorst(s.idx, s.hi);
    if (right.idx >= 0) segs.push({ lo: s.idx, hi: s.hi, ...right });
  }

  const result = list.filter((_, i) => keep[i]);

  // Safety net: if shape-keep somehow exceeded the cap, uniform stride.
  if (result.length > cap) {
    const strided: T[] = [];
    const step = (result.length - 1) / (cap - 1);
    for (let i = 0; i < cap; i++) strided.push(result[Math.round(i * step)]);
    strided[0] = result[0];
    strided[cap - 1] = result[result.length - 1];
    return strided;
  }
  return result;
}
