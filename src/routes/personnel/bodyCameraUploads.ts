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
//   bodycam-videos/<uuid>             finished video (referenced by
//                                     bodycam_videos.file_path)
//
// KV session layout (24-h TTL):
//   bodycam-upload:<r2-multipart-uploadId> → JSON UploadSession
// ============================================================

import {
  bodycamVideosRouter,
  READ_ALL_ROLES,
  WRITE_ROLES,
  getActor,
} from './bodyCameras';
import { getDb, queryFirst, execute } from '../../utils/db';

const UPLOAD_KEY_PREFIX = 'bodycam-videos/';
const UPLOAD_SESSION_PREFIX = 'bodycam-upload:';
const UPLOAD_SESSION_TTL = 86400; // 24 h

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

    const r2Key = `${UPLOAD_KEY_PREFIX}${crypto.randomUUID()}`;
    const mimeType = file.type || 'video/mp4';

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
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
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

    const r2Key = `${UPLOAD_KEY_PREFIX}${crypto.randomUUID()}`;
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
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
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
    const session = JSON.parse(sessionRaw) as UploadSession;
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
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
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
    const session = JSON.parse(sessionRaw) as UploadSession;

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
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
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

    const session = JSON.parse(sessionRaw) as UploadSession;
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
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
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
    const actor = getActor(c);
    if (!actor) return c.json({ error: 'Authentication required' }, 401);

    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'Invalid id' }, 400);
    }

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
    if (!READ_ALL_ROLES.has(actor.role) && row.officer_id !== actor.id) {
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

    const obj = r2Range
      ? await c.env.UPLOADS.get(row.file_path, { range: r2Range })
      : await c.env.UPLOADS.get(row.file_path);
    if (!obj) return c.json({ error: 'File not in storage' }, 404);

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
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});
