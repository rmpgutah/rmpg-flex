// ============================================================
// RMPG Flex — PDF Assets & Constants
// Runtime image loader for agency seal/logo + form identifiers
// ============================================================

// rmpg-seal.png is imported via Vite (?url) so it lands in the hashed
// /assets/ path that the deployed Worker reliably serves. The previous
// `/rmpg-seal.png` at the bundle root 404'd on live (other root-level
// PNGs work — this specific file was missing from the served set, root
// cause not identified). The Vite path is asset-fingerprinted, so
// cache invalidation is automatic on rebuild.
import sealUrl from '../assets/rmpg-seal.png?url';

import type jsPDF from 'jspdf';

// ── Module-level image cache ────────────────────────────────

let sealBase64: string | null = null;
let logoBase64: string | null = null;
let logoDarkBase64: string | null = null;
let logoLightBase64: string | null = null;
let logoPrintBase64: string | null = null;   // BW/clean version for PDF headers on white paper
let logoBlueDarkBase64: string | null = null; // Blue-on-dark for UI dark theme

/**
 * Fetch the RMPG seal PNG, downscale to 128x128 for PDF embedding,
 * convert to base64, and cache. Returns null on failure.
 */
export async function loadSealBase64(): Promise<string | null> {
  if (sealBase64) return sealBase64;
  try {
    const res = await fetch(sealUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);

    // Downscale to 192x192 for higher-res bold PDF header (original is 1024x1024)
    const size = 192;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, size, size);
    bmp.close();

    const outBlob = await canvas.convertToBlob({ type: 'image/png' });
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(outBlob);
    });

    // Cache the full data URL — jsPDF addImage accepts it directly (the prior
    // "strip prefix" comment was misleading; nothing is stripped).
    sealBase64 = dataUrl;
    return sealBase64;
  } catch {
    return null;
  }
}

/**
 * Fetch the RMPG logo PNG, downscale for PDF embedding,
 * convert to base64, and cache. Returns null on failure.
 */
export async function loadLogoBase64(): Promise<string | null> {
  if (logoBase64) return logoBase64;
  try {
    const res = await fetch('/rmpg-logo.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);

    // Downscale to 300x99 for bolder PDF header (maintain approx aspect ratio of 1236x406)
    const w = 300;
    const h = 99;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();

    const outBlob = await canvas.convertToBlob({ type: 'image/png' });
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(outBlob);
    });

    logoBase64 = dataUrl;
    return logoBase64;
  } catch {
    return null;
  }
}

/**
 * Fetch the RMPG Logo Dark PNG, composite onto white background
 * (to remove transparency and blend with white paper), downscale
 * for PDF embedding, convert to base64, and cache.
 */
export async function loadLogoDarkBase64(): Promise<string | null> {
  if (logoDarkBase64) return logoDarkBase64;
  try {
    const res = await fetch('/RMPG Logo Dark.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);

    // Downscale to 192x192 (original is 564x570, nearly square)
    const size = 192;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Fill white background first so transparency blends with paper
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(bmp, 0, 0, size, size);
    bmp.close();

    const outBlob = await canvas.convertToBlob({ type: 'image/png' });
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(outBlob);
    });

    logoDarkBase64 = dataUrl;
    return logoDarkBase64;
  } catch {
    return null;
  }
}

/**
 * Fetch the RMPG Logo Dark PNG and recolor every opaque pixel to white,
 * preserving the original silhouette's alpha shape — produces a
 * light/white emblem suitable for dark-filled surfaces (the steel-blue
 * table header band, classification banner fills, dark-themed print
 * preview chrome). No separate light-colored source asset exists; this
 * is generated from the same file `loadLogoDarkBase64` uses.
 */
export async function loadLogoLightBase64(): Promise<string | null> {
  if (logoLightBase64) return logoLightBase64;
  try {
    const res = await fetch('/RMPG Logo Dark.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);

    const size = 192;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Draw the logo first (establishes the alpha silhouette), then flood
    // every opaque pixel white via source-in compositing — this recolors
    // without altering the shape's edges/antialiasing.
    ctx.drawImage(bmp, 0, 0, size, size);
    bmp.close();
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';

    const outBlob = await canvas.convertToBlob({ type: 'image/png' });
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(outBlob);
    });

    logoLightBase64 = dataUrl;
    return logoLightBase64;
  } catch {
    return null;
  }
}

/**
 * Synchronous read of the cached light/white logo (recolored from RMPG Logo Dark).
 * Returns null if `loadLogoLightBase64()` hasn't been awaited yet.
 */
export function getCachedLogoLight(): string | null {
  return logoLightBase64;
}

/**
 * Synchronous read of the cached print logo (BW/clean).
 * Returns null if `loadLogoPrintBase64()` hasn't been awaited yet.
 */
export function getCachedLogoPrint(): string | null {
  return logoPrintBase64;
}

/**
 * Synchronous read of whatever `loadSealBase64()` has already cached, or
 * `null` if it hasn't resolved yet. `drawNibrsHeader()` (pdfFormHelpers.ts)
 * is synchronous and can't `await` the loader itself, so callers that
 * generate a report should `await loadSealBase64()` once up front — this
 * getter is the synchronous read side of that same cache.
 */
export function getCachedSealBase64(): string | null {
  return sealBase64;
}

/**
 * Fetch the print-quality RMPG logo — black transparent-background logo for
 * clean letterhead on white paper and ghost watermarks. Prefers the canonical
 * rmpg-logo-black.png (transparent bg, no white box artifact on PDF pages).
 *
 * Drop your logo files into client/public/:
 *   rmpg-logo-black.png       — black logo, transparent bg (preferred)
 *   rmpg-logo-bw.png          — BW logo, fallback
 *   Logo Official.png         — legacy fallback
 */
export async function loadLogoPrintBase64(): Promise<string | null> {
  if (logoPrintBase64) return logoPrintBase64;
  const candidates = ['/rmpg-logo-black.png', '/rmpg-logo-bw.png', '/Logo Official.png', '/RMPG Logo Dark.png'];
  for (const src of candidates) {
    try {
      const res = await fetch(src);
      if (!res.ok) continue;
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob);
      const w = 360;
      const h = Math.round(w * (bmp.height / bmp.width));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) { bmp.close(); continue; }
      // No white bg fill — transparent-bg logo renders cleanly on white paper
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      const outBlob = await canvas.convertToBlob({ type: 'image/png' });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(outBlob);
      });
      logoPrintBase64 = dataUrl;
      return logoPrintBase64;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Fetch the silver RMPG logo for use on dark-themed surfaces (navbar, NIBRS
 * header band, dark panel headers). Transparent background — no white box.
 *
 * Drop your logo file into client/public/:
 *   rmpg-logo-silver.png      — silver/gray logo, transparent bg (preferred)
 *   rmpg-logo-blue-dark.png   — blue logo on transparent bg (fallback)
 */
export async function loadLogoBlueDarkBase64(): Promise<string | null> {
  if (logoBlueDarkBase64) return logoBlueDarkBase64;
  const candidates = ['/rmpg-logo-silver.png', '/rmpg-logo-blue-dark.png', '/rmpg flex.png', '/rmpg-logo.png'];
  for (const src of candidates) {
    try {
      const res = await fetch(src);
      if (!res.ok) continue;
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob);
      const w = 360;
      const h = Math.round(w * (bmp.height / bmp.width));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) { bmp.close(); continue; }
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      const outBlob = await canvas.convertToBlob({ type: 'image/png' });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(outBlob);
      });
      logoBlueDarkBase64 = dataUrl;
      return logoBlueDarkBase64;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Draw a faint logo fade in the center of the current PDF page — a ghost
 * brand mark used as a background element behind form content. The logo is
 * rendered at ~8% opacity so it reads as watermark-level presence without
 * competing with form fields. Call once per page after drawing all content
 * (or before; jsPDF draws in z-order but the opacity keeps it subtle).
 *
 * @param doc - the jsPDF instance (current page is stamped)
 * @param logoDataUrl - base64 data URL (loadLogoPrintBase64 recommended)
 * @param opts.opacity - 0–1, default 0.06
 * @param opts.widthMm - logo width in mm, default 100 (centered)
 */
export function drawLogoFadeBackground(
  doc: jsPDF,
  logoDataUrl: string,
  opts: { opacity?: number; widthMm?: number } = {},
): void {
  const opacity = opts.opacity ?? 0.06;
  const logoW = opts.widthMm ?? 100;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const logoX = (pageW - logoW) / 2;
  const logoH = logoW * 0.33; // approximate 3:1 aspect for horizontal logo
  const logoY = (pageH - logoH) / 2;

  try {
    // @ts-ignore jsPDF GState constructor not in community typedefs
    doc.setGState(new doc.GState({ opacity }));
    doc.addImage(logoDataUrl, 'PNG', logoX, logoY, logoW, logoH);
    // @ts-ignore jsPDF GState constructor not in community typedefs
    doc.setGState(new doc.GState({ opacity: 1.0 }));
  } catch {
    // Silently skip — bad image data should never crash a PDF generation
  }
}

/**
 * Apply a logo background fade to every page of a finalized PDF.
 * Call this after all content is drawn, before save().
 */
export function applyLogoFadeToAllPages(
  doc: jsPDF,
  logoDataUrl: string,
  opts: { opacity?: number; widthMm?: number } = {},
): void {
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawLogoFadeBackground(doc, logoDataUrl, opts);
  }
}

/** Clear cached images (for testing) */
export function clearImageCache(): void {
  sealBase64 = null;
  logoBase64 = null;
  logoDarkBase64 = null;
  logoLightBase64 = null;
  logoPrintBase64 = null;
  logoBlueDarkBase64 = null;
}

// ── Form Number Constants ───────────────────────────────────

export const FORM_NUMBERS: Record<string, string> = {
  // Incident reports (PS-1xx)
  incident: 'FORM UIR-205',
  trespass: 'FORM PS-102',
  accident: 'FORM PS-103',
  medical: 'FORM PS-104',
  use_of_force: 'FORM PS-105',
  daily_activity: 'FORM PS-106',
  arrest: 'FORM PS-107',
  process_service: 'FORM PS-108',
  // Record reports (PS-2xx)
  call: 'FORM PS-201',
  person: 'FORM PS-202',
  vehicle: 'FORM PS-203',
  warrant: 'FORM PS-204',
  warrant_summary: 'FORM PS-204S',
  evidence: 'FORM PS-205',
  fleet: 'FORM PS-206',
  personnel: 'FORM PS-207',
  property: 'FORM PS-208',
  citation: 'FORM PS-209',
  business: 'FORM PS-212',
  // Fleet operational forms (PS-206-*)
  'FORM PS-206-PTI': 'FORM PS-206-PTI',  // Pre-Trip Inspection
  'FORM PS-206-CKO': 'FORM PS-206-CKO',  // Vehicle Check-Out
  'FORM PS-206-DMG': 'FORM PS-206-DMG',  // Damage Report
  // Tracking & Analytics (PS-2xx cont.)
  patrol_tracking: 'FORM PS-210',
  trip_log: 'FORM PS-211',
  // Serve / Process Service (PS-3xx)
  serve_affidavit:      'FORM PS-311',
  serve_non_service:    'FORM PS-312',
  service_log:          'FORM PS-313',
  serve_leave_behind:   'FORM PS-314',
  // Financial (PS-3xx cont.)
  invoice: 'FORM PS-301',
  proposal: 'FORM PS-302',
  // Communications (PS-4xx)
  radio_log:      'FORM PS-401',
  comms_message:  'FORM PS-402',
  bolo_broadcast: 'FORM PS-403',
};

export const FORM_REVISION = 'Rev. 2026-03';
