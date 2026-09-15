-- 0289_evidence_status_checkout_checkin.sql
-- =====================================================================
-- Add 'checked_out' and 'checked_in' to the evidence.status CHECK enum.
--
-- Live error_log (2026-09-14 12:47:10): 'Failed: D1_ERROR: CHECK constraint
-- failed: status IN (\'received\',\'in_storage\',\'submitted_to_le\',
-- \'released\',\'disposed\')' from POST /api/records/evidence/4/chain-action.
--
-- Three write paths in src/routes/records.ts set status to a value the
-- table's CHECK constraint has never allowed:
--   - POST /evidence/:id/chain-action  — STATUS_MAP maps action
--     'check_in' -> 'checked_in' and 'check_out' -> 'checked_out'
--   - POST /evidence/:id/checkout      — sets status = 'checked_out' directly
--   - POST /evidence/:id/checkin       — sets status = 'checked_in' directly
--
-- These aren't stray values — the whole app already treats them as real
-- evidence states: client/src/pages/EvidencePropertyPage.tsx has status
-- filter options and badge colors for both 'checked_in' and 'checked_out',
-- and src/routes/records.ts:2259 branches on
-- `row.status === 'checked_out'` to warn a release is in progress. The
-- table's CHECK constraint is the stale side of this drift, not the code —
-- every checkout/check-in action has been failing outright (409) since
-- whichever migration first defined this CHECK without them.
--
-- WHY A FULL TABLE REBUILD: SQLite (and therefore D1) cannot ALTER an
-- existing CHECK constraint. The only way is the standard
-- create-new -> copy -> drop -> rename procedure (same pattern as
-- 0262_calls_status_merged_split.sql).
--
-- Live evidence table is 59 columns (well under the 100-column D1 cap) and
-- has no non-autoindex indexes and no other table has a FOREIGN KEY
-- referencing evidence(id) (verified against live D1 785de7ae 2026-09-14),
-- so this rebuild is lower-risk than the calls_for_service one: no index
-- recreation and no cross-table FK exposure. Live data is 5 rows, all
-- status='received' (verified same query), well within the new CHECK.
--
-- After applying:
--   SELECT sql FROM sqlite_master WHERE name='evidence'; -- has 'checked_out','checked_in'
--   SELECT COUNT(*) FROM evidence;                        -- row count preserved (5)
--   SELECT COUNT(*) FROM pragma_table_info('evidence');   -- 59
-- =====================================================================

PRAGMA foreign_keys=OFF;

-- Precondition guard: abort the whole file unless evidence has exactly the
-- 59 columns this rebuild expects. abs(-9223372036854775808) raises
-- "integer overflow", so this single side-effect-free SELECT errors out (and
-- wrangler's per-file transaction rolls back) before anything is touched.
SELECT CASE
  WHEN (SELECT COUNT(*) FROM pragma_table_info('evidence')) <> 59
  THEN abs(-9223372036854775808)
END AS evidence_must_have_exactly_59_columns;

CREATE TABLE evidence_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_number TEXT,
  incident_id INTEGER,
  description TEXT,
  evidence_type TEXT,
  storage_location TEXT,
  collected_by INTEGER,
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','in_storage','submitted_to_le','released','disposed','checked_out','checked_in')),
  chain_of_custody TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  location_found TEXT,
  condition TEXT,
  quantity INTEGER,
  release_authorized_by TEXT,
  released_to TEXT,
  release_date TEXT,
  collected_date TEXT,
  packaging_type TEXT,
  dimensions TEXT,
  weight TEXT,
  photo_taken INTEGER,
  lab_submitted INTEGER,
  lab_case_number TEXT,
  lab_name TEXT,
  disposal_method TEXT,
  disposal_date TEXT,
  disposal_authorized_by TEXT,
  serial_number TEXT,
  brand TEXT,
  model TEXT,
  estimated_value REAL,
  category TEXT,
  notes TEXT,
  updated_at TEXT,
  retention_until TEXT,
  disposition TEXT,
  storage_temperature REAL,
  is_biological INTEGER,
  case_id INTEGER,
  narcotics_flag INTEGER DEFAULT 0,
  temperature_sensitive INTEGER DEFAULT 0,
  collection_context TEXT,
  court_hold_reference TEXT,
  checked_out_by INTEGER,
  checked_out_at TEXT,
  checkout_reason TEXT,
  expected_return_date TEXT,
  condition_on_return TEXT,
  release_status TEXT,
  release_requested_by INTEGER,
  release_requested_at TEXT,
  release_to TEXT,
  release_reason TEXT,
  release_approved_by INTEGER,
  release_approved_at TEXT,
  location_detail TEXT,
  flags TEXT,
  pq_sealed_description TEXT,
  pq_seal_aad TEXT,
  FOREIGN KEY (incident_id) REFERENCES incidents(id),
  FOREIGN KEY (collected_by) REFERENCES users(id)
);

INSERT INTO evidence_new (
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
  release_reason, release_approved_by, release_approved_at, location_detail,
  flags, pq_sealed_description, pq_seal_aad
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
  release_reason, release_approved_by, release_approved_at, location_detail,
  flags, pq_sealed_description, pq_seal_aad
FROM evidence;

DROP TABLE evidence;

ALTER TABLE evidence_new RENAME TO evidence;

PRAGMA foreign_keys=ON;
