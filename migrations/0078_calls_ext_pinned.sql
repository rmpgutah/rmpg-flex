-- Migration 0078: Add pinned column to calls_for_service_ext
-- The pin/unpin feature writes to calls_for_service_ext.pinned (extensions.ts),
-- but the column was added via a direct D1 patch that may not survive a D1
-- restore or fork. Backfill it via a formal migration.
-- calls_for_service.pinned was already added via migration 0003.

ALTER TABLE calls_for_service_ext ADD COLUMN pinned INTEGER DEFAULT 0;
