# Redaction Studio Detection Overhaul — Design

**Date:** 2026-07-14
**Status:** Approved for planning

## Problem

Live testing of Redaction Studio (bodycam video #10) surfaced two real defects in the
client-side auto-detect pass (`client/src/utils/redaction/scanClip.ts`):

1. **Missed faces.** Clearly visible faces in frame have no redaction region. BlazeFace
   (the face model) needs a fairly frontal, well-lit, unoccluded face to fire — angled or
   backlit faces in real bodycam footage often don't trigger it, with no fallback.
2. **Plate false-positive spam.** The region list showed a burst of near-duplicate `plate`
   entries within a fraction of a second (`378.4–378.6s`, `378.6–378.6s`, `378.6–378.9s`,
   `378.6–378.9s`...) in an indoor scene with no vehicles in frame — almost certainly the
   officer's phone screen misclassified as a vehicle by COCO-SSD's `lite_mobilenet_v2`
   base (the fastest, least-accurate variant), with a "plate" sub-box heuristically derived
   from the false vehicle box. `mergeSamples()` already does temporal+IoU region merging,
   but a handheld phone shakes/rotates enough between the 0.25s-interval samples that
   consecutive boxes drop below the 0.2 IoU merge threshold, so each blip becomes its own
   short-lived single-keyframe region instead of collapsing into one.

## Approach

Hybrid: keep the free, instant client-side scan as the default pass, but fix its two real
bugs. Add an opt-in, on-demand server-side "Deep Scan" using the same Workers AI
vision-language model already integrated for the AI Findings feature
(`@cf/meta/llama-3.2-11b-vision-instruct`), for a higher-accuracy pass a reviewer can
trigger when the fast pass isn't good enough.

Two other approaches were considered and rejected as the primary fix:
- **Tune the client-side pipeline only** — cheaper, but plate boxes stay a heuristic guess
  (COCO-SSD has no actual license-plate class), and face recall is permanently capped by
  BlazeFace's known weaknesses on non-frontal/low-light faces.
- **Replace the client-side pass entirely with the vision-LLM** — most accurate, but
  LLM-derived bounding boxes are less precise than purpose-built detectors, and running it
  at redaction-grade density (every 1-2s vs. the Analyze feature's 8s) means real per-video
  cost and multi-minute runs for every clip, even ones the cheap pass would have handled
  fine.

## Part 1 — Fast-pass fixes (client-side, free)

**Files:** `client/src/utils/aiVehicleTracking.ts`, `client/src/utils/redaction/regions.ts`,
`client/src/utils/redaction/scanClip.ts`

1. Swap COCO-SSD's model base from `lite_mobilenet_v2` to `mobilenet_v2` (full accuracy
   variant). Runs against an already-loaded clip during an explicit scan action, not a live
   camera feed, so the extra inference latency is acceptable. This directly reduces the rate
   of vehicle misclassification (phone-as-car) that seeds the false "plate" regions.
2. Add a **noise filter** to `mergeSamples()`'s output: drop any resulting region that has
   both (a) exactly 1 keyframe and (b) a duration (`tEnd - tStart`) below a threshold
   (default 0.4s — configurable via `MergeOpts`). A genuine plate/vehicle/face persists
   across multiple 0.25s samples; a single-sample blip is noise regardless of which detector
   produced it. This is the direct fix for the duplicate-burst spam, since the root cause is
   erratic motion breaking the IoU merge chain into many 1-keyframe fragments, not a missing
   merge step.
3. No change to BlazeFace itself — its recall ceiling is inherent to the model. That
   ceiling is what Part 2 exists to address.

## Part 2 — Deep Scan (server-side, opt-in, paid)

**Files:**
- Create: `src/utils/redactionDeepScan.ts` (pure aggregation, mirrors
  `src/utils/bodycamAiAnalysis.ts`'s shape/testing approach)
- Modify: `src/routes/personnel/bodyCameraUploads.ts` (new `POST /:id/deep-scan` route)
- Create: `client/src/utils/videoDeepScan.ts` (client frame sampler, mirrors
  `client/src/utils/videoAiAnalyze.ts`)
- Modify: `client/src/components/RedactionStudio.tsx` (new "Deep Scan" button + progress +
  region merge-in)

### Server route

- `POST /personnel/bodycam-videos/:id/deep-scan` — auth/role-gated identically to
  `/:id/analyze` (`getActor` + `WRITE_ROLES`).
- Accepts the same multipart shape as `/:id/analyze` (`frame` blobs + `timestamps` JSON
  array), reusing that route's already-reviewed guardrails: per-frame byte cap
  (`MAX_FRAME_BYTES`), a frame-count cap (`DEEP_SCAN_MAX_FRAMES`, default 30 — sized for
  ~60s of footage at the client's 2s sampling interval; longer clips are scanned in
  multiple Deep Scan calls over sub-ranges, not one unbounded call), and the same
  distinction between "AI failed for all frames" (502, nothing persisted) vs. "analyzed
  cleanly, nothing found" (200, empty result) that `/:id/analyze` already implements.
- Prompt asks the vision model specifically for **face and plate bounding boxes** per frame
  (normalized 0–1 `[x, y, w, h]` per detection, plus a confidence score each) — not general
  scene findings like `/analyze`. Confidence is clamped to `[0, 1]` the same way
  `/:id/analyze` already clamps its confidence fields.
- Response shape: `{ success: true, frames_analyzed, frames_requested, samples:
  DetectorSample[] }` where `DetectorSample` matches the client's existing
  `redaction/regions.ts` shape (`{ kind: 'face' | 'plate', box: NormBox, t: number }`) —
  no new region model on the server; it emits exactly what the client's `mergeSamples()`
  already knows how to consume.
- Does NOT write anything to `bodycam_videos` — Deep Scan results flow directly into the
  Redaction Studio's in-memory region list (same as the fast pass), and only get persisted
  when the user explicitly saves/exports, exactly like manually-added regions today.

### Client

- `client/src/utils/videoDeepScan.ts`: samples frames from the Redaction Studio's
  already-loaded `<video>` element (same technique as `videoAiAnalyze.ts` — seek + canvas
  capture, restore playback position after), at a 2-second interval, capped at 30 frames.
  If the user has a specific time range selected in the studio, sample only within that
  range (keeps a long clip affordable and fast); otherwise sample from the current playhead
  forward up to the frame cap.
- `RedactionStudio.tsx`: a "Deep Scan" button next to "Auto-detect plates + faces", with
  the same progress-indicator pattern as the AI Findings button (frame N of M, disabled
  while running, error surfaced on total failure). On success, the returned
  `DetectorSample[]` gets fed through the SAME `mergeSamples()` call the fast pass uses,
  and the resulting regions are appended to the studio's region list with
  `source: 'deep-scan'`.
- `regions.ts`: extend `RedactionRegion['source']` from `'auto' | 'manual'` to
  `'auto' | 'manual' | 'deep-scan'`, and give Deep Scan regions a distinct visual treatment
  in the region list (e.g. a small badge) so a reviewer can tell which pass produced which
  region — this does not change `mergeSamples()`'s merge logic itself, since fast-pass and
  deep-scan samples are merged in separate calls (deep-scan samples aren't retroactively
  merged with existing fast-pass regions; both sets of regions coexist and can each be
  individually deleted/edited).

## Explicit scope boundary

Deep Scan is a face/plate bounding-box detector only — it does not do object detection
beyond faces and plates, does not do the weapon/vehicle/scene/officer-safety analysis that
the separate `/analyze` route (AI Findings) already covers, and does not touch that route's
existing deception/voice-stress/anxiety-analysis exclusion (unrelated feature, same
exclusion still applies there, not relevant here since Deep Scan doesn't do behavioral
analysis at all).

## Testing

- Fast-pass fixes: unit tests on `mergeSamples()`'s new noise filter — a single-keyframe,
  short-duration region gets dropped; a multi-keyframe region of the same duration does
  not; a single-keyframe region at/above the duration threshold does not (tests the
  boundary, not just clear-cut cases).
- Deep Scan aggregation (`redactionDeepScan.ts`): pure function, unit-tested the same way
  `bodycamAiAnalysis.ts` was — parsing/validating per-frame model output into
  `DetectorSample[]`, confidence clamping, box validation (drop detections with
  out-of-range or degenerate normalized coordinates rather than passing them through).
- Route: no Miniflare `ai` binding available in this codebase's test setup, so no automated
  test for `POST /:id/deep-scan` — same documented exception as `/:id/analyze` and
  `/:id/transcribe`. Verified via manual browser click-through instead.
