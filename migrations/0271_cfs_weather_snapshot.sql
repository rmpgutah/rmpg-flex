-- CFS live/historical weather snapshot (overflow — base table is at the 100-col cap).
-- weather_snapshot: JSON CfsWeatherSnapshot (temp, wind, category, observed_at, …)
-- weather_manual: 1 when a dispatcher overrode the auto-filled scene category
--   (time edits still refresh metrics; overwrite of weather_conditions is skipped).

ALTER TABLE calls_for_service_ext ADD COLUMN weather_snapshot TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN weather_manual INTEGER DEFAULT 0;
