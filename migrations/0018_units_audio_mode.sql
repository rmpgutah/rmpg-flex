-- ============================================================
-- Migration 0018 — units.audio_mode column (DI-5)
-- ============================================================
-- Per-unit silent dispatch preference: audible (default), silent,
-- or vibrate. Officers set their own; supervisors+ can set any.
-- ============================================================

ALTER TABLE units ADD COLUMN audio_mode TEXT DEFAULT 'audible';
