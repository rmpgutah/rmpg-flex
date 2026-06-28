-- 0076_officer_credentials.sql
-- Backs the Personnel "Credentials" tab (certifications / licenses with
-- expiry tracking). Previously GET /api/personnel/credentials returned a
-- hardcoded [] and the Add/Edit/Delete writes had no handler or proxy route,
-- so the tab was permanently empty and "Credential saved" was a lie.
-- Applied directly to live D1 (785de7ae) on 2026-06-03; this file is for parity
-- (the file-migration pipeline targets the abandoned rmpg-flex-db).
CREATE TABLE IF NOT EXISTS officer_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  credential_type TEXT,
  credential_number TEXT,
  issuing_authority TEXT,
  issued_date TEXT,
  expiry_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (officer_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_officer_credentials_officer ON officer_credentials(officer_id);
