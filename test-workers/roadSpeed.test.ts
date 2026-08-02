// Route-level tests for the OSM speed-limit point lookup. Mocks the pmtiles
// archive so the test exercises THIS route's validation, tile-fan-out and
// degrade behaviour rather than re-testing the PMTiles library.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getZxy = vi.fn();
vi.mock('pmtiles', () => ({
  PMTiles: class { getZxy = getZxy; },
}));

const nearestMaxspeedInTile = vi.fn();
vi.mock('../src/utils/osm/speedLimitLookup', () => ({
  nearestMaxspeedInTile: (...a: unknown[]) => nearestMaxspeedInTile(...a),
}));

const { Hono } = await import('hono');
const geography = (await import('../src/routes/dispatch/geography')).default;

const app = new Hono<{ Bindings: Record<string, unknown> }>();
app.route('/api/dispatch/geography', geography);

const env = () => ({ MAP_DATA: { async get() { return null; } } }) as unknown as Record<string, unknown>;
const call = (qs: string) =>
  app.request(`/api/dispatch/geography/road-speed${qs}`, {}, env());

beforeEach(() => {
  getZxy.mockReset();
  nearestMaxspeedInTile.mockReset();
  getZxy.mockResolvedValue({ data: new Uint8Array([1]) });
});

describe('GET /road-speed — validation', () => {
  it('400s on a missing lat/lng', async () => {
    expect((await call('')).status).toBe(400);
  });
  it('400s on a non-numeric lat', async () => {
    expect((await call('?lat=abc&lng=-111.9')).status).toBe(400);
  });
  it('400s on an out-of-range lat', async () => {
    expect((await call('?lat=99&lng=-111.9')).status).toBe(400);
  });
  it('400s on an out-of-range lng', async () => {
    expect((await call('?lat=40.76&lng=-999')).status).toBe(400);
  });
});

describe('GET /road-speed — lookup', () => {
  it('returns the nearest hit', async () => {
    nearestMaxspeedInTile.mockReturnValue({ limitMph: 35, roadName: 'S Main St', distanceM: 12 });
    const res = await call('?lat=40.7608&lng=-111.891');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      limitMph: 35, roadName: 'S Main St', distanceM: 12, source: 'osm',
    });
  });

  it('picks the globally nearest hit across tiles, not the first', async () => {
    // Center tile returns a far road; a neighbour returns a nearer one.
    nearestMaxspeedInTile
      .mockReturnValueOnce({ limitMph: 55, roadName: 'Far Hwy', distanceM: 400 })
      .mockReturnValue({ limitMph: 25, roadName: 'Near St', distanceM: 9 });
    const res = await call('?lat=40.7608&lng=-111.891');
    const body = await res.json() as { limitMph: number; roadName: string };
    expect(body.limitMph).toBe(25);
    expect(body.roadName).toBe('Near St');
  });

  it('reports limitMph null when nothing is within the radius cap', async () => {
    nearestMaxspeedInTile.mockReturnValue({ limitMph: 35, roadName: 'Too Far', distanceM: 5000 });
    const res = await call('?lat=40.7608&lng=-111.891');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      limitMph: null, roadName: null, distanceM: null, source: 'osm',
    });
  });

  it('reports limitMph null when no tile has a tagged way', async () => {
    nearestMaxspeedInTile.mockReturnValue(null);
    const res = await call('?lat=40.7608&lng=-111.891');
    expect(res.status).toBe(200);
    expect((await res.json() as { limitMph: number | null }).limitMph).toBeNull();
  });

  it('degrades to 200/null when the archive is missing, not 404 or 500', async () => {
    // A missing archive means "we have no data here", which for a HUD readout
    // is the same operational answer as "no limit posted".
    getZxy.mockRejectedValue(new Error('archive not found'));
    nearestMaxspeedInTile.mockReturnValue(null);
    const res = await call('?lat=40.7608&lng=-111.891');
    expect(res.status).toBe(200);
    expect((await res.json() as { limitMph: number | null }).limitMph).toBeNull();
  });

  it('degrades to 200/null when a tile is empty (204-equivalent)', async () => {
    getZxy.mockResolvedValue(null);
    const res = await call('?lat=40.7608&lng=-111.891');
    expect(res.status).toBe(200);
    expect((await res.json() as { limitMph: number | null }).limitMph).toBeNull();
    expect(nearestMaxspeedInTile).not.toHaveBeenCalled();
  });
});
