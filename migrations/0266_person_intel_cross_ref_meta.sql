-- Cross-reference meta payload (2026-08-25).
-- Stores the adapter's source-shaped structured payload alongside each
-- captured cross-ref — currently the full WebOlivia/skip-trace profile
-- (typed/provider-tagged phones, previous addresses w/ timespans,
-- relatives & associates with ages) that the flattened data points lose.
-- Idempotent-safe to re-apply only on a fresh table; on live D1 apply once
-- via scripts/apply-migration.sh (duplicate-column error = already applied,
-- safe to ignore per the boot-reconciler convention).
ALTER TABLE person_intel_cross_refs ADD COLUMN meta_json TEXT;
