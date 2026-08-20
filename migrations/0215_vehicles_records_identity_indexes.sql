-- 0215_vehicles_records_identity_indexes.sql
-- ============================================================
-- Identity indexes for vehicles_records: make duplicate VINs impossible and
-- make plate/VIN resolution an index lookup instead of a full scan.
-- ============================================================
-- Live audit 2026-07-30 (D1 785de7ae): vehicles_records had ZERO indexes and
-- no uniqueness on either identifier. That is what let the CarsXE theft path
-- INSERT a second row for a car already known by plate, stamping is_stolen=1
-- on an orphan record while the plate-keyed row officers see stayed clean.
-- Application-level identity resolution (src/utils/carxe/vehicleRecords.ts
-- resolveVehicleRecord) is the primary fix; this is the database-level
-- backstop so any FUTURE code path that skips it fails loudly instead of
-- silently forking a record.
--
-- Pre-flight verified on live before writing this file: 42 rows, 4 with a
-- non-blank vin, all 4 distinct. So the unique index below cannot fail on
-- apply. RE-CHECK before applying to any other environment:
--   SELECT UPPER(TRIM(vin)) v, COUNT(*) c FROM vehicles_records
--    WHERE vin IS NOT NULL AND TRIM(vin) != '' GROUP BY 1 HAVING c > 1;
--
-- Both indexes are on UPPER(TRIM(<col>)) — an EXPRESSION index — not the bare
-- column. This is deliberate and load-bearing: existing rows were written by
-- several paths (ALPR, manual entry, imports) with inconsistent case and
-- padding, so a bare-column unique index would happily accept 'abc123' and
-- 'ABC123 ' as two different cars. It also means resolveVehicleRecord's
-- `WHERE UPPER(TRIM(vin)) = ?` predicate matches the index exactly and gets a
-- SEARCH rather than a SCAN.
--
-- The unique index is PARTIAL (WHERE vin IS NOT NULL AND TRIM(vin) != '').
-- Without that clause, the 38 live VIN-less rows would collide with each other
-- on NULL/'' and the index would fail to build. SQLite treats NULLs as
-- distinct in unique indexes, but '' is a real value and would collide.
--
-- No ALTER TABLE here, so the D1 100-column cap does not apply.

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_records_vin_unique
  ON vehicles_records (UPPER(TRIM(vin)))
  WHERE vin IS NOT NULL AND TRIM(vin) != '';

CREATE INDEX IF NOT EXISTS idx_vehicles_records_plate
  ON vehicles_records (UPPER(TRIM(plate_number)));
