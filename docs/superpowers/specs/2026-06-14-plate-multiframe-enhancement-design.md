# Multi-frame plate enhancement — interactive "zoom & enhance" for blurry footage plates

- **Date:** 2026-06-14
- **Status:** Draft (awaiting user review)
- **Author:** Claude (brainstormed with Christopher Zamora)
- **Branch:** `claude/lucid-haslett-e97ab6`
- **Program context:** Sub-project **#1 of the footage-plate-repair program**. The
  operator chose **"both"** — an automatic pipeline pre-pass *and* a manual deep-repair
  tool — and **manual deep-repair first**. This spec is the manual tool only; the
  automatic footage→ALPR pre-pass is a separate later sub-project (#2). Builds on the
  FlexCam footage program ([2026-06-14-flexcam-footage-foundation-design.md], the
  `ffmpeg.wasm` stitching plan), the live Roboflow ALPR pipeline
  ([2026-06-14-alpr-fast-scan-design.md]), and reuses the **85% acceptance gate** from
  the advanced vehicle scanner ([2026-06-14-advanced-vehicle-scanner-design.md]).

---

## Problem

Dashcam / footage plates are routinely **blurry, low-resolution, or motion-smeared** —
exactly the frames single-shot ALPR OCR (GLM-OCR in the Roboflow workflow) fails on. A
still-photo ALPR has nothing more to work with. But **video gives the same plate across
many frames**, each with slightly different sub-pixel sampling and noise. Fusing those
frames recovers detail no single frame contains. There is currently no tool to do this,
so an officer staring at an unreadable plate in footage has no recourse.

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Trigger model (program) | **Both** — auto pipeline pre-pass + manual deep-repair |
| Build order (program) | **Manual deep-repair first** (this spec); auto pre-pass = #2 |
| Where compute runs | **Client-side, $0** — reuses `ffmpeg.wasm`; no new service/credits |
| Core technique | **Multi-frame super-resolution** (register + stack many frames), the video-specific win — not single-frame restoration |
| Registration engine | **OpenCV.js (wasm)**, lazy-loaded (~8 MB) only when the tool opens — phase-correlation / ECC alignment; never in the normal bundle |
| Frame extraction | **`ffmpeg.wasm` PNG extraction** (frame-accurate), not HTML5-video seeking (keyframe-snapping is imprecise) |
| OCR after fusion | **Reuse `POST /api/alpr/capture`** — same records / screening / 85% gate |
| Acceptance | Enhanced reads pass the **same ≥85% gate**, but carry an `enhanced=true` provenance flag; never silently asserted as ordinary fact |
| Evidentiary handling | **Original frames always retained**; composite stored as a clearly-labeled *derived* artifact with full method provenance; reproducible |
| Entry points | **All three** in #1: FlexCam footage player, ALPR capture detail, `PlateLogPage` |

## Goal

An officer reviewing footage can box an unreadable plate, hit **Enhance**, and get a
sharp multi-frame composite plus an OCR read with confidence — entirely client-side at
$0 — flowing into the existing records/screening pipeline behind the 85% acceptance gate,
with the original always retained and the result labeled "AI-enhanced, derived."

### Non-goals

- The **automatic footage→ALPR pipeline pre-pass** (sub-project #2).
- Single-frame restoration models (Workers AI / Roboflow upscale block) — not needed when
  fusion is available; a possible later fallback for true stills, deferred.
- Repair-cost / insurance valuation, vehicle damage assessment (advanced-scanner spec).
- A trained super-resolution CV model — OpenCV.js classical registration + stacking is v1.
- Continuous/live-video scanning.

---

## Architecture

Everything heavy is **client-side**. The Worker change is thin (provenance persistence +
reuse of the existing capture endpoint).

```
FlexCam footage player / capture detail / PlateLogPage
  → open PlateEnhancer modal
  → operator scrubs to plate, draws a box on the reference frame
  → Enhance:
      plateFusionEngine.ts (impure boundary):
        1. ffmpeg.wasm: extract reference ± N frames as PNG (frame-accurate)
        2. OpenCV.js: for each frame, locate the plate crop near the box
                      (template match / phase-correlation around the box)
        3. OpenCV.js: sub-pixel register every crop to the reference
        4. fuse via plateFusion.ts (pure math):
             upsample (≈4×) → robust stack (outlier-rejecting mean/median)
             → unsharp mask + CLAHE contrast
        5. quality score = sharpness/edge-energy gained vs. reference
  → before/after split shown + tunable strength slider
  → POST composite (multipart) to /api/alpr/capture with provenance fields
  → records/screening/85%-gate run server-side; read + confidence returned
  → operator Accept / Correct; result tagged "enhanced — derived"
```

### Why this stage order matters

Sub-pixel **registration (step 3) is where fusion lives or dies** — stacking misaligned
crops just produces a sharper *blur*. OpenCV.js gives robust phase-correlation/ECC
alignment out of the box, which is why we take the wasm dependency rather than hand-roll
it in WebGL.

---

## Components

### Client

| Unit | Purpose | Depends on |
|------|---------|-----------|
| `client/src/utils/plateFusion.ts` | **Pure, testable core**: box/scale math, frame-weighting, the robust-stack reducer, sharpening params, and the `qualityScore()` metric. No DOM, no wasm. | nothing (pure) |
| `client/src/utils/plateFusionEngine.ts` | **Impure boundary**: lazy-load OpenCV.js + `ffmpeg.wasm`; frame extraction, registration, upscale; delegates math to `plateFusion.ts`. | OpenCV.js, ffmpeg.wasm, `plateFusion.ts` |
| `client/src/components/PlateEnhancer.tsx` | Modal UI: frame scrubber, draw-box canvas overlay, before/after split, strength slider, read+confidence panel, Accept/Correct. | `plateFusionEngine.ts`, `apiPostForm` |
| Entry-point wiring | FlexCam footage player (paused-frame "Enhance plate"), ALPR capture detail, `PlateLogPage`. | `PlateEnhancer.tsx` |

**Lazy-load contract:** OpenCV.js (~8 MB) and `ffmpeg.wasm` load **only** on first open of
`PlateEnhancer`, never at app boot — the normal bundle is untouched. Show a one-time
"loading enhancement engine" state.

### Worker / data

- **Reuse `POST /api/alpr/capture`** with added optional multipart fields:
  `source_type='footage_enhanced'`, `source_ref` (footage/trip id or "still"),
  `enhancement_method` (JSON: frame_count, scale, params), `timestamp_ms`, `box` (JSON).
  No new screening path.
- **Migration `00XX_alpr_enhancements.sql`** — provenance row:
  `id, capture_id, source_type, source_ref, timestamp_ms, box_json, frame_count,
   method_json, original_r2_key, enhanced_r2_key, quality_score, created_at,
   created_by`. Both the **original reference frame** and the **enhanced composite** are
  written to R2 (`UPLOADS`, prefix `alpr/enhanced/`).
- The route reconciles the table + columns at runtime via the existing
  `columnExists()`/`ensureTable` pattern, **and** the DDL is applied directly to live D1
  `785de7ae` after merge (deploy migration apply is `continue-on-error`).

---

## Evidentiary integrity

This is a police RMS feeding court export, so derived imagery must be handled carefully:

1. **Originals always retained.** The reference frame (and the fact that N source frames
   were used) is persisted; the composite never overwrites or replaces source imagery.
2. **Composite is a labeled derived artifact.** `alpr_enhancements.method_json` records
   exactly how it was produced (frame range, scale, stack/sharpen params) so it is
   **reproducible** and defensible.
3. **Same 85% acceptance gate, with provenance.** An enhanced read ≥0.85 is accepted but
   carries `enhanced=true` so the UI always shows "AI-enhanced — derived from footage,"
   never an unmarked observed fact. Sub-0.85 → **hold-for-review**; stolen/watchlist
   screening still runs, hits flagged **"UNCONFIRMED — verify plate."**
4. **Attribution.** `created_by` records which officer ran the enhancement.

---

## Error handling

- **OpenCV.js / ffmpeg.wasm fail to load** → tool shows an error, disables Enhance; no
  app-level crash (lazy boundary is isolated).
- **Too few usable frames** (e.g. one frame, or all keyframe-identical) → fall back to a
  single-frame upscale+sharpen, clearly labeled "single-frame — low confidence."
- **Registration fails / frames too divergent** (vehicle moving fast, motion blur swamps
  detail) → reject outlier frames; if too few remain, surface "could not align —
  try a tighter box or a slower segment."
- **OCR returns nothing** → still store the composite + provenance; operator can hand-key
  the plate (Correct path), which records as an officer-entered value, not AI-asserted.
- All server writes follow the existing best-effort/`try-catch` pattern so a provenance
  write failure never blocks the screening result.

---

## Testing

- **vitest** (`client/`, runs in CI) on `plateFusion.ts` pure helpers: robust-stack
  reducer (outlier rejection), `qualityScore()` monotonicity, box/scale math, weighting.
- OpenCV.js / ffmpeg.wasm calls are the impure boundary — **verified manually** against a
  real blurry plate clip (a known-plate footage sample), not unit-mocked.
- Worker: typecheck (no Worker test suite yet); smoke the new capture fields locally.

---

## Build sequence

1. `plateFusion.ts` pure core + vitest (TDD: define the stack/quality contract first).
2. `plateFusionEngine.ts` — lazy OpenCV.js + ffmpeg.wasm extraction/registration/fusion.
3. `PlateEnhancer.tsx` modal + before/after + Accept/Correct.
4. Migration `alpr_enhancements` + `/api/alpr/capture` provenance fields + R2 writes.
5. Wire the three entry points (footage player, capture detail, PlateLogPage).
6. Bump `client/public/sw.js` `CACHE_NAME`; apply migration to live D1 after merge.

## Open questions / fast-follows

- **Sub-project #2 (auto pre-pass):** reuse `plateFusion.ts` in a headless per-plate
  tracker over the footage→ALPR pipeline so the *whole feed*'s read rate lifts
  automatically. Out of scope here; this spec deliberately keeps the engine pure and
  UI-agnostic so #2 can reuse it.
- **Deblur vs. super-res weighting:** start with stack+unsharp; if motion blur dominates,
  consider adding a Wiener/Richardson–Lucy deconvolution step (still client-side) in a
  later iteration.
