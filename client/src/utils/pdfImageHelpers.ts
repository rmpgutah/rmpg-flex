// ============================================================
// RMPG Flex — PDF Image Fetch Helpers
// Async functions to fetch, downscale, and prepare images
// for embedding into jsPDF documents.
// NO jsPDF imports here — rendering helpers are in pdfGenerator.ts
//
// CRITICAL ISOLATION RULE (Claude Opus 4.8, PR #889 follow-on):
//   This module previously imported `apiFetchAttachments` from
//   hooks/useApi, which is auth-coupled — on a 401 it attempts a
//   token refresh and, on failure, does `window.location.href =
//   '/login'`, tearing down the entire app and any open PDF viewer.
//   This was the root cause of the "PDF opens then goes blank"
//   crash (fixed for pdfStaticMap in c0f34f20; missed here).
//   Now uses raw fetch with JWT from localStorage + 7s timeout
//   (same isolation pattern as pdfStaticMap.ts).
// ============================================================

// ============================================================

// ── Fetch helpers (isolated from auth-coupled apiFetch) ────
const API_BASE = (() => {
  if (typeof window === 'undefined') return 'https://api.rmpgutah.us';
  const hostname = window.location.hostname;
  if (hostname === 'localhost') return 'http://localhost:8787';
  if (hostname.includes('pages.dev')) return 'https://api.rmpgutah.us';
  return 'https://api.rmpgutah.us';
})();

function getAuthToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem('rmpg_token');
  } catch { return null; }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return await fetch(url, { signal: controller.signal, headers });
  } catch { return null; } finally { clearTimeout(timer); }
}

async function fetchEntityAttachments(
  entityType: string,
  entityId: string | number,
): Promise<any[]> {
  const url = `${API_BASE}/api/documents/${entityType}/${entityId}/attachments`;
  const res = await fetchWithTimeout(url, 7000);
  if (!res || !res.ok) return [];
  try { return await res.json(); } catch { return []; }
}


// ── Types ────────────────────────────────────────────────────

/** A resolved image ready for embedding in a jsPDF document */
export interface ResolvedImage {
  dataUrl: string;
  width: number;
  height: number;
  format: 'JPEG' | 'PNG';
  name: string;
}

// ── Constants ────────────────────────────────────────────────

const MAX_IMAGE_DIMENSION = 800;
const JPEG_QUALITY = 0.85;
const FETCH_TIMEOUT_MS = 10000;
const TOKEN_KEY = 'rmpg_token';

// ── Image Fetching ───────────────────────────────────────────

function getAuthToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

/**
 * Fetch a single image by file_id, downscale to max 800px,
 * and return as a base64 data URL ready for jsPDF embedding.
 * Returns null on any failure (graceful degradation).
 */
export async function fetchImageAsBase64(
  fileId: string,
  fileName = 'image',
): Promise<ResolvedImage | null> {
  try {
    const token = getAuthToken();
    const url = `/api/uploads/${fileId}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Authorization': `Bearer ${token}` },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;

    const bmp = await createImageBitmap(blob);

    let w = bmp.width;
    let h = bmp.height;
    if (w > MAX_IMAGE_DIMENSION || h > MAX_IMAGE_DIMENSION) {
      const scale = MAX_IMAGE_DIMENSION / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) { bmp.close(); return null; }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();

    const isTransparent = blob.type === 'image/png' || blob.type === 'image/webp';
    const outType = isTransparent ? 'image/png' : 'image/jpeg';
    const format: 'JPEG' | 'PNG' = isTransparent ? 'PNG' : 'JPEG';

    const outBlob = await canvas.convertToBlob({ type: outType, quality: JPEG_QUALITY });
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(outBlob);
    });

    return { dataUrl, width: w, height: h, format, name: fileName };
  } catch {
    return null;
  }
}

/**
 * Fetch an image from a full URL path (e.g., /api/uploads/{fileId}?token=...).
 * Used for fields like Person.id_image_url that store full URL paths.
 */
export async function fetchImageFromUrl(
  imageUrl: string,
  fileName = 'photo',
): Promise<ResolvedImage | null> {
  try {
    const url = imageUrl;
    const token = getAuthToken();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;

    const bmp = await createImageBitmap(blob);

    let w = bmp.width;
    let h = bmp.height;
    if (w > MAX_IMAGE_DIMENSION || h > MAX_IMAGE_DIMENSION) {
      const scale = MAX_IMAGE_DIMENSION / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) { bmp.close(); return null; }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();

    const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(outBlob);
    });

    return { dataUrl, width: w, height: h, format: 'JPEG', name: fileName };
  } catch {
    return null;
  }
}

/**
 * Fetch all image attachments for an entity (incident, person, vehicle, etc.)
 * Filters to image MIME types only and fetches all in parallel.
 */
export async function fetchEntityImages(
  entityType: string,
  entityId: string | number,
): Promise<ResolvedImage[]> {
  try {
    const attachments = await fetchEntityAttachments(entityType, entityId);
    const imageAttachments = attachments.filter(
      (a: any) => a.mime_type && a.mime_type.startsWith('image/'),
    );

    if (imageAttachments.length === 0) return [];

    const results = await Promise.allSettled(
      imageAttachments.map((a: any) =>
        fetchImageAsBase64(a.file_id, a.original_name || 'attachment'),
      ),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<ResolvedImage | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((img): img is ResolvedImage => img !== null);
  } catch {
    return [];
  }
}
