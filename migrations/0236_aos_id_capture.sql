-- 0236_aos_id_capture.sql
-- AoS ID capture: full AAMVA data, persons integration, front/back ID photos.
--
-- serve_receipts: 5 new columns (FK to persons, AAMVA snapshot, scan method, R2 keys)
-- serve_receipt_persons: new junction table linking receipts to person records
-- persons_ext: 8 new columns for lesser-known AAMVA fields

-- ── serve_receipts additions ────────────────────────────────
ALTER TABLE serve_receipts ADD COLUMN recipient_person_id INTEGER
  REFERENCES persons(id);
ALTER TABLE serve_receipts ADD COLUMN recipient_aamva_json TEXT;
ALTER TABLE serve_receipts ADD COLUMN id_scan_method TEXT;
ALTER TABLE serve_receipts ADD COLUMN id_front_r2_key TEXT;
ALTER TABLE serve_receipts ADD COLUMN id_back_r2_key TEXT;

-- ── serve_receipt_persons junction ──────────────────────────
CREATE TABLE IF NOT EXISTS serve_receipt_persons (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id       INTEGER NOT NULL,
  person_id        INTEGER NOT NULL,
  role             TEXT NOT NULL DEFAULT 'recipient',
  id_scan_method   TEXT,
  id_front_r2_key  TEXT,
  id_back_r2_key   TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (receipt_id) REFERENCES serve_receipts(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id)  REFERENCES persons(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_srp_receipt_person_role
  ON serve_receipt_persons(receipt_id, person_id, role);
CREATE INDEX IF NOT EXISTS idx_srp_person
  ON serve_receipt_persons(person_id);

-- ── persons_ext: lesser-known AAMVA fields ──────────────────
ALTER TABLE persons_ext ADD COLUMN place_of_birth TEXT;
ALTER TABLE persons_ext ADD COLUMN name_prefix TEXT;
ALTER TABLE persons_ext ADD COLUMN is_veteran INTEGER;
ALTER TABLE persons_ext ADD COLUMN non_resident_indicator INTEGER;
ALTER TABLE persons_ext ADD COLUMN limited_duration_doc INTEGER;
ALTER TABLE persons_ext ADD COLUMN card_revision_date TEXT;
ALTER TABLE persons_ext ADD COLUMN dl_hazmat_expiry TEXT;
ALTER TABLE persons_ext ADD COLUMN card_type TEXT;
