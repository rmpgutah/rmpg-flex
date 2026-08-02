// Route-level tests (Miniflare/workerd) for the tile route's R2-facing paths:
// a missing PMTiles archive, and HTTP Range handling on the raw-archive
// endpoint. All three cases below returned HTTP 500 in production (verified
// live 2026-08-02 against https://api.rmpgutah.us) because client-controlled
// input reached the catch-all instead of being validated:
//
//   /api/tiles/does-not-exist/8/48/96.mvt  -> 500, should be 404
//   Range: bytes=100-50                    -> 500, should be 416
//   Range: bytes=99999999999-              -> 500, should be 416
//
// Deliberately does NOT mock `pmtiles` (unlike tilesRange.test.ts): the 404
// path runs the REAL library against a fake R2 bucket, so it exercises the
// actual R2Source -> ArchiveNotFoundError -> 404 seam rather than a stand-in.
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import tiles from '../src/routes/tiles';

const app = new Hono<{ Bindings: Record<string, unknown> }>();
app.route('/api/tiles', tiles);

// Minimal R2 stand-in. `get` mirrors the real binding's rejection of a
// negative range length — that is precisely what turned an unsatisfiable
// Range into a 500, so a stub that quietly tolerated it would hide the bug.
function fakeBucket(size: number | null, body = 'x') {
  return {
    async head(_key: string) {
      return size === null ? null : { size };
    },
    async get(_key: string, opts?: { range?: { offset: number; length: number } }) {
      if (size === null) return null;
      const range = opts?.range;
      if (range && (range.length < 0 || range.offset < 0)) {
        throw new Error(`invalid range: offset=${range.offset} length=${range.length}`);
      }
      return {
        body,
        async arrayBuffer() { return new ArrayBuffer(Math.max(0, range?.length ?? size)); },
      };
    },
  };
}

const envWith = (bucket: unknown) => ({ MAP_DATA: bucket }) as unknown as Record<string, unknown>;

describe('GET /api/tiles/:name/:z/:x/:y — missing archive', () => {
  it('returns 404, not 500, when the archive object is absent from R2', async () => {
    // Real PMTiles + a bucket that has nothing: R2Source throws
    // ArchiveNotFoundError while reading the header.
    const res = await app.request(
      '/api/tiles/does-not-exist-archive/8/48/96.mvt',
      {},
      envWith(fakeBucket(null)),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'archive not found' });
  });

  it('does not permanently poison the per-isolate cache for that name', async () => {
    // getArchive() memoizes PMTiles instances per isolate. Without eviction on
    // not-found, the failed instance (and whatever partial header state it
    // holds) would be reused, so an archive uploaded later would keep 404ing
    // for the life of the isolate. Asking twice must hit R2 twice.
    let gets = 0;
    const counting = {
      async head() { return null; },
      async get() { gets += 1; return null; },
    };
    const name = 'cache-eviction-probe';
    const first = await app.request(`/api/tiles/${name}/8/48/96.mvt`, {}, envWith(counting));
    expect(first.status).toBe(404);
    const seenAfterFirst = gets;
    expect(seenAfterFirst).toBeGreaterThan(0);

    const second = await app.request(`/api/tiles/${name}/8/48/96.mvt`, {}, envWith(counting));
    expect(second.status).toBe(404);
    expect(gets).toBeGreaterThan(seenAfterFirst);
  });
});

describe('GET /api/tiles/:file — Range handling on the raw archive', () => {
  const SIZE = 78681639; // real utah-roads.pmtiles size, for realistic clamping

  it('serves a satisfiable range as 206 with Content-Range', async () => {
    const res = await app.request(
      '/api/tiles/utah-roads.pmtiles',
      { headers: { Range: 'bytes=0-15' } },
      envWith(fakeBucket(SIZE)),
    );
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-15/${SIZE}`);
    expect(res.headers.get('Content-Length')).toBe('16');
  });

  it('serves an open-ended range to EOF as 206', async () => {
    const res = await app.request(
      '/api/tiles/utah-roads.pmtiles',
      { headers: { Range: 'bytes=100-' } },
      envWith(fakeBucket(SIZE)),
    );
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 100-${SIZE - 1}/${SIZE}`);
  });

  it('returns 416 — not 500 — when start > end (bytes=100-50)', async () => {
    const res = await app.request(
      '/api/tiles/utah-roads.pmtiles',
      { headers: { Range: 'bytes=100-50' } },
      envWith(fakeBucket(SIZE)),
    );
    expect(res.status).toBe(416);
    expect(await res.json()).toEqual({ error: 'range not satisfiable' });
    expect(res.headers.get('Content-Range')).toBe(`bytes */${SIZE}`);
  });

  it('returns 416 — not 500 — when start is past EOF (bytes=99999999999-)', async () => {
    // The clamp protects `end` but not `start`, so `end - start + 1` underflows
    // to a negative length and R2 rejects it. This is the live 500.
    const res = await app.request(
      '/api/tiles/utah-roads.pmtiles',
      { headers: { Range: 'bytes=99999999999-' } },
      envWith(fakeBucket(SIZE)),
    );
    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe(`bytes */${SIZE}`);
  });

  it('returns 416 for a start exactly at EOF (off-by-one boundary)', async () => {
    // Offset SIZE is the first unreadable byte; SIZE-1 is the last valid one.
    const at = await app.request(
      '/api/tiles/utah-roads.pmtiles',
      { headers: { Range: `bytes=${SIZE}-` } },
      envWith(fakeBucket(SIZE)),
    );
    expect(at.status).toBe(416);

    const last = await app.request(
      '/api/tiles/utah-roads.pmtiles',
      { headers: { Range: `bytes=${SIZE - 1}-` } },
      envWith(fakeBucket(SIZE)),
    );
    expect(last.status).toBe(206);
    expect(last.headers.get('Content-Range')).toBe(`bytes ${SIZE - 1}-${SIZE - 1}/${SIZE}`);
  });

  it('returns 416 for an unparseable Range header', async () => {
    const res = await app.request(
      '/api/tiles/utah-roads.pmtiles',
      { headers: { Range: 'bytes=abc-' } },
      envWith(fakeBucket(SIZE)),
    );
    expect(res.status).toBe(416);
    expect(await res.json()).toEqual({ error: 'bad range' });
  });

  it('returns 404 for a Range request against an absent archive', async () => {
    const res = await app.request(
      '/api/tiles/missing.pmtiles',
      { headers: { Range: 'bytes=0-15' } },
      envWith(fakeBucket(null)),
    );
    expect(res.status).toBe(404);
  });

  it('rejects path traversal before touching R2', async () => {
    const res = await app.request('/api/tiles/..%2Fsecret.pmtiles', {}, envWith(fakeBucket(SIZE)));
    expect(res.status).toBe(400);
  });
});
