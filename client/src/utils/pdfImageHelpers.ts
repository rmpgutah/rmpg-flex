// ============================================================
// RMPG Flex — PDF Image Fetch Helpers
// Async functions to fetch, downscale, and prepare images
// for embedding into jsPDF documents.
// NO jsPDF imports here — rendering helpers are in pdfGenerator.ts
// ============================================================

import { apiFetchAttachments } from '../hooks/useApi';

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
    const attachments = await apiFetchAttachments(entityType, entityId);
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

/**
 * Fetch a Mapbox Static Map image for embedding in PDFs.
 * Uses the server-side proxy at /api/mapbox/static/image to protect the token.
 * Returns a ResolvedImage or null on failure (graceful degradation).
 */
export async function fetchStaticMapImage(
  lat: number,
  lng: number,
  options?: {
    zoom?: number;
    width?: number;
    height?: number;
    style?: string;
    markers?: Array<{ lng: number; lat: number; color?: string; label?: string }>;
  },
): Promise<ResolvedImage | null> {
  try {
    const token = getAuthToken();
    const params = new URLSearchParams({
      lng: String(lng),
      lat: String(lat),
      zoom: String(options?.zoom ?? 15),
      width: String(options?.width ?? 600),
      height: String(options?.height ?? 300),
      style: options?.style ?? 'mapbox/dark-v11',
      retina: 'true',
    });
    if (options?.markers?.length) {
      params.set('markers', options.markers.map(m =>
        `${m.lng},${m.lat},${m.color ?? 'd4a017'},${m.label ?? ''}`
      ).join(';'));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`/api/mapbox/static/image?${params}`, {
      signal: controller.signal,
      headers: { 'Authorization': `Bearer ${token}` },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;

    const bmp = await createImageBitmap(blob);
    const w = Math.min(bmp.width, MAX_IMAGE_DIMENSION);
    const h = Math.min(bmp.height, MAX_IMAGE_DIMENSION);

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) { bmp.close(); return null; }

    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();

    const outBlob = await canvas.convertToBlob({ type: 'image/png', quality: 1.0 });
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(outBlob);
    });

    return { dataUrl, width: w, height: h, format: 'PNG', name: 'Location Map' };
  } catch {
    return null;
  }
}
