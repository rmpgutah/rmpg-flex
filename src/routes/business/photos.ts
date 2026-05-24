// ============================================================
// RMPG Flex — business_photos (Cloudflare Worker, R2-backed)
// ============================================================
// Storefront / interior / exterior / parking reference photos
// for a business. Files live in the UPLOADS R2 bucket under
// the `business-photos/` prefix; the row's `url` column holds
// the API path the client uses to fetch the bytes back
// (/api/business-photos/file/business-photos/<uuid>.<ext>).
//
// Authorization flows through the Worker (not a public R2
// bucket) because premise photos may show interiors of client
// sites — exposing them to the open internet is not
// appropriate. The /file/:key route validates the prefix and
// streams from R2 with the original content-type.
//
// File validation (MIME + size) happens BEFORE the R2 put so a
// rejected upload never persists partial state.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { broadcastAll } from '../ws';

const businessPhotos = new Hono<Env>();

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

// GET /api/business-photos/file/:key{.+} — stream a photo from R2.
// The :key{.+} matcher captures the remaining path including '/'
// (Hono's default :key matcher stops at '/'). Auth is enforced
// upstream in src/index.ts; the prefix guard here defends against
// arbitrary-key reads if the matcher is ever loosened.
businessPhotos.get('/file/:key{.+}', async (c) => {
  try {
    const key = c.req.param('key');
    if (!key.startsWith('business-photos/')) {
      return c.json({ error: 'Invalid key', code: 'INVALID_KEY' }, 400);
    }
    const obj = await c.env.UPLOADS.get(key);
    if (!obj) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

    // arrayBuffer + c.body sidesteps the @cloudflare/workers-types vs
    // lib.dom ReadableStream/Headers type collision. Photos cap at
    // 10 MB so buffering is fine.
    const data = await obj.arrayBuffer();
    c.header('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
    c.header('Cache-Control', 'private, max-age=300');
    c.header('etag', obj.httpEtag);
    return c.body(data);
  } catch (err) {
    return c.json({
      error: 'Failed to fetch photo',
      code: 'FETCH_PHOTO_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// GET /api/business-photos/:businessId — list photos newest first.
businessPhotos.get('/:businessId', async (c) => {
  try {
    const db = getDb(c.env);
    const businessId = parseInt(c.req.param('businessId'), 10);
    if (!Number.isFinite(businessId)) {
      return c.json({ error: 'Invalid businessId' }, 400);
    }
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM business_photos
       WHERE business_id = ?
       ORDER BY uploaded_at DESC, id DESC`,
      businessId,
    );
    return c.json(rows);
  } catch (err) {
    return c.json({
      error: 'Failed to load business photos',
      code: 'LOAD_BUSINESS_PHOTOS_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// POST /api/business-photos — multipart upload to R2.
// formData: photo (File), business_id, category, caption?
businessPhotos.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;

    const formData = await c.req.formData();
    const photoEntry = formData.get('photo');
    const businessIdRaw = formData.get('business_id');
    const category = formData.get('category') ? String(formData.get('category')) : '';
    const caption = formData.get('caption') ? String(formData.get('caption')) : null;

    // FormDataEntryValue is string | File in workers-types, but the File
    // constructor isn't always in scope for `instanceof` narrowing
    // (workers-types File vs lib.dom File mismatch). Duck-type instead.
    if (
      !photoEntry ||
      typeof photoEntry === 'string' ||
      typeof (photoEntry as { arrayBuffer?: unknown }).arrayBuffer !== 'function'
    ) {
      return c.json({ error: 'photo file is required', code: 'PHOTO_REQUIRED' }, 400);
    }
    const photo = photoEntry as unknown as File;
    if (!businessIdRaw) {
      return c.json({ error: 'business_id required', code: 'BUSINESS_ID_REQUIRED' }, 400);
    }
    if (!category || !(VALID_CATEGORIES as readonly string[]).includes(category)) {
      return c.json({
        error: 'Invalid category', code: 'INVALID_CATEGORY',
        allowed: [...VALID_CATEGORIES],
      }, 400);
    }
    if (!ALLOWED_MIME.has(photo.type)) {
      return c.json({
        error: 'Invalid file type — must be PNG, JPEG, or WEBP',
        code: 'INVALID_MIME',
      }, 400);
    }
    if (photo.size > MAX_SIZE) {
      return c.json({
        error: `File too large — max ${MAX_SIZE / 1024 / 1024} MB`,
        code: 'FILE_TOO_LARGE',
      }, 400);
    }

    const businessId = parseInt(String(businessIdRaw), 10);
    if (!Number.isFinite(businessId)) {
      return c.json({ error: 'Invalid business_id' }, 400);
    }
    const biz = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM businesses WHERE id = ?', businessId,
    );
    if (!biz) return c.json({ error: 'Business not found' }, 404);

    // Upload to R2 with crypto.randomUUID() filename — globally unique,
    // no traversal risk, no collisions on rapid uploads.
    const r2Key = `business-photos/${crypto.randomUUID()}${extFor(photo)}`;
    const buffer = await photo.arrayBuffer();
    await c.env.UPLOADS.put(r2Key, buffer, {
      httpMetadata: { contentType: photo.type || 'application/octet-stream' },
    });

    const apiUrl = `/api/business-photos/file/${r2Key}`;
    const result = await execute(
      db,
      `INSERT INTO business_photos
         (business_id, url, caption, category, uploaded_by)
       VALUES (?, ?, ?, ?, ?)`,
      businessId, apiUrl, caption, category, userId ?? null,
    );

    const row = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM business_photos WHERE id = ?', Number(result.meta.last_row_id),
    );

    broadcastAll('business_update', {
      action: 'business_photos_updated', business_id: businessId,
    });

    return c.json(row, 201);
  } catch (err) {
    return c.json({
      error: 'Failed to upload photo',
      code: 'UPLOAD_PHOTO_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// DELETE /api/business-photos/:photoId — remove DB row + R2 object.
businessPhotos.delete('/:photoId', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('photoId'), 10);
    const before = await queryFirst<{ business_id: number; url: string }>(
      db, 'SELECT business_id, url FROM business_photos WHERE id = ?', id,
    );
    if (!before) return c.json({ error: 'Photo not found' }, 404);

    // Derive the R2 key from the stored url. Path-traversal guard:
    // only delete keys under the business-photos/ prefix.
    const apiPrefix = '/api/business-photos/file/';
    let r2Key: string | null = null;
    if (before.url.startsWith(apiPrefix)) {
      r2Key = before.url.slice(apiPrefix.length);
    }
    if (r2Key && r2Key.startsWith('business-photos/')) {
      try { await c.env.UPLOADS.delete(r2Key); } catch { /* non-fatal */ }
    }

    await execute(db, 'DELETE FROM business_photos WHERE id = ?', id);
    broadcastAll('business_update', {
      action: 'business_photos_updated', business_id: before.business_id,
    });

    return c.body(null, 204);
  } catch (err) {
    return c.json({
      error: 'Failed to delete photo',
      code: 'DELETE_PHOTO_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

export default businessPhotos;
