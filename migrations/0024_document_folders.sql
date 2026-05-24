-- ============================================================
-- 0024_document_folders.sql
-- ============================================================
-- Hierarchical document folder browser. Folders are pure-DB
-- (no R2 dependency — files themselves live elsewhere). A file
-- belongs to at most one folder via attachments.folder_id.
--
-- Path layout (set by ensureIntakeFolderPath helper):
--   /<year>/<month>/<jobNumber - caseName>
-- Drives serve-intake document filing, manual filing via the
-- Documents page, and any future "save to folder" affordance.
-- ============================================================

CREATE TABLE IF NOT EXISTS document_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER,
  folder_path TEXT NOT NULL UNIQUE,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parent_id) REFERENCES document_folders(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_document_folders_parent ON document_folders(parent_id);

-- Attach files to folders. NULL = unfoldered (legacy behavior).
-- D1 supports ADD COLUMN; existing rows default to NULL and stay
-- in the unfoldered bucket until a move-file call buckets them.
ALTER TABLE attachments ADD COLUMN folder_id INTEGER REFERENCES document_folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_folder ON attachments(folder_id);
