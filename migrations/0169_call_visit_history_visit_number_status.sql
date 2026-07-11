-- Live D1's call_visit_history table drifted from 0011_add_missing_tables_columns.sql's
-- CREATE TABLE (dirty-schema era direct patch, per migrations/README.md) — it's
-- missing `visit_number` and `status`, which POST /dispatch/calls/:id/redispatch
-- and /undo-redispatch (src/routes/dispatch/calls.ts) both require (INSERT +
-- ORDER BY visit_number). Discovered applying 0168 live: `pragma_table_info`
-- showed neither column present despite 0011's file declaring them.
--
-- D1 does NOT support `IF NOT EXISTS` on `ADD COLUMN`. Re-applying this
-- against a database that already has these columns raises "duplicate
-- column name", which the deploy step swallows (continue-on-error per
-- CLAUDE.md). After merging, also apply this DDL directly to live D1
-- 785de7ae and verify with `pragma_table_info('call_visit_history')`.
ALTER TABLE call_visit_history ADD COLUMN visit_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE call_visit_history ADD COLUMN status TEXT DEFAULT 'pending';
