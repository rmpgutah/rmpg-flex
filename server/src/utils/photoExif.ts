/**
 * photoExif — EXIF GPS extraction for serve-attempt photos.
 *
 * The current serve-attempt endpoint (`POST /api/process-server/:id/attempt`)
 * accepts a `photo_url` string, not a raw file buffer. Physical upload lives in
 * the generic `/api/uploads` multer route and the attempt only stores a
 * reference. Until that flow is refactored to hand a Buffer directly to the
 * attempt route, this helper is the planted seam: call it with the uploaded
 * image buffer to get `{ latitude, longitude }` back, then COALESCE into
 * `serve_attempts` so manually-entered GPS is never overwritten.
 *
 * `exifr.gps()` returns `undefined` for non-images or images without a GPS
 * block. We swallow all errors (corrupt EXIF, unsupported format, etc.)
 * because this is a convenience enrichment, not a validation gate.
 */
import exifr from 'exifr';

export async function extractGpsFromPhoto(
  buf: Buffer,
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const gps = await exifr.gps(buf);
    if (
      gps &&
      typeof gps.latitude === 'number' &&
      typeof gps.longitude === 'number' &&
      Number.isFinite(gps.latitude) &&
      Number.isFinite(gps.longitude) &&
      gps.latitude >= -90 && gps.latitude <= 90 &&
      gps.longitude >= -180 && gps.longitude <= 180
    ) {
      return { latitude: gps.latitude, longitude: gps.longitude };
    }
  } catch {
    /* swallow — helper is best-effort */
  }
  return null;
}
