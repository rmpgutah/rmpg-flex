-- ============================================================
-- 0156_error_log.sql — Structured server-side error tracking
-- ============================================================
-- Captures unhandled route errors, cron failures, and integration
-- outages in a queryable D1 table. Complements Workers Logs (7-day
-- retention, no structured query) with persistent error history
-- that the admin dashboard and alerting can read.
--
-- Written by the logger utility (`src/utils/logger.ts`) via the
-- `logErrorToDb()` helper, and by the onError handler in src/index.ts.
-- Rows are written fire-and-forget (waitUntil), never blocking the
-- request path.
-- ============================================================

CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Severity: 'error' | 'critical' | 'warning'
  severity TEXT NOT NULL DEFAULT 'error'
    CHECK(severity IN ('error', 'critical', 'warning')),
  -- Which subsystem: 'route', 'cron', 'integration', 'db', 'auth'
  category TEXT NOT NULL DEFAULT 'route',
  -- Human-readable summary (first 200 chars are indexed)
  message TEXT NOT NULL,
  -- Structured JSON details (stack trace, request context, query params)
  details_json TEXT,
  -- Trace ID for correlation across logs
  trace_id TEXT,
  -- Authenticated user who triggered the error, if any
  user_id INTEGER,
  -- Route or cron job identifier, e.g. 'POST /api/dispatch/calls'
  source TEXT,
  -- HTTP status code if applicable (route errors)
  status_code INTEGER,
  -- ISO-8601 UTC timestamp
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Query index: most recent errors, filtered by severity/category
CREATE INDEX IF NOT EXISTS idx_error_log_created
  ON error_log(created_at DESC);

-- Filter by category + recency (admin dashboard)
CREATE INDEX IF NOT EXISTS idx_error_log_category
  ON error_log(category, created_at DESC);

-- Filter by severity + recency (alerting)
CREATE INDEX IF NOT EXISTS idx_error_log_severity
  ON error_log(severity, created_at DESC);

-- Lookup errors for a specific trace
CREATE INDEX IF NOT EXISTS idx_error_log_trace
  ON error_log(trace_id);
