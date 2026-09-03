// ============================================================
// RMPG Flex — property_photos (Cloudflare Worker, R2-backed)
// ============================================================
// Site/exterior/interior reference photos AND floor-plan/site-plan layout
// images for a real-estate property record (the security-client `properties`
// table — gate_code/alarm_code/post_orders — distinct from the evidence
// "property" concept elsewhere in the app). Mirrors
// src/routes/business/photos.ts exactly; see that file's header comment for
// the R2 auth-through-Worker rationale.
//
// `kind` distinguishes a site photo ('photo', default) from a layout image
// ('layout'); `category` only applies to kind='photo'.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute, ensureJurisdictionAndPhotoColumns } from '../../utils/db';

import { dbErrorResponse } from '../../utils/dbErrors';
import { putEncrypted, getDecrypted, deleteEncryptionKey } from '../../utils/encryptedR2';
const propertyPhotos = new Hono<Env>();

const VALID_CATEGORIES = ['exterior', 'interior', 'access', 'hazard', 'other'] as const;
const VALID_KINDS = ['photo', 'layout'] as const;
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

// GET /api/property-photos/file/:key{.+} — stream a photo from R2.
propertyPhotos.get('/file/:key{.+}', async (c) => {
  try {
    const key = c.req.param('key');
    if (!key.startsWith('property-photos/')) {
      return c.json({ error: 'Invalid key', code: 'INVALID_KEY' }, 400);
    }
    const decrypted = await getDecrypted(c.env.UPLOADS, getDb(c.env), c.env, key);
    if (decrypted) {
      return new Response(decrypted.bytes, {
        headers: {
          'Content-Type': decrypted.httpMetadata?.contentType || 'application/octet-stream',
          'Cache-Control': 'private, max-age=300',
        },
      });
    }

    // getDecrypted() returns a clean null both for "object never existed"
    // and for "object exists but has no file_encryption_keys row" — the
    // latter is what every property photo uploaded before this feature
    // shipped looks like. Fall back to the raw R2 bytes; 404 only if
    // neither the decrypted path nor the raw object produced anything. A
    // genuine decrypt failure (bad KEK, tampered ciphertext) THROWS instead
    // of returning null, so it propagates to the outer catch below rather
    // than silently masquerading as "legacy."
    const legacy = await c.env.UPLOADS.get(key);
    if (!legacy) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

    const data = await legacy.arrayBuffer();
    c.header('Content-Type', legacy.httpMetadata?.contentType || 'application/octet-stream');
    c.header('Cache-Control', 'private, max-age=300');
    return c.body(data);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to fetch photo', 'FETCH_PHOTO_ERROR');
  }
});

// GET /api/property-photos/:propertyId — list photos newest first.
propertyPhotos.get('/:propertyId', async (c) => {
  try {
    const db = getDb(c.env);
    const propertyId = parseInt(c.req.param('propertyId'), 10);
    if (!Number.isFinite(propertyId)) {
      return c.json({ error: 'Invalid propertyId' }, 400);
    }
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM property_photos
       WHERE property_id = ?
       ORDER BY uploaded_at DESC, id DESC`,
      propertyId,
    );
    return c.json(rows);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to load property photos', 'LOAD_PROPERTY_PHOTOS_ERROR');
  }
});

// POST /api/property-photos — multipart upload to R2.
// formData: photo (File), property_id, kind ('photo'|'layout', default 'photo'), category?, caption?
propertyPhotos.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    await ensureJurisdictionAndPhotoColumns(db);
    const userId = c.get('userId') as number | undefined;

    const formData = await c.req.formData();
    const photoEntry = formData.get('photo');
    const propertyIdRaw = formData.get('property_id');
    const category = formData.get('category') ? String(formData.get('category')) : '';
    const caption = formData.get('caption') ? String(formData.get('caption')) : null;
    const kindRaw = formData.get('kind') ? String(formData.get('kind')) : 'photo';
    const kind = (VALID_KINDS as readonly string[]).includes(kindRaw) ? kindRaw : 'photo';

    if (
      !photoEntry ||
      typeof photoEntry === 'string' ||
      typeof (photoEntry as { arrayBuffer?: unknown }).arrayBuffer !== 'function'
    ) {
      return c.json({ error: 'photo file is required', code: 'PHOTO_REQUIRED' }, 400);
    }
    const photo = photoEntry as unknown as File;
    if (!propertyIdRaw) {
      return c.json({ error: 'property_id required', code: 'PROPERTY_ID_REQUIRED' }, 400);
    }
    // Layout images (floor plans/site plans) don't fit the exterior/
    // interior/access/hazard taxonomy — category is only required for
    // kind='photo' (the default).
    if (kind === 'photo' && category && !(VALID_CATEGORIES as readonly string[]).includes(category)) {
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

    const propertyId = parseInt(String(propertyIdRaw), 10);
    if (!Number.isFinite(propertyId)) {
      return c.json({ error: 'Invalid property_id' }, 400);
    }
    const prop = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM properties WHERE id = ?', propertyId,
    );
    if (!prop) return c.json({ error: 'Property not found' }, 404);

    const r2Key = `property-photos/${crypto.randomUUID()}${extFor(photo)}`;
    const buffer = await photo.arrayBuffer();
    await putEncrypted(c.env.UPLOADS, db, c.env, r2Key, buffer, {
      httpMetadata: { contentType: photo.type || 'application/octet-stream' },
    });

    const apiUrl = `/api/property-photos/file/${r2Key}`;
    const result = await execute(
      db,
      `INSERT INTO property_photos
         (property_id, url, caption, category, kind, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      propertyId, apiUrl, caption, category || null, kind, userId ?? null,
    );

    const row = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM property_photos WHERE id = ?', Number(result.meta.last_row_id),
    );

    return c.json(row, 201);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to upload photo', 'UPLOAD_PHOTO_ERROR');
  }
});

// DELETE /api/property-photos/:photoId — remove DB row + R2 object.
propertyPhotos.delete('/:photoId', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('photoId'), 10);
    const before = await queryFirst<{ property_id: number; url: string }>(
      db, 'SELECT property_id, url FROM property_photos WHERE id = ?', id,
    );
    if (!before) return c.json({ error: 'Photo not found' }, 404);

    const apiPrefix = '/api/property-photos/file/';
    let r2Key: string | null = null;
    if (before.url.startsWith(apiPrefix)) {
      r2Key = before.url.slice(apiPrefix.length);
    }
    if (r2Key && r2Key.startsWith('property-photos/')) {
      try { await c.env.UPLOADS.delete(r2Key); } catch { /* non-fatal */ }
      try { await deleteEncryptionKey(db, r2Key); } catch { /* non-fatal */ }
    }

    await execute(db, 'DELETE FROM property_photos WHERE id = ?', id);

    return c.body(null, 204);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to delete photo', 'DELETE_PHOTO_ERROR');
  }
});

export default propertyPhotos;
