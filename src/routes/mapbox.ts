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

function notConfigured(c: any) {
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
// GET /api/mapbox/geocode?q=&limit=&types=  → { features: [...] }
mapbox.get('/geocode', async (c) => {
  const tk = token(c);
  if (!tk) return notConfigured(c);
  const q = (c.req.query('q') || '').trim();
  if (!q) return c.json({ error: 'q is required' }, 400);
  const limit = c.req.query('limit') || '5';
  const types = c.req.query('types');
  const params = new URLSearchParams({ access_token: tk, limit, autocomplete: 'true', country: 'us' });
  if (types) params.set('types', types);
  try {
    const data = await mbFetch(`${MB}/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?${params}`);
    return c.json({ features: data?.features ?? [] });
  } catch (err) { return fail(c, err, 'geocode'); }
});

// GET /api/mapbox/reverse-geocode?lng=&lat=  → { features: [...] }
mapbox.get('/reverse-geocode', async (c) => {
  const tk = token(c);
  if (!tk) return notConfigured(c);
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
  if (!tk) return notConfigured(c);
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
  if (!tk) return notConfigured(c);
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
  if (!tk) return notConfigured(c);
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
  if (!tk) return notConfigured(c);
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
  if (!tk) return notConfigured(c);
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
  if (!tk) return notConfigured(c);
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

// ── Static map ─────────────────────────────────────────────
// GET /api/mapbox/static-map?lng=&lat=&zoom=&width=&height=&style=  → { url, attribution }
mapbox.get('/static-map', async (c) => {
  const tk = token(c);
  if (!tk) return notConfigured(c);
  const lng = c.req.query('lng'); const lat = c.req.query('lat');
  if (lng == null || lat == null) return c.json({ error: 'lng and lat are required' }, 400);
  const zoom = c.req.query('zoom') || '14';
  const width = c.req.query('width') || '600';
  const height = c.req.query('height') || '400';
  const style = c.req.query('style') || 'mapbox/dark-v11';
  const url = `${MB}/styles/v1/${style}/static/${encodeURIComponent(lng)},${encodeURIComponent(lat)},${zoom}/${width}x${height}?access_token=${encodeURIComponent(tk)}`;
  return c.json({ url, attribution: '© Mapbox © OpenStreetMap' });
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
