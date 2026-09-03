import { Hono } from 'hono';
import { jwtVerify } from 'jose';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, ensureAttachmentEvidenceColumns } from '../utils/db';
import { ensureDefaultDocumentsFolder } from './documents/folders';
import { presignPutUrl, r2CredentialsConfigured } from '../utils/r2Presign';
import { putEncrypted, getDecrypted, deleteEncryptionKey, FileEncryptionError } from '../utils/encryptedR2';
import { resolveUploadMime } from '../utils/uploadMime';
import { dbErrorResponse } from '../utils/dbErrors';
import { log } from '../utils/logger';
import { mergeExif, parseImageExif } from '../utils/imageExif';
import { isInlineAudio, parseBytesRange, playbackContentType } from '../utils/inlineMedia';

const uploads = new Hono<Env>();

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff',
  'image/heic', 'image/heif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  // Document Writer saves rich documents as .html (see client/src/pages/
  // document-writer). The route was built to accept those uploads (folder_id
  // handling below) but this allowlist omitted the MIME, so every save 400'd
  // ("File type text/html is not allowed") and the page stayed "Unsaved".
  'text/html',
  // Text-editor editable types — open in the in-app TextEditorPage
  'application/json', 'text/markdown', 'text/x-markdown',
  'text/xml', 'application/xml',
  'text/javascript', 'application/javascript',
  'text/x-python', 'text/x-sh', 'text/x-yaml', 'application/x-yaml',
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska',
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg',
]);

const MAX_FILE_SIZE = 100 * 1024 * 1024;

const UPLOADS_BUCKET_NAME = 'rmpg-flex-uploads';
const PRESIGN_MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB — single-PUT ceiling
const PRESIGN_TTL_SECONDS = 1800; // 30 min — KV metadata TTL and presigned-URL expiry
const PRESIGN_KV_PREFIX = 'upload-presign:';

interface PresignMeta {
  r2Key: string;
  filename: string;
  contentType: string;
  size: number;
  entityType: string | null;
  entityId: number | null;
  folderId: number | null;
  userId: number;
}

function extFor(name: string, type: string): string {
  const fromName = name && name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
  if (fromName) return fromName;
  if (type === 'image/png') return '.png';
  if (type === 'image/jpeg') return '.jpg';
  if (type === 'image/gif') return '.gif';
  if (type === 'image/webp') return '.webp';
  if (type === 'application/pdf') return '.pdf';
  if (type === 'video/mp4') return '.mp4';
  if (type === 'video/webm') return '.webm';
  if (type === 'audio/mpeg') return '.mp3';
  if (type === 'audio/wav') return '.wav';
  return '';
}

async function hmacSign(fileId: string, secret: string, ttlSeconds = 31536000): Promise<{ sig: string; exp: number }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const data = `file:${fileId}:${exp}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sig = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return { sig, exp };
}

async function hmacVerify(fileId: string, sig: string, exp: number, secret: string): Promise<boolean> {
  if (Date.now() / 1000 > exp) return false;
  const data = `file:${fileId}:${exp}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const expected = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (sig.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < sig.length; i++) result |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return result === 0;
}

async function verifyJwt(token: string, secret: string): Promise<{ userId: number; username: string; role: string; fullName: string } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const p = payload as Record<string, unknown>;
    const userId = (p.user_id ?? p.userId) as number | undefined;
    if (userId == null) return null;
    // /api/uploads is a PUBLIC mount, so authMiddleware never runs here and
    // this is the only token-purpose gate. Reject the same non-session token
    // types authMiddleware denies (refresh / pre-2FA / password-reset) and any
    // scoped token — otherwise a pre-2FA or PSO-scoped token could read, write,
    // or delete attachments. Keep it a deny-list so legacy tokens (no `type`)
    // still resolve.
    if (typeof p.type === 'string' && ['refresh', '2fa_pending', 'pwd_reset'].includes(p.type)) return null;
    if (p.scope != null) return null;
    return {
      userId,
      username: (p.username as string) || '',
      role: (p.role as string) || '',
      fullName: (p.full_name as string) || '',
    };
  } catch {
    return null;
  }
}

async function resolveAuth(c: any): Promise<{ userId: number; username: string; role: string; fullName: string } | null> {
  const env = c.env as Env['Bindings'];

  const sigParam = c.req.query('sig');
  const expParam = c.req.query('exp');
  if (sigParam && expParam) {
    const fileId = c.req.param('fileId');
    if (fileId && await hmacVerify(fileId, sigParam, parseInt(expParam, 10), env.JWT_SECRET)) {
      return { userId: 0, username: 'signed-access', role: 'viewer', fullName: 'Signed Access' };
    }
    return null;
  }

  const authHeader = c.req.header('Authorization');
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const queryToken = c.req.query('token') || null;
  const token = headerToken || queryToken;
  if (!token) return null;

  return verifyJwt(token, env.JWT_SECRET);
}

uploads.get('/entity/:type/:id', async (c) => {
  try {
    const auth = await resolveAuth(c);
    if (!auth) return c.json({ error: 'Authentication required' }, 401);
    const db = getDb(c.env);
    await ensureAttachmentEvidenceColumns(db);
    const type = c.req.param('type');
    const id = parseInt(c.req.param('id'), 10);
    const rows = await query<any>(
      db,
      `SELECT a.*, u.full_name as uploader_name
       FROM attachments a
       LEFT JOIN users u ON a.uploaded_by = u.id
       WHERE a.entity_type = ? AND a.entity_id = ?
       ORDER BY a.created_at DESC
       LIMIT 1000`,
      type, id,
    );
    const enriched = await Promise.all(
      rows.map(async (att) => {
        const { sig, exp } = await hmacSign(att.file_id, c.env.JWT_SECRET);
        return { ...att, access_sig: sig, access_exp: exp };
      }),
    );
    return c.json(enriched);
  } catch (err) {
    log.error('List attachments failed', { type: c.req.param('type'), id: c.req.param('id') }, err as Error);
    return c.json({ error: 'Failed to list attachments', code: 'LIST_ATTACHMENTS_ERROR' }, 500);
  }
});

uploads.get('/sign/:fileId', async (c) => {
  try {
    const auth = await resolveAuth(c);
    if (!auth) return c.json({ error: 'Authentication required' }, 401);
    const db = getDb(c.env);
    const fileId = c.req.param('fileId');
    const att = await queryFirst<{ file_id: string }>(db, 'SELECT file_id FROM attachments WHERE file_id = ?', fileId);
    if (!att) return c.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404);
    const { sig, exp } = await hmacSign(fileId, c.env.JWT_SECRET);
    return c.json({ sig, exp, file_id: fileId });
  } catch (err) {
    log.error('Sign file failed', { fileId: c.req.param('fileId') }, err as Error);
    return c.json({ error: 'Failed to sign file', code: 'SIGN_FILE_ERROR' }, 500);
  }
});

uploads.get('/:fileId/thumbnail', async (c) => {
  try {
    const auth = await resolveAuth(c);
    if (!auth) return c.json({ error: 'Authentication required', code: 'AUTHENTICATION_REQUIRED' }, 401);

    const db = getDb(c.env);
    const fileId = c.req.param('fileId');
    const att = await queryFirst<any>(db, 'SELECT * FROM attachments WHERE file_id = ?', fileId);
    if (!att) return c.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404);
    if (!att.mime_type.startsWith('image/')) {
      return c.json({ error: 'Not an image', code: 'NOT_AN_IMAGE' }, 400);
    }

    const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env, att.file_path);
    let data: Uint8Array<ArrayBuffer>;
    if (decrypted) {
      // getDecrypted() always builds .bytes via `new Uint8Array(arrayBufferResult)`
      // (encryptedR2.ts), so it is always ArrayBuffer-backed; the cast matches
      // Hono's Data type, which is narrower than encryptedR2's bare Uint8Array.
      data = decrypted.bytes as Uint8Array<ArrayBuffer>;
    } else {
      // getDecrypted() returns a clean null both when the R2 object is
      // genuinely absent and when it exists but predates this feature (no
      // file_encryption_keys row). Fall back to a raw read so pre-encryption
      // attachments (this prefix has been live at up to 500 MB/file for a
      // long time) stay accessible instead of permanently 404ing. A thrown
      // decrypt error (bad KEK, tampered ciphertext) is NOT caught here — it
      // propagates to the outer try/catch below as a genuine failure.
      const legacy = await c.env.UPLOADS.get(att.file_path);
      if (!legacy) return c.json({ error: 'File not found in storage', code: 'FILE_NOT_FOUND_ON' }, 404);
      data = new Uint8Array(await legacy.arrayBuffer());
    }
    c.header('Content-Type', att.mime_type);
    c.header('Content-Disposition', `inline; filename="${att.original_name}"`);
    c.header('Cache-Control', 'private, max-age=600');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(data);
  } catch (err) {
    log.error('Thumbnail fetch failed', { fileId: c.req.param('fileId') }, err as Error);
    return c.json({ error: 'Thumbnail failed', code: 'THUMBNAIL_FAILED' }, 500);
  }
});

uploads.get('/:fileId/download', async (c) => {
  try {
    const auth = await resolveAuth(c);
    if (!auth) return c.json({ error: 'Authentication required', code: 'AUTHENTICATION_REQUIRED' }, 401);

    const db = getDb(c.env);
    const fileId = c.req.param('fileId');
    const att = await queryFirst<any>(db, 'SELECT * FROM attachments WHERE file_id = ?', fileId);
    if (!att) return c.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404);

    const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env, att.file_path);
    let data: Uint8Array<ArrayBuffer>;
    if (decrypted) {
      // getDecrypted() always builds .bytes via `new Uint8Array(arrayBufferResult)`
      // (encryptedR2.ts), so it is always ArrayBuffer-backed; the cast matches
      // Hono's Data type, which is narrower than encryptedR2's bare Uint8Array.
      data = decrypted.bytes as Uint8Array<ArrayBuffer>;
    } else {
      // See the thumbnail route above: clean null == legacy pre-encryption
      // object or genuinely missing; only a thrown decrypt error skips this
      // fallback and surfaces via the outer try/catch.
      const legacy = await c.env.UPLOADS.get(att.file_path);
      if (!legacy) return c.json({ error: 'File not found in storage', code: 'FILE_NOT_FOUND_ON' }, 404);
      data = new Uint8Array(await legacy.arrayBuffer());
    }
    c.header('Content-Type', 'application/octet-stream');
    c.header('Content-Disposition', `attachment; filename="${att.original_name}"`);
    return c.body(data);
  } catch (err) {
    log.error('Download fetch failed', { fileId: c.req.param('fileId') }, err as Error);
    return c.json({ error: 'Download failed', code: 'DOWNLOAD_FAILED' }, 500);
  }
});

uploads.get('/:fileId', async (c) => {
  try {
    const auth = await resolveAuth(c);
    if (!auth) return c.json({ error: 'Authentication required', code: 'AUTHENTICATION_REQUIRED' }, 401);

    const db = getDb(c.env);
    const fileId = c.req.param('fileId');
    const att = await queryFirst<any>(db, 'SELECT * FROM attachments WHERE file_id = ?', fileId);
    if (!att) return c.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404);

    const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env, att.file_path);
    let data: Uint8Array<ArrayBuffer>;
    if (decrypted) {
      // getDecrypted() always builds .bytes via `new Uint8Array(arrayBufferResult)`
      // (encryptedR2.ts), so it is always ArrayBuffer-backed; the cast matches
      // Hono's Data type, which is narrower than encryptedR2's bare Uint8Array.
      data = decrypted.bytes as Uint8Array<ArrayBuffer>;
    } else {
      // See the thumbnail route above: clean null == legacy pre-encryption
      // object or genuinely missing; only a thrown decrypt error skips this
      // fallback and surfaces via the outer try/catch.
      const legacy = await c.env.UPLOADS.get(att.file_path);
      if (!legacy) return c.json({ error: 'File not found in storage', code: 'FILE_NOT_FOUND_ON' }, 404);
      data = new Uint8Array(await legacy.arrayBuffer());
    }
    const contentType = playbackContentType(att.mime_type, att.original_name);
    const total = data.byteLength;
    const range = parseBytesRange(c.req.header('Range'), total);

    c.header('Content-Type', contentType);
    c.header('Content-Disposition', `inline; filename="${String(att.original_name || 'file').replace(/"/g, '')}"`);
    c.header('Cache-Control', 'private, max-age=300');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Accept-Ranges', 'bytes');
    if (!isInlineAudio(contentType, att.original_name)) {
      c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    }

    if (range === 'unsatisfiable') {
      c.header('Content-Range', `bytes */${total}`);
      return c.body(null, 416);
    }
    if (range) {
      const slice = data.subarray(range.start, range.end + 1);
      c.header('Content-Range', `bytes ${range.start}-${range.end}/${total}`);
      c.header('Content-Length', String(slice.byteLength));
      return c.body(slice, 206);
    }
    return c.body(data);
  } catch (err) {
    log.error('File fetch failed', { fileId: c.req.param('fileId') }, err as Error);
    return c.json({ error: 'Download failed', code: 'DOWNLOAD_FAILED' }, 500);
  }
});

uploads.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const auth = await resolveAuth(c);
    if (!auth || !auth.userId) return c.json({ error: 'Authentication required' }, 401);
    const userId = auth.userId;
    if (!c.env.UPLOADS) {
      return c.json({ error: 'Uploads storage is not bound', code: 'UPLOADS_NOT_BOUND' }, 503);
    }

    await ensureAttachmentEvidenceColumns(db);

    const formData = await c.req.formData();
    const rawFiles = formData.getAll('files');
    const files: File[] = [];
    for (const entry of rawFiles) {
      if (typeof entry === 'string') continue;
      if (typeof (entry as any).arrayBuffer !== 'function') continue;
      files.push(entry as unknown as File);
    }
    if (files.length === 0) {
      return c.json({ error: 'No files provided', code: 'NO_FILES_PROVIDED' }, 400);
    }

    const entityType = formData.get('entity_type') ? String(formData.get('entity_type')) : null;
    const entityIdRaw = formData.get('entity_id') ? String(formData.get('entity_id')) : null;
    // D1 rejects NaN (D1_TYPE_ERROR) — a CFS number string used to 500 the whole upload.
    const entityId = entityIdRaw && /^\d+$/.test(entityIdRaw) ? parseInt(entityIdRaw, 10) : null;

    // Evidence metadata supplied by the client at upload time.
    const geoLat = formData.get('latitude') ? parseFloat(String(formData.get('latitude'))) : null;
    const geoLon = formData.get('longitude') ? parseFloat(String(formData.get('longitude'))) : null;
    const takenAt = formData.get('taken_at') ? String(formData.get('taken_at')) : null;
    const referenceNotes = formData.get('reference_notes') ? String(formData.get('reference_notes')) : null;

    // Direct folder placement: callers (PDF editor, document writer, Documents
    // page) may pass `folder_id` to file the upload straight into a
    // document_folders row via attachments.folder_id, avoiding a second
    // move-file round-trip. Also accept entity_type=document_folder as an alias.
    const folderIdRaw = formData.get('folder_id')
      ? String(formData.get('folder_id'))
      : (entityType === 'document_folder' && entityIdRaw ? entityIdRaw : null);
    const folderId = folderIdRaw && /^\d+$/.test(folderIdRaw) ? parseInt(folderIdRaw, 10) : null;

    // Loose documents — no explicit folder AND no entity binding (Document
    // Writer, blank PDF, PDF editor saved without a source folder) — auto-file
    // into the default "Saved Documents" bucket so every saved document is
    // preserved + organized instead of landing unfiled and invisible. Entity
    // attachments (evidence, person/ID images, call/company docs — entityType set)
    // and explicitly-foldered uploads are untouched. Best-effort: if the folder
    // can't be resolved, the upload still succeeds (just unfiled).
    let effectiveFolderId = folderId;
    if (effectiveFolderId == null && entityType == null) {
      try {
        effectiveFolderId = await ensureDefaultDocumentsFolder(db, userId);
      } catch (e) {
        console.warn('[uploads] default documents folder resolve failed', e);
      }
    }

    const results: any[] = [];

    for (const file of files) {
      const mime = resolveUploadMime(file.name, file.type);
      if (!ALLOWED_MIME.has(mime)) {
        return c.json({ error: `File type ${mime || file.type || 'unknown'} is not allowed` }, 400);
      }
      if (file.size > MAX_FILE_SIZE) {
        return c.json({ error: `File too large — max ${MAX_FILE_SIZE / 1024 / 1024} MB`, code: 'FILE_TOO_LARGE' }, 400);
      }

      const fileId = crypto.randomUUID();
      const ext = extFor(file.name, mime);
      const r2Key = `attachments/${fileId}${ext}`;
      const buffer = await file.arrayBuffer();
      const fromExif = mime.startsWith('image/')
        ? parseImageExif(new Uint8Array(buffer))
        : null;
      const evidence = mergeExif(
        { latitude: geoLat, longitude: geoLon, taken_at: takenAt },
        fromExif,
      );

      await putEncrypted(c.env.UPLOADS, db, c.env, r2Key, buffer, {
        httpMetadata: { contentType: mime },
      });

      await execute(
        db,
        `INSERT INTO attachments (file_id, original_name, stored_name, file_path, mime_type, file_size, entity_type, entity_id, uploaded_by, latitude, longitude, taken_at, reference_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        fileId,
        file.name,
        `${fileId}${ext}`,
        r2Key,
        mime,
        file.size,
        entityType,
        entityId,
        userId,
        evidence.latitude ?? null,
        evidence.longitude ?? null,
        evidence.taken_at ?? null,
        referenceNotes ?? null,
      );

      if (effectiveFolderId != null) {
        // Best-effort: file the attachment into the requested (or default) folder.
        // Guarded so a missing/invalid folder never fails the whole upload.
        try {
          await execute(db, 'UPDATE attachments SET folder_id = ? WHERE file_id = ?', effectiveFolderId, fileId);
        } catch (e) {
          console.warn('Upload: folder placement failed for', fileId, e);
        }
      }

      const row = await queryFirst<any>(db, 'SELECT * FROM attachments WHERE file_id = ?', fileId);
      if (row) results.push(row);
    }

    try {
      await execute(
        db,
        `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, 'file_uploaded', ?, ?, ?, ?)`,
        userId,
        entityType || 'attachment',
        entityId,
        `Uploaded ${files.length} file(s): ${files.map((f) => f.name).join(', ')}`,
        c.req.header('CF-Connecting-IP') || 'unknown',
      );
    } catch (logErr) {
      log.error('activity_log file_uploaded insert failed', {}, logErr as Error);
    }

    return c.json(results, 201);
  } catch (err) {
    log.error('Upload failed', {}, err as Error);
    if (err instanceof FileEncryptionError) {
      return c.json({
        error: 'File storage is temporarily unavailable. Contact a supervisor.',
        code: 'ENCRYPTION_FAILED',
      }, 503);
    }
    return dbErrorResponse(c, err, 'Upload failed');
  }
});

uploads.post('/presign', async (c) => {
  try {
    const auth = await resolveAuth(c);
    if (!auth || !auth.userId) return c.json({ error: 'Authentication required' }, 401);

    if (!r2CredentialsConfigured(c.env)) {
      return c.json({ ok: false, code: 'not_configured' });
    }

    const body = await c.req.json<{
      filename?: string; contentType?: string; size?: number;
      entity_type?: string; entity_id?: number | string; folder_id?: number | string;
    }>().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

    const filename = String(body.filename || '').trim();
    const contentType = String(body.contentType || '').trim();
    const size = Number(body.size);
    if (!filename) return c.json({ error: 'filename is required' }, 400);
    if (!ALLOWED_MIME.has(contentType)) {
      return c.json({ error: `File type ${contentType} is not allowed` }, 400);
    }
    if (!Number.isFinite(size) || size <= 0) {
      return c.json({ error: 'size must be positive' }, 400);
    }
    if (size > PRESIGN_MAX_FILE_SIZE) {
      return c.json({ error: `File too large — max ${PRESIGN_MAX_FILE_SIZE / 1024 / 1024} MB`, code: 'FILE_TOO_LARGE' }, 400);
    }

    const fileId = crypto.randomUUID();
    const ext = extFor(filename, contentType);
    const r2Key = `attachments/${fileId}${ext}`;

    const entityType = body.entity_type ? String(body.entity_type) : null;
    const entityIdRaw = body.entity_id != null ? String(body.entity_id) : null;
    const entityId = entityIdRaw ? parseInt(entityIdRaw, 10) : null;
    const folderIdRaw = body.folder_id != null ? String(body.folder_id) : null;
    const folderId = folderIdRaw && /^\d+$/.test(folderIdRaw) ? parseInt(folderIdRaw, 10) : null;

    const meta: PresignMeta = {
      r2Key, filename, contentType, size,
      entityType, entityId, folderId, userId: auth.userId,
    };
    await c.env.KV.put(`${PRESIGN_KV_PREFIX}${fileId}`, JSON.stringify(meta), {
      expirationTtl: PRESIGN_TTL_SECONDS,
    });

    const uploadUrl = await presignPutUrl(c.env, UPLOADS_BUCKET_NAME, r2Key, PRESIGN_TTL_SECONDS);

    return c.json({ file_id: fileId, upload_url: uploadUrl, key: r2Key });
  } catch (err) {
    log.error('Presign upload failed', {}, err as Error);
    return c.json({ error: 'Failed to create upload URL', code: 'PRESIGN_ERROR' }, 500);
  }
});

uploads.post('/presign/:fileId/complete', async (c) => {
  try {
    const auth = await resolveAuth(c);
    if (!auth || !auth.userId) return c.json({ error: 'Authentication required' }, 401);

    const fileId = c.req.param('fileId');
    const raw = await c.env.KV.get(`${PRESIGN_KV_PREFIX}${fileId}`);
    if (!raw) return c.json({ error: 'Upload session not found or expired', code: 'PRESIGN_EXPIRED' }, 410);
    const meta = JSON.parse(raw) as PresignMeta;

    if (meta.userId !== auth.userId) {
      return c.json({ error: 'Not authorized to complete this upload' }, 403);
    }

    const head = await c.env.UPLOADS.head(meta.r2Key);
    if (!head) {
      return c.json({ error: 'File was not found in storage — upload may have failed', code: 'UPLOAD_NOT_FOUND' }, 400);
    }
    if (head.size !== meta.size) {
      return c.json({
        error: 'Uploaded file size does not match the presigned request',
        code: 'SIZE_MISMATCH', expected: meta.size, actual: head.size,
      }, 400);
    }

    const db = getDb(c.env);

    let effectiveFolderId = meta.folderId;
    if (effectiveFolderId == null && meta.entityType == null) {
      try {
        effectiveFolderId = await ensureDefaultDocumentsFolder(db, auth.userId);
      } catch (e) {
        console.warn('[uploads] default documents folder resolve failed', e);
      }
    }

    const storedName = meta.r2Key.split('/').pop() || meta.r2Key;
    await execute(
      db,
      `INSERT INTO attachments (file_id, original_name, stored_name, file_path, mime_type, file_size, entity_type, entity_id, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      fileId, meta.filename, storedName, meta.r2Key, meta.contentType, meta.size,
      meta.entityType, meta.entityId, auth.userId,
    );

    if (effectiveFolderId != null) {
      try {
        await execute(db, 'UPDATE attachments SET folder_id = ? WHERE file_id = ?', effectiveFolderId, fileId);
      } catch (e) {
        console.warn('Upload: folder placement failed for', fileId, e);
      }
    }

    await c.env.KV.delete(`${PRESIGN_KV_PREFIX}${fileId}`).catch(() => undefined);

    await execute(
      db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, 'file_uploaded', ?, ?, ?, ?)`,
      auth.userId,
      meta.entityType || 'attachment',
      meta.entityId,
      `Uploaded file: ${meta.filename}`,
      c.req.header('CF-Connecting-IP') || 'unknown',
    );

    const row = await queryFirst<any>(db, 'SELECT * FROM attachments WHERE file_id = ?', fileId);
    return c.json(row, 201);
  } catch (err) {
    log.error('Complete presign upload failed', {}, err as Error);
    return c.json({ error: 'Failed to finalize upload', code: 'COMPLETE_UPLOAD_ERROR' }, 500);
  }
});

// Create a blank named file in R2+DB — used by the text editor "New file" flow.
// POST /api/uploads/create  { name, mime_type, folder_id? }
uploads.post('/create', async (c) => {
  try {
    const auth = await resolveAuth(c);
    if (!auth || !auth.userId) return c.json({ error: 'Authentication required' }, 401);
    const db = getDb(c.env);
    const body = await c.req.json() as { name?: string; mime_type?: string; folder_id?: number | null };
    const name = (body.name || 'untitled.txt').trim();
    const mimeType = (body.mime_type || 'text/plain').trim();
    if (!ALLOWED_MIME.has(mimeType)) return c.json({ error: `File type ${mimeType} is not allowed` }, 400);

    const fileId = crypto.randomUUID();
    const ext = extFor(name, mimeType);
    const r2Key = `attachments/${fileId}${ext}`;

    await putEncrypted(c.env.UPLOADS, db, c.env, r2Key, new Uint8Array(0), {
      httpMetadata: { contentType: mimeType },
    });

    await execute(
      db,
      `INSERT INTO attachments (file_id, original_name, stored_name, file_path, mime_type, file_size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      fileId, name, `${fileId}${ext}`, r2Key, mimeType, auth.userId,
    );

    let effectiveFolderId: number | null = body.folder_id ?? null;
    if (effectiveFolderId == null) {
      try { effectiveFolderId = await ensureDefaultDocumentsFolder(db, auth.userId); } catch { /* non-fatal */ }
    }
    if (effectiveFolderId != null) {
      await execute(db, 'UPDATE attachments SET folder_id = ? WHERE file_id = ?', effectiveFolderId, fileId).catch(() => {});
    }

    const row = await queryFirst<any>(db, 'SELECT * FROM attachments WHERE file_id = ?', fileId);
    return c.json(row, 201);
  } catch (err) {
    log.error('Create file failed', {}, err as Error);
    return c.json({ error: 'Failed to create file', code: 'CREATE_FILE_ERROR' }, 500);
  }
});

// ── Attachment mutation authorization ───────────────────────
// This router is mounted auth:'public' (so <img>/<video> can present HMAC
// params instead of a header), which means NEITHER authMiddleware NOR
// readOnlyRoleGuard runs for any handler here. resolveAuth() proves only
// that a JWT is valid — it returns no scope and makes no claim about THIS
// attachment. The DELETE handler below has always applied an owner-or-admin
// check; /content and /link did not, so any authenticated account could
// overwrite the bytes of any attachment by file_id (evidence included) or
// re-parent it to a different case. Same rule for all three now.
const ATTACHMENT_ADMIN_ROLES = new Set(['admin', 'manager', 'supervisor']);
// client_viewer is listed explicitly because readOnlyRoleGuard — which
// normally blocks it from every write — is bypassed by the public mount.
const ATTACHMENT_READONLY_ROLES = new Set(['client_viewer']);

function canMutateAttachment(
  auth: { userId: number; role: string },
  att: { uploaded_by?: number | null },
): boolean {
  if (ATTACHMENT_READONLY_ROLES.has(auth.role)) return false;
  if (att.uploaded_by != null && att.uploaded_by === auth.userId) return true;
  return ATTACHMENT_ADMIN_ROLES.has(auth.role);
}

// Save text content back into an existing attachment in R2.
// PUT /api/uploads/:fileId/content  body = raw text
uploads.put('/:fileId/content', async (c) => {
  try {
    const auth = await resolveAuth(c);
    if (!auth || auth.username === 'signed-access') return c.json({ error: 'Authentication required' }, 401);
    const db = getDb(c.env);
    const fileId = c.req.param('fileId');
    const att = await queryFirst<any>(db, 'SELECT * FROM attachments WHERE file_id = ?', fileId);
    if (!att) return c.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404);
    if (!canMutateAttachment(auth, att)) {
      return c.json({ error: 'Not authorized to modify this file', code: 'FORBIDDEN' }, 403);
    }

    const text = await c.req.text();
    const encoded = new TextEncoder().encode(text);
    await putEncrypted(c.env.UPLOADS, db, c.env, att.file_path, encoded, {
      httpMetadata: { contentType: att.mime_type || 'text/plain' },
    });
    await execute(db, 'UPDATE attachments SET file_size = ? WHERE file_id = ?', encoded.byteLength, fileId);

    return c.json({ ok: true, file_id: fileId, file_size: encoded.byteLength });
  } catch (err) {
    log.error('Save content failed', { fileId: c.req.param('fileId') }, err as Error);
    return c.json({ error: 'Failed to save content', code: 'SAVE_CONTENT_ERROR' }, 500);
  }
});

uploads.put('/:fileId/link', async (c) => {
  try {
    const auth = await resolveAuth(c);
    if (!auth || auth.username === 'signed-access') return c.json({ error: 'Authentication required' }, 401);
    const db = getDb(c.env);
    const fileId = c.req.param('fileId');
    const body = await c.req.json();
    const { entity_type, entity_id } = body;

    if (!entity_type || !entity_id) {
      return c.json({ error: 'entity_type and entity_id are required', code: 'ENTITYTYPE_AND_ENTITYID_ARE' }, 400);
    }

    // Load and authorize BEFORE writing — the previous order issued the
    // UPDATE first and only then checked the row existed, so an unauthorized
    // caller's re-parenting had already been committed.
    const existing = await queryFirst<any>(db, 'SELECT * FROM attachments WHERE file_id = ?', fileId);
    if (!existing) return c.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404);
    if (!canMutateAttachment(auth, existing)) {
      return c.json({ error: 'Not authorized to modify this file', code: 'FORBIDDEN' }, 403);
    }

    await execute(
      db,
      'UPDATE attachments SET entity_type = ?, entity_id = ? WHERE file_id = ?',
      entity_type, parseInt(entity_id, 10), fileId,
    );

    const row = await queryFirst<any>(db, 'SELECT * FROM attachments WHERE file_id = ?', fileId);
    if (!row) return c.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404);

    return c.json(row);
  } catch (err) {
    log.error('Link attachment failed', { fileId: c.req.param('fileId') }, err as Error);
    return c.json({ error: 'Failed to link attachment', code: 'LINK_ATTACHMENT_ERROR' }, 500);
  }
});

uploads.delete('/:fileId', async (c) => {
  try {
    const auth = await resolveAuth(c);
    if (!auth || auth.username === 'signed-access') return c.json({ error: 'Authentication required' }, 401);
    const db = getDb(c.env);
    const userId = auth.userId;
    const fileId = c.req.param('fileId');
    const att = await queryFirst<any>(db, 'SELECT * FROM attachments WHERE file_id = ?', fileId);
    if (!att) return c.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404);

    // This router is mounted auth:'public', so the global authMiddleware never
    // runs and c.get('user') is always undefined here — use the role from
    // resolveAuth()'s verified JWT instead, or the admin override never fires.
    const ADMIN_ROLES = new Set(['admin', 'manager', 'supervisor']);
    if (att.uploaded_by !== userId && !ADMIN_ROLES.has(auth.role)) {
      return c.json({ error: 'Not authorized to delete this file', code: 'FORBIDDEN' }, 403);
    }

    try { await c.env.UPLOADS.delete(att.file_path); } catch { /* non-fatal */ }
    try { await deleteEncryptionKey(db, att.file_path); } catch { /* non-fatal */ }

    await execute(db, 'DELETE FROM attachments WHERE file_id = ?', fileId);

    await execute(
      db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, 'file_deleted', ?, ?, ?, ?)`,
      userId ?? null,
      att.entity_type || 'attachment',
      att.entity_id,
      `Deleted file: ${att.original_name}`,
      c.req.header('CF-Connecting-IP') || 'unknown',
    );

    return c.json({ message: 'File deleted' });
  } catch (err) {
    log.error('Delete attachment failed', { fileId: c.req.param('fileId') }, err as Error);
    return c.json({ error: 'Failed to delete attachment', code: 'DELETE_ATTACHMENT_ERROR' }, 500);
  }
});

// PATCH /api/uploads/:fileId/metadata — admin/manager: edit evidence metadata
uploads.patch('/:fileId/metadata', async (c) => {
  const auth = await resolveAuth(c);
  const allowedRoles = ['admin', 'manager'];
  if (!auth || !allowedRoles.includes(auth.role)) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  const fileId = c.req.param('fileId');
  const db = c.env.DB;
  try {
    await ensureAttachmentEvidenceColumns(db);
    const body = await c.req.json<{
      latitude?: number | null;
      longitude?: number | null;
      taken_at?: string | null;
      reference_notes?: string | null;
    }>();

    const att = await queryFirst<any>(db, 'SELECT file_id FROM attachments WHERE file_id = ?', fileId);
    if (!att) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

    await execute(
      db,
      `UPDATE attachments SET latitude = ?, longitude = ?, taken_at = ?, reference_notes = ? WHERE file_id = ?`,
      body.latitude ?? null,
      body.longitude ?? null,
      body.taken_at ?? null,
      body.reference_notes ?? null,
      fileId,
    );

    const updated = await queryFirst<any>(db, 'SELECT * FROM attachments WHERE file_id = ?', fileId);
    return c.json(updated);
  } catch (err) {
    log.error('Patch attachment metadata failed', { fileId }, err as Error);
    return c.json({ error: 'Failed to update metadata', code: 'METADATA_UPDATE_ERROR' }, 500);
  }
});

// PUT /api/uploads/:fileId/replace — admin: replace R2 object with a new image blob
// Used by the de-stamp tool to swap a pixel-stamped photo with a clean cropped version.
uploads.put('/:fileId/replace', async (c) => {
  const auth = await resolveAuth(c);
  if (!auth || auth.role !== 'admin') {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  const fileId = c.req.param('fileId');
  const db = c.env.DB;
  try {
    const att = await queryFirst<{ file_path: string; mime_type: string }>(
      db, 'SELECT file_path, mime_type FROM attachments WHERE file_id = ?', fileId,
    );
    if (!att) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

    const blob = await c.req.blob();
    if (!blob || blob.size === 0) return c.json({ error: 'No body', code: 'NO_BODY' }, 400);

    const buffer = new Uint8Array(await blob.arrayBuffer());
    await putEncrypted(c.env.UPLOADS, db, c.env, att.file_path, buffer, {
      httpMetadata: { contentType: att.mime_type },
    });

    await execute(db, 'UPDATE attachments SET file_size = ? WHERE file_id = ?', buffer.byteLength, fileId);
    return c.json({ ok: true, file_id: fileId, size: buffer.byteLength });
  } catch (err) {
    log.error('Replace attachment failed', { fileId }, err as Error);
    return c.json({ error: 'Failed to replace attachment', code: 'REPLACE_ERROR' }, 500);
  }
});

export default uploads;
