-- Extends call_visit_history (created sparse in 0011) with the columns the
-- legacy VPS redispatch feature (and the client's already-built Visit
-- History panel, DispatchPage.tsx ~line 5961) both expect: a snapshot of
-- the prior visit's dispatch lifecycle timestamps, mileage, vehicle, and
-- assigned units at the moment a PSO/process-service call gets re-dispatched.
-- POST /dispatch/calls/:id/redispatch (src/routes/dispatch/calls.ts) writes
-- these; the client reads them back verbatim (visit.assigned_units is a
-- JSON string the client itself JSON.parses, matching the legacy shape).
--
-- D1 does NOT support `IF NOT EXISTS` on `ADD COLUMN`. Re-applying this
-- against a database that already has these columns raises "duplicate
-- column name", which the deploy step swallows (continue-on-error per
-- CLAUDE.md). After merging, also apply this DDL directly to live D1
-- 785de7ae and verify with `pragma_table_info('call_visit_history')`.
ALTER TABLE call_visit_history ADD COLUMN disposition TEXT;
ALTER TABLE call_visit_history ADD COLUMN assigned_units TEXT;
ALTER TABLE call_visit_history ADD COLUMN dispatched_at TEXT;
ALTER TABLE call_visit_history ADD COLUMN enroute_at TEXT;
ALTER TABLE call_visit_history ADD COLUMN onscene_at TEXT;
ALTER TABLE call_visit_history ADD COLUMN cleared_at TEXT;
ALTER TABLE call_visit_history ADD COLUMN closed_at TEXT;
ALTER TABLE call_visit_history ADD COLUMN responding_vehicle_id INTEGER;
ALTER TABLE call_visit_history ADD COLUMN starting_mileage REAL;
ALTER TABLE call_visit_history ADD COLUMN ending_mileage REAL;
