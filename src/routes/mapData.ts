import { Hono } from 'hono';
import type { Env } from '../types';

const mapData = new Hono<Env>();

// GET /api/map-data/:path+ — Stream files from R2
mapData.get('/:path{[\\s\\S]*}', async (c) => {
  try {
    const path = c.req.param('path') || '';
    const fullPath = `Map Overlay Database/${path}`;
    const obj = await c.env.MAP_DATA.get(fullPath);

    if (!obj) {
      return c.json({ error: 'File not found', path: fullPath }, 404);
    }

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(obj.body, {
      headers,
    });
  } catch (err) {
    console.error('Map data error:', err);
    return c.json({ error: 'Failed to get file' }, 500);
  }
});

// GET /api/map-data — List files in the bucket
mapData.get('/', async (c) => {
  try {
    const objects = await c.env.MAP_DATA.list({ prefix: 'Map Overlay Database/' });
    const files = objects.objects.map(o => ({
      key: o.key,
      size: o.size,
      uploaded: o.uploaded,
    }));
    return c.json({ files });
  } catch (err) {
    return c.json({ error: 'Failed to list files' }, 500);
  }
});

export default mapData;
