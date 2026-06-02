// ============================================================
// RMPG Flex — Location imagery (aerial + street-level)
// ============================================================
// Powers the visual thumbnail in the map "What's Here" popup.
//
// Two sources, both best-effort and independent so the popup degrades
// gracefully:
//   1. AERIAL  — Mapbox Static Images API (satellite-streets). Built as a
//      plain URL client-side from the already-loaded Mapbox token, so it
//      needs no backend route and ALWAYS renders. This is the guaranteed
//      visual.
//   2. STREET  — Mapillary (Mapbox-owned crowdsourced street-level imagery).
//      Optional: activates only when VITE_MAPILLARY_TOKEN is set at build
//      time. Coverage is sparse in residential suburbs, so this is additive
//      on top of the aerial, never a replacement.
//
// Mapbox GL JS has NO Google-style Street View; Mapillary is the closest
// real street-level photo source available to the platform.
// ============================================================

import { getCachedMapboxAccessToken, getMapboxAccessToken } from './mapboxApiKey';

const MAPILLARY_TOKEN: string =
  ((import.meta as any).env?.VITE_MAPILLARY_TOKEN as string | undefined)?.trim() || '';

export function hasMapillary(): boolean {
  return MAPILLARY_TOKEN.length > 0;
}

export interface AerialThumbOptions {
  zoom?: number;   // 17 ≈ building level
  width?: number;
  height?: number;
  /** mapbox style id without the leading `mapbox/`. */
  style?: string;
  /** Drop a gold pin at the point. */
  pin?: boolean;
}

/**
 * Build a Mapbox Static Images API URL for an aerial close-up of a point.
 * Returns '' if no token is cached yet (caller should treat as "no image").
 * Pure string construction — no network call here.
 */
export function getAerialThumbUrl(lng: number, lat: number, opts: AerialThumbOptions = {}): string {
  const token = getCachedMapboxAccessToken();
  if (!token) return '';
  const { zoom = 17, width = 240, height = 150, style = 'satellite-streets-v12', pin = true } = opts;
  const overlay = pin ? `/pin-s+d4a017(${lng},${lat})` : '';
  // {lng},{lat},{zoom},{bearing},{pitch}
  return `https://api.mapbox.com/styles/v1/mapbox/${style}/static${overlay}/${lng},${lat},${zoom},0/${width}x${height}@2x`
    + `?access_token=${encodeURIComponent(token)}&attribution=false&logo=false`;
}

/** Kick a token fetch so getAerialThumbUrl has something cached. Fire-and-forget. */
export function warmImageryToken(): void {
  if (!getCachedMapboxAccessToken()) { getMapboxAccessToken().catch(() => {}); }
}

export interface StreetImage {
  id: string;
  thumbUrl: string;
  capturedAt?: number;   // epoch ms
  compassAngle?: number; // degrees
  lng?: number;
  lat?: number;
  distanceM?: number;
}

function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Find the nearest Mapillary street-level image to a point. Returns null when
 * Mapillary isn't configured, nothing is in range, or the request fails — the
 * popup just shows the aerial in those cases.
 *
 * @param radiusM search box half-extent in meters (default ~120 m).
 */
export async function findStreetImage(lng: number, lat: number, radiusM = 120, signal?: AbortSignal): Promise<StreetImage | null> {
  if (!MAPILLARY_TOKEN) return null;
  // meters → degrees (lat is ~111320 m/deg; lng shrinks by cos(lat)).
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  const bbox = `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`;
  const url = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(MAPILLARY_TOKEN)}`
    + `&fields=id,thumb_1024_url,captured_at,compass_angle,computed_geometry,geometry&bbox=${bbox}&limit=15`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const json: any = await res.json();
    const items: any[] = Array.isArray(json?.data) ? json.data : [];
    if (!items.length) return null;
    let best: StreetImage | null = null;
    for (const it of items) {
      const coords = it?.computed_geometry?.coordinates || it?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const [ilng, ilat] = coords;
      const d = haversineM(lng, lat, ilng, ilat);
      if (!it.thumb_1024_url) continue;
      if (!best || d < (best.distanceM ?? Infinity)) {
        best = {
          id: String(it.id),
          thumbUrl: it.thumb_1024_url,
          capturedAt: typeof it.captured_at === 'number' ? it.captured_at : undefined,
          compassAngle: typeof it.compass_angle === 'number' ? it.compass_angle : undefined,
          lng: ilng, lat: ilat, distanceM: Math.round(d),
        };
      }
    }
    return best;
  } catch {
    return null;
  }
}
