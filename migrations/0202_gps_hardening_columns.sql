-- 0202_gps_hardening_columns.sql
-- GPS tracking hardening: server-side speed-jump flagging + live accuracy
-- mirror onto units (parallel to the existing gps_heading/gps_speed mirror
-- added in 0065_units_gps_heading_speed.sql).
ALTER TABLE gps_breadcrumbs ADD COLUMN flagged_reason TEXT;
ALTER TABLE units ADD COLUMN gps_accuracy REAL;
