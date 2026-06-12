# Intel Wave 3b — In-App Interaction Audio Recording (web)

**Date:** 2026-06-12 · **Status:** Approved · **Builds on:** UPLOADS R2 bucket, usePanicAudio MediaRecorder pattern

## Goal

Let an officer record a full interaction from inside the web app, resilient to
reloads/crashes, with audio chunk-streamed to R2 so nothing is lost. Honest
scope: this is the **web/PWA** recorder — it runs while the app/tab is open and
survives reloads; true *app-closed / screen-locked background* capture needs the
native iOS app and is a separate project (documented, not attempted here).

## Storage

- R2 `UPLOADS` bucket, prefix `interactions/<recordingId>/<seq>.webm` (opus).
- Migration 0102 `interaction_recordings`: id, officer_id, started_at, ended_at,
  duration_sec, chunk_count, mime, status ('recording'|'complete'|'aborted'),
  location_text, lat, lng, linked_fi_id, linked_call_id, notes, created_at.

## Components

### 1. API — `src/routes/intel.ts` (operational)

- `POST /recordings/start` `{location?,lat?,lng?,linked_fi_id?,linked_call_id?}`
  → inserts a 'recording' row, returns `{id, mime}`.
- `PUT /recordings/:id/chunk?seq=N` — raw audio body → R2
  `interactions/<id>/<N>.webm`; bumps chunk_count (max(seq+1)). Body cap 8 MB.
  Idempotent on seq (overwrite). 404 if recording not owned/not active.
- `POST /recordings/:id/stop` `{duration_sec}` → status 'complete', ended_at.
- `GET /recordings?limit=` — caller's recordings (+ supervisor sees all).
- `GET /recordings/:id` — metadata + ordered chunk seqs.
- `GET /recordings/:id/chunk/:seq` — streams one chunk from R2 (auth-gated,
  audio/webm) for playback.
- Pure helper `chunkKey(id, seq)` unit-tested.

### 2. Client recorder — `client/src/hooks/useInteractionRecorder.ts`

- `getUserMedia({audio})` + `MediaRecorder` (opus, 5 s `timeslice`).
- Each `ondataavailable` blob → immediate `PUT .../chunk?seq=N` (fire-and-
  forget with a small retry queue) so a crash loses at most the in-flight 5 s.
- Wake Lock API (best-effort) to keep the screen/page alive while recording.
- Persists `{id, seq, startedAt}` to localStorage; on mount, if an active
  recording exists, surfaces a "resume/finalize" prompt (the row stays
  'recording' until stopped).
- `start(meta)`, `stop()`, exposes `{recording, elapsed, chunksSent, error}`.

### 3. Page — `client/src/pages/InteractionRecorderPage.tsx` at `/intel/record`

- Big REC button (red pulsing while active), elapsed timer, chunk-sent counter,
  optional location (GPS autofill) + note fields.
- On stop: appears in a recordings list with inline `<audio>` playback that
  concatenates chunk URLs (sequential play via the chunk endpoints).
- Honest banner: "Recording runs while this screen is open. For capture with
  the app closed, use the native app (coming)." Nav entry beside Jail Records.

## Error handling

Chunk upload failures retry up to 3× then queue; the recording row is never
blocked by a failed chunk. Mic-permission denial shows a clear message. Missing
table (migration drift) → endpoints 500 with hint. Stop is best-effort — a
recording with chunks but no stop is still playable (chunk_count drives it).

## Testing

- Worker vitest: `chunkKey` + seq parsing/ordering helpers.
- Client vitest: recorder page render with mocked MediaRecorder + apiFetch
  (start → chunk → stop flow, hit the REC button, assert state).
- Migration 0102 — apply to live D1 post-merge. SW bump.

## Out of scope

App-closed / screen-locked background recording (native iOS project),
transcription, evidence-chain signing.
