-- migrations/0140_serve_scheduler_advanced.sql
--
-- PR 1 of the process-service auto-scheduler:
-- 1. serve_attempt_schedules: track manually-moved slots, replan lineage, and
--    snapshot the officer at slot creation time (queue.officer_id is mutable).
-- 2. serve_queue: geographic cluster id + derived urgency tier (cached for
--    fast calendar sort/color without per-query recomputation).
--
-- ⚠️ D1 has no "ADD COLUMN IF NOT EXISTS". This migration WILL fail on
-- re-apply. Two defenses:
--   (a) src/routes/serveIntake.ts uses columnExists() at first request and
--       runs the ALTERs idempotently. (Same pattern as src/routes/alpr.ts.)
--   (b) After merge, apply this DDL directly to live D1 (785de7ae) via the
--       Cloudflare API and verify with pragma_table_info(...).

ALTER TABLE serve_attempt_schedules ADD COLUMN manually_moved      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE serve_attempt_schedules ADD COLUMN moved_by_user_id    INTEGER;
ALTER TABLE serve_attempt_schedules ADD COLUMN moved_at            TEXT;
ALTER TABLE serve_attempt_schedules ADD COLUMN auto_replan_source  INTEGER;
ALTER TABLE serve_attempt_schedules ADD COLUMN officer_id          INTEGER;

CREATE INDEX IF NOT EXISTS idx_sas_date_officer
  ON serve_attempt_schedules(scheduled_date, officer_id);

ALTER TABLE serve_queue ADD COLUMN geo_cluster_id       TEXT;
ALTER TABLE serve_queue ADD COLUMN urgency_tier         TEXT;
ALTER TABLE serve_queue ADD COLUMN urgency_computed_at  TEXT;

CREATE INDEX IF NOT EXISTS idx_serve_queue_cluster
  ON serve_queue(geo_cluster_id, status);

CREATE INDEX IF NOT EXISTS idx_serve_queue_urgency
  ON serve_queue(urgency_tier, deadline);
