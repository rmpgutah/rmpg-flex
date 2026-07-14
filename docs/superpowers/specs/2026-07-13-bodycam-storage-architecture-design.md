# Body Camera storage/config architecture — design spec

Date: 2026-07-13
Status: approved (pending user spec review)
Phase: 1 of the Body Camera advancement program (see "Program context" below)

## Program context

The Body Camera module (`BodyCamerasPage`, `src/routes/personnel/bodyCameras.ts` +
`bodyCameraUploads.ts`) already has camera CRUD, chunked R2 upload, evidence-lock,
chain-of-custody PDF export, live-sync, and deep-linking. The requested advancement
program is large, so it's split into sub-projects, each getting its own spec:

1. **Storage/config architecture** (this spec) — R2/D1 foundation for multiple
   video artifacts per recording.
2. Full video editor (trim/splice/multi-clip timeline + overlay burn-in + export).
3. Live fleet & status dashboard (battery/storage/recording state).
4. Auto-link footage to calls/incidents.
5. Redaction review/approval workflow.

Phases 2–5 build on this one and are out of scope here.

## Background / current state

- R2 (bucket `UPLOADS`, bound in `wrangler.toml`): a single flat key per video —
  `bodycam-videos/<uuid>` — holding only the original uploaded file. No thumbnail,
  no preview/proxy, no separate redacted variant.
- D1 `bodycam_videos` (17 cols, live, not near the 100-col cap, no dedicated
  migration file — it originated in `migrations/baseline/schema.sql`): tracks
  `file_path`, `file_size`, `duration_seconds`, `mime_type`, `classification`,
  `retention_status`, etc. No columns for a thumbnail, proxy, or redacted variant.
- `video_redactions` (migration `0121_video_redactions.sql`): chain-of-custody
  table for redacted exports, but keyed only to `source_event_id` (dashcam
  events) — body-cam videos have no way to attach a redaction record today.
- `RedactionStudio.tsx` + `src/routes/redactions.ts`: fully generic on
  `eventId`/`streamUrl` — reusable for BWC once the source column exists.

**Data-recovery check (done 2026-07-14):** confirmed via `wrangler d1 list` /
`wrangler r2 bucket list` / Cloudflare API that no legacy body-camera data exists
outside the live `rmpg-flex` D1 + `rmpg-flex-uploads` R2 bucket. The abandoned
`rmpg-flex-db` has zero camera/video tables. The unbound `rmpg-recordings` R2
bucket has zero objects. This phase is purely additive — no migration of old
data is needed.

## Goals

- Give each body-cam video a structured set of R2 artifacts (original, thumbnail,
  optional redacted export) instead of one flat file.
- Let a body-cam video attach a redaction custody record, reusing the existing
  `RedactionStudio` / `video_redactions` machinery instead of building a parallel
  system.
- Keep all changes additive and backward-compatible with the ~existing rows that
  only have `file_path` set.

## Non-goals (deferred to later phases)

- Proxy/preview transcode generation (needs ffmpeg.wasm work similar to
  `RedactionStudio`'s renderer — flagged as a fast-follow, not blocking).
- R2 storage-tiering / cold-archive movement (R2 has no native storage-class
  concept like S3 IA; `retention_status` already tracks lifecycle state at the
  DB level, which is sufficient for now).
- The editor UI, live dashboard, auto-link, and redaction review queue (phases 2–5).

## Design

### 1. R2 key layout

Replace the flat key with a structured prefix per video, keyed by the existing
video UUID (not by date/camera) because `bodycam_videos.file_path` is already
the lookup key used by the player, custody PDF, and deep-links — reordering
would require touching every consumer for no benefit:

```
bodycam-videos/{video_uuid}/original.<ext>
bodycam-videos/{video_uuid}/thumbnail.jpg
bodycam-videos/{video_uuid}/redacted.mp4      (only if a redaction was rendered)
```

Existing rows keep their current flat `file_path` untouched. New rows continue
to be created via the existing single-shot and chunked-upload endpoints in
`bodyCameraUploads.ts`, changed only to write into the new `{uuid}/original.<ext>`
prefix instead of a bare `{uuid}` key.

### 2. D1 changes

`bodycam_videos` migration (new file, next free integer prefix — check
`migrations/README.md` for current high-water before naming):

```sql
ALTER TABLE bodycam_videos ADD COLUMN thumbnail_path TEXT;
ALTER TABLE bodycam_videos ADD COLUMN redacted_path TEXT;
```

`video_redactions` migration: add a nullable sibling FK so one custody table
serves both dashcam and body-cam sources:

```sql
ALTER TABLE video_redactions ADD COLUMN source_bodycam_video_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_video_redactions_bodycam
  ON video_redactions (source_bodycam_video_id);
```

Both tables already use the `columnExists()` runtime-reconcile pattern
(`src/routes/redactions.ts`, and `bodyCameras.ts` should adopt the same helper
for `thumbnail_path`/`redacted_path`), so missing columns self-heal at request
time even if the migration-apply step is skipped on deploy (per the
`continue-on-error` deploy gotcha in CLAUDE.md). The migration file is still
required and must be applied directly to live D1 after merge, per the standard
`scripts/apply-migration.sh` flow.

### 3. Thumbnail generation

No server-side transcoding — Workers can't run ffmpeg. After an upload
completes, the client captures a single JPEG frame:

- `VideoUploadModal` (or a follow-up effect on `BodyCamerasPage`) seeks a
  hidden `<video>` element to ~1s into the just-uploaded clip, canvas-captures
  a frame, and POSTs it as a JPEG blob to a new endpoint:
  `POST /personnel/bodycam-videos/:id/thumbnail` (multipart, `WRITE_ROLES`
  gated like other mutations in `bodyCameras.ts`).
- The route stores the JPEG at `bodycam-videos/{uuid}/thumbnail.jpg` in
  `UPLOADS` and sets `thumbnail_path` on the row.
- `BodyCameraTab`'s video list/grid renders `thumbnail_path` when present,
  falling back to the current generic video icon when absent (covers all
  pre-existing rows with no thumbnail).

### 4. Redaction wiring

- `src/routes/redactions.ts` POST handler accepts an optional
  `source_bodycam_video_id` in the `metadata` JSON payload alongside the
  existing `source_event_id`, writes it into the new column, and — when
  present — also updates the corresponding `bodycam_videos` row's
  `redacted_path` and bumps `classification` if it's still `unclassified`.
- `RedactionStudio.tsx` itself needs no changes: it's already generic on
  `eventId`/`streamUrl`; the body-cam call site just passes the video's id and
  its authenticated stream URL (`/personnel/bodycam-videos/:id/stream`) instead
  of a dashcam event id.
- Failure mode: if the `bodycam_videos` update fails after the redaction row
  and R2 object are written, the custody row is not rolled back (matches the
  existing dashcam behavior — the custody record is the source of truth; a
  best-effort log line records the desync for manual follow-up). This is
  explicitly a "custody record must not silently disappear" choice, consistent
  with how `redactions.ts` already treats the dashcam path.

### 5. Backward compatibility / rollout

- All new columns are nullable; existing rows behave exactly as today (no
  thumbnail shown, no redacted variant, `file_path` still resolves the
  original).
- No backfill job — thumbnails only get generated for newly uploaded videos.
  Backfilling thumbnails for existing footage is out of scope (could be a
  cheap follow-up: a manual "generate thumbnail" button per row, not built now).

## Testing

- Server: extend `tests/` (or the Miniflare `test-workers/` suite if a route
  test fits better) to cover the new `/thumbnail` endpoint (auth-gated,
  writes both R2 object and D1 column) and the redaction route's new
  `source_bodycam_video_id` branch.
- Client: no new automated test required beyond existing patterns — verify
  manually via the dev server (upload a clip, confirm a thumbnail appears;
  run a redaction and confirm `redacted_path` populates) per the project's
  "start dev server and click through it" rule for UI changes.
