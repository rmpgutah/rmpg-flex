import { Hono } from 'hono';
import { jwtVerify } from 'jose';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { ensureDefaultDocumentsFolder } from './documents/folders';

const uploads = new Hono<Env>();

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff',
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
  'audio/mpeg', 'audio/wav', 'audio/ogg',
]);

const MAX_FILE_SIZE = 500 * 1024 * 1024;

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
    if (p.type === 'refresh') return null;
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
    console.error('List attachments error:', err);
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
    console.error('Sign file error:', err);
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

    const obj = await c.env.UPLOADS.get(att.file_path);
    if (!obj) return c.json({ error: 'File not found in storage', code: 'FILE_NOT_FOUND_ON' }, 404);

    const data = await obj.arrayBuffer();
    c.header('Content-Type', att.mime_type);
    c.header('Content-Disposition', `inline; filename="${att.original_name}"`);
    c.header('Cache-Control', 'private, max-age=600');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(data);
  } catch (err) {
    console.error('Thumbnail error:', err);
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

    const obj = await c.env.UPLOADS.get(att.file_path);
    if (!obj) return c.json({ error: 'File not found in storage', code: 'FILE_NOT_FOUND_ON' }, 404);

    const data = await obj.arrayBuffer();
    c.header('Content-Type', 'application/octet-stream');
    c.header('Content-Disposition', `attachment; filename="${att.original_name}"`);
    return c.body(data);
  } catch (err) {
    console.error('Download error:', err);
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

    const obj = await c.env.UPLOADS.get(att.file_path);
    if (!obj) return c.json({ error: 'File not found in storage', code: 'FILE_NOT_FOUND_ON' }, 404);

    const data = await obj.arrayBuffer();
    c.header('Content-Type', att.mime_type);
    c.header('Content-Disposition', `inline; filename="${att.original_name}"`);
    c.header('Cache-Control', 'private, max-age=300');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    return c.body(data);
  } catch (err) {
    console.error('Download error:', err);
    return c.json({ error: 'Download failed', code: 'DOWNLOAD_FAILED' }, 500);
  }
});

uploads.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const auth = await resolveAuth(c);
    if (!auth || !auth.userId) return c.json({ error: 'Authentication required' }, 401);
    const userId = auth.userId;

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
    const entityId = entityIdRaw ? parseInt(entityIdRaw, 10) : null;

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
      if (!ALLOWED_MIME.has(file.type)) {
        return c.json({ error: `File type ${file.type} is not allowed` }, 400);
      }
      if (file.size > MAX_FILE_SIZE) {
        return c.json({ error: `File too large — max ${MAX_FILE_SIZE / 1024 / 1024} MB`, code: 'FILE_TOO_LARGE' }, 400);
      }

      const fileId = crypto.randomUUID();
      const ext = extFor(file.name, file.type);
      const r2Key = `attachments/${fileId}${ext}`;
      const buffer = await file.arrayBuffer();

      await c.env.UPLOADS.put(r2Key, buffer, {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
      });

      await execute(
        db,
        `INSERT INTO attachments (file_id, original_name, stored_name, file_path, mime_type, file_size, entity_type, entity_id, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        fileId,
        file.name,
        `${fileId}${ext}`,
        r2Key,
        file.type,
        file.size,
        entityType,
        entityId,
        userId,
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

    return c.json(results, 201);
  } catch (err) {
    console.error('Upload error:', err);
    return c.json({ error: 'Upload failed', code: 'UPLOAD_FAILED' }, 500);
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

    await c.env.UPLOADS.put(r2Key, new Uint8Array(0), {
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
    console.error('Create file error:', err);
    return c.json({ error: 'Failed to create file', code: 'CREATE_FILE_ERROR' }, 500);
  }
});

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

    const text = await c.req.text();
    const encoded = new TextEncoder().encode(text);
    await c.env.UPLOADS.put(att.file_path, encoded, {
      httpMetadata: { contentType: att.mime_type || 'text/plain' },
    });
    await execute(db, 'UPDATE attachments SET file_size = ? WHERE file_id = ?', encoded.byteLength, fileId);

    return c.json({ ok: true, file_id: fileId, file_size: encoded.byteLength });
  } catch (err) {
    console.error('Save content error:', err);
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

    const result = await execute(
      db,
      'UPDATE attachments SET entity_type = ?, entity_id = ? WHERE file_id = ?',
      entity_type, parseInt(entity_id, 10), fileId,
    );

    const row = await queryFirst<any>(db, 'SELECT * FROM attachments WHERE file_id = ?', fileId);
    if (!row) return c.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404);

    return c.json(row);
  } catch (err) {
    console.error('Link attachment error:', err);
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
    console.error('Delete attachment error:', err);
    return c.json({ error: 'Failed to delete attachment', code: 'DELETE_ATTACHMENT_ERROR' }, 500);
  }
});

export default uploads;
