-- 0092 — Apartment/Unit columns for the remaining structured address blocks.
-- serve_queue (44 cols) + properties (61 cols) — both safely under the D1
-- 100-column cap, so real columns (unlike persons → persons_ext in 0091).
-- Applied directly to live D1 785de7ae on 2026-06-10; this file fails as
-- duplicate-column there and deploy's continue-on-error skips it.
-- Single-string address fields (call location, client address, vehicle owner,
-- citation subject) do NOT get columns — the client folds the unit into the
-- stored string via client/src/utils/addressUnit.ts.
ALTER TABLE serve_queue ADD COLUMN recipient_address_2 TEXT;
ALTER TABLE properties ADD COLUMN address_2 TEXT;
