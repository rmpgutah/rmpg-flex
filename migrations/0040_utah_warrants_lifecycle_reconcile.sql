-- ============================================================
-- 0040_utah_warrants_lifecycle_reconcile.sql  (idempotent rewrite 2026-05-29)
-- ============================================================
-- The 5 columns this migration originally ADDed (is_active, first_seen_at,
-- last_seen_at, person_id, source) are ALREADY PRESENT on live D1 (785de7ae) —
-- they were applied directly via `wrangler d1 execute` on 2026-05-29, and
-- verified again 2026-05-29 via pragma_table_info(utah_warrants).
--
-- The original `ALTER TABLE … ADD COLUMN is_active …` therefore failed with
-- "duplicate column name: is_active". This file previously relied on
-- deploy.yml's migration step being `continue-on-error: true`, but that was
-- removed 2026-05-27 — so the ALTER now HARD-BLOCKS every deploy. D1 has no
-- IF NOT EXISTS on ADD COLUMN, so the only idempotent form is to drop the
-- (already-applied) ADD COLUMNs and keep just the indexes (all IF NOT EXISTS,
-- safe to re-run). Net schema effect is unchanged.

CREATE UNIQUE INDEX IF NOT EXISTS idx_utah_warrants_unique
  ON utah_warrants(utah_person_id, utah_warrant_id);
CREATE INDEX IF NOT EXISTS idx_utah_warrants_person
  ON utah_warrants(person_id, is_active);
CREATE INDEX IF NOT EXISTS idx_utah_warrants_active
  ON utah_warrants(is_active, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_utah_warrants_last_seen
  ON utah_warrants(last_seen_at DESC);
