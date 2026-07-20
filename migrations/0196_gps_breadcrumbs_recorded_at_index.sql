-- ============================================================
-- 0196: bare recorded_at index on gps_breadcrumbs
-- ============================================================
-- Live D1 only has composite (unit_id, recorded_at) / (call_sign, recorded_at)
-- indexes on gps_breadcrumbs (confirmed via sqlite_master 2026-07-20) — the
-- bare `idx_gps_recorded ON gps_breadcrumbs(recorded_at)` index that
-- migrations/0001_initial.sql defines never actually landed on live D1 (the
-- "dirty prod schema" gotcha — see migrations/README.md). Any query that
-- filters by recorded_at ACROSS all units (e.g. GET /admin/gps-health) has
-- no usable index and falls back to a full table SCAN — confirmed via
-- EXPLAIN QUERY PLAN against live D1, reading 400k+ rows for a handful of
-- units on a table that's already 229k+ rows and growing unbounded.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_gps_breadcrumbs_recorded_at ON gps_breadcrumbs(recorded_at);
