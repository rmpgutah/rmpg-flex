// src/routes/redactions.ts
// Chain-of-custody store for in-browser video redaction exports. The redacted
// MP4 is produced client-side (canvas + ffmpeg.wasm); this route only persists
// the finished file to R2 and a video_redactions custody row. Mirrors the
// best-effort + runtime-reconcile patterns in src/routes/alpr.ts.
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, execute, query, queryFirst, columnExists } from '../utils/db';
import { putEncrypted, getDecrypted, deleteEncryptionKey } from '../utils/encryptedR2';

const redactions = new Hono<Env>();

const EXTRA_COLUMNS: Array<[string, string]> = [
  ['regions_json', 'TEXT'], ['kinds', 'TEXT'], ['style', 'TEXT'],
  ['region_count', 'INTEGER'], ['status', 'TEXT'], ['notes', 'TEXT'],
  ['requested_at', 'TEXT'], ['completed_at', 'TEXT'],
];

async function ensureSchema(db: ReturnType<typeof getDb>): Promise<void> {
  await execute(db, `CREATE TABLE IF NOT EXISTS video_redactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_event_id INTEGER, r2_key TEXT NOT NULL,
    kinds TEXT, region_count INTEGER NOT NULL DEFAULT 0, style TEXT, regions_json TEXT,
    redacted_by INTEGER, status TEXT NOT NULL DEFAULT 'completed', requested_at TEXT,
    completed_at TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const columnsWithBodycam: Array<[string, string]> = [...EXTRA_COLUMNS, ['source_bodycam_video_id', 'INTEGER']];
  for (const [name, type] of columnsWithBodycam) {
    if (!(await columnExists(db, 'video_redactions', name))) {
      try { await execute(db, `ALTER TABLE video_redactions ADD COLUMN ${name} ${type}`); }
      catch { /* race / already present */ }
    }
  }
}

// POST /api/redactions — multipart: `video` (MP4 blob) + `metadata` (JSON string).
redactions.post('/', async (c): Promise<Response> => {
  const db = getDb(c.env);
  const userId = (c.get('userId') as number) ?? null;
  await ensureSchema(db);

  let form: FormData;
  try { form = await c.req.formData(); }
  catch { return c.json({ error: 'Expected multipart/form-data with a `video` file' }, 400); }

  const fileEntry = form.get('video');
  const file = fileEntry && typeof fileEntry === 'object' && 'arrayBuffer' in (fileEntry as object)
    ? (fileEntry as File) : null;
  if (!file) return c.json({ error: 'Missing redacted video (field: video)' }, 400);

  let meta: any = {};
  try { meta = JSON.parse(String(form.get('metadata') ?? '{}')); } catch { /* tolerate */ }

  // Honor the actual export format (Chrome records MP4/H.264; other browsers may
  // fall back to WebM) instead of blindly stamping .mp4 on a WebM blob.
  const fileName = typeof (file as { name?: unknown }).name === 'string' ? (file as { name: string }).name.toLowerCase() : '';
  const isWebm = (file.type || '').toLowerCase().includes('webm') || fileName.endsWith('.webm') || meta.format === 'webm';
  const fmt = isWebm ? { ext: 'webm', contentType: 'video/webm' } : { ext: 'mp4', contentType: 'video/mp4' };

  const r2Key = `redactions/${crypto.randomUUID()}.${fmt.ext}`;
  try {
    await putEncrypted(c.env.UPLOADS, db, c.env, r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: fmt.contentType } });
  } catch (err: any) {
    return c.json({ error: `storage failed: ${err?.message ?? 'unknown'}` }, 502);
  }

  const kinds: string = Array.isArray(meta.kinds) ? meta.kinds.join(',') : (typeof meta.kinds === 'string' ? meta.kinds : '');
  let res: Awaited<ReturnType<typeof execute>>;
  try {
    const sourceBodycamVideoId = Number(meta.source_bodycam_video_id) || null;
    res = await execute(db,
      `INSERT INTO video_redactions
         (source_event_id, source_bodycam_video_id, r2_key, kinds, region_count, style, regions_json, redacted_by,
          status, requested_at, completed_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, datetime('now'), ?)`,
      Number(meta.event_id) || null, sourceBodycamVideoId, r2Key, kinds, Number(meta.region_count) || 0,
      typeof meta.style === 'string' ? meta.style : null,
      typeof meta.regions_json === 'string' ? meta.regions_json : (meta.regions ? JSON.stringify(meta.regions) : null),
      userId, meta.requested_at ?? null, typeof meta.notes === 'string' ? meta.notes : null);

    // Mirror onto bodycam_videos.redacted_path when this redaction is for a
    // body-cam video. Best-effort: the custody row above is the source of
    // truth and must not be rolled back if this update fails (matches the
    // existing "custody record must not silently disappear" behavior).
    if (sourceBodycamVideoId) {
      try {
        await execute(db, "UPDATE bodycam_videos SET redacted_path = ?, updated_at = datetime('now') WHERE id = ?", r2Key, sourceBodycamVideoId);
      } catch (e) {
        console.warn('bodycam_videos.redacted_path update failed (non-fatal, custody row already committed):', e);
      }
    }
  } catch (err: any) {
    // Custody row failed — don't leave the MP4 orphaned in R2 with no record.
    try { await c.env.UPLOADS.delete(r2Key); } catch { /* best-effort */ }
    try { await deleteEncryptionKey(db, r2Key); } catch { /* best-effort */ }
    return c.json({ error: 'custody record failed: ' + (err?.message ?? 'unknown') }, 502);
  }

  return c.json({ success: true, id: Number(res.meta.last_row_id), r2_key: r2Key,
    download_url: `/api/redactions/${Number(res.meta.last_row_id)}/download` });
});

// GET /api/redactions?event_id= — custody records (newest first).
redactions.get('/', async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const eventId = c.req.query('event_id');
  const bodycamVideoId = c.req.query('bodycam_video_id');
  const cols = 'id, source_event_id, source_bodycam_video_id, r2_key, kinds, region_count, style, redacted_by, status, created_at';
  const rows = eventId
    ? await query<any>(db, `SELECT ${cols} FROM video_redactions WHERE source_event_id = ? ORDER BY id DESC LIMIT 100`, Number(eventId))
    : bodycamVideoId
    ? await query<any>(db, `SELECT ${cols} FROM video_redactions WHERE source_bodycam_video_id = ? ORDER BY id DESC LIMIT 100`, Number(bodycamVideoId))
    : await query<any>(db, `SELECT ${cols} FROM video_redactions ORDER BY id DESC LIMIT 100`);
  return c.json({ redactions: rows });
});

// GET /api/redactions/:id/download — stream the redacted MP4 from R2.
redactions.get('/:id/download', async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const row = await queryFirst<{ r2_key: string }>(db, `SELECT r2_key FROM video_redactions WHERE id = ?`, Number(c.req.param('id')));
  if (!row) return c.json({ error: 'Not found' }, 404);
  const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env, row.r2_key);
  const ext = row.r2_key.toLowerCase().endsWith('.webm') ? 'webm' : 'mp4';
  if (decrypted) {
    const contentType = decrypted.httpMetadata?.contentType || (ext === 'webm' ? 'video/webm' : 'video/mp4');
    return new Response(decrypted.bytes, { headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="redacted-${c.req.param('id')}.${ext}"` } });
  }
  // getDecrypted() returns null both for "object never existed" and for a
  // genuinely crypto-shredded object with no key row -- neither is
  // distinguishable here from a LEGACY object uploaded before this feature
  // shipped (also "object exists, no key row"). Fall back to serving the
  // raw R2 bytes as-is, matching fieldPhotos.ts's `GET /file/*` route. Safe
  // today because no code path does standalone crypto-shredding: this
  // route's own custody-row-failed rollback (above) always removes the R2
  // object and its key row together, so "object present, row absent" can
  // currently only mean "predates encryption," never "was shredded."
  const legacy = await c.env.UPLOADS.get(row.r2_key);
  if (!legacy) return c.json({ error: 'File missing from storage' }, 404);
  const contentType = legacy.httpMetadata?.contentType || (ext === 'webm' ? 'video/webm' : 'video/mp4');
  return new Response(legacy.body, { headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="redacted-${c.req.param('id')}.${ext}"` } });
});

export default redactions;
