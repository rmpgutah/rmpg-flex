-- ============================================================
-- 0040_utah_warrants_lifecycle_reconcile.sql
-- ============================================================
-- Reconciles the LIVE utah_warrants table with migration 0035.
--
-- Background: the live D1 (785de7ae) had an OLDER utah_warrants table
-- predating 0035 — it used a single `fetched_at` column and had NO
-- indexes. Migration 0035 (PR #634) defined the first_seen/last_seen/
-- is_active lifecycle model + a UNIQUE index, but 0035 was applied only
-- to the dead scratch DB (8893480a), never to live. Result: every cron
-- firing of runUtahWarrantScan threw `D1_ERROR: no such column: is_active`
-- and `status=failed` (observed on every run 2026-05-29).
--
-- This migration adds the 5 missing columns + 4 indexes, matching 0035.
-- Already applied to live D1 directly on 2026-05-29 via
-- `wrangler d1 execute rmpg-flex --remote --file`; this file backports
-- that patch to source.
--
-- D1 does NOT support IF NOT EXISTS on ADD COLUMN, so re-applying this
-- migration will error on the ALTERs (deploy.yml has continue-on-error).
-- The CREATE INDEX statements ARE idempotent. Safe net effect.
--
-- NOTE: first_seen_at / last_seen_at are added WITHOUT a default — SQLite
-- forbids a non-constant default (datetime('now')) in ADD COLUMN. The
-- poller's recordWarrant() always supplies these values explicitly on
-- INSERT, so the missing default is harmless. New tables created fresh
-- from 0035 still get the datetime('now') default.

ALTER TABLE utah_warrants ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE utah_warrants ADD COLUMN first_seen_at TEXT;
ALTER TABLE utah_warrants ADD COLUMN last_seen_at TEXT;
ALTER TABLE utah_warrants ADD COLUMN person_id INTEGER;
ALTER TABLE utah_warrants ADD COLUMN source TEXT NOT NULL DEFAULT 'utah-warrant-watch';

-- Required by recordWarrant()'s ON CONFLICT (utah_person_id, utah_warrant_id)
-- UPSERT — without this unique index the UPSERT throws "no unique or
-- exclusion constraint matching the ON CONFLICT specification".
CREATE UNIQUE INDEX IF NOT EXISTS idx_utah_warrants_unique
  ON utah_warrants(utah_person_id, utah_warrant_id);
CREATE INDEX IF NOT EXISTS idx_utah_warrants_person
  ON utah_warrants(person_id, is_active);
CREATE INDEX IF NOT EXISTS idx_utah_warrants_active
  ON utah_warrants(is_active, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_utah_warrants_last_seen
  ON utah_warrants(last_seen_at DESC);
