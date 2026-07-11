-- calls_for_service is at the D1 100-column cap (see CLAUDE.md), so two
-- columns that were only ever added via CREATE TABLE definitions that never
-- reached live D1 — `tags` (0009) and `analytics_replayed_at` (0128) — go
-- into the calls_for_service_ext overflow table instead of the base table.
--
-- analytics_replayed_at is load-bearing: src/routes/reanalysis.ts's
-- calls_for_service → flex_events replay sweep has silently no-op'd since
-- 0128 shipped (the SELECT's `.catch(() => [])` swallowed the "no such
-- column" error every run), because the base-table ALTER in 0128 could
-- never succeed against a table already at the column cap.
ALTER TABLE calls_for_service_ext ADD COLUMN tags TEXT DEFAULT '[]';
ALTER TABLE calls_for_service_ext ADD COLUMN analytics_replayed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_cfs_ext_replay ON calls_for_service_ext(analytics_replayed_at, id) WHERE analytics_replayed_at IS NULL;
