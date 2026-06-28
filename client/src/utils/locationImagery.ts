// ============================================================
// RMPG Flex — Location imagery (street-level + perspective + aerial)
// ============================================================
// Powers the visual band in the map "What's Here" popup. Everything here
// is Mapbox-native (no Google) — Mapillary is Mapbox-owned street imagery.
//
// Three sources, layered so a GROUND-LEVEL view ALWAYS appears on click:
//   1. STREET      — Mapillary (Mapbox-owned crowdsourced street-level
//      photos). The real ground-level photo when coverage exists. Activates
//      when a Mapillary token is present (VITE_MAPILLARY_TOKEN at build, or
//      one supplied at runtime via setMapillaryToken). Coverage is sparse in
//      residential suburbs, so it is the *preferred* view, not the only one.
//   2. PERSPECTIVE — Mapbox Static Images API rendered as an OBLIQUE view
//      (high zoom + pitch), giving an angled, ground-ish 3D perspective of
//      the property. Pure URL from the Mapbox token, so it ALWAYS renders —
//      this is the guaranteed ground-perspective floor when Mapillary has no
//      coverage.
//   3. AERIAL      — Mapbox Static Images API top-down satellite. Kept as a
//      small supporting context image.
//
// Mapbox GL JS has NO Google-style Street View; this stack is the closest
// real ground view the platform supports.
// ============================================================

import { getCachedMapboxAccessToken, getMapboxAccessToken } from './mapboxApiKey';

let MAPILLARY_TOKEN: string =
  ((import.meta as any).env?.VITE_MAPILLARY_TOKEN as string | undefined)?.trim() || '';

/** Supply a Mapillary token at runtime (e.g. fetched from the Worker) when it
 *  wasn't baked into the build. No-op if a token is already present. */
export function setMapillaryToken(token: string | null | undefined): void {
  const t = (token || '').trim();
  if (t) MAPILLARY_TOKEN = t;
}

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

export interface PerspectiveOptions {
  zoom?: number;    // 18 ≈ building level
  bearing?: number; // camera rotation (deg)
  pitch?: number;   // 0-60; higher = more ground-level / oblique
  width?: number;
  height?: number;
  /** mapbox style id without the leading `mapbox/`. */
  style?: string;
  /** Drop a gold pin at the point. */
  pin?: boolean;
}

/**
 * Build a Mapbox Static Images API URL for an OBLIQUE, ground-perspective view
 * of a point — high zoom + camera pitch so the property is seen from an angle
 * rather than straight down. This is the guaranteed ground-ish view (same token
 * as the aerial) used when Mapillary has no real street photo at the location.
 *
 * Returns '' if no token is cached yet. Pure string construction — no network.
 */
export function getStreetPerspectiveUrl(lng: number, lat: number, opts: PerspectiveOptions = {}): string {
  const token = getCachedMapboxAccessToken();
  if (!token) return '';
  const {
    zoom = 18, bearing = 20, pitch = 60,
    width = 240, height = 150, style = 'satellite-streets-v12', pin = true,
  } = opts;
  const overlay = pin ? `/pin-s+d4a017(${lng},${lat})` : '';
  const p = Math.max(0, Math.min(60, pitch)); // Static API caps pitch at 60
  // {lng},{lat},{zoom},{bearing},{pitch}
  return `https://api.mapbox.com/styles/v1/mapbox/${style}/static${overlay}/${lng},${lat},${zoom},${bearing},${p}/${width}x${height}@2x`
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
  compassAngle?: number; // degrees the camera was facing (0=N)
  lng?: number;
  lat?: number;
  distanceM?: number;
  /** Compass bearing (deg, 0=N) FROM the photo's location TO the clicked
   *  address — i.e. the direction you'd look to see the address. Drives both
   *  the "facing" label and the oblique-perspective fallback's camera bearing
   *  so every view is aimed at the building, not down the street. */
  bearingToAddress?: number;
  /** Higher-res frame for the expandable street-view lightbox. */
  fullUrl?: string;
}

/** The official Mapillary embeddable, INTERACTIVE street-view viewer for an
 *  image id — pan/look-around in an iframe, no extra JS dependency. Returns ''
 *  when the id is missing. The viewer opens centred on the captured image; we
 *  can't force its initial yaw via the embed URL, so the caller pairs it with
 *  a "look toward address" bearing hint in the UI. */
export function getMapillaryViewerUrl(imageId: string | null | undefined): string {
  const id = (imageId || '').trim();
  if (!id) return '';
  return `https://www.mapillary.com/embed?image_key=${encodeURIComponent(id)}&style=photo`;
}

/** 16-point compass label for a bearing (e.g. 47 → "NE"). Exported for the
 *  What's-Here facing label and the live nav-to-point readout. */
export function compassCardinal(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

/** Great-circle distance (m) + initial bearing (deg, 0=N) between two points.
 *  Exported so the map popup can show a live "X m · NE" nav readout without
 *  re-deriving the haversine math. */
export function distanceAndBearing(
  fromLng: number, fromLat: number, toLng: number, toLat: number,
): { distanceM: number; bearing: number } {
  return {
    distanceM: haversineM(fromLng, fromLat, toLng, toLat),
    bearing: bearingDeg(fromLng, fromLat, toLng, toLat),
  };
}

function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial compass bearing (deg, 0=N) from point A to point B. */
function bearingDeg(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2), Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Smallest absolute angular difference between two compass bearings (0-180). */
function angleDelta(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Find the best Mapillary street-level image for a point. Returns null when
 * Mapillary isn't configured, nothing is in range, or the request fails — the
 * popup falls back to the Mapbox oblique perspective in those cases.
 *
 * Selection isn't purely nearest: we score each candidate by distance AND by
 * whether the camera was facing TOWARD the clicked point (compass_angle vs the
 * bearing from the photo to the point). A photo taken right next to the address
 * but pointing away down the street is useless; one slightly farther but aimed
 * at the property is the real "ground view" the dispatcher wants.
 *
 * @param radiusM search box half-extent in meters (default ~200 m).
 */
export async function findStreetImage(lng: number, lat: number, radiusM = 200, signal?: AbortSignal): Promise<StreetImage | null> {
  if (!MAPILLARY_TOKEN) return null;
  // meters → degrees (lat is ~111320 m/deg; lng shrinks by cos(lat)).
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  const bbox = `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`;
  const url = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(MAPILLARY_TOKEN)}`
    + `&fields=id,thumb_1024_url,thumb_2048_url,captured_at,compass_angle,computed_geometry,geometry&bbox=${bbox}&limit=40`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const json: any = await res.json();
    const items: any[] = Array.isArray(json?.data) ? json.data : [];
    if (!items.length) return null;
    let best: StreetImage | null = null;
    let bestScore = Infinity;
    for (const it of items) {
      const coords = it?.computed_geometry?.coordinates || it?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      if (!it.thumb_1024_url) continue;
      const [ilng, ilat] = coords;
      const d = haversineM(lng, lat, ilng, ilat);
      // Lower is better. Distance dominates; add a penalty (up to ~80 m) for a
      // camera pointing away from the point so a facing photo can beat a closer
      // back-facing one. Recency breaks near-ties.
      let score = d;
      if (typeof it.compass_angle === 'number') {
        const toPoint = bearingDeg(ilng, ilat, lng, lat);
        score += (angleDelta(it.compass_angle, toPoint) / 180) * 80;
      }
      if (typeof it.captured_at === 'number') {
        const ageYears = Math.max(0, (Date.now() - it.captured_at) / (365 * 864e5));
        score += Math.min(ageYears, 10) * 3; // mild freshness nudge
      }
      if (score < bestScore) {
        bestScore = score;
        best = {
          id: String(it.id),
          thumbUrl: it.thumb_1024_url,
          fullUrl: it.thumb_2048_url || it.thumb_1024_url,
          capturedAt: typeof it.captured_at === 'number' ? it.captured_at : undefined,
          compassAngle: typeof it.compass_angle === 'number' ? it.compass_angle : undefined,
          lng: ilng, lat: ilat, distanceM: Math.round(d),
          // Direction to look from the photo toward the clicked address.
          bearingToAddress: bearingDeg(ilng, ilat, lng, lat),
        };
      }
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * Nearest-road viewing bearing — the fallback for "point the photo at the
 * address" where Mapillary has NO ground coverage. Uses the Mapbox Tilequery
 * API to snap to the closest road centerline (`road` layer of the hosted
 * mapbox-streets-v8 tileset), then returns bearing(roadPoint → address): the
 * direction a camera on the street would look to face the building front.
 *
 * Returns null when no token, no road within `radiusM`, or the request fails —
 * the caller then keeps the default perspective angle. `api.mapbox.com` is
 * already allowed by the CSP connect-src, so no policy change is needed.
 */
export async function findNearestRoadBearing(
  lng: number, lat: number, radiusM = 90, signal?: AbortSignal,
): Promise<number | null> {
  const token = getCachedMapboxAccessToken();
  if (!token) return null;
  const url = `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json`
    + `?radius=${radiusM}&limit=1&dedupe=true&layers=road&geometry=linestring`
    + `&access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const json: any = await res.json();
    const f = json?.features?.[0];
    // Tilequery snaps the returned Point to the nearest spot on the road line.
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const [rlng, rlat] = coords;
    // Degenerate (query point sat exactly on the road) → no meaningful bearing.
    if (haversineM(lng, lat, rlng, rlat) < 1) return null;
    return bearingDeg(rlng, rlat, lng, lat);
  } catch {
    return null;
  }
}
