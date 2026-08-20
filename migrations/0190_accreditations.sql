-- Officer accreditations/certifications tracking, backing AccreditationsPage.tsx.
-- Deliberately separate from officer_certifications/certification_types (the
-- Training module's cert_type_id-FK model) — this client page was built
-- against a free-text type/issuing_body + richer status enum + reminders_sent
-- contract that never had a matching table. See CLAUDE.md session log.
CREATE TABLE IF NOT EXISTS accreditations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  issuing_body TEXT NOT NULL,
  certificate_number TEXT,
  issued_date TEXT,
  expiration_date TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','expired','pending_renewal','revoked','suspended')),
  reminders_sent INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (officer_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_accreditations_officer ON accreditations(officer_id);
CREATE INDEX IF NOT EXISTS idx_accreditations_status ON accreditations(status);
CREATE INDEX IF NOT EXISTS idx_accreditations_expiration ON accreditations(expiration_date);
