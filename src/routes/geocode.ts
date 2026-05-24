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

const geocode = new Hono<Env>();

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'RMPG-Flex-Dispatch/1.0 (https://rmpgutah.us)';
const CACHE_TTL_SECONDS = 24 * 3600;

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
