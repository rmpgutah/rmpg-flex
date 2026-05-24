// ============================================================
// File Uploads — Workers (Hono) Port
// Entity file listing, HMAC-signed file access, file serving
// (R2), upload (multipart → R2), link, delete, thumbnail.
// File storage adapted from local disk (multer/fs) to R2.
// Skips: auditLog, activity_log.
// ============================================================

import { Hono } from 'hono';
import { jwtVerify } from 'jose';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken } from '../worker-middleware/auth';
import { D1Db, paramNum, paramStr } from '../worker-middleware/d1Helpers';

// HMAC file access signing (session-independent, 1yr TTL)
// Uses Web Crypto API (available in Workers)
async function signFileAccess(secret: string, fileId: string, ttlSeconds = 31536000): Promise<{ sig: string; exp: number }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const data = `file:${fileId}:${exp}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const sig = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return { sig, exp };
}

async function verifyFileAccess(secret: string, fileId: string, sig: string, exp: number): Promise<boolean> {
  if (Date.now() / 1000 > exp) return false;
  const data = `file:${fileId}:${exp}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sigBytes = new Uint8Array(sig.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(data));
}

// Flexible auth: HMAC sig OR Bearer token OR ?token= query param
async function authenticateTokenOrQuery(c: any, next: any): Promise<Response | void> {
  const fileId = paramStr(c.req.param('fileId'));

  // 1. HMAC file signature
  const sigParam = c.req.query('sig');
  const expParam = c.req.query('exp') ? parseInt(c.req.query('exp'), 10) : null;

  if (sigParam && expParam) {
    if (fileId && await verifyFileAccess(c.env.JWT_SECRET, fileId, sigParam, expParam)) {
      c.set('user', { userId: 0, username: 'signed-access', role: 'viewer' });
      await next();
      return;
    }
    return c.json({ error: 'Invalid or expired file signature', code: 'INVALID_OR_EXPIRED_FILE' }, 403);
  }

  // 2. Authorization header
  let token: string | null = null;
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  // 3. Query param token (take last if duplicates exist — authUrl fallback may append to stale)
  if (!token) {
    const queryTokens = c.req.queries('token');
    if (queryTokens && queryTokens.length > 0) {
      token = queryTokens[queryTokens.length - 1];
    }
  }

  if (!token) {
    return c.json({ error: 'Authentication required', code: 'AUTHENTICATION_REQUIRED' }, 401);
  }

  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    c.set('user', {
      userId: Number(payload.userId),
      username: String(payload.username),
      role: String(payload.role),
    });
    await next();
  } catch {
    return c.json({ error: 'Invalid or expired token', code: 'INVALID_OR_EXPIRED_TOKEN' }, 401);
  }
}

export function mountUploadRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();

  // === GET /entity/:type/:id — List files for entity ===
  api.get('/entity/:type/:id', authenticateToken, async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const entityType = paramStr(c.req.param('type'));
      const entityId = paramNum(c.req.param('id'));

      const attachments = await db.prepare(`
        SELECT a.*, u.full_name as uploader_name
        FROM attachments a
        LEFT JOIN users u ON a.uploaded_by = u.id
        WHERE a.entity_type = ? AND a.entity_id = ?
        ORDER BY a.created_at DESC LIMIT 1000
      `).all(entityType, entityId);

      // Enrich with HMAC-signed access tokens
      const enriched = await Promise.all((attachments as any[]).map(async (att) => {
        const { sig, exp } = await signFileAccess(c.env.JWT_SECRET, att.file_id);
        return { ...att, access_sig: sig, access_exp: exp };
      }));

      return c.json(enriched);
    } catch (error: any) {
      return c.json({ error: 'Failed to list attachments', code: 'LIST_ATTACHMENTS_ERROR' }, 500);
    }
  });

  // === GET /sign/:fileId — Get a fresh signed URL ===
  api.get('/sign/:fileId', authenticateToken, async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const fileId = paramStr(c.req.param('fileId'));
      const attachment = await db.prepare('SELECT file_id FROM attachments WHERE file_id = ?').get(fileId) as any;

      if (!attachment) return c.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404);

      const { sig, exp } = await signFileAccess(c.env.JWT_SECRET, fileId);
      return c.json({ sig, exp, file_id: fileId });
    } catch (error: any) {
      return c.json({ error: 'Failed to sign file', code: 'SIGN_FILE_ERROR' }, 500);
    }
  });

  // === GET /:fileId — Serve/inline a file from R2 ===
  api.get('/:fileId', authenticateTokenOrQuery, async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const fileId = paramStr(c.req.param('fileId'));
      const attachment = await db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(fileId) as any;

      if (!attachment) return c.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404);

      const r2Key = attachment.file_path;
      if (!r2Key) return c.json({ error: 'File not found on storage', code: 'FILE_NOT_FOUND_ON' }, 404);

      const obj = await c.env.UPLOADS.get(r2Key);
      if (!obj) return c.json({ error: 'File not found on storage', code: 'FILE_NOT_FOUND_ON' }, 404);

      const data = await obj.arrayBuffer();
      c.header('Content-Type', attachment.mime_type || 'application/octet-stream');
      c.header('Content-Disposition', `inline; filename="${attachment.original_name}"`);
      c.header('Content-Length', String(attachment.file_size));
      c.header('Cache-Control', 'private, max-age=300');
      return c.body(data);
    } catch (error: any) {
      return c.json({ error: 'Download failed', code: 'DOWNLOAD_FAILED' }, 500);
    }
  });

  // === GET /:fileId/download — Force download from R2 ===
  api.get('/:fileId/download', authenticateTokenOrQuery, async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const fileId = paramStr(c.req.param('fileId'));
      const attachment = await db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(fileId) as any;

      if (!attachment) return c.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404);

      const r2Key = attachment.file_path;
      if (!r2Key) return c.json({ error: 'File not found on storage', code: 'FILE_NOT_FOUND_ON' }, 404);

      const obj = await c.env.UPLOADS.get(r2Key);
      if (!obj) return c.json({ error: 'File not found on storage', code: 'FILE_NOT_FOUND_ON' }, 404);

      const data = await obj.arrayBuffer();
      c.header('Content-Type', 'application/octet-stream');
      c.header('Content-Disposition', `attachment; filename="${attachment.original_name}"`);
      return c.body(data);
    } catch (error: any) {
      return c.json({ error: 'Download failed', code: 'DOWNLOAD_FAILED' }, 500);
    }
  });

  // === GET /:fileId/thumbnail — Serve image thumbnail from R2 ===
  api.get('/:fileId/thumbnail', authenticateTokenOrQuery, async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const fileId = c.req.param('fileId');
      const attachment = await db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(fileId) as any;

      if (!attachment) return c.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404);

      if (!attachment.mime_type?.startsWith('image/')) {
        return c.json({ error: 'Not an image', code: 'NOT_AN_IMAGE' }, 400);
      }

      const r2Key = attachment.file_path;
      if (!r2Key) return c.json({ error: 'File not found on storage', code: 'FILE_NOT_FOUND_ON' }, 404);

      const obj = await c.env.UPLOADS.get(r2Key);
      if (!obj) return c.json({ error: 'File not found on storage', code: 'FILE_NOT_FOUND_ON' }, 404);

      const data = await obj.arrayBuffer();
      c.header('Content-Type', attachment.mime_type);
      c.header('Content-Disposition', `inline; filename="${attachment.original_name}"`);
      c.header('Content-Length', String(attachment.file_size));
      c.header('Cache-Control', 'private, max-age=600');
      return c.body(data);
    } catch (error: any) {
      return c.json({ error: 'Thumbnail failed', code: 'THUMBNAIL_FAILED' }, 500);
    }
  });

  // All routes below require standard auth
  api.use('/*', authenticateToken);

  // === POST / — Upload one or more files (multipart) ===
  api.post('/', async (c) => {
    try {
      const formData = await c.req.formData();
      const user = c.get('user');
      const entity_type = formData.get('entity_type') ? String(formData.get('entity_type')) : null;
      const entity_id = formData.get('entity_id') ? parseInt(String(formData.get('entity_id')), 10) : null;

      // Collect all file fields
      const files: File[] = [];
      formData.forEach((value) => {
        if (value instanceof File) files.push(value);
      });

      if (files.length === 0) {
        return c.json({ error: 'No files provided', code: 'NO_FILES_PROVIDED' }, 400);
      }

      const db = new D1Db(c.env.DB);
      const results: any[] = [];

      const now = new Date();
      const subDir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;

      for (const file of files) {
        const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() || '' : '';
        const uniqueName = `${crypto.randomUUID()}${ext ? '.' + ext : ''}`;
        const r2Key = `${subDir}/${uniqueName}`;

        const fileBuffer = await file.arrayBuffer();
        await c.env.UPLOADS.put(r2Key, fileBuffer, {
          httpMetadata: { contentType: file.type || 'application/octet-stream' },
        });

        const fileId = crypto.randomUUID();
        const result = await db.prepare(`
          INSERT INTO attachments (
            file_id, original_name, stored_name, file_path, mime_type, file_size,
            entity_type, entity_id, uploaded_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(fileId, file.name, uniqueName, r2Key, file.type, file.size, entity_type, entity_id, user.userId);

        const attachment = await db.prepare('SELECT * FROM attachments WHERE id = ?').get(result.meta.last_row_id);
        results.push(attachment);
      }

      return c.json(results, 201);
    } catch (error: any) {
      return c.json({ error: 'Upload failed', code: 'UPLOAD_FAILED' }, 500);
    }
  });

  // === PUT /:fileId/link — Link file to entity ===
  api.put('/:fileId/link', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const fileId = paramStr(c.req.param('fileId'));
      const body = await c.req.json();
      const { entity_type, entity_id } = body;

      if (!entity_type || !entity_id) {
        return c.json({ error: 'entity_type and entity_id are required', code: 'ENTITYTYPE_AND_ENTITYID_ARE' }, 400);
      }

      const result = await db.prepare(`
        UPDATE attachments SET entity_type = ?, entity_id = ? WHERE file_id = ?
      `).run(entity_type, parseInt(entity_id, 10), fileId);

      if (result.meta.changes === 0) {
        return c.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404);
      }

      const attachment = await db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(fileId);
      return c.json(attachment);
    } catch (error: any) {
      return c.json({ error: 'Failed to link attachment', code: 'LINK_ATTACHMENT_ERROR' }, 500);
    }
  });

  // === DELETE /:fileId — Delete file from R2 + DB ===
  api.delete('/:fileId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const fileId = paramStr(c.req.param('fileId'));
      const attachment = await db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(fileId) as any;

      if (!attachment) {
        return c.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, 404);
      }

      // Delete from R2
      if (attachment.file_path) {
        try { await c.env.UPLOADS.delete(attachment.file_path); } catch { /* R2 delete may fail */ }
      }

      await db.prepare('DELETE FROM attachments WHERE file_id = ?').run(fileId);

      return c.json({ message: 'File deleted' });
    } catch (error: any) {
      return c.json({ error: 'Failed to delete attachment', code: 'DELETE_ATTACHMENT_ERROR' }, 500);
    }
  });

  app.route('/api/uploads', api);
}
