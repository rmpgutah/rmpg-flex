# Body Camera: Video Editing + Auto Detection + Auto-Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins edit uploaded video metadata via the already-built (but disconnected) edit modal, automatically scan every new clip for faces/plates as a redact-before-sharing signal, and automatically transcribe clip audio via the existing Whisper integration.

**Architecture:** Five new nullable, self-healing columns on `bodycam_videos` (`interaction_type`, `detected_plate_count`, `detected_face_count`, `detection_regions_json`, `transcript`). The video edit modal (`BodyCamVideoEditModal.tsx`) gets wired to `VideoPlayer.tsx`'s existing (currently unused) `onEditVideo` prop and to the existing `PUT /:id` route. Detection and transcription both run as fire-and-forget client-side jobs after upload — same pattern as the existing thumbnail capture — posting to two new routes (`POST /:id/detections`, `POST /:id/transcribe`) that reuse existing engines (`scanClip()` for detection, `transcribeTransmission()` for Whisper).

**Tech Stack:** Hono routes on Cloudflare Workers, D1, Workers AI (`@cf/openai/whisper-large-v3-turbo` via existing `transcribeTransmission()`), client-side TF.js (BlazeFace + COCO-SSD, already lazy-loaded for Redaction Studio), Web Audio/MediaRecorder for client-side audio extraction, React + TypeScript.

**Spec:** [`docs/superpowers/specs/2026-07-14-bodycam-edit-and-ai-detection-design.md`](../specs/2026-07-14-bodycam-edit-and-ai-detection-design.md)

---

### Task 1: D1 migration — new columns

**Files:**
- Create: `migrations/0188_bodycam_ai_fields.sql`
- Modify: `src/routes/personnel/bodyCameras.ts:40-51` (extend `ensureBodycamArtifactColumns`)

- [ ] **Step 1: Write the migration**

```sql
-- 0188_bodycam_ai_fields.sql — video-edit + AI-detection/transcription
-- columns for bodycam_videos. Idempotent; the route also reconciles these
-- columns at runtime via columnExists() because deploy migration-apply is
-- continue-on-error. APPLY DIRECTLY TO LIVE D1 785de7ae AFTER MERGE.

ALTER TABLE bodycam_videos ADD COLUMN interaction_type TEXT;
ALTER TABLE bodycam_videos ADD COLUMN detected_plate_count INTEGER;
ALTER TABLE bodycam_videos ADD COLUMN detected_face_count INTEGER;
ALTER TABLE bodycam_videos ADD COLUMN detection_regions_json TEXT;
ALTER TABLE bodycam_videos ADD COLUMN transcript TEXT;
```

- [ ] **Step 2: Extend the runtime column-reconcile helper**

In `src/routes/personnel/bodyCameras.ts`, find:

```ts
let _bodycamArtifactColumnsEnsured = false;
async function ensureBodycamArtifactColumns(db: ReturnType<typeof getDb>): Promise<void> {
  if (_bodycamArtifactColumnsEnsured) return;
  for (const [name, type] of [['thumbnail_path', 'TEXT'], ['redacted_path', 'TEXT']] as const) {
```

Replace with:

```ts
let _bodycamArtifactColumnsEnsured = false;
async function ensureBodycamArtifactColumns(db: ReturnType<typeof getDb>): Promise<void> {
  if (_bodycamArtifactColumnsEnsured) return;
  for (const [name, type] of [
    ['thumbnail_path', 'TEXT'], ['redacted_path', 'TEXT'],
    ['interaction_type', 'TEXT'], ['detected_plate_count', 'INTEGER'],
    ['detected_face_count', 'INTEGER'], ['detection_regions_json', 'TEXT'],
    ['transcript', 'TEXT'],
  ] as const) {
```

- [ ] **Step 3: Apply locally**

Run: `npm run migrate:local` — this repo has a known pre-existing, unrelated local-D1 drift issue (`duplicate column name: cost_per_gallon`, documented in migrations/README.md) that blocks a from-scratch replay. If it fails with that specific error, verify the migration's SQL correctness instead via a scratch SQLite db built from `migrations/baseline/schema.sql`'s `bodycam_videos` definition + this file, confirming via `PRAGMA table_info` that all 5 columns land with correct types. Do not spend time trying to fix the pre-existing drift issue — it's out of scope.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck` — expect no errors.

- [ ] **Step 5: Commit**

```bash
git add migrations/0188_bodycam_ai_fields.sql src/routes/personnel/bodyCameras.ts
git commit -m "feat(bodycam): add D1 columns for interaction_type, detection, transcript"
```

---

### Task 2: Server — PUT /:id accepts interaction_type, mapper maps it

**Files:**
- Modify: `src/routes/personnel/bodyCameras.ts:619-640` (`PUT /:id` handler)
- Modify: `client/src/pages/personnel/utils/personnelMappers.ts:200-222` (`mapBodyCamVideo`)

- [ ] **Step 1: Extend the editable-column list**

In `src/routes/personnel/bodyCameras.ts`, inside the `bodycamVideosRouter.put('/:id', ...)` handler, find:

```ts
    const editable = ['title', 'case_number', 'classification', 'retention_status', 'notes', 'recorded_at'];
```

Replace with:

```ts
    const editable = ['title', 'case_number', 'classification', 'retention_status', 'notes', 'recorded_at', 'interaction_type'];
```

Also add `await ensureBodycamArtifactColumns(db);` right after the `const db = getDb(c.env);` line in this same handler (it's not currently called there — only in the thumbnail POST and DELETE handlers from the prior phase), so the column is guaranteed to exist before the UPDATE runs even on a cold isolate that's never served those other routes.

- [ ] **Step 2: Map `interaction_type` in the client mapper**

In `client/src/pages/personnel/utils/personnelMappers.ts`, in `mapBodyCamVideo`, find:

```ts
    notes: row.notes || '',
    uploaded_by: row.uploaded_by || '',
```

Replace with:

```ts
    notes: row.notes || '',
    interaction_type: row.interaction_type || undefined,
    uploaded_by: row.uploaded_by || '',
```

(`interaction_type?: string` already exists on the `BodyCamVideo` type — no type change needed, it was just never populated by the mapper.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` and `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/personnel/bodyCameras.ts client/src/pages/personnel/utils/personnelMappers.ts
git commit -m "feat(bodycam): PUT /:id accepts interaction_type; map it on the client"
```

---

### Task 3: Server test — PUT /:id with interaction_type

**Files:**
- Create: `test-workers/bodycamVideoEdit.test.ts`

- [ ] **Step 1: Write the test**

```ts
// test-workers/bodycamVideoEdit.test.ts
// Miniflare route smoke test for PUT /api/personnel/bodycam-videos/:id
// covering the interaction_type field added alongside the video edit modal.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';

async function createTestVideo(): Promise<number> {
  const db = (env as unknown as { DB: D1Database }).DB;
  await db.prepare(
    `INSERT INTO body_cameras (officer_id, camera_id, status, storage_capacity_gb) VALUES (1, 'TEST-CAM-EDIT', 'assigned', 32)`
  ).run();
  const cam = await db.prepare(`SELECT id FROM body_cameras WHERE camera_id = 'TEST-CAM-EDIT'`).first<{ id: number }>();
  const video = await db.prepare(
    `INSERT INTO bodycam_videos (camera_id, officer_id, title, file_path, file_size, mime_type, classification, uploaded_by)
     VALUES (?, 1, 'Edit target', 'bodycam-videos/edit-uuid/original.mp4', 1024, 'video/mp4', 'routine', 'test-officer')`
  ).bind(cam!.id).run();
  return Number(video.meta.last_row_id);
}

describe('PUT /api/personnel/bodycam-videos/:id — interaction_type', () => {
  let videoId: number;
  beforeAll(async () => { videoId = await createTestVideo(); });

  it('updates interaction_type alongside the existing editable fields', async () => {
    const res = await app.request(`/api/personnel/bodycam-videos/${videoId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interaction_type: 'traffic_stop', title: 'Updated title' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { interaction_type: string; title: string };
    expect(body.interaction_type).toBe('traffic_stop');
    expect(body.title).toBe('Updated title');
  });
});
```

IMPORTANT: `test-workers/entry.ts` already mounts `bodycamVideosRouter` (from Task 5 of the prior storage-architecture plan) — no entry.ts changes needed here. Check the actual current `test-workers/entry.ts` and `test-workers/bodycamThumbnail.test.ts` first to confirm the `body_cameras`/`bodycam_videos` table columns used above match reality (they were established in that prior plan's Task 5).

- [ ] **Step 2: Run the test**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/bodycamVideoEdit.test.ts` — expect PASS.

- [ ] **Step 3: Run the full worker suite**

Run: `npx vitest run --config vitest.workers.config.mts` — expect no new failures beyond the 2 pre-existing unrelated ones (`dispatchCallClose.test.ts`, `panicSafetyFixes.test.ts`).

- [ ] **Step 4: Commit**

```bash
git add test-workers/bodycamVideoEdit.test.ts
git commit -m "test(bodycam): cover PUT /:id interaction_type"
```

---

### Task 4: Client — wire the video edit modal into BodyCamerasPage

**Files:**
- Modify: `client/src/pages/BodyCamerasPage.tsx` (imports, state, `<VideoPlayer>` prop, mount modal, Esc-cascade)

- [ ] **Step 1: Import the modal**

Find:

```ts
import BodyCameraFormModal from './personnel/modals/BodyCameraFormModal';
import RedactionStudio from '../components/RedactionStudio';
```

Replace with:

```ts
import BodyCameraFormModal from './personnel/modals/BodyCameraFormModal';
import RedactionStudio from '../components/RedactionStudio';
import BodyCamVideoEditModal, { type BodyCamVideoEditData } from '../components/BodyCamVideoEditModal';
```

- [ ] **Step 2: Add `editingVideo` state**

Find:

```ts
  const [redactingVideo, setRedactingVideo] = useState<BodyCamVideo | null>(null);
```

Replace with:

```ts
  const [redactingVideo, setRedactingVideo] = useState<BodyCamVideo | null>(null);
  const [editingVideo, setEditingVideo] = useState<BodyCamVideo | null>(null);
```

- [ ] **Step 3: Wire `onEditVideo` on the existing `<VideoPlayer>`**

Find the `<VideoPlayer ... onClassify={...}` block (search for `<VideoPlayer` — it currently does NOT pass `onEditVideo`, so `VideoPlayer.tsx`'s built-in Edit button is hidden). Add `onEditVideo={canManage ? setEditingVideo : undefined}` as a prop on that element, e.g.:

```tsx
      <VideoPlayer
        isOpen={!!playingVideo}
        onClose={() => setPlayingVideo(null)}
        video={playingVideo}
        apiBase={window.location.origin + '/api'}
        onEditVideo={canManage ? setEditingVideo : undefined}
        preparedBy={user
```

(Keep every other existing prop on `<VideoPlayer>` exactly as-is — only add the one new prop line.)

- [ ] **Step 4: Add the save handler + mount the modal**

Add this handler near `refreshBodyCameras`/`handleSubmit` (e.g. right after `refreshBodyCameras`):

```ts
  const handleVideoEditSave = async (videoId: number, data: BodyCamVideoEditData) => {
    await apiFetch(`/personnel/bodycam-videos/${videoId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    await refreshBodyCameras();
    addToast('Video details saved', 'success');
  };
```

Mount the modal — find:

```tsx
      {redactingVideo && (
        <RedactionStudio
```

Insert immediately before it:

```tsx
      <BodyCamVideoEditModal
        isOpen={editingVideo !== null}
        onClose={() => setEditingVideo(null)}
        video={editingVideo}
        onSave={handleVideoEditSave}
      />

      {redactingVideo && (
        <RedactionStudio
```

- [ ] **Step 5: Add `editingVideo` to the Esc-cascade**

Find:

```ts
        if (playingVideo) { setPlayingVideo(null); return; }
        // Cancel/dismiss only — do not refetch here (unlike the studio's own
        // onClose, which refreshes after a redaction commit). Esc is a fast
        // dismiss, not a save-and-refresh action.
        if (redactingVideo) { setRedactingVideo(null); return; }
```

Replace with:

```ts
        if (playingVideo) { setPlayingVideo(null); return; }
        // Cancel/dismiss only — do not refetch here (unlike the studio's own
        // onClose, which refreshes after a redaction commit). Esc is a fast
        // dismiss, not a save-and-refresh action.
        if (redactingVideo) { setRedactingVideo(null); return; }
        if (editingVideo) { if (isTypingInField(e.target)) return; setEditingVideo(null); return; }
```

Then find the two `useEffect` dependency arrays that list `cameraToDelete, videoToDelete, playingVideo, redactingVideo, modal, canManage` (there are two — the N-shortcut guard condition and the effect's own dependency array) and add `editingVideo` to both, e.g.:

```ts
        if (modal !== 'none' || cameraToDelete || videoToDelete || playingVideo || redactingVideo || editingVideo) return;
```

and

```ts
  }, [cameraToDelete, videoToDelete, playingVideo, redactingVideo, editingVideo, modal, canManage]);
```

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 7: Verify in the dev browser**

Start the dev server, open Body Cameras, play a video, click the Edit (pencil) icon in the player toolbar, confirm the modal opens pre-filled, change the title, save, confirm the toast fires and the new title shows in the table.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/BodyCamerasPage.tsx
git commit -m "feat(bodycam): wire the video edit modal into BodyCamerasPage"
```

---

### Task 5: Server — POST /:id/detections endpoint

**Files:**
- Modify: `src/routes/personnel/bodyCameraUploads.ts` (append new route)

- [ ] **Step 1: Add the route**

Append at the end of `src/routes/personnel/bodyCameraUploads.ts` (after the thumbnail routes from the prior phase):

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` — expect no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/personnel/bodyCameraUploads.ts
git commit -m "feat(bodycam): add POST /:id/detections to store auto-scan results"
```

---

### Task 6: Server test — POST /:id/detections

**Files:**
- Create: `test-workers/bodycamDetections.test.ts`

- [ ] **Step 1: Write the test**

```ts
// test-workers/bodycamDetections.test.ts
// Miniflare route smoke test for POST /api/personnel/bodycam-videos/:id/detections.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './entry';

async function createTestVideo(cameraSerial: string): Promise<number> {
  const db = (env as unknown as { DB: D1Database }).DB;
  await db.prepare(
    `INSERT INTO body_cameras (officer_id, camera_id, status, storage_capacity_gb) VALUES (1, ?, 'assigned', 32)`
  ).bind(cameraSerial).run();
  const cam = await db.prepare(`SELECT id FROM body_cameras WHERE camera_id = ?`).bind(cameraSerial).first<{ id: number }>();
  const video = await db.prepare(
    `INSERT INTO bodycam_videos (camera_id, officer_id, title, file_path, file_size, mime_type, classification, uploaded_by)
     VALUES (?, 1, 'Detection target', 'bodycam-videos/detect-uuid/original.mp4', 1024, 'video/mp4', 'routine', 'test-officer')`
  ).bind(cam!.id).run();
  return Number(video.meta.last_row_id);
}

describe('POST /api/personnel/bodycam-videos/:id/detections', () => {
  it('stores counts + regions and bumps classification to flagged when hits are found on a routine video', async () => {
    const videoId = await createTestVideo('TEST-CAM-DETECT-1');
    const res = await app.request(`/api/personnel/bodycam-videos/${videoId}/detections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ regions: [{ kind: 'plate' }, { kind: 'face' }, { kind: 'face' }] }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { detected_plate_count: number; detected_face_count: number; flagged: boolean };
    expect(body.detected_plate_count).toBe(1);
    expect(body.detected_face_count).toBe(2);
    expect(body.flagged).toBe(true);

    const db = (env as unknown as { DB: D1Database }).DB;
    const row = await db.prepare('SELECT classification, detection_regions_json FROM bodycam_videos WHERE id = ?').bind(videoId).first<{ classification: string; detection_regions_json: string }>();
    expect(row?.classification).toBe('flagged');
    expect(JSON.parse(row!.detection_regions_json)).toHaveLength(3);
  });

  it('does not downgrade an already-restricted video back to flagged-by-detection, but still stores counts', async () => {
    const videoId = await createTestVideo('TEST-CAM-DETECT-2');
    const db = (env as unknown as { DB: D1Database }).DB;
    await db.prepare("UPDATE bodycam_videos SET classification = 'restricted' WHERE id = ?").bind(videoId).run();

    const res = await app.request(`/api/personnel/bodycam-videos/${videoId}/detections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ regions: [{ kind: 'plate' }] }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { flagged: boolean };
    expect(body.flagged).toBe(false);

    const row = await db.prepare('SELECT classification, detected_plate_count FROM bodycam_videos WHERE id = ?').bind(videoId).first<{ classification: string; detected_plate_count: number }>();
    expect(row?.classification).toBe('restricted');
    expect(row?.detected_plate_count).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/bodycamDetections.test.ts` — expect PASS.

- [ ] **Step 3: Run the full worker suite**

Run: `npx vitest run --config vitest.workers.config.mts` — expect no new failures.

- [ ] **Step 4: Commit**

```bash
git add test-workers/bodycamDetections.test.ts
git commit -m "test(bodycam): cover POST /:id/detections"
```

---

### Task 7: Client — RedactionStudio accepts pre-scanned regions

**Files:**
- Modify: `client/src/components/RedactionStudio.tsx`

- [ ] **Step 1: Add an `initialRegions` prop**

Find:

```ts
export default function RedactionStudio({ eventId, streamUrl, stampLines, onClose, source = 'dashcam' }: {
  eventId: number; streamUrl: string; stampLines: string[]; onClose: () => void;
  /** Which custody-linkage field to populate: dashcam events (default) vs body-cam videos. */
  source?: 'dashcam' | 'bodycam';
}) {
```

Replace with:

```ts
export default function RedactionStudio({ eventId, streamUrl, stampLines, onClose, source = 'dashcam', initialRegions }: {
  eventId: number; streamUrl: string; stampLines: string[]; onClose: () => void;
  /** Which custody-linkage field to populate: dashcam events (default) vs body-cam videos. */
  source?: 'dashcam' | 'bodycam';
  /** Pre-scanned regions (e.g. from an automatic upload-time scan) to seed
   *  the editor with, skipping the initial manual "Scan" click. The operator
   *  can still click "Scan" to run a fresh pass, which replaces these. */
  initialRegions?: RedactionRegion[];
}) {
```

- [ ] **Step 2: Seed `regions` state from the prop on mount**

Find the state declarations block:

```ts
  const [regions, setRegions] = useState<RedactionRegion[]>([]);
```

Replace with:

```ts
  const [regions, setRegions] = useState<RedactionRegion[]>(initialRegions ?? []);
```

(A `useState` lazy-initializer isn't needed here — `initialRegions` is a prop passed once when the component mounts inside a `{redactingVideo && <RedactionStudio ... />}` conditional, so the component is freshly created each time it opens; a plain initial value read is correct and simpler than an effect.)

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors. `RedactionRegion` is already imported in this file from `'../utils/redaction/regions'` — no new import needed.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/RedactionStudio.tsx
git commit -m "feat(redaction-studio): accept pre-scanned initialRegions"
```

---

### Task 8: Client — auto-detection scan util + wiring into upload

**Files:**
- Create: `client/src/utils/videoAutoDetect.ts`
- Modify: `client/src/components/VideoUploadModal.tsx`
- Modify: `client/src/pages/BodyCamerasPage.tsx` (pass `initialRegions` to `RedactionStudio`)

- [ ] **Step 1: Write the detection util**

Create `client/src/utils/videoAutoDetect.ts`:

```ts
// client/src/utils/videoAutoDetect.ts
// Client-side auto face/plate scan for a just-uploaded body-cam video.
// Reuses the SAME scanClip() engine RedactionStudio's manual "Scan" button
// calls — same lazy-loaded BlazeFace + COCO-SSD models, same cached-promise
// singletons, so a video uploaded from a page that never opened Redaction
// Studio still only pays the model-load cost once per browser session.
// Non-blocking: callers must treat a rejection/null as "skip detection",
// not an upload failure — same contract as videoThumbnail.ts.
import { scanClip } from './redaction/scanClip';
import type { RedactionRegion } from './redaction/regions';

const DETECTION_TIMEOUT_MS = 30000; // model load + full-clip scan can be slow

/**
 * Load `file` into a hidden <video>, run scanClip() against it, and resolve
 * the found regions (or null on any failure/timeout). Always revokes the
 * object URL it creates.
 */
export async function runAutoDetection(file: File): Promise<RedactionRegion[] | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;

    let settled = false;
    const cleanup = () => { URL.revokeObjectURL(url); clearTimeout(timeoutId); };
    const finish = (result: RedactionRegion[] | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const timeoutId = setTimeout(() => finish(null), DETECTION_TIMEOUT_MS);

    video.onloadedmetadata = async () => {
      try {
        const regions = await scanClip(video, { intervalSec: 0.5, includePeople: false });
        finish(regions);
      } catch {
        finish(null);
      }
    };
    video.onerror = () => finish(null);
  });
}
```

- [ ] **Step 2: Add an upload helper + wire it in `VideoUploadModal.tsx`**

Find:

```ts
import { captureVideoThumbnail } from '../utils/videoThumbnail';
```

Replace with:

```ts
import { captureVideoThumbnail } from '../utils/videoThumbnail';
import { runAutoDetection } from '../utils/videoAutoDetect';
```

Find the `uploadThumbnailBestEffort` function and add a sibling right after it:

```ts
// Fire-and-forget: auto-scan the just-uploaded video for faces/plates and
// post the results. Never blocks or fails the upload flow.
async function uploadDetectionsBestEffort(
  file: File, videoId: number, apiBase: string, getAuthHeaders: () => Record<string, string>,
): Promise<void> {
  try {
    const regions = await runAutoDetection(file);
    if (!regions) return;
    await fetch(`${apiBase}/personnel/bodycam-videos/${videoId}/detections`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ regions }),
    });
  } catch (e) {
    console.warn('[VideoUploadModal] auto-detection scan/upload failed (non-fatal):', e);
  }
}
```

Find (small-file success path):

```ts
            if (created.id) void uploadThumbnailBestEffort(file, created.id, apiBase, getAuthHeaders);
```

Replace with:

```ts
            if (created.id) {
              void uploadThumbnailBestEffort(file, created.id, apiBase, getAuthHeaders);
              void uploadDetectionsBestEffort(file, created.id, apiBase, getAuthHeaders);
            }
```

Find (chunked-upload success path):

```ts
      if (completed?.id) void uploadThumbnailBestEffort(file, completed.id, apiBase, getAuthHeaders);
```

Replace with:

```ts
      if (completed?.id) {
        void uploadThumbnailBestEffort(file, completed.id, apiBase, getAuthHeaders);
        void uploadDetectionsBestEffort(file, completed.id, apiBase, getAuthHeaders);
      }
```

- [ ] **Step 3: Pass `initialRegions` when opening Redaction Studio for a bodycam video**

In `client/src/pages/BodyCamerasPage.tsx`, find the `<RedactionStudio` mount:

```tsx
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
```

Replace with:

```tsx
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
          initialRegions={(() => {
            const raw = (redactingVideo as any).detection_regions_json;
            if (!raw) return undefined;
            try { return JSON.parse(raw); } catch { return undefined; }
          })()}
          onClose={() => { setRedactingVideo(null); refreshBodyCameras(); }}
        />
      )}
```

This reads `detection_regions_json` as `any` because it's a raw server field not yet added to the `BodyCamVideo` client type (Task 9 adds it) — this step compiles fine either way since Task 9 lands before this is reviewed, but the inline IIFE with the `any` cast keeps this step independently correct regardless of task ordering during implementation.

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/videoAutoDetect.ts client/src/components/VideoUploadModal.tsx client/src/pages/BodyCamerasPage.tsx
git commit -m "feat(bodycam): auto-scan uploaded videos for faces/plates"
```

---

### Task 9: Client — detection fields on the type/mapper + table badge

**Files:**
- Modify: `client/src/types/index.ts` (`BodyCamVideo` interface)
- Modify: `client/src/pages/personnel/utils/personnelMappers.ts` (`mapBodyCamVideo`)
- Modify: `client/src/pages/personnel/tabs/BodyCameraTab.tsx` (table badge)

- [ ] **Step 1: Add fields to the type**

In `client/src/types/index.ts`, find:

```ts
  thumbnail_path?: string;
  redacted_path?: string;
```

Replace with:

```ts
  thumbnail_path?: string;
  redacted_path?: string;
  detected_plate_count?: number;
  detected_face_count?: number;
  detection_regions_json?: string;
  transcript?: string;
```

- [ ] **Step 2: Map the fields**

In `client/src/pages/personnel/utils/personnelMappers.ts`, in `mapBodyCamVideo`, find:

```ts
    thumbnail_path: row.thumbnail_path || undefined,
    redacted_path: row.redacted_path || undefined,
```

Replace with:

```ts
    thumbnail_path: row.thumbnail_path || undefined,
    redacted_path: row.redacted_path || undefined,
    detected_plate_count: row.detected_plate_count != null ? Number(row.detected_plate_count) : undefined,
    detected_face_count: row.detected_face_count != null ? Number(row.detected_face_count) : undefined,
    detection_regions_json: row.detection_regions_json || undefined,
    transcript: row.transcript || undefined,
```

- [ ] **Step 3: Remove the now-redundant `any` cast in BodyCamerasPage.tsx**

In `client/src/pages/BodyCamerasPage.tsx` (from Task 8, Step 3), find:

```ts
          initialRegions={(() => {
            const raw = (redactingVideo as any).detection_regions_json;
            if (!raw) return undefined;
            try { return JSON.parse(raw); } catch { return undefined; }
          })()}
```

Replace with:

```ts
          initialRegions={(() => {
            const raw = redactingVideo.detection_regions_json;
            if (!raw) return undefined;
            try { return JSON.parse(raw); } catch { return undefined; }
          })()}
```

- [ ] **Step 4: Add a detection badge to the video table**

In `client/src/pages/personnel/tabs/BodyCameraTab.tsx`, find the title cell's closing `<span>`:

```tsx
                          <span className="text-xs text-rmpg-200 font-medium">{vid.title}</span>
                        </div>
                      </td>
```

Replace with:

```tsx
                          <span className="text-xs text-rmpg-200 font-medium">{vid.title}</span>
                          {((vid.detected_plate_count || 0) + (vid.detected_face_count || 0)) > 0 && (
                            <span
                              className="flex items-center gap-0.5 text-[9px] font-mono text-amber-400 flex-shrink-0"
                              title={`${vid.detected_plate_count || 0} plate(s), ${vid.detected_face_count || 0} face(s) detected`}
                            >
                              <ShieldOff className="w-2.5 h-2.5" aria-hidden="true" />
                              {(vid.detected_plate_count || 0) + (vid.detected_face_count || 0)}
                            </span>
                          )}
                        </div>
                      </td>
```

(`ShieldOff` is already imported in this file from Task 14 of the prior storage-architecture plan — no new import needed.)

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 6: Verify in the dev browser**

Upload a clip with a visible face or license plate, wait a few seconds, refresh the videos table, confirm the amber badge appears with the right count; right-click → Redact video and confirm the studio opens with regions already populated (no manual "Scan" click needed).

- [ ] **Step 7: Commit**

```bash
git add client/src/types/index.ts client/src/pages/personnel/utils/personnelMappers.ts client/src/pages/BodyCamerasPage.tsx client/src/pages/personnel/tabs/BodyCameraTab.tsx
git commit -m "feat(bodycam): surface detection counts on the client + table badge"
```

---

### Task 10: Server — POST /:id/transcribe endpoint

**Files:**
- Modify: `src/routes/personnel/bodyCameraUploads.ts` (append new route; add import)

- [ ] **Step 1: Add the import**

Find the top-of-file imports in `src/routes/personnel/bodyCameraUploads.ts`:

```ts
import { getDb, queryFirst, execute } from '../../utils/db';
import { verifySignedResource } from '../../utils/signedAccess';
```

Replace with:

```ts
import { getDb, queryFirst, execute } from '../../utils/db';
import { verifySignedResource } from '../../utils/signedAccess';
import { transcribeTransmission } from '../../utils/aiDispatcher';
```

- [ ] **Step 2: Add the route**

Append at the end of `src/routes/personnel/bodyCameraUploads.ts`:

```ts
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
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` — expect no errors. `transcribeTransmission`'s signature is `(ai: Ai, audio: Uint8Array, opts?: { initialPrompt?: string }) => Promise<string | null>` — confirm this matches by reading `src/utils/aiDispatcher.ts:379-383` before wiring, since the exact signature must match for typecheck to pass.

- [ ] **Step 4: No automated route test for this endpoint**

`vitest.workers.config.mts`'s Miniflare pool does not configure an `ai` binding (only `d1Databases`, `kvNamespaces`, `r2Buckets`), and no existing test in this repo mocks `c.env.AI.run(...)`. Rather than build new test infrastructure for this one endpoint, this route is verified via the manual browser check in Task 11 instead — consistent with how the client-side detection/thumbnail-capture logic in this codebase is verified (not unit tested, browser-checked). Do not attempt to add Miniflare AI mocking as part of this task.

- [ ] **Step 5: Commit**

```bash
git add src/routes/personnel/bodyCameraUploads.ts
git commit -m "feat(bodycam): add POST /:id/transcribe using the existing Whisper helper"
```

---

### Task 11: Client — audio extraction util + wiring + transcript display

**Files:**
- Create: `client/src/utils/videoTranscribe.ts`
- Modify: `client/src/components/VideoUploadModal.tsx`
- Modify: `client/src/components/VideoPlayer.tsx`

- [ ] **Step 1: Write the audio-extraction util**

Create `client/src/utils/videoTranscribe.ts`:

```ts
// client/src/utils/videoTranscribe.ts
// Client-side audio-track extraction for a just-uploaded body-cam video.
// No ffmpeg.wasm (this codebase already abandoned it — see the comment in
// renderRedacted.ts explaining why it can't load in a module worker) — this
// uses captureStream() + an audio-only MediaRecorder instead, the same
// browser-native technique the redaction renderer relies on. Non-blocking:
// callers must treat a rejection/null as "skip transcription".
const EXTRACT_TIMEOUT_MS = 60000; // generous — playback runs at real-time speed

/**
 * Load `file` into a hidden <video>, play it muted while recording ONLY its
 * audio track via MediaRecorder, and resolve the recorded blob (or null on
 * any failure/timeout/silent-clip). Always revokes the object URL it creates.
 */
export async function extractAudioBlob(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true; // mutes OUTPUT only — captureStream() still taps the decoded track
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;

    let settled = false;
    const cleanup = () => { URL.revokeObjectURL(url); clearTimeout(timeoutId); video.pause(); };
    const finish = (result: Blob | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const timeoutId = setTimeout(() => finish(null), EXTRACT_TIMEOUT_MS);

    video.onloadedmetadata = async () => {
      try {
        const stream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
        const audioTracks = stream?.getAudioTracks() ?? [];
        if (!stream || audioTracks.length === 0) { finish(null); return; }

        const audioOnlyStream = new MediaStream(audioTracks);
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(audioOnlyStream, { mimeType: 'audio/webm;codecs=opus' });
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => finish(chunks.length ? new Blob(chunks, { type: 'audio/webm' }) : null);
        recorder.onerror = () => finish(null);

        video.onended = () => { if (recorder.state !== 'inactive') recorder.stop(); };
        recorder.start();
        await video.play();
      } catch {
        finish(null);
      }
    };
    video.onerror = () => finish(null);
  });
}
```

- [ ] **Step 2: Add an upload helper + wire it in `VideoUploadModal.tsx`**

Find:

```ts
import { runAutoDetection } from '../utils/videoAutoDetect';
```

Replace with:

```ts
import { runAutoDetection } from '../utils/videoAutoDetect';
import { extractAudioBlob } from '../utils/videoTranscribe';
```

Find the `uploadDetectionsBestEffort` function and add a sibling right after it:

```ts
// Fire-and-forget: extract the just-uploaded video's audio and post it for
// transcription. Never blocks or fails the upload flow.
async function uploadTranscriptBestEffort(
  file: File, videoId: number, apiBase: string, getAuthHeaders: () => Record<string, string>,
): Promise<void> {
  try {
    const blob = await extractAudioBlob(file);
    if (!blob) return;
    const fd = new FormData();
    fd.append('audio', blob, 'audio.webm');
    await fetch(`${apiBase}/personnel/bodycam-videos/${videoId}/transcribe`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: fd,
    });
  } catch (e) {
    console.warn('[VideoUploadModal] audio extraction/transcription failed (non-fatal):', e);
  }
}
```

Find (small-file success path, after Task 8's edit):

```ts
            if (created.id) {
              void uploadThumbnailBestEffort(file, created.id, apiBase, getAuthHeaders);
              void uploadDetectionsBestEffort(file, created.id, apiBase, getAuthHeaders);
            }
```

Replace with:

```ts
            if (created.id) {
              void uploadThumbnailBestEffort(file, created.id, apiBase, getAuthHeaders);
              void uploadDetectionsBestEffort(file, created.id, apiBase, getAuthHeaders);
              void uploadTranscriptBestEffort(file, created.id, apiBase, getAuthHeaders);
            }
```

Find (chunked-upload success path, after Task 8's edit):

```ts
      if (completed?.id) {
        void uploadThumbnailBestEffort(file, completed.id, apiBase, getAuthHeaders);
        void uploadDetectionsBestEffort(file, completed.id, apiBase, getAuthHeaders);
      }
```

Replace with:

```ts
      if (completed?.id) {
        void uploadThumbnailBestEffort(file, completed.id, apiBase, getAuthHeaders);
        void uploadDetectionsBestEffort(file, completed.id, apiBase, getAuthHeaders);
        void uploadTranscriptBestEffort(file, completed.id, apiBase, getAuthHeaders);
      }
```

- [ ] **Step 3: Show the transcript in `VideoPlayer.tsx`**

Find the Compact Metadata Bar's closing structure:

```tsx
          {video.notes && (
            <p className="text-[9px] text-rmpg-500 italic mt-1 truncate">{video.notes}</p>
          )}
        </div>
      </div>
    </div>
  );
}
```

Replace with:

```tsx
          {video.notes && (
            <p className="text-[9px] text-rmpg-500 italic mt-1 truncate">{video.notes}</p>
          )}
        </div>

        {video.transcript && (
          <div className="px-3 py-2 bg-surface-deep border-t border-rmpg-800">
            <p className="text-[9px] font-mono text-rmpg-500 uppercase tracking-wide mb-1">Transcript</p>
            <p className="text-[10px] text-rmpg-300 leading-relaxed max-h-24 overflow-y-auto scrollbar-dark">{video.transcript}</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 5: Verify in the dev browser**

Upload a short clip with audible speech, wait ~10-20s (transcription is slower than thumbnail/detection), open the player for that video, confirm a "Transcript" section appears below the metadata bar with reasonable text. If Whisper genuinely can't produce a transcript in this environment (e.g. no real audio in a test clip), confirm instead that no error is thrown and the player renders normally without a transcript section — that's the correct "best-effort, silently absent" behavior.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/videoTranscribe.ts client/src/components/VideoUploadModal.tsx client/src/components/VideoPlayer.tsx
git commit -m "feat(bodycam): auto-transcribe uploaded video audio via Whisper"
```

---

### Task 12: Full verification pass

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck` — expect no errors.

- [ ] **Step 2: Worker tests (Miniflare)**

Run: `npx vitest run --config vitest.workers.config.mts` — expect all pass except the 2 pre-existing unrelated failures noted throughout this plan (`dispatchCallClose.test.ts`, `panicSafetyFixes.test.ts`).

- [ ] **Step 3: Node tests**

Run: `npx vitest run` — expect all pass.

- [ ] **Step 4: Client typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 5: Client tests**

Run: `cd client && npx vitest run` — expect all pass.

- [ ] **Step 6: Client build**

Run: `cd client && npx vite build` — expect success.

- [ ] **Step 7: Apply the migration to live D1**

Run: `scripts/apply-migration.sh 0188_bodycam_ai_fields.sql`

Then verify: `npx wrangler d1 execute rmpg-flex --remote --command "PRAGMA table_info(bodycam_videos)"` includes `interaction_type`, `detected_plate_count`, `detected_face_count`, `detection_regions_json`, `transcript`.

- [ ] **Step 8: End-to-end manual browser verification**

In a live browser session against the deployed app: upload a body-cam clip with a visible face/plate and audible speech. Confirm, within roughly a minute: (1) a thumbnail appears, (2) a detection badge appears if a face/plate was in frame and the video's classification flips to "flagged" if it was still "routine", (3) a transcript appears in the player if Whisper could produce one. Then open the video's Edit modal (pencil icon in the player), change the interaction type, save, and confirm it persists after a refresh.
