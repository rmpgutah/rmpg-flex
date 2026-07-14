# Body Camera: video editing + auto plate/face detection + auto-transcription — design spec

Date: 2026-07-14
Status: approved (pending user spec review)
Phase: 2 of the Body Camera advancement program (follows the storage/config
architecture spec, `2026-07-13-bodycam-storage-architecture-design.md`)

## Background

Two of the three pieces below reuse existing, working code:

- `client/src/components/BodyCamVideoEditModal.tsx` is a fully built 238-line
  modal (title, case #, interaction type, classification, retention, notes,
  recorded_at) that is never imported anywhere outside itself — dead code.
  `interaction_type` isn't a real column on `bodycam_videos` anywhere in the
  schema.
- `client/src/utils/redaction/scanClip.ts` (BlazeFace faces + COCO-SSD
  vehicle/plate boxes, both lazy CDN-loaded client-side) already runs inside
  `RedactionStudio` on manual "Scan" click.
- `transcribeTransmission(ai, audioBytes, opts)` in `src/utils/aiDispatcher.ts`
  already wraps `@cf/openai/whisper-large-v3-turbo` for radio transmissions —
  reused as-is for video audio.

## Goals

1. Let admin/manager edit a video's metadata after upload (title, case
   number, interaction type, classification, retention, notes, recorded
   time) via the existing modal, wired to a real save path.
2. Automatically scan every newly uploaded clip for faces/plates so an
   officer is warned before sharing unredacted footage, and so opening
   Redaction Studio later doesn't require re-scanning.
3. Automatically transcribe the audio track of every newly uploaded clip so
   footage becomes searchable by what was said.

## Non-goals

- Feeding auto-detected plates into the ALPR/vehicle-sightings pipeline —
  that requires OCR'd plate text via the separate Roboflow workflow
  (`/api/alpr`), a different system with its own capture flow. This spec's
  detection is bounding-box-only (same as Redaction Studio's scan), used
  purely as a "heads up, redact before sharing" signal.
- Transcript search UI (a search box across transcripts) — storing the
  transcript and showing it on the video is in scope; a dedicated search
  surface is a fast-follow, not blocking this phase.
- Any change to the manual Redaction Studio scan flow itself, beyond it
  being able to load pre-existing regions instead of re-scanning.

## Design

### 1. Wire up the video edit modal

- **D1**: add `interaction_type TEXT` to `bodycam_videos` (nullable,
  self-healing via the existing `ensureBodycamArtifactColumns`-style
  runtime reconcile — extend that helper or add a sibling one).
- **Server**: extend the `PUT /:id` handler's `editable` column list in
  `src/routes/personnel/bodyCameras.ts` to include `interaction_type`.
- **Client**: import `BodyCamVideoEditModal` into `BodyCamerasPage.tsx`,
  add an `editingVideo` state (same pattern as `redactingVideo`), add an
  "Edit video" context-menu action in `BodyCameraTab.tsx` (admin/manager
  only, alongside "Redact video"), wire `onSave` to `PUT
  /personnel/bodycam-videos/:id` with the six editable fields plus
  `interaction_type`, refresh the list on success. Add to the page's
  Esc-cascade like `redactingVideo` was.

### 2. Auto plate/face detection on upload

- **D1**: add `detected_plate_count INTEGER`, `detected_face_count
  INTEGER`, `detection_regions_json TEXT` to `bodycam_videos` (all
  nullable/self-healing).
- **Client**: after a video finishes uploading (same call sites as the
  Task-11 thumbnail capture in `VideoUploadModal.tsx`), fire-and-forget
  call `scanClip()` against the just-uploaded file (via a hidden `<video>`
  element, same technique `captureVideoThumbnail` already uses), then POST
  the resulting regions to a new `POST /:id/detections` endpoint. This
  reuses the SAME lazy CDN model loaders `RedactionStudio` already
  triggers, so a video uploaded from a page that never opened Redaction
  Studio still pays the model-load cost once, cached module-side
  (`modelPromise` singletons in `detectFaces.ts`/`aiVehicleTracking.ts`
  already handle this — no new caching needed).
- **Server**: `POST /:id/detections` (WRITE_ROLES-gated) stores
  `region_count`-derived `detected_plate_count`/`detected_face_count` and
  the full `regions_json`, and — only if either count is `> 0` and the
  video's `classification` is still `'routine'` (the default) — bumps
  classification to `'flagged'`. Never downgrades an already-set
  classification.
- **Redaction Studio integration**: `RedactionStudio.tsx` accepts an
  optional `initialRegions` prop; when present, "Scan" pre-populates from
  it instead of running `scanClip()` again (the operator can still
  re-scan manually via the existing "Scan" button if they want a fresh
  pass). `BodyCamerasPage.tsx` passes `redactingVideo.detection_regions_json`
  (parsed) as `initialRegions` when opening the studio for a bodycam video.
- **UX**: no blocking UI during the scan — it runs silently in the
  background like the thumbnail capture. When it finishes and finds
  something, `VideoUploadModal`'s existing toast-on-close isn't a fit
  (the scan finishes after the modal is already closed), so instead the
  video row in `BodyCameraTab.tsx`'s table shows a small badge (e.g. a
  `ShieldOff`-icon count) when `detected_plate_count +
  detected_face_count > 0`, giving the operator a persistent visual cue
  rather than a toast that could be missed.

### 3. Auto-transcription

- **D1**: add `transcript TEXT` to `bodycam_videos` (nullable,
  self-healing).
- **Client**: after upload completes, fire-and-forget extract the audio
  track: create a hidden `<video>`, call `.captureStream()`, build a new
  `MediaStream` containing only the audio track(s), feed it into a
  `MediaRecorder` (`audio/webm;codecs=opus`), record for the clip's full
  duration (play the hidden video muted-to-speaker-but-still-captured —
  actually: mute the *output* via `video.muted = true`'s inverse isn't
  needed since `captureStream()` taps the decoded track directly,
  independent of whether the element is audibly playing), stop, and POST
  the resulting blob to a new `POST /:id/transcribe` endpoint.
- **Server**: `POST /:id/transcribe` (WRITE_ROLES-gated) reads the
  multipart audio blob into a `Uint8Array`, calls the existing
  `transcribeTransmission(c.env.AI, audioBytes)`, stores the result in
  `bodycam_videos.transcript`. A `null` result (Whisper failure) is
  stored as-is (leaves `transcript` unset) — no retry, matches the
  existing radio-transcription failure contract ("best-effort, never
  throw into the caller").
- **UX**: transcript shown in `VideoPlayer.tsx` as an optional
  collapsible text block below the player when `video.transcript` is
  set; nothing rendered when absent (covers both "not yet transcribed"
  and "transcription failed" — no separate error state needed for this
  phase).

### Error handling / rollout

- All three new columns are nullable and self-healing (same
  `columnExists()`-based reconcile pattern used throughout this module) —
  existing rows are unaffected.
- Both new client-side background jobs (detection scan, audio
  transcription) run independently of each other and of the thumbnail
  capture — one failing never blocks or is blocked by another. All three
  are fire-and-forget with `console.warn`-only failure handling,
  consistent with the existing thumbnail-capture precedent from the
  storage-architecture phase.
- No backfill for existing videos — detection/transcription only run for
  newly uploaded clips from this point forward. A manual "run detection" /
  "transcribe" button on existing rows is a reasonable fast-follow but is
  out of scope here (mirrors the storage-architecture spec's decision to
  not backfill thumbnails).

## Testing

- Server: Miniflare route tests for `PUT /:id` with `interaction_type`,
  `POST /:id/detections` (stores counts/regions, bumps classification only
  from `'routine'`), and `POST /:id/transcribe` (stores transcript on a
  mocked/stubbed `env.AI.run` response — Workers AI itself isn't
  meaningfully testable in Miniflare, so the test should verify the route
  correctly calls `transcribeTransmission` and persists whatever it
  returns, not the model's actual accuracy).
- Client: no new automated tests for the CDN-loaded detection/transcription
  paths (consistent with why `captureVideoThumbnail`'s core logic isn't
  unit-tested — real browser media APIs aren't meaningfully mockable in
  jsdom). Manual verification via the dev browser: upload a clip with a
  face in frame, confirm the badge appears and Redaction Studio opens
  pre-populated; upload a clip with audio, confirm a transcript appears in
  the player.
