import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';

const MAPBOX_BASE = 'https://api.mapbox.com';
const MAPBOX_TIMEOUT_MS = 10_000;

async function getMapboxToken(c: any): Promise<string> {
  const db = new D1Db(c.env.DB);
  const configRow = await db.prepare(
    `SELECT config_value FROM system_config WHERE config_key = 'mapbox_access_token' LIMIT 1`
  ).get() as any;
  if (configRow?.config_value) {
    return configRow.config_value.trim();
  }
  const envToken = c.env.MAPBOX_ACCESS_TOKEN;
  if (envToken) return envToken;
  const viteToken = c.env.VITE_MAPBOX_ACCESS_TOKEN;
  if (viteToken) return viteToken;
  throw new Error('Mapbox access token not configured');
}

async function proxyToMapbox(c: any, path: string, params: Record<string, string> = {}) {
  const token = await getMapboxToken(c);
  const qs = new URLSearchParams({ access_token: token, ...params });
  const url = `${MAPBOX_BASE}${path}?${qs}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAPBOX_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await upstream.json();
    if (!upstream.ok) {
      return c.json({ error: 'Mapbox API error', details: data, code: upstream.status }, upstream.status);
    }
    return c.json(data);
  } catch (err: any) {
    clearTimeout(timeout);
    if (err?.name === 'AbortError') {
      return c.json({ error: 'Mapbox API timeout' }, 504);
    }
    return c.json({ error: 'Mapbox API request failed', details: err?.message }, 502);
  }
}

export function mountMapboxRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // ─── Forward Geocode ──────────────────────────────────
  // GET /api/mapbox/geocode?q=<address>
  api.get('/geocode', async (c) => {
    const q = String(c.req.query('q') || '').trim();
    if (!q || q.length < 3) return c.json({ results: [] });
    const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '5', 10) || 5), 10);
    const types = c.req.query('types') || 'address,place,locality,neighborhood,poi';
    return proxyToMapbox(c, '/geocoding/v5/mapbox.places/' + encodeURIComponent(q) + '.json', {
      limit: String(limit), types, country: 'us',
    });
  });

  // ─── Reverse Geocode ──────────────────────────────────
  // GET /api/mapbox/reverse-geocode?lng=<lng>&lat=<lat>
  api.get('/reverse-geocode', async (c) => {
    const lng = parseFloat(c.req.query('lng') || '');
    const lat = parseFloat(c.req.query('lat') || '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return c.json({ error: 'lng and lat must be valid numbers' }, 400);
    }
    return proxyToMapbox(c, `/geocoding/v5/mapbox.places/${lng},${lat}.json`, { types: 'address,place,locality,neighborhood,poi', country: 'us' });
  });

  // ─── Directions ───────────────────────────────────────
  // GET /api/mapbox/directions?coordinates=lng1,lat1;lng2,lat2&profile=driving-traffic
  api.get('/directions', async (c) => {
    const coords = String(c.req.query('coordinates') || '').trim();
    if (!coords) return c.json({ error: 'coordinates required (lng1,lat1;lng2,lat2)' }, 400);
    const profile = c.req.query('profile') || 'driving-traffic';
    const alternatives = c.req.query('alternatives') || 'false';
    const overview = c.req.query('overview') || 'full';
    const geometries = c.req.query('geometries') || 'geojson';
    const steps = c.req.query('steps') || 'true';
    return proxyToMapbox(c, `/directions/v5/mapbox/${profile}/${coords}`, { alternatives, overview, geometries, steps });
  });

  // ─── Isochrone ────────────────────────────────────────
  // GET /api/mapbox/isochrone?lng=<lng>&lat=<lat>&minutes=2,5,10&profile=driving
  api.get('/isochrone', async (c) => {
    const lng = parseFloat(c.req.query('lng') || '');
    const lat = parseFloat(c.req.query('lat') || '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return c.json({ error: 'lng and lat must be valid numbers' }, 400);
    }
    const minutesRaw = String(c.req.query('minutes') || '5,10').split(',').map(Number).filter(n => n > 0 && n <= 60);
    if (minutesRaw.length === 0) return c.json({ error: 'minutes must be comma-separated positive numbers (max 60)' }, 400);
    const minutes = minutesRaw.slice(0, 4);
    const profile = c.req.query('profile') || 'driving';
    const polygons = c.req.query('polygons') || 'true';
    return proxyToMapbox(c, `/isochrone/v1/mapbox/${profile}/${lng},${lat}`, {
      contours_minutes: minutes.join(','),
      polygons, denoise: '1',
    });
  });

  // ─── Matrix ────────────────────────────────────────────
  // GET /api/mapbox/matrix?coordinates=lng1,lat1;lng2,lat2&profile=driving&sources=0
  api.get('/matrix', async (c) => {
    const coords = String(c.req.query('coordinates') || '').trim();
    if (!coords) return c.json({ error: 'coordinates required (lng1,lat1;lng2,lat2;...)' }, 400);
    const profile = c.req.query('profile') || 'driving';
    const sources = c.req.query('sources') || '';
    const destinations = c.req.query('destinations') || '';
    const annotations = c.req.query('annotations') || 'duration,distance';
    const params: Record<string, string> = { annotations };
    if (sources) params.sources = sources;
    if (destinations) params.destinations = destinations;
    return proxyToMapbox(c, `/directions-matrix/v1/mapbox/${profile}/${coords}`, params);
  });

  // ─── Optimization ──────────────────────────────────────
  // GET /api/mapbox/optimization?coordinates=lng1,lat1;lng2,lat2;lng3,lat3&profile=driving&source=first&destination=last
  api.get('/optimization', async (c) => {
    const coords = String(c.req.query('coordinates') || '').trim();
    if (!coords) return c.json({ error: 'coordinates required' }, 400);
    const profile = c.req.query('profile') || 'driving';
    const source = c.req.query('source') || 'any';
    const destination = c.req.query('destination') || 'any';
    const roundtrip = c.req.query('roundtrip') || 'false';
    return proxyToMapbox(c, `/optimized-trips/v1/mapbox/${profile}/${coords}`, { source, destination, roundtrip });
  });

  // ─── Map Matching ──────────────────────────────────────
  // POST /api/mapbox/map-matching
  // Body: { coordinates: [[lng,lat], ...], profile?: string }
  api.post('/map-matching', async (c) => {
    let body: any;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
    const coords: number[][] = body.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      return c.json({ error: 'coordinates array with at least 2 [lng, lat] pairs required' }, 400);
    }
    if (coords.length > 100) {
      return c.json({ error: 'max 100 coordinates' }, 400);
    }
    const coordStr = coords.map((p: number[]) => `${p[0]},${p[1]}`).join(';');
    const profile = body.profile || 'driving';
    return proxyToMapbox(c, `/matching/v5/mapbox/${profile}/${coordStr}`, { geometries: 'geojson', overview: 'full', steps: 'false', tidy: 'true' });
  });

  // ─── Tilequery ─────────────────────────────────────────
  // GET /api/mapbox/tilequery?lng=<lng>&lat=<lat>&radius=50&limit=10&layer=mapbox.mapbox-streets-v8
  api.get('/tilequery', async (c) => {
    const lng = parseFloat(c.req.query('lng') || '');
    const lat = parseFloat(c.req.query('lat') || '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return c.json({ error: 'lng and lat must be valid numbers' }, 400);
    }
    const radius = Math.min(Math.max(0, parseInt(c.req.query('radius') || '50', 10) || 50), 1000);
    const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '10', 10) || 10), 50);
    const layer = c.req.query('layer') || 'mapbox.mapbox-streets-v8';
    const params: Record<string, string> = { radius: String(radius), limit: String(limit) };
    return proxyToMapbox(c, `/v4/${encodeURIComponent(layer)}/tilequery/${lng},${lat}.json`, params);
  });

  // ─── Static Map ─────────────────────────────────────────
  // GET /api/mapbox/static-map?lng=<lng>&lat=<lat>&zoom=<zoom>&width=<w>&height=<h>&style=<style>
  // Returns a JSON with the static map URL (the actual image is fetched through Mapbox)
  api.get('/static-map', async (c) => {
    const lng = parseFloat(c.req.query('lng') || '-111.891');
    const lat = parseFloat(c.req.query('lat') || '40.7608');
    const zoom = Math.min(Math.max(0, parseInt(c.req.query('zoom') || '12', 10) || 12), 22);
    const width = Math.min(Math.max(100, parseInt(c.req.query('width') || '600', 10) || 600), 1280);
    const height = Math.min(Math.max(100, parseInt(c.req.query('height') || '400', 10) || 400), 1024);
    const style = c.req.query('style') || 'mapbox/dark-v11';
    const bearing = c.req.query('bearing') || '0';
    const pitch = c.req.query('pitch') || '0';
    const overlay = c.req.query('overlay') || '';
    let path = `/styles/v1/${style}/static`;
    if (overlay) path += `/${overlay}`;
    path += `/${lng},${lat},${zoom},${bearing},${pitch}/${width}x${height}@2x`;
    const token = await getMapboxToken(c);
    return c.json({ url: `${MAPBOX_BASE}${path}?access_token=${token}`, attribution: '© Mapbox © OpenStreetMap' });
  });

  // ─── Token Check ────────────────────────────────────────
  // GET /api/mapbox/token-status — Check if Mapbox token is configured and valid
  api.get('/token-status', async (c) => {
    try {
      const token = await getMapboxToken(c);
      // Test with a lightweight geocode query to verify token validity
      const testUrl = `${MAPBOX_BASE}/geocoding/v5/mapbox.places/SLC.json?limit=1&access_token=${token}`;
      const upstream = await fetch(testUrl);
      return c.json({
        configured: true,
        valid: upstream.ok,
        code: upstream.status,
        tokenPrefix: token.substring(0, 12) + '...',
      });
    } catch {
      return c.json({ configured: false, error: 'Mapbox token not configured' });
    }
  });

  app.route('/api/mapbox', api);
}
