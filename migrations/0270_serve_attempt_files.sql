-- Per-attempt evidence folders for process service.
-- Intake PDFs stay on serve_intake_documents (job-level packet).
-- Attempt photos historically live as a JSON array on serve_attempts.photo_ids
-- with no title/type/description. This sidecar catalogs documents, photos,
-- and audio (mp3) per attempt with officer-entered details.

CREATE TABLE IF NOT EXISTS serve_attempt_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id INTEGER NOT NULL,
  serve_attempt_id INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'document',
  title TEXT,
  description TEXT,
  document_type TEXT,
  copies INTEGER,
  original_name TEXT,
  mime_type TEXT,
  file_size INTEGER,
  uploaded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_serve_attempt_files_file_id
  ON serve_attempt_files(file_id);

CREATE INDEX IF NOT EXISTS idx_serve_attempt_files_attempt
  ON serve_attempt_files(serve_attempt_id);

CREATE INDEX IF NOT EXISTS idx_serve_attempt_files_queue
  ON serve_attempt_files(serve_queue_id);
