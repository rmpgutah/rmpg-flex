# Dashcam Redaction Studio — Design Spec

**Date:** 2026-06-15
**Status:** Approved (design) — pending spec review → implementation plan
**Area:** Dashcam AI / Forensic Playback (client-heavy + one Worker route)

## Problem

Police agencies must release dashcam footage for discovery / FOIA / public
disclosure, but first have to **redact personally-identifying information** —
bystander faces, license plates, and other sensitive regions. RMPG Flex today has
a forensic dashcam player (`ForensicDashcamPlayer`) that detects vehicles, plates,
and people, and a body-cam **redaction-workflow tracking** model
(`client/src/utils/bodyCamera.ts` → `BWVRedaction`), but **no actual pixel
redaction**: no way to blur regions and produce a disclosable video file. This
feature builds the real in-video redaction engine.

## Approved decisions

| Decision | Choice |
|---|---|
| Encode engine / output | **ffmpeg.wasm → MP4** (court-grade, frame-accurate; lazy-loaded from CDN like COCO-SSD) |
| Region source | **Auto-detect (plates + faces + people) + manual draw/adjust** |
| Faces | **Add a face model** (BlazeFace via the tfjs runtime COCO-SSD already loads) |
| Output | **Download + stored disclosure copy in R2 + chain-of-custody record** |

## Architecture

A new **Redaction Studio** modal, launched from the forensic player (a `REDACT`
toolbar button). All redaction happens **in the browser**: canvas applies the
blur per frame; ffmpeg.wasm encodes the redacted frames + original audio to MP4.
The Worker only stores the finished file and a custody record — no video bytes
flow through the Worker (consistent with the existing on-demand-stream design).

**Pipeline:**

```
scan clip (COCO-SSD + BlazeFace)  →  RedactionRegion[]
        →  operator edits (toggle/keep/delete/resize/draw, style, strength)
        →  render redacted frames (canvas: seek → draw → blur active regions → burn stamp)
        →  encode MP4 (ffmpeg.wasm: frames + original audio)
        →  upload to R2 (redactions/) + video_redactions custody row + audit log
        →  download to operator
```

## Components (each isolated, single-purpose, testable)

### Client — pure logic (unit-tested)
- **`client/src/utils/redaction/regions.ts`** — the brain.
  - Type `RedactionRegion = { id: string; kind: 'plate'|'face'|'person'|'manual'; box: NormBox /* x,y,w,h in 0..1 */; tStart: number; tEnd: number; style: 'blur'|'pixelate'|'box'; strength: number; source: 'auto'|'manual'; enabled: boolean }`.
  - `activeRegionsAt(regions, tSec): RedactionRegion[]` — regions whose `[tStart,tEnd]` covers `t` and `enabled`.
  - `mergeSamples(samples): RedactionRegion[]` — group temporally-consecutive, spatially-overlapping detector samples of the same kind into ONE region that carries **keyframed boxes** (`Array<{ t, box }>`), with `tStart`/`tEnd` spanning the group. A lone sample becomes a 1-keyframe region padded by the scan interval. (Single, explicit model — no per-sample-span fallback.)
  - `interpBox(region, t): NormBox` — linearly interpolate between the region's surrounding keyframe boxes at `t` (clamps to the nearest keyframe outside the span).
  - `normBox`/`denormBox` helpers (fractional ↔ natural px).
- **`client/src/utils/redaction/blur.ts`** — canvas region effects.
  - `pixelate(rgba, w, h, block)` — **pure** mosaic pixel math (unit-tested).
  - `applyRegionEffect(ctx, box, style, strength)` — gaussian (`ctx.filter='blur()'`), pixelate (via the pure core), or solid box. Canvas raster part not jsdom-tested.

### Client — I/O (browser-only, not jsdom-testable)
- **`client/src/utils/redaction/detectFaces.ts`** — lazy BlazeFace loader + `detectFaces(model, video): NormBox[]`. Reuses the **same tfjs runtime** `aiVehicleTracking.ts` already loads (no second engine). Degrades to "no faces" on load failure.
- **`client/src/utils/redaction/scanClip.ts`** — `scanClip(video, { onProgress })`: seek the clip at a fixed cadence (~4 samples/sec), run COCO-SSD (plates via `plateRegion`, people) + BlazeFace (faces), feed samples to `mergeSamples` → `RedactionRegion[]`.
- **`client/src/utils/redaction/renderRedacted.ts`** — `renderRedacted(video, regions, opts, { onProgress }): Promise<Blob>`. For each output frame: seek → draw → `activeRegionsAt` → `applyRegionEffect` per region → burn `evidenceStampLines`. Then **lazy-load ffmpeg.wasm from CDN** and encode the frame sequence + original audio → MP4 `Blob`. Never throws into the UI without a clear error.

### Client — UI
- **`client/src/components/RedactionStudio.tsx`** — modal editor:
  - Video + region overlay (SVG boxes, color-coded by kind).
  - Category toggles: "blur all plates / all faces / all people".
  - Manual: draw a box, set its time range, resize/delete; pick style + strength.
  - Timeline strip showing each region's span.
  - **Export** button → `renderRedacted` with a progress bar → upload + download.
  - Launched from a new `REDACT` button in `ForensicDashcamPlayer`'s toolbar (passes `eventId`, stream URL, `nat` dims).

### Worker
- **`src/routes/redactions.ts`** (mounted `/api/redactions`, auth required):
  - `POST /` — multipart (`video` MP4 + `metadata` JSON: event_id, region kinds + count, source clip ref). Store MP4 to R2 `UPLOADS` under `redactions/<uuid>.mp4`; insert `video_redactions` row; return id + download path. Best-effort, never 500 on a storage hiccup.
  - `GET /?event_id=` — list custody records for an event.
  - `GET /:id/download` — stream the redacted MP4 from R2.
  - Runtime column reconciliation via `columnExists` (established pattern).
- **`migrations/0121_video_redactions.sql`** (or next free prefix) — `video_redactions` table:
  `id, source_event_id, r2_key, kinds (csv), region_count, style, redacted_by, status, requested_at, completed_at, notes`. Idempotent DDL; **apply to live D1 `785de7ae` after merge** (deploy apply is `continue-on-error`).
- Custody record shape aligns with `bodyCamera.ts` `BWVRedaction` (kinds ∈ face|license_plate|screen|minor|confidential, requestedBy, status, timestamps).

## Data flow & evidence integrity

- **Burned-in stamp** on every output frame (reuse `evidenceStampLines` from `tacticalForensics.ts`).
- **Audit**: `logAudit('forensic_redaction_export', '<n> regions, kinds …')` (existing `/api/driving-events/audit-log` hook).
- **Custody**: a `video_redactions` row records what was redacted, by whom, when, and the R2 key — the retained disclosure artifact.
- **Optional sidecar**: the `RedactionRegion[]` JSON stored alongside (in `notes` or a `regions_json` column) so a redaction can be re-opened/verified later (Phase 2 uses it).

## Testing

- **Unit (vitest, client):** `regions.ts` (`activeRegionsAt`, `interpBox`, `mergeSamples`), `blur.ts` `pixelate` math.
- **Worker route smoke test** reusing the Miniflare harness added in #1283 (`test-workers/`): `POST /api/redactions` stores a row + returns an id; `GET /?event_id=` returns it.
- **Not testable in jsdom** (documented pattern): the seek/canvas/ffmpeg raster path — covered by the pure region/effect math + manual verification on a real clip.

## Scope

**MVP (this spec):** auto plate+face(+person) scan, manual add/adjust, gaussian/pixelate/box styles, MP4 export with original audio + burned stamp, R2 store + custody record + download.

**Deferred (Phase 2, explicitly out of scope):** audio bleep redaction; smoothed object tracking (vs per-sample boxes); re-open/edit a saved redaction; batch redaction jobs; a WebCodecs fast-path encoder.

## Risks & mitigations

- **Performance:** ffmpeg.wasm + per-frame seek is slow — a 20–40s clip may take a few minutes, plus a one-time ~25–30 MB wasm load. Mitigation: clips are short (the 40s capture cap), a clear progress bar, and "runs in your browser — keep this tab open" messaging. Cap export resolution/fps if needed.
- **Detector misses:** auto-detect won't catch every face/plate. Mitigation: manual draw/adjust is first-class, and category toggles let the operator over-redact (e.g. blur all people) when in doubt.
- **ffmpeg.wasm bundle:** lazy-load the core from CDN at use time (like COCO-SSD) so it never enters the main bundle.
- **Browser support:** Chrome-first (the desktop console). ffmpeg.wasm needs cross-origin isolation (SharedArrayBuffer) — verify the Pages `_headers` provide COOP/COEP, or use the single-threaded ffmpeg core that doesn't require it.

## Service worker

Client changes → bump `CACHE_NAME` in `client/public/sw.js` on the implementing PR.
