-- migrations/0255_serve_dwell_apartment_type.sql
-- Relax the defendant_type CHECK on serve_dwell_times to include 'apartment'.
-- D1/SQLite cannot ALTER a CHECK constraint, so we recreate the table.
-- The logged_at DEFAULT ensures new rows still auto-stamp.

CREATE TABLE IF NOT EXISTS serve_dwell_times_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address_hash TEXT NOT NULL,
  defendant_type TEXT NOT NULL CHECK(defendant_type IN ('individual','apartment','business')),
  dwell_seconds INTEGER NOT NULL CHECK(dwell_seconds > 30 AND dwell_seconds < 7200),
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO serve_dwell_times_new (id, address_hash, defendant_type, dwell_seconds, logged_at)
  SELECT id, address_hash, defendant_type, dwell_seconds, logged_at
  FROM serve_dwell_times;

DROP TABLE IF EXISTS serve_dwell_times;
ALTER TABLE serve_dwell_times_new RENAME TO serve_dwell_times;

CREATE INDEX IF NOT EXISTS idx_sdt_address ON serve_dwell_times(address_hash);
