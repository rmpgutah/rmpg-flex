import { Hono } from 'hono';
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

// R2-backed PMTiles Source: range reads against the archive object.
class R2Source implements Source {
  constructor(private bucket: R2Bucket, private archiveKey: string) {}
  getKey() { return this.archiveKey; }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const obj = await this.bucket.get(this.archiveKey, { range: { offset, length } });
    if (!obj) throw new Error(`archive not found: ${this.archiveKey}`);
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

  try {
    const arch = getArchive(c.env.MAP_DATA, name);
    const tile = await arch.getZxy(z, x, y);
    if (!tile || !tile.data) {
      // No data at this tile — empty 204 so mapbox treats it as a blank tile.
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    return new Response(tile.data, { headers: TILE_HEADERS });
  } catch (err) {
    console.error(`tile ${name}/${z}/${x}/${y} error:`, err);
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
    console.error('archive serve error:', err);
    return c.json({ error: 'failed' }, 500);
  }
});

export default tiles;
