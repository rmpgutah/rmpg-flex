// ============================================================
// RMPG Flex — Bodycam-video upload + stream endpoints
// ============================================================
// Attaches handlers to the bodycamVideosRouter exported from
// ./bodyCameras.ts. Split into its own file so the read-side
// routes stay reviewable on their own.
//
// Endpoints registered here (all under /api/personnel/bodycam-videos):
//
//   POST   /                          single-shot multipart upload
//                                      (used by VideoUploadModal for
//                                       files under 50 MB)
//   POST   /upload-init               start an R2 multipart upload
//   POST   /upload-chunk              append one part to multipart
//   POST   /upload-complete           finalize multipart + create row
//   DELETE /upload-abort/:uploadId    cancel multipart + cleanup
//   GET    /:id/stream                range-supporting playback
//                                      (auth via ?token=<JWT>)
//
// Storage layout in R2 (bucket: env.UPLOADS):
//   bodycam-videos/<uuid>/original.<ext>   finished video (referenced by
//                                           bodycam_videos.file_path)
//   bodycam-videos/<uuid>/thumbnail.jpg    client-captured frame (see
//                                           POST /:id/thumbnail below)
//   bodycam-videos/<uuid>/redacted.mp4     optional redaction export
//                                           (see src/routes/redactions.ts)
//
// KV session layout (24-h TTL):
//   bodycam-upload:<r2-multipart-uploadId> → JSON UploadSession
// ============================================================

import {
  bodycamVideosRouter,
  READ_ALL_ROLES,
  WRITE_ROLES,
  getActor,
  ensureBodycamArtifactColumns,
} from './bodyCameras';
import { getDb, queryFirst, execute } from '../../utils/db';
import { getR2Range, rangeNotSatisfiableInit } from '../../utils/byteRange';
import { verifySignedResource } from '../../utils/signedAccess';
import { transcribeTransmission } from '../../utils/aiDispatcher';
import { tryParseModelJson } from '../../utils/serveIntakeExtract';
import { aggregateAnalysis, type FrameAnalysis } from '../../utils/bodycamAiAnalysis';
import { parseDeepScanFrame, type DetectorSample, type RawDeepScanDetection } from '../../utils/redactionDeepScan';
import { log } from '../../utils/logger';

import { dbErrorResponse } from '../../utils/dbErrors';
const UPLOAD_KEY_PREFIX = 'bodycam-videos/';
const UPLOAD_SESSION_PREFIX = 'bodycam-upload:';
const UPLOAD_SESSION_TTL = 86400; // 24 h

// Best-effort file extension from a mime type or filename, defaulting to
// mp4 (the overwhelming majority of BWC hardware exports H.264/mp4).
function extFromMime(mimeType: string, fileName?: string): string {
  const fromName = fileName?.match(/\.([a-zA-Z0-9]+)$/)?.[1];
  if (fromName) return fromName.toLowerCase();
  const map: Record<string, string> = {
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'video/x-matroska': 'mkv', 'video/3gpp': '3gp',
  };
  return map[mimeType.toLowerCase()] || 'mp4';
}

interface UploadSession {
  r2Key: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  mimeType: string;
  initiatedBy: number;
  parts: { partNumber: number; etag: string }[];
  createdAt: number;
}

// ────────────────────────────────────────────────────────────
// POST /  — small-file single-shot multipart upload.
// Client uses this for files under 50 MB (see VideoUploadModal).
// ────────────────────────────────────────────────────────────
bodycamVideosRouter.post('/', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);

    const ct = c.req.header('content-type') || '';
    if (!ct.startsWith('multipart/form-data')) {
      return c.json({ error: 'multipart/form-data required' }, 400);
    }

    const form = await c.req.formData();
    // @cloudflare/workers-types types FormData.get() as `string | null`
    // — at runtime it returns File for file fields. Cast through unknown
    // to recover the accurate union; runtime check pins it to Blob.
    const file = form.get('video') as unknown as File | string | null;
    if (!file || typeof file === 'string' || !(file instanceof Blob)) {
      return c.json({ error: 'video file is required' }, 400);
    }

    const cameraId  = Number(form.get('camera_id'));
    const officerId = Number(form.get('officer_id'));
    const title     = String(form.get('title') || '').trim();
    if (!Number.isInteger(cameraId)  || cameraId  <= 0) return c.json({ error: 'camera_id is required' }, 400);
    if (!Number.isInteger(officerId) || officerId <= 0) return c.json({ error: 'officer_id is required' }, 400);
    if (!title) return c.json({ error: 'title is required' }, 400);

    // Officer-scope: officers can only upload videos attached to
    // their own officer_id. Manager-tier roles can upload for anyone.
    if (!WRITE_ROLES.has(actor.role) && officerId !== actor.id) {
      return c.json({ error: 'Cannot upload for another officer' }, 403);
    }

    const mimeType = file.type || 'video/mp4';
    const videoUuid = crypto.randomUUID();
    const r2Key = `${UPLOAD_KEY_PREFIX}${videoUuid}/original.${extFromMime(mimeType, (file as File).name)}`;

    await c.env.UPLOADS.put(r2Key, file.stream(), {
      httpMetadata: { contentType: mimeType },
    });

    const durationRaw = form.get('duration_seconds');
    const duration = durationRaw != null && durationRaw !== ''
      ? Number(durationRaw) : null;

    const db = getDb(c.env);
    const result = await execute(db, `
      INSERT INTO bodycam_videos
        (camera_id, officer_id, title, file_path, file_size, duration_seconds,
         mime_type, recorded_at, case_number, classification, notes, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      cameraId, officerId, title, r2Key, file.size, duration, mimeType,
      form.get('recorded_at') || null,
      form.get('case_number') || null,
      String(form.get('classification') || 'routine'),
      form.get('notes') || null,
      actor.full_name || String(actor.id),
    );
    const newId = result.meta?.last_row_id;
    if (!newId) {
      // R2 succeeded but the DB didn't — leaves an orphan R2 object.
      // Cleanup is a follow-up sweep (R2 keys whose UUID has no DB row).
      return c.json({ error: 'Insert succeeded but no id returned' }, 500);
    }

    const created = await queryFirst<Record<string, unknown>>(db, `
      SELECT v.*, u.full_name AS officer_name, c.camera_id AS camera_serial
        FROM bodycam_videos v
        LEFT JOIN users u        ON u.id = v.officer_id
        LEFT JOIN body_cameras c ON c.id = v.camera_id
       WHERE v.id = ?
    `, newId);
    return c.json(created, 201);
  } catch (err) {
    console.error('POST /personnel/bodycam-videos failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// ────────────────────────────────────────────────────────────
// POST /upload-init — open an R2 multipart upload.
// Response: { uploadId: <r2 multipart uploadId>, totalChunks }
// ────────────────────────────────────────────────────────────
bodycamVideosRouter.post('/upload-init', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);

    const body = await c.req.json<{
      fileName?: string;
      fileSize?: number;
      totalChunks?: number;
      mimeType?: string;
    }>().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

    const fileName    = String(body.fileName || '').trim();
    const fileSize    = Number(body.fileSize);
    const totalChunks = Number(body.totalChunks);
    const mimeType    = String(body.mimeType || 'video/mp4');

    if (!fileName) return c.json({ error: 'fileName is required' }, 400);
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return c.json({ error: 'fileSize must be positive' }, 400);
    }
    if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
      return c.json({ error: 'totalChunks must be a positive integer' }, 400);
    }

    const videoUuid = crypto.randomUUID();
    const r2Key = `${UPLOAD_KEY_PREFIX}${videoUuid}/original.${extFromMime(mimeType, fileName)}`;
    const mp = await c.env.UPLOADS.createMultipartUpload(r2Key, {
      httpMetadata: { contentType: mimeType },
    });

    const session: UploadSession = {
      r2Key, fileName, fileSize, totalChunks, mimeType,
      initiatedBy: actor.id,
      parts: [],
      createdAt: Date.now(),
    };
    await c.env.KV.put(
      `${UPLOAD_SESSION_PREFIX}${mp.uploadId}`,
      JSON.stringify(session),
      { expirationTtl: UPLOAD_SESSION_TTL }
    );

    return c.json({ uploadId: mp.uploadId, totalChunks });
  } catch (err) {
    console.error('POST /personnel/bodycam-videos/upload-init failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// ────────────────────────────────────────────────────────────
// POST /upload-chunk — append one part to the multipart upload.
// chunkIndex is 0-based on the wire; R2 part numbers are 1-based.
// ────────────────────────────────────────────────────────────
bodycamVideosRouter.post('/upload-chunk', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);

    const ct = c.req.header('content-type') || '';
    if (!ct.startsWith('multipart/form-data')) {
      return c.json({ error: 'multipart/form-data required' }, 400);
    }

    const form = await c.req.formData();
    const uploadId   = String(form.get('uploadId') || '');
    const chunkIndex = Number(form.get('chunkIndex'));
    // Same workers-types cast as POST / — FormData.get is typed as
    // `string | null` but returns Blob for binary fields at runtime.
    const chunk      = form.get('chunk') as unknown as Blob | string | null;
    if (!uploadId) return c.json({ error: 'uploadId is required' }, 400);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return c.json({ error: 'chunkIndex must be a non-negative integer' }, 400);
    }
    if (!chunk || typeof chunk === 'string' || !(chunk instanceof Blob)) {
      return c.json({ error: 'chunk blob is required' }, 400);
    }

    const sessionRaw = await c.env.KV.get(`${UPLOAD_SESSION_PREFIX}${uploadId}`);
    if (!sessionRaw) {
      return c.json({ error: 'Upload session not found or expired' }, 410);
    }
    let session: UploadSession;
    try { session = JSON.parse(sessionRaw) as UploadSession; } catch {
      return c.json({ error: 'Upload session data corrupted' }, 422);
    }
    if (chunkIndex >= session.totalChunks) {
      return c.json({ error: 'chunkIndex out of range' }, 400);
    }

    const mp = c.env.UPLOADS.resumeMultipartUpload(session.r2Key, uploadId);
    const partNumber = chunkIndex + 1;
    const uploaded = await mp.uploadPart(partNumber, chunk);

    // De-dup: client retry of the same partNumber should replace the
    // previous etag, not append a duplicate (R2 returns a fresh etag
    // each upload).
    session.parts = session.parts.filter(p => p.partNumber !== partNumber);
    session.parts.push({ partNumber, etag: uploaded.etag });

    await c.env.KV.put(
      `${UPLOAD_SESSION_PREFIX}${uploadId}`,
      JSON.stringify(session),
      { expirationTtl: UPLOAD_SESSION_TTL }
    );

    return c.json({
      ok: true,
      partNumber,
      etag: uploaded.etag,
      received: session.parts.length,
    });
  } catch (err) {
    console.error('POST /personnel/bodycam-videos/upload-chunk failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// ────────────────────────────────────────────────────────────
// POST /upload-complete — finalize multipart + create the DB row.
// Body mirrors VideoUploadModal:
//   { uploadId, camera_id, officer_id, title,
//     duration_seconds, recorded_at?, case_number?,
//     classification, notes? }
// ────────────────────────────────────────────────────────────
bodycamVideosRouter.post('/upload-complete', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);

    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

    const uploadId  = typeof body.uploadId === 'string' ? body.uploadId : '';
    const cameraId  = Number(body.camera_id);
    const officerId = Number(body.officer_id);
    const title     = typeof body.title === 'string' ? body.title.trim() : '';
    if (!uploadId) return c.json({ error: 'uploadId is required' }, 400);
    if (!Number.isInteger(cameraId)  || cameraId  <= 0) return c.json({ error: 'camera_id is required' }, 400);
    if (!Number.isInteger(officerId) || officerId <= 0) return c.json({ error: 'officer_id is required' }, 400);
    if (!title) return c.json({ error: 'title is required' }, 400);

    if (!WRITE_ROLES.has(actor.role) && officerId !== actor.id) {
      return c.json({ error: 'Cannot upload for another officer' }, 403);
    }

    const sessionRaw = await c.env.KV.get(`${UPLOAD_SESSION_PREFIX}${uploadId}`);
    if (!sessionRaw) {
      return c.json({ error: 'Upload session not found or expired' }, 410);
    }
    let session: UploadSession;
    try { session = JSON.parse(sessionRaw) as UploadSession; } catch {
      return c.json({ error: 'Upload session data corrupted' }, 422);
    }

    if (session.parts.length !== session.totalChunks) {
      return c.json({
        error: 'Incomplete upload',
        received: session.parts.length,
        expected: session.totalChunks,
      }, 400);
    }

    const mp = c.env.UPLOADS.resumeMultipartUpload(session.r2Key, uploadId);
    // R2 requires the parts array ascending by partNumber.
    const sortedParts = session.parts.slice().sort((a, b) => a.partNumber - b.partNumber);
    await mp.complete(sortedParts);

    const duration = body.duration_seconds != null && body.duration_seconds !== ''
      ? Number(body.duration_seconds) : null;

    const db = getDb(c.env);
    const result = await execute(db, `
      INSERT INTO bodycam_videos
        (camera_id, officer_id, title, file_path, file_size, duration_seconds,
         mime_type, recorded_at, case_number, classification, notes, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      cameraId, officerId, title,
      session.r2Key, session.fileSize, duration, session.mimeType,
      body.recorded_at  || null,
      body.case_number  || null,
      typeof body.classification === 'string' ? body.classification : 'routine',
      body.notes || null,
      actor.full_name || String(actor.id),
    );
    const newId = result.meta?.last_row_id;
    if (!newId) return c.json({ error: 'Insert succeeded but no id returned' }, 500);

    // Best-effort KV cleanup. If this fails the record TTLs out.
    await c.env.KV.delete(`${UPLOAD_SESSION_PREFIX}${uploadId}`).catch(() => undefined);

    const created = await queryFirst<Record<string, unknown>>(db, `
      SELECT v.*, u.full_name AS officer_name, c.camera_id AS camera_serial
        FROM bodycam_videos v
        LEFT JOIN users u        ON u.id = v.officer_id
        LEFT JOIN body_cameras c ON c.id = v.camera_id
       WHERE v.id = ?
    `, newId);
    return c.json(created, 201);
  } catch (err) {
    console.error('POST /personnel/bodycam-videos/upload-complete failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// ────────────────────────────────────────────────────────────
// DELETE /upload-abort/:uploadId — abort multipart + cleanup KV.
// Idempotent — a missing session returns ok.
// ────────────────────────────────────────────────────────────
bodycamVideosRouter.delete('/upload-abort/:uploadId', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);

    const uploadId = c.req.param('uploadId');
    const sessionRaw = await c.env.KV.get(`${UPLOAD_SESSION_PREFIX}${uploadId}`);
    if (!sessionRaw) return c.json({ ok: true, already_gone: true });

    let session: UploadSession;
    try { session = JSON.parse(sessionRaw) as UploadSession; } catch {
      // Corrupted session — clean up KV so it doesn't block future attempts, then fail
      await c.env.KV.delete(`${UPLOAD_SESSION_PREFIX}${uploadId}`).catch(() => undefined);
      return c.json({ error: 'Upload session data corrupted; session cleared' }, 422);
    }
    const mp = c.env.UPLOADS.resumeMultipartUpload(session.r2Key, uploadId);
    await mp.abort().catch((err) => {
      // R2 returns a 404-equivalent if the multipart already expired
      // or was already aborted; swallow so the KV delete still runs
      // and the client sees a clean 200.
      console.warn('mp.abort() ignored:', err);
    });
    await c.env.KV.delete(`${UPLOAD_SESSION_PREFIX}${uploadId}`);
    return c.json({ ok: true });
  } catch (err) {
    console.error('DELETE /personnel/bodycam-videos/upload-abort failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// ────────────────────────────────────────────────────────────
// GET /:id/stream — range-supporting playback stream.
//
// Auth: a <video src> can't carry an Authorization header, so the
// client appends ?token=<JWT>. authMiddleware was extended to read
// the query token; the same READ_ALL_ROLES scope check applies as
// the rest of the bodycam-videos surface (admin/manager/supervisor
// see everything; everyone else only their own footage).
//
// REGISTERED BEFORE the bare /:id GET so Hono matches the longer
// pattern. Reverse the order and /:id swallows /:id/stream as
// id='123/stream' → 400.
// ────────────────────────────────────────────────────────────
bodycamVideosRouter.get('/:id/stream', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'Invalid id' }, 400);
    }

    // Preferred auth: per-resource HMAC params from POST /auth/sign-urls.
    // Read scope was enforced at sign time, so a valid signature replaces
    // both the actor check and the per-officer scope check below.
    const signedOk = await verifySignedResource(c.env.JWT_SECRET, 'bodycam', String(id), {
      sig: c.req.query('sig'), exp: c.req.query('exp'), nonce: c.req.query('nonce'),
    });

    const actor = getActor(c);
    if (!signedOk && !actor) return c.json({ error: 'Authentication required' }, 401);

    const db = getDb(c.env);
    const row = await queryFirst<{
      id: number;
      officer_id: number;
      file_path: string;
      mime_type: string | null;
      file_size: number | null;
    }>(db, `
      SELECT id, officer_id, file_path, mime_type, file_size
        FROM bodycam_videos
       WHERE id = ?
    `, id);
    if (!row) return c.json({ error: 'Video not found' }, 404);
    if (!signedOk && actor && !READ_ALL_ROLES.has(actor.role) && row.officer_id !== actor.id) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    if (!row.file_path) return c.json({ error: 'No file attached' }, 404);

    // Range header: only "bytes=START-END" or "bytes=START-" supported.
    // Anything else (suffix, multi-range, malformed) falls through to
    // a full 200 — the <video> element re-requests on the next seek.
    const rangeHeader = c.req.header('Range');
    let r2Range: R2Range | undefined;
    let rangeStart = 0;
    let rangeEnd = -1;
    if (rangeHeader) {
      const m = rangeHeader.trim().match(/^bytes=(\d+)-(\d*)$/);
      if (m) {
        rangeStart = Number(m[1]);
        rangeEnd = m[2] ? Number(m[2]) : -1;
        r2Range = rangeEnd >= 0
          ? { offset: rangeStart, length: rangeEnd - rangeStart + 1 }
          : { offset: rangeStart };
      }
    }

    // getR2Range() instead of a bare get(): R2 THROWS on an unsatisfiable
    // range (start > end, or start past EOF), which the catch below would
    // report as a 500 on what is really a client error. See byteRange.ts.
    const got = await getR2Range(c.env.UPLOADS, row.file_path, r2Range);
    if (got.kind === 'missing') return c.json({ error: 'File not in storage' }, 404);
    if (got.kind === 'unsatisfiable') {
      const init = rangeNotSatisfiableInit(got.total);
      return c.json(init.body, init.status, init.headers);
    }
    const obj = got.obj;

    const totalSize = obj.size;
    const mime = row.mime_type || obj.httpMetadata?.contentType || 'video/mp4';
    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=0, no-store',
    };

    if (r2Range) {
      const start = rangeStart;
      const end = rangeEnd >= 0 ? Math.min(rangeEnd, totalSize - 1) : totalSize - 1;
      headers['Content-Range']  = `bytes ${start}-${end}/${totalSize}`;
      headers['Content-Length'] = String(end - start + 1);
      return new Response(obj.body, { status: 206, headers });
    }
    headers['Content-Length'] = String(totalSize);
    return new Response(obj.body, { status: 200, headers });
  } catch (err) {
    console.error('GET /personnel/bodycam-videos/:id/stream failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// ────────────────────────────────────────────────────────────
// POST /:id/thumbnail — client-captured JPEG frame for a video.
// The client canvas-captures a frame after upload completes (no
// server-side transcoding — Workers can't run ffmpeg) and posts it
// here as multipart. Non-blocking on the upload flow: a failure here
// leaves the video usable with no thumbnail (client falls back to a
// generic icon).
// ────────────────────────────────────────────────────────────
bodycamVideosRouter.post('/:id/thumbnail', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);
    if (!WRITE_ROLES.has(actor.role)) return c.json({ error: 'Insufficient permissions' }, 403);

    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

    const ct = c.req.header('content-type') || '';
    if (!ct.startsWith('multipart/form-data')) {
      return c.json({ error: 'multipart/form-data required' }, 400);
    }
    const form = await c.req.formData();
    const image = form.get('thumbnail') as unknown as File | string | null;
    if (!image || typeof image === 'string' || !(image instanceof Blob)) {
      return c.json({ error: 'thumbnail file is required' }, 400);
    }

    const db = getDb(c.env);
    await ensureBodycamArtifactColumns(db);

    const row = await queryFirst<{ id: number; file_path: string | null }>(
      db, 'SELECT id, file_path FROM bodycam_videos WHERE id = ?', id,
    );
    if (!row) return c.json({ error: 'Video not found' }, 404);
    if (!row.file_path) return c.json({ error: 'Video has no source file' }, 400);

    // Derive the artifact prefix from the original's key: "<prefix><uuid>/original.<ext>".
    const prefix = row.file_path.replace(/\/original\.[a-zA-Z0-9]+$/, '');
    const thumbKey = `${prefix}/thumbnail.jpg`;

    await c.env.UPLOADS.put(thumbKey, image.stream(), {
      httpMetadata: { contentType: 'image/jpeg' },
    });
    await execute(db, "UPDATE bodycam_videos SET thumbnail_path = ?, updated_at = datetime('now') WHERE id = ?", thumbKey, id);

    return c.json({ success: true, thumbnail_path: thumbKey });
  } catch (err) {
    console.error('POST /personnel/bodycam-videos/:id/thumbnail failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// ────────────────────────────────────────────────────────────
// GET /:id/thumbnail — serve the stored JPEG. Same auth pattern as
// GET /:id/stream (signed-URL OR bearer/query-token + officer scope).
// ────────────────────────────────────────────────────────────
bodycamVideosRouter.get('/:id/thumbnail', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

    const signedOk = await verifySignedResource(c.env.JWT_SECRET, 'bodycam-thumb', String(id), {
      sig: c.req.query('sig'), exp: c.req.query('exp'), nonce: c.req.query('nonce'),
    });
    const actor = getActor(c);
    if (!signedOk && !actor) return c.json({ error: 'Authentication required' }, 401);

    const db = getDb(c.env);
    const row = await queryFirst<{ officer_id: number; thumbnail_path: string | null }>(
      db, 'SELECT officer_id, thumbnail_path FROM bodycam_videos WHERE id = ?', id,
    );
    if (!row) return c.json({ error: 'Video not found' }, 404);
    if (!signedOk && actor && !READ_ALL_ROLES.has(actor.role) && row.officer_id !== actor.id) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    if (!row.thumbnail_path) return c.json({ error: 'No thumbnail' }, 404);

    const obj = await c.env.UPLOADS.get(row.thumbnail_path);
    if (!obj) return c.json({ error: 'File not in storage' }, 404);

    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error('GET /personnel/bodycam-videos/:id/thumbnail failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// ────────────────────────────────────────────────────────────
// POST /:id/detections — client-side auto face/plate scan results.
// The client runs the SAME scanClip() engine RedactionStudio uses,
// automatically after upload (fire-and-forget, non-blocking). This
// route stores the region JSON + counts and, ONLY if the video is
// still at its default 'routine' classification, bumps it to
// 'flagged' as a redact-before-sharing signal. It never downgrades
// an already-set classification.
// ────────────────────────────────────────────────────────────
bodycamVideosRouter.post('/:id/detections', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);
    if (!WRITE_ROLES.has(actor.role)) return c.json({ error: 'Insufficient permissions' }, 403);

    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

    const body = await c.req.json<{ regions?: unknown[] }>().catch(() => null);
    if (!body || !Array.isArray(body.regions)) {
      return c.json({ error: 'regions array is required' }, 400);
    }

    const db = getDb(c.env);
    await ensureBodycamArtifactColumns(db);

    const row = await queryFirst<{ id: number; classification: string | null }>(
      db, 'SELECT id, classification FROM bodycam_videos WHERE id = ?', id,
    );
    if (!row) return c.json({ error: 'Video not found' }, 404);

    const plateCount = body.regions.filter((r: any) => r?.kind === 'plate').length;
    const faceCount = body.regions.filter((r: any) => r?.kind === 'face').length;
    const regionsJson = JSON.stringify(body.regions);

    const shouldFlag = (plateCount > 0 || faceCount > 0) && row.classification === 'routine';
    if (shouldFlag) {
      await execute(db,
        "UPDATE bodycam_videos SET detected_plate_count = ?, detected_face_count = ?, detection_regions_json = ?, classification = 'flagged', updated_at = datetime('now') WHERE id = ?",
        plateCount, faceCount, regionsJson, id);
    } else {
      await execute(db,
        "UPDATE bodycam_videos SET detected_plate_count = ?, detected_face_count = ?, detection_regions_json = ?, updated_at = datetime('now') WHERE id = ?",
        plateCount, faceCount, regionsJson, id);
    }

    return c.json({ success: true, detected_plate_count: plateCount, detected_face_count: faceCount, flagged: shouldFlag });
  } catch (err) {
    console.error('POST /personnel/bodycam-videos/:id/detections failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// ────────────────────────────────────────────────────────────
// POST /:id/transcribe — client-extracted audio track, transcribed via
// the SAME Whisper helper the AI radio dispatcher uses
// (transcribeTransmission(), @cf/openai/whisper-large-v3-turbo). The
// client extracts audio client-side (captureStream + MediaRecorder,
// audio-only) after upload completes and posts it here, fire-and-forget.
// Best-effort: a transcription failure (null result) simply leaves
// `transcript` unset — no retry, matches the existing radio-transcription
// failure contract.
// ────────────────────────────────────────────────────────────
bodycamVideosRouter.post('/:id/transcribe', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);
    if (!WRITE_ROLES.has(actor.role)) return c.json({ error: 'Insufficient permissions' }, 403);

    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

    const ct = c.req.header('content-type') || '';
    if (!ct.startsWith('multipart/form-data')) {
      return c.json({ error: 'multipart/form-data required' }, 400);
    }
    const form = await c.req.formData();
    const audio = form.get('audio') as unknown as File | string | null;
    if (!audio || typeof audio === 'string' || !(audio instanceof Blob)) {
      return c.json({ error: 'audio file is required' }, 400);
    }
    // ~50MB — generous for even a long clip's audio-only track (bodycam clips
    // can run many minutes, unlike the short radio PTT bursts this helper was
    // originally built for); guards against buffering an oversized blob into
    // memory and hitting the isolate's memory ceiling (OOM).
    const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
    if (audio.size > MAX_AUDIO_BYTES) {
      return c.json({ error: 'Audio file too large for transcription', maxBytes: MAX_AUDIO_BYTES }, 413);
    }

    const db = getDb(c.env);
    await ensureBodycamArtifactColumns(db);

    const row = await queryFirst<{ id: number }>(db, 'SELECT id FROM bodycam_videos WHERE id = ?', id);
    if (!row) return c.json({ error: 'Video not found' }, 404);

    const audioBytes = new Uint8Array(await audio.arrayBuffer());
    const transcript = await transcribeTransmission(c.env.AI, audioBytes);
    if (!transcript) {
      return c.json({ success: true, transcribed: false });
    }

    await execute(db, "UPDATE bodycam_videos SET transcript = ?, updated_at = datetime('now') WHERE id = ?", transcript, id);
    return c.json({ success: true, transcribed: true, transcript });
  } catch (err) {
    console.error('POST /personnel/bodycam-videos/:id/transcribe failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// ────────────────────────────────────────────────────────────
// POST /:id/analyze — on-demand AI object detection/identification.
// Client samples frames from the already-loaded player and posts them
// here (NOT automatic on upload — this calls a paid vision model per
// frame, unlike the free client-side thumbnail/plate/face detection).
// Every finding is a "potential, review required" signal — this route
// must never write to classification/retention_status or trigger any
// action; it only stores a JSON blob the UI renders as review aids.
//
// Do NOT extend this route (or the prompt below) to attempt deception
// detection, voice stress analysis, or "anxiety analysis" in any form —
// see docs/superpowers/specs/2026-07-14-bodycam-ai-object-detection-design.md's
// "Explicit scope boundary" section. That is a deliberate, permanent
// exclusion, not an oversight to be filled in later.
// ────────────────────────────────────────────────────────────
const ANALYSIS_VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const ANALYSIS_MAX_FRAMES = 20;
// A single JPEG video frame should be well under this; guards against a
// caller posting arbitrarily large blobs (each one is expanded via
// Array.from(bytes), which is heavier than the raw bytes) — mirrors the
// MAX_AUDIO_BYTES cap on the sibling /:id/transcribe route above.
const MAX_FRAME_BYTES = 5 * 1024 * 1024;
const VALID_SAFETY_FLAGS = new Set(['weapon_draw', 'running', 'struggle']);

const ANALYSIS_PROMPT = `You are assisting a human reviewer of body-worn camera footage. Look at this single video frame and return ONLY a JSON object (no prose, no markdown fences) with this exact shape:
{
  "weapon_present": boolean,
  "weapon_confidence": number (0 to 1),
  "weapon_type": string or null (e.g. "firearm", "knife"),
  "vehicle_present": boolean,
  "vehicle_description": string or null (brief: type/color, e.g. "dark sedan"),
  "scene_type": string or null (brief label, e.g. "traffic stop", "foot pursuit", "interview"),
  "force_indicators": boolean (true if the frame shows what looks like physical struggle/force),
  "force_confidence": number (0 to 1),
  "officer_safety_flags": string[] (any of: "weapon_draw", "running", "struggle" — empty array if none)
}
Only set a boolean true if you have reasonable visual evidence in THIS frame. This is a triage aid for a human reviewer, not a final determination — when uncertain, prefer lower confidence over a false positive.`;

bodycamVideosRouter.post('/:id/analyze', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);
    if (!WRITE_ROLES.has(actor.role)) return c.json({ error: 'Insufficient permissions' }, 403);

    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

    const ct = c.req.header('content-type') || '';
    if (!ct.startsWith('multipart/form-data')) {
      return c.json({ error: 'multipart/form-data required' }, 400);
    }
    const form = await c.req.formData();
    const timestampsRaw = form.get('timestamps');
    let timestamps: number[];
    try {
      timestamps = JSON.parse(String(timestampsRaw));
      if (!Array.isArray(timestamps)) throw new Error('not an array');
    } catch {
      return c.json({ error: 'timestamps must be a JSON array' }, 400);
    }

    const frameEntries = form.getAll('frame') as unknown as (File | string)[];
    const frames = frameEntries.filter((f): f is File => typeof f !== 'string' && f instanceof Blob);
    if (frames.length === 0) return c.json({ error: 'at least one frame is required' }, 400);
    if (frames.length !== timestamps.length) {
      return c.json({ error: 'frame count must match timestamps count' }, 400);
    }
    if (frames.length > ANALYSIS_MAX_FRAMES) {
      return c.json({ error: `too many frames (max ${ANALYSIS_MAX_FRAMES})` }, 400);
    }

    const db = getDb(c.env);
    await ensureBodycamArtifactColumns(db);
    const row = await queryFirst<{ id: number }>(db, 'SELECT id FROM bodycam_videos WHERE id = ?', id);
    if (!row) return c.json({ error: 'Video not found' }, 404);

    // Sequential, not Promise.all — stays within Workers AI concurrent-
    // request limits (see design spec). A ~20-frame analysis takes tens
    // of seconds; the client shows a progress indicator, not a spinner.
    const results: FrameAnalysis[] = [];
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const timestamp = Number(timestamps[i]) || 0;
      try {
        if (frame.size > MAX_FRAME_BYTES) {
          console.warn(`bodycam analyze: frame at ${timestamp}s exceeds ${MAX_FRAME_BYTES} bytes, skipping`);
          continue;
        }
        const bytes = new Uint8Array(await frame.arrayBuffer());
        const out: any = await c.env.AI.run(ANALYSIS_VISION_MODEL as any, {
          image: Array.from(bytes),
          prompt: ANALYSIS_PROMPT,
          max_tokens: 512,
          temperature: 0.1,
        } as any);
        const parsed = tryParseModelJson(out);
        results.push({
          timestamp,
          weapon_present: !!parsed.weapon_present,
          weapon_confidence: Math.min(1, Math.max(0, Number(parsed.weapon_confidence) || 0)),
          weapon_type: typeof parsed.weapon_type === 'string' ? parsed.weapon_type : null,
          vehicle_present: !!parsed.vehicle_present,
          vehicle_description: typeof parsed.vehicle_description === 'string' ? parsed.vehicle_description : null,
          scene_type: typeof parsed.scene_type === 'string' ? parsed.scene_type : null,
          force_indicators: !!parsed.force_indicators,
          force_confidence: Math.min(1, Math.max(0, Number(parsed.force_confidence) || 0)),
          officer_safety_flags: Array.isArray(parsed.officer_safety_flags)
            ? parsed.officer_safety_flags.filter((x: unknown) => typeof x === 'string' && VALID_SAFETY_FLAGS.has(x))
            : [],
        });
      } catch (frameErr) {
        // Best-effort per frame — one bad frame doesn't fail the whole analysis.
        console.warn(`bodycam analyze: frame at ${timestamp}s failed:`, frameErr);
      }
    }

    if (results.length === 0 && frames.length > 0) {
      console.warn(`bodycam analyze: all ${frames.length} frame(s) failed for video ${id}`);
      return c.json({ error: 'AI analysis failed for all frames — try again' }, 502);
    }

    const analysis = aggregateAnalysis(results, new Date().toISOString());
    await execute(db, "UPDATE bodycam_videos SET ai_analysis_json = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(analysis), id);

    log.info('Bodycam AI analysis completed', {
      videoId: id, framesRequested: frames.length, framesAnalyzed: results.length,
      weaponDetected: !!analysis.weapon, forceDetected: !!analysis.force_indicators,
    });

    return c.json({ success: true, frames_analyzed: results.length, frames_requested: frames.length, analysis });
  } catch (err) {
    console.error('POST /personnel/bodycam-videos/:id/analyze failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});

// ────────────────────────────────────────────────────────────
// POST /:id/deep-scan — on-demand, higher-accuracy face/plate detection
// for Redaction Studio, using the same vision model as /:id/analyze but
// prompted for bounding boxes instead of scene findings. Opt-in per clip
// (or per time range) — NOT automatic, since this calls a paid Workers AI
// model per frame. Results are NOT persisted server-side; they flow
// straight into the client's in-memory region list (same as the free
// client-side scan) and only get saved when the operator exports/saves,
// exactly like manually-drawn boxes today.
// ────────────────────────────────────────────────────────────
const DEEP_SCAN_VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
// Kept low relative to /:id/analyze's 20-frame cap: deep-scan's heavier
// bounding-box prompt + double max_tokens (1024 vs 512) means each frame
// costs more time, and both routes share the same 180s client timeout.
const DEEP_SCAN_MAX_FRAMES = 18;
// Mirrors ANALYSIS's MAX_FRAME_BYTES cap on the sibling /:id/analyze route.
const DEEP_SCAN_MAX_FRAME_BYTES = 5 * 1024 * 1024;
// Bounds a single frame's AI call so one anomalously slow frame can't
// consume the whole 180s client-side request budget.
const DEEP_SCAN_FRAME_AI_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

const DEEP_SCAN_PROMPT = `You are assisting a human reviewer redacting body-worn camera footage for privacy. Look at this single video frame and identify every human FACE and every vehicle LICENSE PLATE visible, including partially visible or angled ones. Return ONLY a JSON object (no prose, no markdown fences) with this exact shape:
{
  "detections": [
    { "kind": "face" | "plate", "box": [x, y, w, h], "confidence": number (0 to 1) }
  ]
}
"box" is the bounding box in FRACTIONAL coordinates (0 to 1) relative to the frame — x,y is the top-left corner, w,h is width/height as a fraction of the frame's total width/height. Include every distinct face and plate you can see, even small or partially obscured ones — this is for privacy redaction, so err toward including a lower-confidence detection rather than omitting one. If nothing is visible, return {"detections": []}.`;

bodycamVideosRouter.post('/:id/deep-scan', async (c) => {
  try {
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);
    if (!WRITE_ROLES.has(actor.role)) return c.json({ error: 'Insufficient permissions' }, 403);

    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

    const ct = c.req.header('content-type') || '';
    if (!ct.startsWith('multipart/form-data')) {
      return c.json({ error: 'multipart/form-data required' }, 400);
    }
    const form = await c.req.formData();
    const timestampsRaw = form.get('timestamps');
    let timestamps: number[];
    try {
      timestamps = JSON.parse(String(timestampsRaw));
      if (!Array.isArray(timestamps)) throw new Error('not an array');
    } catch {
      return c.json({ error: 'timestamps must be a JSON array' }, 400);
    }

    const frameEntries = form.getAll('frame') as unknown as (File | string)[];
    const frames = frameEntries.filter((f): f is File => typeof f !== 'string' && f instanceof Blob);
    if (frames.length === 0) return c.json({ error: 'at least one frame is required' }, 400);
    if (frames.length !== timestamps.length) {
      return c.json({ error: 'frame count must match timestamps count' }, 400);
    }
    if (frames.length > DEEP_SCAN_MAX_FRAMES) {
      return c.json({ error: `too many frames (max ${DEEP_SCAN_MAX_FRAMES})` }, 400);
    }

    const db = getDb(c.env);
    const row = await queryFirst<{ id: number }>(db, 'SELECT id FROM bodycam_videos WHERE id = ?', id);
    if (!row) return c.json({ error: 'Video not found' }, 404);

    // Sequential, not Promise.all — same Workers AI concurrency rationale
    // as /:id/analyze.
    const samples: DetectorSample[] = [];
    let framesAnalyzed = 0;
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const timestamp = Number(timestamps[i]) || 0;
      try {
        if (frame.size > DEEP_SCAN_MAX_FRAME_BYTES) {
          console.warn(`bodycam deep-scan: frame at ${timestamp}s exceeds ${DEEP_SCAN_MAX_FRAME_BYTES} bytes, skipping`);
          continue;
        }
        const bytes = new Uint8Array(await frame.arrayBuffer());
        const out: any = await withTimeout(
          c.env.AI.run(DEEP_SCAN_VISION_MODEL as any, {
            image: Array.from(bytes),
            prompt: DEEP_SCAN_PROMPT,
            max_tokens: 1024,
            temperature: 0.1,
          } as any),
          DEEP_SCAN_FRAME_AI_TIMEOUT_MS,
          `deep-scan frame at ${timestamp}s`,
        );
        const parsed = tryParseModelJson(out);
        const rawDetections: RawDeepScanDetection[] = Array.isArray(parsed?.detections) ? parsed.detections : [];
        samples.push(...parseDeepScanFrame(rawDetections, timestamp));
        framesAnalyzed++;
      } catch (frameErr) {
        // Best-effort per frame — one bad frame doesn't fail the whole scan.
        console.warn(`bodycam deep-scan: frame at ${timestamp}s failed:`, frameErr);
      }
    }

    if (framesAnalyzed === 0 && frames.length > 0) {
      console.warn(`bodycam deep-scan: all ${frames.length} frame(s) failed for video ${id}`);
      return c.json({ error: 'Deep scan failed for all frames — try again' }, 502);
    }

    log.info('Bodycam deep scan completed', {
      videoId: id, framesRequested: frames.length, framesAnalyzed,
      faceDetections: samples.filter((s) => s.kind === 'face').length,
      plateDetections: samples.filter((s) => s.kind === 'plate').length,
    });

    return c.json({ success: true, frames_analyzed: framesAnalyzed, frames_requested: frames.length, samples });
  } catch (err) {
    console.error('POST /personnel/bodycam-videos/:id/deep-scan failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});
