-- 0072_calls_ext_add_deleted_at.sql
-- =====================================================================
-- Soft-delete for calls (admin-recoverable tombstone).
--
-- The physical DELETE on calls_for_service (which cascaded into
-- call_persons/call_vehicles/calls_for_service_ext) destroyed 14 live
-- calls because it had no role guard and no audit trail. Calls are now
-- tombstoned via calls_for_service_ext.deleted_at instead of removing
-- any row. The list/queue/active views filter deleted_at IS NOT NULL,
-- hiding soft-deleted calls from the board. The single-call GET (/:id)
-- still returns soft-deleted calls so admins can recover them.
--
-- calls_for_service_ext is the established 1:1 overflow table (FK id ->
-- calls_for_service(id) ON DELETE CASCADE), well under the D1 100-column
-- cap. Note: D1 does not support IF NOT EXISTS on ADD COLUMN; this
-- migration applies exactly once (tracked by name in d1_migrations).
-- =====================================================================

ALTER TABLE calls_for_service_ext ADD COLUMN deleted_at TEXT;
