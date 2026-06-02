import { Hono } from 'hono';
import type { Env } from '../types';

// ============================================================
// RMPG Flex — Vector Tile (PMTiles) server
// ============================================================
// Serves PMTiles archives from R2 (`MAP_DATA` = system-essentials,
// under the `tiles/` key prefix) with HTTP Range support.
//
// PMTiles is a single-file tile archive: the client (pmtiles JS lib,
// registered as a `pmtiles://` protocol on Mapbox GL JS) first reads
// the header/directory with a small range request, then range-fetches
// only the individual MVT tiles in the current viewport. Range support
// here is therefore MANDATORY — without a 206 response the client falls
// back to downloading the entire (tens-of-MB) archive per map.
//
// This is a NEW, isolated namespace deliberately kept separate from
// /api/map-data (which stays on the legacy worker — see proxy/index.ts).
// Routed to env.API via an API_ROUTES rule in the proxy.
// ============================================================

const tiles = new Hono<Env>();

// Parse a single-range `Range: bytes=start-end` header against a known
// object size. Returns null for absent/unsatisfiable/multi-range headers
// (caller then serves the full object). Supports open-ended (`bytes=500-`)
// and suffix (`bytes=-500`) forms.
function parseRange(
  header: string | undefined,
  size: number,
): { offset: number; length: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, startStr, endStr] = m;

  if (startStr === '' && endStr === '') return null;

  let start: number;
  let end: number;
  if (startStr === '') {
    // suffix: last N bytes
    const suffix = parseInt(endStr, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === '' ? size - 1 : parseInt(endStr, 10);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  end = Math.min(end, size - 1);

  return { offset: start, length: end - start + 1 };
}

function applyTileHeaders(headers: Headers, obj: R2Object): void {
  // PMTiles archives are content-addressed by filename; treat as immutable
  // and cacheable for a long time. Bump the filename to bust the cache.
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Headers', 'Range');
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, ETag');
  headers.set('Content-Type', 'application/octet-stream');
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
}

// GET /api/tiles/:path+ — stream a PMTiles archive (with Range support)
tiles.get('/:path{[\\s\\S]+}', async (c) => {
  try {
    const path = c.req.param('path') || '';
    // Guard against traversal; only serve from the tiles/ prefix.
    if (path.includes('..')) return c.json({ error: 'Invalid path' }, 400);
    const key = `tiles/${path}`;

    const rangeHeader = c.req.header('Range');

    // Size probe first so we can compute a valid 206 without pulling the
    // whole body when a range is requested.
    if (rangeHeader) {
      const head = await c.env.MAP_DATA.head(key);
      if (!head) return c.json({ error: 'File not found', key }, 404);

      const range = parseRange(rangeHeader, head.size);
      if (!range) {
        // Unsatisfiable range -> 416 with the object size.
        const headers = new Headers();
        headers.set('Content-Range', `bytes */${head.size}`);
        headers.set('Access-Control-Allow-Origin', '*');
        return new Response(null, { status: 416, headers });
      }

      const obj = await c.env.MAP_DATA.get(key, {
        range: { offset: range.offset, length: range.length },
      });
      if (!obj) return c.json({ error: 'File not found', key }, 404);

      const headers = new Headers();
      applyTileHeaders(headers, obj);
      headers.set('Content-Length', String(range.length));
      headers.set(
        'Content-Range',
        `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`,
      );
      return new Response(obj.body, { status: 206, headers });
    }

    // No range — serve the whole archive (still advertise Accept-Ranges so
    // a client that probed without a range learns ranges are available).
    const obj = await c.env.MAP_DATA.get(key);
    if (!obj) return c.json({ error: 'File not found', key }, 404);

    const headers = new Headers();
    applyTileHeaders(headers, obj);
    headers.set('Content-Length', String(obj.size));
    return new Response(obj.body, { status: 200, headers });
  } catch (err) {
    console.error('Tile serve error:', err);
    return c.json({ error: 'Failed to get tile' }, 500);
  }
});

// OPTIONS preflight for cross-origin Range requests.
tiles.options('/:path{[\\s\\S]+}', (c) => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Max-Age': '86400',
    },
  });
});

export default tiles;
