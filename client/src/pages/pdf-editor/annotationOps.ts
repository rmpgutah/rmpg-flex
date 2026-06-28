// Pure annotation arrangement operations for the PDF editor.
//
// All functions take the full annotation list plus the set of selected ids and
// return a NEW list with the selected annotations repositioned/resized. They are
// pure (no React, no DOM) so they can be unit-tested in isolation and reused by
// the toolbar, context menu, and keyboard handlers alike.
//
// Coordinate system: annotations store screen-pixel (x, y, w, h) at the canvas
// render scale, origin top-left (same as the rest of the editor). Alignment and
// distribution operate within a single page's selection — callers should pass a
// selection that lives on one page (the editor's multi-select already enforces
// per-page selection in practice; ops additionally ignore locked annotations).

import type { Annotation } from './types';

/**
 * Replicate a single annotation (identified by `sourceId`) onto every page in
 * the document, preserving its position/size. Returns the FULL annotation list
 * with the clones appended (the source page keeps the original; every other
 * page 1..pageCount gets a fresh-id copy on the same x/y). Useful for stamping
 * a watermark-style mark, a "DRAFT" stamp, a footer rule, etc. across the doc.
 *
 * Pure — no React, no DOM. `genId` is injected so the caller controls id
 * generation (and so this stays unit-testable).
 */
export function applyAnnotationToAllPages(
  annotations: Annotation[],
  sourceId: string,
  pageCount: number,
  genId: () => string,
): Annotation[] {
  const source = annotations.find((a) => a.id === sourceId);
  if (!source || pageCount <= 0) return annotations;
  const clones: Annotation[] = [];
  for (let page = 1; page <= pageCount; page++) {
    if (page === source.page) continue; // original already lives here
    clones.push({ ...source, id: genId(), page } as Annotation);
  }
  return clones.length > 0 ? [...annotations, ...clones] : annotations;
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type DistributeMode = 'horizontal' | 'vertical';
export type MatchSizeMode = 'width' | 'height' | 'both';

interface Box { x: number; y: number; w: number; h: number; }

/** Axis-aligned bounding box that encloses every box passed in. */
export function boundingBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Returns the subset of `annotations` that is selected and not locked. */
function selectable(annotations: Annotation[], selectedIds: Set<string>): Annotation[] {
  return annotations.filter((a) => selectedIds.has(a.id) && !a.locked);
}

/**
 * Align the selected annotations to a shared edge/center derived from the
 * selection's bounding box. Needs at least 2 movable annotations; otherwise the
 * original list is returned unchanged.
 */
export function alignAnnotations(
  annotations: Annotation[],
  selectedIds: Set<string>,
  mode: AlignMode,
): Annotation[] {
  const sel = selectable(annotations, selectedIds);
  if (sel.length < 2) return annotations;
  const bb = boundingBox(sel)!;
  const move = new Map<string, { x?: number; y?: number }>();
  for (const a of sel) {
    switch (mode) {
      case 'left': move.set(a.id, { x: bb.x }); break;
      case 'right': move.set(a.id, { x: bb.x + bb.w - a.w }); break;
      case 'hcenter': move.set(a.id, { x: bb.x + (bb.w - a.w) / 2 }); break;
      case 'top': move.set(a.id, { y: bb.y }); break;
      case 'bottom': move.set(a.id, { y: bb.y + bb.h - a.h }); break;
      case 'vcenter': move.set(a.id, { y: bb.y + (bb.h - a.h) / 2 }); break;
    }
  }
  return annotations.map((a) => (move.has(a.id) ? { ...a, ...move.get(a.id) } : a));
}

/**
 * Evenly distribute the selected annotations so the gaps between them are equal
 * along the chosen axis. The two extreme annotations stay put; the interior ones
 * are spaced so edge-to-edge gaps are uniform (Acrobat / Illustrator behaviour).
 * Needs at least 3 movable annotations.
 */
export function distributeAnnotations(
  annotations: Annotation[],
  selectedIds: Set<string>,
  mode: DistributeMode,
): Annotation[] {
  const sel = selectable(annotations, selectedIds);
  if (sel.length < 3) return annotations;

  const horizontal = mode === 'horizontal';
  const sorted = [...sel].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const spanStart = horizontal ? first.x : first.y;
  const spanEnd = horizontal ? last.x + last.w : last.y + last.h;
  const totalSize = sorted.reduce((s, a) => s + (horizontal ? a.w : a.h), 0);
  const gap = (spanEnd - spanStart - totalSize) / (sorted.length - 1);

  const move = new Map<string, { x?: number; y?: number }>();
  let cursor = spanStart;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (i === 0) {
      cursor = (horizontal ? a.x + a.w : a.y + a.h) + gap;
      continue;
    }
    if (i === sorted.length - 1) break; // extremes are anchors
    move.set(a.id, horizontal ? { x: cursor } : { y: cursor });
    cursor += (horizontal ? a.w : a.h) + gap;
  }
  return annotations.map((a) => (move.has(a.id) ? { ...a, ...move.get(a.id) } : a));
}

/**
 * Resize the selected annotations to match the dimensions of the LAST-selected
 * (the "key" / anchor) annotation. The anchor itself is left unchanged. The
 * top-left corner is preserved; only w/h change.
 */
export function matchSize(
  annotations: Annotation[],
  selectedIds: Set<string>,
  anchorId: string,
  mode: MatchSizeMode,
): Annotation[] {
  const anchor = annotations.find((a) => a.id === anchorId);
  if (!anchor) return annotations;
  const sel = selectable(annotations, selectedIds);
  if (sel.length < 2) return annotations;
  return annotations.map((a) => {
    if (a.id === anchorId || !selectedIds.has(a.id) || a.locked) return a;
    const patch: { w?: number; h?: number } = {};
    if (mode === 'width' || mode === 'both') patch.w = anchor.w;
    if (mode === 'height' || mode === 'both') patch.h = anchor.h;
    return { ...a, ...patch } as Annotation;
  });
}
