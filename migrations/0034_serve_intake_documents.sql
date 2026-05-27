-- ============================================================
-- 0034_serve_intake_documents.sql
-- ============================================================
-- Sidecar storage for uploaded process-service packets.
-- One row per uploaded file (PDF page bundle or image). Keeps raw
-- OCR text, structured extraction JSON, the R2 key, and confidence
-- off the main serve_queue table — serve_queue is intentionally
-- thin so it stays well below the D1 100-col cap (see
-- migrations/README.md + [[feedback-d1-column-cap-for-lists]]).
--
-- serve_queue_id is nullable: when an uploader drops a packet, we
-- create one queue row PLUS one or more document rows. If LLM
-- extraction fails outright we still keep the document row with
-- status='unmatched' so the reviewer can hand-create the queue
-- entry and link it later.
-- ============================================================

CREATE TABLE IF NOT EXISTS serve_intake_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serve_queue_id INTEGER REFERENCES serve_queue(id) ON DELETE SET NULL,
  uploaded_by INTEGER REFERENCES users(id),
  file_name TEXT,
  file_type TEXT,                          -- MIME (application/pdf, image/jpeg, ...)
  r2_key TEXT,                             -- key in env.UPLOADS bucket
  size_bytes INTEGER,
  page_count INTEGER,                      -- from pdfinfo (PDFs only)
  raw_text TEXT,                           -- raw OCR / pdftotext output
  ocr_used INTEGER NOT NULL DEFAULT 0,     -- 1 if Tesseract fallback fired
  ocr_engine TEXT,                         -- 'pdftotext' | 'tesseract' | 'workers-ai-vision' | 'pdfjs'
  doc_type TEXT,                           -- LLM classification result
  fields_json TEXT,                        -- structured extraction (see OcrScanResult in client)
  confidence REAL,                         -- 0..1 overall confidence
  extraction_model TEXT,                   -- e.g. '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
  extraction_ms INTEGER,                   -- LLM round-trip in ms (operational metric)
  status TEXT NOT NULL DEFAULT 'extracted' CHECK(status IN (
    'pending','extracting','extracted','failed','unmatched','archived'
  )),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_serve_intake_docs_queue ON serve_intake_documents(serve_queue_id);
CREATE INDEX IF NOT EXISTS idx_serve_intake_docs_user ON serve_intake_documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_serve_intake_docs_status ON serve_intake_documents(status);
CREATE INDEX IF NOT EXISTS idx_serve_intake_docs_created ON serve_intake_documents(created_at);
