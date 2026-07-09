// Route-level smoke test (Miniflare/workerd) for GET /api/mapbox/directions'
// exclusion-zone warning flag. Verifies the response carries
// excludedZoneWarning:true when an active geofence_zones('exclusion') row
// covers the returned route, and omits it otherwise.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import mapbox from '../src/routes/mapbox';

const app = new Hono<{ Bindings: Record<string, unknown> }>();
app.route('/api/mapbox', mapbox);

const db = (env as unknown as { DB: D1Database }).DB;

const squarePolygon = {
  type: 'Polygon',
  coordinates: [[[-111.90, 40.75], [-111.88, 40.75], [-111.88, 40.77], [-111.90, 40.77], [-111.90, 40.75]]],
};

function mockDirectionsResponse(coordinates: number[][]) {
  return new Response(JSON.stringify({
    routes: [{
      distance: 1000,
      duration: 120,
      geometry: { type: 'LineString', coordinates },
      legs: [],
    }],
    waypoints: [],
    code: 'Ok',
  }), { status: 200 });
}

describe('GET /api/mapbox/directions exclusion-zone flag', () => {
  beforeEach(async () => {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS geofence_zones (id INTEGER PRIMARY KEY AUTOINCREMENT, zone_name TEXT NOT NULL, zone_type TEXT, geojson_data TEXT NOT NULL, description TEXT, color TEXT, is_active INTEGER DEFAULT 1, created_by INTEGER, created_at TEXT, updated_at TEXT)`
    ).run();
    await db.prepare('DELETE FROM geofence_zones').run();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes excludedZoneWarning:true when the route crosses an active exclusion zone', async () => {
    await db.prepare(
      `INSERT INTO geofence_zones (zone_name, zone_type, geojson_data, is_active) VALUES (?, 'exclusion', ?, 1)`
    ).bind('Test Exclusion', JSON.stringify(squarePolygon)).run();

    vi.stubGlobal('fetch', vi.fn(async () => mockDirectionsResponse([[-111.89, 40.76], [-111.85, 40.70]])));

    const withToken = { ...(env as Record<string, unknown>), MAPBOX_ACCESS_TOKEN: 'pk.test-token' };
    const res = await app.request('/api/mapbox/directions?coordinates=-111.89,40.76;-111.85,40.70', {}, withToken);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.excludedZoneWarning).toBe(true);
  });

  it('omits excludedZoneWarning when no active zone covers the route', async () => {
    await db.prepare(
      `INSERT INTO geofence_zones (zone_name, zone_type, geojson_data, is_active) VALUES (?, 'exclusion', ?, 1)`
    ).bind('Test Exclusion', JSON.stringify(squarePolygon)).run();

    vi.stubGlobal('fetch', vi.fn(async () => mockDirectionsResponse([[-111.80, 40.60], [-111.75, 40.55]])));

    const withToken = { ...(env as Record<string, unknown>), MAPBOX_ACCESS_TOKEN: 'pk.test-token' };
    const res = await app.request('/api/mapbox/directions?coordinates=-111.80,40.60;-111.75,40.55', {}, withToken);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.excludedZoneWarning).toBeUndefined();
  });

  it('omits excludedZoneWarning when no exclusion zones exist at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockDirectionsResponse([[-111.89, 40.76]])));

    const withToken = { ...(env as Record<string, unknown>), MAPBOX_ACCESS_TOKEN: 'pk.test-token' };
    const res = await app.request('/api/mapbox/directions?coordinates=-111.89,40.76;-111.85,40.70', {}, withToken);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.excludedZoneWarning).toBeUndefined();
  });
});
