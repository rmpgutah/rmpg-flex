// ============================================================
// RMPG Flex — business_photos routes (Cloudflare Workers / Hono)
// ============================================================
// Ported from server/src/routes/businessPhotos.ts. On the VPS,
// uploads went to local disk under <RMPG_UPLOADS_DIR>/business-
// photos/<uuid>.<ext> and were served via the static /uploads
// middleware. On Workers, uploads go to the R2 'UPLOADS' bucket
// under business-photos/<uuid>.<ext> and the row's url column
// holds the relative path; a separate /api/business-photos/file/
// :key endpoint streams the bytes back through the Worker.
//
// File-validation errors (size, MIME) are turned into 400s by
// gating on the parsed File metadata before issuing the R2 put,
// so a rejected upload never persists any partial state.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { auditLog } from '../worker-middleware/auditLogger';
import { D1Db, paramNum, paramStr } from '../worker-middleware/d1Helpers';

const VALID_CATEGORIES = ['storefront', 'interior', 'exterior', 'parking', 'other'] as const;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

function extFor(file: File): string {
  const fromName = file.name && file.name.includes('.')
    ? '.' + file.name.split('.').pop()!.toLowerCase()
    : '';
  if (fromName) return fromName;
  if (file.type === 'image/png') return '.png';
  if (file.type === 'image/jpeg') return '.jpg';
  if (file.type === 'image/webp') return '.webp';
  return '';
}

export function mountBusinessPhotosRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  let schemaReady = false;
  async function ensureSchema(db: D1Db): Promise<void> {
    if (schemaReady) return;
    try {
      await db.prepare(`CREATE TABLE IF NOT EXISTS business_photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id INTEGER NOT NULL,
        url TEXT NOT NULL,
        caption TEXT,
        category TEXT CHECK(category IN ('storefront','interior','exterior','parking','other')),
        uploaded_by INTEGER,
        uploaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_business_photos_business ON business_photos(business_id)`).run();
      schemaReady = true;
    } catch { /* non-fatal */ }
  }

  // GET /api/business-photos/file/:key — stream a photo from R2.
  // Auth required (above middleware). Path-traversal guard: the path is matched
  // by Hono's :key segment which doesn't allow '/' by default, and we reject
  // anything that doesn't start with the expected prefix.
  api.get('/file/:key{.+}', async (c) => {
    try {
      const key = paramStr(c.req.param('key'));
      if (!key.startsWith('business-photos/')) {
        return c.json({ error: 'Invalid key', code: 'INVALID_KEY' }, 400);
      }
      const obj = await c.env.UPLOADS.get(key);
      if (!obj) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

      // Buffer rather than stream — matches uploads-worker.ts pattern and
      // sidesteps the workers-types vs lib.dom ReadableStream/Headers type
      // collision. Business photos are capped at 10 MB so buffering is fine.
      const data = await obj.arrayBuffer();
      const contentType = obj.httpMetadata?.contentType || 'application/octet-stream';
      c.header('Content-Type', contentType);
      c.header('Cache-Control', 'private, max-age=300');
      c.header('etag', obj.httpEtag);
      return c.body(data);
    } catch (err: any) {
      return c.json({ error: 'Failed to fetch photo', code: 'FETCH_PHOTO_ERROR', detail: err?.message }, 500);
    }
  });

  // GET /api/business-photos/:businessId — list photos newest first
  api.get('/:businessId',
    requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer', 'client_viewer', 'human_resources', 'contract_manager'),
    async (c) => {
      try {
        const db = new D1Db(c.env.DB);
        await ensureSchema(db);
        const businessId = paramNum(c.req.param('businessId'));
        const rows = await db.prepare(
          'SELECT * FROM business_photos WHERE business_id = ? ORDER BY uploaded_at DESC, id DESC'
        ).all(businessId);
        return c.json(rows);
      } catch (err: any) {
        return c.json({ error: 'Failed to load business photos', code: 'LOAD_BUSINESS_PHOTOS_ERROR', detail: err?.message }, 500);
      }
    },
  );

  // POST /api/business-photos — multipart upload to R2
  // Validates BEFORE the R2 put so a rejected upload never persists partial
  // state. Field order in formData: photo (File), business_id, category, caption?.
  api.post('/',
    requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
    async (c) => {
      try {
        const db = new D1Db(c.env.DB);
        await ensureSchema(db);
        const user = c.get('user');

        const formData = await c.req.formData();
        const photo = formData.get('photo');
        const business_id_raw = formData.get('business_id');
        const category = formData.get('category') ? String(formData.get('category')) : '';
        const caption = formData.get('caption') ? String(formData.get('caption')) : null;

        if (!(photo instanceof File)) {
          return c.json({ error: 'photo file is required', code: 'PHOTO_REQUIRED' }, 400);
        }
        if (!business_id_raw) {
          return c.json({ error: 'business_id required', code: 'BUSINESS_ID_REQUIRED' }, 400);
        }
        if (!category || !VALID_CATEGORIES.includes(category as any)) {
          return c.json({ error: 'Invalid category', code: 'INVALID_CATEGORY', allowed: [...VALID_CATEGORIES] }, 400);
        }
        if (!ALLOWED_MIME.has(photo.type)) {
          return c.json({ error: 'Invalid file type — must be PNG, JPEG, or WEBP', code: 'INVALID_MIME' }, 400);
        }
        if (photo.size > MAX_SIZE) {
          return c.json({ error: `File too large — max ${MAX_SIZE / 1024 / 1024} MB`, code: 'FILE_TOO_LARGE' }, 400);
        }

        const businessId = parseInt(String(business_id_raw), 10);
        if (!Number.isFinite(businessId)) {
          return c.json({ error: 'Invalid business_id', code: 'INVALID_BUSINESS_ID' }, 400);
        }
        const biz = await db.prepare('SELECT id FROM businesses WHERE id = ?').get(businessId);
        if (!biz) return c.json({ error: 'Business not found', code: 'BUSINESS_NOT_FOUND' }, 404);

        const r2Key = `business-photos/${crypto.randomUUID()}${extFor(photo)}`;
        const buffer = await photo.arrayBuffer();
        await c.env.UPLOADS.put(r2Key, buffer, {
          httpMetadata: { contentType: photo.type || 'application/octet-stream' },
        });

        // Stored url is the API path the client uses to fetch the bytes back.
        // Keeping it under /api/business-photos/file/<key> means auth flows
        // through the Worker, not a publicly-readable R2 bucket — important
        // for premise photos that may include the interior of client sites.
        const apiUrl = `/api/business-photos/file/${r2Key}`;

        const result = await db.prepare(`
          INSERT INTO business_photos (business_id, url, caption, category, uploaded_by)
          VALUES (?, ?, ?, ?, ?)
        `).run(businessId, apiUrl, caption, category, user?.userId ?? null);

        const row = await db.prepare('SELECT * FROM business_photos WHERE id = ?').get(Number(result.meta.last_row_id));
        await auditLog(db, c, 'CREATE', 'business_photo', Number(result.meta.last_row_id),
          `Uploaded ${category} photo to business ${businessId}`);

        return c.json(row, 201);
      } catch (err: any) {
        return c.json({ error: 'Failed to upload photo', code: 'UPLOAD_PHOTO_ERROR', detail: err?.message }, 500);
      }
    },
  );

  // DELETE /api/business-photos/:photoId — remove DB row + R2 object
  api.delete('/:photoId',
    requireRole('admin', 'manager', 'supervisor'),
    async (c) => {
      try {
        const db = new D1Db(c.env.DB);
        const id = paramNum(c.req.param('photoId'));
        const before = await db.prepare('SELECT * FROM business_photos WHERE id = ?').get(id) as any;
        if (!before) return c.json({ error: 'Photo not found', code: 'PHOTO_NOT_FOUND' }, 404);

        // Derive the R2 key from the stored url. Old VPS rows stored
        // /uploads/business-photos/<name>; new Worker rows store
        // /api/business-photos/file/business-photos/<name>. Handle both.
        const url = String(before.url || '');
        let r2Key: string | null = null;
        const apiPrefix = '/api/business-photos/file/';
        const legacyPrefix = '/uploads/';
        if (url.startsWith(apiPrefix)) {
          r2Key = url.slice(apiPrefix.length);
        } else if (url.startsWith(legacyPrefix)) {
          r2Key = url.slice(legacyPrefix.length);
        }
        if (r2Key && r2Key.startsWith('business-photos/')) {
          try { await c.env.UPLOADS.delete(r2Key); } catch { /* non-fatal */ }
        }

        await db.prepare('DELETE FROM business_photos WHERE id = ?').run(id);
        await auditLog(db, c, 'DELETE', 'business_photo', id, `Deleted photo from business ${before.business_id}`);

        return c.body(null, 204);
      } catch (err: any) {
        return c.json({ error: 'Failed to delete photo', code: 'DELETE_PHOTO_ERROR', detail: err?.message }, 500);
      }
    },
  );

  app.route('/api/business-photos', api);
}
