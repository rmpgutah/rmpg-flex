import { execute, query, queryFirst } from './db';
import { log } from './logger';

export const SERVE_FILE_KINDS = ['document', 'photo', 'audio'] as const;
export type ServeFileKind = (typeof SERVE_FILE_KINDS)[number];

export const SERVE_DOCUMENT_TYPES = [
  'summons',
  'complaint',
  'subpoena',
  'affidavit',
  'notice',
  'posted_notice',
  'door_photo',
  'recipient_id',
  'vehicle_photo',
  'property_photo',
  'voice_memo',
  'conversation_recording',
  'other',
] as const;
export type ServeDocumentType = (typeof SERVE_DOCUMENT_TYPES)[number];

const TABLE_DDL = `CREATE TABLE IF NOT EXISTS serve_attempt_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id INTEGER NOT NULL,
  serve_attempt_id INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'document',
  title TEXT,
  description TEXT,
  document_type TEXT,
  copies INTEGER,
  original_name TEXT,
  mime_type TEXT,
  file_size INTEGER,
  uploaded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
)`;

export function inferServeFileKind(mime: string | null | undefined, filename?: string | null): ServeFileKind {
  const m = (mime || '').toLowerCase();
  const name = (filename || '').toLowerCase();
  if (m.startsWith('image/')) return 'photo';
  if (m.startsWith('audio/') || name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.ogg')) return 'audio';
  return 'document';
}

export function isServeFileKind(v: unknown): v is ServeFileKind {
  return typeof v === 'string' && (SERVE_FILE_KINDS as readonly string[]).includes(v);
}

export function isServeDocumentType(v: unknown): v is ServeDocumentType {
  return typeof v === 'string' && (SERVE_DOCUMENT_TYPES as readonly string[]).includes(v);
}

export function clampCopies(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(99, Math.round(n));
}

export function parsePhotoIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

export function serveAttemptR2Key(queueId: number, attemptNumber: number, fileId: string, ext: string): string {
  const safeExt = ext.startsWith('.') ? ext.toLowerCase() : ext ? `.${ext.toLowerCase()}` : '';
  return `serve/${queueId}/attempt-${attemptNumber}/${fileId}${safeExt}`;
}

export async function ensureServeAttemptFilesTable(db: D1Database): Promise<void> {
  try {
    await execute(db, TABLE_DDL);
    await execute(db, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_serve_attempt_files_file_id ON serve_attempt_files(file_id)');
    await execute(db, 'CREATE INDEX IF NOT EXISTS idx_serve_attempt_files_attempt ON serve_attempt_files(serve_attempt_id)');
    await execute(db, 'CREATE INDEX IF NOT EXISTS idx_serve_attempt_files_queue ON serve_attempt_files(serve_queue_id)');
  } catch (err) {
    log.warn('ensureServeAttemptFilesTable failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

export interface ServeAttemptFileRow {
  id: number;
  serve_queue_id: number;
  serve_attempt_id: number;
  file_id: string;
  kind: ServeFileKind;
  title: string | null;
  description: string | null;
  document_type: string | null;
  copies: number | null;
  original_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by: number | null;
  uploader_name?: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface CatalogFileInput {
  file_id: string;
  kind?: ServeFileKind | string | null;
  title?: string | null;
  description?: string | null;
  document_type?: string | null;
  copies?: number | null;
  original_name?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  uploaded_by?: number | null;
}

export async function catalogServeAttemptFiles(
  db: D1Database,
  queueId: number,
  attemptId: number,
  items: CatalogFileInput[],
): Promise<number> {
  if (items.length === 0) return 0;
  await ensureServeAttemptFilesTable(db);
  let inserted = 0;
  for (const item of items) {
    const fileId = (item.file_id || '').trim();
    if (!fileId) continue;
    const kind = isServeFileKind(item.kind) ? item.kind : inferServeFileKind(item.mime_type, item.original_name);
    const docType = isServeDocumentType(item.document_type) ? item.document_type : null;
    try {
      const result = await execute(
        db,
        `INSERT OR IGNORE INTO serve_attempt_files (
           serve_queue_id, serve_attempt_id, file_id, kind, title, description,
           document_type, copies, original_name, mime_type, file_size, uploaded_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        queueId,
        attemptId,
        fileId,
        kind,
        item.title?.trim() || null,
        item.description?.trim() || null,
        docType,
        clampCopies(item.copies),
        item.original_name || null,
        item.mime_type || null,
        item.file_size ?? null,
        item.uploaded_by ?? null,
      );
      if ((result.meta.changes ?? 0) > 0) inserted += 1;
    } catch (err) {
      log.warn('catalogServeAttemptFiles insert failed', { fileId, attemptId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return inserted;
}

export async function backfillAttemptPhotos(
  db: D1Database,
  queueId: number,
  attemptId: number,
  photoIdsJson: string | null,
): Promise<void> {
  const ids = parsePhotoIdList(photoIdsJson);
  if (ids.length === 0) return;
  const items: CatalogFileInput[] = [];
  for (const fileId of ids) {
    const att = await queryFirst<{
      original_name: string | null; mime_type: string | null; file_size: number | null; uploaded_by: number | null;
    }>(db, 'SELECT original_name, mime_type, file_size, uploaded_by FROM attachments WHERE file_id = ?', fileId).catch(() => null);
    items.push({
      file_id: fileId,
      kind: 'photo',
      original_name: att?.original_name ?? null,
      mime_type: att?.mime_type ?? 'image/jpeg',
      file_size: att?.file_size ?? null,
      uploaded_by: att?.uploaded_by ?? null,
      document_type: 'door_photo',
    });
  }
  await catalogServeAttemptFiles(db, queueId, attemptId, items);
}

export async function listAttemptFiles(db: D1Database, attemptId: number): Promise<ServeAttemptFileRow[]> {
  await ensureServeAttemptFilesTable(db);
  return query<ServeAttemptFileRow>(
    db,
    `SELECT f.*, u.full_name AS uploader_name
       FROM serve_attempt_files f
       LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.serve_attempt_id = ?
      ORDER BY f.kind ASC, f.id ASC`,
    attemptId,
  );
}
