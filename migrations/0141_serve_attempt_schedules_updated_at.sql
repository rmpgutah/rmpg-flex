-- migrations/0141_serve_attempt_schedules_updated_at.sql
-- PR 2 of the process-service auto-scheduler:
-- adds updated_at to serve_attempt_schedules so PATCH /schedule/:slotId can
-- use it for optimistic concurrency (If-Unmodified-Since header).
--
-- ⚠️ D1 has no "ADD COLUMN IF NOT EXISTS". The runtime reconciler in
-- src/routes/serveIntake.ts (reconcileScheduleSchema) catches a failed
-- re-apply and skips silently.

ALTER TABLE serve_attempt_schedules
  ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
