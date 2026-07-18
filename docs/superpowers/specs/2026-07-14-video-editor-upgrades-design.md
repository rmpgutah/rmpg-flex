# Video Editor Upgrades — Design

**Date:** 2026-07-14
**Status:** Approved for planning

## Context

This is the next phase of the "full scale video editor" program for bodycam/dashcam
footage (Redaction Studio + `VideoPlayer`). AI object detection/identification already
shipped (`docs/superpowers/specs/2026-07-14-bodycam-ai-object-detection-design.md`) and
the Redaction Studio detection overhaul shipped (`docs/superpowers/specs/2026-07-14-redaction-detection-overhaul-design.md`).
This spec covers the four remaining approved phases: **Speed/playback control →
Overlay annotations → Export presets → Audio enhancement**, in that build order
(presets last-but-one so it can reference annotation/speed settings once they exist;
audio enhancement last since it's the highest architectural risk).

## Architectural grounding

The redaction export pipeline (`client/src/utils/redaction/renderRedacted.ts`) plays the
source clip in **real time**, drawing each frame to an offscreen canvas (video +
active blurred regions + evidence stamp), capturing it via `canvas.captureStream(0)` +
manual `requestFrame()`, and recording via native `MediaRecorder` — chosen after
ffmpeg.wasm proved unusable in this codebase (module-worker `importScripts()`
incompatibility, documented in that file's header comment). Critically, **the export is
currently video-only** — audio is explicitly muted and never captured
(`video.muted = true; // export silently; we never capture audio`). Every phase below is
scoped to fit this existing real-time-capture architecture rather than replacing it.

## Part 1 — Speed/playback control

**Preview** (`client/src/components/VideoPlayer.tsx`): a speed selector (0.25x, 0.5x,
0.75x, 1x, 1.5x, 2x) using the native `HTMLVideoElement.playbackRate` property — no new
capture/render logic, purely a playback control.

**Export** (`client/src/components/RedactionStudio.tsx` +
`client/src/utils/redaction/renderRedacted.ts`): `renderRedacted()`'s capture loop
already plays the source in real time to draw frames — setting `video.playbackRate`
before starting that loop makes the *output* play back at the chosen speed (2x → a
fast-motion export that also takes less real time to render, since the source finishes
faster; 0.5x → a slow-motion export). `RenderOpts` gains an optional `speed?: number`
(default 1). No change to the capture technique itself — `playbackRate` is a native
property the existing `video.play()` call already respects.

## Part 2 — Overlay annotations

**New model** (`client/src/utils/redaction/annotations.ts`, parallel to
`regions.ts`): annotations *add* visible content (arrows, text labels, highlight boxes)
rather than *obscuring* it like redaction regions, so they get their own type rather
than reusing `RedactionRegion`'s `kind` union:

```ts
export type AnnotationKind = 'arrow' | 'text' | 'highlight';
export interface AnnotationMark {
  id: string;
  kind: AnnotationKind;
  keyframes: Keyframe[];   // reuses regions.ts's Keyframe/NormBox — same
                            // time-range + interpolation logic applies
  tStart: number;
  tEnd: number;
  color: string;
  text?: string;            // required for kind: 'text'
  enabled: boolean;
}
```

Reuses `regions.ts`'s exported `interpBox`, `activeRegionsAt`-equivalent logic, and
`NormBox`/`Keyframe` types directly (imported, not duplicated) — the "position over a
time range, interpolated between keyframes" behavior is identical to redaction regions,
only the *rendering* differs (draw content vs. obscure content).

**UI** (`RedactionStudio.tsx`): a new "Annotate" mode toggle alongside the existing
redaction tools. While active: click-drag to place an arrow (start/end point) or a
highlight rectangle (`NormBox`, like a manual redaction box), or click once to place a
text label (prompts for text inline). A list mirrors the existing region list
(edit/delete), with its own color picker per mark (not tied to redaction style/strength,
since these are always visible, not blur/pixelate/box).

**Render** (`renderRedacted.ts`): `drawFrame()` already burns redaction blur +
evidence stamp per frame in a fixed order (video → redaction effects → stamp).
Annotations are inserted as one more draw step, burned **after** redaction effects but
**before** the stamp (so an annotation can point at something even inside a blurred
region's vicinity without being obscured by it, but the stamp always stays on top and
legible): arrows via canvas path + arrowhead triangle, text via `ctx.fillText` with a
readable outline/shadow for contrast, highlights via a stroked + low-alpha-filled rect.
No new capture architecture — this composes directly into the existing per-frame draw
call.

## Part 3 — Export presets

**Model**: a small static config, e.g. `client/src/utils/redaction/exportPresets.ts`:

```ts
export interface ExportPreset {
  id: string;
  label: string;
  style: RedactionStyle;
  strength: number;
  bitrate: number;
  speed: number;
  audioEnhancement: boolean;   // see Part 4 — no-op until that part ships
}
export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'court-ready', label: 'Court-Ready (full quality)', style: 'blur', strength: 14, bitrate: 10_000_000, speed: 1, audioEnhancement: true },
  { id: 'quick-share', label: 'Quick Share (smaller file)', style: 'blur', strength: 14, bitrate: 3_000_000, speed: 1, audioEnhancement: false },
];
```

**UI**: a preset dropdown in `RedactionStudio.tsx` that sets the existing
`style`/`strength`/`speed` (from Part 1) state and a new `bitrate`/`audioEnhancement`
state at once. Selecting a preset is a convenience default, not a lock — the operator
can still adjust individual controls after picking one (matches how `style`/`strength`
already work today: picking a value doesn't disable further edits).

## Part 4 — Audio enhancement

**Preview** (`VideoPlayer.tsx`): a Web Audio API processing chain — no ffmpeg.wasm
(confirmed dead end in this codebase). `MediaElementAudioSourceNode` (wrapping the
`<video>` element) → `BiquadFilterNode` (highpass, cuts low-frequency rumble/wind noise
common in bodycam audio) → `DynamicsCompressorNode` (normalizes volume swings) →
`GainNode` (operator-adjustable boost) → `audioContext.destination`. Toggle on/off;
when off, the chain is bypassed (video plays through its native audio path unmodified,
not silenced).

**Export** (`renderRedacted.ts`): this is the real architecture change — building the
same enhancement chain but routing its output to
`audioContext.createMediaStreamDestination()` instead of `audioContext.destination`,
producing a `MediaStreamTrack` that gets combined with the existing canvas video track
into one `MediaStream` (`new MediaStream([...videoTrack, ...audioTrack])`) passed to
`MediaRecorder`. This finally lifts the "video-only" limitation documented in the
file's header comment — as a direct byproduct of building the enhancement chain, not a
separate audio-muxing project.

**Risk & fallback**: combined audio+video `MediaRecorder` capture can have edge cases
(codec support gaps, occasional AV sync drift under load) that pure video capture
didn't have to handle. Scope: if audio track creation/attachment fails for any reason
(caught explicitly), fall back to the current video-only export with a visible warning
in the UI ("Exported without audio — your browser couldn't process it"), rather than
failing the whole export. This mirrors the existing pattern in `RedactionStudio.tsx`'s
`exportRedacted()`, which already degrades gracefully (custody-upload failure still lets
the local download through) rather than treating every sub-step as all-or-nothing.

**`RenderOpts` gains**: `audioEnhancement?: boolean` (default false — matches the
"video-only" status quo when not explicitly requested) and reuses `speed` from Part 1
(audio must play through the same `playbackRate`-adjusted real-time loop as video, so
the two features share one capture pass rather than each needing their own).

## Explicit scope boundary

No trimming/clip-range export and no multi-clip splice/concatenation in this phase —
explicitly deferred (user chose "Overlay annotations" over those alternatives when
scoping this spec). No AI-assisted annotation suggestions (e.g. auto-drawing an arrow at
a detected weapon) — that would cross into the already-shipped AI detection feature's
scope and is a separate future decision, not silently bundled in here.

## Testing

- Part 1: unit test that `renderRedacted()`'s speed option actually sets
  `video.playbackRate` before starting capture (mockable via a fake `HTMLVideoElement`-
  like object, following whatever test pattern `renderRedacted.ts` or its sibling
  `blur.ts`/`regions.ts` already use — check for an existing `renderRedacted.test.ts`
  before assuming one needs to be created from scratch).
- Part 2: pure unit tests on `annotations.ts` (keyframe/time-range logic, reusing
  `regions.ts`'s existing test patterns) — no canvas rendering tests (canvas drawing
  itself isn't practically unit-testable in this codebase's jsdom-based test setup, same
  constraint as the existing `applyRegionEffect`/`drawStamp` functions, which also have
  no direct render-output tests).
- Part 3: presets are static data — a smoke test confirming `EXPORT_PRESETS` entries
  have valid `RedactionStyle` values and in-range `strength`/`bitrate`/`speed`.
- Part 4: unit test the audio-chain construction logic where it can be isolated from
  real `AudioContext`/`MediaStream` APIs (jsdom doesn't implement Web Audio — expect this
  to be mostly integration-level/manual-verification territory, same constraint noted for
  the client-side video-capture utils built earlier in this program, e.g.
  `videoThumbnail.ts`/`videoAiAnalyze.ts`, which also have no automated test coverage for
  their actual browser-API interactions).
