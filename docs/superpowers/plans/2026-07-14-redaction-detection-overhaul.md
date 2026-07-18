# Redaction Studio Detection Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two real bugs in Redaction Studio's free auto-detect pass (missed faces, duplicate plate false-positives), and add an opt-in server-side "Deep Scan" vision-LLM pass for higher-accuracy face/plate detection on demand.

**Architecture:** Part 1 fixes `client/src/utils/aiVehicleTracking.ts` (better COCO-SSD base model) and `client/src/utils/redaction/regions.ts` (`mergeSamples()` noise filter). Part 2 adds a new `POST /:id/deep-scan` route mirroring the already-built `/:id/analyze` route's guardrails (byte cap, frame cap, AI-failure-vs-empty-result distinction), a client frame sampler mirroring `videoAiAnalyze.ts`, and wires a "Deep Scan" button into `RedactionStudio.tsx` that feeds results through the existing `mergeSamples()` pipeline.

**Tech Stack:** Hono routes on Cloudflare Workers, D1, Workers AI vision-language model, React + TypeScript, TensorFlow.js (COCO-SSD + BlazeFace, client-side).

**Spec:** [`docs/superpowers/specs/2026-07-14-redaction-detection-overhaul-design.md`](../specs/2026-07-14-redaction-detection-overhaul-design.md)

---

### Task 1: Fast-pass fix — better vehicle-detector model base

**Files:**
- Modify: `client/src/utils/aiVehicleTracking.ts:33` (the `cocoSsd.load({ base: 'lite_mobilenet_v2' })` call)

- [ ] **Step 1: Swap the model base**

In `client/src/utils/aiVehicleTracking.ts`, find:

```ts
        return await cocoSsd.load({ base: 'lite_mobilenet_v2' });
```

Replace with:

```ts
        // mobilenet_v2 (full accuracy variant, not lite_mobilenet_v2) — this
        // runs against an already-loaded clip during an explicit redaction
        // scan, not a live camera feed, so the extra inference latency is
        // acceptable. lite_mobilenet_v2's lower accuracy was misclassifying
        // non-vehicle objects (e.g. a held phone) as cars/trucks, seeding
        // false "plate" regions — see the design spec.
        return await cocoSsd.load({ base: 'mobilenet_v2' });
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/aiVehicleTracking.ts
git commit -m "fix(redaction): use full-accuracy COCO-SSD base to reduce vehicle misclassification"
```

---

### Task 2: Fast-pass fix — noise filter for short single-keyframe regions

**Files:**
- Modify: `client/src/utils/redaction/regions.ts` (`mergeSamples()`, `MergeOpts`)
- Test: `client/src/utils/redaction/regions.test.ts`

- [ ] **Step 1: Write the failing tests**

In `client/src/utils/redaction/regions.test.ts`, find the existing `describe('mergeSamples', ...)` block (it currently has 2 tests: "groups overlapping consecutive same-kind samples..." and "pads a lone sample by the scan interval"). Add these 3 new tests inside that same `describe` block, after the existing ones:

```ts
  it('drops a lone short-lived single-keyframe region as noise', () => {
    // A single 0.25s-interval sample pads to tStart=-0.125/tEnd=0.375 (duration
    // 0.25s) by the existing "pad a lone sample" behavior — below the default
    // 0.4s noise threshold, so it should be dropped entirely.
    const out = mergeSamples([{ kind: 'plate', box: [0, 0, 0.2, 0.1], t: 0.25 }], { scanInterval: 0.25 });
    expect(out).toEqual([]);
  });

  it('keeps a multi-keyframe region even if its total duration is short', () => {
    // Two merged samples 0.25s apart — duration 0.25s, same as the dropped
    // case above, but this one has 2 keyframes (a real tracked detection,
    // not a single blip) so it must NOT be dropped by the noise filter.
    const s: DetectorSample[] = [
      { kind: 'face', box: [0.1, 0.1, 0.1, 0.1], t: 0 },
      { kind: 'face', box: [0.12, 0.1, 0.1, 0.1], t: 0.25 },
    ];
    const out = mergeSamples(s, { scanInterval: 0.25 });
    expect(out.length).toBe(1);
    expect(out[0].keyframes.length).toBe(2);
  });

  it('keeps a lone single-keyframe region at or above the noise duration threshold', () => {
    // A lone sample padded by a LARGER scanInterval clears the 0.4s default
    // threshold (pad is ±scanInterval/2, so scanInterval=1 → 1s duration).
    const out = mergeSamples([{ kind: 'plate', box: [0, 0, 0.2, 0.1], t: 1 }], { scanInterval: 1 });
    expect(out.length).toBe(1);
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd client && npx vitest run src/utils/redaction/regions.test.ts` — expect the first new test to FAIL (current `mergeSamples` doesn't drop anything), and the other two to already PASS (no regression risk from those, they document existing correct behavior).

- [ ] **Step 3: Implement the noise filter**

In `client/src/utils/redaction/regions.ts`, find:

```ts
export interface MergeOpts { scanInterval?: number; iouThresh?: number; defaultStyle?: RedactionStyle; strength?: number }
```

Replace with:

```ts
export interface MergeOpts { scanInterval?: number; iouThresh?: number; defaultStyle?: RedactionStyle; strength?: number; minNoiseDuration?: number }
```

Then find the end of `mergeSamples()`:

```ts
  for (const o of open) {
    const r = o.region;
    if (r.keyframes.length === 1) { r.tStart = r.tStart - scanInterval / 2; r.tEnd = r.tEnd + scanInterval / 2; }
    done.push(r);
  }
  return done;
}
```

Replace with:

```ts
  // A genuine plate/vehicle/face persists across multiple samples; a single-
  // sample region below this duration is very likely a one-frame detector
  // misfire (e.g. a shaking phone briefly misclassified as a vehicle) rather
  // than a real, sustained detection — drop it instead of surfacing noise
  // for the reviewer to manually clean up. Multi-keyframe regions are never
  // dropped, regardless of duration, since they represent a tracked object
  // across more than one sample, not a blip.
  const minNoiseDuration = opts.minNoiseDuration ?? 0.4;
  for (const o of open) {
    const r = o.region;
    if (r.keyframes.length === 1) { r.tStart = r.tStart - scanInterval / 2; r.tEnd = r.tEnd + scanInterval / 2; }
    if (r.keyframes.length === 1 && (r.tEnd - r.tStart) < minNoiseDuration) continue;
    done.push(r);
  }
  return done;
}
```

- [ ] **Step 4: Run tests to verify they all pass**

Run: `cd client && npx vitest run src/utils/redaction/regions.test.ts` — expect all tests (including the 2 pre-existing `mergeSamples` tests) to PASS. Double check the pre-existing "pads a lone sample by the scan interval" test still passes: it uses `scanInterval: 0.25`, producing a 0.25s-duration single-keyframe region — same shape as the new noise-dropped case. Read that test again: does it assert on `out[0]` directly, implying it expects the region to survive? If so, this is a real conflict, not just a coincidence — resolve it by raising that test's `scanInterval` to `1` (matching the pattern used in the new third test above) so its region duration (1s) clears the noise threshold and the test's original intent (verifying padding math) still holds without contradicting the new noise filter. Make that adjustment to the pre-existing test if needed, and re-run to confirm.

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/redaction/regions.ts client/src/utils/redaction/regions.test.ts
git commit -m "fix(redaction): drop short-lived single-keyframe regions as detector noise"
```

---

### Task 3: Server — pure Deep Scan aggregation function + unit tests

**Files:**
- Create: `src/utils/redactionDeepScan.ts`
- Test: `tests/redactionDeepScan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/redactionDeepScan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDeepScanFrame, type RawDeepScanDetection } from '../src/utils/redactionDeepScan';

describe('parseDeepScanFrame', () => {
  it('converts valid detections into DetectorSamples at the given timestamp', () => {
    const raw: RawDeepScanDetection[] = [
      { kind: 'face', box: [0.1, 0.2, 0.15, 0.2], confidence: 0.9 },
      { kind: 'plate', box: [0.5, 0.6, 0.1, 0.05], confidence: 0.7 },
    ];
    const out = parseDeepScanFrame(raw, 12.5);
    expect(out).toEqual([
      { kind: 'face', box: [0.1, 0.2, 0.15, 0.2], t: 12.5 },
      { kind: 'plate', box: [0.5, 0.6, 0.1, 0.05], t: 12.5 },
    ]);
  });

  it('drops detections with a kind other than face or plate', () => {
    const raw = [{ kind: 'vehicle', box: [0.1, 0.1, 0.1, 0.1], confidence: 0.9 }] as unknown as RawDeepScanDetection[];
    expect(parseDeepScanFrame(raw, 1)).toEqual([]);
  });

  it('drops detections with out-of-range or degenerate normalized coordinates', () => {
    const raw: RawDeepScanDetection[] = [
      { kind: 'face', box: [-0.1, 0.2, 0.1, 0.1], confidence: 0.9 },   // negative x
      { kind: 'face', box: [0.9, 0.2, 0.3, 0.1], confidence: 0.9 },    // x+w > 1
      { kind: 'face', box: [0.1, 0.2, 0, 0.1], confidence: 0.9 },      // zero width
      { kind: 'face', box: [0.1, 0.2, 0.1, 0.1], confidence: 0.9 },    // valid — should survive
    ];
    const out = parseDeepScanFrame(raw, 1);
    expect(out).toEqual([{ kind: 'face', box: [0.1, 0.2, 0.1, 0.1], t: 1 }]);
  });

  it('drops detections below the confidence threshold', () => {
    const raw: RawDeepScanDetection[] = [
      { kind: 'face', box: [0.1, 0.1, 0.1, 0.1], confidence: 0.2 },
      { kind: 'face', box: [0.2, 0.2, 0.1, 0.1], confidence: 0.5 },
    ];
    const out = parseDeepScanFrame(raw, 1, 0.4);
    expect(out).toEqual([{ kind: 'face', box: [0.2, 0.2, 0.1, 0.1], t: 1 }]);
  });

  it('clamps confidence to [0,1] before applying the threshold, rather than dropping out-of-range values outright', () => {
    const raw: RawDeepScanDetection[] = [{ kind: 'plate', box: [0.1, 0.1, 0.1, 0.1], confidence: 5 }];
    expect(parseDeepScanFrame(raw, 1)).toEqual([{ kind: 'plate', box: [0.1, 0.1, 0.1, 0.1], t: 1 }]);
  });

  it('returns [] for an empty input array', () => {
    expect(parseDeepScanFrame([], 1)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/redactionDeepScan.test.ts` — expect FAIL with "Cannot find module '../src/utils/redactionDeepScan'".

- [ ] **Step 3: Write the implementation**

Create `src/utils/redactionDeepScan.ts`:

```ts
// src/utils/redactionDeepScan.ts
// Pure per-frame parsing logic for POST /personnel/bodycam-videos/:id/deep-scan
// — validates and normalizes the vision model's raw per-frame face/plate
// bounding-box detections into the client's existing DetectorSample shape
// (client/src/utils/redaction/regions.ts), so the route's output plugs
// directly into the Redaction Studio's existing mergeSamples() pipeline with
// no new region model. Kept as a standalone pure function (no D1/AI
// dependencies) so it's testable with the Node vitest suite, unlike the
// route itself (Miniflare has no `ai` binding).

export type DeepScanKind = 'face' | 'plate';
/** [x, y, w, h] in fractional 0..1 frame coordinates — mirrors client NormBox. */
export type NormBox = [number, number, number, number];

export interface RawDeepScanDetection {
  kind: string;
  box: NormBox;
  confidence: number;
}

/** Mirrors client/src/utils/redaction/regions.ts's DetectorSample shape. */
export interface DetectorSample {
  kind: DeepScanKind;
  box: NormBox;
  t: number;
}

function isValidBox(b: unknown): b is NormBox {
  if (!Array.isArray(b) || b.length !== 4) return false;
  const [x, y, w, h] = b;
  if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  if (w <= 0 || h <= 0) return false;
  if (x < 0 || y < 0) return false;
  if (x + w > 1 || y + h > 1) return false;
  return true;
}

/** Parse one frame's raw model detections into validated DetectorSamples at
 *  timestamp `t`. Drops any detection with an unrecognized kind, a
 *  degenerate/out-of-range box, or confidence below `minConfidence` (after
 *  clamping confidence to [0,1] — an out-of-range value from the model is
 *  clamped and re-checked against the threshold, not dropped outright,
 *  since a model reporting e.g. 1.2 almost certainly means "very confident"
 *  rather than "invalid"). */
export function parseDeepScanFrame(detections: RawDeepScanDetection[], t: number, minConfidence = 0.3): DetectorSample[] {
  const out: DetectorSample[] = [];
  for (const d of detections) {
    if (d.kind !== 'face' && d.kind !== 'plate') continue;
    if (!isValidBox(d.box)) continue;
    const confidence = Math.min(1, Math.max(0, Number(d.confidence) || 0));
    if (confidence < minConfidence) continue;
    out.push({ kind: d.kind, box: d.box, t });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/redactionDeepScan.test.ts` — expect PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/redactionDeepScan.ts tests/redactionDeepScan.test.ts
git commit -m "feat(redaction): add pure per-frame parser for Deep Scan detections"
```

---

### Task 4: Server — POST /:id/deep-scan endpoint

**Files:**
- Modify: `src/routes/personnel/bodyCameraUploads.ts` (append new route; add import)

- [ ] **Step 1: Add the import**

Find:

```ts
import { aggregateAnalysis, type FrameAnalysis } from '../../utils/bodycamAiAnalysis';
```

Replace with:

```ts
import { aggregateAnalysis, type FrameAnalysis } from '../../utils/bodycamAiAnalysis';
import { parseDeepScanFrame, type DetectorSample, type RawDeepScanDetection } from '../../utils/redactionDeepScan';
```

- [ ] **Step 2: Add the route**

Append at the end of `src/routes/personnel/bodyCameraUploads.ts` (after the existing `/:id/analyze` route):

```ts
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
const DEEP_SCAN_MAX_FRAMES = 30;
// Mirrors ANALYSIS's MAX_FRAME_BYTES cap on the sibling /:id/analyze route.
const DEEP_SCAN_MAX_FRAME_BYTES = 5 * 1024 * 1024;

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
        const out: any = await c.env.AI.run(DEEP_SCAN_VISION_MODEL as any, {
          image: Array.from(bytes),
          prompt: DEEP_SCAN_PROMPT,
          max_tokens: 1024,
          temperature: 0.1,
        } as any);
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
```

Note: unlike `/:id/analyze`, this route does NOT call `ensureBodycamArtifactColumns()` or write to `bodycam_videos` — it has no new column to reconcile, since Deep Scan results are never persisted server-side (per the design spec).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` — expect no errors.

- [ ] **Step 4: No automated route test**

Same constraint as `/:id/analyze` and `/:id/transcribe`: `vitest.workers.config.mts` has no `ai` binding. Verified via manual browser click-through in the final verification task.

- [ ] **Step 5: Commit**

```bash
git add src/routes/personnel/bodyCameraUploads.ts
git commit -m "feat(redaction): add POST /:id/deep-scan for AI face/plate bounding-box detection"
```

---

### Task 5: Client — Deep Scan frame-sampling util

**Files:**
- Create: `client/src/utils/videoDeepScan.ts`

This mirrors `client/src/utils/videoAiAnalyze.ts`'s pattern (operates on an already-loaded `<video>` element, not a fresh one from a File — Redaction Studio's `<video>` is already mounted with a stream URL) but samples more densely (2s vs 8s) and supports an optional time-range restriction.

- [ ] **Step 1: Write the util**

Create `client/src/utils/videoDeepScan.ts`:

```ts
// client/src/utils/videoDeepScan.ts
// Frame sampling for Redaction Studio's on-demand "Deep Scan" — operates on
// the ALREADY-LOADED <video> element in RedactionStudio.tsx, same technique
// as videoAiAnalyze.ts (seek + canvas capture, restore playback position
// after). Samples more densely (every 2s) than the AI Findings feature's 8s,
// since redaction needs to catch faces/plates the free client-side pass
// missed, not just a coarse scene summary. Capped at MAX_FRAMES so a long
// clip must be Deep Scanned over a specific time range rather than in one
// unbounded call — callers pass rangeStart/rangeEnd to restrict sampling.

export interface SampledFrame {
  timestamp: number;
  blob: Blob;
}

// Client-local mirror of the server-side DetectorSample shape
// (src/utils/redactionDeepScan.ts) — same client/src/-cannot-import-src/
// boundary rationale documented in videoAiAnalyze.ts.
export type DeepScanKind = 'face' | 'plate';
export type NormBox = [number, number, number, number];
export interface DetectorSample {
  kind: DeepScanKind;
  box: NormBox;
  t: number;
}

const SAMPLE_INTERVAL_SEC = 2;
const MAX_FRAMES = 30;
const JPEG_QUALITY = 0.7;
const MAX_LONG_EDGE = 960;

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = Math.min(t, Math.max(0, (video.duration || t) - 0.01));
  });
}

function captureFrame(video: HTMLVideoElement): Blob | null {
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  let dataUrl: string;
  try { dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY); } catch { return null; }
  const [, base64] = dataUrl.split(',');
  if (!base64) return null;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

/**
 * Sample frames from `video` at SAMPLE_INTERVAL_SEC intervals, up to
 * MAX_FRAMES, starting at `rangeStart` (default: current playhead) and
 * stopping at `rangeEnd` (default: clip duration) — whichever comes first
 * between the range end and the frame cap. Restores the element's original
 * currentTime/paused state before resolving (success or failure).
 */
export async function sampleFramesForDeepScan(
  video: HTMLVideoElement,
  opts: { rangeStart?: number; rangeEnd?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<SampledFrame[]> {
  const duration = video.duration;
  if (!duration || !Number.isFinite(duration) || duration <= 0) return [];

  const originalTime = video.currentTime;
  const wasPaused = video.paused;
  if (!wasPaused) video.pause();

  const start = Math.max(0, opts.rangeStart ?? originalTime);
  const end = Math.min(duration, opts.rangeEnd ?? duration);

  const timestamps: number[] = [];
  for (let t = start; t < end && timestamps.length < MAX_FRAMES; t += SAMPLE_INTERVAL_SEC) timestamps.push(t);

  const frames: SampledFrame[] = [];
  try {
    for (let i = 0; i < timestamps.length; i++) {
      await seekTo(video, timestamps[i]);
      const blob = captureFrame(video);
      if (blob) frames.push({ timestamp: timestamps[i], blob });
      opts.onProgress?.(i + 1, timestamps.length);
    }
  } finally {
    await seekTo(video, originalTime);
    if (!wasPaused) { try { await video.play(); } catch { /* ignore autoplay rejection on restore */ } }
  }
  return frames;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/videoDeepScan.ts
git commit -m "feat(redaction): add frame-sampling util for Deep Scan"
```

---

### Task 6: Client — extend RedactionRegion source type + add source badge

**Files:**
- Modify: `client/src/utils/redaction/regions.ts` (`RedactionRegion['source']`)
- Modify: `client/src/components/RedactionStudio.tsx` (region list item rendering)

- [ ] **Step 1: Extend the source union**

In `client/src/utils/redaction/regions.ts`, find:

```ts
  source: 'auto' | 'manual';
```

Replace with:

```ts
  source: 'auto' | 'manual' | 'deep-scan';
```

- [ ] **Step 2: Typecheck to find any exhaustiveness-check call sites**

Run: `cd client && npx tsc --noEmit`. If this surfaces a type error anywhere that does an exhaustive switch/check over `RedactionRegion['source']` (unlikely — `mergeSamples()` and `renderRedacted.ts` don't currently branch on `source` at all, only on `kind`), fix it to include the new `'deep-scan'` case. Otherwise expect no errors.

- [ ] **Step 3: Add a source badge to the region list**

In `client/src/components/RedactionStudio.tsx`, find the region list rendering:

```tsx
            {regions.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2">
                <span className="truncate" style={{ color: KIND_COLOR[r.kind] }}>{r.kind} · {r.tStart.toFixed(1)}–{r.tEnd.toFixed(1)}s</span>
                <button onClick={() => removeRegion(r.id)} aria-label="Delete region" className="text-rmpg-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
```

Replace with:

```tsx
            {regions.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2">
                <span className="truncate flex items-center gap-1">
                  <span style={{ color: KIND_COLOR[r.kind] }}>{r.kind} · {r.tStart.toFixed(1)}–{r.tEnd.toFixed(1)}s</span>
                  {r.source === 'deep-scan' && <span className="text-[8px] px-1 py-px border border-purple-500/60 text-purple-300 uppercase tracking-wide shrink-0">Deep</span>}
                </span>
                <button onClick={() => removeRegion(r.id)} aria-label="Delete region" className="text-rmpg-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/redaction/regions.ts client/src/components/RedactionStudio.tsx
git commit -m "feat(redaction): add deep-scan region source + visual badge"
```

---

### Task 7: Client — wire the Deep Scan button into RedactionStudio

**Files:**
- Modify: `client/src/components/RedactionStudio.tsx`

- [ ] **Step 1: Add imports**

Find:

```ts
import { useMemo, useRef, useState } from 'react';
import { X, Loader2, ScanSearch, ShieldOff, Download, Square, Trash2, AlertTriangle } from 'lucide-react';
import { apiPostForm, authedImageUrl } from '../hooks/useApi';
import { scanClip } from '../utils/redaction/scanClip';
import { loadFaceDetector } from '../utils/redaction/detectFaces';
import { renderRedacted } from '../utils/redaction/renderRedacted';
import { activeRegionsAt, interpBox, type RedactionRegion, type RedactionKind, type RedactionStyle } from '../utils/redaction/regions';
```

Replace with:

```ts
import { useMemo, useRef, useState } from 'react';
import { X, Loader2, ScanSearch, ShieldOff, Download, Square, Trash2, AlertTriangle, Sparkles } from 'lucide-react';
import { apiPostForm, authedImageUrl } from '../hooks/useApi';
import { scanClip } from '../utils/redaction/scanClip';
import { loadFaceDetector } from '../utils/redaction/detectFaces';
import { renderRedacted } from '../utils/redaction/renderRedacted';
import { activeRegionsAt, interpBox, mergeSamples, type RedactionRegion, type RedactionKind, type RedactionStyle, type DetectorSample as RegionDetectorSample } from '../utils/redaction/regions';
import { sampleFramesForDeepScan, type DetectorSample as DeepScanDetectorSample } from '../utils/videoDeepScan';
```

Note: `DetectorSample` exists in both `regions.ts` (client's canonical shape, used by `mergeSamples`) and `videoDeepScan.ts` (client-local mirror of the server shape, per Task 5's cross-boundary note) — they're structurally identical (`{ kind, box, t }`), but import both under distinct aliases to avoid a naming collision and to make it clear at each call site which module's type is in play.

- [ ] **Step 2: Add component state**

Find:

```ts
  const [faceModelFailed, setFaceModelFailed] = useState(false);
```

Replace with:

```ts
  const [faceModelFailed, setFaceModelFailed] = useState(false);
  const [deepScan, setDeepScan] = useState<{ busy: boolean; done: number; total: number } | null>(null);
  const [deepScanError, setDeepScanError] = useState<string | null>(null);
```

- [ ] **Step 3: Add the handler**

Find the end of `runScan`:

```ts
  const runScan = async () => {
    const v = videoRef.current; if (!v) return;
    setScan({ busy: true, frac: 0 }); setErr(null); setFaceModelFailed(false);
    try {
      // Probe the face model up front. scanClip() loads it internally too, but
      // both share the same cached promise (loadFaceDetector memoises), so this
      // is a free check — null means BlazeFace weights never loaded and the
      // scan found plates only, with faces silently skipped.
      const faceModel = await loadFaceDetector();
      const found = await scanClip(v, { intervalSec: 0.25, includePeople: false, onProgress: (f) => setScan({ busy: true, frac: f }) });
      setRegions(found.map((r) => ({ ...r, style, strength })));
      setFaceModelFailed(!faceModel);
    } catch (e: any) { setErr(e?.message || 'Scan failed'); }
    setScan({ busy: false, frac: 1 });
  };
```

Add immediately after it:

```ts
  const runDeepScan = async () => {
    const v = videoRef.current; if (!v || deepScan?.busy) return;
    setDeepScan({ busy: true, done: 0, total: 0 }); setDeepScanError(null);
    try {
      const frames = await sampleFramesForDeepScan(v, {
        onProgress: (done, total) => setDeepScan({ busy: true, done, total }),
      });
      if (frames.length === 0) {
        setDeepScanError('Could not capture any frames from this video.');
        return;
      }
      const fd = new FormData();
      frames.forEach((f) => fd.append('frame', f.blob, `frame_${f.timestamp}.jpg`));
      fd.append('timestamps', JSON.stringify(frames.map((f) => f.timestamp)));
      // Sized for up to 30 sequential per-frame Workers AI calls — same
      // rationale as VideoPlayer.tsx's /:id/analyze timeout override.
      const result = await apiPostForm<{ samples: DeepScanDetectorSample[] }>(
        `/personnel/bodycam-videos/${eventId}/deep-scan`,
        fd,
        { timeoutMs: 180_000 },
      );
      const asRegionSamples: RegionDetectorSample[] = result.samples.map((s) => ({ kind: s.kind, box: s.box, t: s.t }));
      const found = mergeSamples(asRegionSamples, { scanInterval: 2 }).map((r) => ({ ...r, style, strength, source: 'deep-scan' as const }));
      setRegions((rs) => [...rs, ...found]);
    } catch (e: any) {
      setDeepScanError(e?.message || 'Deep scan failed');
    } finally {
      setDeepScan(null);
    }
  };
```

- [ ] **Step 4: Add the toolbar button**

Find:

```tsx
          <button onClick={runScan} disabled={scan.busy} className="w-full flex items-center justify-center gap-1.5 px-2 py-2 border border-[#d4a017] text-[#d4a017] hover:bg-[#1a1400] disabled:opacity-60">
            {scan.busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Scanning… {Math.round(scan.frac * 100)}%</> : <><ScanSearch className="w-3.5 h-3.5" /> Auto-detect plates + faces</>}
          </button>
```

Replace with:

```tsx
          <button onClick={runScan} disabled={scan.busy} className="w-full flex items-center justify-center gap-1.5 px-2 py-2 border border-[#d4a017] text-[#d4a017] hover:bg-[#1a1400] disabled:opacity-60">
            {scan.busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Scanning… {Math.round(scan.frac * 100)}%</> : <><ScanSearch className="w-3.5 h-3.5" /> Auto-detect plates + faces</>}
          </button>

          <button
            onClick={runDeepScan}
            disabled={!!deepScan?.busy}
            title="Higher-accuracy AI scan for faces/plates the fast pass may have missed — samples 2s intervals from the current playhead, up to 30 frames (~1 minute of footage)"
            className="w-full flex items-center justify-center gap-1.5 px-2 py-2 border border-purple-500/60 text-purple-300 hover:bg-purple-950/30 disabled:opacity-60"
          >
            {deepScan?.busy
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Deep scanning… {deepScan.total ? `frame ${deepScan.done} of ${deepScan.total}` : ''}</>
              : <><Sparkles className="w-3.5 h-3.5" /> Deep Scan (from playhead)</>}
          </button>
          {deepScanError && <div className="text-[10px] text-red-400">{deepScanError}</div>}
```

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors. Resolve any issues before moving on: this task's cross-import of `mergeSamples`/`DetectorSample` from `regions.ts` alongside `videoDeepScan.ts`'s own `DetectorSample` alias is the main risk area — if the aliasing in Step 1 doesn't compile cleanly, adjust the alias names but keep both types distinctly named and correctly mapped at the `asRegionSamples` conversion line.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/RedactionStudio.tsx
git commit -m "feat(redaction): wire Deep Scan button into RedactionStudio"
```

---

### Task 8: Full verification pass

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck` — expect no errors.

- [ ] **Step 2: Worker tests (Miniflare)**

Run: `npx vitest run --config vitest.workers.config.mts` — expect all pass except the 2 pre-existing unrelated failures documented throughout this program (`dispatchCallClose.test.ts`, `panicSafetyFixes.test.ts`).

- [ ] **Step 3: Node tests**

Run: `npx vitest run` — expect all pass, including the new `tests/redactionDeepScan.test.ts`.

- [ ] **Step 4: Client typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 5: Client tests**

Run: `cd client && npx vitest run` — expect all pass, including the updated `client/src/utils/redaction/regions.test.ts` (5 tests in the `mergeSamples` describe block: 2 pre-existing + 3 new).

- [ ] **Step 6: Client build**

Run: `cd client && npx vite build` — expect success.

- [ ] **Step 7: Manual browser verification**

In a live browser session: open Redaction Studio on a clip with visible faces at an angle (like the one that surfaced this bug). Run "Auto-detect plates + faces" first — confirm the duplicate-plate-burst pattern from the bug report no longer appears in the region list (no more than one region per genuinely distinct plate/vehicle sighting). Then click "Deep Scan (from playhead)" — confirm the progress indicator shows frame N of M, and confirm new regions tagged with the "Deep" badge appear for faces the fast pass missed. Confirm deleting a region still works for both `auto` and `deep-scan` sourced regions, and that exporting a redacted MP4 still succeeds with the combined region set.
