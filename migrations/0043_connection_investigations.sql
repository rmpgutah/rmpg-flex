-- ============================================================
-- 0043 — Connection Investigations (saved Connections-graph workspaces)
-- ============================================================
-- Backs the Connections analyst workspace: a user-owned saved graph
-- (seed nodes + pinned layout + per-node annotations), private by
-- default and read-shared via the explicit shared_user_ids JSON array.
--
-- This table was already created directly on live D1 (785de7ae) on
-- 2026-05-29 — the Connections backend never made the VPS→Workers
-- jump, so the frontend's save/load was hitting a 404. This file
-- documents that schema and applies it to local dev. Idempotent:
-- CREATE TABLE IF NOT EXISTS, so re-applying against live is a no-op.
-- ============================================================

CREATE TABLE IF NOT EXISTS connection_investigations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  seed_nodes TEXT NOT NULL DEFAULT '[]',
  pinned_layout TEXT,
  annotations TEXT,
  shared_user_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conn_inv_user
  ON connection_investigations(user_id, updated_at DESC);
