-- Tracks whether an outbound event that reached status='failed' (exhausted
-- all maxAttempts() retries) has already fired the fleetio_event_dead_lettered
-- notification, so healthSweep.ts's cron consumer notifies exactly once per
-- dead-lettered event instead of re-firing every */30 tick. NULL = not yet
-- notified. A bare ADD COLUMN is not idempotent on D1 — this file contains
-- ONLY this one statement so a re-apply failure here can never block
-- migrations numbered after it (see migrations/README.md).
ALTER TABLE fleetio_events ADD COLUMN dead_letter_notified_at TEXT;
