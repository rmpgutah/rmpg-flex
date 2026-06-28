-- Fast-scan: the plate returns immediately; vehicle attributes enrich in the
-- background. enrich_status tracks that lifecycle: pending|done|failed.
-- D1 has no IF NOT EXISTS on ADD COLUMN; re-apply failure is acceptable
-- (the route reconciles this column at boot via ensureAlprSchema).
ALTER TABLE alpr_captures ADD COLUMN enrich_status TEXT;
