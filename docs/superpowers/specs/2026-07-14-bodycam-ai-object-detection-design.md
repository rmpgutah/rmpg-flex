# Body Camera: AI Object Detection & Identification — design spec

Date: 2026-07-14
Status: approved (pending user spec review)
Phase: 1 of the Body Camera Video Editor program (trim/splice/overlay editing
phases follow this one — see "Program context" below)

## Program context

Following the storage-architecture and edit-modal/auto-detection phases
(both shipped), the user asked for a "full scale video editor" with 7
sub-phases: trim, splice, text/annotation overlays, AI object
detection/identification, speed control, audio enhancement, export
presets. This spec covers phase 1 (AI object detection/identification),
chosen to go first. The trim/splice/overlay editing phases will follow as
separate specs building on a shared render pipeline.

## Background

The existing client-side detection (`scanClip()`, BlazeFace + COCO-SSD,
used by `RedactionStudio` and the auto-scan-on-upload flow from the prior
phase) is a fixed-vocabulary detector: it can find faces, plates, and
COCO's ~80 everyday-object classes (person, car, dog, etc.) — no weapon
class exists in that dataset, and it can't classify what's *happening* in
a scene.

**Model research (2026-07-14):** checked Cloudflare's Workers AI catalog
for a purpose-built alternative. `@cf/facebook/detr-resnet-50` (COCO
object detection) exists and is cheap, but COCO has no weapon category —
it would be functionally redundant with the client-side detector already
running for vehicles/people. Open-vocabulary classification (weapon
presence, scene type, force indicators) needs a vision-language model,
not a fixed-class detector. `@cf/meta/llama-3.2-11b-vision-instruct` is
already used in production for this exact call shape (OCR/document
extraction in `src/utils/visionExtract.ts`'s `extractVisionWorkersAI()`)
— reused as-is, new prompt only.

## Explicit scope boundary (do not build)

**Deception detection, voice stress analysis, and "anxiety analysis" are
out of scope and will not be built in this or any future phase**, in any
framing (including probabilistic/confidence-scored framing). These are
not established forms of measurement with quantifiable uncertainty —
there is no real underlying signal for a confidence score to describe.
Presenting a fabricated number as if it reflects measured probability is
not more defensible than presenting it as fact; it adds false
scientific credibility to a claim with no evidentiary basis. Courts
broadly exclude this class of evidence (similar standing to polygraph
results) and the scientific community does not regard it as reliable.
Building it would create real bias and liability exposure for the
company with no corresponding benefit. If this is requested again in a
future session, the same reasoning applies — it is not a scope question
to be re-litigated per-request.

## Goals

Detect and surface, per uploaded video, as **review aids only** (never
automated determinations, never affecting classification/retention/any
downstream action):
1. Weapon presence (firearm/knife/other) with confidence + approximate
   timestamp range.
2. Vehicle presence + best-effort description (type/color/notable
   features) — supplements the existing plate-only detection.
3. Scene/activity classification (e.g. "traffic stop," "foot pursuit,"
   "interview," "physical struggle") for faster review triage.
4. Use-of-force escalation indicators — flags physical-struggle-looking
   moments, framed strictly as "review this timestamp," never as a
   determination of fault or force appropriateness.
5. Officer-safety indicators (weapon draw, running, struggle) — same
   review-aid framing.

All five surface with a confidence score and are visually/textually
labeled "Potential — review required" everywhere they're displayed. None
of them ever auto-change `classification`, `retention_status`, or any
other field, and none trigger notifications/actions on their own.

## Non-goals

- Deception detection / voice stress analysis / anxiety analysis (see
  scope boundary above — permanently out of scope, not deferred).
- Automatic/always-on analysis on every upload. This calls a paid model
  per sampled frame — cost scales with usage in a way the existing free
  client-side detectors don't. Runs on-demand via an operator-triggered
  "Analyze" action, not automatically after upload (unlike thumbnail
  capture, face/plate scan, and transcription, which are all automatic).
- Real-time/every-frame analysis. Frame sampling only (below).
- Any UI/workflow that lets a reviewer act on a flag without watching
  the actual footage at that timestamp — findings link to a timestamp,
  they don't replace watching the video.

## Design

### 1. Frame sampling (client-side)

Reuse the same hidden-`<video>` + canvas-frame-capture technique already
used by `captureVideoThumbnail`/`runAutoDetection` (established pattern,
including their reviewed-and-fixed timeout-guard lesson — apply the same
`settled`/`cleanup`/timeout structure here). Sample one frame every 8
seconds (configurable constant), capped at 20 frames total for very long
clips (a multi-hour clip only gets its first ~2.5 hours analyzed at this
rate — acceptable for an MVP triage tool; a "analyze more" follow-up is
out of scope for this phase). Each frame is JPEG-encoded at a bounded
resolution (long edge ≤ 960px, matching the OCR path's `MAX_VISION_BYTES`
cap after compression) to keep per-request payload and token cost down.

### 2. Server route

`POST /:id/analyze` (WRITE_ROLES-gated, mirrors the `/:id/detections` and
`/:id/transcribe` routes' auth/validation shape). Accepts multipart with
one or more `frame` fields (each JPEG) plus a `timestamps` JSON array
(seconds into the clip, same order as the frames) so results can be
mapped back to timeline positions.

For each frame, calls `env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {...})`
with a structured prompt requesting strict JSON output:
```json
{
  "weapon_present": boolean, "weapon_confidence": 0-1, "weapon_type": string | null,
  "vehicle_present": boolean, "vehicle_description": string | null,
  "scene_type": string | null,
  "force_indicators": boolean, "force_confidence": 0-1,
  "officer_safety_flags": string[]
}
```
Parsed via the existing `tryParseModelJson()` helper (already used by
`extractVisionWorkersAI`). A frame whose response fails to parse is
skipped (best-effort per-frame, not all-or-nothing for the whole video).

Frames are processed sequentially (not `Promise.all`) to stay within
Workers AI concurrent-request limits and avoid a burst that could hit
rate limits — this trades latency (a 20-frame analysis takes tens of
seconds) for reliability; the client shows a progress indicator, not a
blocking spinner.

Results are aggregated server-side into one row-level JSON blob:
```ts
interface AnalysisResult {
  analyzed_at: string; // ISO
  frame_count: number;
  weapon: { detected: boolean; max_confidence: number; timestamps: number[] } | null;
  vehicles: { description: string; timestamps: number[] }[];
  scene_types: { type: string; timestamps: number[] }[];
  force_indicators: { timestamps: number[]; max_confidence: number } | null;
  officer_safety_flags: { flag: string; timestamp: number }[];
}
```
Stored as `bodycam_videos.ai_analysis_json TEXT` (new nullable,
self-healing column, same pattern as `detection_regions_json`).

### 3. Client UI

An "Analyze" button (admin/manager only) in the video player toolbar,
next to the existing Edit/Redact actions — NOT automatic. Shows a
progress bar (frame N of M) since this can take tens of seconds. On
completion, a findings panel appears below the player (collapsible,
similar visual weight to the transcript block from the prior phase):
each finding shows its type, confidence badge, "Potential — review
required" label, and a clickable timestamp that seeks the player to that
moment. No finding is ever rendered as a bare fact — the confidence
badge and review-required label are mandatory parts of every finding's
markup, not optional styling.

### 4. Error handling / rollout

- New column is nullable and self-healing (same `ensureBodycamArtifactColumns`-style
  reconcile as prior columns).
- A frame that fails to analyze (model error, malformed JSON) is
  silently skipped — the aggregate result reflects however many frames
  succeeded; the UI shows "N of M frames analyzed" so a partial result
  is visible, not hidden.
- No retry, no backfill for existing videos (consistent with the prior
  phase's thumbnail/detection precedent) — analysis only runs when an
  operator explicitly triggers it for a given video, any time after
  upload.
- Cost visibility: log the frame count + estimated token cost per
  analysis call (structured logger, `log.info`) so usage is
  observable — this is the first bodycam feature with a non-trivial
  per-use cost, worth tracking from day one.

## Testing

- Server: Miniflare route test for `POST /:id/analyze` mirroring the
  established pattern for AI-backed routes in this module — since
  `vitest.workers.config.mts` has no `ai` binding (same constraint noted
  in the transcription phase's spec), this is verified via manual
  browser click-through, not an automated Miniflare test. Do not attempt
  to add Workers AI mocking as part of this phase.
- Server: a pure-function unit test IS feasible and required for the
  aggregation logic (`AnalysisResult` building from per-frame results) —
  extract that into a standalone function testable with Node's vitest
  suite (`tests/`, not `test-workers/`) by feeding it a fixed array of
  mock per-frame JSON results and asserting the aggregate shape.
- Client: no automated test for the frame-sampling capture logic
  (consistent with why `captureVideoThumbnail`/`runAutoDetection` aren't
  unit-tested — real browser media APIs aren't meaningfully mockable in
  jsdom). Manual verification: trigger "Analyze" on a clip with a
  visible vehicle, confirm the findings panel shows a vehicle finding
  with a clickable timestamp that seeks correctly.
