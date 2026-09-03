// Shared signature-image helpers for Rocky Mountain Protective Group's court-facing
// PDF output. Two independent problems live here:
//
// 1. Every signature PNG captured by SignaturePad.tsx (and every signature
//    stored in D1 before this fix) has an opaque white rectangle baked in —
//    `makeSignatureTransparent` strips it, with a feathered edge so
//    anti-aliased ink doesn't get a jagged halo.
// 2. The two PDF render sites (pdfFormHelpers.ts, pdfGenerator.ts) drew the
//    signature image at a fixed height, stretching it and ignoring its real
//    aspect ratio — `computeSignatureRect` is a pure, unit-tested function
//    that fits the image into its box (with a bounded, realistic overshoot)
//    instead.

/** A rectangle in PDF mm-space (or any consistent unit — the function is unit-agnostic). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NaturalImageSize {
  width: number;
  height: number;
}

/**
 * A real signature runs slightly over the printed line — this is the bounded
 * "realism" overshoot the operator asked for. It is a FRACTION of the box's
 * own dimensions that the fitted image is allowed to exceed on each axis
 * before any hard clamp is applied. 12% is enough to read as ink overrunning
 * a rule without threatening the row above/below it.
 */
export const SIGNATURE_OVERSHOOT = 0.22;

export interface ComputeSignatureRectOptions {
  /** Fraction of box w/h the fitted image may exceed. Defaults to SIGNATURE_OVERSHOOT. */
  overshoot?: number;
  /** Vertical anchor of the fitted image within/around the box. Default 'bottom' (rests on the signature line). */
  anchor?: 'bottom' | 'center' | 'top';
  /** Horizontal alignment of the fitted image within/around the box. Default 'left'. */
  align?: 'left' | 'center' | 'right';
  /**
   * Absolute hard bounds the result must never exceed — e.g. the printed-name
   * row below, the role label above, or the page edge. When the overshoot
   * would cross one of these, the image is shrunk (proportionally, aspect
   * preserved) rather than clipped.
   */
  hardLimits?: Rect;
}

/**
 * Pure function (no canvas, no DOM) — fits a natural image size into a box,
 * preserving aspect ratio, allowing a bounded overshoot, and clamping against
 * caller-supplied hard limits. This is the seam that keeps 67 documents from
 * getting a silently-wrong signature size from an off-by-one — it is unit
 * tested exhaustively; do not inline this math at a call site again.
 */
export function computeSignatureRect(
  natural: NaturalImageSize,
  box: Rect,
  opts: ComputeSignatureRectOptions = {},
): Rect {
  const overshoot = opts.overshoot ?? SIGNATURE_OVERSHOOT;
  const anchor = opts.anchor ?? 'bottom';
  const align = opts.align ?? 'left';

  // Degenerate input — zero/negative/NaN dimensions anywhere — return a
  // zero-size rect anchored at the box origin rather than NaN/Infinity
  // propagating into a jsPDF addImage call.
  if (
    !Number.isFinite(natural.width) || !Number.isFinite(natural.height) ||
    !Number.isFinite(box.w) || !Number.isFinite(box.h) ||
    natural.width <= 0 || natural.height <= 0 ||
    box.w <= 0 || box.h <= 0
  ) {
    return { x: box.x, y: box.y, w: 0, h: 0 };
  }

  const maxW = box.w * (1 + overshoot);
  const maxH = box.h * (1 + overshoot);
  const scale = Math.min(maxW / natural.width, maxH / natural.height);
  let w = natural.width * scale;
  let h = natural.height * scale;

  let x: number;
  if (align === 'center') x = box.x + (box.w - w) / 2;
  else if (align === 'right') x = box.x + box.w - w;
  else x = box.x;

  let y: number;
  if (anchor === 'center') y = box.y + (box.h - h) / 2;
  else if (anchor === 'top') y = box.y;
  else y = box.y + box.h - h;

  const limits = opts.hardLimits;
  if (limits) {
    // Shrink (never just clip) to fit inside hardLimits, preserving aspect.
    let shrink = 1;
    if (x < limits.x) {
      // Pull the left edge in — recompute allowed width from the limit's left edge.
      const allowedW = x + w - limits.x;
      if (allowedW > 0) shrink = Math.min(shrink, allowedW / w);
      x = limits.x;
    }
    if (x + w > limits.x + limits.w) {
      const allowedW = limits.x + limits.w - x;
      if (allowedW > 0) shrink = Math.min(shrink, allowedW / w);
    }
    if (y < limits.y) {
      const allowedH = y + h - limits.y;
      if (allowedH > 0) shrink = Math.min(shrink, allowedH / h);
    }
    if (y + h > limits.y + limits.h) {
      const allowedH = limits.y + limits.h - y;
      if (allowedH > 0) shrink = Math.min(shrink, allowedH / h);
    }

    if (shrink < 1 && shrink > 0) {
      w *= shrink;
      h *= shrink;
      // Re-anchor after shrinking so the image still rests against the edge
      // it was anchored to (e.g. still sits on the signature line).
      if (align === 'center') x = box.x + (box.w - w) / 2;
      else if (align === 'right') x = box.x + box.w - w;
      else x = box.x;
      if (anchor === 'center') y = box.y + (box.h - h) / 2;
      else if (anchor === 'top') y = box.y;
      else y = box.y + box.h - h;
    }

    // Final hard clamp — belt-and-suspenders against any residual overshoot.
    x = Math.max(limits.x, Math.min(x, limits.x + limits.w - w));
    y = Math.max(limits.y, Math.min(y, limits.y + limits.h - h));
  }

  return { x, y, w, h };
}

// ── Transparency pass ───────────────────────────────────────────────────

/**
 * Luminance floor/ceiling for the near-white feather. Pixels at or above
 * WHITE_CEIL are fully stripped; pixels between WHITE_FLOOR and WHITE_CEIL
 * get partial alpha proportional to how close they are to white, so an
 * anti-aliased stroke edge fades out instead of leaving a jagged cutout.
 */
const WHITE_FLOOR = 235;
const WHITE_CEIL = 255;

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('signature image failed to load'));
    img.src = src;
  });
}

/**
 * Strips the opaque white background out of a signature PNG data URL,
 * feathering the near-white edge so ink doesn't get a hard outline.
 *
 * Works on ANY signature PNG, old or new — this is what lets existing,
 * already-stored signatures (captured before this fix, still white-boxed in
 * D1) get fixed at render time with no re-signing and no migration.
 *
 * Never throws: any failure (bad data URL, canvas unsupported, tainted
 * canvas, etc.) returns the ORIGINAL data URL unchanged. A signature that
 * renders with a white box is far better than one that fails to render at
 * all on a court document.
 */
export async function makeSignatureTransparent(dataUrl: string): Promise<string> {
  try {
    if (typeof document === 'undefined' || typeof window === 'undefined') return dataUrl;
    if (!dataUrl || !dataUrl.startsWith('data:image')) return dataUrl;

    const img = await loadImageEl(dataUrl);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return dataUrl;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;

    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luminance >= WHITE_CEIL) {
        data[i + 3] = 0;
      } else if (luminance > WHITE_FLOOR) {
        const t = (luminance - WHITE_FLOOR) / (WHITE_CEIL - WHITE_FLOOR);
        data[i + 3] = Math.round(data[i + 3] * (1 - t));
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return dataUrl;
  }
}

// ── Sync-path cache ─────────────────────────────────────────────────────
//
// The two PDF render call sites (pdfFormHelpers.ts drawSignatureSlot,
// pdfGenerator.ts addSignatureBlock) are synchronous — they're called from
// deep inside ~67 document generators and converting that whole chain to
// async would ripple across all of them, which the operator explicitly
// ruled out. Instead: `preloadSignatureTransparency` is awaited ONCE, up
// front, by the (already-async) top-level generation entry points
// (downloadRecordPdf / generateRecordPdfBlobUrl in recordPdfGenerator.ts,
// right after the officer signature is loaded into `_activeOfficerSig`),
// which warms this cache. The sync draw functions then call
// `getCachedTransparentSignature` — a plain map lookup, cache hit by the
// time drawing happens. If a signature somehow reaches drawing without
// having been preloaded (a caller that skips the preload step), the
// original image is used for that one render and a background conversion
// is kicked off so any subsequent render of the same signature in the same
// session is fixed.
const transparentCache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

function convert(dataUrl: string): Promise<string> {
  let p = pending.get(dataUrl);
  if (!p) {
    p = makeSignatureTransparent(dataUrl)
      .then((result) => {
        transparentCache.set(dataUrl, result);
        pending.delete(dataUrl);
        return result;
      })
      .catch(() => {
        pending.delete(dataUrl);
        return dataUrl;
      });
    pending.set(dataUrl, p);
  }
  return p;
}

/**
 * Await this once, up front (per generation run), for every signature data
 * URL that will be drawn. Populates the sync cache so the actual jsPDF
 * drawing calls — which cannot be async — get the transparent variant.
 */
export async function preloadSignatureTransparency(
  ...dataUrls: Array<string | null | undefined>
): Promise<void> {
  const unique = Array.from(new Set(dataUrls.filter((u): u is string => !!u)));
  await Promise.all(unique.map(convert));
}

/**
 * Synchronous lookup used by the jsPDF draw functions. Returns the
 * transparent variant if it's already cached (normal path, after
 * `preloadSignatureTransparency`); otherwise returns the original image
 * as-is (so drawing never blocks or fails) and kicks off a background
 * conversion for next time.
 */
export function getCachedTransparentSignature(dataUrl: string | null | undefined): string | null | undefined {
  if (!dataUrl) return dataUrl;
  const cached = transparentCache.get(dataUrl);
  if (cached) return cached;
  void convert(dataUrl);
  return dataUrl;
}

/** Test-only: clear the module-level cache between test cases. */
export function __clearSignatureTransparencyCacheForTests(): void {
  transparentCache.clear();
  pending.clear();
}
