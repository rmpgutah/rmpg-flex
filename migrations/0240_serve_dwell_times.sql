-- migrations/0240_serve_dwell_times.sql
CREATE TABLE IF NOT EXISTS serve_dwell_times (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address_hash TEXT NOT NULL,
  defendant_type TEXT NOT NULL CHECK(defendant_type IN ('individual','business')),
  dwell_seconds INTEGER NOT NULL CHECK(dwell_seconds > 30 AND dwell_seconds < 7200),
  logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sdt_address ON serve_dwell_times(address_hash);
