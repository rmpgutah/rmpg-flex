-- Add DL barcode fields to persons_ext (overflow table for persons, which is at 96 cols).
-- dl_restrictions / dl_endorsements / dl_issue_date come from AAMVA PDF417 barcodes
-- (elements DCB, DCD, DBD respectively) and cannot go on persons directly (column cap).
ALTER TABLE persons_ext ADD COLUMN dl_restrictions TEXT;
ALTER TABLE persons_ext ADD COLUMN dl_endorsements TEXT;
ALTER TABLE persons_ext ADD COLUMN dl_issue_date   TEXT;
