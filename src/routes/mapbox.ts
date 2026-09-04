// ============================================================
// Mapbox server-side proxy
// ============================================================
// Backs client/src/utils/mapboxServices.ts. Those helpers call
// /api/mapbox/* (geocode, reverse-geocode, directions, isochrone,
// matrix, optimization, map-matching, tilequery, static-map,
// token-status) but no server ever mounted that prefix, so every
// one of them 404'd. This router proxies each to api.mapbox.com
// server-side using the MAPBOX_ACCESS_TOKEN secret, returning the
// exact response shapes the client interfaces declare.
//
// Mounted at /api/mapbox with auth:'required' (every caller is an
// authenticated page). When the token is unset it 503s with a clear
// not-configured payload rather than crashing — the codebase 503
// convention for optional integrations.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { notConfigured } from '../utils/notConfigured';
import { routeCrossesExclusionZone, type ExclusionZone, type LngLat } from '../utils/navExclusionZones';
import { log } from '../utils/logger';

const mapbox = new Hono<Env>();

const MB = 'https://api.mapbox.com';
const TIMEOUT_MS = 12_000;

function token(c: any): string | null {
  const t = (c.env?.MAPBOX_ACCESS_TOKEN as string)
    || (c.env?.VITE_MAPBOX_ACCESS_TOKEN as string)
    || null;
  if (t && t.startsWith('sk.')) {
    console.warn('[mapbox] Rejected sk.* secret token in server-side proxy');
    return null;
  }
  return t;
}

function tokenMissing(c: any) {
  return c.json(
    { error: 'Mapbox not configured', code: 'MAPBOX_TOKEN_UNSET', detail: 'Set the MAPBOX_ACCESS_TOKEN Worker secret to enable server-side Mapbox features.' },
    503,
  );
}

// fetch + abort-timeout. Returns the upstream JSON or throws.
async function mbFetch(url: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    const text = await resp.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (!resp.ok) {
      const e: any = new Error(`Mapbox ${resp.status}`);
      e.status = resp.status; e.body = body;
      throw e;
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

function fail(c: any, err: any, label: string) {
  const status = (err as { status?: number })?.status && err.status >= 400 && err.status < 600 ? err.status : 502;
  return c.json({ error: `Mapbox ${label} failed`, code: 'MAPBOX_UPSTREAM_ERROR', detail: err instanceof Error ? err instanceof Error ? err.message : String(err) : String(err), upstream: err?.body?.message }, status);
}

// ── Geocoding ──────────────────────────────────────────────
// GET /api/mapbox/geocode?q=&limit=&types=&proximity=&country=  → { features: [...] }
mapbox.get('/geocode', async (c) => {
  const tk = token(c);
  if (!tk) return tokenMissing(c);
  const q = (c.req.query('q') || '').trim();
  if (!q) return c.json({ error: 'q is required' }, 400);
  const limit = c.req.query('limit') || '5';
  const types = c.req.query('types');
  const proximity = c.req.query('proximity');
  const country = c.req.query('country');
  const params = new URLSearchParams({ access_token: tk, limit, autocomplete: 'true', country: country || 'us' });
  if (types) params.set('types', types);
  if (proximity) params.set('proximity', proximity);
  try {
    const data = await mbFetch(`${MB}/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?${params}`);
    return c.json({ features: data?.features ?? [] });
  } catch (err) { return fail(c, err, 'geocode'); }
});

// GET /api/mapbox/reverse-geocode?lng=&lat=  → { features: [...] }
mapbox.get('/reverse-geocode', async (c) => {
  const tk = token(c);
  if (!tk) return tokenMissing(c);
  const lng = c.req.query('lng'); const lat = c.req.query('lat');
  if (lng == null || lat == null) return c.json({ error: 'lng and lat are required' }, 400);
  const params = new URLSearchParams({ access_token: tk, limit: '1' });
  try {
    const data = await mbFetch(`${MB}/geocoding/v5/mapbox.places/${encodeURIComponent(lng)},${encodeURIComponent(lat)}.json?${params}`);
    return c.json({ features: data?.features ?? [] });
  } catch (err) { return fail(c, err, 'reverse-geocode'); }
});

// ── Directions ─────────────────────────────────────────────
// GET /api/mapbox/directions?coordinates=&profile=&alternatives=&annotations=&depart_at=  → { routes: [...] }
mapbox.get('/directions', async (c) => {
  const tk = token(c);
  if (!tk) return tokenMissing(c);
  const coordinates = c.req.query('coordinates');
  if (!coordinates) return c.json({ error: 'coordinates are required' }, 400);
  const profile = c.req.query('profile') || 'driving-traffic';
  const params = new URLSearchParams({
    access_token: tk,
    alternatives: c.req.query('alternatives') || 'false',
    overview: c.req.query('overview') || 'full',
    geometries: c.req.query('geometries') || 'geojson',
    steps: c.req.query('steps') || 'true',
  });
  // Per-segment congestion (used by the nav guidance engine's traffic-colored
  // route line) is opt-in on Mapbox's side — only forward it when a caller
  // actually asks for it, since it inflates the response for callers that
  // just want the polyline.
  const annotations = c.req.query('annotations');
  if (annotations) params.set('annotations', annotations);
  // depart_at enables time-of-day traffic-aware routing (driving-traffic only).
  // Mapbox rejects depart_at > ~30 min in the past with HTTP 422 — callers
  // should clamp via clampDepartAtForMapbox before sending.
  const departAt = c.req.query('depart_at');
  if (departAt && profile === 'driving-traffic') params.set('depart_at', departAt);
  try {
    const data = await mbFetch(`${MB}/directions/v5/mapbox/${encodeURIComponent(profile)}/${coordinates}?${params}`);
    const routes = data?.routes ?? [];
    const excludedZoneWarning = await checkExclusionZones(c, routes);
    return c.json({
      routes,
      waypoints: data?.waypoints ?? [],
      code: data?.code,
      ...(excludedZoneWarning ? { excludedZoneWarning: true } : {}),
    });
  } catch (err) { return fail(c, err, 'directions'); }
});

// Best-effort exclusion-zone check for a Directions response's route
// geometry. Only meaningful when the geometry is GeoJSON (the /directions
// handler above defaults geometries=geojson, so route.geometry.coordinates
// is present unless a caller explicitly asked for polyline/polyline6).
// Never throws — a geofence lookup failure shouldn't block routing.
async function checkExclusionZones(c: any, routes: any[]): Promise<boolean> {
  try {
    const db = c.env?.DB;
    if (!db || !Array.isArray(routes) || routes.length === 0) return false;
    const coords: unknown = routes[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length === 0) return false;
    const routeCoords: LngLat[] = coords
      .filter((pt: unknown): pt is number[] => Array.isArray(pt) && pt.length >= 2)
      .map((pt: number[]) => ({ lng: pt[0], lat: pt[1] }));
    if (routeCoords.length === 0) return false;

    const { results } = await db
      .prepare(`SELECT id, geojson_data FROM geofence_zones WHERE is_active = 1 AND zone_type = 'exclusion'`)
      .all();
    const zones: ExclusionZone[] = (results ?? []).map((r: any) => ({ id: r.id, geojsonData: r.geojson_data }));
    if (zones.length === 0) return false;

    return routeCrossesExclusionZone(routeCoords, zones, (zone, shapeType) => {
      log.warn('Exclusion zone has an unrecognized geometry shape — skipped in routing check', {
        zoneId: zone.id,
        shapeType,
      });
    });
  } catch (err) {
    log.error('Exclusion zone check failed', {}, err instanceof Error ? err : new Error(String(err)));
    return false;
  }
}

// ── Isochrone ──────────────────────────────────────────────
// GET /api/mapbox/isochrone?lng=&lat=&minutes=&profile=  → { features: [...] }
mapbox.get('/isochrone', async (c) => {
  const tk = token(c);
  if (!tk) return tokenMissing(c);
  const lng = c.req.query('lng'); const lat = c.req.query('lat');
  if (lng == null || lat == null) return c.json({ error: 'lng and lat are required' }, 400);
  const profile = c.req.query('profile') || 'driving';
  const minutes = c.req.query('minutes') || '5,10';
  const params = new URLSearchParams({ access_token: tk, contours_minutes: minutes, polygons: c.req.query('polygons') || 'true' });
  try {
    const data = await mbFetch(`${MB}/isochrone/v1/mapbox/${encodeURIComponent(profile)}/${encodeURIComponent(lng)},${encodeURIComponent(lat)}?${params}`);
    return c.json({ features: data?.features ?? [] });
  } catch (err) { return fail(c, err, 'isochrone'); }
});

// ── Matrix ─────────────────────────────────────────────────
// GET /api/mapbox/matrix?coordinates=&profile=&sources=&destinations=
mapbox.get('/matrix', async (c) => {
  const tk = token(c);
  if (!tk) return tokenMissing(c);
  const coordinates = c.req.query('coordinates');
  if (!coordinates) return c.json({ error: 'coordinates are required' }, 400);
  const profile = c.req.query('profile') || 'driving';
  const params = new URLSearchParams({ access_token: tk, annotations: c.req.query('annotations') || 'duration,distance' });
  const sources = c.req.query('sources'); const destinations = c.req.query('destinations');
  if (sources) params.set('sources', sources);
  if (destinations) params.set('destinations', destinations);
  try {
    const data = await mbFetch(`${MB}/directions-matrix/v1/mapbox/${encodeURIComponent(profile)}/${coordinates}?${params}`);
    return c.json(data);
  } catch (err) { return fail(c, err, 'matrix'); }
});

// ── Optimization ───────────────────────────────────────────
// GET /api/mapbox/optimization?coordinates=&profile=&source=&destination=&roundtrip=&steps=&annotations=
mapbox.get('/optimization', async (c) => {
  const tk = token(c);
  if (!tk) return tokenMissing(c);
  const coordinates = c.req.query('coordinates');
  if (!coordinates) return c.json({ error: 'coordinates are required' }, 400);
  const profile = c.req.query('profile') || 'driving';
  const params = new URLSearchParams({
    access_token: tk,
    source: c.req.query('source') || 'any',
    destination: c.req.query('destination') || 'any',
    roundtrip: c.req.query('roundtrip') || 'false',
    geometries: 'geojson',
    overview: 'full',
    steps: c.req.query('steps') || 'false',
  });
  // Per-leg duration/distance (used to rebuild the drawn line minus the
  // synthetic return-to-start leg — see useMapRouting.ts's showMultiStopRoute
  // comment on why this is solved as a roundtrip) is opt-in, same as Directions.
  const annotations = c.req.query('annotations');
  if (annotations) params.set('annotations', annotations);
  try {
    const data = await mbFetch(`${MB}/optimized-trips/v1/mapbox/${encodeURIComponent(profile)}/${coordinates}?${params}`);
    return c.json(data);
  } catch (err) { return fail(c, err, 'optimization'); }
});

// ── Map matching ───────────────────────────────────────────
// POST /api/mapbox/map-matching  { coordinates: [[lng,lat],...], profile }
mapbox.post('/map-matching', async (c) => {
  const tk = token(c);
  if (!tk) return tokenMissing(c);
  let body: any = {};
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  const coords = Array.isArray(body?.coordinates) ? body.coordinates : [];
  if (coords.length < 2) return c.json({ error: 'at least 2 coordinates are required' }, 400);
  const profile = body?.profile || 'driving';
  const coordStr = coords.map((p: number[]) => `${p[0]},${p[1]}`).join(';');
  const params = new URLSearchParams({ access_token: tk, geometries: 'geojson', overview: 'full' });
  try {
    const data = await mbFetch(`${MB}/matching/v5/mapbox/${encodeURIComponent(profile)}/${coordStr}?${params}`);
    return c.json(data);
  } catch (err) { return fail(c, err, 'map-matching'); }
});

// ── Tilequery ──────────────────────────────────────────────
// GET /api/mapbox/tilequery?lng=&lat=&radius=&limit=&layer=
// Needs a tileset; default to mapbox.mapbox-streets-v8 unless a
// MAPBOX_TILEQUERY_TILESET env override is set.
mapbox.get('/tilequery', async (c) => {
  const tk = token(c);
  if (!tk) return tokenMissing(c);
  const lng = c.req.query('lng'); const lat = c.req.query('lat');
  if (lng == null || lat == null) return c.json({ error: 'lng and lat are required' }, 400);
  const tileset = (c.env as any).MAPBOX_TILEQUERY_TILESET || 'mapbox.mapbox-streets-v8';
  const params = new URLSearchParams({ access_token: tk, radius: c.req.query('radius') || '50', limit: c.req.query('limit') || '10' });
  const layer = c.req.query('layer'); if (layer) params.set('layers', layer);
  try {
    const data = await mbFetch(`${MB}/v4/${tileset}/tilequery/${encodeURIComponent(lng)},${encodeURIComponent(lat)}.json?${params}`);
    return c.json(data);
  } catch (err) { return fail(c, err, 'tilequery'); }
});

// ── Boundaries ─────────────────────────────────────────────
// GET /api/mapbox/boundaries?lng=&lat=  → { county, municipality, place, source }
// Resolves administrative jurisdiction for a point via the Mapbox Boundaries
// API. This is a paid Mapbox add-on — access is not guaranteed on every
// token. A 403/404 upstream is NOT a token-missing case (that's handled by
// the shared `token()`/`tokenMissing()` pair above); it means the account
// lacks the Boundaries entitlement, so we return the 200 skip shape instead
// of a hard error — the client shows an "unavailable" badge, not a crash.
mapbox.get('/boundaries', async (c) => {
  const tk = token(c);
  if (!tk) return tokenMissing(c);
  const lng = c.req.query('lng'); const lat = c.req.query('lat');
  if (lng == null || lat == null) return c.json({ error: 'lng and lat are required' }, 400);
  const params = new URLSearchParams({ access_token: tk });
  // Tileset ID 'adm2' is a best-guess (Mapbox's admin-2 = county-equivalent
  // level in the US). Confirm the exact tileset ID this account is
  // provisioned for once a live token is available — adjust this literal
  // if the real ID differs (Mapbox docs: Boundaries v4 tilesets).
  try {
    const data = await mbFetch(`${MB}/boundaries/v4/adm2/tilequery/${encodeURIComponent(lng)},${encodeURIComponent(lat)}.json?${params}`);
    const feature = (data?.features ?? [])[0];
    if (feature) {
      // Boundaries resolves the county but carries no municipality layer at
      // adm2, so fill that half from reverse geocoding rather than shipping
      // a permanent null (the previous behaviour).
      const ctx = await reverseGeocodeJurisdiction(tk, lng, lat).catch(() => null);
      return c.json({
        county: feature.properties?.name ?? ctx?.county ?? null,
        municipality: ctx?.municipality ?? null,
        place: ctx?.place ?? null,
        source: 'mapbox-boundaries',
      });
    }
    // Entitled but no feature at this point — still try geocoding.
  } catch (err) {
    if ((err as { status?: number })?.status !== 401 && (err as { status?: number })?.status !== 403 && (err as { status?: number })?.status !== 404) {
      return fail(c, err, 'boundaries');
    }
    // 401/403/404 = the account lacks the Boundaries entitlement. Boundaries
    // v4 is a paid enterprise add-on and the `adm2` tileset id here was
    // never verified against a provisioned account, so this is the NORMAL
    // path on a standard token, not an exception. It used to return the
    // 503 skip shape, which is why the Properties/Warrants panels rendered
    // a permanent "Jurisdiction unavailable" badge.
    log.info('[mapbox/boundaries] no Boundaries entitlement — falling back to reverse geocoding', {
      status: (err as { status?: number })?.status,
    });
  }

  // ── Fallback: Geocoding v5 context ────────────────────────────────────
  // Free, on the same token that already backs every other route in this
  // file, and it carries exactly what the panel needs: `district` is the
  // US county and `place` is the incorporated municipality. No extra
  // entitlement, no extra secret, no new failure mode.
  try {
    const ctx = await reverseGeocodeJurisdiction(tk, lng, lat);
    if (!ctx) {
      return c.json({ county: null, municipality: null, place: null, source: 'mapbox-geocoding' });
    }
    return c.json({ ...ctx, source: 'mapbox-geocoding' });
  } catch (err) {
    // BOTH sources are unavailable. Keep the original 200 skip shape rather
    // than propagating the upstream status: a jurisdiction lookup is an
    // advisory side-panel badge, and failing it must not surface as a hard
    // error on the Properties/Warrants page. The client already renders
    // `skipped` as an "unavailable" badge, so this preserves the contract
    // that predates the geocoding fallback — the fallback only ever REPLACES
    // that shape when it actually resolves something.
    log.warn('[mapbox/boundaries] geocoding fallback also failed — reporting unavailable', {
      status: (err as { status?: number })?.status,
    });
    return notConfigured(c, 'Jurisdiction lookup unavailable — Mapbox Boundaries not enabled and reverse geocoding failed');
  }
});

/**
 * Resolve county / municipality for a point from Geocoding v5 `context`.
 *
 * Mapbox context entries are typed by an `id` PREFIX (`district.1234`,
 * `place.5678`), so match on the prefix before the dot — an exact-equality
 * check against "district" never matches anything.
 *
 * `district` is the county in the US ("Salt Lake County"); `place` is the
 * incorporated city ("Millcreek"); `locality` is a neighbourhood or
 * unincorporated community and is reported separately rather than being
 * mistaken for a municipality.
 */
async function reverseGeocodeJurisdiction(
  token: string, lng: string, lat: string,
): Promise<{ county: string | null; municipality: string | null; place: string | null } | null> {
  const params = new URLSearchParams({
    access_token: token,
    limit: '1',
    types: 'address,place,district,locality,neighborhood',
  });
  const data = await mbFetch(
    `${MB}/geocoding/v5/mapbox.places/${encodeURIComponent(lng)},${encodeURIComponent(lat)}.json?${params}`,
  );
  const feature = (data?.features ?? [])[0];
  if (!feature) return null;

  // The matched feature itself counts as context — reverse-geocoding a
  // point inside a city returns that city as the FEATURE, with only the
  // county above it in `context`. Reading `context` alone loses it.
  const entries: Array<{ id?: string; text?: string }> = [
    { id: feature.id, text: feature.text },
    ...(feature.context ?? []),
  ];
  const byType = (t: string) =>
    entries.find((e) => typeof e.id === 'string' && e.id.split('.')[0] === t)?.text ?? null;

  return {
    county: byType('district'),
    municipality: byType('place'),
    place: byType('locality') ?? byType('neighborhood'),
  };
}

// ── Static map ─────────────────────────────────────────────
// GET /api/mapbox/static-map?lng=&lat=&zoom=&width=&height=&style=  → { url, attribution }
mapbox.get('/static-map', async (c) => {
  const tk = token(c);
  if (!tk) return tokenMissing(c);
  const lng = c.req.query('lng'); const lat = c.req.query('lat');
  if (lng == null || lat == null) return c.json({ error: 'lng and lat are required' }, 400);
  const zoom = c.req.query('zoom') || '14';
  const width = c.req.query('width') || '600';
  const height = c.req.query('height') || '400';
  const style = c.req.query('style') || 'mapbox/dark-v11';
  const url = `${MB}/styles/v1/${style}/static/${encodeURIComponent(lng)},${encodeURIComponent(lat)},${zoom}/${width}x${height}?access_token=${encodeURIComponent(tk)}`;
  return c.json({ url, attribution: '© Mapbox © OpenStreetMap' });
});

// ── Static image (binary proxy) ───────────────────────────
// GET /api/mapbox/static/image?lng=&lat=&zoom=&width=&height=&style=&retina=&markers=
//   → binary image bytes (image/png), Mapbox token never reaches the browser.
// Backs client/src/utils/pdfImageHelpers.ts and client/src/services/staticMapPreview.ts —
// both already called this path; it just never existed server-side, so every
// request 404'd and rendered as "Image failed to load". (StreetViewLightbox's
// oblique-angle orbit fallback in client/src/utils/locationImagery.ts hits the
// Mapbox Static Images API directly with a cached client-side token, not this
// server proxy.)
mapbox.get('/static/image', async (c) => {
  const tk = token(c);
  if (!tk) return tokenMissing(c);
  const lng = c.req.query('lng'); const lat = c.req.query('lat');
  if (lng == null || lat == null) return c.json({ error: 'lng and lat are required' }, 400);
  const zoom = c.req.query('zoom') || '14';
  const width = c.req.query('width') || '600';
  const height = c.req.query('height') || '400';
  const style = c.req.query('style') || 'mapbox/dark-v11';
  const retina = c.req.query('retina') === 'true';
  const markersParam = c.req.query('markers');

  let overlay = '';
  if (markersParam) {
    const pins = markersParam.split(';').filter(Boolean).map((entry) => {
      const [mLng, mLat, mColor, mLabel] = entry.split(',');
      const color = (mColor || 'd4a017').replace(/^#/, '');
      const label = mLabel ? `-${encodeURIComponent(mLabel).slice(0, 1)}` : '';
      return `pin-s${label}+${color}(${encodeURIComponent(mLng)},${encodeURIComponent(mLat)})`;
    });
    overlay = `${pins.join(',')}/`;
  }

  const at = retina ? '@2x' : '';
  const url = `${MB}/styles/v1/${style}/static/${overlay}${encodeURIComponent(lng)},${encodeURIComponent(lat)},${zoom}/${width}x${height}${at}?access_token=${encodeURIComponent(tk)}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      const status = resp.status >= 400 && resp.status < 600 ? resp.status : 502;
      return c.json({ error: 'Mapbox static image failed', code: 'MAPBOX_UPSTREAM_ERROR', detail: detail.slice(0, 300) }, status as any);
    }
    const buf = await resp.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': resp.headers.get('content-type') || 'image/png',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err) {
    clearTimeout(t);
    return fail(c, err, 'static image');
  }
});

// ── Token status ───────────────────────────────────────────
// GET /api/mapbox/token-status  → { configured, valid, tokenPrefix }
mapbox.get('/token-status', async (c) => {
  const tk = token(c);
  if (!tk) return c.json({ configured: false, valid: false });
  let valid = false;
  try {
    // A cheap geocode probe confirms the token is accepted by Mapbox.
    await mbFetch(`${MB}/geocoding/v5/mapbox.places/denver.json?access_token=${encodeURIComponent(tk)}&limit=1`);
    valid = true;
  } catch { valid = false; }
  return c.json({ configured: true, valid, tokenPrefix: tk.slice(0, 8) });
});

export default mapbox;
