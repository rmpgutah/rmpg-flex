// Route-level smoke test (Miniflare/workerd) for GET /api/mapbox/boundaries.
// Verifies the not-configured paths respond correctly without a live
// Mapbox token — this environment never has MAPBOX_ACCESS_TOKEN set.
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import mapbox from '../src/routes/mapbox';

const app = new Hono<{ Bindings: Record<string, unknown> }>();
app.route('/api/mapbox', mapbox);

describe('GET /api/mapbox/boundaries', () => {
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
});
