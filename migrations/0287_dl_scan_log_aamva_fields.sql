-- Expand dl_scan_log with AAMVA-specific columns so every barcode scan
-- stores the full decode provenance and key card-level fields for audit
-- and replay — without re-parsing the raw string from the findings blob.
--
-- All columns are nullable (existing rows get NULL, not an error).
-- D1 does not support IF NOT EXISTS on ADD COLUMN — wrapped in
-- continue-on-error deploy; runtime reconciler handles idempotency.

ALTER TABLE dl_scan_log ADD COLUMN raw_aamva_text   TEXT;
ALTER TABLE dl_scan_log ADD COLUMN aamva_version    TEXT;
ALTER TABLE dl_scan_log ADD COLUMN card_type        TEXT;
ALTER TABLE dl_scan_log ADD COLUMN is_real_id       INTEGER;
ALTER TABLE dl_scan_log ADD COLUMN decode_passes    INTEGER;
ALTER TABLE dl_scan_log ADD COLUMN decode_ms        INTEGER;
