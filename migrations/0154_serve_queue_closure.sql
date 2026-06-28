-- ============================================================
-- RMPG Flex — Serve queue closure timestamp
-- Migration 0154
-- Records the exact moment a serve job is formally closed
-- (status transitions to 'served'). Distinct from updated_at
-- which changes on every field edit; closed_at is write-once
-- and becomes the authoritative completion timestamp for
-- affidavits, billing audits, and SLA reporting.
-- ============================================================

ALTER TABLE serve_queue ADD COLUMN closed_at TEXT;
