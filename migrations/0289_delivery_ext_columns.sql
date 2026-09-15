-- 0289_delivery_ext_columns.sql
-- =====================================================================
-- rmpgutahps.us delivery-scheduling integration, piece 1/3: pushes a
-- confirmed delivery appointment into Flex as a real dispatchable
-- calls_for_service row. Delivery-specific fields go on the existing
-- 1:1 overflow table (calls_for_service is at/near the D1 100-column
-- cap — see CLAUDE.md gotcha #19 and the 0262 rebuild incident) rather
-- than a new table, matching the precedent set by 0184
-- (external_source_system) and 0041 (the ADD-COLUMN-on-_ext fallback
-- adopted after a CHECK-constraint rebuild broke live D1).
--
-- delivery_slot_id is the idempotency key (rmpgutahps.us delivery_slots.id
-- — a subject can have more than one delivery scheduled over time, e.g.
-- after a decline + reschedule, so case_number alone isn't unique enough).
-- The unique index is partial because every non-delivery calls_for_service
-- row leaves this column NULL.
--
-- Spec: docs/superpowers/specs/2026-09-14-delivery-scheduler-cad-push-design.md
--
-- D1 does NOT support IF NOT EXISTS on ADD COLUMN; re-applying this file
-- against a DB that already has these columns raises "duplicate column
-- name", which deploy.yml's continue-on-error swallows (see CLAUDE.md).
-- =====================================================================

ALTER TABLE calls_for_service_ext ADD COLUMN delivery_slot_id INTEGER;
ALTER TABLE calls_for_service_ext ADD COLUMN delivery_case_number TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN delivery_scheduled_date TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN delivery_time_window TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN delivery_contact_name TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN delivery_contact_phone TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN delivery_contact_email TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN delivery_subject_name TEXT;
ALTER TABLE calls_for_service_ext ADD COLUMN delivery_status TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cfs_ext_delivery_slot_id
  ON calls_for_service_ext(delivery_slot_id) WHERE delivery_slot_id IS NOT NULL;
