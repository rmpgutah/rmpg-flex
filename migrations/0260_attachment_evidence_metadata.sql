-- 0260_attachment_evidence_metadata.sql
-- Add evidence metadata columns to attachments for forensic photo overlays.
-- Columns are nullable so existing rows are unaffected.
ALTER TABLE attachments ADD COLUMN latitude REAL;
ALTER TABLE attachments ADD COLUMN longitude REAL;
ALTER TABLE attachments ADD COLUMN taken_at TEXT;
ALTER TABLE attachments ADD COLUMN reference_notes TEXT;
