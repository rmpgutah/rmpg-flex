-- 0264: Add index on warrants(status) for dashboard queries.
-- The warrants dashboard filters by status on every load; without an index
-- this is a full table scan on the ~2k row warrants table.
CREATE INDEX IF NOT EXISTS idx_warrants_status ON warrants(status);
