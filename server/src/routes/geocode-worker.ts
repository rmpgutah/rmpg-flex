import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken } from '../worker-middleware/auth';

const NOMINATIM_TIMEOUT_MS = 8_000;
const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 200;
const MAX_LIMIT = 10;
const USER_AGENT = 'RMPG-Flex-CAD/5.7 (rmpgutah.us)';

interface NominatimAddress {
  road?: string; house_number?: string; city?: string; town?: string;
  village?: string; state?: string; postcode?: string; [key: string]: any;
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  place_id?: number;
  type?: string;
  importance?: number;
  address?: NominatimAddress;
}

interface SearchResult {
  display_name: string;
  latitude: number;
  longitude: number;
  type?: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

export function mountGeocodeRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/geocode/search — Forward geocoding via Nominatim
  api.get('/search', async (c) => {
    const q = String(c.req.query('q') || '').trim();
    const limitRaw = parseInt(String(c.req.query('limit') || '5'), 10);
    const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 5 : limitRaw), MAX_LIMIT);

    if (q.length < MIN_QUERY_LENGTH) {
      return c.json({ results: [] });
    }
    if (q.length > MAX_QUERY_LENGTH) {
      return c.json({ error: 'query too long' }, 400);
    }

    const url =
      `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(q)}&format=json&limit=${limit}&countrycodes=us&addressdetails=1`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
    try {
      const upstream = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!upstream.ok) {
        console.warn(`[geocode/search] Nominatim non-OK: ${upstream.status}`);
        return c.json({ error: 'geocoder unavailable', results: [] }, 502);
      }
      const data: NominatimResult[] = await upstream.json();
      const results: SearchResult[] = (Array.isArray(data) ? data : [])
        .map((r) => {
          const addr = r.address || {};
          const street = [addr.house_number, addr.road].filter(Boolean).join(' ');
          const city = addr.city || addr.town || addr.village || addr.municipality || '';
          const state = addr.state || '';
          const zip = addr.postcode || '';
          return {
            display_name: r.display_name,
            latitude: parseFloat(r.lat),
            longitude: parseFloat(r.lon),
            type: r.type,
            street,
            city,
            state,
            zip,
          };
        })
        .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
      return c.json({ results });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return c.json({ error: 'geocoder timeout', results: [] }, 504);
      }
      console.warn('[geocode/search] failed:', err);
      return c.json({ error: 'geocoder failed', results: [] }, 502);
    } finally {
      clearTimeout(timeout);
    }
  });

  // POST /api/geocode/reverse — Reverse geocoding from lat/lng
  api.post('/reverse', async (c) => {
    try {
      const { latitude, longitude } = await c.req.json();
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return c.json({ error: 'latitude and longitude must be valid numbers' }, 400);
      }

      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
      try {
        const upstream = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': USER_AGENT },
        });
        if (!upstream.ok) {
          return c.json({ error: 'reverse geocoder unavailable' }, 502);
        }
        const data = await upstream.json() as any;
        return c.json({
          display_name: data.display_name || null,
          address: data.address || null,
          latitude: lat,
          longitude: lng,
        });
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return c.json({ error: 'reverse geocoder timeout' }, 504);
        }
        return c.json({ error: 'reverse geocoder failed' }, 502);
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return c.json({ error: 'Invalid request body' }, 400);
    }
  });

  app.route('/api/geocode', api);
}
