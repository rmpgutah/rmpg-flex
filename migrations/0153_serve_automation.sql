-- ============================================================
-- RMPG Flex — Serve automation tracking columns
-- Migration 0153
-- Adds two lightweight columns to serve_queue that let the
-- automation layer track what it has already triggered so it
-- doesn't double-fire on re-uploads or rapid status changes.
-- ============================================================

-- auto_assigned: 1 = job was assigned by the auto-assign engine
-- (vs. manual drag-drop on the assignment board). Lets analytics
-- distinguish officer-chosen vs. system-chosen workloads.
ALTER TABLE serve_queue ADD COLUMN auto_assigned INTEGER DEFAULT 0;

-- intake_screened_at: ISO timestamp of when the warrant/watchlist
-- cross-check fired for this queue row. NULL = not yet screened.
-- Prevents re-screening the same row on a re-upload or status edit.
ALTER TABLE serve_queue ADD COLUMN intake_screened_at TEXT;
