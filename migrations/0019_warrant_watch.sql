-- ============================================================
-- Migration 0019 — Warrant watch runs (CF Worker)
-- ============================================================
-- Records each automated poll of warrants.utah.gov fired by the
-- src/index.ts scheduled() handler. Dashboard widget + admin
-- "Warrant Polling Status" tab read from here to show operator-
-- visible freshness signals.
--
-- Schema kept compatible with the legacy server's warrant_watch_runs
-- shape (server/src/utils/utahWarrantScraper.ts) so the eventual
-- legacy-retirement migration can move rows without column rename.
-- ============================================================

CREATE TABLE IF NOT EXISTS warrant_watch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  persons_checked INTEGER NOT NULL DEFAULT 0,
  new_warrants_found INTEGER NOT NULL DEFAULT 0,
  warrants_cleared INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_warrant_watch_runs_started ON warrant_watch_runs(started_at DESC);
