// Geocoding proxy — supports the dispatch address autocomplete in
// AddressAutocomplete.tsx. Two paths:
//
//   GET /geocode/search?q=…           — Nominatim (OpenStreetMap) free,
//                                       no API key required
//   GET /integrations/mapbox/client-token
//                                     — returns the Mapbox token if
//                                       MAPBOX_ACCESS_TOKEN secret is
//                                       set on the Worker; the client
//                                       prefers Mapbox when available
//                                       and falls back to Nominatim
//                                       via the search endpoint above.
//
// Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/):
//   - Rate limit: 1 request per second per host
//   - User-Agent header required
//   - No bulk geocoding (we're <50 dispatchers, well within bounds)
// We include a 24-hour KV cache so repeat queries don't burn the budget.

import { Hono } from 'hono';
import type { Env } from '../types';
import { authMiddleware } from '../middleware/auth';

const geocode = new Hono<Env>();

// Auth lives inside this router (not at the registry level) because
// the router mounts at the bare /api prefix to expose both
// /api/geocode/* and /api/integrations/mapbox/client-token. If we
// marked the registry entry as `auth: 'required'`, the loop in
// src/index.ts would call `app.use('/api/*', authMiddleware)` which
// blanket-blocks EVERY /api/* path — including /api/auth/login.
// Login then 401s with "Authentication required" and nobody can sign
// in. (Incident 2026-05-24: that's exactly what happened to the
// admin recovery flow.) Move the auth concern inside so the registry
// can keep this entry as `public` without leaving the routes open.
geocode.use('*', authMiddleware);

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'RMPG-Flex-Dispatch/1.0 (https://rmpgutah.us)';
const CACHE_TTL_SECONDS = 24 * 3600;

// Reverse-geocode coordinates to a short street label (server-side), for the
// AI dispatcher's "where am I" answer. Rounds to ~11 m before caching so a
// breadcrumb that jitters a few feet still hits the same KV key. Returns null
// on any miss/error — the dispatcher then falls back to the beat/zone name,
// which it always has. Nominatim reverse is free + keyless (1 req/s policy;
// the round+cache keeps us well under it).
export async function reverseGeocodeAddress(
  env: { KV: KVNamespace },
  lat: number,
  lng: number,
): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = `geocode:rev:${lat.toFixed(4)},${lng.toFixed(4)}`;
  try {
    const cached = await env.KV.get(key).catch(() => null);
    if (cached != null) return cached || null;
    const params = new URLSearchParams({
      lat: String(lat), lon: String(lng), format: 'json', zoom: '18', addressdetails: '1',
    });
    const resp = await fetch(`${NOMINATIM_REVERSE}?${params}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
    });
    if (!resp.ok) return null;
    const raw = await resp.json<{ address?: Record<string, string>; display_name?: string }>();
    const a = raw?.address || {};
    // Prefer "<house#> <street>, <city>"; fall back to the first two display
    // segments so the dispatcher always reads something recognizable.
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    const city = a.city || a.town || a.village || a.suburb || a.neighbourhood || '';
    const label = [street, city].filter(Boolean).join(', ')
      || (raw?.display_name ? raw.display_name.split(',').slice(0, 2).join(',').trim() : '');
    if (!label) return null;
    await env.KV.put(key, label, { expirationTtl: CACHE_TTL_SECONDS }).catch(() => {});
    return label;
  } catch {
    return null;
  }
}

// Forward-geocode a single address to coordinates (server-side), reusing the
// same Nominatim source + Utah viewbox bias + KV cache as /geocode/search.
// Returns null on any miss/error — callers MUST treat geocoding as best-effort
// and never block their write on it. Used by the dispatch call-create flow so
// every CFS gets map coordinates even when the client didn't supply lat/lng
// (created via API, the CAD command line, or a path that skipped autocomplete).
export async function geocodeAddress(
  env: { KV: KVNamespace },
  address: string,
): Promise<{ lat: number; lng: number } | null> {
  const q = (address || '').trim();
  if (q.length < 3) return null;
  const cacheKey = `geocode:fwd:${q.toLowerCase()}`;
  try {
    const cached = (await env.KV.get(cacheKey, 'json').catch(() => null)) as { lat: number; lng: number } | null;
    if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) return cached;
    const params = new URLSearchParams({
      q, format: 'json', addressdetails: '0', limit: '1', countrycodes: 'us',
      viewbox: '-114.052,42.001,-109.041,36.998', bounded: '1',
    });
    const resp = await fetch(`${NOMINATIM_BASE}?${params}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
    });
    if (!resp.ok) return null;
    const raw = await resp.json<Array<{ lat?: string; lon?: string }>>();
    const first = raw?.[0];
    if (!first?.lat || !first?.lon) return null;
    const lat = parseFloat(first.lat);
    const lng = parseFloat(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const coords = { lat, lng };
    await env.KV.put(cacheKey, JSON.stringify(coords), { expirationTtl: CACHE_TTL_SECONDS }).catch(() => {});
    return coords;
  } catch {
    return null;
  }
}

// GET /api/geocode/search?q=…&limit=…
// Mounted at /api so the inner paths below match what the client
// expects: /api/geocode/search and /api/integrations/mapbox/client-token.
// This avoids the /api/integrations stubs catch-all shadowing us.
// Returns { results: [{ display_name, lat, lon, address, type, ... }] }
// in the shape AddressAutocomplete expects (Nominatim raw shape works).
geocode.get('/geocode/search', async (c) => {
  const q = c.req.query('q')?.trim() || '';
  const limit = Math.min(10, Math.max(1, parseInt(c.req.query('limit') || '5', 10)));
  if (q.length < 3) return c.json({ results: [] });

  // KV cache key — query+limit is the natural index. 24h TTL is
  // safe for address autocomplete: street addresses don't move.
  const cacheKey = `geocode:${q.toLowerCase()}:${limit}`;
  const cached = await c.env.KV.get(cacheKey, 'json').catch(() => null);
  if (cached) return c.json(cached);

  // Strong Utah bias — RMPG operates statewide with the bulk of
  // calls in the Wasatch Front (SLC metro). Without a viewbox,
  // "South 200 East" returns Berne, Indiana before any Utah match.
  //
  //   viewbox      = left,top,right,bottom  (west,north,east,south)
  //                  covers all of Utah with a small border buffer
  //   bounded=1    = HARD restrict to the viewbox (Nominatim ignores
  //                  matches outside it; keeps Indiana results away)
  //   countrycodes = belt + suspenders since bounded=1 is the harder
  //                  constraint
  //
  // Explicit ?statewide=0 query flag lets a caller opt OUT of the
  // bounded restriction (e.g. premise check on an out-of-state
  // address). Default behavior is bounded to Utah.
  const statewideOnly = c.req.query('statewide') !== '0';
  const params = new URLSearchParams({
    q,
    format: 'json',
    addressdetails: '1',
    limit: String(limit),
    countrycodes: 'us',
  });
  if (statewideOnly) {
    params.set('viewbox', '-114.052,42.001,-109.041,36.998');
    params.set('bounded', '1');
  }
  const url = `${NOMINATIM_BASE}?${params}`;

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
    });
    if (!resp.ok) {
      return c.json({ results: [], error: `Upstream ${resp.status}` }, 502);
    }
    const raw = await resp.json<any[]>();
    const payload = { results: raw };
    // Best-effort cache — don't fail the request if KV write errors.
    c.executionCtx.waitUntil(
      c.env.KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SECONDS }).catch(() => {}),
    );
    // no-store so the BROWSER never holds onto a previous response —
    // we already cache server-side in KV. Without this, an earlier
    // mis-biased response (e.g. Indiana matches before the Utah
    // viewbox shipped) lingers in the browser cache for the rest of
    // the session.
    c.header('Cache-Control', 'no-store');
    return c.json(payload);
  } catch (err) {
    return c.json({ results: [], error: String(err) }, 502);
  }
});

// GET /api/integrations/mapbox/client-token
// Returns { configured: bool, accessToken?: string }. Client uses it
// as the primary geocoder when present. Empty response makes the
// client silently fall back to /api/geocode/search.
geocode.get('/integrations/mapbox/client-token', (c) => {
  // Env can be typed loosely — secret may not be set yet.
  const token = (c.env as any).MAPBOX_ACCESS_TOKEN
    || (c.env as any).VITE_MAPBOX_ACCESS_TOKEN
    || '';
  if (!token) return c.json({ configured: false });
  return c.json({ configured: true, accessToken: token });
});

export default geocode;
