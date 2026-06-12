// Static-map snapshots for record PDFs.
//
// Produces a print-ready raster of a single address location (a Mapbox Static
// Images API render with a marker pin) for embedding into Call / Property /
// Business PDFs via jsPDF's addImage. Resolves coordinates from explicit
// lat/lng when present, otherwise forward-geocodes the address string.
//
// CRITICAL ISOLATION RULE: this runs inside the PDF generation critical path,
// so it MUST NOT use the app's `apiFetch`. apiFetch is auth-coupled — on a 401
// it attempts a token refresh and, on failure, does `window.location.href =
// '/login'`, which would tear down the app (and any open PDF viewer) mid-print
// ("opens then goes blank", fixed 2026-06-01). Instead we use the sync cached
// Mapbox token and talk to api.mapbox.com directly. Every network call is
// timeout-bounded, and every failure path resolves to null so the caller
// simply omits the map section and the rest of the document renders unchanged.

import { getCachedMapboxAccessToken } from './mapboxApiKey';

/** One computed egress (exit) route from the target location. */
export interface EgressRoute {
  label: string;            // 'A' | 'B' | 'C'
  distanceM: number;        // driving distance, meters
  durationS: number;        // driving time, seconds
  via: string;              // first named road on the route (UPPER), '' if unnamed
  compass: string;          // overall direction of travel from target (N/NE/...)
  end: [number, number];    // [lng, lat] of the route's far end
}

export interface LocationMapImage {
  dataUrl: string;   // image/jpeg data URL, white-matted (no alpha)
  width: number;     // intrinsic pixel width
  height: number;    // intrinsic pixel height
  lat: number;
  lng: number;
  /** Drivable exit routes baked into the raster as cased path lines
   *  (present only when opts.egressRoutes was set and Directions
   *  succeeded — best-effort, may be absent/empty). */
  egress?: EgressRoute[];
  /** Wide-area overview raster (streets style, ~z13) for the
   *  picture-in-picture inset. Present only when opts.overviewInset. */
  insetDataUrl?: string;
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
  /** Compute drivable exit routes (Mapbox Directions, best-effort) and
   *  bake them into the raster as cased path lines. */
  egressRoutes?: boolean;
  /** Also fetch a wide-area overview raster for a PiP inset. */
  overviewInset?: boolean;
}

const isFiniteNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

const GEOCODE_TIMEOUT_MS = 5000;
const STATIC_TIMEOUT_MS = 7000;

/** fetch() with a hard AbortController timeout — never hangs the PDF path. */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Direct Mapbox Geocoding v5 (no apiFetch / auth coupling). Returns [lng,lat] or null. */
async function directForwardGeocode(query: string, token: string): Promise<[number, number] | null> {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?limit=1&country=us&access_token=${encodeURIComponent(token)}`;
  const res = await fetchWithTimeout(url, GEOCODE_TIMEOUT_MS);
  if (!res || !res.ok) return null;
  const data = await res.json().catch(() => null);
  const center = data?.features?.[0]?.center;
  if (Array.isArray(center) && isFiniteNum(center[0]) && isFiniteNum(center[1])) {
    return [center[0], center[1]];
  }
  return null;
}

const DIRECTIONS_TIMEOUT_MS = 6000;

/** Google polyline encoding (precision 5) — Mapbox static `path()` overlays
 *  take encoded polylines, which keeps the URL far under the 8KB cap. */
function encodePolyline(coords: [number, number][]): string {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lng, lat] of coords) {
    const iLat = Math.round(lat * 1e5);
    const iLng = Math.round(lng * 1e5);
    out += enc(iLat - prevLat) + enc(iLng - prevLng);
    prevLat = iLat;
    prevLng = iLng;
  }
  return out;
}

const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function compass8(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
  const dy = toLat - fromLat;
  const dx = (toLng - fromLng) * Math.cos((fromLat * Math.PI) / 180);
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return COMPASS_8[Math.round(deg / 45) % 8];
}

/**
 * Compute up to 3 distinct drivable exit routes away from the target via
 * Mapbox Directions (driving). Destinations are offset ~550m at the four
 * cardinal bearings; routes that converge onto the same corridor (far ends
 * within ~120m of each other) are deduped, shortest kept. Best-effort: any
 * network/parse failure just drops that bearing.
 */
async function fetchEgressRoutes(
  lat: number,
  lng: number,
  token: string,
): Promise<{ route: EgressRoute; coords: [number, number][] }[]> {
  const OFFSET_M = 550;
  const latRad = (lat * Math.PI) / 180;
  const dests: [number, number][] = [0, 90, 180, 270].map((bDeg) => {
    const b = (bDeg * Math.PI) / 180;
    const dLat = (OFFSET_M * Math.cos(b)) / 111320;
    const dLng = (OFFSET_M * Math.sin(b)) / (111320 * Math.cos(latRad));
    return [lng + dLng, lat + dLat];
  });

  const results = await Promise.all(dests.map(async ([dl, da]) => {
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving/` +
      `${lng},${lat};${dl},${da}` +
      `?geometries=geojson&overview=simplified&steps=true&access_token=${encodeURIComponent(token)}`;
    const res = await fetchWithTimeout(url, DIRECTIONS_TIMEOUT_MS);
    if (!res || !res.ok) return null;
    const data = await res.json().catch(() => null);
    const r = data?.routes?.[0];
    const coords: unknown = r?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2 || !isFiniteNum(r?.distance)) return null;
    const steps: { name?: string }[] = r?.legs?.[0]?.steps ?? [];
    const via = (steps.find((s) => s.name && s.name.trim())?.name || '').toUpperCase();
    return { coords: coords as [number, number][], distanceM: r.distance as number, durationS: isFiniteNum(r?.duration) ? (r.duration as number) : 0, via };
  }));

  // Dedupe corridors: two routes whose far ends sit within ~120m share an
  // egress corridor — keep the shorter.
  const kept: { coords: [number, number][]; distanceM: number; durationS: number; via: string }[] = [];
  for (const r of results.filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => a.distanceM - b.distanceM)) {
    const end = r.coords[r.coords.length - 1];
    const clash = kept.some((k) => {
      const ke = k.coords[k.coords.length - 1];
      const dy = (ke[1] - end[1]) * 111320;
      const dx = (ke[0] - end[0]) * 111320 * Math.cos(latRad);
      return Math.hypot(dx, dy) < 120;
    });
    if (!clash) kept.push(r);
    if (kept.length >= 3) break;
  }

  return kept.map((r, i) => ({
    coords: r.coords,
    route: {
      label: String.fromCharCode(65 + i),
      distanceM: r.distanceM,
      durationS: r.durationS,
      via: r.via,
      compass: compass8(lat, lng, r.coords[r.coords.length - 1][1], r.coords[r.coords.length - 1][0]),
      end: r.coords[r.coords.length - 1],
    },
  }));
}

// ── Tactical context (elevation + nearest support facilities) ──────────────

export interface TacticalPoi {
  kind: string;             // 'MEDICAL' | 'FIRE' | 'LAW ENF'
  name: string;             // facility name (UPPER)
  distanceM: number;        // straight-line meters from target
  compass: string;          // bearing from target (N/NE/...)
}

/** Plottable hazard / sensitive-occupancy site near the target. */
export interface TacticalHazard {
  kind: 'SCHOOL' | 'DAYCARE' | 'FUEL';
  letter: string;           // map-symbol letter: S / D / F
  name: string;             // UPPER
  lat: number;
  lng: number;
  distanceM: number;
  compass: string;
}

export interface TacticalContext {
  elevationM?: number;      // ground elevation at target (terrain contour)
  pois: TacticalPoi[];
  /** Schools / daycares / fuel within ~700m — sensitive occupancies and
   *  fire/explosion hazards a planner must clear or stage away from. */
  hazards: TacticalHazard[];
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Best-effort tactical context for the location-analysis block: ground
 * elevation (Mapbox terrain tilequery) and the nearest hospital / fire
 * station / police facility (POI geocoding with proximity bias). Same
 * isolation rules as the static map: cached token only, every call
 * timeout-bounded, every failure degrades to "absent".
 */
export async function fetchTacticalContext(lat: number, lng: number): Promise<TacticalContext | null> {
  try {
    const token = getCachedMapboxAccessToken();
    if (!token) return null;

    const elevP = (async (): Promise<number | undefined> => {
      const url =
        `https://api.mapbox.com/v4/mapbox.mapbox-terrain-v2/tilequery/${lng},${lat}.json` +
        `?layers=contour&limit=1&access_token=${encodeURIComponent(token)}`;
      const res = await fetchWithTimeout(url, GEOCODE_TIMEOUT_MS);
      if (!res || !res.ok) return undefined;
      const data = await res.json().catch(() => null);
      const ele = data?.features?.[0]?.properties?.ele;
      return isFiniteNum(ele) ? ele : undefined;
    })();

    const POI_QUERIES: { kind: string; q: string }[] = [
      { kind: 'MEDICAL', q: 'hospital' },
      { kind: 'FIRE', q: 'fire station' },
      { kind: 'LAW ENF', q: 'police' },
    ];
    const poiP = Promise.all(POI_QUERIES.map(async ({ kind, q }): Promise<TacticalPoi | null> => {
      const url =
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
        `?proximity=${lng},${lat}&types=poi&limit=1&country=us&access_token=${encodeURIComponent(token)}`;
      const res = await fetchWithTimeout(url, GEOCODE_TIMEOUT_MS);
      if (!res || !res.ok) return null;
      const data = await res.json().catch(() => null);
      const f = data?.features?.[0];
      const c = f?.center;
      if (!f?.text || !Array.isArray(c) || !isFiniteNum(c[0]) || !isFiniteNum(c[1])) return null;
      return {
        kind,
        name: String(f.text).toUpperCase(),
        distanceM: haversineM(lat, lng, c[1], c[0]),
        compass: compass8(lat, lng, c[1], c[0]),
      };
    }));

    const HAZARD_QUERIES: { kind: TacticalHazard['kind']; letter: string; q: string }[] = [
      { kind: 'SCHOOL', letter: 'S', q: 'school' },
      { kind: 'DAYCARE', letter: 'D', q: 'daycare' },
      { kind: 'FUEL', letter: 'F', q: 'gas station' },
    ];
    const HAZARD_RADIUS_M = 700;
    const hazP = Promise.all(HAZARD_QUERIES.map(async ({ kind, letter, q }): Promise<TacticalHazard[]> => {
      const url =
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
        `?proximity=${lng},${lat}&types=poi&limit=3&country=us&access_token=${encodeURIComponent(token)}`;
      const res = await fetchWithTimeout(url, GEOCODE_TIMEOUT_MS);
      if (!res || !res.ok) return [];
      const data = await res.json().catch(() => null);
      const feats: { text?: string; center?: [number, number] }[] = data?.features ?? [];
      return feats
        .filter((f) => f.text && Array.isArray(f.center) && isFiniteNum(f.center[0]) && isFiniteNum(f.center[1]))
        .map((f) => ({
          kind, letter,
          name: String(f.text).toUpperCase(),
          lat: f.center![1], lng: f.center![0],
          distanceM: haversineM(lat, lng, f.center![1], f.center![0]),
          compass: compass8(lat, lng, f.center![1], f.center![0]),
        }))
        .filter((h) => h.distanceM <= HAZARD_RADIUS_M);
    }));

    const [elevationM, pois, hazNested] = await Promise.all([elevP, poiP, hazP]);
    return {
      elevationM,
      pois: pois.filter((p): p is TacticalPoi => !!p),
      hazards: hazNested.flat().sort((a, b) => a.distanceM - b.distanceM).slice(0, 4),
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a location to a rasterized static-map image, or null if it can't
 * be produced. Never throws, never blocks indefinitely, never touches auth.
 */
export async function fetchLocationMapImage(opts: LocationMapOptions): Promise<LocationMapImage | null> {
  try {
    // Sync cached token only — no apiFetch (see ISOLATION RULE above). The
    // token is build-embedded / cached once the live map has loaded; if it
    // isn't available we simply skip the map rather than risk an auth call.
    const token = getCachedMapboxAccessToken();
    if (!token) return null;

    let lat = isFiniteNum(opts.lat) ? opts.lat : undefined;
    let lng = isFiniteNum(opts.lng) ? opts.lng : undefined;

    // Geocode the address when coordinates are missing (e.g. business records,
    // which store no lat/lng — verified live 2026-06-01).
    if ((lat === undefined || lng === undefined) && opts.address && opts.address.trim()) {
      const center = await directForwardGeocode(opts.address.trim(), token);
      if (center) { lng = center[0]; lat = center[1]; }
    }
    if (lat === undefined || lng === undefined) return null;

    // Mapbox caps the {width}x{height} token at 1280 each; @2x doubles the
    // returned pixels for crisp print without exceeding that cap.
    const w = Math.max(200, Math.min(opts.widthPx ?? 1000, 1280));
    const h = Math.max(120, Math.min(opts.heightPx ?? 440, 1280));
    const zoom = opts.zoom ?? 15;
    const style = opts.style ?? 'mapbox/streets-v12';
    // Egress overlays: each route is a cased line (dark 5px under, white
    // 2.5px over) so it reads over any satellite ground cover. Computed
    // before the static request so the paths bake into the raster.
    let egressInfo: EgressRoute[] | undefined;
    let pathOverlays = '';
    if (opts.egressRoutes) {
      const found = await fetchEgressRoutes(lat, lng, token);
      if (found.length) {
        egressInfo = found.map((f) => f.route);
        pathOverlays = found
          .map((f) => {
            const enc = encodeURIComponent(encodePolyline(f.coords));
            return `path-5+0a0a0a-0.9(${enc}),path-2.5+ffffff-1(${enc})`;
          })
          .join(',') + ',';
      }
    }

    const marker = `pin-l+${opts.markerColor ?? 'd4a017'}(${lng},${lat})`;
    const url =
      `https://api.mapbox.com/styles/v1/${style}/static/${pathOverlays}${marker}/` +
      `${lng},${lat},${zoom},0/${w}x${h}@2x` +
      `?access_token=${encodeURIComponent(token)}&attribution=true&logo=true`;

    // Plain GET (no Authorization header) → simple cross-origin request, no
    // CORS preflight; timeout-bounded so generation never hangs on the network.
    const res = await fetchWithTimeout(url, STATIC_TIMEOUT_MS);
    if (!res || !res.ok) return null;
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

    // Wide-area overview inset (PiP) — separate small streets-style render
    // at z13 so arterials/highways context frames the close-up. Best-effort.
    let insetDataUrl: string | undefined;
    if (opts.overviewInset) {
      const insetUrl =
        `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/` +
        `pin-s+d4a017(${lng},${lat})/${lng},${lat},13,0/300x200@2x` +
        `?access_token=${encodeURIComponent(token)}&attribution=false&logo=false`;
      const insetRes = await fetchWithTimeout(insetUrl, STATIC_TIMEOUT_MS);
      if (insetRes && insetRes.ok) {
        const insetBlob = await insetRes.blob();
        if (insetBlob.type.startsWith('image/')) {
          try {
            const ibmp = await createImageBitmap(insetBlob);
            const icv = new OffscreenCanvas(ibmp.width, ibmp.height);
            const ictx = icv.getContext('2d');
            if (ictx) {
              ictx.fillStyle = '#ffffff';
              ictx.fillRect(0, 0, ibmp.width, ibmp.height);
              ictx.drawImage(ibmp, 0, 0);
              const ib = await icv.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
              const ir = new FileReader();
              insetDataUrl = await new Promise<string>((resolve, reject) => {
                ir.onload = () => resolve(ir.result as string);
                ir.onerror = reject;
                ir.readAsDataURL(ib);
              });
            }
            ibmp.close();
          } catch { /* inset is optional — skip on any decode failure */ }
        }
      }
    }

    return { dataUrl, width: outW, height: outH, lat, lng, egress: egressInfo, insetDataUrl };
  } catch {
    return null;
  }
}
