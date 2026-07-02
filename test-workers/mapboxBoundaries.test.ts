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

  it('returns 200 skip shape when upstream returns 403 (no Boundaries entitlement)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 })));
    const withToken = { ...(env as Record<string, unknown>), MAPBOX_ACCESS_TOKEN: 'pk.test-token' };
    const res = await app.request('/api/mapbox/boundaries?lng=-111.89&lat=40.76', {}, withToken);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ ok: false, skipped: true, code: 'not_configured' });
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
