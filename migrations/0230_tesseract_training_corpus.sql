-- Tracks which serve_intake_documents have already been reviewed, corrected,
-- and submitted as a labeled Tesseract fine-tuning pair (see
-- docs/superpowers/specs/2026-08-09-tesseract-training-portal-design.md).
-- Deliberately minimal — existence of a row here means "already in the
-- TESSERACT_TRAINING R2 corpus," nothing more.
CREATE TABLE IF NOT EXISTS tesseract_training_corpus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_intake_document_id INTEGER NOT NULL UNIQUE,
  added_by INTEGER NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tesseract_training_corpus_doc
  ON tesseract_training_corpus(serve_intake_document_id);
