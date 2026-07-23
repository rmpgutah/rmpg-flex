-- Default notification rules for the Fleet.io reliability hardening pass
-- (Reliability & Observability Hardening spec, 2026-07-23). Seeded here
-- (unlike every other trigger_event in this codebase, which is entirely
-- admin-authored via the Alert Rules tab) so the alerts work without
-- manual setup — an admin can edit or disable either row afterward from
-- Admin -> Alert Rules like any other rule. Idempotent via WHERE NOT
-- EXISTS since notification_rules has no unique index on trigger_event.
INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Fleet.io event dead-lettered', 'An outbound Fleet.io sync event exhausted all retry attempts and needs manual attention or a retry.', 'fleetio_event_dead_lettered', '{}', '["admin"]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'fleetio_event_dead_lettered');

INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Fleet.io sync queue unhealthy', 'The Fleet.io outbound sync queue has 5+ failed events or a pending event stuck for over 2 hours.', 'fleetio_queue_unhealthy', '{}', '["admin"]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'fleetio_queue_unhealthy');
