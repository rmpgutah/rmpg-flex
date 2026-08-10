-- migrations/0234_tesseract_training_approval.sql
-- Single-person approval gate on top of the existing whole-document
-- text-correction flow (tesseract_training_corpus, migration 0230). Every
-- new submission lands as 'pending' via the column default; an admin or
-- manager (including the original submitter) flips it to 'approved' via
-- POST /documents/:id/approve. See
-- docs/superpowers/specs/2026-08-10-tesseract-training-portal-enhancements-design.md.
ALTER TABLE tesseract_training_corpus ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending', 'approved'));
ALTER TABLE tesseract_training_corpus ADD COLUMN approved_by INTEGER;
ALTER TABLE tesseract_training_corpus ADD COLUMN approved_at TEXT;
