-- Default notification rules for the Shift Plans comms integration
-- (2026-08-08 design spec). Seeded here — like the Fleet.io reliability
-- rules in 0203 — rather than left for an admin to configure, since these
-- are safety/accountability-relevant (understaffed coverage, no active
-- plan) and time-sensitive (swap requests). An admin can edit or disable
-- any of these afterward from Admin -> Alert Rules like any other rule.
-- Idempotent via WHERE NOT EXISTS since notification_rules has no unique
-- index on trigger_event.

INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Shift swap requested', 'An officer submitted a shift swap request that needs review.', 'shift_swap_requested', '{}', '["admin","manager","supervisor"]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'shift_swap_requested');

INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Shift swap approved', 'A shift swap request was approved.', 'shift_swap_approved', '{}', '[]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'shift_swap_approved');

INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Shift swap denied', 'A shift swap request was denied.', 'shift_swap_denied', '{}', '[]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'shift_swap_denied');

INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Shift understaffed', 'An upcoming shift is below its configured minimum staffing level.', 'shift_understaffed', '{}', '["admin","manager","supervisor","dispatcher"]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'shift_understaffed');

INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'No active shift plan', 'An upcoming date has no active shift plan.', 'shift_no_active_plan', '{}', '["admin","manager","supervisor","dispatcher"]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'shift_no_active_plan');
