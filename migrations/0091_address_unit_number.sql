-- 0091 — Apartment/Unit number on address blocks.
-- users (75 cols live) takes a real column; persons is at 96 cols (D1
-- 100-column SELECT cap, watched by check-column-cap.js) so its
-- address_2 lives in the 1:1 persons_ext overflow table instead
-- (same pattern as suffix/nationality — see records.ts PERSON_EXT_COLUMNS).
-- Applied directly to live D1 785de7ae on 2026-06-10; on live this file
-- fails as duplicate-column and deploy's continue-on-error skips it.
ALTER TABLE users ADD COLUMN address_2 TEXT;
ALTER TABLE persons_ext ADD COLUMN address_2 TEXT;
