# Body Camera Storage/Config Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each body-cam video a structured set of R2 artifacts (original + thumbnail + optional redacted export) and let it attach a redaction chain-of-custody record, reusing the existing dashcam redaction machinery instead of building a parallel system.

**Architecture:** New nullable columns on `bodycam_videos` (`thumbnail_path`, `redacted_path`) and a nullable `source_bodycam_video_id` on `video_redactions`. Upload endpoints switch from a flat `bodycam-videos/<uuid>` R2 key to `bodycam-videos/<uuid>/original.<ext>`, with sibling `thumbnail.jpg` / `redacted.mp4` keys under the same prefix. Thumbnails are captured client-side (canvas frame grab, no server transcoding) and uploaded through a new endpoint. `RedactionStudio.tsx` gains a `source` prop so it can post `source_bodycam_video_id` instead of `event_id`.

**Tech Stack:** Hono routes on Cloudflare Workers, D1, R2 (`UPLOADS` binding), React + TypeScript client, Vitest + `cloudflare:test` Miniflare pool for route tests.

**Spec:** [`docs/superpowers/specs/2026-07-13-bodycam-storage-architecture-design.md`](../specs/2026-07-13-bodycam-storage-architecture-design.md)

---

### Task 1: D1 migration — new columns

**Files:**
- Create: `migrations/0187_bodycam_video_artifacts.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0187_bodycam_video_artifacts.sql — thumbnail/redacted artifact columns for
-- bodycam_videos, and a nullable bodycam sibling FK on video_redactions so one
-- custody table serves both dashcam events and body-cam videos.
-- Idempotent; the routes also reconcile these columns at runtime via
-- columnExists() because deploy migration-apply is continue-on-error.
-- APPLY DIRECTLY TO LIVE D1 785de7ae AFTER MERGE (scripts/apply-migration.sh).

ALTER TABLE bodycam_videos ADD COLUMN thumbnail_path TEXT;
ALTER TABLE bodycam_videos ADD COLUMN redacted_path TEXT;

ALTER TABLE video_redactions ADD COLUMN source_bodycam_video_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_video_redactions_bodycam
  ON video_redactions (source_bodycam_video_id);
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`

Then: `npx wrangler d1 execute rmpg-flex --local --command "PRAGMA table_info(bodycam_videos)"`
Expected: output includes rows for `thumbnail_path` and `redacted_path`.

Then: `npx wrangler d1 execute rmpg-flex --local --command "PRAGMA table_info(video_redactions)"`
Expected: output includes a row for `source_bodycam_video_id`.

- [ ] **Step 3: Commit**

```bash
git add migrations/0187_bodycam_video_artifacts.sql
git commit -m "feat(bodycam): add D1 columns for thumbnail/redacted video artifacts"
```

---

### Task 2: Server — runtime column-reconcile helper for bodycam_videos

D1 migration-apply is `continue-on-error` on deploy (per CLAUDE.md), so every route touching the new columns must self-heal like `redactions.ts` already does with `ensureSchema()`.

**Files:**
- Modify: `src/routes/personnel/bodyCameras.ts:1-63` (top of file, near existing imports/consts)

- [ ] **Step 1: Add the reconcile helper**

Add this near the top of `src/routes/personnel/bodyCameras.ts`, after the existing `import { dbErrorResponse } from '../../utils/dbErrors';` line and before `const READ_ALL_ROLES`:

```ts
import { columnExists } from '../../utils/db';

// Runtime column-reconcile for the two new artifact columns. Deploy's
// migration-apply step is continue-on-error, so a missing column must
// self-heal at request time (mirrors src/routes/redactions.ts).
let _bodycamArtifactColumnsEnsured = false;
async function ensureBodycamArtifactColumns(db: ReturnType<typeof getDb>): Promise<void> {
  if (_bodycamArtifactColumnsEnsured) return;
  for (const [name, type] of [['thumbnail_path', 'TEXT'], ['redacted_path', 'TEXT']] as const) {
    if (!(await columnExists(db, 'bodycam_videos', name))) {
      try { await execute(db, `ALTER TABLE bodycam_videos ADD COLUMN ${name} ${type}`); }
      catch { /* race / already present */ }
    }
  }
  _bodycamArtifactColumnsEnsured = true;
}
```

- [ ] **Step 2: Export it for use in `bodyCameraUploads.ts`**

Find the export line at the bottom of `src/routes/personnel/bodyCameras.ts`:

```ts
export { bodyCamerasRouter, bodycamVideosRouter, READ_ALL_ROLES, WRITE_ROLES, getActor };
```

Replace with:

```ts
export { bodyCamerasRouter, bodycamVideosRouter, READ_ALL_ROLES, WRITE_ROLES, getActor, ensureBodycamArtifactColumns };
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors (the helper isn't called anywhere yet, so it's unused-import safe since it's referenced by its own export).

- [ ] **Step 4: Commit**

```bash
git add src/routes/personnel/bodyCameras.ts
git commit -m "feat(bodycam): add runtime column-reconcile for artifact columns"
```

---

### Task 3: Server — R2 key layout (original.<ext> under a per-video prefix)

**Files:**
- Modify: `src/routes/personnel/bodyCameraUploads.ts:1-30` (header comment), `:63-95` (POST /), `:135-165` (POST /upload-init)

- [ ] **Step 1: Add an extension helper**

Add near the top of `src/routes/personnel/bodyCameraUploads.ts`, right after the existing `const UPLOAD_SESSION_TTL = 86400;` line:

```ts
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
```

- [ ] **Step 2: Update the single-shot upload key (POST /)**

In the `POST /` handler, find:

```ts
    const r2Key = `${UPLOAD_KEY_PREFIX}${crypto.randomUUID()}`;
    const mimeType = file.type || 'video/mp4';
```

Replace with:

```ts
    const mimeType = file.type || 'video/mp4';
    const videoUuid = crypto.randomUUID();
    const r2Key = `${UPLOAD_KEY_PREFIX}${videoUuid}/original.${extFromMime(mimeType, (file as File).name)}`;
```

- [ ] **Step 3: Update the multipart-init key (POST /upload-init)**

In the `POST /upload-init` handler, find:

```ts
    const r2Key = `${UPLOAD_KEY_PREFIX}${crypto.randomUUID()}`;
    const mp = await c.env.UPLOADS.createMultipartUpload(r2Key, {
```

Replace with:

```ts
    const videoUuid = crypto.randomUUID();
    const r2Key = `${UPLOAD_KEY_PREFIX}${videoUuid}/original.${extFromMime(mimeType, fileName)}`;
    const mp = await c.env.UPLOADS.createMultipartUpload(r2Key, {
```

- [ ] **Step 4: Update the header comment**

Find the storage-layout comment block near the top of the file:

```
// Storage layout in R2 (bucket: env.UPLOADS):
//   bodycam-videos/<uuid>             finished video (referenced by
//                                     bodycam_videos.file_path)
```

Replace with:

```
// Storage layout in R2 (bucket: env.UPLOADS):
//   bodycam-videos/<uuid>/original.<ext>   finished video (referenced by
//                                           bodycam_videos.file_path)
//   bodycam-videos/<uuid>/thumbnail.jpg    client-captured frame (see
//                                           POST /:id/thumbnail below)
//   bodycam-videos/<uuid>/redacted.mp4     optional redaction export
//                                           (see src/routes/redactions.ts)
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/personnel/bodyCameraUploads.ts
git commit -m "feat(bodycam): structure R2 keys as <uuid>/original.<ext>"
```

---

### Task 4: Server — thumbnail upload + fetch endpoints

**Files:**
- Modify: `src/routes/personnel/bodyCameraUploads.ts` (add new routes; import `ensureBodycamArtifactColumns`, `WRITE_ROLES`, `READ_ALL_ROLES`, `getDb`)

- [ ] **Step 1: Extend the imports at the top of the file**

Find:

```ts
import {
  bodycamVideosRouter,
  READ_ALL_ROLES,
  WRITE_ROLES,
  getActor,
} from './bodyCameras';
import { getDb, queryFirst, execute } from '../../utils/db';
import { verifySignedResource } from '../../utils/signedAccess';
```

Replace with:

```ts
import {
  bodycamVideosRouter,
  READ_ALL_ROLES,
  WRITE_ROLES,
  getActor,
  ensureBodycamArtifactColumns,
} from './bodyCameras';
import { getDb, queryFirst, execute } from '../../utils/db';
import { verifySignedResource } from '../../utils/signedAccess';
```

- [ ] **Step 2: Add the routes**

Add this block at the end of `src/routes/personnel/bodyCameraUploads.ts` (after the existing `GET /:id/stream` handler, before the final export if any — this file has no trailing export, so append at end of file):

```ts
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
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/personnel/bodyCameraUploads.ts
git commit -m "feat(bodycam): add thumbnail upload + fetch endpoints"
```

---

### Task 5: Server test — thumbnail endpoint (Miniflare)

**Files:**
- Modify: `test-workers/entry.ts` (mount the bodycam routers)
- Create: `test-workers/bodycamThumbnail.test.ts`

- [ ] **Step 1: Mount bodycam routes in the shared test entry**

Replace the full contents of `test-workers/entry.ts` with:

```ts
// Minimal test worker for the Workers (Miniflare) vitest pool. Mounts routers
// with an injected operational user — real auth is applied per-prefix in
// src/index.ts (not inside the router), so routers are testable in isolation
// without booting the full app + its Durable Objects.
import { Hono } from 'hono';
import alpr from '../src/routes/alpr';
import redactions from '../src/routes/redactions';
import { bodycamVideosRouter } from '../src/routes/personnel/bodyCameras';
import '../src/routes/personnel/bodyCameraUploads'; // attaches handlers to bodycamVideosRouter

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  // Mirror authMiddleware: requireRole reads c.var.user.role; handlers read c.var.userId.
  c.set('user', { id: 1, role: 'admin', username: 'test-officer' });
  c.set('userId', 1);
  await next();
});
app.route('/api/alpr', alpr);
app.route('/api/redactions', redactions);
app.route('/api/personnel/bodycam-videos', bodycamVideosRouter);

export default app;
```

- [ ] **Step 2: Write the failing test**

Create `test-workers/bodycamThumbnail.test.ts`:

```ts
// test-workers/bodycamThumbnail.test.ts
// Miniflare route smoke test for POST/GET /api/personnel/bodycam-videos/:id/thumbnail.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';

async function createTestCameraAndVideo(): Promise<number> {
  const camRes = await app.request('/api/personnel/bodycam-videos', {}, env as unknown as Record<string, unknown>);
  void camRes; // placeholder no-op to keep helper shape stable if extended
  const db = (env as unknown as { DB: D1Database }).DB;
  await db.prepare(
    `INSERT INTO body_cameras (officer_id, camera_id, status, storage_capacity_gb) VALUES (1, 'TEST-CAM-1', 'assigned', 32)`
  ).run();
  const cam = await db.prepare(`SELECT id FROM body_cameras WHERE camera_id = 'TEST-CAM-1'`).first<{ id: number }>();
  const video = await db.prepare(
    `INSERT INTO bodycam_videos (camera_id, officer_id, title, file_path, file_size, mime_type, classification, uploaded_by)
     VALUES (?, 1, 'Test clip', 'bodycam-videos/test-uuid/original.mp4', 1024, 'video/mp4', 'routine', 'test-officer')`
  ).bind(cam!.id).run();
  return Number(video.meta.last_row_id);
}

describe('POST/GET /api/personnel/bodycam-videos/:id/thumbnail', () => {
  let videoId: number;
  beforeAll(async () => { videoId = await createTestCameraAndVideo(); });

  it('stores the JPEG to R2 and sets thumbnail_path, then serves it back', async () => {
    const fd = new FormData();
    fd.append('thumbnail', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'thumb.jpg');

    const postRes = await app.request(`/api/personnel/bodycam-videos/${videoId}/thumbnail`, { method: 'POST', body: fd }, env as unknown as Record<string, unknown>);
    expect(postRes.status).toBe(200);
    const postBody = await postRes.json() as { thumbnail_path: string };
    expect(postBody.thumbnail_path).toBe(`bodycam-videos/test-uuid/thumbnail.jpg`);

    const getRes = await app.request(`/api/personnel/bodycam-videos/${videoId}/thumbnail`, {}, env as unknown as Record<string, unknown>);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('content-type')).toBe('image/jpeg');
  });

  it('404s when no thumbnail has been uploaded yet for a different video', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const video = await db.prepare(
      `INSERT INTO bodycam_videos (camera_id, officer_id, title, file_path, file_size, mime_type, classification, uploaded_by)
       VALUES ((SELECT id FROM body_cameras WHERE camera_id = 'TEST-CAM-1'), 1, 'No thumb yet', 'bodycam-videos/other-uuid/original.mp4', 1024, 'video/mp4', 'routine', 'test-officer')`
    ).run();
    const otherId = Number(video.meta.last_row_id);
    const res = await app.request(`/api/personnel/bodycam-videos/${otherId}/thumbnail`, {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run test to verify it fails first (before Task 4 is in place, or re-verify now)**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/bodycamThumbnail.test.ts`
Expected (if run before Task 4): FAIL with a 404/undefined route. Since Task 4 is already implemented at this point in the plan, this step instead confirms the test PASSES — run it and confirm all assertions succeed.

- [ ] **Step 4: Run full worker test suite**

Run: `npx vitest run --config vitest.workers.config.mts`
Expected: all tests pass (existing + the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add test-workers/entry.ts test-workers/bodycamThumbnail.test.ts
git commit -m "test(bodycam): cover thumbnail upload/fetch endpoints"
```

---

### Task 6: Server — DELETE /:id also removes thumbnail/redacted R2 objects

Today's DELETE handler only removes `row.file_path`, leaving `thumbnail.jpg`/`redacted.mp4` orphaned in R2 once they exist.

**Files:**
- Modify: `src/routes/personnel/bodyCameras.ts:632-666` (DELETE /:id handler)

- [ ] **Step 1: Update the SELECT and cleanup block**

Find:

```ts
    const row = await queryFirst<{ id: number; file_path: string | null; retention_status: string | null; classification: string | null; case_number: string | null }>(
      db,
      'SELECT id, file_path, retention_status, classification, case_number FROM bodycam_videos WHERE id = ?',
      id,
    );
```

Replace with:

```ts
    await ensureBodycamArtifactColumns(db);
    const row = await queryFirst<{ id: number; file_path: string | null; thumbnail_path: string | null; redacted_path: string | null; retention_status: string | null; classification: string | null; case_number: string | null }>(
      db,
      'SELECT id, file_path, thumbnail_path, redacted_path, retention_status, classification, case_number FROM bodycam_videos WHERE id = ?',
      id,
    );
```

Then find:

```ts
    // Storage failure must not block the metadata delete.
    if (row.file_path && (c.env as { UPLOADS?: R2Bucket }).UPLOADS) {
      try { await (c.env as { UPLOADS: R2Bucket }).UPLOADS.delete(row.file_path); }
      catch (e) { console.warn('bodycam R2 delete failed (non-fatal):', e); }
    }
```

Replace with:

```ts
    // Storage failure must not block the metadata delete. Remove every
    // artifact under this video's prefix (original + thumbnail + redacted).
    const uploads = (c.env as { UPLOADS?: R2Bucket }).UPLOADS;
    if (uploads) {
      for (const key of [row.file_path, row.thumbnail_path, row.redacted_path]) {
        if (!key) continue;
        try { await uploads.delete(key); }
        catch (e) { console.warn('bodycam R2 delete failed (non-fatal):', e); }
      }
    }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/personnel/bodyCameras.ts
git commit -m "fix(bodycam): DELETE also cleans up thumbnail + redacted R2 artifacts"
```

---

### Task 7: Server — redactions.ts accepts source_bodycam_video_id

**Files:**
- Modify: `src/routes/redactions.ts:1-30` (schema), `:60-80` (POST handler), `:83-90` (GET list)

- [ ] **Step 1: Add the column to `ensureSchema()`**

Find:

```ts
CREATE TABLE IF NOT EXISTS video_redactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_event_id INTEGER, r2_key TEXT NOT NULL,
    kinds TEXT, region_count INTEGER NOT NULL DEFAULT 0, style TEXT, regions_json TEXT,
    redacted_by INTEGER, status TEXT NOT NULL DEFAULT 'completed', requested_at TEXT,
    completed_at TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  for (const [name, type] of EXTRA_COLUMNS) {
```

Replace with:

```ts
CREATE TABLE IF NOT EXISTS video_redactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_event_id INTEGER, r2_key TEXT NOT NULL,
    kinds TEXT, region_count INTEGER NOT NULL DEFAULT 0, style TEXT, regions_json TEXT,
    redacted_by INTEGER, status TEXT NOT NULL DEFAULT 'completed', requested_at TEXT,
    completed_at TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const columnsWithBodycam: Array<[string, string]> = [...EXTRA_COLUMNS, ['source_bodycam_video_id', 'INTEGER']];
  for (const [name, type] of columnsWithBodycam) {
```

- [ ] **Step 2: Insert the new column in the POST handler**

Find:

```ts
    res = await execute(db,
      `INSERT INTO video_redactions
         (source_event_id, r2_key, kinds, region_count, style, regions_json, redacted_by,
          status, requested_at, completed_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, datetime('now'), ?)`,
      Number(meta.event_id) || null, r2Key, kinds, Number(meta.region_count) || 0,
      typeof meta.style === 'string' ? meta.style : null,
      typeof meta.regions_json === 'string' ? meta.regions_json : (meta.regions ? JSON.stringify(meta.regions) : null),
      userId, meta.requested_at ?? null, typeof meta.notes === 'string' ? meta.notes : null);
```

Replace with:

```ts
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
```

- [ ] **Step 3: Support filtering the list by bodycam video id**

Find:

```ts
redactions.get('/', async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureSchema(db);
  const eventId = c.req.query('event_id');
  const rows = eventId
    ? await query<any>(db, `SELECT id, source_event_id, r2_key, kinds, region_count, style, redacted_by, status, created_at FROM video_redactions WHERE source_event_id = ? ORDER BY id DESC LIMIT 100`, Number(eventId))
    : await query<any>(db, `SELECT id, source_event_id, r2_key, kinds, region_count, style, redacted_by, status, created_at FROM video_redactions ORDER BY id DESC LIMIT 100`);
  return c.json({ redactions: rows });
});
```

Replace with:

```ts
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
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/redactions.ts
git commit -m "feat(redactions): accept source_bodycam_video_id, mirror onto bodycam_videos.redacted_path"
```

---

### Task 8: Server test — redaction with source_bodycam_video_id

**Files:**
- Modify: `test-workers/redactions.test.ts`

- [ ] **Step 1: Add the failing test case**

Append to `test-workers/redactions.test.ts` (inside the existing `describe` block, as a sibling `it`):

```ts
  it('links a redaction to a bodycam video and mirrors redacted_path onto bodycam_videos', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await db.prepare(
      `INSERT INTO body_cameras (officer_id, camera_id, status, storage_capacity_gb) VALUES (1, 'TEST-CAM-2', 'assigned', 32)`
    ).run();
    const cam = await db.prepare(`SELECT id FROM body_cameras WHERE camera_id = 'TEST-CAM-2'`).first<{ id: number }>();
    const video = await db.prepare(
      `INSERT INTO bodycam_videos (camera_id, officer_id, title, file_path, file_size, mime_type, classification, uploaded_by)
       VALUES (?, 1, 'Redaction target', 'bodycam-videos/redact-uuid/original.mp4', 1024, 'video/mp4', 'routine', 'test-officer')`
    ).bind(cam!.id).run();
    const videoId = Number(video.meta.last_row_id);

    const fd = new FormData();
    fd.append('video', new Blob([new Uint8Array([0, 0, 0, 24])], { type: 'video/mp4' }), 'redacted.mp4');
    fd.append('metadata', JSON.stringify({ source_bodycam_video_id: videoId, kinds: ['face'], region_count: 1, style: 'blur' }));

    const res = await app.request('/api/redactions', { method: 'POST', body: fd }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: number; r2_key: string };

    const list = await app.request(`/api/redactions?bodycam_video_id=${videoId}`, {}, env as unknown as Record<string, unknown>);
    const listBody = await list.json() as { redactions: Array<{ id: number; source_bodycam_video_id: number }> };
    expect(listBody.redactions[0].source_bodycam_video_id).toBe(videoId);

    const updated = await db.prepare('SELECT redacted_path FROM bodycam_videos WHERE id = ?').bind(videoId).first<{ redacted_path: string }>();
    expect(updated?.redacted_path).toBe(body.r2_key);
  });
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/redactions.test.ts`
Expected: PASS (all 2 tests).

- [ ] **Step 3: Commit**

```bash
git add test-workers/redactions.test.ts
git commit -m "test(redactions): cover source_bodycam_video_id linkage"
```

---

### Task 9: Client — types + mapper for new fields

**Files:**
- Modify: `client/src/types/index.ts:1019-1041` (`BodyCamVideo` interface)
- Modify: `client/src/pages/personnel/utils/personnelMappers.ts:200-219` (`mapBodyCamVideo`)

- [ ] **Step 1: Add fields to the type**

In `client/src/types/index.ts`, find:

```ts
export interface BodyCamVideo {
  id: number;
  camera_id: number;
  officer_id: number;
  title: string;
  file_path: string;
  file_size: number;
  duration_seconds: number;
  mime_type: string;
  recorded_at: string;
  case_number?: string;
  classification: VideoClassification;
  retention_status: VideoRetention;
  overlay_status?: OverlayStatus;
  overlay_error?: string | null;
  interaction_type?: string;
  notes?: string;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  officer_name?: string;
  camera_serial?: string;
}
```

Replace with:

```ts
export interface BodyCamVideo {
  id: number;
  camera_id: number;
  officer_id: number;
  title: string;
  file_path: string;
  thumbnail_path?: string;
  redacted_path?: string;
  file_size: number;
  duration_seconds: number;
  mime_type: string;
  recorded_at: string;
  case_number?: string;
  classification: VideoClassification;
  retention_status: VideoRetention;
  overlay_status?: OverlayStatus;
  overlay_error?: string | null;
  interaction_type?: string;
  notes?: string;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  officer_name?: string;
  camera_serial?: string;
}
```

- [ ] **Step 2: Update the mapper**

In `client/src/pages/personnel/utils/personnelMappers.ts`, find:

```ts
    title: row.title || '',
    file_path: row.file_path || '',
    file_size: Number(row.file_size) || 0,
```

Replace with:

```ts
    title: row.title || '',
    file_path: row.file_path || '',
    thumbnail_path: row.thumbnail_path || undefined,
    redacted_path: row.redacted_path || undefined,
    file_size: Number(row.file_size) || 0,
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/types/index.ts client/src/pages/personnel/utils/personnelMappers.ts
git commit -m "feat(bodycam): add thumbnail_path/redacted_path to BodyCamVideo type + mapper"
```

---

### Task 10: Client — thumbnail capture util

**Files:**
- Create: `client/src/utils/videoThumbnail.ts`
- Test: `client/src/utils/__tests__/videoThumbnail.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/videoThumbnail.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { thumbnailFileName } from '../videoThumbnail';

describe('thumbnailFileName', () => {
  it('always returns thumb.jpg regardless of the source file name', () => {
    expect(thumbnailFileName('bodycam-clip.mov')).toBe('thumb.jpg');
    expect(thumbnailFileName('no-extension')).toBe('thumb.jpg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/videoThumbnail.test.ts`
Expected: FAIL with "Cannot find module '../videoThumbnail'".

- [ ] **Step 3: Write the implementation**

Create `client/src/utils/videoThumbnail.ts`:

```ts
// client/src/utils/videoThumbnail.ts
// Client-side thumbnail capture for body-cam uploads. No server transcoding —
// Workers can't run ffmpeg — so the browser grabs one frame via canvas after
// upload completes. Non-blocking: callers should treat a rejection as
// "no thumbnail" rather than an upload failure.

/** The fixed filename the upload endpoint expects for the multipart field. */
export function thumbnailFileName(_sourceFileName: string): string {
  return 'thumb.jpg';
}

/**
 * Load `file` into a hidden <video>, seek to ~1s (or 10% into very short
 * clips), and canvas-capture a JPEG frame. Resolves null if the browser
 * can't decode the file (unsupported codec, corrupt upload, etc.) — callers
 * must treat that as "skip the thumbnail", not an error.
 */
export async function captureVideoThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;

    const cleanup = () => { URL.revokeObjectURL(url); };
    const fail = () => { cleanup(); resolve(null); };

    video.onloadedmetadata = () => {
      const seekTo = Math.min(1, Math.max(0.1, video.duration * 0.1));
      video.currentTime = Number.isFinite(seekTo) ? seekTo : 0;
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        if (!ctx) return fail();
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => { cleanup(); resolve(blob); }, 'image/jpeg', 0.8);
      } catch {
        fail();
      }
    };
    video.onerror = fail;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/videoThumbnail.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/videoThumbnail.ts client/src/utils/__tests__/videoThumbnail.test.ts
git commit -m "feat(bodycam): add client-side video thumbnail capture util"
```

---

### Task 11: Client — wire thumbnail capture into VideoUploadModal

**Files:**
- Modify: `client/src/components/VideoUploadModal.tsx:1-11` (imports), `:225-233` (small-file success path), `:322-327` (chunked success path)

- [ ] **Step 1: Import the util and add an upload helper**

Find:

```ts
import React, { useState, useRef } from 'react';
import { Upload, X, Video, Loader2, XCircle, CheckCircle2, Zap, Radio } from 'lucide-react';
import type { BodyCamera, VideoClassification } from '../types';

import RichTextArea from './RichTextArea';
```

Replace with:

```ts
import React, { useState, useRef } from 'react';
import { Upload, X, Video, Loader2, XCircle, CheckCircle2, Zap, Radio } from 'lucide-react';
import type { BodyCamera, VideoClassification } from '../types';
import { captureVideoThumbnail } from '../utils/videoThumbnail';

import RichTextArea from './RichTextArea';
```

Then, immediately before `export default function VideoUploadModal(...)`, add:

```ts
// Fire-and-forget: capture + upload a thumbnail for the just-created video.
// Never blocks or fails the upload flow — a thrown/rejected promise here is
// swallowed, leaving the video usable with no thumbnail.
async function uploadThumbnailBestEffort(
  file: File, videoId: number, apiBase: string, getAuthHeaders: () => Record<string, string>,
): Promise<void> {
  try {
    const blob = await captureVideoThumbnail(file);
    if (!blob) return;
    const fd = new FormData();
    fd.append('thumbnail', blob, 'thumb.jpg');
    await fetch(`${apiBase}/personnel/bodycam-videos/${videoId}/thumbnail`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: fd,
    });
  } catch (e) {
    console.warn('[VideoUploadModal] thumbnail capture/upload failed (non-fatal):', e);
  }
}
```

- [ ] **Step 2: Trigger it from the small-file success path**

Find:

```ts
      xhr.onload = () => {
        activeXhrRef.current = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          setPhase('done');
          setTimeout(() => { reset(); onUploaded(); onClose(); }, 500);
        } else {
```

Replace with:

```ts
      xhr.onload = () => {
        activeXhrRef.current = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          setPhase('done');
          try {
            const created = JSON.parse(xhr.responseText) as { id?: number };
            if (created.id) void uploadThumbnailBestEffort(file, created.id, apiBase, getAuthHeaders);
          } catch { /* thumbnail is best-effort; a parse failure here must not block the modal closing */ }
          setTimeout(() => { reset(); onUploaded(); onClose(); }, 500);
        } else {
```

- [ ] **Step 3: Trigger it from the chunked-upload success path**

Find:

```ts
      await apiFetchJson('/personnel/bodycam-videos/upload-complete', {
        method: 'POST',
        body: JSON.stringify({
          uploadId,
          camera_id: cameraId,
          officer_id: resolvedOfficerId,
          title,
          duration_seconds: duration,
          recorded_at: recordedAt || undefined,
          case_number: caseNumber || undefined,
          classification,
          notes: notes || undefined,
        }),
      });

      setPhase('done');
```

Replace with:

```ts
      const completed = await apiFetchJson('/personnel/bodycam-videos/upload-complete', {
        method: 'POST',
        body: JSON.stringify({
          uploadId,
          camera_id: cameraId,
          officer_id: resolvedOfficerId,
          title,
          duration_seconds: duration,
          recorded_at: recordedAt || undefined,
          case_number: caseNumber || undefined,
          classification,
          notes: notes || undefined,
        }),
      });
      if (completed?.id) void uploadThumbnailBestEffort(file, completed.id, apiBase, getAuthHeaders);

      setPhase('done');
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/VideoUploadModal.tsx
git commit -m "feat(bodycam): capture + upload a thumbnail after successful video upload"
```

---

### Task 12: Client — render thumbnail in the video table

**Files:**
- Modify: `client/src/pages/personnel/tabs/BodyCameraTab.tsx:1-20` (imports), `:721-723` (title cell)

- [ ] **Step 1: Import authedImageUrl**

Find:

```ts
import PrintButton from '../../../components/PrintButton';
import ExportButton from '../../../components/ExportButton';
import RmpgLogo from '../../../components/RmpgLogo';
import ConfirmDialog from '../../../components/ConfirmDialog';
```

Replace with:

```ts
import PrintButton from '../../../components/PrintButton';
import ExportButton from '../../../components/ExportButton';
import RmpgLogo from '../../../components/RmpgLogo';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { authedImageUrl } from '../../../hooks/useApi';
```

- [ ] **Step 2: Render the thumbnail in the title cell**

Find:

```ts
                      <td>
                        <span className="text-xs text-rmpg-200 font-medium">{vid.title}</span>
                      </td>
```

Replace with:

```ts
                      <td>
                        <div className="flex items-center gap-2">
                          {vid.thumbnail_path ? (
                            <img
                              src={authedImageUrl(`/api/personnel/bodycam-videos/${vid.id}/thumbnail`)}
                              alt=""
                              className="w-8 h-[18px] object-cover flex-shrink-0 border border-rmpg-700"
                            />
                          ) : (
                            <Video className="w-4 h-[18px] text-rmpg-600 flex-shrink-0" aria-hidden="true" />
                          )}
                          <span className="text-xs text-rmpg-200 font-medium">{vid.title}</span>
                        </div>
                      </td>
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify in the dev browser**

Run: start the dev server (`npm run dev` for the Worker, `cd client && npm run dev` for Vite), open `/personnel` → Body Camera tab → Videos, upload a short test clip, and confirm a thumbnail appears in the row within a few seconds (or the fallback icon shows if capture fails).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/personnel/tabs/BodyCameraTab.tsx
git commit -m "feat(bodycam): show video thumbnail in the videos table"
```

---

### Task 13: Client — generalize RedactionStudio for a bodycam source

**Files:**
- Modify: `client/src/components/RedactionStudio.tsx:15-19` (props), `:76-79` (metadata payload)

- [ ] **Step 1: Add a `source` prop**

Find:

```ts
export default function RedactionStudio({ eventId, streamUrl, stampLines, onClose }: {
  eventId: number; streamUrl: string; stampLines: string[]; onClose: () => void;
}) {
```

Replace with:

```ts
export default function RedactionStudio({ eventId, streamUrl, stampLines, onClose, source = 'dashcam' }: {
  eventId: number; streamUrl: string; stampLines: string[]; onClose: () => void;
  /** Which custody-linkage field to populate: dashcam events (default) vs body-cam videos. */
  source?: 'dashcam' | 'bodycam';
}) {
```

- [ ] **Step 2: Send the right metadata field**

Find:

```ts
      fd.append('metadata', JSON.stringify({ event_id: eventId, kinds, region_count: regions.filter((r) => r.enabled).length, style, format: ext, regions: regions }));
```

Replace with:

```ts
      const sourceField = source === 'bodycam' ? { source_bodycam_video_id: eventId } : { event_id: eventId };
      fd.append('metadata', JSON.stringify({ ...sourceField, kinds, region_count: regions.filter((r) => r.enabled).length, style, format: ext, regions: regions }));
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (the `ForensicDashcamPlayer` call site still compiles since `source` defaults to `'dashcam'`).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/RedactionStudio.tsx
git commit -m "feat(redaction-studio): support a bodycam source, not just dashcam events"
```

---

### Task 14: Client — wire "Redact video" into BodyCamerasPage

**Files:**
- Modify: `client/src/pages/personnel/tabs/BodyCameraTab.tsx:8-12` (imports), `:282-292` (buildVideoMenu), props interface
- Modify: `client/src/pages/BodyCamerasPage.tsx:14-24` (imports), state, render

- [ ] **Step 1: Add a `ShieldOff` icon import and `onRedactVideo` prop in BodyCameraTab**

Find:

```ts
import {
  Video, Plus, Edit3, Trash2, AlertTriangle, Camera, Search, Play, HardDrive,
  Film, Shield, Clock, CheckSquare, Square, Upload, Loader2,
} from 'lucide-react';
```

Replace with:

```ts
import {
  Video, Plus, Edit3, Trash2, AlertTriangle, Camera, Search, Play, HardDrive,
  Film, Shield, ShieldOff, Clock, CheckSquare, Square, Upload, Loader2,
} from 'lucide-react';
```

Find the `Props` interface's `onPlayVideo` line:

```ts
  onPlayVideo?: (video: BodyCamVideo) => void;
  onDeleteVideo?: (videoId: number) => void;
```

Replace with:

```ts
  onPlayVideo?: (video: BodyCamVideo) => void;
  onRedactVideo?: (video: BodyCamVideo) => void;
  onDeleteVideo?: (videoId: number) => void;
```

Find the function's destructured props:

```ts
  onSelectOfficer, onPlayVideo, onDeleteVideo,
  onUploadVideo, canManage = true,
```

Replace with:

```ts
  onSelectOfficer, onPlayVideo, onRedactVideo, onDeleteVideo,
  onUploadVideo, canManage = true,
```

- [ ] **Step 2: Add the menu action**

Find:

```ts
  const buildVideoMenu = (vid: BodyCamVideo): ContextMenuItem[] => [
    ...(onPlayVideo ? [m.action('Play video', () => onPlayVideo(vid), { icon: <Play size={12} /> })] : []),
    ...(onSelectOfficer ? [m.action('Open officer', () => onSelectOfficer(String(vid.officer_id)), { icon: <Camera size={12} /> })] : []),
    m.separator(),
```

Replace with:

```ts
  const buildVideoMenu = (vid: BodyCamVideo): ContextMenuItem[] => [
    ...(onPlayVideo ? [m.action('Play video', () => onPlayVideo(vid), { icon: <Play size={12} /> })] : []),
    ...(canManage && onRedactVideo ? [m.action('Redact video', () => onRedactVideo(vid), { icon: <ShieldOff size={12} /> })] : []),
    ...(onSelectOfficer ? [m.action('Open officer', () => onSelectOfficer(String(vid.officer_id)), { icon: <Camera size={12} /> })] : []),
    m.separator(),
```

- [ ] **Step 3: Wire it up in BodyCamerasPage**

Find:

```ts
import BodyCameraTab from './personnel/tabs/BodyCameraTab';
import BodyCameraFormModal from './personnel/modals/BodyCameraFormModal';
```

Replace with:

```ts
import BodyCameraTab from './personnel/tabs/BodyCameraTab';
import BodyCameraFormModal from './personnel/modals/BodyCameraFormModal';
import RedactionStudio from '../components/RedactionStudio';
```

Find:

```ts
  const [playingVideo, setPlayingVideo] = useState<BodyCamVideo | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
```

Replace with:

```ts
  const [playingVideo, setPlayingVideo] = useState<BodyCamVideo | null>(null);
  const [redactingVideo, setRedactingVideo] = useState<BodyCamVideo | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
```

Find the `<BodyCameraTab ... onPlayVideo={setPlayingVideo}` line:

```ts
            onPlayVideo={setPlayingVideo}
            onDeleteVideo={handleVideoDelete}
```

Replace with:

```ts
            onPlayVideo={setPlayingVideo}
            onRedactVideo={canManage ? setRedactingVideo : undefined}
            onDeleteVideo={handleVideoDelete}
```

Find the closing `</VideoPlayer>` block's following markup (the `<DeleteRecordModal isOpen={cameraToDelete !== null}` block) and insert the RedactionStudio mount just before it:

```ts
      <DeleteRecordModal
        isOpen={cameraToDelete !== null}
```

Replace with:

```ts
      {redactingVideo && (
        <RedactionStudio
          eventId={redactingVideo.id}
          source="bodycam"
          streamUrl={`${window.location.origin}/api/personnel/bodycam-videos/${redactingVideo.id}/stream`}
          stampLines={[
            redactingVideo.title,
            redactingVideo.officer_name || '',
            redactingVideo.recorded_at ? parseTimestamp(redactingVideo.recorded_at).toLocaleString() : '',
          ].filter(Boolean)}
          onClose={() => { setRedactingVideo(null); refreshBodyCameras(); }}
        />
      )}

      <DeleteRecordModal
        isOpen={cameraToDelete !== null}
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify in the dev browser**

Right-click a video row → "Redact video" → confirm `RedactionStudio` opens with the video's stream, run a scan, render, and confirm the modal's export flow completes without error (per the project's "click through it in the browser" rule for UI changes).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/personnel/tabs/BodyCameraTab.tsx client/src/pages/BodyCamerasPage.tsx
git commit -m "feat(bodycam): wire Redact video into BodyCamerasPage via RedactionStudio"
```

---

### Task 15: Full verification pass

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Worker tests (Miniflare)**

Run: `npx vitest run --config vitest.workers.config.mts`
Expected: all pass.

- [ ] **Step 3: Node tests**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 4: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (or only the pre-existing unrelated errors noted in CLAUDE.md's session log — do not introduce new ones).

- [ ] **Step 5: Client tests**

Run: `cd client && npx vitest run`
Expected: all pass except the pre-existing unrelated failures documented in CLAUDE.md.

- [ ] **Step 6: Client build**

Run: `cd client && npx vite build`
Expected: succeeds.

- [ ] **Step 7: Apply the migration to live D1**

Run: `scripts/apply-migration.sh 0187_bodycam_video_artifacts.sql`

Then verify: `npx wrangler d1 execute rmpg-flex --remote --command "PRAGMA table_info(bodycam_videos)"` includes `thumbnail_path` and `redacted_path`; and `npx wrangler d1 execute rmpg-flex --remote --command "PRAGMA table_info(video_redactions)"` includes `source_bodycam_video_id`.
