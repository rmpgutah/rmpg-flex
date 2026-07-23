-- Default notification rule for the Fleet.io webhook hardening pass
-- (Webhook Hardening spec, 2026-07-23). Fires when POST /api/fleetio/webhook
-- sees 10+ failed Authorization-header comparisons from one IP within a
-- 10-minute window (see src/routes/fleetioWebhook.ts) — signals active
-- credential-guessing against FLEETIO_WEBHOOK_SECRET, distinct from an
-- occasional operator mistake (e.g. re-registering the webhook with a
-- stale secret). Seeded here (same pattern as migration 0203's two rules)
-- so the alert works without manual setup; editable/disable-able afterward
-- from Admin -> Alert Rules like any other rule. Idempotent via WHERE NOT
-- EXISTS since notification_rules has no unique index on trigger_event.
INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
SELECT 'Fleet.io webhook probe detected', 'The Fleet.io webhook receiver saw 10+ failed auth attempts from one IP within 10 minutes — possible credential-guessing against FLEETIO_WEBHOOK_SECRET.', 'fleetio_webhook_probe_detected', '{}', '["admin"]', '[]', 'in_app', 1, 'System'
WHERE NOT EXISTS (SELECT 1 FROM notification_rules WHERE trigger_event = 'fleetio_webhook_probe_detected');
