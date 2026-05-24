-- Migration 0002: Create serve_queue_persons junction table
-- Used by serveIntake-worker.ts and ocr-worker.ts to link persons to serve jobs

CREATE TABLE IF NOT EXISTS serve_queue_persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'defendant',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (serve_queue_id) REFERENCES serve_queue(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_serve_queue_persons_queue ON serve_queue_persons(serve_queue_id);
CREATE INDEX IF NOT EXISTS idx_serve_queue_persons_person ON serve_queue_persons(person_id);
