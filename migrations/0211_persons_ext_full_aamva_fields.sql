-- Overflow columns for AAMVA fields the DL barcode scanner already parses
-- but POST /records/from-dl-scan never persists. persons is at the D1
-- 100-column SELECT cap, so all of these go on persons_ext (the existing
-- 1:1 overflow table, migration 0081/0155), never on persons.
-- suffix already exists on persons_ext (migration 0081) but is unused by
-- the from-dl-scan write path — that gap is closed in code (Task 2), not schema.
ALTER TABLE persons_ext ADD COLUMN country TEXT;
ALTER TABLE persons_ext ADD COLUMN document_discriminator TEXT;
ALTER TABLE persons_ext ADD COLUMN is_real_id INTEGER;
ALTER TABLE persons_ext ADD COLUMN is_organ_donor INTEGER;
ALTER TABLE persons_ext ADD COLUMN under_18_until TEXT;
ALTER TABLE persons_ext ADD COLUMN under_21_until TEXT;
ALTER TABLE persons_ext ADD COLUMN aamva_version INTEGER;
ALTER TABLE persons_ext ADD COLUMN issuer_id TEXT;
ALTER TABLE persons_ext ADD COLUMN address2 TEXT;
ALTER TABLE persons_ext ADD COLUMN raw_aamva_elements TEXT;
