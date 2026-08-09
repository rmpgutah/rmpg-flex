# Tesseract OCR Learning Portal + Gated Production Cutover — Design

**Date:** 2026-08-09
**Status:** Approved for planning

## Context

Prior sessions shipped Tesseract OCR infrastructure (self-hosted Container,
Worker proxy route, R2 model bucket, deploy-time model fetch) and a basic
training portal (`TesseractTrainingPage.tsx` + `tesseractTraining.ts`) that
lets admins retype OCR text as corrected ground truth. Both were explicitly
measurement-only / non-production, per their own code comments and
`docs/superpowers/specs/2026-08-08-custom-tesseract-ocr-design.md`.

This spec covers three things:

1. Fixing whatever is actually broken in the existing Tesseract container
   path (a `PbfReader`/`PbfWriter`-class bug was found and fixed twice
   elsewhere this session — the container route gets the same scrutiny).
2. Rebuilding the training portal into a real annotation tool: text
   correction (existing), bounding-box marking (new, real training data),
   and free-form visual annotation (new, human review notes only).
3. Wiring a **gated** path for Tesseract to become the primary OCR engine
   for Serve Intake image documents — flag-controlled, default OFF, flipped
   only after an A/B run against the fixture corpus is reviewed by a human.

**Explicit non-goal:** this spec does not flip Tesseract to primary. It
builds the capability and the measurement; the go/no-go call is the user's,
made after seeing real A/B numbers.

## 1. Container health audit + fix

**Investigation task:** read `src/containers/tesseractOcrContainer.ts`,
`containers/tesseract-ocr/{Dockerfile,server.py,requirements.txt}`, and
`scripts/fetch-tesseract-model.sh`, then hit `/api/tesseract-ocr/health` and
`/api/tesseract-ocr/ocr` on live (authenticated, admin role) with a real test
image. Fix whatever is actually broken — likely candidates given this
session's pattern: a Python import/dependency mismatch in `server.py`, the
model-fetch step silently landing in the wrong container path, or the
Container binding never actually receiving traffic (Workers Containers can
report "healthy" at the DO/proxy layer while the underlying container never
boots — same shape as the `PbfReader` bug: code that looks wired but was
never actually exercised end-to-end).

**Acceptance:** `GET /api/tesseract-ocr/health` returns `200` with
`tesseract_version` present, and `POST /ocr` against a real scanned-document
image returns non-empty text, both verified live (not just in Miniflare).

## 2. Data model — box ground truth vs. review notes

New migration `0233_tesseract_training_annotations.sql`:

```sql
-- Real training data: one row per marked word/line region + its corrected
-- text. Shaped so a future manual `tesstrain` run can emit a Tesseract
-- .box file directly from this table (x0,y0,x1,y1 in ORIGINAL image pixel
-- space, top-left origin — NOT tile/PDF coordinate space).
CREATE TABLE IF NOT EXISTS tesseract_box_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_intake_document_id INTEGER NOT NULL,
  x0 INTEGER NOT NULL,
  y0 INTEGER NOT NULL,
  x1 INTEGER NOT NULL,
  y1 INTEGER NOT NULL,
  corrected_text TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (serve_intake_document_id) REFERENCES serve_intake_documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tesseract_box_annotations_doc ON tesseract_box_annotations(serve_intake_document_id);

-- Review notes only: free-form strokes (arrows/circles/highlights) as a
-- JSON array of {tool, points[], color}. NEVER read by any training path —
-- purely a human-to-human "look at this" layer. One row per document
-- (whole note layer replaced on save, not appended).
CREATE TABLE IF NOT EXISTS tesseract_review_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_intake_document_id INTEGER NOT NULL UNIQUE,
  strokes_json TEXT NOT NULL,
  updated_by INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (serve_intake_document_id) REFERENCES serve_intake_documents(id) ON DELETE CASCADE
);
```

Existing `tesseract_training_corpus` (whole-document text-correction
submissions, migration `0230`) is unchanged and continues to exist alongside
these — a document can have a full-text correction AND box annotations AND
review strokes; they are independent layers, not alternatives.

## 3. Backend routes (`src/routes/tesseractTraining.ts`, extended)

- `GET /documents/:id/boxes` — list this doc's `tesseract_box_annotations`.
- `POST /documents/:id/boxes` — create one box `{x0,y0,x1,y1,corrected_text}`.
- `DELETE /documents/:id/boxes/:boxId` — remove a box (admin fixes a
  mis-drawn region without needing a full page reload).
- `GET /documents/:id/notes` — fetch this doc's review-strokes JSON (or
  `null` if none).
- `PUT /documents/:id/notes` — replace the whole strokes layer.

All five gated by the existing `requireAdminManager()` helper already in
that file. No changes to the existing `/documents`, `/documents/:id`,
`/documents/:id/image`, `/documents/:id/submit` endpoints.

## 4. Learning page rebuild (`TesseractTrainingPage.tsx`)

Layout stays list-on-left / detail-on-right (unchanged). The detail pane
gains a mode toggle above the document image: **Text** (today's textarea,
unchanged) / **Boxes** / **Notes**.

- **Boxes mode:** the doc image renders inside a wrapper with an absolutely
  positioned `<canvas>` on top, sized to match the image's rendered
  dimensions. Pointer-down starts a rectangle, pointer-up opens a small
  inline text input for the corrected text, Enter commits it via
  `POST .../boxes`. Existing boxes render as outlined rectangles (fetched via
  `GET .../boxes`); clicking one offers delete. Coordinates captured in
  on-screen pixels are converted to natural-image pixel space using the
  image element's `naturalWidth/naturalHeight` vs. `clientWidth/clientHeight`
  ratio before being sent to the API — this conversion is the one genuinely
  fiddly piece and gets its own unit test with a fixed ratio fixture.
- **Notes mode:** same canvas approach, freehand pointer-move tracing
  instead of rectangles, three tools (arrow / circle / highlight-line) via a
  small toolbar, `PUT .../notes` on an explicit Save (not on every stroke —
  avoids a request per pixel of mouse movement).

No new npm dependency — plain Canvas 2D API covers rectangles, freehand
paths, and simple arrow/circle primitives without a drawing library.

## 5. Admin entry point

`AdminPage.tsx` gets a new tab per the existing 4-edit pattern (CLAUDE.md
gotcha #16 — all four must be done together or `tsc` catches it late):

1. `TabId` union: add `'ocr_learning'`.
2. `VALID_TABS` array: add `'ocr_learning'`.
3. Tab config array: `{ id: 'ocr_learning', label: 'Tesseract OCR Learning', icon: ScanText }` (or similar existing lucide icon already imported nearby).
4. Render block: `{activeTab === 'ocr_learning' && <TesseractTrainingPage />}`.

The standalone route `/tesseract-training` (`App.tsx`) stays as-is for direct
linking — the admin tab renders the same component inline, no duplication.

## 6. Serve Intake entry points

`ServeIntakePage.tsx`:

- Tab strip becomes three tabs: `'intake' | 'schedule' | 'enforcement'`
  (extends the existing `activeTab` union at line 363).
- A small admin/manager-gated button in the page header (next to
  `PanelTitleBar`), label "OCR Learning", navigating to
  `/tesseract-training` (or `/admin?tab=ocr_learning` — matches the
  `AuditLogPage` deep-link precedent already in the codebase). Hidden
  entirely for non-admin/manager roles, same gating pattern as
  `LegalDataHunterValidateButton`.
- New `activeTab === 'enforcement'` block: a lightweight panel with its own
  sub-button to the same destination, labeled "Tesseract OCR Learning".
  This tab is otherwise empty in this iteration — it exists to satisfy the
  requested Serve Intake → Enforcement → Learning access path; no other
  Enforcement-specific functionality is in scope here.

## 7. Gated production leg in `ocrImage()`

`src/utils/serveIntakeOcr.ts`:

```ts
export async function ocrImage(env: Env['Bindings'], bytes: Uint8Array, mime: string): Promise<ExtractionResult> {
  const leg = aiBudget();
  if (await isTesseractPrimaryEnabled(env)) {
    const tesseract = await withTimeout(extractFromImageTesseract(env, bytes, mime), leg(), 'Tesseract OCR timed out')
      .catch(() => null);
    if (tesseract) return tesseract;
  }
  const claude = await withTimeout(
    extractFromImageClaude(env, bytes, mime), leg(), 'Claude OCR timed out',
  ).catch(() => null);
  return claude ?? withTimeout(extractFromImage(env.AI, bytes), leg(), 'Vision OCR timed out');
}
```

- `extractFromImageTesseract()` (new, in `serveIntakeExtract.ts`): calls the
  Tesseract container for raw text, then runs that text through the
  **existing** `extractFromText`/`extractFromTextClaude` field-extraction
  step — Tesseract only replaces the OCR step; field extraction is unchanged
  regardless of which OCR engine produced the text. Returns `null` on any
  container error so the existing Claude → Workers-AI chain takes over
  transparently, same fallback shape as every other leg in this file.
- `isTesseractPrimaryEnabled()`: reads the existing `feature_flags` KV key
  (`src/routes/adminDev.ts`'s established pattern), new flag
  `tesseract_ocr_primary`, **default `false`** in `DEFAULT_FLAGS`. Toggled
  via the existing `PUT /api/admin-dev/feature-flags` admin-only endpoint.
  The client mirror in `client/src/context/FeatureFlagsContext.tsx`
  (`FeatureFlags` interface + its own `DEFAULT_FLAGS`) needs the same key
  added so `AdminDevSettingsTab.tsx`'s existing generic flag-toggle UI picks
  it up automatically — both sides of this mirror must change together or
  the toggle silently no-ops on one side.
- `ocrEngine` label in the response becomes `'tesseract'` when this leg
  produced the result, so existing UI (the fallback-engine warning banner in
  `ServeIntakePage.tsx`) and `ocr_engine` DB column need no schema change —
  it already stores an arbitrary string.

## 8. A/B measurement (this session, before any flag flip)

Run the existing `scripts/serve-intake-vision-ab.ts` (already has a
`runTesseractCustom` candidate) against `tests/fixtures/serve-intake/vision/`
once the container is confirmed healthy (§1). Report per-candidate accuracy
to the user. **The flag stays `false`** regardless of result — flipping it
is the user's decision after reviewing the numbers, not an automated
outcome of this spec.

## Testing

- `tests/tesseractBoxAnnotations.test.ts` — CRUD route tests (Miniflare/Node
  per existing convention for `tesseractTraining.ts`).
- `client/tests/tesseractCoordinateConversion.test.ts` — pixel-space
  conversion math (natural vs. rendered image dimensions → box coordinates),
  the one genuinely fiddly piece of the canvas UI.
- `tests/serveIntakeOcr.test.ts` (existing file, extended) — `ocrImage()`
  with the flag ON routes through the Tesseract leg and falls back
  correctly on a simulated container error; with the flag OFF (default)
  behavior is byte-identical to today.

## Out of scope

- Actually flipping `tesseract_ocr_primary` to `true` in production.
- Running `tesstrain` itself (still manual/local/operator-run, per the
  original design's non-goals).
- PDF documents — Tesseract in this container is image-OCR only; the
  existing `extractPdfMarkdown`/pdfjs/container-markdown chain for PDFs is
  untouched.
- Any other content for the new Serve Intake "Enforcement" tab beyond the
  Learning sub-button.
