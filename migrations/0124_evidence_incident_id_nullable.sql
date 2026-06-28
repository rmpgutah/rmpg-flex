-- migrations/0124_evidence_incident_id_nullable.sql
-- Make evidence.incident_id NULLABLE.
--
-- The evidence write path (src/routes/records.ts POST /records/evidence)
-- intentionally supports standalone evidence — found property with no linked
-- incident — but the column was declared `incident_id INTEGER NOT NULL`, so
-- any incident-less save failed with
--   "NOT NULL constraint failed: evidence.incident_id".
--
-- SQLite/D1 has no ALTER COLUMN, so dropping NOT NULL requires a table rebuild.
-- DROP TABLE under FK enforcement performs an implicit DELETE that would fire
-- ON DELETE CASCADE on case_evidence / case_evidence_links, so foreign_keys is
-- turned OFF for the swap and the FK references stay valid because row ids are
-- preserved by the explicit-column copy.
--
-- ⚠️ Already applied directly to live 785de7ae (deploy migration step is
-- continue-on-error). Column list reflects the post-0123 schema (57 columns);
-- keep it in sync if evidence gains more columns before this lands.
PRAGMA foreign_keys=OFF;

ALTER TABLE evidence RENAME TO evidence_old_notnull;

CREATE TABLE evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_number TEXT,
  incident_id INTEGER,
  description TEXT,
  evidence_type TEXT,
  storage_location TEXT,
  collected_by INTEGER,
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','in_storage','submitted_to_le','released','disposed')),
  chain_of_custody TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), location_found TEXT, condition TEXT, quantity INTEGER, release_authorized_by TEXT, released_to TEXT, release_date TEXT, collected_date TEXT, packaging_type TEXT, dimensions TEXT, weight TEXT, photo_taken INTEGER, lab_submitted INTEGER, lab_case_number TEXT, lab_name TEXT, disposal_method TEXT, disposal_date TEXT, disposal_authorized_by TEXT, serial_number TEXT, brand TEXT, model TEXT, estimated_value REAL, category TEXT, notes TEXT, updated_at TEXT, retention_until TEXT, disposition TEXT, storage_temperature REAL, is_biological INTEGER, case_id INTEGER, narcotics_flag INTEGER DEFAULT 0, temperature_sensitive INTEGER DEFAULT 0, collection_context TEXT, court_hold_reference TEXT, checked_out_by INTEGER, checked_out_at TEXT, checkout_reason TEXT, expected_return_date TEXT, condition_on_return TEXT, release_status TEXT, release_requested_by INTEGER, release_requested_at TEXT, release_to TEXT, release_reason TEXT, release_approved_by INTEGER, release_approved_at TEXT, location_detail TEXT, flags TEXT,
  FOREIGN KEY (incident_id) REFERENCES incidents(id),
  FOREIGN KEY (collected_by) REFERENCES users(id)
);

INSERT INTO evidence (
  id, evidence_number, incident_id, description, evidence_type, storage_location,
  collected_by, status, chain_of_custody, created_at, location_found, condition,
  quantity, release_authorized_by, released_to, release_date, collected_date,
  packaging_type, dimensions, weight, photo_taken, lab_submitted, lab_case_number,
  lab_name, disposal_method, disposal_date, disposal_authorized_by, serial_number,
  brand, model, estimated_value, category, notes, updated_at, retention_until,
  disposition, storage_temperature, is_biological, case_id, narcotics_flag,
  temperature_sensitive, collection_context, court_hold_reference, checked_out_by,
  checked_out_at, checkout_reason, expected_return_date, condition_on_return,
  release_status, release_requested_by, release_requested_at, release_to,
  release_reason, release_approved_by, release_approved_at, location_detail, flags
)
SELECT
  id, evidence_number, incident_id, description, evidence_type, storage_location,
  collected_by, status, chain_of_custody, created_at, location_found, condition,
  quantity, release_authorized_by, released_to, release_date, collected_date,
  packaging_type, dimensions, weight, photo_taken, lab_submitted, lab_case_number,
  lab_name, disposal_method, disposal_date, disposal_authorized_by, serial_number,
  brand, model, estimated_value, category, notes, updated_at, retention_until,
  disposition, storage_temperature, is_biological, case_id, narcotics_flag,
  temperature_sensitive, collection_context, court_hold_reference, checked_out_by,
  checked_out_at, checkout_reason, expected_return_date, condition_on_return,
  release_status, release_requested_by, release_requested_at, release_to,
  release_reason, release_approved_by, release_approved_at, location_detail, flags
FROM evidence_old_notnull;

DROP TABLE evidence_old_notnull;

PRAGMA foreign_keys=ON;
