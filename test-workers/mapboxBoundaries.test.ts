// Route-level smoke test (Miniflare/workerd) for GET /api/mapbox/boundaries.
// Verifies the not-configured paths respond correctly without a live
// Mapbox token — this environment never has MAPBOX_ACCESS_TOKEN set.
import { env } from 'cloudflare:test';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import mapbox from '../src/routes/mapbox';

const app = new Hono<{ Bindings: Record<string, unknown> }>();
app.route('/api/mapbox', mapbox);

describe('GET /api/mapbox/boundaries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 503 with MAPBOX_TOKEN_UNSET when no token is configured', async () => {
    const res = await app.request('/api/mapbox/boundaries?lng=-111.89&lat=40.76', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(503);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('MAPBOX_TOKEN_UNSET');
  });

  it('returns 400 when lng/lat are missing', async () => {
    const withToken = { ...(env as Record<string, unknown>), MAPBOX_ACCESS_TOKEN: 'pk.test-token' };
    const res = await app.request('/api/mapbox/boundaries', {}, withToken);
    expect(res.status).toBe(400);
  });

  it('returns 200 skip shape when BOTH Boundaries and the geocoding fallback fail', async () => {
    // Boundaries v4 is a paid add-on, so a 403 is the normal case on a
    // standard token. When reverse geocoding ALSO fails there is nothing
    // left to try — but this is an advisory side-panel badge, so it must
    // degrade to the skip shape rather than surfacing the upstream 403 as
    // a hard error on the Properties/Warrants page.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 })));
    const withToken = { ...(env as Record<string, unknown>), MAPBOX_ACCESS_TOKEN: 'pk.test-token' };
    const res = await app.request('/api/mapbox/boundaries?lng=-111.89&lat=40.76', {}, withToken);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ ok: false, skipped: true, code: 'not_configured' });
  });

  it('falls back to reverse geocoding when Boundaries is not entitled', async () => {
    // The fix for the permanent "Jurisdiction unavailable" badge: Boundaries
    // 403s on a standard token, but Geocoding v5 carries the same answer in
    // `context` (district = county, place = municipality) for free.
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes('/boundaries/')) {
        return new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 });
      }
      return new Response(JSON.stringify({
        features: [{
          id: 'address.123', text: '1015 East Murray Holladay Road',
          context: [
            { id: 'neighborhood.9', text: 'Canyon Rim' },
            { id: 'postcode.8', text: '84117' },
            { id: 'place.7', text: 'Millcreek' },
            { id: 'district.6', text: 'Salt Lake County' },
            { id: 'region.5', text: 'Utah' },
          ],
        }],
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const withToken = { ...(env as Record<string, unknown>), MAPBOX_ACCESS_TOKEN: 'pk.test-token' };
    const res = await app.request('/api/mapbox/boundaries?lng=-111.89&lat=40.76', {}, withToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      county: 'Salt Lake County',
      municipality: 'Millcreek',
      place: 'Canyon Rim',
      source: 'mapbox-geocoding',
    });
  });

  it('matches context entries by id PREFIX, not exact equality', async () => {
    // Mapbox types context entries as `district.1234` / `place.5678`. An
    // exact-equality check against "district" matches nothing, which would
    // silently reproduce the all-null response this fix exists to remove.
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).includes('/boundaries/')) {
        return new Response('{}', { status: 404 });
      }
      return new Response(JSON.stringify({
        features: [{ id: 'place.42', text: 'Millcreek', context: [{ id: 'district.99', text: 'Salt Lake County' }] }],
      }), { status: 200 });
    }));
    const withToken = { ...(env as Record<string, unknown>), MAPBOX_ACCESS_TOKEN: 'pk.test-token' };
    const res = await app.request('/api/mapbox/boundaries?lng=-111.89&lat=40.76', {}, withToken);
    const body = await res.json() as Record<string, unknown>;
    // The matched FEATURE itself is the municipality here — reading only
    // `context` would lose it, since a point inside a city returns that city
    // as the feature with just the county above it.
    expect(body.county).toBe('Salt Lake County');
    expect(body.municipality).toBe('Millcreek');
  });

  it('returns the resolved county on a successful upstream response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ features: [{ properties: { name: 'Salt Lake County' } }] }),
      { status: 200 },
    )));
    const withToken = { ...(env as Record<string, unknown>), MAPBOX_ACCESS_TOKEN: 'pk.test-token' };
    const res = await app.request('/api/mapbox/boundaries?lng=-111.89&lat=40.76', {}, withToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ county: 'Salt Lake County', municipality: null, place: null, source: 'mapbox-boundaries' });
  });
});
