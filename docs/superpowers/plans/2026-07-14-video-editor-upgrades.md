# Video Editor Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add speed/playback control, overlay annotations (arrows/text/highlights), export presets, and audio enhancement to the bodycam/dashcam video editor (Redaction Studio + VideoPlayer).

**Architecture:** Every phase composes into the existing real-time canvas-capture export pipeline (`renderRedacted.ts`) rather than replacing it. Speed sets `video.playbackRate` before the capture loop. Annotations reuse `regions.ts`'s keyframe/interpolation model (via a small structural-typing refactor) and burn into the same per-frame canvas draw call redaction effects already use. Presets are static config over existing controls. Audio enhancement is a Web Audio API chain (no ffmpeg.wasm — confirmed dead end in this codebase) that, for export, finally lifts the "video-only" limitation by combining a `MediaStreamAudioDestinationNode` track with the existing canvas video track into one `MediaStream` for `MediaRecorder`, with an explicit fallback to video-only if audio attachment fails.

**Tech Stack:** React + TypeScript, native `HTMLVideoElement`/`MediaRecorder`/Web Audio API (no new dependencies).

**Spec:** [`docs/superpowers/specs/2026-07-14-video-editor-upgrades-design.md`](../specs/2026-07-14-video-editor-upgrades-design.md)

---

### Task 1: Speed — renderRedacted.ts export speed option

**Files:**
- Modify: `client/src/utils/redaction/renderRedacted.ts`

- [ ] **Step 1: Add the option**

Find:
```ts
export interface RenderOpts {
  stamp?: string[];
  /** Bits per second for the recorder. Default 8 Mbps — high enough that the
   *  blurred plate/face redactions can't be sharpened back out of the export. */
  bitrate?: number;
  onProgress?: (frac: number, phase: 'frames' | 'encode') => void;
  signal?: AbortSignal;
}
```
Replace with:
```ts
export interface RenderOpts {
  stamp?: string[];
  /** Bits per second for the recorder. Default 8 Mbps — high enough that the
   *  blurred plate/face redactions can't be sharpened back out of the export. */
  bitrate?: number;
  /** Playback rate for the export's real-time capture pass — 1 = normal
   *  speed. Since renderRedacted() plays the source in real time to draw
   *  frames, setting the video element's native playbackRate before capture
   *  starts makes the OUTPUT play back at that speed (2 = fast-motion export
   *  that also finishes rendering sooner; 0.5 = slow-motion export) with no
   *  change to the capture technique itself. */
  speed?: number;
  onProgress?: (frac: number, phase: 'frames' | 'encode') => void;
  signal?: AbortSignal;
}
```

- [ ] **Step 2: Apply it before capture starts**

Find:
```ts
  const v = video as VideoWithRvfc;
  const wasMuted = video.muted, wasPaused = video.paused, startT = video.currentTime;
  video.muted = true;           // export silently; we never capture audio
  video.pause();
```
Replace with:
```ts
  const v = video as VideoWithRvfc;
  const wasMuted = video.muted, wasPaused = video.paused, startT = video.currentTime;
  const wasPlaybackRate = video.playbackRate;
  video.muted = true;           // export silently unless audio enhancement is wired in (Task 11)
  video.pause();
  video.playbackRate = opts.speed ?? 1;
```

- [ ] **Step 3: Restore it in cleanup**

Find:
```ts
    const cleanup = () => {
      if (rafId) cancelAnimationFrame(rafId);
      video.removeEventListener('ended', onEnded);
      opts.signal?.removeEventListener('abort', onAbort);
      video.muted = wasMuted;
      video.pause();
      try { video.currentTime = startT; } catch { /* */ }
      if (!wasPaused) video.play().catch(() => {});
    };
```
Replace with:
```ts
    const cleanup = () => {
      if (rafId) cancelAnimationFrame(rafId);
      video.removeEventListener('ended', onEnded);
      opts.signal?.removeEventListener('abort', onAbort);
      video.muted = wasMuted;
      video.playbackRate = wasPlaybackRate;
      video.pause();
      try { video.currentTime = startT; } catch { /* */ }
      if (!wasPaused) video.play().catch(() => {});
    };
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/redaction/renderRedacted.ts
git commit -m "feat(video-editor): add export speed option to renderRedacted"
```

---

### Task 2: Speed — RedactionStudio.tsx speed control

**Files:**
- Modify: `client/src/components/RedactionStudio.tsx`

- [ ] **Step 1: Add state**

Find:
```ts
  const [style, setStyle] = useState<RedactionStyle>('blur');
  const [strength, setStrength] = useState(14);
```
Replace with:
```ts
  const [style, setStyle] = useState<RedactionStyle>('blur');
  const [strength, setStrength] = useState(14);
  const [speed, setSpeed] = useState(1);
```

- [ ] **Step 2: Add the UI control**

Find:
```tsx
            <div className="flex items-center justify-between gap-2">
              <span>Strength</span>
              <input type="range" min={4} max={40} value={strength} onChange={(e) => { const v = Number(e.target.value); setStrength(v); setRegions((rs) => rs.map((r) => ({ ...r, strength: v }))); }} />
            </div>
```
Replace with:
```tsx
            <div className="flex items-center justify-between gap-2">
              <span>Strength</span>
              <input type="range" min={4} max={40} value={strength} onChange={(e) => { const v = Number(e.target.value); setStrength(v); setRegions((rs) => rs.map((r) => ({ ...r, strength: v }))); }} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Export speed</span>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="bg-black border border-border-default px-1 py-0.5">
                <option value={0.25}>0.25x (slow-mo)</option>
                <option value={0.5}>0.5x (slow-mo)</option>
                <option value={1}>1x (normal)</option>
                <option value={1.5}>1.5x</option>
                <option value={2}>2x (fast)</option>
              </select>
            </div>
```

- [ ] **Step 3: Pass it to renderRedacted**

Find:
```ts
      const { blob, ext } = await renderRedacted(v, regions, {
        stamp: stampLines,
        onProgress: (frac, phase) => setRender({ busy: true, frac, phase }),
      });
```
Replace with:
```ts
      const { blob, ext } = await renderRedacted(v, regions, {
        stamp: stampLines,
        speed,
        onProgress: (frac, phase) => setRender({ busy: true, frac, phase }),
      });
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/RedactionStudio.tsx
git commit -m "feat(video-editor): add export speed control to RedactionStudio"
```

---

### Task 3: Speed — VideoPlayer.tsx preview speed selector

**Files:**
- Modify: `client/src/components/VideoPlayer.tsx`

- [ ] **Step 1: Add state**

Find (near the other `useState` declarations at the top of the component):
```ts
  const [printing, setPrinting] = useState(false);
```
Replace with:
```ts
  const [printing, setPrinting] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
```

- [ ] **Step 2: Apply it to the video element and keep it applied across re-renders**

Add a `useEffect` near the component's other effects (after the existing `videoRef`/state declarations, anywhere effects are grouped in this file — read the file to find a sensible spot near other `useEffect(() => { const vid = videoRef.current; ... }, [...])` blocks):
```ts
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed, streamUrl]);
```
(`streamUrl` in the dependency array re-applies the rate when a new `<video>` element mounts for a different stream — read the file to confirm the actual variable name used for the signed stream URL state; it may not be literally `streamUrl`, adjust to match.)

- [ ] **Step 3: Add the toolbar control**

Find:
```tsx
            <button type="button" onClick={() => setHudVisible(!hudVisible)} className="text-[9px] font-mono text-rmpg-500 hover:text-rmpg-200 px-1.5 py-0.5 transition-colors" title="Toggle HUD overlay">
              HUD {hudVisible ? 'ON' : 'OFF'}
            </button>
```
Replace with:
```tsx
            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              className="text-[9px] font-mono bg-transparent text-rmpg-500 hover:text-rmpg-200 border border-rmpg-700 px-1 py-0.5"
              title="Playback speed"
              aria-label="Playback speed"
            >
              <option value={0.25}>0.25x</option>
              <option value={0.5}>0.5x</option>
              <option value={0.75}>0.75x</option>
              <option value={1}>1x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2x</option>
            </select>
            <button type="button" onClick={() => setHudVisible(!hudVisible)} className="text-[9px] font-mono text-rmpg-500 hover:text-rmpg-200 px-1.5 py-0.5 transition-colors" title="Toggle HUD overlay">
              HUD {hudVisible ? 'ON' : 'OFF'}
            </button>
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors. If Step 2's dependency-array variable name doesn't match the actual stream-URL state in this file, fix it to the correct name (read the component's existing `<video src={...}>` binding to find it — do not guess a second time, use the exact identifier already rendering the video element's `src`).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/VideoPlayer.tsx
git commit -m "feat(video-editor): add playback speed selector to VideoPlayer"
```

---

### Task 4: Annotations — refactor interpBox to a structural type + pure annotation model

**Files:**
- Modify: `client/src/utils/redaction/regions.ts` (`interpBox` signature only — widen, not behavior change)
- Create: `client/src/utils/redaction/annotations.ts`
- Test: `client/src/utils/redaction/annotations.test.ts`

- [ ] **Step 1: Widen interpBox's parameter type (backward compatible)**

Find:
```ts
/** Interpolate a region's box at time t (clamps outside the keyframe range). */
export function interpBox(region: RedactionRegion, t: number): NormBox {
  const k = region.keyframes;
```
Replace with:
```ts
/** Interpolate a keyframed box at time t (clamps outside the keyframe range).
 *  Takes a minimal structural type (just `keyframes`) rather than the full
 *  RedactionRegion so annotations.ts's AnnotationMark — which has the same
 *  keyframe/time-range shape but different other fields — can reuse this
 *  function directly instead of duplicating the interpolation logic. Every
 *  existing caller already satisfies this narrower interface (any
 *  RedactionRegion has `keyframes`), so this is a widening, non-breaking
 *  change. */
export function interpBox(region: { keyframes: Keyframe[] }, t: number): NormBox {
  const k = region.keyframes;
```

- [ ] **Step 2: Run existing tests to confirm no regression**

Run: `cd client && npx vitest run src/utils/redaction/regions.test.ts` — expect all existing tests to still pass unchanged (this step only widens the parameter type, no behavior change).

- [ ] **Step 3: Write the failing test**

Create `client/src/utils/redaction/annotations.test.ts`:
```ts
// client/src/utils/redaction/annotations.test.ts
import { describe, it, expect } from 'vitest';
import { activeAnnotationsAt, type AnnotationMark } from './annotations';
import { interpBox } from './regions';

const mark = (over: Partial<AnnotationMark>): AnnotationMark => ({
  id: 'a', kind: 'highlight', keyframes: [{ t: 0, box: [0.1, 0.1, 0.2, 0.2] }],
  tStart: 0, tEnd: 1, color: '#fff', enabled: true, ...over,
});

describe('activeAnnotationsAt', () => {
  it('returns only enabled marks whose span covers t', () => {
    const marks = [
      mark({ id: 'a', tStart: 0, tEnd: 1 }),
      mark({ id: 'b', tStart: 2, tEnd: 3 }),
      mark({ id: 'c', tStart: 0, tEnd: 5, enabled: false }),
    ];
    expect(activeAnnotationsAt(marks, 0.5).map((m) => m.id)).toEqual(['a']);
    expect(activeAnnotationsAt(marks, 2.5).map((m) => m.id)).toEqual(['b']);
    expect(activeAnnotationsAt(marks, 0.5).some((m) => m.id === 'c')).toBe(false);
  });

  it('excludes marks outside their time span even if enabled', () => {
    const marks = [mark({ tStart: 5, tEnd: 6 })];
    expect(activeAnnotationsAt(marks, 1)).toEqual([]);
  });
});

describe('AnnotationMark reuses regions.ts interpBox', () => {
  it('interpolates an annotation box the same way a redaction region does', () => {
    const m = mark({ keyframes: [{ t: 0, box: [0, 0, 0.2, 0.2] }, { t: 2, box: [0.4, 0, 0.2, 0.2] }], tStart: 0, tEnd: 2 });
    expect(interpBox(m, 1)[0]).toBeCloseTo(0.2);
  });
});
```

Run: `cd client && npx vitest run src/utils/redaction/annotations.test.ts` — expect FAIL with "Cannot find module './annotations'".

- [ ] **Step 4: Write the implementation**

Create `client/src/utils/redaction/annotations.ts`:
```ts
// client/src/utils/redaction/annotations.ts
// Pure model for burned-in overlay annotations (arrows, text labels, highlight
// boxes) — the visual opposite of RedactionRegion (which OBSCURES content;
// annotations ADD visible content), so this is a separate type rather than an
// extra RedactionKind. Reuses regions.ts's Keyframe/NormBox types and its
// interpBox() function directly (see regions.ts's widened interpBox
// signature) since the "position over a keyframed time range" behavior is
// identical between the two models — only rendering differs.
import type { Keyframe, NormBox } from './regions';

export type AnnotationKind = 'arrow' | 'text' | 'highlight';

export interface AnnotationMark {
  id: string;
  kind: AnnotationKind;
  // Shape depends on kind: 'highlight' → [x, y, w, h] bounding box (same as a
  // redaction region). 'arrow' → [x1, y1, dx, dy] where the arrow points from
  // (x1,y1) to (x1+dx, y1+dy) — reuses the same 4-number NormBox shape as a
  // bounding-box diagonal rather than introducing a new point-pair type.
  // 'text' → [x, y, 0, 0] — position only, w/h unused/ignored by the renderer.
  keyframes: Keyframe[];
  tStart: number;
  tEnd: number;
  color: string;
  /** Required (non-empty) for kind: 'text'; unused for 'arrow'/'highlight'. */
  text?: string;
  enabled: boolean;
}

let _seq = 0;
export const nextAnnotationId = () => `note_${Date.now().toString(36)}_${_seq++}`;

/** Enabled annotation marks whose [tStart,tEnd] covers t — mirrors
 *  regions.ts's activeRegionsAt() exactly, kept separate since the two
 *  arrays (regions vs annotations) are stored and rendered independently. */
export function activeAnnotationsAt(marks: AnnotationMark[], t: number): AnnotationMark[] {
  return marks.filter((m) => m.enabled && t >= m.tStart && t <= m.tEnd);
}

/** [x, y, w, h] as used by drawAnnotation.ts's placeholder default when the
 *  operator adds a new mark at the current playhead — a small centered box
 *  for highlight/arrow, a centered position for text — matching the existing
 *  "Add manual box (at playhead)" pattern in RedactionStudio.tsx, which also
 *  places a fixed default the operator can delete and re-add rather than
 *  drag-resizing (this codebase's redaction boxes have no drag-resize UI
 *  either — annotations match that same level of interaction, not a new one). */
export const DEFAULT_HIGHLIGHT_BOX: NormBox = [0.4, 0.4, 0.2, 0.2];
export const DEFAULT_ARROW_BOX: NormBox = [0.3, 0.3, 0.3, 0.3];
export const DEFAULT_TEXT_BOX: NormBox = [0.4, 0.4, 0, 0];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npx vitest run src/utils/redaction/annotations.test.ts` — expect PASS (all 3 tests).

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/redaction/regions.ts client/src/utils/redaction/annotations.ts client/src/utils/redaction/annotations.test.ts
git commit -m "feat(video-editor): add pure annotation model, reusing regions.ts's interpBox"
```

---

### Task 5: Annotations — canvas rendering + burn into export

**Files:**
- Create: `client/src/utils/redaction/drawAnnotations.ts`
- Modify: `client/src/utils/redaction/renderRedacted.ts` (burn annotations into the export draw call)

- [ ] **Step 1: Write the renderer**

Create `client/src/utils/redaction/drawAnnotations.ts`:
```ts
// client/src/utils/redaction/drawAnnotations.ts
// Canvas rendering for overlay annotations — the ADD-content counterpart to
// blur.ts's applyRegionEffect() (which OBSCURES content). Not unit-tested
// (rasterizing to a 2D context is browser-only, same constraint documented
// on applyRegionEffect in blur.ts) — verified via manual browser check.
import { interpBox, denormBox, type NormBox } from './regions';
import { activeAnnotationsAt, type AnnotationMark } from './annotations';

function drawArrowhead(ctx: CanvasRenderingContext2D, x2: number, y2: number, angle: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

/** Draw one annotation mark's interpolated box onto a 2D context. */
export function drawAnnotation(ctx: CanvasRenderingContext2D, mark: AnnotationMark, boxPx: NormBox): void {
  const [x, y, w, h] = boxPx;
  ctx.save();
  ctx.strokeStyle = mark.color;
  ctx.fillStyle = mark.color;
  ctx.lineWidth = 3;
  if (mark.kind === 'highlight') {
    ctx.globalAlpha = 0.25;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeRect(x, y, w, h);
  } else if (mark.kind === 'arrow') {
    const x2 = x + w, y2 = y + h;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    drawArrowhead(ctx, x2, y2, Math.atan2(y2 - y, x2 - x), 14);
  } else if (mark.kind === 'text' && mark.text) {
    const fs = Math.max(16, Math.round(ctx.canvas.height * 0.03));
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000';
    ctx.strokeText(mark.text, x, y);
    ctx.fillStyle = mark.color;
    ctx.fillText(mark.text, x, y);
  }
  ctx.restore();
}

/** Draw every active-at-t annotation onto ctx, denormalizing each mark's
 *  interpolated box to pixel space first. */
export function drawAnnotations(ctx: CanvasRenderingContext2D, marks: AnnotationMark[], t: number, W: number, H: number): void {
  for (const m of activeAnnotationsAt(marks, t)) {
    drawAnnotation(ctx, m, denormBox(interpBox(m, t), W, H));
  }
}
```

- [ ] **Step 2: Wire it into the export draw call**

In `client/src/utils/redaction/renderRedacted.ts`, find:
```ts
import { activeRegionsAt, interpBox, denormBox, type RedactionRegion } from './regions';
import { applyRegionEffect } from './blur';
```
Replace with:
```ts
import { activeRegionsAt, interpBox, denormBox, type RedactionRegion } from './regions';
import { applyRegionEffect } from './blur';
import { drawAnnotations } from './drawAnnotations';
import type { AnnotationMark } from './annotations';
```

Find:
```ts
export async function renderRedacted(
  video: HTMLVideoElement, regions: RedactionRegion[], opts: RenderOpts = {},
): Promise<RenderResult> {
```
Replace with:
```ts
export async function renderRedacted(
  video: HTMLVideoElement, regions: RedactionRegion[], opts: RenderOpts = {},
  annotations: AnnotationMark[] = [],
): Promise<RenderResult> {
```

Find:
```ts
  const drawFrame = () => {
    const t = video.currentTime;
    ctx.drawImage(video, 0, 0, W, H);
    for (const r of activeRegionsAt(regions, t)) {
      applyRegionEffect(ctx, denormBox(interpBox(r, t), W, H), r.style, r.strength);
    }
    drawStamp(ctx, opts.stamp ?? [], W, H);
    track.requestFrame!();
  };
```
Replace with:
```ts
  const drawFrame = () => {
    const t = video.currentTime;
    ctx.drawImage(video, 0, 0, W, H);
    for (const r of activeRegionsAt(regions, t)) {
      applyRegionEffect(ctx, denormBox(interpBox(r, t), W, H), r.style, r.strength);
    }
    // Annotations burn in AFTER redaction effects (so a pointer/label can
    // reference something near a blurred area without being obscured by it)
    // but BEFORE the evidence stamp (which must always stay on top and
    // legible, regardless of what annotations the operator added).
    drawAnnotations(ctx, annotations, t, W, H);
    drawStamp(ctx, opts.stamp ?? [], W, H);
    track.requestFrame!();
  };
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors. `renderRedacted`'s new 4th parameter is given a default (`= []`), so every EXISTING call site (which doesn't pass annotations yet) still compiles unchanged — confirm this is actually true by checking that TypeScript doesn't complain about existing 3-argument call sites in `RedactionStudio.tsx`.

- [ ] **Step 4: Commit**

```bash
git add client/src/utils/redaction/drawAnnotations.ts client/src/utils/redaction/renderRedacted.ts
git commit -m "feat(video-editor): render annotations on canvas, burn into redacted export"
```

---

### Task 6: Annotations — RedactionStudio.tsx Annotate UI

**Files:**
- Modify: `client/src/components/RedactionStudio.tsx`

- [ ] **Step 1: Add imports and state**

Find:
```ts
import { activeRegionsAt, interpBox, mergeSamples, type RedactionRegion, type RedactionKind, type RedactionStyle, type DetectorSample as RegionDetectorSample } from '../utils/redaction/regions';
import { sampleFramesForDeepScan, type DetectorSample as DeepScanDetectorSample } from '../utils/videoDeepScan';
```
Replace with:
```ts
import { activeRegionsAt, interpBox, mergeSamples, type RedactionRegion, type RedactionKind, type RedactionStyle, type DetectorSample as RegionDetectorSample } from '../utils/redaction/regions';
import { sampleFramesForDeepScan, type DetectorSample as DeepScanDetectorSample } from '../utils/videoDeepScan';
import { activeAnnotationsAt, nextAnnotationId, DEFAULT_HIGHLIGHT_BOX, DEFAULT_ARROW_BOX, DEFAULT_TEXT_BOX, type AnnotationMark, type AnnotationKind } from '../utils/redaction/annotations';
```

Find:
```ts
const KIND_COLOR: Record<RedactionKind, string> = { plate: '#22d3ee', face: '#f472b6', person: '#a3e635', manual: '#d4a017' };
```
Replace with:
```ts
const KIND_COLOR: Record<RedactionKind, string> = { plate: '#22d3ee', face: '#f472b6', person: '#a3e635', manual: '#d4a017' };
const ANNOTATION_DEFAULT_COLOR = '#facc15';
```

Find:
```ts
  const [speed, setSpeed] = useState(1);
```
Replace with:
```ts
  const [speed, setSpeed] = useState(1);
  const [annotations, setAnnotations] = useState<AnnotationMark[]>([]);
```

- [ ] **Step 2: Add handlers**

Find `addManual` (the existing "add a fixed-position redaction box at the playhead" function) and add these new functions immediately after it:
```ts
  const addAnnotation = (kind: AnnotationKind) => {
    const v = videoRef.current; if (!v) return;
    const at = v.currentTime;
    let text: string | undefined;
    if (kind === 'text') {
      text = window.prompt('Annotation text:')?.trim();
      if (!text) return; // cancelled or empty — don't add a blank label
    }
    const box = kind === 'highlight' ? DEFAULT_HIGHLIGHT_BOX : kind === 'arrow' ? DEFAULT_ARROW_BOX : DEFAULT_TEXT_BOX;
    setAnnotations((as) => [...as, {
      id: nextAnnotationId(), kind, keyframes: [{ t: at, box }],
      tStart: Math.max(0, at - 1), tEnd: at + 1, color: ANNOTATION_DEFAULT_COLOR, text, enabled: true,
    }]);
  };

  const removeAnnotation = (id: string) => setAnnotations((as) => as.filter((a) => a.id !== id));
```

- [ ] **Step 3: Pass annotations into renderRedacted**

Find (this was already touched by Task 2 — confirm the current exact text before editing, it may include `speed,` from that task):
```ts
      const { blob, ext } = await renderRedacted(v, regions, {
        stamp: stampLines,
        speed,
        onProgress: (frac, phase) => setRender({ busy: true, frac, phase }),
      });
```
Replace with:
```ts
      const { blob, ext } = await renderRedacted(v, regions, {
        stamp: stampLines,
        speed,
        onProgress: (frac, phase) => setRender({ busy: true, frac, phase }),
      }, annotations);
```

- [ ] **Step 4: Render annotations in the live preview SVG overlay**

Find:
```tsx
            {nat && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${natW} ${natH}`} preserveAspectRatio="none">
                {visible.map((r) => {
                  const [x, y, w, h] = interpBox(r, t).map((v, i) => v * (i % 2 === 0 ? natW : natH));
                  return <rect key={r.id} x={x} y={y} width={w} height={h} fill="none" stroke={KIND_COLOR[r.kind]} strokeWidth={2} vectorEffect="non-scaling-stroke" />;
                })}
              </svg>
            )}
```
Replace with:
```tsx
            {nat && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${natW} ${natH}`} preserveAspectRatio="none">
                {visible.map((r) => {
                  const [x, y, w, h] = interpBox(r, t).map((v, i) => v * (i % 2 === 0 ? natW : natH));
                  return <rect key={r.id} x={x} y={y} width={w} height={h} fill="none" stroke={KIND_COLOR[r.kind]} strokeWidth={2} vectorEffect="non-scaling-stroke" />;
                })}
                {activeAnnotationsAt(annotations, t).map((m) => {
                  const [x, y, w, h] = interpBox(m, t).map((v, i) => v * (i % 2 === 0 ? natW : natH));
                  if (m.kind === 'highlight') return <rect key={m.id} x={x} y={y} width={w} height={h} fill={m.color} fillOpacity={0.25} stroke={m.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />;
                  if (m.kind === 'arrow') return <line key={m.id} x1={x} y1={y} x2={x + w} y2={y + h} stroke={m.color} strokeWidth={3} vectorEffect="non-scaling-stroke" markerEnd="url(#arrowhead)" />;
                  if (m.kind === 'text' && m.text) return <text key={m.id} x={x} y={y} fill={m.color} fontSize={natH * 0.03} fontWeight="bold" stroke="#000" strokeWidth={1} paintOrder="stroke">{m.text}</text>;
                  return null;
                })}
                <defs>
                  <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 Z" fill={ANNOTATION_DEFAULT_COLOR} />
                  </marker>
                </defs>
              </svg>
            )}
```
Note this SVG preview is a lightweight approximation (single fixed marker color) — the canvas export in Task 5 is the authoritative per-mark-colored render; this preview just needs to show the operator roughly where each annotation sits, matching the existing preview overlay's fidelity level (the redaction `<rect>` overlay above it is similarly a simple outline, not the actual blur/pixelate effect).

- [ ] **Step 5: Add the Annotate toolbar section + list**

Find the "Add manual box (at playhead)" button:
```tsx
            <button onClick={addManual} className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 border border-border-default hover:border-[#d4a017]"><Square className="w-3.5 h-3.5" /> Add manual box (at playhead)</button>
          </div>
```
Replace with:
```tsx
            <button onClick={addManual} className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 border border-border-default hover:border-[#d4a017]"><Square className="w-3.5 h-3.5" /> Add manual box (at playhead)</button>
          </div>

          <div className="border-t border-border-default pt-2 space-y-2">
            <span className="text-rmpg-400">Annotations (at playhead)</span>
            <div className="grid grid-cols-3 gap-1.5">
              <button onClick={() => addAnnotation('arrow')} className="flex items-center justify-center gap-1 px-2 py-1.5 border border-border-default hover:border-yellow-500 text-[10px]">Arrow</button>
              <button onClick={() => addAnnotation('highlight')} className="flex items-center justify-center gap-1 px-2 py-1.5 border border-border-default hover:border-yellow-500 text-[10px]">Highlight</button>
              <button onClick={() => addAnnotation('text')} className="flex items-center justify-center gap-1 px-2 py-1.5 border border-border-default hover:border-yellow-500 text-[10px]">Text</button>
            </div>
            {annotations.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2">
                <span className="truncate" style={{ color: a.color }}>{a.kind}{a.text ? `: ${a.text}` : ''} · {a.tStart.toFixed(1)}–{a.tEnd.toFixed(1)}s</span>
                <button onClick={() => removeAnnotation(a.id)} aria-label="Delete annotation" className="text-rmpg-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
```

- [ ] **Step 6: Allow export with annotations-only (no redaction regions)**

Find:
```tsx
          <button onClick={exportRedacted} disabled={!!render || !regions.length} className="w-full flex items-center justify-center gap-1.5 px-2 py-2 border border-green-700 text-green-300 bg-green-950/30 hover:bg-green-900/40 disabled:opacity-60">
```
Replace with:
```tsx
          <button onClick={exportRedacted} disabled={!!render || (!regions.length && !annotations.length)} className="w-full flex items-center justify-center gap-1.5 px-2 py-2 border border-green-700 text-green-300 bg-green-950/30 hover:bg-green-900/40 disabled:opacity-60">
```
(Previously export was disabled whenever there were zero redaction regions — an operator who only wants to add an annotation-only export, e.g. circling something for a report with no privacy redaction needed, would have been blocked. Now export is only disabled when BOTH lists are empty.)

- [ ] **Step 7: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/RedactionStudio.tsx
git commit -m "feat(video-editor): add Annotate UI (arrow/highlight/text) to RedactionStudio"
```

---

### Task 7: Export presets — static config + smoke test

**Files:**
- Create: `client/src/utils/redaction/exportPresets.ts`
- Test: `client/src/utils/redaction/exportPresets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/redaction/exportPresets.test.ts`:
```ts
// client/src/utils/redaction/exportPresets.test.ts
import { describe, it, expect } from 'vitest';
import { EXPORT_PRESETS } from './exportPresets';

const VALID_STYLES = new Set(['blur', 'pixelate', 'box']);

describe('EXPORT_PRESETS', () => {
  it('has at least the court-ready and quick-share presets, each with a unique id', () => {
    const ids = EXPORT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('court-ready');
    expect(ids).toContain('quick-share');
  });

  it('every preset has a valid style, in-range strength/bitrate/speed', () => {
    for (const p of EXPORT_PRESETS) {
      expect(VALID_STYLES.has(p.style)).toBe(true);
      expect(p.strength).toBeGreaterThanOrEqual(4);
      expect(p.strength).toBeLessThanOrEqual(40);
      expect(p.bitrate).toBeGreaterThan(0);
      expect(p.speed).toBeGreaterThan(0);
      expect(typeof p.audioEnhancement).toBe('boolean');
      expect(typeof p.label).toBe('string');
      expect(p.label.length).toBeGreaterThan(0);
    }
  });
});
```

Run: `cd client && npx vitest run src/utils/redaction/exportPresets.test.ts` — expect FAIL with "Cannot find module './exportPresets'".

- [ ] **Step 2: Write the implementation**

Create `client/src/utils/redaction/exportPresets.ts`:
```ts
// client/src/utils/redaction/exportPresets.ts
// Named bundles of export settings — a convenience default, not a lock: the
// operator can still adjust individual controls (style/strength/speed/audio)
// after picking a preset, same as picking a style value today doesn't
// disable further edits.
import type { RedactionStyle } from './regions';

export interface ExportPreset {
  id: string;
  label: string;
  style: RedactionStyle;
  strength: number;
  bitrate: number;
  speed: number;
  /** No-op until Task 12 wires audio enhancement into the export path. */
  audioEnhancement: boolean;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'court-ready', label: 'Court-Ready (full quality)', style: 'blur', strength: 14, bitrate: 10_000_000, speed: 1, audioEnhancement: true },
  { id: 'quick-share', label: 'Quick Share (smaller file)', style: 'blur', strength: 14, bitrate: 3_000_000, speed: 1, audioEnhancement: false },
];
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd client && npx vitest run src/utils/redaction/exportPresets.test.ts` — expect PASS (both tests).

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/redaction/exportPresets.ts client/src/utils/redaction/exportPresets.test.ts
git commit -m "feat(video-editor): add export presets config"
```

---

### Task 8: Export presets — RedactionStudio.tsx dropdown wiring

**Files:**
- Modify: `client/src/components/RedactionStudio.tsx`

- [ ] **Step 1: Add import and state**

Find:
```ts
import { activeAnnotationsAt, nextAnnotationId, DEFAULT_HIGHLIGHT_BOX, DEFAULT_ARROW_BOX, DEFAULT_TEXT_BOX, type AnnotationMark, type AnnotationKind } from '../utils/redaction/annotations';
```
Replace with:
```ts
import { activeAnnotationsAt, nextAnnotationId, DEFAULT_HIGHLIGHT_BOX, DEFAULT_ARROW_BOX, DEFAULT_TEXT_BOX, type AnnotationMark, type AnnotationKind } from '../utils/redaction/annotations';
import { EXPORT_PRESETS } from '../utils/redaction/exportPresets';
```

Find:
```ts
  const [annotations, setAnnotations] = useState<AnnotationMark[]>([]);
```
Replace with:
```ts
  const [annotations, setAnnotations] = useState<AnnotationMark[]>([]);
  const [bitrate, setBitrate] = useState(8_000_000);
  const [audioEnhancement, setAudioEnhancement] = useState(false);
```

- [ ] **Step 2: Add the preset dropdown and audio-enhancement checkbox**

Find (this was already extended by Task 2 — confirm exact current text before editing):
```tsx
            <div className="flex items-center justify-between gap-2">
              <span>Export speed</span>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="bg-black border border-border-default px-1 py-0.5">
                <option value={0.25}>0.25x (slow-mo)</option>
                <option value={0.5}>0.5x (slow-mo)</option>
                <option value={1}>1x (normal)</option>
                <option value={1.5}>1.5x</option>
                <option value={2}>2x (fast)</option>
              </select>
            </div>
```
Replace with:
```tsx
            <div className="flex items-center justify-between gap-2">
              <span>Export speed</span>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="bg-black border border-border-default px-1 py-0.5">
                <option value={0.25}>0.25x (slow-mo)</option>
                <option value={0.5}>0.5x (slow-mo)</option>
                <option value={1}>1x (normal)</option>
                <option value={1.5}>1.5x</option>
                <option value={2}>2x (fast)</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Preset</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  const preset = EXPORT_PRESETS.find((p) => p.id === e.target.value);
                  if (!preset) return;
                  setStyle(preset.style); setStrength(preset.strength); setSpeed(preset.speed);
                  setBitrate(preset.bitrate); setAudioEnhancement(preset.audioEnhancement);
                  setRegions((rs) => rs.map((r) => ({ ...r, style: preset.style, strength: preset.strength })));
                }}
                className="bg-black border border-border-default px-1 py-0.5"
              >
                <option value="" disabled>Apply preset…</option>
                {EXPORT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <label className="flex items-center justify-between gap-2">
              <span>Enhance audio in export</span>
              <input type="checkbox" checked={audioEnhancement} onChange={(e) => setAudioEnhancement(e.target.checked)} />
            </label>
```

- [ ] **Step 3: Pass bitrate through to renderRedacted**

Find (already extended by Tasks 2 and 6 — confirm exact current text before editing):
```ts
      const { blob, ext } = await renderRedacted(v, regions, {
        stamp: stampLines,
        speed,
        onProgress: (frac, phase) => setRender({ busy: true, frac, phase }),
      }, annotations);
```
Replace with:
```ts
      const { blob, ext } = await renderRedacted(v, regions, {
        stamp: stampLines,
        speed,
        bitrate,
        onProgress: (frac, phase) => setRender({ busy: true, frac, phase }),
      }, annotations);
```
Note `audioEnhancement` is intentionally NOT passed to `renderRedacted` yet — `RenderOpts` doesn't have that field until Task 11. This task only wires the preset's UI-level defaults; audio enhancement becomes functional in Task 12.

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/RedactionStudio.tsx
git commit -m "feat(video-editor): wire export presets dropdown into RedactionStudio"
```

---

### Task 9: Audio enhancement — Web Audio chain builder

**Files:**
- Create: `client/src/utils/redaction/audioEnhancement.ts`

This is the shared chain-construction logic used by both VideoPlayer's live preview (Task 10) and the export path (Task 11). Not unit-tested — jsdom doesn't implement Web Audio API, same constraint already documented for other browser-API-heavy utils in this program (`videoThumbnail.ts`, `videoAiAnalyze.ts` have no automated coverage of their actual browser-API interactions either) — verified via manual browser check in Task 13.

- [ ] **Step 1: Write the implementation**

Create `client/src/utils/redaction/audioEnhancement.ts`:
```ts
// client/src/utils/redaction/audioEnhancement.ts
// Web Audio API processing chain for bodycam audio — no ffmpeg.wasm (a
// confirmed dead end in this codebase; see renderRedacted.ts's header
// comment). Shared between VideoPlayer's live preview (routes to
// audioContext.destination — the speakers) and RedactionStudio's export
// path (routes to a MediaStreamAudioDestinationNode, producing a track that
// gets combined with the canvas video track for MediaRecorder).
//
// IMPORTANT: AudioContext.createMediaElementSource(video) can only be called
// ONCE per <video> element for its entire lifetime — a second call throws.
// Once called, the element's audio ONLY plays through the Web Audio graph;
// the browser's native audio output for that element is bypassed. This means
// toggling enhancement "off" must NOT tear down the source node (that would
// silence the element permanently) — instead, "off" reconnects the source
// directly to the destination, bypassing the filter/compressor/gain nodes,
// and "on" reconnects through them. See disconnectChain()/bypassChain()
// below, which callers use for toggling rather than rebuilding the chain.

export interface AudioChain {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  highpass: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  gainNode: GainNode;
  destination: AudioNode;
}

/** Build the enhancement chain once for a given <video> element + AudioContext,
 *  wired through to `destination` (context.destination for live preview, or a
 *  MediaStreamAudioDestinationNode for export). Starts ENGAGED (chain active,
 *  not bypassed) — callers that want to start bypassed should call
 *  bypassChain(chain) immediately after. Throws if `createMediaElementSource`
 *  has already been called on this element (by this function or anything
 *  else) — callers must ensure this is only invoked once per element and
 *  reuse the returned chain thereafter (see the toggle functions below). */
export function buildAudioEnhancementChain(
  video: HTMLVideoElement,
  context: AudioContext,
  destination: AudioNode,
  opts: { boost?: number } = {},
): AudioChain {
  const source = context.createMediaElementSource(video);
  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 100; // cut low-frequency rumble/wind noise common in bodycam audio
  const compressor = context.createDynamicsCompressor(); // normalizes volume swings
  const gainNode = context.createGain();
  gainNode.gain.value = opts.boost ?? 1.5;
  source.connect(highpass).connect(compressor).connect(gainNode).connect(destination);
  return { context, source, highpass, compressor, gainNode, destination };
}

/** Route the source directly to destination, bypassing the enhancement
 *  nodes — used to toggle enhancement "off" without silencing the element
 *  (see the header comment on why the source node can't be torn down). */
export function bypassChain(chain: AudioChain): void {
  chain.source.disconnect();
  chain.gainNode.disconnect();
  chain.source.connect(chain.destination);
}

/** Reconnect through the enhancement nodes — used to toggle enhancement
 *  "on" after a prior bypassChain() call. */
export function engageChain(chain: AudioChain): void {
  chain.source.disconnect();
  chain.source.connect(chain.highpass).connect(chain.compressor).connect(chain.gainNode).connect(chain.destination);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/redaction/audioEnhancement.ts
git commit -m "feat(video-editor): add Web Audio enhancement chain builder"
```

---

### Task 10: Audio enhancement — VideoPlayer.tsx live preview toggle

**Files:**
- Modify: `client/src/components/VideoPlayer.tsx`

- [ ] **Step 1: Add imports and state**

Find:
```ts
import { sampleFramesForAnalysis } from '../utils/videoAiAnalyze';
import type { AnalysisResult } from '../utils/videoAiAnalyze';
```
Replace with:
```ts
import { sampleFramesForAnalysis } from '../utils/videoAiAnalyze';
import type { AnalysisResult } from '../utils/videoAiAnalyze';
import { buildAudioEnhancementChain, bypassChain, engageChain, type AudioChain } from '../utils/redaction/audioEnhancement';
```

Find:
```ts
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
```
Replace with:
```ts
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [audioEnhanced, setAudioEnhanced] = useState(false);
  const audioChainRef = useRef<AudioChain | null>(null);
```

- [ ] **Step 2: Add the toggle handler**

Add near the other handlers in this component (e.g. near `handleAnalyze` or `toggleFullscreen`):
```ts
  const toggleAudioEnhancement = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (!audioChainRef.current) {
      // Lazy-init on first enable — createMediaElementSource can only be
      // called once per element (see audioEnhancement.ts's header comment),
      // so we don't build this eagerly on mount for every video the operator
      // opens, only the first time they actually want enhancement.
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioChainRef.current = buildAudioEnhancementChain(vid, ctx, ctx.destination);
      } catch (e) {
        console.warn('[video-player] audio enhancement chain failed to build:', e);
        return;
      }
    } else if (audioEnhanced) {
      bypassChain(audioChainRef.current);
    } else {
      engageChain(audioChainRef.current);
    }
    setAudioEnhanced((v) => !v);
  };
```

- [ ] **Step 3: Add cleanup on unmount/close**

Find the component's existing cleanup `useEffect` (search for `return () =>` inside a `useEffect` that already tears down player-related resources on close/unmount — this file has several effects; find the one tied to `isOpen`/unmount, not the analyze/HUD ones). Add cleanup for the audio context alongside whatever it already does:
```ts
      if (audioChainRef.current) {
        audioChainRef.current.context.close().catch(() => {});
        audioChainRef.current = null;
      }
```
If no single existing cleanup effect fits naturally, add a new dedicated one:
```ts
  useEffect(() => {
    return () => {
      if (audioChainRef.current) {
        audioChainRef.current.context.close().catch(() => {});
        audioChainRef.current = null;
      }
    };
  }, []);
```

- [ ] **Step 4: Add the toolbar button**

Find the playback-speed `<select>` added in Task 3 and add the toggle button immediately after it:
```tsx
            <button
              type="button"
              onClick={toggleAudioEnhancement}
              className={`text-[9px] font-mono px-1.5 py-0.5 border transition-colors ${audioEnhanced ? 'border-yellow-500 text-yellow-400' : 'border-rmpg-700 text-rmpg-500 hover:text-rmpg-200'}`}
              title="Boost + normalize audio, cut low-frequency rumble (playback only, not saved to the file)"
              aria-label="Toggle audio enhancement"
            >
              AUDIO {audioEnhanced ? 'ON' : 'OFF'}
            </button>
```

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors. Resolve Step 3's exact insertion point by reading the file's actual effect structure — do not skip cleanup, since a leaked `AudioContext` per opened video is a real resource leak in a page where operators review many videos in one session.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/VideoPlayer.tsx
git commit -m "feat(video-editor): add live audio enhancement toggle to VideoPlayer"
```

---

### Task 11: Audio enhancement — export muxing with fallback

**Files:**
- Modify: `client/src/utils/redaction/renderRedacted.ts`

- [ ] **Step 1: Add the option**

Find:
```ts
  speed?: number;
  onProgress?: (frac: number, phase: 'frames' | 'encode') => void;
  signal?: AbortSignal;
}
```
Replace with:
```ts
  speed?: number;
  /** When true, attempt to mux enhanced audio into the export by building the
   *  same Web Audio chain used for live preview (audioEnhancement.ts) and
   *  routing it to a MediaStreamAudioDestinationNode instead of speakers,
   *  combining that track with the existing canvas video track for
   *  MediaRecorder. This is the first time this export path produces ANY
   *  audio — previously video-only unconditionally (see this file's header
   *  comment). If audio-track construction fails for any reason (untested
   *  browser combo, CORS-tainted media element, etc.), the export falls back
   *  to video-only rather than failing outright — `onAudioFallback` lets the
   *  caller surface that to the operator. */
  audioEnhancement?: boolean;
  onAudioFallback?: (reason: string) => void;
  onProgress?: (frac: number, phase: 'frames' | 'encode') => void;
  signal?: AbortSignal;
}
```

- [ ] **Step 2: Add the import**

Find:
```ts
import { activeRegionsAt, interpBox, denormBox, type RedactionRegion } from './regions';
import { applyRegionEffect } from './blur';
import { drawAnnotations } from './drawAnnotations';
import type { AnnotationMark } from './annotations';
```
Replace with:
```ts
import { activeRegionsAt, interpBox, denormBox, type RedactionRegion } from './regions';
import { applyRegionEffect } from './blur';
import { drawAnnotations } from './drawAnnotations';
import type { AnnotationMark } from './annotations';
import { buildAudioEnhancementChain } from './audioEnhancement';
```

- [ ] **Step 3: Build the combined stream**

Find:
```ts
  const stream = canvas.captureStream(0); // 0 fps = manual frame mode (requestFrame)
  const track = stream.getVideoTracks()[0] as FrameCaptureTrack;
  if (!track?.requestFrame) throw new Error('Canvas frame capture unavailable in this browser.');

  const recorder = new MediaRecorder(stream, { mimeType: fmt.mimeType, videoBitsPerSecond: opts.bitrate ?? 8_000_000 });
```
Replace with:
```ts
  const stream = canvas.captureStream(0); // 0 fps = manual frame mode (requestFrame)
  const track = stream.getVideoTracks()[0] as FrameCaptureTrack;
  if (!track?.requestFrame) throw new Error('Canvas frame capture unavailable in this browser.');

  // Attempt audio muxing if requested — falls back to video-only on any
  // failure rather than aborting the whole export (see RenderOpts.audioEnhancement's
  // doc comment). Kept outside the try/finally below deliberately: the audio
  // context's lifetime spans the whole render, closed alongside cleanup().
  let audioCtx: AudioContext | null = null;
  let recordingStream: MediaStream = stream;
  if (opts.audioEnhancement) {
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const dest = audioCtx.createMediaStreamDestination();
      buildAudioEnhancementChain(video, audioCtx, dest);
      const audioTrack = dest.stream.getAudioTracks()[0];
      if (audioTrack) recordingStream = new MediaStream([track, audioTrack]);
      else throw new Error('No audio track produced');
    } catch (e) {
      console.warn('[redaction] audio enhancement failed, exporting video-only:', e);
      opts.onAudioFallback?.((e as Error)?.message || 'Audio enhancement unavailable in this browser');
      if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
      recordingStream = stream;
    }
  }

  const recorder = new MediaRecorder(recordingStream, { mimeType: fmt.mimeType, videoBitsPerSecond: opts.bitrate ?? 8_000_000 });
```

- [ ] **Step 4: Close the audio context in cleanup**

Find:
```ts
    const cleanup = () => {
      if (rafId) cancelAnimationFrame(rafId);
      video.removeEventListener('ended', onEnded);
      opts.signal?.removeEventListener('abort', onAbort);
      video.muted = wasMuted;
      video.playbackRate = wasPlaybackRate;
      video.pause();
      try { video.currentTime = startT; } catch { /* */ }
      if (!wasPaused) video.play().catch(() => {});
    };
```
Replace with:
```ts
    const cleanup = () => {
      if (rafId) cancelAnimationFrame(rafId);
      video.removeEventListener('ended', onEnded);
      opts.signal?.removeEventListener('abort', onAbort);
      video.muted = wasMuted;
      video.playbackRate = wasPlaybackRate;
      video.pause();
      try { video.currentTime = startT; } catch { /* */ }
      if (!wasPaused) video.play().catch(() => {});
      if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
    };
```

Note: `video.muted = true` (set earlier in the function, unchanged by this task) does NOT affect whether `buildAudioEnhancementChain`'s `createMediaElementSource` taps real audio — muting only silences the element's native output, not the decoded audio Web Audio reads from it. This is intentional: the export still plays silently to the operator's speakers while its enhanced audio is captured separately into the recording.

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/redaction/renderRedacted.ts
git commit -m "feat(video-editor): mux enhanced audio into redacted export, with video-only fallback"
```

---

### Task 12: Audio enhancement — wire the RedactionStudio checkbox to actually do something

**Files:**
- Modify: `client/src/components/RedactionStudio.tsx`

Task 8 already added the `audioEnhancement` checkbox/state but explicitly did NOT pass it to `renderRedacted` (since `RenderOpts.audioEnhancement` didn't exist yet). Now it does (Task 11).

- [ ] **Step 1: Add state for the fallback warning**

Find:
```ts
  const [audioEnhancement, setAudioEnhancement] = useState(false);
```
Replace with:
```ts
  const [audioEnhancement, setAudioEnhancement] = useState(false);
  const [audioFallbackWarning, setAudioFallbackWarning] = useState<string | null>(null);
```

- [ ] **Step 2: Pass it through and surface the fallback**

Find:
```ts
      const { blob, ext } = await renderRedacted(v, regions, {
        stamp: stampLines,
        speed,
        bitrate,
        onProgress: (frac, phase) => setRender({ busy: true, frac, phase }),
      }, annotations);
```
Replace with:
```ts
      const { blob, ext } = await renderRedacted(v, regions, {
        stamp: stampLines,
        speed,
        bitrate,
        audioEnhancement,
        onAudioFallback: (reason) => setAudioFallbackWarning(`Exported without enhanced audio: ${reason}`),
        onProgress: (frac, phase) => setRender({ busy: true, frac, phase }),
      }, annotations);
```

Also find the start of `exportRedacted` to clear any stale warning from a prior export attempt:
```ts
  const exportRedacted = async () => {
    const v = videoRef.current; if (!v) return;
    setRender({ busy: true, frac: 0, phase: 'frames' }); setErr(null);
```
Replace with:
```ts
  const exportRedacted = async () => {
    const v = videoRef.current; if (!v) return;
    setRender({ busy: true, frac: 0, phase: 'frames' }); setErr(null); setAudioFallbackWarning(null);
```

- [ ] **Step 3: Render the warning**

Find:
```tsx
          {render && <div className="text-[9px] text-rmpg-500">Runs in your browser — keep this tab open. Short clips take a minute or two.</div>}
          {err && <div className="text-[10px] text-red-400">{err}</div>}
```
Replace with:
```tsx
          {render && <div className="text-[9px] text-rmpg-500">Runs in your browser — keep this tab open. Short clips take a minute or two.</div>}
          {audioFallbackWarning && <div className="text-[10px] text-amber-400">{audioFallbackWarning}</div>}
          {err && <div className="text-[10px] text-red-400">{err}</div>}
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/RedactionStudio.tsx
git commit -m "feat(video-editor): wire audio enhancement checkbox into export, surface fallback warning"
```

---

### Task 13: Full verification pass

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck` — expect no errors (this program touched no Worker files, but confirm nothing else regressed).

- [ ] **Step 2: Node tests**

Run: `npx vitest run` — expect all pass (no Worker-side changes in this plan, so this should be unaffected).

- [ ] **Step 3: Client typecheck**

Run: `cd client && npx tsc --noEmit` — expect no errors.

- [ ] **Step 4: Client tests**

Run: `cd client && npx vitest run` — expect all pass, including new `annotations.test.ts` and `exportPresets.test.ts`, and unchanged `regions.test.ts`/`renderRedacted.test.ts`/`blur.test.ts`.

- [ ] **Step 5: Client build**

Run: `cd client && npx vite build` — expect success.

- [ ] **Step 6: Manual browser verification**

In a live browser session:
- **Speed**: open a video in `VideoPlayer`, change the speed selector, confirm playback actually speeds up/slows down. Open Redaction Studio, set export speed to 2x, export a short clip, confirm the downloaded file plays back faster than the source.
- **Annotations**: in Redaction Studio, add an arrow, a highlight, and a text label at different playhead positions; confirm each shows in the live preview overlay at the right time range; export and confirm all three are actually burned into the output video (not just the preview).
- **Presets**: apply "Court-Ready" and confirm style/strength/speed/audio-enhancement-checkbox all update together; apply "Quick Share" and confirm the same; confirm manually changing a control afterward still works (preset isn't a lock).
- **Audio enhancement**: in VideoPlayer, toggle the AUDIO button on a video with audio and confirm a perceptible difference (louder/clearer) without the video going silent when toggled off. In Redaction Studio, check "Enhance audio in export," export a clip, and confirm the downloaded file actually has audio (previously exports were silent/video-only) — if the browser used for testing can't support the audio path, confirm the fallback warning appears and the export still succeeds video-only rather than failing.
