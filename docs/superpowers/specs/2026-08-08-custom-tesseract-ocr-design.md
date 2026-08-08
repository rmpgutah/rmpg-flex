# Custom Fine-Tuned Tesseract OCR (design)

**Date:** 2026-08-08
**Context:** Serve Intake OCR (`docs/superpowers/specs/2026-07-26-serve-intake-ocr-enhancement-design.md`, `docs/superpowers/specs/2026-08-08-workers-ai-only-ocr-ab-design.md`)

## 1. Background

RMPG Flex's serve-intake OCR pipeline currently routes through `callAi()`: Claude vision → OpenAI → Cloudflare Workers AI, all reached through hosted inference APIs. A separate, already-in-flight effort (`2026-08-08-workers-ai-only-ocr-ab-design.md`, tooling shipped, A/B not yet run) measures whether Claude/OpenAI can be dropped in favor of Workers AI alone.

This design is a **third, independent option**: rather than choosing among hosted providers, train and self-host a Tesseract engine fine-tuned specifically on RMPG's document layouts (subpoenas, court dockets, field sheets). The motivation is **data sovereignty** — even Cloudflare Workers AI is a hosted inference API operated by a vendor; a self-hosted, self-trained Tesseract instance keeps every byte of a legal document's OCR processing inside infrastructure RMPG operates end-to-end, with no vendor in the loop at all.

**Precedent this design follows:** this repo has now twice established the pattern of gating any OCR change on a real, measured A/B against a fixture corpus before adoption (the 2026-07-26 text-model A/B, the 2026-08-08 Workers-AI-vs-Claude/OpenAI A/B). A self-hosted model is not exempt from this — it earns its place in the chain the same way, or it doesn't ship.

**Prerequisite confirmed working today:** Cloudflare Containers deploy successfully on this Worker as of 2026-08-08 (see `docs/superpowers/plans/2026-08-08-workers-ai-only-ocr-ab.md`'s sibling incident — the PDF Tools container's two real blockers, a missing API token permission and a stale orphaned application, are both resolved and the container is live in production). This design reuses that exact, now-proven container pattern.

## 2. Design

### 2.1 Training pipeline (manual, local, one-time/periodic)

Fine-tuning runs locally using the `tesstrain` tooling already available in a full Tesseract source checkout (`/Users/rmpgutah/Desktop/tesseract/`, includes `src/training/`). This is not automated or triggered by CI — it's an operator-run process, mirroring how `scripts/serve-intake-model-ab.ts` is "run deliberately, not in CI."

Inputs: a labeled corpus of real RMPG document images (subpoenas, dockets, field sheets) paired with verified ground-truth transcriptions. Output: a fine-tuned `.traineddata` file, Tesseract's standard model format.

### 2.2 Labeled corpus storage (new restricted R2 bucket)

A new R2 bucket (binding e.g. `TESSERACT_TRAINING`, following the exact `[[r2_buckets]]` pattern already used for `MAP_DATA`/`UPLOADS`/`DOWNLOADS` in `wrangler.toml`), access-gated to `admin`/`manager` roles only (matching the existing role-gate pattern in `src/routes/pdfTools.ts`). Layout: `training-corpus/<doc-id>/image.<ext>` + `training-corpus/<doc-id>/ground-truth.txt`, plus the trained model itself at `models/<version>/tesseract.traineddata`.

**Real documents, not synthetic fixtures, live here** — unlike the checked-in `.svg`/`.png` A/B fixtures (which are synthetic and safe to commit to a public-ish git repo), real labeled training documents contain actual client legal-process content and must never be checked into git. R2 with role-gated access is the storage boundary for exactly this reason.

A small one-off script (mirroring `scripts/generate-vision-ab-fixtures.ts`'s shape) uploads each labeled pair from an operator's local machine into this bucket. No new admin UI page is built for this — it happens a handful of times, not per-document in a live workflow, so a script is proportionate and a UI would be over-engineering.

### 2.3 Inference container (`TesseractOcrContainer`)

A new Cloudflare Container, following the `PdfToolsContainer` pattern exactly:
- New `containers/tesseract-ocr/Dockerfile` — installs the fine-tuned `tesseract-ocr` binary + the custom `.traineddata` file (pulled from the R2 bucket at image-build time, or baked in at container-build time — TBD in the implementation plan, since this affects how model updates get shipped).
- New `[[containers]]` + `[[durable_objects.bindings]]` block in `wrangler.toml`, new DO class `TesseractOcrContainer`, new migration tag continuing the existing chain (`v1 → v1-pdftools → v2-voicehub → v3-alerthub → v4-deepresearch → ...` — the implementation plan must check the current tag high-water mark before picking the next one).
- Worker calls it via `getContainer(c.env.TESSERACT_OCR, 'shared')` + `container.fetch(...)`, same shape as `src/routes/pdfTools.ts`.
- Same `sleepAfter`/`pingEndpoint` health-probe convention.

### 2.4 A/B integration (no new harness)

Add `tesseract-custom` as a fifth candidate row in `scripts/serve-intake-vision-ab.ts` (alongside the two Workers AI vision models and Claude/OpenAI vision), calling the new container's HTTP endpoint the same way `runWorkersAiVision` calls Workers AI directly. Same fixture images, same `expected-vision.json`, same scoring rubric — no new test framework.

### 2.5 Production wiring (deferred, evidence-gated)

**Not part of this design's initial scope.** Per the established pattern, `callAi()`/`extractVision()` are not touched until the custom Tesseract candidate's A/B score is measured and shown to meet or beat the current incumbent's score on the fixture corpus. If it does, wiring is a small, separate follow-up (a new `providers` option value or a dedicated pre-check before the existing chain) — written once real numbers exist, not guessed at here.

## 3. Non-goals

- No change to `callAi()`'s `DEFAULT_CHAIN` or any production provider selection in this design — this ships training tooling, storage, and a measurable candidate, not a production behavior change.
- No new admin UI for corpus management (script-based upload is sufficient for the expected low frequency of use).
- No commitment that Tesseract will win — this design explicitly allows for the outcome "measured, didn't clear the bar, stays unused," the same way the Workers-AI-only design already accepted for its own candidates.
- No automated/CI-triggered training — fine-tuning stays a deliberate, operator-run, local process.

## 4. Open questions for the implementation plan

- Exact mechanism for getting the `.traineddata` file into the container image (baked in at Docker build time vs. fetched from R2 at container startup) — affects how model updates get shipped without a full container rebuild.
- Next free Durable Object migration tag (must be checked against the live `wrangler.toml` migrations list at implementation time, not assumed here).
- Minimum labeled-corpus size before a first fine-tuning attempt is worth running (not specified here — a training-methodology question, not an infrastructure one).

## 5. Testing

- The training pipeline itself is a manual, human-verified process — not unit-tested.
- The R2 upload script and the new A/B candidate function are testable the same way existing sibling scripts are: type-checked standalone (per the pattern in `docs/superpowers/plans/2026-08-08-workers-ai-only-ocr-ab.md`'s Task 1/Task 3), not run live in CI.
- The container itself follows `PdfToolsContainer`'s existing degrade-gracefully contract — a route calling it is covered by the same try/catch pattern, no new test type required.
