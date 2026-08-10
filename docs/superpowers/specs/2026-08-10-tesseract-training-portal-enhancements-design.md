# Tesseract Training Portal Enhancements — Design

**Date:** 2026-08-10
**Status:** Approved for planning

## Context

`docs/superpowers/specs/2026-08-09-tesseract-ocr-learning-production-design.md` shipped
the base Learning portal: browse `serve_intake_documents`, correct OCR text, mark boxes,
leave review-note strokes, submit a document's text correction to
`tesseract_training_corpus` (which mirrors the pair into the `TESSERACT_TRAINING` R2
bucket). This spec adds four capabilities on top of that base, all scoped to the existing
`tesseractTraining.ts` router and `TesseractTrainingPage.tsx` — no new page, no new table
beyond one column.

**Non-goal, unchanged from the base spec:** this still does not trigger `tesstrain` itself,
and still does not touch `tesseract_ocr_primary`.

## 1. Coverage dashboard

**Route:** `GET /api/tesseract-training/stats` (admin/manager, same `requireAdminManager`
gate as every other route in this file).

**Response shape:**
```json
{
  "total_eligible": 142,
  "total_labeled": 37,
  "total_approved": 19,
  "by_doc_type": [
    { "doc_type": "summons", "eligible": 40, "labeled": 12, "approved": 6 },
    { "doc_type": "subpoena", "eligible": 15, "labeled": 3, "approved": 1 },
    { "doc_type": null, "eligible": 8, "labeled": 0, "approved": 0 }
  ]
}
```
`doc_type: null` is a real, expected group — `serve_intake_documents.doc_type` is nullable
(LLM classification can fail to produce one), and hiding those documents from the dashboard
would make the totals not add up to `total_eligible`. Implemented as two grouped queries
(`GROUP BY doc_type` over `serve_intake_documents WHERE status='extracted'`, LEFT JOINed
against `tesseract_training_corpus` for labeled/approved counts) rather than N+1 per-type
queries.

**UI:** a collapsible panel at the top of `TesseractTrainingPage.tsx`, above the document
list, fetched once on mount (not polled — this is a slow-moving number, refreshed on
manual reload or after a submit/approve/bulk-submit action completes).

## 2. Approval status

**Schema change** — extend migration numbering with a new file
`migrations/0234_tesseract_training_approval.sql`:
```sql
ALTER TABLE tesseract_training_corpus ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending', 'approved'));
ALTER TABLE tesseract_training_corpus ADD COLUMN approved_by INTEGER;
ALTER TABLE tesseract_training_corpus ADD COLUMN approved_at TEXT;
```
D1 does not support a column-level `CHECK` being added retroactively in a way that's
enforced on already-existing rows, but SQLite does enforce `CHECK` on all INSERT/UPDATE
going forward, which is what matters here — existing rows get the column default
(`'pending'`) applied at ALTER time.

**Existing `/documents/:id/submit` behavior is unchanged** — a new submission still lands
as `approval_status='pending'` (the column default), so no caller needs to change.

**New route:** `POST /api/tesseract-training/documents/:id/approve` (admin/manager — no
restriction against the original submitter approving their own work, per the "single-person
toggle" decision). Sets `approval_status='approved'`, `approved_by=<current user id>`,
`approved_at=datetime('now')`. Idempotent — approving an already-approved document is a
no-op 200, not an error (an admin re-clicking approve should never see a confusing failure).

**`GET /documents` and `GET /documents/:id`** gain `approval_status` in their response
(read from a `LEFT JOIN tesseract_training_corpus`, same join shape the base spec's
`/documents` endpoint already uses for `already_in_corpus` — this is one more column off
the same join, not a new join).

**UI:** the document list shows a small `PENDING`/`APPROVED` badge next to
`(already labeled)`. The detail pane's Text mode gains an "Approve" button, shown only
when `already_in_corpus && approval_status === 'pending'`.

## 3. Bulk submit

**Route:** `POST /api/tesseract-training/documents/bulk-submit`
Body: `{ document_ids: number[] }` (max 100 per call — matches this repo's D1
bound-parameter-cap convention, CLAUDE.md gotcha #20; the route validates length and
rejects >100 with 400 rather than silently truncating).

**Behavior:** for each ID, runs the SAME logic as the existing single `/submit` route
(fetch `raw_text`, skip if already in corpus, write image+ground-truth to R2, insert into
`tesseract_training_corpus`) — refactored into a shared helper
`submitDocumentToCorpus(c, id, userId, groundTruthText)` that both the single route and the
bulk route call, rather than duplicating the R2-write-then-D1-insert logic. Each document is
independent: one failing (missing R2 object, already submitted) does not abort the rest —
the response reports per-ID success/failure:
```json
{ "results": [ { "id": 12, "success": true }, { "id": 13, "success": false, "error": "Document already in training corpus" } ] }
```
Bulk submit always uses the document's EXISTING `raw_text` as ground truth verbatim (the
"these are already correct, just accept them" case from the design conversation) — it does
NOT accept per-document corrected text; that stays the single-submit flow's job.

**UI:** the document list gains a checkbox per row (hidden/no-op while any document is
selected in the detail pane, to avoid an ambiguous "am I bulk-submitting or editing this
one" state) and a "Submit N Selected" button that appears once ≥1 is checked. After the
call, the panel shows a summary line ("18 submitted, 2 already in corpus") rather than
silently refreshing the list — the per-ID failure reasons matter to the operator.

## 4. Document list filtering

**Route:** `GET /documents` gains optional query params, all additive (omitting all of them
reproduces today's exact behavior):
- `doc_type` — exact match against `serve_intake_documents.doc_type`. A caller may pass the
  literal string `null` to filter for documents with no classification (`WHERE doc_type IS NULL`) —
  chosen because `doc_type` values are LLM-classification strings, and `null` is not a
  possible ambiguous value there.
- `labeled` — `'true'` or `'false'`, filters on `already_in_corpus`.
- `from` / `to` — ISO date strings (`YYYY-MM-DD`), inclusive range on `created_at`.

All four compose with AND semantics. Invalid `doc_type`/date values are ignored (not
rejected) — a malformed filter degrading to "no filter" is safer for an internal ops tool
than a 400 that blocks the whole list from loading.

**UI:** a filter bar above the document list: a `doc_type` dropdown (populated from the
distinct values already present in `by_doc_type` from the stats endpoint — no second query
needed), a labeled/unlabeled toggle, and two date inputs. Filters are reflected in the URL
query string (`?doc_type=summons&labeled=false`) so a filtered view is bookmarkable/shareable
between admins, matching the existing `?page=` convention on this same page.

## Testing

- `tests/tesseractTrainingStats.test.ts` — stats aggregation, including the `doc_type: null`
  group.
- `tests/tesseractTrainingApproval.test.ts` — approve route idempotency, `approval_status`
  present in `/documents` and `/documents/:id` responses.
- `tests/tesseractTrainingBulkSubmit.test.ts` — partial success (some IDs succeed, one
  already-in-corpus fails), the >100 rejection, and that single-submit and bulk-submit
  produce byte-identical R2 writes for the same document (proving the shared helper
  refactor didn't change single-submit's existing behavior).
- `client/tests/` — filter query-string round-trip, checkbox-selection bulk-submit call
  shape.

## Out of scope

- A two-person approval rule (explicitly decided against — single-person toggle).
- Export/import of annotations as files.
- Any change to `tesseract_box_annotations` or `tesseract_review_annotations` — approval
  and bulk operations apply only to the whole-document text-correction flow
  (`tesseract_training_corpus`), since that's the table actually mirrored to R2 for future
  `tesstrain` consumption. Box/review annotations have no "submitted" gate to approve.
