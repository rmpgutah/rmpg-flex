// ============================================================
// RMPG Flex — Admin map-data (system-essentials) file manager
// ============================================================
// Lets an admin list/upload/delete objects in the system-essentials R2
// bucket (bound as MAP_DATA) from the app instead of `wrangler`/dashboard.
// Mounted at /api/admin/map-data with auth: 'required' in routesConfig.ts
// — unlike the public /api/map-data tile-serving router (src/routes/
// mapData.ts), every handler here ALSO checks for the admin role, since
// that prefix stays public for tile-serving.
//
// Uploads go through the same presigned-PUT pattern as the attachments
// flow (src/routes/uploads.ts) via src/utils/r2Presign.ts, but there's no
// DB row to create afterward — MAP_DATA objects have no metadata table —
// so there's no "complete" endpoint; the client just re-fetches GET /files.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { presignPutUrl, r2CredentialsConfigured } from '../utils/r2Presign';
import { log } from '../utils/logger';

const adminMapData = new Hono<Env>();

const BUCKET_NAME = 'system-essentials';
const ALLOWED_PREFIXES = ['Map Overlay Database/', 'tiles/'];
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
const PRESIGN_EXPIRES_SECONDS = 1800; // 30 min

function requireRole(
  c: { get: (k: 'user') => { role: string } | undefined },
  ...roles: string[]
): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

function isAllowedKey(key: string): boolean {
  return ALLOWED_PREFIXES.some((p) => key.startsWith(p)) && !key.includes('..');
}

adminMapData.get('/files', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied }, 403);

  try {
    const objects = await c.env.MAP_DATA.list();
    const files = objects.objects.map((o: any) => ({
      key: o.key,
      size: o.size,
      uploaded: o.uploaded,
    }));
    return c.json({ files });
  } catch (err) {
    log.error('GET /admin/map-data/files failed:', { src: 'routes/adminMapData.ts' }, err instanceof Error ? err.message : String(err));
    return c.json({ error: 'Failed to list files' }, 500);
  }
});

adminMapData.post('/presign', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied }, 403);

  if (!r2CredentialsConfigured(c.env)) {
    return c.json({ ok: false, code: 'not_configured' });
  }

  const body = await c.req.json<{ key?: string; contentType?: string; size?: number }>().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

  const key = String(body.key || '').trim();
  const size = Number(body.size);
  if (!key) return c.json({ error: 'key is required' }, 400);
  if (!isAllowedKey(key)) {
    return c.json({ error: `key must start with one of: ${ALLOWED_PREFIXES.join(', ')}` }, 400);
  }
  if (!Number.isFinite(size) || size <= 0) {
    return c.json({ error: 'size must be positive' }, 400);
  }
  if (size > MAX_FILE_SIZE) {
    return c.json({ error: `File too large — max ${MAX_FILE_SIZE / 1024 / 1024} MB` }, 400);
  }

  try {
    const uploadUrl = await presignPutUrl(c.env, BUCKET_NAME, key, PRESIGN_EXPIRES_SECONDS);
    return c.json({ upload_url: uploadUrl, key });
  } catch (err) {
    log.error('POST /admin/map-data/presign failed:', { src: 'routes/adminMapData.ts' }, err instanceof Error ? err.message : String(err));
    return c.json({ error: 'Failed to create upload URL' }, 500);
  }
});

adminMapData.delete('/files/:key{[\\s\\S]*}', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied }, 403);

  const key = decodeURIComponent(c.req.param('key'));
  if (!isAllowedKey(key)) {
    return c.json({ error: `key must start with one of: ${ALLOWED_PREFIXES.join(', ')}` }, 400);
  }

  try {
    await c.env.MAP_DATA.delete(key);
    return c.json({ ok: true });
  } catch (err) {
    log.error('DELETE /admin/map-data/files failed:', { src: 'routes/adminMapData.ts' }, err instanceof Error ? err.message : String(err));
    return c.json({ error: 'Failed to delete file' }, 500);
  }
});

export default adminMapData;
