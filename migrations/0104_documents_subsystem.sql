-- 0104: Document subsystem (Phase 2 of dispatch-notes).
-- Authored, formatted, reopenable documents. DISTINCT from document_folders
-- (file cabinet) and company_documents (policy docs). Body is Phase-1
-- markdown-marker text; body_format leaves a door open for a future 'html' body.
-- Idempotent. After merge, ALSO apply directly to live D1 785de7ae (see CLAUDE.md).

CREATE TABLE IF NOT EXISTS documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  body_format     TEXT NOT NULL DEFAULT 'markdown',
  status          TEXT NOT NULL DEFAULT 'draft',
  owner_id        INTEGER,
  owner_username  TEXT,
  revision        INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT,
  finalized_at    TEXT,
  finalized_by    TEXT,
  reopened_at     TEXT,
  reopened_by     TEXT,
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_owner   ON documents(owner_username);
CREATE INDEX IF NOT EXISTS idx_documents_status  ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_deleted ON documents(deleted_at);

CREATE TABLE IF NOT EXISTS document_revisions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id       INTEGER NOT NULL,
  revision_number   INTEGER NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  body_format       TEXT NOT NULL DEFAULT 'markdown',
  saved_by          INTEGER,
  saved_by_username TEXT,
  saved_at          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  change_note       TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_revisions_doc ON document_revisions(document_id, revision_number);

CREATE TABLE IF NOT EXISTS document_links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id  INTEGER NOT NULL,
  target_type  TEXT NOT NULL,
  target_id    INTEGER NOT NULL,
  linked_by    INTEGER,
  linked_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  UNIQUE (document_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_doc_links_target ON document_links(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_doc_links_doc    ON document_links(document_id);
