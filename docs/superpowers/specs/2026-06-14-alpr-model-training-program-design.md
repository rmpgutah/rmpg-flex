# ALPR vision-LoRA program — one multi-task model, trained on the dossier, run on the edge

- **Date:** 2026-06-14
- **Status:** Draft (awaiting user review)
- **Author:** Claude (brainstormed with Christopher Zamora)
- **Branch:** `claude/lucid-haslett-e97ab6`
- **Program context:** Sub-project of the footage-plate-repair program. **Depends on** the
  vehicle capture dossier + OCR trust layer
  ([2026-06-14-vehicle-capture-dossier-ocr-trust-design.md]) — the dossier is the
  training-data flywheel and the trust layer is where the model's reads land as a voter.
  Reuses the `training/` LoRA scaffold (serve-intake pattern: `train_lora.py`,
  `train_modal.py`, `build-dataset.ts`, `run-eval.ts`) and the `edge/` Jetson runner
  (`flex_edge`, HMAC webhooks to `/api/dashcam-ai/*`).

---

## Problem

Plate + vehicle attributes come from a general vision **LLM** (GLM-OCR + `open_ai`
`vehicle_details`) that hallucinates, reports miscalibrated confidence, and reads
make/model/year/color/type inconsistently. The operator wants a **purpose-trained model**
that understands plate formatting across all 50 states and produces reliable
make/model/year/color/vehicle-type — and wants it built with **LoRA**, on the
department's own data.

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Method | **LoRA fine-tuning** (parameter-efficient) of a pretrained **vision-language model** — not Roboflow from-scratch classifiers, not a text-only LoRA |
| Model count | **One multi-task vision-LoRA** emitting plate string + issuing-state + make/model/year/color/type in a single structured pass (satisfies "all five, including OCR" with one model) |
| Inference host | **Edge Jetson** (`edge/flex_edge`) — on-device ALPR at the footage source; **not** Workers AI (verified: Workers AI LoRA is **text-only**, cannot serve a vision LoRA) |
| Training host | **Modal GPU** via the existing `training/train_modal.py` pattern (offline; Jetson is inference-only) |
| Data engine | **Dossier flywheel** — confirmed `vehicle_capture_photos` (crops + officer-verified labels) → dataset; reuse `training/build-dataset.ts` + `verify-labels.ts` |
| Relationship to trust layer | The edge model's read is a **voter** in #2's cross-model corroboration + consensus; it does **not** bypass the 80/85% gates |
| Acceptance | Goes live only when it **beats the GLM-OCR/LLM baseline** on a held-out set (`training/run-eval.ts`); [Claude] runs eval, [You] judges |
| Division of labor | **[You]** label (confirm captures) + judge eval + provision Jetson; **[Claude]** dataset builder, training/Modal config, eval harness, edge inference engine + webhook wiring; **[Together]** label schema + acceptance bars |

## Goal

A single LoRA-fine-tuned vision-language model, trained on the department's own confirmed
captures via Modal, deployed on the in-vehicle Jetson, that reads plate + state +
make/model/year/color/type on-device — feeding the existing trust layer as a high-quality
voter, promoted only after it provably beats the current LLM baseline.

### Non-goals

- Replacing the **trust layer / dossier** (#2) — this feeds it.
- Workers AI inference for the vision model (impossible — text-LoRA only).
- Roboflow from-scratch classifiers (the LoRA route supersedes the earlier 5-model plan).
- Realtime/continuous retraining — training is operator-triggered per dataset milestone.
- A cloud GPU inference fallback (possible later; v1 is edge-only).

---

## Architecture

```
        ┌──────────── DATA FLYWHEEL ([Claude] automates, [You] labels) ──────────┐
 #2     │  D1 vehicle_capture_photos + R2 crops + officer-verified labels         │
 dossier│        │  (plate string, state, make, model, year, color, type)         │
        │        ▼  build-dataset.ts → JSONL (image + structured target)          │
        │  verify-labels.ts ([You] review) → validate-dataset.ts                  │
        └────────│───────────────────────────────────────────────────────────────┘
                 ▼
        TRAIN (Modal GPU, offline):  train_lora.py / train_modal.py
          base = open VLM (Qwen2-VL-7B or Llama-3.2-11B-Vision)
          → LoRA adapter (multi-task structured output)
                 ▼
        EVAL: run-eval.ts on held-out set vs GLM-OCR/LLM baseline
          (exact-plate match, state acc, MMY top-1, color/type acc)  ([You] judges)
                 ▼ (promote only if it beats baseline)
        EXPORT + quantize (INT4, TensorRT-LLM) → deploy to edge/flex_edge
                 ▼
        EDGE (Jetson Orin, in-vehicle):  frame/crop → vision-LoRA →
          structured ALPR record → HMAC POST (existing edge→Worker contract)
                 ▼
        Worker capture route → schema-agnostic parser → #2 TRUST LAYER:
          edge read becomes an independent voter; consensus + format validity
          unchanged; 80% package / 85% assert gates run on the derived trust score
```

### Why this shape

- **Edge inference** keeps ALPR at the footage source ($0/call, no cloud round-trip) and
  reuses the proven `flex_edge` HMAC webhook contract — the LoRA model is just a new
  TensorRT engine alongside the existing FCW/lane/object engines.
- **Modal training** mirrors the serve-intake LoRA exactly (`train_modal.py`), so the
  scaffolding, dataset format, and eval harness transfer rather than being reinvented.
- **One multi-task model** is the natural LoRA shape — a VLM already does OCR + description;
  the LoRA specializes it to *our* plates/vehicles and a *strict structured schema*.

---

## Components

### Training (`training/`, reuse + extend)

- **`build-dataset.ts`** — extend with an ALPR source: pull confirmed
  `vehicle_capture_photos` (full/vehicle/plate crops) + verified labels from D1/R2 →
  JSONL `{image, target:{plate,state,make,model,year,color,type}}`.
- **`verify-labels.ts` / `validate-dataset.ts`** — reuse for [You]'s review + pre-flight.
- **`train_modal.py`** — extend/clone for a **vision** base (the serve-intake one is text);
  LoRA config (rank, target modules) for the chosen VLM.
- **`run-eval.ts`** — ALPR metrics vs baseline: exact-plate match, per-field accuracy,
  confusion on state/color/type.

### Edge (`edge/flex_edge/`, new engine)

- **`alpr.py`** (new): load the quantized VLM+LoRA (TensorRT-LLM), `infer(frame|crop) →
  structured record`. Sits beside the existing inference stubs.
- **Uploader**: reuse `client.py` + `signer.py` (HMAC) to POST the record. New webhook
  **`/api/alpr/edge`** (HMAC-verified, mirrors `/api/dashcam-ai/*`) → routes into the
  existing capture/trust pipeline. No new storage beyond #2.

### Worker (thin)

- **`/api/alpr/edge`** webhook (HMAC) → maps the edge record into `raw_reads[]` +
  corroboration evidence for #2's `plateTrust`. The edge read is a voter (and, once
  promoted past baseline, the preferred source).
- **`model_registry`** config row: which adapter version is live, its measured
  baseline-beating metric, and provenance shown in the dossier ("edge LoRA v3, 94% holdout").
- Secret: edge HMAC key (reuse the dashcam-ai signing pattern). No `ROBOFLOW_API_KEY`
  dependency on this path.

---

## Feasibility risks (called out, not hand-waved)

- **Jetson memory.** Orin Nano (8 GB) running a 7–11B VLM needs aggressive **INT4**
  quantization via TensorRT-LLM; latency + accuracy at INT4 must be measured early. May
  force a **smaller VLM** (e.g., a 2–3B vision model) or an **Orin NX/AGX**. **Spike this
  first** — it gates the whole edge-inference premise.
- **Hardware availability.** v1 inference is edge-only, so it's bound to a Jetson actually
  being in-vehicle. Until then, the model can run in the **Modal/`run-eval` harness** for
  evaluation and (interim) batch scoring of footage server-side off-device.
- **Label volume for MMY.** Make/model/year is the data-hungry field; the flywheel fills it
  slowly. The structured target lets MMY stay sparse/partial early (train on whatever
  fields are verified per example) while plate/state/color/type mature first.

## Acceptance / eval gate

Promote the adapter only when `run-eval.ts` shows it **beating the GLM-OCR/LLM baseline**
on a held-out set, per field. A field where it loses → its output stays a **voter only**
(corroboration), not the asserted source, until a later adapter wins. No silent regressions.

## Error handling / safety

- **Edge offline / engine error** → no edge read; the cloud LLM path + trust layer handle
  the missing voter (already designed in #2).
- **Edge disagrees with cloud/LLM** → disagreement *lowers* trust (correct), surfaced
  "models disagree — verify."
- **Drift** → periodic re-eval on fresh holdout; a dropped metric pulls the adapter back to
  voter-only. [Claude] schedules, [You] reviews.

## Testing

- `build-dataset` / `run-eval` mapping + metric helpers: unit-tested (TS, vitest-style as
  in `training/`).
- Edge `alpr.py`: unit-test the record→webhook mapping + HMAC (mirror `test_signer.py`);
  model accuracy is **eval-gated**, not unit-tested.
- Worker: typecheck + smoke the `/api/alpr/edge` webhook locally.

## Build sequence

1. **Jetson INT4 VLM spike** — prove a quantized vision-LoRA runs at acceptable
   latency/accuracy on the target board. Gate.
2. `[Together]` lock the structured label schema (fields + enums; reuse #2's taxonomies).
3. `[Claude]` ALPR `build-dataset.ts` source (dossier → JSONL) + `validate-dataset` + tests.
4. `[Claude]` `train_modal.py` vision variant + first LoRA run on seed data; `run-eval.ts`
   ALPR metrics; `[You]` judges vs baseline.
5. `[Claude]` `edge/flex_edge/alpr.py` + `/api/alpr/edge` HMAC webhook + trust-voter wiring.
6. `model_registry` + dossier provenance UI; iterate adapters as the flywheel grows.

## Open questions / fast-follows

- **Base VLM choice** — Qwen2-VL vs Llama-3.2-Vision vs a smaller 2–3B model, decided by
  the Jetson spike (accuracy vs fits-in-memory).
- **Cloud GPU fallback** — host the same adapter on an external GPU endpoint for cruisers
  without a Jetson; deferred (v1 edge-only + Modal eval harness).
- **MX/border plates** — extend the state field once US-50 is solid (sample data has Sonora).
