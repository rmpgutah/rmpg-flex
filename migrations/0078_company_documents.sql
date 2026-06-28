-- company_documents: agency-wide document library (TrainingDocsPage, admin CRUD)
-- Ported from legacy VPS schema (legacy/server-vps/src/models/database.ts:1275)

CREATE TABLE IF NOT EXISTS company_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  file_id TEXT,
  content_type TEXT NOT NULL DEFAULT 'file',
  external_url TEXT,
  is_required_reading INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (file_id) REFERENCES attachments(file_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_company_docs_category ON company_documents(category);
CREATE INDEX IF NOT EXISTS idx_company_docs_published ON company_documents(published);
CREATE INDEX IF NOT EXISTS idx_company_docs_created ON company_documents(created_at);
