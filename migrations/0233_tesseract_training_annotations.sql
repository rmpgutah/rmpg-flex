-- migrations/0233_tesseract_training_annotations.sql
-- Two new annotation layers for the Tesseract OCR Learning portal, on top
-- of the existing whole-document text-correction flow (tesseract_training_corpus,
-- migration 0230). See docs/superpowers/specs/2026-08-09-tesseract-ocr-learning-production-design.md.

-- Real training data: one row per marked word/line region + its corrected
-- text. Coordinates are in ORIGINAL image pixel space (top-left origin),
-- NOT tile/PDF coordinate space — shaped so a future manual `tesstrain` run
-- can emit a Tesseract .box file directly from this table.
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
