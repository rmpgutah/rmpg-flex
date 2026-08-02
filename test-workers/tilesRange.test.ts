// Route-level test (Miniflare/workerd) for GET /api/tiles/:name/:z/:x/:y.
//
// Pins the three-way response vocabulary the tile route has to keep distinct:
//   200 — the archive returned tile bytes
//   204 — a VALID coordinate the archive simply has no features for
//   400 — a coordinate outside the 2^z x 2^z grid, which cannot exist at all
//
// The 400 case is the regression under test: before the range check,
// PMTiles.getZxy() threw on the out-of-grid lookup and the route's catch-all
// turned that into a 500 (verified live 2026-08-02 on
// /api/tiles/utah-roads/8/193/384.mvt). Mapbox GL requests out-of-range tiles
// at low zoom near the antimeridian/poles, so a 500 there both pollutes
// error_log and can trip alerting.
//
// PMTiles is module-mocked: this exercises the ROUTE's validation and response
// shaping, and lets the out-of-range assertion prove the archive is never
// touched at all (getZxy must not be called), which is the actual fix.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Per-test control over what the fake archive returns. `getZxy` is a shared spy
// so a test can assert it was NOT reached.
let tileResult: { data: ArrayBuffer } | undefined;
const getZxy = vi.fn(async (z: number, x: number, y: number) => {
  const grid = 2 ** z;
  // Mirror the real library: an out-of-grid lookup throws rather than
  // returning undefined. If the route ever stops range-checking, this is what
  // reproduces the 500.
  if (x < 0 || x >= grid || y < 0 || y >= grid) {
    throw new Error(`tile ${z}/${x}/${y} out of bounds`);
  }
  return tileResult;
});

vi.mock('pmtiles', () => ({
  PMTiles: class {
    constructor(_source: unknown) {}
    getZxy = getZxy;
  },
}));

const { default: tiles } = await import('../src/routes/tiles');

const app = new Hono<{ Bindings: Record<string, unknown> }>();
app.route('/api/tiles', tiles);

// The mocked PMTiles never reads the bucket, so a bare object satisfies the
// binding. (MAP_DATA is not among the Miniflare r2Buckets in
// vitest.workers.config.mts, and this test deliberately doesn't need it.)
const env = { MAP_DATA: {} } as unknown as Record<string, unknown>;

describe('GET /api/tiles/:name/:z/:x/:y — coordinate range checking', () => {
  beforeEach(() => {
    getZxy.mockClear();
    tileResult = undefined;
  });

  it('returns 200 with the tile bytes for a valid in-grid coordinate', async () => {
    tileResult = { data: new Uint8Array([0x1a, 0x02, 0x78, 0x01]).buffer };
    const res = await app.request('/api/tiles/osm-jurisdiction/8/48/96.mvt', {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/x-protobuf');
    expect((await res.arrayBuffer()).byteLength).toBe(4);
    expect(getZxy).toHaveBeenCalledWith(8, 48, 96);
  });

  it('returns 204 for a valid coordinate the archive has no data for', async () => {
    tileResult = undefined;
    const res = await app.request('/api/tiles/osm-jurisdiction/8/48/97.mvt', {}, env);
    expect(res.status).toBe(204);
    expect(getZxy).toHaveBeenCalledTimes(1);
  });

  it('returns 400 — not 500 — for y outside the grid, without touching the archive', async () => {
    // The live reproduction: at z=8 the grid is 256x256, so y=384 cannot exist.
    const res = await app.request('/api/tiles/utah-roads/8/193/384.mvt', {}, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'tile out of range' });
    expect(getZxy).not.toHaveBeenCalled();
  });

  it('returns 400 for x outside the grid', async () => {
    const res = await app.request('/api/tiles/utah-roads/2/4/0.mvt', {}, env);
    expect(res.status).toBe(400);
    expect(getZxy).not.toHaveBeenCalled();
  });

  it('accepts the last valid coordinate at a zoom (2^z - 1) rather than off-by-one rejecting it', async () => {
    tileResult = { data: new Uint8Array([0x00]).buffer };
    const res = await app.request('/api/tiles/utah-roads/2/3/3.mvt', {}, env);
    expect(res.status).toBe(200);
    expect(getZxy).toHaveBeenCalledWith(2, 3, 3);
  });

  it('returns 400 for a negative coordinate', async () => {
    const res = await app.request('/api/tiles/utah-roads/8/-1/0.mvt', {}, env);
    expect(res.status).toBe(400);
    expect(getZxy).not.toHaveBeenCalled();
  });

  it('returns 400 for a zoom beyond the addressable pyramid', async () => {
    const res = await app.request('/api/tiles/utah-roads/40/0/0.mvt', {}, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'tile out of range' });
    expect(getZxy).not.toHaveBeenCalled();
  });

  it('still returns 400 bad zxy for unparseable coordinates', async () => {
    const res = await app.request('/api/tiles/utah-roads/8/abc/0.mvt', {}, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad zxy' });
    expect(getZxy).not.toHaveBeenCalled();
  });
});
