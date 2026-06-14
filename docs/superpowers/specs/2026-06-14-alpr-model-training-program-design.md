# ALPR model-training program — five trained models fed by the dossier flywheel

- **Date:** 2026-06-14
- **Status:** Draft (awaiting user review)
- **Author:** Claude (brainstormed with Christopher Zamora)
- **Branch:** `claude/lucid-haslett-e97ab6`
- **Program context:** Sub-project of the footage-plate-repair program. **Depends on** the
  vehicle capture dossier + OCR trust layer
  ([2026-06-14-vehicle-capture-dossier-ocr-trust-design.md]) — that dossier is the
  training-data flywheel and the trust layer is where trained-model confidences land.
  Reuses the live Roboflow workspace (`rmpg-utah`) and the schema-agnostic parser
  ([2026-06-14-alpr-fast-scan-design.md] / [2026-06-14-advanced-vehicle-scanner-design.md]).
  This is a **program** (5 models), each model shipping independently.

---

## Problem

Today plate + vehicle attributes come from a **vision LLM** (GLM-OCR + `open_ai`
`vehicle_details`). It hallucinates, reports miscalibrated confidence, and reads
make/model/year/color/type inconsistently. The operator wants **trained models** that
understand plate formatting across **all 50 states** and produce reliable
make/model/year/color/vehicle-type — purpose-built recognizers, evaluated against ground
truth, rather than a general LLM guessing.

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Approach | **Train ML models** (not just a validation KB) — the KB/normalizer still exists inside the trust layer (#2); these models improve the *reads* it verifies |
| Scope | **All five** targets in scope, **including custom plate-character OCR** |
| Build order | All in scope; **work sequenced by tractability** — type+color → state → MMY → OCR — each goes live independently as it beats baseline (operator's "all five" is the destination, not "all at once") |
| Platform | **Roboflow** hosted training + serverless-workflow inference (fits the live pipeline); edge/Jetson on-device deploy is a later fast-follow |
| Data engine | **Dossier flywheel** — confirmed captures (plate/vehicle crops + verified labels) pushed to Roboflow; **auto-label** bootstrap; Universe datasets where good ones exist |
| Relationship to trust layer | Trained models are **new independent voters** in #2's cross-model corroboration; they do **not** bypass the 80/85% gates |
| Acceptance | A model goes live **only when it beats the current LLM baseline** on a held-out set ([Claude] runs eval, [You] judges) |
| Division of labor | **[You]** label/review/judge (confirming captures = labeling); **[Claude]** projects, upload automation, versioning, training runs, eval read-out, workflow, integration; **[Together]** taxonomies + acceptance bars |

## Goal

Five purpose-built, independently-evaluated recognizers — plate-character OCR, plate
issuing-state (50+DC), make/model/year, color, vehicle-type — trained from the
department's own accumulating captures, deployed behind the existing trust layer and
85% assert gate, each replacing its LLM counterpart only after it provably beats it.

### Non-goals

- Replacing the **trust layer / dossier** (#2) — this program feeds it, doesn't supersede.
- A from-scratch labeling marathon — confirming captures + auto-label is the labeling path.
- On-device/edge (Jetson) inference — noted fast-follow, not v1.
- The footage auto-capture pipeline (#2-adjacent sub-project) — independent.
- Realtime retraining; training is operator-triggered per phase.

---

## The five models

| # | Model | Roboflow project type | Input crop | Classes / output |
|---|-------|----------------------|-----------|------------------|
| 1 | **Vehicle type** | classification | vehicle crop | sedan, SUV, pickup, van, box-truck, semi, motorcycle, bus, … (fixed enum) |
| 2 | **Color** | classification | vehicle crop | ~12 canonical (black, white, silver, gray, red, blue, green, brown, gold, yellow, orange, purple) |
| 3 | **Plate issuing-state** | classification | plate crop | 50 states + DC (Mexico/Sonora + territories later) |
| 4 | **Make / Model / Year** | hierarchical classification | vehicle crop | make → model (conditioned) → year-band |
| 5 | **Plate-character OCR** | object detection (glyphs) | plate crop | 36 glyphs (0-9, A-Z), assembled left-to-right by x-position |

**Why this order:** type/color are small fixed enums (fast to usable accuracy); state is 51
classes but visually distinct (designs/colors/fonts); MMY is thousands of fine-grained
classes (hardest, most data — staged make→model→year); OCR is a detection model needing
the most careful eval against the strong GLM-OCR baseline, so it's last.

---

## Architecture

```
                 ┌──────────────── DATA FLYWHEEL ([Claude] automates) ───────────┐
 confirmed       │  D1 vehicle_capture_photos + R2 crops (plate, vehicle)        │
 capture  ──────▶│  + officer-verified labels (plate/state/make/model/color/type)│
 (#2 dossier)    │       │                                                        │
                 │       ▼  push to matching Roboflow project (upload API)        │
                 │  Roboflow projects ×5  ◀── auto-label bootstrap on raw caps    │
                 │       │            ([You] review labels)                       │
                 │       ▼  versions_generate → models_train → model_evals        │
                 │  per-model eval vs LLM baseline  ([You] judges, [Claude] runs) │
                 └───────│───────────────────────────────────────────────────────┘
                         ▼ (only models that beat baseline)
              Roboflow WORKFLOW: vehicle-detect → crops →
                 plate crop → {OCR model, state model}
                 vehicle crop → {MMY model, color model, type model}
                         ▼
              schema-agnostic parser (existing) → enhanced_alpr_record
                         ▼
              #2 TRUST LAYER: trained-model outputs become independent voters in
              cross-model corroboration; consensus + format validity unchanged;
              80% package / 85% assert gates run on the derived trust score
```

### Integration is additive, not a rewrite

The Roboflow workflow gains trained-model blocks alongside (then instead of) the LLM
blocks. The route/parser are **schema-agnostic by shape**, so new outputs map through with
minimal change. Each trained confidence is added to `raw_reads[]`/corroboration evidence in
#2 — more voters, stronger trust. Nothing about the gates or storage changes.

---

## Data strategy (the crux)

1. **Flywheel (primary).** `[Claude]` builds a pusher: confirmed `vehicle_capture_photos`
   rows → upload the relevant crop + label to the matching Roboflow project (`image_upload`
   + `annotations_save`). Officer confirmation in the dossier UI **is** the label. Grows
   automatically with usage.
2. **Auto-label (bootstrap).** `[Claude]` runs `autolabel_start` on raw/unconfirmed
   captures to pre-label; `[You]` review/correct in the Roboflow UI (direct URLs provided).
3. **Universe (supplement).** `[Claude]` forks specific Universe datasets where strong ones
   exist (MMY + color have coverage; 50-state plate-state is thin — confirmed by search, so
   that model leans hardest on the flywheel). Pinned per-model during planning.
4. **Class taxonomies `[Together]`.** Fixed enums for type/color, the 50+DC state list, and
   the make/model taxonomy (seed from NHTSA vPIC) agreed before labeling so classes are
   stable across versions.

## Per-model lifecycle ([Claude] runs, [You] judges)

`create project → seed (Universe/flywheel) → auto-label → [You] review → versions_generate
→ models_train → model_evals (mAP / accuracy / confusion matrix) → [You] approves → add
block to workflow → canary behind trust layer → promote`.

## Acceptance / eval gate

- **Detection (OCR):** mAP + per-character confusion vs a held-out set; must beat GLM-OCR
  exact-string match rate.
- **Classification (type/color/state/MMY):** top-1 accuracy + confusion matrix; must beat
  the LLM's accuracy on the same held-out set.
- A model that loses to the LLM **stays a voter only** (corroboration), not the asserted
  source, until a later version wins. No silent regressions.

## Worker / app changes (thin)

- The training/data-push automation lives in `scripts/` (Roboflow API) + possibly a cron
  to push newly-confirmed captures — **not** in the request path.
- The capture route's trust evidence (`raw_reads[]` / corroboration) gains the trained
  models' outputs; no new tables beyond #2's. A small `model_registry` config (which model
  id/version is live per target, and its measured baseline-beating metric) so the workflow
  + UI can show provenance ("state: trained model v3, 96% holdout").
- Secrets: reuse `ROBOFLOW_API_KEY`. Training is operator-triggered, not automatic.

## Error handling / safety

- **Model unavailable / low-confidence** → fall back to the LLM read for that field; trust
  layer already handles a missing voter.
- **Trained model disagrees with LLM** → that disagreement *lowers* trust (correct — it's
  real uncertainty), surfaced as "models disagree — verify."
- **Drift** → periodic re-eval on fresh holdout; a dropped metric pulls the model back to
  voter-only. `[Claude]` schedules, `[You]` reviews.

## Testing

- The data-push + registry helpers in `scripts/` get unit tests (mapping a capture →
  correct project/label; registry selection). Pure label-mapping logic is testable.
- Model quality is **eval-gated, not unit-tested** — `model_evals` metrics + `[You]`'s
  judgment are the gate.
- Worker typecheck for the registry/route changes.

## Build sequence

1. `[Together]` lock taxonomies (type, color, 50+DC states, make/model seed).
2. `[Claude]` create 5 Roboflow projects + the flywheel pusher (capture → project) + tests.
3. **Model 1 (type)** + **Model 2 (color)** full lifecycle → first live trained blocks.
4. **Model 3 (state)** — heaviest flywheel reliance.
5. **Model 4 (MMY)** — staged make→model→year.
6. **Model 5 (OCR)** — character detection, careful baseline eval.
7. `model_registry` + trust-layer voter integration + provenance UI; SW bump as client
   surfaces change.

## Open questions / fast-follows

- **Edge/Jetson deploy** of the trained models for on-device dashcam ALPR (the `edge/`
  runner) — strong fit, deferred.
- **Make/model taxonomy depth** — full vPIC (huge) vs top-N makes/models by regional
  prevalence; start top-N, expand from misclassifications.
- **MX/border plates** — add Sonora + border states to the state classifier once US-50 is
  solid (the sample data has them).
