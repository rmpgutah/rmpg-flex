-- 0081_persons_ext.sql
-- Overflow table for `persons`. Cloudflare D1 hard-caps a SELECT result set at
-- 100 columns ("too many columns in result set: SQLITE_ERROR" at 101). `persons`
-- is at 96 cols and `calls_for_service` is already AT the 100 cap, so newer
-- demographic fields can't be ADD COLUMN'd onto `persons` without breaking every
-- `SELECT * FROM persons` in the app (and tripping scripts/check-column-cap.js).
-- They live here instead, 1:1 with persons.id — the same pattern as
-- calls_for_service_ext. src/routes/records.ts splits writes (base columns →
-- persons, these → persons_ext) and merges them back on read. Adding more
-- overflow columns to THIS table later is safe; ADD COLUMN on `persons` is not.
CREATE TABLE IF NOT EXISTS persons_ext (
  person_id            INTEGER PRIMARY KEY REFERENCES persons(id) ON DELETE CASCADE,
  suffix               TEXT,
  nationality          TEXT,
  voice_description    TEXT,
  religion             TEXT,
  dietary_restrictions TEXT
);
