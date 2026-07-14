-- Adds recorder-document link-out fields used by counties that only expose
-- a document index (Tooele) rather than full assessed-value data. NULL for
-- every other county's parcel_records rows.
ALTER TABLE parcel_records ADD COLUMN recorded_document_url TEXT;
ALTER TABLE parcel_records ADD COLUMN recorded_document_type TEXT;
