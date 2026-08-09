# Tesseract Training Setup Portal (design)

**Date:** 2026-08-09
**Context:** Custom Fine-Tuned Tesseract OCR (`docs/superpowers/specs/2026-08-08-custom-tesseract-ocr-design.md`, `docs/superpowers/plans/2026-08-08-custom-tesseract-ocr.md` — all 5 tasks shipped, live in production)

## 1. Background

The Tesseract OCR infrastructure (R2 bucket, container, Worker route, deploy pipeline, A/B script wiring) is deployed and operational, but running on the stock English model — no fine-tuning has happened because no labeled training corpus exists. The prior design deliberately scoped corpus management to a manual CLI script (`scripts/upload-tesseract-training-pair.ts`), reasoning that labeling would happen infrequently enough not to justify a UI.

This design reverses that decision: the operator wants actual fine-tuning to happen, which requires RMPG staff to review and correct real document text at meaningful volume — a task better served by a browsing/correction UI than a one-document-at-a-time CLI script requiring local file paths.

**What this design does NOT do:** perform or trigger the actual Tesseract fine-tuning (`tesstrain`). That remains a manual, local, CPU-intensive process outside Cloudflare Workers, run by an operator once enough labeled pairs exist — unchanged from the original design. This portal's job ends at "a corrected, labeled pair is stored in R2, ready for that manual step."

## 2. Design

### 2.1 Document source: reuse existing serve-intake records

Rather than a fresh upload flow, this portal browses `serve_intake_documents` rows where `status = 'extracted'` — these already have real OCR output in `raw_text` (per `migrations/0034_serve_intake_documents.sql`) that serves as the correction starting point, and a real document image already stored in R2 (`UPLOADS` bucket, `r2_key` column, envelope-encrypted). No new upload mechanism is needed; the labeling workflow is "review and correct what's already there," not "upload from scratch."

### 2.2 Backend: `src/routes/tesseractTraining.ts`

Mounted at `/api/tesseract-training`, gated to `['admin', 'manager']` (matching the role convention already established on every other Tesseract-related route — `src/routes/tesseractOcr.ts`'s `/ocr` endpoint).

- `GET /documents?page=1` — lists eligible documents (`status='extracted'`), paginated (`LIMIT 50 OFFSET`), `LEFT JOIN tesseract_training_corpus` so each row carries `already_in_corpus: boolean` for the UI to show progress and avoid re-reviewing labeled documents.
- `GET /documents/:id` — one document's metadata + `raw_text` (the editable starting point for ground-truth correction).
- `GET /documents/:id/image` — serves the image bytes. Reuses the EXACT decrypt-then-legacy-fallback pattern already implemented at `src/routes/serveIntake.ts:1387-1424` (`getDecrypted(c.env.UPLOADS, db, c.env.FILE_ENCRYPTION_KEK, doc.r2_key)`, falling back to a direct `c.env.UPLOADS.get()` for pre-encryption legacy objects) — no new decryption logic, just the same call reused for a different route.
- `POST /documents/:id/submit` — body `{ ground_truth_text: string }`. Fetches the same image bytes as the GET route above, uploads `training-corpus/<doc-id>/image.<ext>` and `training-corpus/<doc-id>/ground-truth.txt` to the existing `TESSERACT_TRAINING` R2 bucket (same layout Task 1 of the infrastructure plan already established for the CLI script — this route becomes a second producer of that same layout, not a new one), then inserts a row into the new tracking table. Returns `409 Conflict` if the document is already in the corpus (the tracking table's `UNIQUE` constraint on `serve_intake_document_id` is the actual enforcement; the route checks first for a clean error message rather than surfacing a raw D1 constraint violation).

**Write ordering (error handling):** the D1 tracking-table insert happens only AFTER both R2 objects (image + ground-truth text) are confirmed written — the same "never record 'this exists' in the database before the underlying object storage actually has it" principle already used in this repo's own R2-then-D1 write ordering (e.g. `src/routes/id-verification.ts`'s `recordId` assignment note in the sibling `rmpgutahps.us` project applies the identical pattern, but the principle itself is generic and doesn't require reading that other codebase). A partial failure (image written, ground-truth failed, or vice versa) leaves an orphaned R2 object but no tracking row, which fails safe: the document simply isn't marked as "already in corpus" and can be resubmitted.

### 2.3 New migration: `migrations/0230_tesseract_training_corpus.sql`

```sql
CREATE TABLE IF NOT EXISTS tesseract_training_corpus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_intake_document_id INTEGER NOT NULL UNIQUE,
  added_by INTEGER NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Deliberately minimal — this table exists only to answer "has this document already been labeled and submitted," not to duplicate anything already tracked by `serve_intake_documents` or the R2 object layout itself.

### 2.4 Client: standalone admin page

A new page (not wired into `AdminPage.tsx`'s tab system, which per `CLAUDE.md`'s documented gotcha requires four separate coordinated edits — a standalone route is simpler and proportionate to this narrow-purpose, admin/manager-only tool) with two views:

- **List view:** eligible documents, showing `already_in_corpus` status per row, paginated.
- **Detail/correction view:** the document image alongside an editable textarea pre-filled with `raw_text`, and a "Submit to training corpus" button that calls `POST /documents/:id/submit` with the corrected text.

## 3. Non-goals

- No triggering or running of the actual `tesstrain` fine-tuning process — that remains a manual, local, operator-run step (per the original infrastructure design's non-goals, unchanged).
- No new document upload mechanism — this portal only reviews/corrects documents that already exist in `serve_intake_documents`.
- No change to `serve_intake_documents` itself, its existing routes, or the existing CLI upload script (`scripts/upload-tesseract-training-pair.ts`) — this portal is a second, UI-based producer of the same R2 layout, not a replacement.
- No wiring into `AdminPage.tsx`'s tab system — a standalone route, per §2.4's reasoning.

## 4. Testing

- `tesseractTraining.ts` route tests follow the existing pattern for `serveIntake.ts`'s file-serving route (mocked encrypted R2, legacy-fallback case) and the `review-queue` list-endpoint pattern (pagination, role gating).
- The `409 Conflict` on duplicate submission is a testable, deterministic behavior — not dependent on live R2/D1 state beyond what a test fixture can set up.
- No new test type needed for the client page beyond the existing React Testing Library conventions already used for similar admin review pages in this codebase.
