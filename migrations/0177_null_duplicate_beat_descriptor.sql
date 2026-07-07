-- migrations/0177_null_duplicate_beat_descriptor.sql
-- migrations/0012_seed_geography.sql seeded beat_descriptor as an exact copy
-- of beat_name for all 719 beats. Null it out so a real descriptor can be
-- added later without a guard, and so any UI that skips the empty-string
-- check on legacy data no longer shows "Midvale A-1 — Midvale A-1". Safe to
-- re-run: the WHERE clause matches nothing on a second run.
UPDATE dispatch_beats SET beat_descriptor = NULL WHERE beat_descriptor = beat_name;
