-- 0215_field_photo_review_columns.sql
-- GET /api/reports/photo-review-queue counts field_photos by reviewed_at, but
-- the column exists on no live table, so all three of its COUNT queries threw
-- and the endpoint's catch returned {pending: 0, total: 0, reviewed: 0} — a
-- permanently empty review queue that looked like "nothing to review".
-- Found by scripts/check-schema-refs-deep.py's WHERE-clause rule (a wrong
-- column in a WHERE returns zero rows rather than erroring, which is why this
-- class hid the longest).
ALTER TABLE field_photos ADD COLUMN reviewed_at TEXT;
ALTER TABLE field_photos ADD COLUMN reviewed_by INTEGER;
CREATE INDEX IF NOT EXISTS idx_field_photos_reviewed_at ON field_photos(reviewed_at);
