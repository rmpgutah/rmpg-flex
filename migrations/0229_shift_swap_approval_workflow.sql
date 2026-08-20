-- 0229_shift_swap_approval_workflow.sql
-- =====================================================================
-- Adds a target-officer acceptance step to the shift-swap lifecycle.
--
-- WHY A FULL TABLE REBUILD:
--   SQLite (and therefore D1) cannot ALTER an existing CHECK constraint.
--   The only way to change it is the standard create-new -> copy -> drop ->
--   rename procedure (same pattern as migrations/0040_calls_status_add_on_hold.sql).
--   No extra idempotency guard is added around the rebuild itself, matching
--   0040's precedent -- D1's migration tracking (scripts/apply-migration.sh
--   + the d1_migrations table) is what prevents re-application, not
--   defensive SQL inside the migration file.
--
-- New columns:
--   target_responded_at -- stamped when the named target officer
--                           accepts/rejects; NULL until then.
--   escalated_at         -- stamped the first time the 24h escalation
--                           sweep fires for this row; the sweep's dedupe
--                           key so a swap is escalated at most once.
--
-- This migration ONLY changes the status CHECK line and adds the two
-- columns above. Every other column, default, and FK is reproduced
-- verbatim from migrations/0031_shift_plans.sql so `INSERT ... SELECT`
-- lines up 1:1 (with two extra trailing NULLs for the new columns).
-- =====================================================================

CREATE TABLE shift_swap_requests_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  requester_name TEXT,
  target_id INTEGER REFERENCES users(id),
  target_name TEXT,
  plan_id TEXT REFERENCES shift_plans(id),
  shift_date TEXT NOT NULL,
  original_shift TEXT,
  requested_shift TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending','pending_supervisor','approved','denied','cancelled'
  )),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_by_name TEXT,
  reviewed_at TEXT,
  review_notes TEXT,
  target_responded_at TEXT,
  escalated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO shift_swap_requests_new (
  id, requester_id, requester_name, target_id, target_name, plan_id,
  shift_date, original_shift, requested_shift, reason, status,
  reviewed_by, reviewed_by_name, reviewed_at, review_notes,
  target_responded_at, escalated_at, created_at
)
SELECT
  id, requester_id, requester_name, target_id, target_name, plan_id,
  shift_date, original_shift, requested_shift, reason, status,
  reviewed_by, reviewed_by_name, reviewed_at, review_notes,
  NULL, NULL, created_at
FROM shift_swap_requests;

DROP TABLE shift_swap_requests;

ALTER TABLE shift_swap_requests_new RENAME TO shift_swap_requests;

CREATE INDEX IF NOT EXISTS idx_shift_swaps_status ON shift_swap_requests(status);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_date ON shift_swap_requests(shift_date);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_requester ON shift_swap_requests(requester_id);

-- Default notification rules for the two new events this sub-project
-- introduces. Follows the exact seeding precedent from migration 0228
-- (comms-integration sub-project) -- idempotent via WHERE NOT EXISTS
-- since notification_rules has no unique index on trigger_event.

INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Shift swap target accepted', 'A named target officer accepted a shift swap -- ready for supervisor review.', 'shift_swap_target_accepted', '{}', '["admin","manager","supervisor"]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'shift_swap_target_accepted');

INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Shift swap escalated', 'A shift swap request has been awaiting action for over 24 hours.', 'shift_swap_escalated', '{}', '["admin","manager"]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'shift_swap_escalated');
