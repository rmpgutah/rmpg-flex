import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, ensureAttachmentEvidenceColumns } from '../utils/db';
import { log } from '../utils/logger';
import { putEncrypted, FileEncryptionError } from '../utils/encryptedR2';
import { resolveUploadMime } from '../utils/uploadMime';
import { dbErrorResponse } from '../utils/dbErrors';
import {
  backfillAttemptPhotos,
  catalogServeAttemptFiles,
  clampCopies,
  ensureServeAttemptFilesTable,
  inferServeFileKind,
  isServeDocumentType,
  isServeFileKind,
  listAttemptFiles,
  serveAttemptR2Key,
  type CatalogFileInput,
} from '../utils/serveAttemptFiles';

const files = new Hono<Env>();

const WRITE = ['admin', 'manager', 'supervisor', 'officer'];
const READ = [...WRITE, 'dispatcher'];

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff',
  'image/heic', 'image/heif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg',
]);

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_FILES = 20;

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

function extFor(name: string, type: string): string {
  const fromName = name && name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
  if (fromName && fromName.length <= 8) return fromName;
  if (type === 'image/png') return '.png';
  if (type === 'image/jpeg') return '.jpg';
  if (type === 'application/pdf') return '.pdf';
  if (type === 'audio/mpeg' || type === 'audio/mp3') return '.mp3';
  if (type === 'audio/wav') return '.wav';
  if (type === 'audio/ogg') return '.ogg';
  return '';
}

async function loadAttempt(
  db: D1Database,
  queueId: number,
  attemptId: number,
): Promise<{ id: number; attempt_number: number; photo_ids: string | null } | null> {
  return queryFirst(
    db,
    'SELECT id, attempt_number, photo_ids FROM serve_attempts WHERE id = ? AND serve_queue_id = ?',
    attemptId,
    queueId,
  );
}

files.get('/:id/file-folders', async (c) => {
  const denied = requireRole(c, READ);
  if (denied) return c.json({ error: denied }, 403);
  const queueId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(queueId) || queueId < 1) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  await ensureServeAttemptFilesTable(db);

  const attempts = await query<{
    id: number; attempt_number: number; attempt_at: string; result: string | null;
    officer_name: string | null; photo_ids: string | null;
  }>(
    db,
    `SELECT a.id, a.attempt_number, a.attempt_at, a.result, a.photo_ids, u.full_name AS officer_name
       FROM serve_attempts a
       LEFT JOIN users u ON u.id = a.officer_id
      WHERE a.serve_queue_id = ?
      ORDER BY a.attempt_number ASC, a.id ASC`,
    queueId,
  );

  const folders = [];
  for (const attempt of attempts) {
    await backfillAttemptPhotos(db, queueId, attempt.id, attempt.photo_ids);
    const attemptFiles = await listAttemptFiles(db, attempt.id);
    folders.push({
      attempt_id: attempt.id,
      attempt_number: attempt.attempt_number,
      attempt_at: attempt.attempt_at,
      result: attempt.result,
      officer_name: attempt.officer_name,
      files: attemptFiles,
    });
  }

  const intake = await query<{
    id: number; file_name: string | null; file_type: string | null; size_bytes: number | null;
    page_count: number | null; doc_type: string | null; confidence: number | null;
    status: string | null; created_at: string | null;
  }>(
    db,
    `SELECT id, file_name, file_type, size_bytes, page_count, doc_type, confidence, status, created_at
       FROM serve_intake_documents
      WHERE serve_queue_id = ?
      ORDER BY id DESC`,
    queueId,
  ).catch(() => []);

  return c.json({ queue_id: queueId, intake, folders });
});

files.get('/:id/attempts/:attemptId/files', async (c) => {
  const denied = requireRole(c, READ);
  if (denied) return c.json({ error: denied }, 403);
  const queueId = parseInt(c.req.param('id'), 10);
  const attemptId = parseInt(c.req.param('attemptId'), 10);
  if (!Number.isFinite(queueId) || queueId < 1 || !Number.isFinite(attemptId) || attemptId < 1) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  await ensureServeAttemptFilesTable(db);
  const attempt = await loadAttempt(db, queueId, attemptId);
  if (!attempt) return c.json({ error: 'Attempt not found for this job' }, 404);
  await backfillAttemptPhotos(db, queueId, attemptId, attempt.photo_ids);
  const rows = await listAttemptFiles(db, attemptId);
  return c.json({ attempt_id: attemptId, files: rows });
});

files.post('/:id/attempts/:attemptId/files', async (c) => {
  const denied = requireRole(c, WRITE);
  if (denied) return c.json({ error: denied }, 403);
  const queueId = parseInt(c.req.param('id'), 10);
  const attemptId = parseInt(c.req.param('attemptId'), 10);
  if (!Number.isFinite(queueId) || queueId < 1 || !Number.isFinite(attemptId) || attemptId < 1) return c.json({ error: 'Invalid id' }, 400);
  const user = c.get('user') as { id: number } | undefined;
  const db = getDb(c.env);

  const attempt = await loadAttempt(db, queueId, attemptId);
  if (!attempt) return c.json({ error: 'Attempt not found for this job' }, 404);

  const contentType = c.req.header('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await c.req.json<{ files?: CatalogFileInput[] }>().catch(() => ({ files: [] as CatalogFileInput[] }));
    const items = Array.isArray(body.files) ? body.files : [];
    await catalogServeAttemptFiles(db, queueId, attemptId, items.map((item) => ({
      ...item,
      uploaded_by: item.uploaded_by ?? user?.id ?? null,
    })));
    const rows = await listAttemptFiles(db, attemptId);
    return c.json({ attempt_id: attemptId, files: rows });
  }

  if (!c.env.UPLOADS) {
    return c.json({ error: 'Uploads storage is not bound', code: 'UPLOADS_NOT_BOUND' }, 503);
  }

  await ensureAttachmentEvidenceColumns(db);
  await ensureServeAttemptFilesTable(db);

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: 'Expected multipart form data' }, 400);
  }

  const rawFiles = formData.getAll('files');
  const uploads: File[] = [];
  for (const entry of rawFiles) {
    if (typeof entry === 'string') continue;
    if (typeof (entry as { arrayBuffer?: unknown }).arrayBuffer !== 'function') continue;
    uploads.push(entry as unknown as File);
  }
  if (uploads.length === 0) return c.json({ error: 'No files provided', code: 'NO_FILES_PROVIDED' }, 400);
  if (uploads.length > MAX_FILES) return c.json({ error: `Max ${MAX_FILES} files per upload` }, 400);

  const title = formData.get('title') ? String(formData.get('title')).trim() : '';
  const description = formData.get('description') ? String(formData.get('description')).trim() : '';
  const documentTypeRaw = formData.get('document_type') ? String(formData.get('document_type')).trim() : '';
  const documentType = isServeDocumentType(documentTypeRaw) ? documentTypeRaw : null;
  const copies = clampCopies(formData.get('copies'));
  const kindOverride = formData.get('kind') ? String(formData.get('kind')) : '';

  const created: CatalogFileInput[] = [];
  try {
    for (const file of uploads) {
      const mime = resolveUploadMime(file.name, file.type);
      if (!ALLOWED_MIME.has(mime) && !mime.startsWith('image/')) {
        return c.json({ error: `File type ${mime || file.type || 'unknown'} is not allowed` }, 400);
      }
      if (file.size > MAX_FILE_SIZE) {
        return c.json({ error: `File too large — max ${MAX_FILE_SIZE / 1024 / 1024} MB` }, 400);
      }
      const fileId = crypto.randomUUID();
      const ext = extFor(file.name, mime);
      const r2Key = serveAttemptR2Key(queueId, attempt.attempt_number, fileId, ext);
      await putEncrypted(c.env.UPLOADS, db, c.env, r2Key, await file.arrayBuffer(), {
        httpMetadata: { contentType: mime },
      });
      const kind = isServeFileKind(kindOverride) ? kindOverride : inferServeFileKind(mime, file.name);
      await execute(
        db,
        `INSERT INTO attachments (file_id, original_name, stored_name, file_path, mime_type, file_size, entity_type, entity_id, uploaded_by, reference_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        fileId,
        file.name,
        `${fileId}${ext}`,
        r2Key,
        mime,
        file.size,
        'serve_attempt',
        attemptId,
        user?.id ?? null,
        title || description || null,
      );
      created.push({
        file_id: fileId,
        kind,
        title: title || file.name,
        description: description || null,
        document_type: documentType,
        copies,
        original_name: file.name,
        mime_type: mime,
        file_size: file.size,
        uploaded_by: user?.id ?? null,
      });
    }
  } catch (err) {
    log.error('Serve attempt file upload failed', { queueId, attemptId }, err as Error);
    if (err instanceof FileEncryptionError) {
      return c.json({
        error: 'File storage is temporarily unavailable. Contact a supervisor.',
        code: 'ENCRYPTION_FAILED',
      }, 503);
    }
    return dbErrorResponse(c, err, 'Upload failed');
  }

  await catalogServeAttemptFiles(db, queueId, attemptId, created);
  const rows = await listAttemptFiles(db, attemptId);
  return c.json({ attempt_id: attemptId, files: rows }, 201);
});

files.patch('/:id/attempts/:attemptId/files/:fileRowId', async (c) => {
  const denied = requireRole(c, WRITE);
  if (denied) return c.json({ error: denied }, 403);
  const queueId = parseInt(c.req.param('id'), 10);
  const attemptId = parseInt(c.req.param('attemptId'), 10);
  const fileRowId = parseInt(c.req.param('fileRowId'), 10);
  if (!Number.isFinite(queueId) || queueId < 1 || !Number.isFinite(attemptId) || attemptId < 1 || !Number.isFinite(fileRowId) || fileRowId < 1) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const existing = await queryFirst<{ id: number }>(
    db,
    'SELECT id FROM serve_attempt_files WHERE id = ? AND serve_attempt_id = ? AND serve_queue_id = ?',
    fileRowId, attemptId, queueId,
  );
  if (!existing) return c.json({ error: 'File not found in this attempt folder' }, 404);

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const sets: string[] = ["updated_at = datetime('now')"];
  const args: unknown[] = [];
  if ('title' in body) {
    sets.push('title = ?');
    args.push(typeof body.title === 'string' ? body.title.trim() || null : null);
  }
  if ('description' in body) {
    sets.push('description = ?');
    args.push(typeof body.description === 'string' ? body.description.trim() || null : null);
  }
  if ('document_type' in body) {
    const dt = body.document_type;
    if (dt != null && dt !== '' && !isServeDocumentType(dt)) {
      return c.json({ error: 'Unknown document_type' }, 400);
    }
    sets.push('document_type = ?');
    args.push(isServeDocumentType(dt) ? dt : null);
  }
  if ('copies' in body) {
    sets.push('copies = ?');
    args.push(clampCopies(body.copies));
  }
  if ('kind' in body) {
    if (!isServeFileKind(body.kind)) return c.json({ error: 'Unknown kind' }, 400);
    sets.push('kind = ?');
    args.push(body.kind);
  }
  args.push(fileRowId);
  await execute(db, `UPDATE serve_attempt_files SET ${sets.join(', ')} WHERE id = ?`, ...args);
  const rows = await listAttemptFiles(db, attemptId);
  return c.json({ attempt_id: attemptId, files: rows });
});

files.delete('/:id/attempts/:attemptId/files/:fileRowId', async (c) => {
  const denied = requireRole(c, WRITE);
  if (denied) return c.json({ error: denied }, 403);
  const queueId = parseInt(c.req.param('id'), 10);
  const attemptId = parseInt(c.req.param('attemptId'), 10);
  const fileRowId = parseInt(c.req.param('fileRowId'), 10);
  if (!Number.isFinite(queueId) || queueId < 1 || !Number.isFinite(attemptId) || attemptId < 1 || !Number.isFinite(fileRowId) || fileRowId < 1) return c.json({ error: 'Invalid id' }, 400);
  const db = getDb(c.env);
  const row = await queryFirst<{ id: number; file_id: string; kind: string }>(
    db,
    'SELECT id, file_id, kind FROM serve_attempt_files WHERE id = ? AND serve_attempt_id = ? AND serve_queue_id = ?',
    fileRowId, attemptId, queueId,
  );
  if (!row) return c.json({ error: 'File not found in this attempt folder' }, 404);

  await execute(db, 'DELETE FROM serve_attempt_files WHERE id = ?', fileRowId);

  // Photos on serve_attempts.photo_ids stay as immutable evidence. Documents
  // and audio uploaded into the folder can be removed from R2 as well.
  if (row.kind !== 'photo') {
    const att = await queryFirst<{ file_path: string }>(db, 'SELECT file_path FROM attachments WHERE file_id = ?', row.file_id);
    if (att?.file_path) {
      try { await c.env.UPLOADS.delete(att.file_path); } catch { /* non-fatal */ }
    }
    await execute(db, 'DELETE FROM attachments WHERE file_id = ?', row.file_id).catch(() => {});
  }

  const rows = await listAttemptFiles(db, attemptId);
  return c.json({ attempt_id: attemptId, files: rows });
});

export default files;
