-- Add archived_at to bolos so archive/unarchive can be a soft toggle
-- independent of the status CHECK(status IN ('active','expired','cancelled')).
ALTER TABLE bolos ADD COLUMN archived_at TEXT;
