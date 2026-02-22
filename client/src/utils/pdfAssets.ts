// ============================================================
// RMPG Flex — PDF Assets & Constants
// Runtime image loader for agency seal/logo + form identifiers
// ============================================================

// ── Module-level image cache ────────────────────────────────

let sealBase64: string | null = null;
let logoBase64: string | null = null;
let logoDarkBase64: string | null = null;

/**
 * Fetch the RMPG seal PNG, downscale to 128x128 for PDF embedding,
 * convert to base64, and cache. Returns null on failure.
 */
export async function loadSealBase64(): Promise<string | null> {
  if (sealBase64) return sealBase64;
  try {
    const res = await fetch('/rmpg-seal.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);

    // Downscale to 128x128 for PDF (original is 1024x1024 / 1.8MB)
    const size = 128;
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

    // Strip data URL prefix to get raw base64
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

    // Downscale to 200x66 (maintain approx aspect ratio of 1236x406)
    const w = 200;
    const h = 66;
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

    // Downscale to 128x128 (original is 564x570, nearly square)
    const size = 128;
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

/** Clear cached images (for testing) */
export function clearImageCache(): void {
  sealBase64 = null;
  logoBase64 = null;
  logoDarkBase64 = null;
}

// ── Form Number Constants ───────────────────────────────────

export const FORM_NUMBERS: Record<string, string> = {
  // Incident reports (PS-1xx)
  incident: 'FORM PS-101',
  trespass: 'FORM PS-102',
  accident: 'FORM PS-103',
  medical: 'FORM PS-104',
  use_of_force: 'FORM PS-105',
  daily_activity: 'FORM PS-106',
  arrest: 'FORM PS-107',
  // Record reports (PS-2xx)
  call: 'FORM PS-201',
  person: 'FORM PS-202',
  vehicle: 'FORM PS-203',
  warrant: 'FORM PS-204',
  evidence: 'FORM PS-205',
  fleet: 'FORM PS-206',
  personnel: 'FORM PS-207',
  property: 'FORM PS-208',
  citation: 'FORM PS-209',
  // Financial (PS-3xx)
  invoice: 'FORM PS-301',
};

export const FORM_REVISION = 'Rev. 2026-03';
