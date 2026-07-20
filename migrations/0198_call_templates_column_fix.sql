-- ============================================================
-- 0198: Reconcile call_templates schema drift
-- ============================================================
-- Root cause: live D1's call_templates table was created from the
-- legacy baseline/schema.sql shape (description_template, is_active,
-- sort_order, created_by, ...). Migration 0162_call_templates.sql used
-- `CREATE TABLE IF NOT EXISTS` with a different column set (notes,
-- owner_user_id, is_shared, use_count, active, updated_at) — since the
-- table already existed, 0162 silently no-opped and never applied its
-- schema. src/routes/admin.ts's /admin/call-templates handlers query
-- and write the 0162 column names, which don't exist live, causing a
-- SQLite "no such column" error swallowed into a bare 500.
--
-- D1 doesn't support "ADD COLUMN IF NOT EXISTS" and this table already
-- has rows, so new columns must be nullable / have defaults.
-- ============================================================

ALTER TABLE call_templates ADD COLUMN auto_flags TEXT DEFAULT '{}';
ALTER TABLE call_templates ADD COLUMN notes TEXT;
ALTER TABLE call_templates ADD COLUMN owner_user_id INTEGER;
ALTER TABLE call_templates ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0;
ALTER TABLE call_templates ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE call_templates ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
-- D1 rejects non-constant ADD COLUMN defaults ("datetime('now',...)" errors with
-- SQLITE_ERROR code 7500), so this column is nullable; the PUT handler already
-- sets it explicitly on every update.
ALTER TABLE call_templates ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_call_templates_owner ON call_templates(owner_user_id, active);
CREATE INDEX IF NOT EXISTS idx_call_templates_shared ON call_templates(is_shared, active);
