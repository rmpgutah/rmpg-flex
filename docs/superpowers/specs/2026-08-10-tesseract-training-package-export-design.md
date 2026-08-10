# Tesseract Training Package Export — Design

**Date:** 2026-08-10
**Status:** Approved for planning

## Context

The Tesseract Learning portal (shipped across two prior PRs) lets admins correct OCR
text, mark boxes, leave review notes, submit corrections to `tesseract_training_corpus`,
and approve them. None of that data has ever actually been fed into `tesstrain` (the real
Tesseract fine-tuning tool) — the original design's explicit non-goal kept that manual.

This spec keeps that non-goal intact — **tesstrain itself still runs manually, outside
this repo, on an operator's own machine** — but closes the gap between "corpus exists in
D1/R2" and "an operator can actually start a real training run" by having the portal
produce a ready-to-run package on demand: an operator clicks a button, downloads a zip
already shaped exactly the way `tesstrain` expects, with the exact commands to run it
written out. No new infrastructure, no long-running Worker job, no external server.

**Explicit non-goal, unchanged:** this does not execute `tesstrain`, does not require
a GPU/CPU-heavy background job anywhere in this repo, and does not touch
`tesseract_ocr_primary`.

## 1. What the package contains

`tesstrain`'s standard training input is a single directory of `<id>.png` (or `.tif`/
`.jpg`) + `<id>.gt.txt` (ground-truth text) pairs — it generates the lower-level
box/lstmf training files itself from that. This is EXACTLY the shape
`tesseract_training_corpus` submissions already produce in R2
(`training-corpus/{document_id}/image.{ext}` + `training-corpus/{document_id}/ground-truth.txt`,
written by `submitDocumentToCorpus()`), so no format translation is needed — only
**approved** rows (`approval_status = 'approved'`) are eligible, per the design's existing
approval gate meaning "training-ready."

Box annotations (`tesseract_box_annotations`) and review notes
(`tesseract_review_annotations`) are **not** included — they aren't in a format a
standard `tesstrain` run consumes, per the brainstorming decision. A future spec can
revisit line-level box training as its own, separate effort.

The zip's internal layout:
```
rmpg-ground-truth/
  42.png
  42.gt.txt
  57.png
  57.gt.txt
  ...
README.md
```
`README.md` is generated fresh per package with the exact commands:
```markdown
# RMPG Flex — Tesseract Training Package

Generated: <ISO timestamp>
Documents included: <N>

## To train

1. Clone tesstrain if you haven't already:
   git clone https://github.com/tesseract-ocr/tesstrain.git
   cd tesstrain

2. Extract this package's rmpg-ground-truth/ folder into tesstrain's data/ directory:
   data/rmpg-ground-truth/

3. Run training (requires the stock `eng` traineddata as the starting point):
   make training MODEL_NAME=rmpg START_MODEL=eng TESSDATA=/usr/share/tesseract-ocr/5/tessdata GROUND_TRUTH_DIR=data/rmpg-ground-truth

4. The resulting data/rmpg.traineddata is the fine-tuned model. Upload it to:
   rmpg-flex-tesseract-training/models/latest/tesseract.traineddata
   (this is the R2 key scripts/fetch-tesseract-model.sh looks for on the next deploy)
```

## 2. Schema — `tesseract_training_runs`

New migration `migrations/0235_tesseract_training_runs.sql`:
```sql
CREATE TABLE IF NOT EXISTS tesseract_training_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_by INTEGER NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  document_count INTEGER NOT NULL,
  document_ids_json TEXT NOT NULL,
  r2_key TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tesseract_training_runs_generated_at ON tesseract_training_runs(generated_at DESC);
```
`document_ids_json` is a JSON array of the `serve_intake_document_id`s actually bundled —
lets a future audit answer "was document X ever included in a training run" without
re-deriving it from the zip.

## 3. Routes (extend `src/routes/tesseractTraining.ts`)

- **`POST /api/tesseract-training/runs`** (admin/manager): queries every
  `tesseract_training_corpus` row with `approval_status='approved'`, joined enough to get
  each row's `serve_intake_document_id`. For each, lists R2 under
  `training-corpus/{id}/` (via `bucket.list({prefix})`, the established pattern in this
  repo — not by re-deriving the extension from `serve_intake_documents.file_type`, so the
  export doesn't depend on that row still existing/unchanged) to find the image object and
  the `ground-truth.txt` object, and adds both to an in-memory zip via `fflate`. Writes the
  finished zip to `TESSERACT_TRAINING` under `training-runs/{run_id}/package.zip`, inserts
  the `tesseract_training_runs` row, returns `{ id, document_count }`.
  - **Zero eligible documents → 400**, not an empty/pointless zip — `{ error: 'No approved documents to package', code: 'NOTHING_TO_TRAIN' }`.
  - Building the zip in-memory is bounded by how much an admin/manager has actually
    approved; there is no pagination concern at the size this portal produces documents
    at (dozens–low hundreds of scanned documents, each a few hundred KB), so no chunking
    or streaming-zip complexity is needed for this iteration.
- **`GET /api/tesseract-training/runs`** (admin/manager): paginated list of past runs
  (`id, generated_at, generated_by, document_count`), newest first.
- **`GET /api/tesseract-training/runs/:id/download`** (admin/manager): looks up the run's
  `r2_key`, streams that exact saved zip back with
  `Content-Disposition: attachment; filename="rmpg-training-<id>.zip"`.

## 4. UI (extend `TesseractTrainingPage.tsx`)

A new section below the existing coverage dashboard panel (not a new page — this stays
inside the same admin surface):
- A **"Start Training Run"** button, disabled with an inline note when
  `stats.total_approved === 0` ("Approve at least one document before starting a training
  run").
- A **history table** (timestamp, document count, a Download link per row), loaded via
  `GET /runs` on mount and refreshed after a successful "Start Training Run" click —
  matching the existing dashboard-panel refresh convention (Task 6 of the prior plan).
- Clicking "Start Training Run" calls `POST /runs`, shows a brief loading state (this is a
  synchronous request — the zip is built and returned within one HTTP round trip, no
  polling/job-status UI needed), then prepends the new run to the history table.

## Testing

- `tests/tesseractTrainingRuns.test.ts` — `POST /runs` with a mix of approved/pending
  documents (only approved ones bundled), the zero-eligible-documents 400 case, and that
  the R2 write + D1 insert both happen (or neither does, on a mid-build failure — matching
  this repo's established "write storage before recording existence" ordering convention
  already used by `submitDocumentToCorpus`). `GET /runs` pagination.  `GET /runs/:id/download`
  streaming a previously-saved zip back byte-for-byte.
- `client/tests/` — button disabled state when `total_approved === 0`; history table
  renders rows from a mocked `GET /runs` response.

## Out of scope

- Actually running `tesstrain` (still manual/local, unchanged non-goal).
- Box-annotation-based training data (only whole-document approved corpus rows are
  packaged).
- Automatic re-deployment of a fine-tuned model — uploading the resulting
  `tesseract.traineddata` to R2 after a local training run stays a manual step (the
  generated README documents the exact R2 key to use, per the existing
  `scripts/fetch-tesseract-model.sh` convention).
- Any change to `tesseract_ocr_primary` or the gated OCR leg.
