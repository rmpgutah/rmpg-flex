-- ============================================================
-- 0160: Serve subsystem performance indexes
-- ============================================================
-- Adds indexes for common query patterns in serve analytics,
-- priority queue, and schedule lookups that currently cause
-- full table scans. D1/SQLite may already have implicit indexes
-- for some of these via the primary key — these are explicit
-- additions for the columns not covered by existing indexes.
-- ============================================================

-- Priority-queue ordering (CASE WHEN priority = 'urgent' THEN 1...)
-- and general status-based filtering.
CREATE INDEX IF NOT EXISTS idx_serve_queue_priority ON serve_queue(priority);
CREATE INDEX IF NOT EXISTS idx_serve_queue_status_closed ON serve_queue(status, closed_at);

-- Attempt analytics: server-performance, success-rate-by-type,
-- time-to-serve, weekly-trend all filter/sort on attempt_at.
CREATE INDEX IF NOT EXISTS idx_serve_attempts_attempt_at ON serve_attempts(attempt_at);

-- Workload summary: officer-level counts grouped by DATE(attempt_at).
CREATE INDEX IF NOT EXISTS idx_serve_attempts_officer_at ON serve_attempts(officer_id, attempt_at);

-- Schedule slot lookups by date (dashboard calendar panel).
CREATE INDEX IF NOT EXISTS idx_serve_attempt_schedules_date ON serve_attempt_schedules(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_serve_attempt_schedules_officer ON serve_attempt_schedules(officer_id);
CREATE INDEX IF NOT EXISTS idx_serve_attempt_schedules_notify ON serve_attempt_schedules(notify_at, notified, dismissed);

-- Bulk reassign filter (active jobs by officer).
CREATE INDEX IF NOT EXISTS idx_serve_queue_officer_status ON serve_queue(officer_id, status);
