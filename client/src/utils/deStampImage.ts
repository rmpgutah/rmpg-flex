/**
 * Removes the burned-in photoStamp banner from stored images.
 *
 * photoStamp.ts always draws the banner at the bottom of the image with height:
 *   fontPx  = max(13, round(W / 48))
 *   pad     = round(fontPx * 0.6)
 *   lineH   = round(fontPx * 1.35)
 *   bannerH = 3 * lineH + pad * 2          (always 3 lines)
 *
 * We crop exactly bannerH pixels from the bottom of each image and upload the
 * result to PUT /api/uploads/:fileId/replace (admin only).
 *
 * IMPORTANT: We fetch image bytes via authed fetch() rather than <img crossOrigin>
 * to avoid CORS canvas taint. An <img crossOrigin="anonymous"> drawing onto a canvas
 * requires the server to emit Access-Control-Allow-Origin on the image response;
 * signed R2 download URLs don't include that header. Fetching the bytes directly
 * and passing them to createImageBitmap() sidesteps the taint restriction entirely.
 */

import { apiFetch } from '../hooks/useApi';

/** Re-computes the exact banner height photoStamp.ts burned into an image. */
function stampBannerHeight(imageWidth: number): number {
  const fontPx = Math.max(13, Math.round(imageWidth / 48));
  const pad = Math.round(fontPx * 0.6);
  const lineH = Math.round(fontPx * 1.35);
  return 3 * lineH + pad * 2;
}

export interface DeStampResult {
  fileId: string;
  ok: boolean;
  error?: string;
  originalSize: { w: number; h: number };
  croppedHeight: number;
}

/**
 * Download one stamped image, crop the bottom banner, re-upload.
 * `downloadUrl` must be an authenticated URL (token param or sig param).
 */
export async function deStampOne(fileId: string, downloadUrl: string): Promise<DeStampResult> {
  const token = localStorage.getItem('rmpg_token') ?? '';

  // Fetch image bytes with auth — avoids CORS canvas taint from <img crossOrigin>
  const imgRes = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!imgRes.ok) {
    return { fileId, ok: false, error: `Download failed: HTTP ${imgRes.status}`, originalSize: { w: 0, h: 0 }, croppedHeight: 0 };
  }
  const imgBlob = await imgRes.blob();
  const bitmap = await createImageBitmap(imgBlob);

  const W = bitmap.width;
  const H = bitmap.height;
  const bannerH = stampBannerHeight(W);
  const newH = Math.max(1, H - bannerH);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = newH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return { fileId, ok: false, error: 'Canvas not available', originalSize: { w: W, h: H }, croppedHeight: newH };
  }

  // Draw only the top `newH` rows — leaving the stamp band out entirely.
  ctx.drawImage(bitmap, 0, 0, W, newH, 0, 0, W, newH);
  bitmap.close();

  const outputBlob: Blob = await new Promise((res, rej) =>
    canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed — canvas may still be tainted')), 'image/jpeg', 0.92),
  );

  const putRes = await fetch(`/api/uploads/${fileId}/replace`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'image/jpeg',
    },
    body: outputBlob,
  });

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({})) as { error?: string };
    return { fileId, ok: false, error: err.error ?? `HTTP ${putRes.status}`, originalSize: { w: W, h: H }, croppedHeight: newH };
  }

  return { fileId, ok: true, originalSize: { w: W, h: H }, croppedHeight: newH };
}

/** Fetch all image attachments for an entity and de-stamp each one. */
export async function deStampAll(
  entityType: string,
  entityId: string | number,
  onProgress?: (done: number, total: number, result: DeStampResult) => void,
): Promise<DeStampResult[]> {
  const attachments = await apiFetch<any[]>(`/uploads?entity_type=${entityType}&entity_id=${entityId}`);
  const images = (attachments ?? []).filter((a: any) => (a.mime_type as string)?.startsWith('image/'));

  const token = localStorage.getItem('rmpg_token') ?? '';
  const results: DeStampResult[] = [];
  for (let i = 0; i < images.length; i++) {
    const att = images[i];
    const imgUrl = att.access_sig && att.access_exp
      ? `/api/uploads/${att.file_id}?sig=${encodeURIComponent(att.access_sig)}&exp=${att.access_exp}`
      : `/api/uploads/${att.file_id}?token=${encodeURIComponent(token)}`;
    try {
      const r = await deStampOne(att.file_id, imgUrl);
      results.push(r);
    } catch (e) {
      results.push({ fileId: att.file_id, ok: false, error: String(e), originalSize: { w: 0, h: 0 }, croppedHeight: 0 });
    }
    onProgress?.(i + 1, images.length, results[results.length - 1]);
  }
  return results;
}
