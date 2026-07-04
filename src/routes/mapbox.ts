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
  const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 502;
  return c.json({ error: `Mapbox ${label} failed`, code: 'MAPBOX_UPSTREAM_ERROR', detail: err?.message, upstream: err?.body?.message }, status);
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
// GET /api/mapbox/directions?coordinates=&profile=&alternatives=  → { routes: [...] }
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
  try {
    const data = await mbFetch(`${MB}/directions/v5/mapbox/${encodeURIComponent(profile)}/${coordinates}?${params}`);
    return c.json({ routes: data?.routes ?? [], waypoints: data?.waypoints ?? [], code: data?.code });
  } catch (err) { return fail(c, err, 'directions'); }
});

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
// GET /api/mapbox/optimization?coordinates=&profile=&source=&destination=&roundtrip=
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
  });
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
    if (!feature) {
      return c.json({ county: null, municipality: null, place: null, source: 'mapbox-boundaries' });
    }
    return c.json({
      county: feature.properties?.name ?? null,
      municipality: null,
      place: null,
      source: 'mapbox-boundaries',
    });
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403 || err?.status === 404) {
      console.warn('[mapbox/boundaries] upstream returned', err?.status, '— treating as entitlement gap. If this persists, verify the adm2 tileset ID is correct for this account.');
      return notConfigured(c, 'Mapbox Boundaries API not enabled on this account token');
    }
    return fail(c, err, 'boundaries');
  }
});

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
// Backs client/src/hooks/useMapStreetView.ts (SAT PEEK popup),
// client/src/utils/pdfImageHelpers.ts, and client/src/services/staticMapPreview.ts —
// all three already called this path; it just never existed server-side, so every
// request 404'd and rendered as "Image failed to load".
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
  } catch (err: any) {
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
