import { Hono } from 'hono';
import { log } from '../utils/logger';
import { PMTiles, type Source, type RangeResponse } from 'pmtiles';
import type { Env } from '../types';

// ============================================================
// RMPG Flex — Vector Tile server (PMTiles -> native XYZ MVT)
// ============================================================
// Mapbox GL JS (unlike MapLibre) has NO addProtocol, so the client can't
// read a `pmtiles://` archive directly. Instead this Worker reads the
// PMTiles archives from R2 server-side (the `pmtiles` lib is isomorphic)
// and serves individual /api/tiles/{name}/{z}/{x}/{y}.mvt tiles, which
// mapbox-gl consumes as a standard `{type:'vector', tiles:[...]}` source.
//
// Archives live in R2 (MAP_DATA = system-essentials) under tiles/<name>.pmtiles.
// ============================================================

const tiles = new Hono<Env>();

// Thrown when the requested archive object isn't in R2 at all, as opposed to
// the archive being present but having no tile at some coordinate. The tile
// handler has to tell those apart: a missing archive is a 404, a missing tile
// is a 204, and neither is a server fault.
class ArchiveNotFoundError extends Error {
  constructor(public archiveKey: string) {
    super(`archive not found: ${archiveKey}`);
    this.name = 'ArchiveNotFoundError';
  }
}

// R2-backed PMTiles Source: range reads against the archive object.
class R2Source implements Source {
  constructor(private bucket: R2Bucket, private archiveKey: string) {}
  getKey() { return this.archiveKey; }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const obj = await this.bucket.get(this.archiveKey, { range: { offset, length } });
    if (!obj) throw new ArchiveNotFoundError(this.archiveKey);
    const data = await obj.arrayBuffer();
    return { data };
  }
}

// Cache PMTiles instances per isolate so the header + root directory are
// read once and reused across tile requests.
const archives = new Map<string, PMTiles>();
function getArchive(bucket: R2Bucket, name: string): PMTiles {
  const key = `tiles/${name}.pmtiles`;
  let p = archives.get(key);
  if (!p) {
    p = new PMTiles(new R2Source(bucket, key));
    archives.set(key, p);
  }
  return p;
}

// Drop a cached PMTiles instance. Called when the archive turns out to be
// missing: the instance would otherwise sit in the per-isolate map holding
// whatever partial header state it got before failing, so an archive uploaded
// later would keep 404ing for the life of the isolate.
function forgetArchive(name: string): void {
  archives.delete(`tiles/${name}.pmtiles`);
}

// Deepest zoom the XYZ scheme addresses; 2^22 tiles per axis is already far
// beyond anything our archives contain, and it keeps `2 ** z` well inside the
// safe-integer range no matter what a client sends.
const MAX_ZOOM = 22;

const TILE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/x-protobuf',
  'Cache-Control': 'public, max-age=86400',
  'Access-Control-Allow-Origin': '*',
};

// GET /api/tiles/:name/:z/:x/:y(.mvt) — one vector tile.
tiles.get('/:name/:z/:x/:y', async (c) => {
  const name = c.req.param('name');
  if (!/^[a-z0-9_-]+$/i.test(name)) return c.json({ error: 'bad name' }, 400);
  const z = parseInt(c.req.param('z'), 10);
  const x = parseInt(c.req.param('x'), 10);
  const y = parseInt(c.req.param('y').replace(/\.(mvt|pbf)$/i, ''), 10);
  if (![z, x, y].every(Number.isFinite)) return c.json({ error: 'bad zxy' }, 400);
  // Range-check against the tile pyramid BEFORE touching the archive.
  // PMTiles.getZxy() throws on a coordinate outside the 2^z x 2^z grid for the
  // requested zoom, which the catch-all below would surface as a 500. Mapbox GL
  // legitimately asks for out-of-range tiles at low zoom (near the antimeridian
  // and the poles), so this has to read as "no such tile" (4xx), not as a server
  // fault — a 500 here pollutes error_log and can trip alerting. Kept distinct
  // from the 204 below, which means "this tile exists but has no features".
  if (z < 0 || z > MAX_ZOOM) return c.json({ error: 'tile out of range' }, 400);
  const gridSize = 2 ** z;
  if (x < 0 || x >= gridSize || y < 0 || y >= gridSize) {
    return c.json({ error: 'tile out of range' }, 400);
  }

  try {
    const arch = getArchive(c.env.MAP_DATA, name);
    const tile = await arch.getZxy(z, x, y);
    if (!tile || !tile.data) {
      // No data at this tile — empty 204 so mapbox treats it as a blank tile.
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    return new Response(tile.data, { headers: TILE_HEADERS });
  } catch (err) {
    if (err instanceof ArchiveNotFoundError) {
      // The archive object isn't in R2 — a client asking for a layer we don't
      // serve, not a server fault. Same reasoning as the range check above:
      // this must not land in error_log as a 500.
      forgetArchive(name);
      return c.json({ error: 'archive not found' }, 404);
    }
    log.error(`tile ${name}/${z}/${x}/${y} error`, {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'tile failed' }, 500);
  }
});

// GET /api/tiles/:file — raw archive (single segment, e.g. utah-roads.pmtiles).
// Kept for direct download / debugging with HTTP Range support.
tiles.get('/:file', async (c) => {
  const file = c.req.param('file');
  if (file.includes('..') || file.includes('/')) return c.json({ error: 'bad path' }, 400);
  const key = `tiles/${file}`;
  const rangeHeader = c.req.header('Range');
  try {
    if (rangeHeader) {
      const head = await c.env.MAP_DATA.head(key);
      if (!head) return c.json({ error: 'not found' }, 404);
      const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
      if (!m) return c.json({ error: 'bad range' }, 416);
      const start = parseInt(m[1], 10);
      const end = m[2] ? Math.min(parseInt(m[2], 10), head.size - 1) : head.size - 1;
      // An unsatisfiable range must be a 416, not a 500. Both of these make
      // `end - start + 1` NEGATIVE, and R2's get() rejects a negative range
      // length, which the catch-all below would report as a server fault:
      //   - start > end        e.g. "bytes=100-50"
      //   - start past EOF     e.g. "bytes=99999999999-" (end clamps to
      //                        size-1, start doesn't, so the clamp protects
      //                        only one side of the subtraction)
      // RFC 9110 wants a "bytes */<size>" Content-Range on a 416 so the client
      // learns the real length and can re-request correctly.
      if (start > end || start >= head.size) {
        return c.json({ error: 'range not satisfiable' }, 416, {
          'Content-Range': `bytes */${head.size}`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        });
      }
      const obj = await c.env.MAP_DATA.get(key, { range: { offset: start, length: end - start + 1 } });
      if (!obj) return c.json({ error: 'not found' }, 404);
      return new Response(obj.body, {
        status: 206,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Range': `bytes ${start}-${end}/${head.size}`,
          'Content-Length': String(end - start + 1),
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    const obj = await c.env.MAP_DATA.get(key);
    if (!obj) return c.json({ error: 'not found' }, 404);
    return new Response(obj.body, {
      headers: { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    log.error('archive serve error:', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'failed' }, 500);
  }
});

export default tiles;
