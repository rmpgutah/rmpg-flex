# Body Camera AI Object Detection & Identification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator trigger on-demand AI analysis of an uploaded body-cam video (weapon presence, vehicle description, scene type, use-of-force/officer-safety indicators), surfaced as timestamped, confidence-scored, "review required" findings — never as automated determinations.

**Architecture:** Client samples frames from the already-loaded `<video>` element in `VideoPlayer.tsx` (no upload/File object needed — this operates on a video already open in the player), POSTs them to a new `POST /:id/analyze` route. The route calls Workers AI's vision-language model (`@cf/meta/llama-3.2-11b-vision-instruct`, already used for OCR elsewhere in this codebase) once per frame with a structured JSON prompt, parses each response with the existing `tryParseModelJson()` helper, and aggregates results via a new pure function into one JSON blob stored on the video row. The client renders a findings panel with confidence badges and clickable timestamps.

**Tech Stack:** Hono routes on Cloudflare Workers, D1, Workers AI vision-language model, React + TypeScript, canvas-based frame capture (no new dependencies).

**Explicit exclusion — do not implement:** deception detection, voice stress analysis, or "anxiety analysis," in any form (including probabilistic/confidence-scored framing). See the design spec's "Explicit scope boundary" section for the reasoning. If a future task description asks for this, treat it as out of scope for this plan and escalate to the user rather than building it.

**Spec:** [`docs/superpowers/specs/2026-07-14-bodycam-ai-object-detection-design.md`](../specs/2026-07-14-bodycam-ai-object-detection-design.md)

---

### Task 1: D1 migration — ai_analysis_json column

**Files:**
- Create: `migrations/0189_bodycam_ai_analysis.sql`
- Modify: `src/routes/personnel/bodyCameras.ts` (extend `ensureBodycamArtifactColumns`)

- [ ] **Step 1: Write the migration**

```sql
-- 0189_bodycam_ai_analysis.sql — AI object-detection/identification results
-- for bodycam_videos (weapon/vehicle/scene/force-indicator findings from
-- on-demand frame analysis). Idempotent; the route also reconciles this
-- column at runtime via columnExists() because deploy migration-apply is
-- continue-on-error. APPLY DIRECTLY TO LIVE D1 785de7ae AFTER MERGE
-- (scripts/apply-migration.sh).

ALTER TABLE bodycam_videos ADD COLUMN ai_analysis_json TEXT;
```

- [ ] **Step 2: Extend the runtime column-reconcile helper**

In `src/routes/personnel/bodyCameras.ts`, find:

```ts
async function ensureBodycamArtifactColumns(db: ReturnType<typeof getDb>): Promise<void> {
  if (_bodycamArtifactColumnsEnsured) return;
  for (const [name, type] of [
    ['thumbnail_path', 'TEXT'], ['redacted_path', 'TEXT'],
    ['interaction_type', 'TEXT'], ['detected_plate_count', 'INTEGER'],
    ['detected_face_count', 'INTEGER'], ['detection_regions_json', 'TEXT'],
    ['transcript', 'TEXT'],
  ] as const) {
```

Replace with:

```ts
async function ensureBodycamArtifactColumns(db: ReturnType<typeof getDb>): Promise<void> {
  if (_bodycamArtifactColumnsEnsured) return;
  for (const [name, type] of [
    ['thumbnail_path', 'TEXT'], ['redacted_path', 'TEXT'],
    ['interaction_type', 'TEXT'], ['detected_plate_count', 'INTEGER'],
    ['detected_face_count', 'INTEGER'], ['detection_regions_json', 'TEXT'],
    ['transcript', 'TEXT'], ['ai_analysis_json', 'TEXT'],
  ] as const) {
```

- [ ] **Step 3: Apply locally**

Run: `npm run migrate:local` — this repo has a documented pre-existing, unrelated local-D1 drift issue (`duplicate column name: cost_per_gallon`) that blocks a from-scratch replay. If hit, verify the migration's SQL correctness via a scratch SQLite db built from `migrations/baseline/schema.sql`'s `bodycam_videos` definition + this migration file, confirming via `PRAGMA table_info` that `ai_analysis_json` lands as `TEXT`.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck` — expect no errors.

- [ ] **Step 5: Commit**

```bash
git add migrations/0189_bodycam_ai_analysis.sql src/routes/personnel/bodyCameras.ts
git commit -m "feat(bodycam): add D1 column for AI object-detection analysis results"
```

---

### Task 2: Server — pure aggregation function + unit test

**Files:**
- Create: `src/utils/bodycamAiAnalysis.ts`
- Test: `tests/bodycamAiAnalysis.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/bodycamAiAnalysis.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aggregateAnalysis, type FrameAnalysis } from '../src/utils/bodycamAiAnalysis';

describe('aggregateAnalysis', () => {
  it('aggregates weapon detections across frames with max confidence and all timestamps', () => {
    const frames: FrameAnalysis[] = [
      { timestamp: 5, weapon_present: false, weapon_confidence: 0.1, weapon_type: null, vehicle_present: false, vehicle_description: null, scene_type: null, force_indicators: false, force_confidence: 0, officer_safety_flags: [] },
      { timestamp: 13, weapon_present: true, weapon_confidence: 0.62, weapon_type: 'firearm', vehicle_present: false, vehicle_description: null, scene_type: null, force_indicators: false, force_confidence: 0, officer_safety_flags: [] },
      { timestamp: 21, weapon_present: true, weapon_confidence: 0.81, weapon_type: 'firearm', vehicle_present: false, vehicle_description: null, scene_type: null, force_indicators: false, force_confidence: 0, officer_safety_flags: [] },
    ];
    const result = aggregateAnalysis(frames);
    expect(result.frame_count).toBe(3);
    expect(result.weapon).toEqual({ detected: true, max_confidence: 0.81, timestamps: [13, 21] });
  });

  it('returns null weapon/force blocks when nothing crosses the detected threshold', () => {
    const frames: FrameAnalysis[] = [
      { timestamp: 5, weapon_present: false, weapon_confidence: 0, weapon_type: null, vehicle_present: false, vehicle_description: null, scene_type: null, force_indicators: false, force_confidence: 0, officer_safety_flags: [] },
    ];
    const result = aggregateAnalysis(frames);
    expect(result.weapon).toBeNull();
    expect(result.force_indicators).toBeNull();
    expect(result.vehicles).toEqual([]);
    expect(result.scene_types).toEqual([]);
    expect(result.officer_safety_flags).toEqual([]);
  });

  it('groups vehicle descriptions and scene types, collecting timestamps per distinct value', () => {
    const frames: FrameAnalysis[] = [
      { timestamp: 2, weapon_present: false, weapon_confidence: 0, weapon_type: null, vehicle_present: true, vehicle_description: 'dark sedan', scene_type: 'traffic stop', force_indicators: false, force_confidence: 0, officer_safety_flags: [] },
      { timestamp: 9, weapon_present: false, weapon_confidence: 0, weapon_type: null, vehicle_present: true, vehicle_description: 'dark sedan', scene_type: 'traffic stop', force_indicators: false, force_confidence: 0, officer_safety_flags: [] },
      { timestamp: 16, weapon_present: false, weapon_confidence: 0, weapon_type: null, vehicle_present: true, vehicle_description: 'white pickup truck', scene_type: null, force_indicators: false, force_confidence: 0, officer_safety_flags: [] },
    ];
    const result = aggregateAnalysis(frames);
    expect(result.vehicles).toEqual([
      { description: 'dark sedan', timestamps: [2, 9] },
      { description: 'white pickup truck', timestamps: [16] },
    ]);
    expect(result.scene_types).toEqual([{ type: 'traffic stop', timestamps: [2, 9] }]);
  });

  it('collects officer_safety_flags with their originating timestamp, one entry per flag occurrence', () => {
    const frames: FrameAnalysis[] = [
      { timestamp: 4, weapon_present: false, weapon_confidence: 0, weapon_type: null, vehicle_present: false, vehicle_description: null, scene_type: null, force_indicators: false, force_confidence: 0, officer_safety_flags: ['running'] },
      { timestamp: 12, weapon_present: false, weapon_confidence: 0, weapon_type: null, vehicle_present: false, vehicle_description: null, scene_type: null, force_indicators: false, force_confidence: 0, officer_safety_flags: ['struggle', 'weapon_draw'] },
    ];
    const result = aggregateAnalysis(frames);
    expect(result.officer_safety_flags).toEqual([
      { flag: 'running', timestamp: 4 },
      { flag: 'struggle', timestamp: 12 },
      { flag: 'weapon_draw', timestamp: 12 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bodycamAiAnalysis.test.ts` — expect FAIL with "Cannot find module '../src/utils/bodycamAiAnalysis'".

- [ ] **Step 3: Write the implementation**

Create `src/utils/bodycamAiAnalysis.ts`:

```ts
// src/utils/bodycamAiAnalysis.ts
// Pure aggregation logic for POST /personnel/bodycam-videos/:id/analyze —
// combines per-frame Workers AI vision responses into one row-level result.
// Kept as a standalone pure function (no D1/AI dependencies) so it's testable
// with the Node vitest suite, unlike the route itself (Miniflare has no `ai`
// binding — see the design spec's Testing section).
//
// IMPORTANT: every finding this produces is a "potential, review required"
// signal, never a determination. Nothing downstream may treat these fields
// as fact — see the design spec's scope boundary before extending this file.

export interface FrameAnalysis {
  timestamp: number;
  weapon_present: boolean;
  weapon_confidence: number;
  weapon_type: string | null;
  vehicle_present: boolean;
  vehicle_description: string | null;
  scene_type: string | null;
  force_indicators: boolean;
  force_confidence: number;
  officer_safety_flags: string[];
}

export interface AnalysisResult {
  analyzed_at: string;
  frame_count: number;
  weapon: { detected: boolean; max_confidence: number; timestamps: number[] } | null;
  vehicles: { description: string; timestamps: number[] }[];
  scene_types: { type: string; timestamps: number[] }[];
  force_indicators: { timestamps: number[]; max_confidence: number } | null;
  officer_safety_flags: { flag: string; timestamp: number }[];
}

/** Aggregates per-frame analysis into one result. Pure — no clock/random use
 *  except the caller-supplied `analyzedAt` (defaults to omitted here; the
 *  route stamps it, since Date.now() must not be called inside this pure
 *  function for testability — see CLAUDE.md conventions on avoiding
 *  non-deterministic calls in shared logic). */
export function aggregateAnalysis(frames: FrameAnalysis[], analyzedAt = ''): AnalysisResult {
  const weaponFrames = frames.filter(f => f.weapon_present);
  const weapon = weaponFrames.length === 0 ? null : {
    detected: true,
    max_confidence: Math.max(...weaponFrames.map(f => f.weapon_confidence)),
    timestamps: weaponFrames.map(f => f.timestamp),
  };

  const forceFrames = frames.filter(f => f.force_indicators);
  const force_indicators = forceFrames.length === 0 ? null : {
    timestamps: forceFrames.map(f => f.timestamp),
    max_confidence: Math.max(...forceFrames.map(f => f.force_confidence)),
  };

  const vehiclesByDescription = new Map<string, number[]>();
  for (const f of frames) {
    if (!f.vehicle_present || !f.vehicle_description) continue;
    const list = vehiclesByDescription.get(f.vehicle_description) ?? [];
    list.push(f.timestamp);
    vehiclesByDescription.set(f.vehicle_description, list);
  }
  const vehicles = Array.from(vehiclesByDescription, ([description, timestamps]) => ({ description, timestamps }));

  const sceneTypesByType = new Map<string, number[]>();
  for (const f of frames) {
    if (!f.scene_type) continue;
    const list = sceneTypesByType.get(f.scene_type) ?? [];
    list.push(f.timestamp);
    sceneTypesByType.set(f.scene_type, list);
  }
  const scene_types = Array.from(sceneTypesByType, ([type, timestamps]) => ({ type, timestamps }));

  const officer_safety_flags: { flag: string; timestamp: number }[] = [];
  for (const f of frames) {
    for (const flag of f.officer_safety_flags) officer_safety_flags.push({ flag, timestamp: f.timestamp });
  }

  return { analyzed_at: analyzedAt, frame_count: frames.length, weapon, vehicles, scene_types, force_indicators, officer_safety_flags };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bodycamAiAnalysis.test.ts` — expect PASS (all 4 tests). Note the test file doesn't pass `analyzedAt`, so `result.analyzed_at` will be `''` in all assertions above — the tests don't assert on that field, which is correct (it's caller-supplied, not this function's concern).

- [ ] **Step 5: Commit**

```bash
git add src/utils/bodycamAiAnalysis.ts tests/bodycamAiAnalysis.test.ts
git commit -m "feat(bodycam): add pure aggregation function for AI analysis results"
```

---

### Task 3: Server — POST /:id/analyze endpoint

**Files:**
- Modify: `src/routes/personnel/bodyCameraUploads.ts` (append new route; add imports)

- [ ] **Step 1: Add imports**

Find the top-of-file imports in `src/routes/personnel/bodyCameraUploads.ts`:

```ts
import { transcribeTransmission } from '../../utils/aiDispatcher';
```

Replace with:

```ts
import { transcribeTransmission } from '../../utils/aiDispatcher';
import { tryParseModelJson } from '../../utils/serveIntakeExtract';
import { aggregateAnalysis, type FrameAnalysis } from '../../utils/bodycamAiAnalysis';
import { log } from '../../utils/logger';
```

- [ ] **Step 2: Add the route**

Append at the end of `src/routes/personnel/bodyCameraUploads.ts`:

```ts
// ────────────────────────────────────────────────────────────
// POST /:id/analyze — on-demand AI object detection/identification.
// Client samples frames from the already-loaded player and posts them
// here (NOT automatic on upload — this calls a paid vision model per
// frame, unlike the free client-side thumbnail/plate/face detection).
// Every finding is a "potential, review required" signal — this route
// must never write to classification/retention_status or trigger any
// action; it only stores a JSON blob the UI renders as review aids.
//
// Do NOT extend this route (or the prompt below) to attempt deception
// detection, voice stress analysis, or "anxiety analysis" in any form —
// see docs/superpowers/specs/2026-07-14-bodycam-ai-object-detection-design.md's
// "Explicit scope boundary" section. That is a deliberate, permanent
// exclusion, not an oversight to be filled in later.
// ────────────────────────────────────────────────────────────
const ANALYSIS_VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const ANALYSIS_MAX_FRAMES = 20;

const ANALYSIS_PROMPT = `You are assisting a human reviewer of body-worn camera footage. Look at this single video frame and return ONLY a JSON object (no prose, no markdown fences) with this exact shape:
{
  "weapon_present": boolean,
  "weapon_confidence": number (0 to 1),
  "weapon_type": string or null (e.g. "firearm", "knife"),
  "vehicle_present": boolean,
  "vehicle_description": string or null (brief: type/color, e.g. "dark sedan"),
  "scene_type": string or null (brief label, e.g. "traffic stop", "foot pursuit", "interview"),
  "force_indicators": boolean (true if the frame shows what looks like physical struggle/force),
  "force_confidence": number (0 to 1),
  "officer_safety_flags": string[] (any of: "weapon_draw", "running", "struggle" — empty array if none)
}
Only set a boolean true if you have reasonable visual evidence in THIS frame. This is a triage aid for a human reviewer, not a final determination — when uncertain, prefer lower confidence over a false positive.`;

bodycamVideosRouter.post('/:id/analyze', async (c) => {
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
    if (frames.length > ANALYSIS_MAX_FRAMES) {
      return c.json({ error: `too many frames (max ${ANALYSIS_MAX_FRAMES})` }, 400);
    }

    const db = getDb(c.env);
    await ensureBodycamArtifactColumns(db);
    const row = await queryFirst<{ id: number }>(db, 'SELECT id FROM bodycam_videos WHERE id = ?', id);
    if (!row) return c.json({ error: 'Video not found' }, 404);

    // Sequential, not Promise.all — stays within Workers AI concurrent-
    // request limits (see design spec). A ~20-frame analysis takes tens
    // of seconds; the client shows a progress indicator, not a spinner.
    const results: FrameAnalysis[] = [];
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const timestamp = Number(timestamps[i]) || 0;
      try {
        const bytes = new Uint8Array(await frame.arrayBuffer());
        const out: any = await c.env.AI.run(ANALYSIS_VISION_MODEL as any, {
          image: Array.from(bytes),
          prompt: ANALYSIS_PROMPT,
          max_tokens: 512,
          temperature: 0.1,
        } as any);
        const parsed = tryParseModelJson(out);
        results.push({
          timestamp,
          weapon_present: !!parsed.weapon_present,
          weapon_confidence: Number(parsed.weapon_confidence) || 0,
          weapon_type: typeof parsed.weapon_type === 'string' ? parsed.weapon_type : null,
          vehicle_present: !!parsed.vehicle_present,
          vehicle_description: typeof parsed.vehicle_description === 'string' ? parsed.vehicle_description : null,
          scene_type: typeof parsed.scene_type === 'string' ? parsed.scene_type : null,
          force_indicators: !!parsed.force_indicators,
          force_confidence: Number(parsed.force_confidence) || 0,
          officer_safety_flags: Array.isArray(parsed.officer_safety_flags) ? parsed.officer_safety_flags.filter((x: unknown) => typeof x === 'string') : [],
        });
      } catch (frameErr) {
        // Best-effort per frame — one bad frame doesn't fail the whole analysis.
        console.warn(`bodycam analyze: frame at ${timestamp}s failed:`, frameErr);
      }
    }

    const analysis = aggregateAnalysis(results, new Date().toISOString());
    await execute(db, "UPDATE bodycam_videos SET ai_analysis_json = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(analysis), id);

    log.info('Bodycam AI analysis completed', {
      videoId: id, framesRequested: frames.length, framesAnalyzed: results.length,
      weaponDetected: !!analysis.weapon, forceDetected: !!analysis.force_indicators,
    });

    return c.json({ success: true, frames_analyzed: results.length, frames_requested: frames.length, analysis });
  } catch (err) {
    console.error('POST /personnel/bodycam-videos/:id/analyze failed:', err);
    return dbErrorResponse(c, err, 'Failed');
  }
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` — expect no errors.

- [ ] **Step 4: No automated route test for this endpoint**

Same constraint as the transcription endpoint (Task 10 of the prior phase's plan): `vitest.workers.config.mts` has no `ai` binding. Verified via manual browser click-through in the final verification task. Do not attempt to add Workers AI mocking.

- [ ] **Step 5: Commit**

```bash
git add src/routes/personnel/bodyCameraUploads.ts
git commit -m "feat(bodycam): add POST /:id/analyze for AI object detection/identification"
```

---

### Task 4: Client — types + mapper for ai_analysis_json

**Files:**
- Modify: `client/src/types/index.ts` (`BodyCamVideo` interface)
- Modify: `client/src/pages/personnel/utils/personnelMappers.ts` (`mapBodyCamVideo`)

- [ ] **Step 1: Add the field to the type**

In `client/src/types/index.ts`'s `BodyCamVideo` interface, find:

```ts
  detection_regions_json?: string;
  transcript?: string;
```

Replace with:

```ts
  detection_regions_json?: string;
  transcript?: string;
  ai_analysis_json?: string;
```

- [ ] **Step 2: Map the field**

In `client/src/pages/personnel/utils/personnelMappers.ts`'s `mapBodyCamVideo`, find:

```ts
    detection_regions_json: row.detection_regions_json || undefined,
    transcript: row.transcript || undefined,
```

Replace with:

```ts
    detection_regions_json: row.detection_regions_json || undefined,
    transcript: row.transcript || undefined,
    ai_analysis_json: row.ai_analysis_json || undefined,
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/types/index.ts client/src/pages/personnel/utils/personnelMappers.ts
git commit -m "feat(bodycam): add ai_analysis_json to BodyCamVideo type + mapper"
```

---

### Task 5: Client — frame-sampling util

**Files:**
- Create: `client/src/utils/videoAiAnalyze.ts`

Unlike the upload-time capture utils (`videoThumbnail.ts`, `videoAutoDetect.ts`, `videoTranscribe.ts`), which create their OWN hidden `<video>` element from a `File`, this util operates on an **already-loaded, already-mounted** `<video>` element (the one the operator is actively viewing in `VideoPlayer`) — there is no `File` object available for an already-uploaded video, only its stream URL. It must save and restore the player's playback position so triggering an analysis doesn't visibly disrupt what the operator is watching.

- [ ] **Step 1: Write the util**

Create `client/src/utils/videoAiAnalyze.ts`:

```ts
// client/src/utils/videoAiAnalyze.ts
// Frame sampling for on-demand AI object-detection analysis, operating on
// an ALREADY-LOADED <video> element (the one open in VideoPlayer) rather
// than a fresh hidden element built from a File — there is no File object
// for a video that's already uploaded, only its stream URL. Saves and
// restores the element's playback position/pause-state so triggering an
// analysis doesn't disrupt what the operator is watching.

export interface SampledFrame {
  timestamp: number;
  blob: Blob;
}

// Client-local duplicate of the server-side AnalysisResult shape
// (src/utils/bodycamAiAnalysis.ts) — this codebase has no precedent for
// client/src importing from the Worker's src/ (confirmed 2026-07-14; see
// CLAUDE.md's "no build, no tsconfig, no package.json" boundary note), so
// the type is duplicated here rather than imported. Keep in sync by hand
// if the server-side shape changes.
export interface AnalysisResult {
  analyzed_at: string;
  frame_count: number;
  weapon: { detected: boolean; max_confidence: number; timestamps: number[] } | null;
  vehicles: { description: string; timestamps: number[] }[];
  scene_types: { type: string; timestamps: number[] }[];
  force_indicators: { timestamps: number[]; max_confidence: number } | null;
  officer_safety_flags: { flag: string; timestamp: number }[];
}

const SAMPLE_INTERVAL_SEC = 8;
const MAX_FRAMES = 20;
const JPEG_QUALITY = 0.7;
const MAX_LONG_EDGE = 960; // matches the OCR path's payload-size discipline

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
 * MAX_FRAMES, calling `onProgress` after each frame. Restores the
 * element's original currentTime/paused state before resolving (success
 * or failure) so the operator's viewing position is undisturbed.
 */
export async function sampleFramesForAnalysis(
  video: HTMLVideoElement,
  onProgress?: (done: number, total: number) => void,
): Promise<SampledFrame[]> {
  const duration = video.duration;
  if (!duration || !Number.isFinite(duration) || duration <= 0) return [];

  const originalTime = video.currentTime;
  const wasPaused = video.paused;
  if (!wasPaused) video.pause();

  const timestamps: number[] = [];
  for (let t = 0; t < duration && timestamps.length < MAX_FRAMES; t += SAMPLE_INTERVAL_SEC) timestamps.push(t);

  const frames: SampledFrame[] = [];
  try {
    for (let i = 0; i < timestamps.length; i++) {
      await seekTo(video, timestamps[i]);
      const blob = captureFrame(video);
      if (blob) frames.push({ timestamp: timestamps[i], blob });
      onProgress?.(i + 1, timestamps.length);
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
git add client/src/utils/videoAiAnalyze.ts
git commit -m "feat(bodycam): add frame-sampling util for on-demand AI analysis"
```

---

### Task 6: Client — wire the Analyze button + findings panel into VideoPlayer

**Files:**
- Modify: `client/src/components/VideoPlayer.tsx`

- [ ] **Step 1: Add imports and state**

Find the top-of-file imports:

```ts
import { useRef, useState, useEffect } from 'react';
import { X, Video, Shield, Maximize2, Minimize2, Edit2, Printer } from 'lucide-react';
```

Replace with:

```ts
import { useRef, useState, useEffect } from 'react';
import { X, Video, Shield, Maximize2, Minimize2, Edit2, Printer, ScanSearch, AlertTriangle, Loader2 } from 'lucide-react';
import { sampleFramesForAnalysis } from '../utils/videoAiAnalyze';
import type { AnalysisResult } from '../utils/videoAiAnalyze';
```

`AnalysisResult` is defined in `client/src/utils/videoAiAnalyze.ts` (Task 5) as a client-local duplicate of the server-side shape — this codebase has no precedent for `client/src` importing from the Worker's `src/` (confirmed 2026-07-14; CLAUDE.md documents `/src/` and `/client/src/` as sharing "no build, no tsconfig, no package.json"). If Task 5 was completed as written, this import already resolves correctly.

- [ ] **Step 2: Add component state**

Find:

```ts
  const [printing, setPrinting] = useState(false);
```

Replace with:

```ts
  const [printing, setPrinting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
```

- [ ] **Step 3: Add the handler**

Add near `handlePrintCustody`:

```ts
  const handleAnalyze = async () => {
    const el = videoRef.current;
    if (!el || !video || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    setAnalyzeProgress({ done: 0, total: 0 });
    try {
      const frames = await sampleFramesForAnalysis(el, (done, total) => setAnalyzeProgress({ done, total }));
      if (frames.length === 0) {
        setAnalyzeError('Could not capture any frames from this video.');
        return;
      }
      const fd = new FormData();
      frames.forEach((f) => fd.append('frame', f.blob, `frame_${f.timestamp}.jpg`));
      fd.append('timestamps', JSON.stringify(frames.map((f) => f.timestamp)));
      const res = await fetch(`${apiBase}/personnel/bodycam-videos/${video.id}/analyze`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: fd,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const result = await res.json() as { analysis: AnalysisResult };
      setLocalAnalysis(result.analysis);
    } catch (err: any) {
      setAnalyzeError(err?.message || 'Analysis failed');
    } finally {
      setAnalyzing(false);
      setAnalyzeProgress(null);
    }
  };
```

Add one more piece of state right above this handler (needed because `video` is a prop, not owned by this component — the freshly analyzed result must be shown immediately without waiting for the parent to refetch and pass down a new `video` prop):

```ts
  const [localAnalysis, setLocalAnalysis] = useState<AnalysisResult | null>(null);
  const analysis: AnalysisResult | null = localAnalysis ?? (video?.ai_analysis_json ? (() => {
    try { return JSON.parse(video.ai_analysis_json); } catch { return null; }
  })() : null);
```

Place this state/derived-value block right after the `printing`/`analyzing`/`analyzeProgress`/`analyzeError` state declarations from Step 2.

- [ ] **Step 4: Add the toolbar button**

Find:

```tsx
            {onEditVideo && (
              <button type="button" onClick={() => onEditVideo(video)} className="toolbar-btn p-1" title="Edit video metadata">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}
```

Replace with:

```tsx
            {onEditVideo && (
              <button type="button" onClick={() => onEditVideo(video)} className="toolbar-btn p-1" title="Edit video metadata">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={analyzing}
              className="toolbar-btn p-1 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Run AI object detection (weapons, vehicles, scene) — review aid only, not a determination"
              aria-label="Analyze video with AI"
            >
              {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanSearch className="w-3.5 h-3.5" />}
            </button>
```

- [ ] **Step 5: Add the findings panel**

Find the transcript block added in the prior phase:

```tsx
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

Replace with:

```tsx
        {video.transcript && (
          <div className="px-3 py-2 bg-surface-deep border-t border-rmpg-800">
            <p className="text-[9px] font-mono text-rmpg-500 uppercase tracking-wide mb-1">Transcript</p>
            <p className="text-[10px] text-rmpg-300 leading-relaxed max-h-24 overflow-y-auto scrollbar-dark">{video.transcript}</p>
          </div>
        )}

        {analyzing && (
          <div className="px-3 py-2 bg-surface-deep border-t border-rmpg-800 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin text-brand-400" />
            <span className="text-[10px] text-rmpg-400 font-mono">
              Analyzing{analyzeProgress ? ` — frame ${analyzeProgress.done} of ${analyzeProgress.total}` : '…'}
            </span>
          </div>
        )}

        {analyzeError && (
          <div className="px-3 py-2 bg-surface-deep border-t border-rmpg-800 flex items-center gap-2 text-red-400">
            <AlertTriangle className="w-3 h-3" />
            <span className="text-[10px] font-mono">{analyzeError}</span>
          </div>
        )}

        {analysis && !analyzing && (
          <div className="px-3 py-2 bg-surface-deep border-t border-rmpg-800 space-y-1.5">
            <p className="text-[9px] font-mono text-rmpg-500 uppercase tracking-wide">
              AI Findings — {analysis.frame_count} frame(s) analyzed
            </p>
            {!analysis.weapon && !analysis.force_indicators && analysis.vehicles.length === 0 && analysis.scene_types.length === 0 && analysis.officer_safety_flags.length === 0 && (
              <p className="text-[10px] text-rmpg-500">No findings.</p>
            )}
            {analysis.weapon && (
              <button type="button" onClick={() => { if (videoRef.current) videoRef.current.currentTime = analysis.weapon!.timestamps[0]; }} className="w-full text-left flex items-center gap-2 text-[10px] text-red-400 hover:text-red-300">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                <span>Potential weapon — {Math.round(analysis.weapon.max_confidence * 100)}% confidence — review required (jump to {formatDuration(analysis.weapon.timestamps[0])})</span>
              </button>
            )}
            {analysis.force_indicators && (
              <button type="button" onClick={() => { if (videoRef.current) videoRef.current.currentTime = analysis.force_indicators!.timestamps[0]; }} className="w-full text-left flex items-center gap-2 text-[10px] text-amber-400 hover:text-amber-300">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                <span>Potential force/struggle indicator — {Math.round(analysis.force_indicators.max_confidence * 100)}% confidence — review required (jump to {formatDuration(analysis.force_indicators.timestamps[0])})</span>
              </button>
            )}
            {analysis.officer_safety_flags.map((f, i) => (
              <button key={i} type="button" onClick={() => { if (videoRef.current) videoRef.current.currentTime = f.timestamp; }} className="w-full text-left flex items-center gap-2 text-[10px] text-amber-400 hover:text-amber-300">
                <Shield className="w-3 h-3 flex-shrink-0" />
                <span>Officer safety flag: {f.flag} — review required (jump to {formatDuration(f.timestamp)})</span>
              </button>
            ))}
            {analysis.vehicles.map((v, i) => (
              <button key={i} type="button" onClick={() => { if (videoRef.current) videoRef.current.currentTime = v.timestamps[0]; }} className="w-full text-left flex items-center gap-2 text-[10px] text-rmpg-300 hover:text-rmpg-100">
                <Video className="w-3 h-3 flex-shrink-0" />
                <span>Vehicle: {v.description} (jump to {formatDuration(v.timestamps[0])})</span>
              </button>
            ))}
            {analysis.scene_types.map((s, i) => (
              <button key={i} type="button" onClick={() => { if (videoRef.current) videoRef.current.currentTime = s.timestamps[0]; }} className="w-full text-left flex items-center gap-2 text-[10px] text-rmpg-300 hover:text-rmpg-100">
                <ScanSearch className="w-3 h-3 flex-shrink-0" />
                <span>Scene: {s.type} (jump to {formatDuration(s.timestamps[0])})</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

`formatDuration` already exists in this component (used elsewhere in the metadata bar) — reuse it, don't redefine it.

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors. Resolve this BEFORE moving on: if Step 1's cross-boundary type import doesn't compile or doesn't match this codebase's conventions, switch to the client-local duplicate-type approach described in Step 1's note.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/VideoPlayer.tsx
git commit -m "feat(bodycam): wire AI analysis button + findings panel into VideoPlayer"
```

---

### Task 7: Full verification pass

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck` — expect no errors.

- [ ] **Step 2: Worker tests (Miniflare)**

Run: `npx vitest run --config vitest.workers.config.mts` — expect all pass except the 2 pre-existing unrelated failures documented throughout this program (`dispatchCallClose.test.ts`, `panicSafetyFixes.test.ts`).

- [ ] **Step 3: Node tests**

Run: `npx vitest run` — expect all pass, including the new `tests/bodycamAiAnalysis.test.ts`.

- [ ] **Step 4: Client typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 5: Client tests**

Run: `cd client && npx vitest run` — expect all pass.

- [ ] **Step 6: Client build**

Run: `cd client && npx vite build` — expect success.

- [ ] **Step 7: Apply the migration to live D1**

Run: `scripts/apply-migration.sh 0189_bodycam_ai_analysis.sql`

Then verify: `npx wrangler d1 execute rmpg-flex --remote --command "PRAGMA table_info(bodycam_videos)"` includes `ai_analysis_json`.

- [ ] **Step 8: Manual browser verification**

In a live browser session: open a body-cam video with a visible vehicle in frame, click the new "Analyze" toolbar button (magnifying-glass icon), confirm the progress indicator shows frame N of M, and confirm the findings panel appears with at least a vehicle finding, correctly labeled with a confidence/review-required framing, and that clicking a finding seeks the player to that timestamp. Confirm the "no findings" case renders sensibly for a clip with nothing detected.
