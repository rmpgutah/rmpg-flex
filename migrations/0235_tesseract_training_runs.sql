-- migrations/0235_tesseract_training_runs.sql
-- History log for generated tesstrain-ready packages. See
-- docs/superpowers/specs/2026-08-10-tesseract-training-package-export-design.md.
-- Each row's r2_key points at the exact saved zip under TESSERACT_TRAINING,
-- so re-downloading an old run returns the same bytes, not a re-bundled one.
CREATE TABLE IF NOT EXISTS tesseract_training_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_by INTEGER NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  document_count INTEGER NOT NULL,
  document_ids_json TEXT NOT NULL,
  r2_key TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tesseract_training_runs_generated_at ON tesseract_training_runs(generated_at DESC);
