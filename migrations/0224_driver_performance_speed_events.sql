-- Driver Performance: switch the event source from ClearPath dashcam events
-- to directly-observed MDT GPS speed (gps_breadcrumbs).
--
-- Prefix note: 0223 was the original driver-performance schema. `main` also
-- carries TWO 0222 files (0222_assessor_full_cama_build.sql and
-- 0222_fleetio_fuel_ghost_merge_retry.sql), so 0224 is the next free prefix.
--
-- The dashcam-era columns (events_forward_collision, events_lane_departure,
-- events_close_following, events_harsh_brake, events_harsh_accel,
-- events_speeding, unattributed_events) are DELIBERATELY LEFT IN PLACE and
-- simply stop being written. Dropping columns in SQLite/D1 means a table
-- rebuild, and historical snapshots computed under the old score_version are
-- evidence records — a liability-defense lens exists precisely so a past score
-- can be reproduced. Destroying their inputs to tidy the schema is not worth
-- it. New rows carry 0 in those columns; readers key off score_version.

-- Speed events, by tier, counted as SUSTAINED RUNS (one run = one event) and
-- tiered by each run's PEAK speed. See src/utils/driverPerformance/speedEvents.ts.
ALTER TABLE driver_performance_daily ADD COLUMN events_speed_high INTEGER NOT NULL DEFAULT 0;
ALTER TABLE driver_performance_daily ADD COLUMN events_speed_very_high INTEGER NOT NULL DEFAULT 0;
ALTER TABLE driver_performance_daily ADD COLUMN events_speed_extreme INTEGER NOT NULL DEFAULT 0;

-- Observation volume behind the counts above. Auditability is the point:
-- miles_driven > 0 with breadcrumb_samples = 0 is a DEAD FEED, not clean
-- driving, and forces the officer-day to be non-scoring. Without this column
-- a dead feed and a flawless shift are indistinguishable on the stored row.
ALTER TABLE driver_performance_daily ADD COLUMN breadcrumb_samples INTEGER NOT NULL DEFAULT 0;

-- The per-day breadcrumb scan is the rollup's heaviest read against a
-- continuously-ingesting 265k-row table. It filters on officer_id and orders
-- by (officer_id, recorded_at); without this index it is a full scan per day.
CREATE INDEX IF NOT EXISTS idx_gps_breadcrumbs_officer_recorded
  ON gps_breadcrumbs(officer_id, recorded_at);
