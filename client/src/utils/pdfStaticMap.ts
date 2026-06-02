// Static-map snapshots for record PDFs.
//
// Produces a print-ready raster of a single address location (a Mapbox Static
// Images API render with a marker pin) for embedding into Call / Property /
// Business PDFs via jsPDF's addImage. Resolves coordinates from explicit
// lat/lng when present, otherwise forward-geocodes the address string.
//
// Everything here is best-effort: any failure (no token, no coords,
// geocode miss, network/CORS error, missing OffscreenCanvas in a test
// environment) resolves to null so the caller simply omits the map section
// and the rest of the document renders unchanged.

import { getMapboxAccessToken } from './mapboxApiKey';
import { forwardGeocode } from './mapboxServices';

export interface LocationMapImage {
  dataUrl: string;   // image/jpeg data URL, white-matted (no alpha)
  width: number;     // intrinsic pixel width
  height: number;    // intrinsic pixel height
  lat: number;
  lng: number;
}

export interface LocationMapOptions {
  lat?: number | null;
  lng?: number | null;
  /** Fallback used when lat/lng are absent — forward-geocoded to coordinates. */
  address?: string | null;
  /** Static-image request size in logical px (Mapbox caps each at 1280). */
  widthPx?: number;
  heightPx?: number;
  zoom?: number;
  /** Mapbox style id, e.g. 'mapbox/streets-v12' or 'mapbox/satellite-streets-v12'. */
  style?: string;
  /** Marker color (6-hex, no '#'). Defaults to RMPG gold. */
  markerColor?: string;
}

const isFiniteNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Resolve a location to a rasterized static-map image, or null if it can't
 * be produced. Never throws.
 */
export async function fetchLocationMapImage(opts: LocationMapOptions): Promise<LocationMapImage | null> {
  try {
    let lat = isFiniteNum(opts.lat) ? opts.lat : undefined;
    let lng = isFiniteNum(opts.lng) ? opts.lng : undefined;

    // Geocode the address when coordinates are missing (e.g. business records,
    // which store no lat/lng — verified live 2026-06-01).
    if ((lat === undefined || lng === undefined) && opts.address && opts.address.trim()) {
      try {
        const features = await forwardGeocode(opts.address.trim(), 1);
        const center = features?.[0]?.center;
        if (Array.isArray(center) && isFiniteNum(center[0]) && isFiniteNum(center[1])) {
          lng = center[0];
          lat = center[1];
        }
      } catch { /* geocode unavailable — fall through to null */ }
    }
    if (lat === undefined || lng === undefined) return null;

    const token = await getMapboxAccessToken().catch(() => '');
    if (!token) return null;

    // Mapbox caps the {width}x{height} token at 1280 each; @2x doubles the
    // returned pixels for crisp print without exceeding that cap.
    const w = Math.max(200, Math.min(opts.widthPx ?? 1000, 1280));
    const h = Math.max(120, Math.min(opts.heightPx ?? 440, 1280));
    const zoom = opts.zoom ?? 15;
    const style = opts.style ?? 'mapbox/streets-v12';
    const marker = `pin-l+${opts.markerColor ?? 'd4a017'}(${lng},${lat})`;
    const url =
      `https://api.mapbox.com/styles/v1/${style}/static/${marker}/` +
      `${lng},${lat},${zoom},0/${w}x${h}@2x` +
      `?access_token=${encodeURIComponent(token)}&attribution=true&logo=true`;

    // Plain GET (no Authorization header) so the cross-origin request to
    // api.mapbox.com is a simple request with no CORS preflight.
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;

    // White-matte onto a canvas → JPEG (no alpha) so the PDF embed is dense
    // and predictable. createImageBitmap/OffscreenCanvas mirror the existing
    // pdfImageHelpers pipeline; absent in jsdom tests → caught → null.
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) { bmp.close(); return null; }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, bmp.width, bmp.height);
    ctx.drawImage(bmp, 0, 0);
    const outW = bmp.width;
    const outH = bmp.height;
    bmp.close();

    const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(outBlob);
    });

    return { dataUrl, width: outW, height: outH, lat, lng };
  } catch {
    return null;
  }
}
