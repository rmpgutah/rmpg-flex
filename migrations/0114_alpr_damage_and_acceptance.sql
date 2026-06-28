-- Advanced vehicle scanner: structured damage/condition + the 0.85 acceptance
-- gate, stored per-capture (the observation record). D1 has no IF NOT EXISTS on
-- ADD COLUMN — re-apply failure is acceptable; the route also self-heals these
-- via ensureAlprSchema (ALPR_EXTRA_COLUMNS) at boot.
ALTER TABLE alpr_captures ADD COLUMN condition TEXT;
ALTER TABLE alpr_captures ADD COLUMN damage_observed INTEGER;
ALTER TABLE alpr_captures ADD COLUMN damage_summary TEXT;
ALTER TABLE alpr_captures ADD COLUMN plate_confidence REAL;
-- accepted: 1 = read ≥85% confidence (confirmed); 0 = held/rejected; NULL = not
-- yet enriched. review_status (existing column) carries 'needs_review' |
-- 'confirmed' | 'rejected' for the review queue.
ALTER TABLE alpr_captures ADD COLUMN accepted INTEGER;
ALTER TABLE alpr_captures ADD COLUMN reviewed_by INTEGER;
ALTER TABLE alpr_captures ADD COLUMN reviewed_at TEXT;
