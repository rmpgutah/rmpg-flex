# ALPR fast-scan — plate-first, enrich-after

- **Date:** 2026-06-14
- **Status:** Draft (awaiting user review)
- **Author:** Claude (brainstormed with Christopher Zamora)
- **Branch:** `claude/exciting-elion-a4c43a`
- **Priority:** Ships **before** the ClearPath→ALPR program (A→B→C); Phase C reuses this fast/enrich split.

---

## Problem

The live, in-the-field ALPR scan is too slow. Both scan surfaces —
the mobile **field camera** ([FieldCameraPage.tsx:255](../../../client/src/pages/mobile/FieldCameraPage.tsx))
and the **plate-log scanner** ([PlateLogPage.tsx:111](../../../client/src/pages/PlateLogPage.tsx)) —
`POST /api/alpr/capture`, which **blocks on the heavy `alpr-vehicle-details-capture`
workflow (73 outputs, multiple Gemini/OpenAI/GLM passes + risk score + investigation
report)**. The officer waits many seconds for a result that is mostly vehicle-attribute
enrichment they don't need instantly.

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| What's slow | The live **field + mobile single-shot scan** (`/api/alpr/capture`) |
| Approach | **Plate-first, enrich-after** |
| Enrichment delivery | **Auto in background** (server `ctx.waitUntil`, client re-fetches once) |
| Sequencing | Ship this **first**, before ClearPath A→B→C |

## Goal

Point-and-scan returns the **plate + state + stolen/watchlist hit in ~1 second**.
Make/model/color/damage fill in automatically a few seconds later without blocking the
officer, and the plate-log record always ends up fully enriched.

### Non-goals

- Continuous/live video plate reading (single-shot only; possible future follow-up).
- Changing the ClearPath pipeline (separate program; it will reuse this split in Phase C).
- On-device/client-side OCR (server-side lean workflow is the fast path).

---

## Architecture

```
Field camera / Plate-log scanner
   │  (1) downscale JPEG (~1280px) client-side
   ▼
POST /api/alpr/capture              ── FAST PATH (blocks ~1s) ──
   │  store original → R2 + field_photo (as today)
   │  run PLATE-ONLY workflow (detect → crop → OCR)         [new, lean]
   │  screenVehicle(plate)  → stolen/watchlist hits         [safety-critical, stays fast]
   │  insert alpr_captures (plate, enrich_status='pending')
   ▼  return { plate, state, hits, capture_id, enrich_status:'pending' }   ~1s
   │
   └─ ctx.waitUntil( ENRICH PATH ) ── runs after response ──
          read image from R2 → run FULL attribute workflow   [existing runAlprVehicleCapture]
          upsert vehicles_records (make/model/color/year), link call, log sighting
          update alpr_captures.enrich_status='done'
                     │
Client: shows plate+hits instantly, then re-fetches GET /api/alpr/capture/:id
        once (~2.5s later) to fill make/model/color. Plate log is complete regardless.
```

`ctx.waitUntil` is the key Worker primitive: the Worker keeps running the enrichment
(network-bound, low CPU) after the response is flushed, so the officer is never blocked
yet the record still completes even if the app closes. In Hono that's
`c.executionCtx.waitUntil(enrich(...))`.

---

## Server design

### 1. New plate-only Roboflow workflow (lean)

Create a new serverless workflow in workspace `rmpg-utah` — the user's pasted "RMPG Flex
vehicle capture" spec, **stripped to detection + crop + OCR** (no Gemini, no
bounding-box/label viz, no `roboflow_vision_events`, no annotated `output_image`):

```json
{
  "version": "1.0",
  "inputs": [{ "type": "WorkflowImage", "name": "image" }],
  "steps": [
    { "type": "roboflow_core/roboflow_object_detection_model@v3", "name": "plate_detector",
      "images": "$inputs.image", "model_id": "license-plate-recognition-rxg4e/4",
      "confidence_mode": "custom", "custom_confidence": 0.35 },
    { "type": "roboflow_core/dynamic_crop@v1", "name": "plate_crop",
      "images": "$inputs.image", "predictions": "$steps.plate_detector.predictions" },
    { "type": "roboflow_core/glm_ocr@v1", "name": "plate_ocr",
      "images": "$steps.plate_crop.crops", "task_type": "custom",
      "prompt": "Read the license plate number. Return only the plate text, no punctuation.",
      "model_version": "glm-ocr" }
  ],
  "outputs": [
    { "type": "JsonField", "name": "license_plate_text", "selector": "$steps.plate_ocr.parsed_output" },
    { "type": "JsonField", "name": "plate_predictions", "selector": "$steps.plate_detector.predictions" }
  ]
}
```

Its deployed id goes in a constant + optional env override `ROBOFLOW_FAST_WORKFLOW_ID`.
*(I'll create it via the Roboflow MCP as the first implementation step and record the id.)*

### 2. New client helper `src/utils/roboflowPlateFast.ts`

A tiny sibling to `roboflowAlpr.ts`: `runPlateFast({ apiKey, apiUrl, image })` →
`{ plate: string|null, state: string|null, predictions: AlprDetection[] }`. Reuses
`buildAlprRequest`/`unwrapOutputs`/`asDetections`/`cleanPlate`/`firstOcrString` from
`roboflowAlpr.ts` (export the pure helpers; no duplication). State is best-effort from
the OCR text (often null until enrichment). Short timeout (e.g. 12s) + 1 retry — the
fast path must fail fast, not hang (cf. the recent "shutter no longer hangs" fix).

### 3. Refactor `POST /api/alpr/capture` into fast + background enrich

Split [alpr.ts](../../../src/routes/alpr.ts)'s monolithic handler:

- **Fast (synchronous, ~1s):** store original → R2 + `field_photos` (unchanged); run
  `runPlateFast`; for each plate `screenVehicle(plate)` and fire critical-hit
  notifications (the existing screening logic, moved up); `upsertVehicleRecord` by plate
  (creates the record so it exists immediately, attributes blank); link `call_vehicles`
  + log `vehicle_sightings`; insert `alpr_captures` with `enrich_status='pending'`.
  **Return** `{ success, id, vehicles:[{plate,state,hits,vehicle_record_id}], hits,
  enrich_status:'pending', image_url }`.
- **Background (`c.executionCtx.waitUntil`):** re-read image bytes from R2; run the
  existing `runAlprVehicleCapture` (full attribute workflow); for each returned vehicle
  `upsertVehicleRecord` to **fill** make/model/color/year on the records created in the
  fast path; update `alpr_captures` (attributes + `raw_json` + `annotated_image_key` +
  `enrich_status='done'`). Wrapped in try/catch → on failure set
  `enrich_status='failed'` (never throws into the void).

Preserve today's behaviour: `capture_id` idempotency, call/incident attachment,
`disable_rmpgutah_api` default, R2 prefixes, role gate.

> **Cost note:** this is **two Roboflow runs per scan** (cheap plate-only + the heavy
> enrich). Accepted for v1 — the heavy one is off the critical path. **Fast-follow
> (Phase C-aligned):** switch enrichment to the leaner new "vehicle capture" workflow
> (needs a ~30-line `vehicle_attributes` parser) to cut enrich cost + time. Tracked,
> not in this PR.

### 4. Schema — `alpr_captures.enrich_status`

Add one column `enrich_status TEXT` (`pending|done|failed`), created via migration
`0113_alpr_enrich_status.sql` **and** reconciled at boot in `ensureAlprSchema`
(append to the existing `ALPR_EXTRA_COLUMNS` self-heal loop). Apply directly to live
`785de7ae` after merge. `shapeCapture` returns `enrich_status` so the client can poll it.

*(Note: this `0113` and the ClearPath Phase-A `0113_clearpathgps_device_mappings.sql`
collide on prefix. Whichever lands first takes `0113`; the other renumbers to `0114`
pre-merge. Duplicate prefixes are tolerated in this repo but avoid it when easy.)*

---

## Client design

### 1. Downscale helper `client/src/utils/downscaleImage.ts`

`downscaleImage(blob, maxDim=1280, quality=0.85): Promise<Blob>` using
`createImageBitmap` + `OffscreenCanvas` + `convertToBlob` (mirrors the proven pattern in
[pdfStaticMap.ts](../../../client/src/utils/pdfStaticMap.ts)). Skip if already small.
Plates are legible far below full sensor resolution, so this cuts upload + inference time
with no accuracy loss.

- **FieldCameraPage:** the capture already canvases the photo to stamp GPS/time
  ([photoStamp.ts](../../../client/src/utils/photoStamp.ts)); add the max-dimension clamp
  in that same pass (one canvas, not two).
- **PlateLogPage:** downscale before building the `FormData`.

### 2. Two-stage UX (both surfaces)

- On the fast response: show **plate + state + a red hit banner** immediately; render a
  subtle "Identifying vehicle…" chip while `enrich_status==='pending'`.
- Re-fetch `GET /api/alpr/capture/:id` **once** after a short delay (~2.5s); if still
  `pending`, retry once more (~3s). When `done`, fill make/model/color/year and drop the
  chip. (Bounded: at most 2 polls; no infinite loop.)
- Types: `AlprScanResult` gains `enrich_status` and makes attribute fields optional on
  the first response.

---

## Performance targets

- **Fast response p50 ≈ 1–1.5s** (downscaled upload + plate detect + GLM-OCR + screen).
- **Enrichment completes in background ≈ 3–6s**, invisible to the officer.
- Hard fast-path timeout so a stalled scan returns an error, never hangs.

## Testing

- `roboflowPlateFast` response parsing (nested OCR `[["ABC 123"]]` → `ABC123`; no plate → null).
- `downscaleImage`: large blob → capped dimensions; small blob passes through.
- `enrich_status` transitions (`pending`→`done`/`failed`); `shapeCapture` exposes it.
- Existing `tests/roboflowAlpr.test.ts` helpers stay green after exporting pure fns.
- Worker route harness is still a repo gap (typecheck-only); cover pure logic.

## Security & correctness

- Hit screening (`screenVehicle`) runs in the **fast** path — a stolen plate still
  alerts within ~1s.
- Background enrich is best-effort and isolated (try/catch → `enrich_status='failed'`);
  it can never crash the request or the Worker.
- No base64 images logged; R2 prefixes + role gate unchanged.

## Rollout & verification

1. Create the plate-only workflow in `rmpg-utah`; record its id (constant + optional
   `ROBOFLOW_FAST_WORKFLOW_ID`). `ROBOFLOW_API_KEY` already set.
2. Merge → deploy. Apply `0113_alpr_enrich_status` directly to live `785de7ae`; confirm
   with `pragma_table_info('alpr_captures')`.
3. **Bump `CACHE_NAME` in `client/public/sw.js`** (client changes ship — required).
4. Verify in a real browser (WAF blocks curl): open the mobile field camera, scan a
   plate → plate + any hit appears in ~1s, then make/model/color fills in a moment later;
   confirm the `alpr_captures` row goes `pending`→`done`.

## Open items

- Confirm/record the fast workflow's deployed id (first implementation step).
- Decide later (Phase C): move enrichment to the leaner new workflow to cut the 2x cost.
- `state` extraction quality from OCR text in the fast path (acceptable as best-effort;
  enrichment refines it).
