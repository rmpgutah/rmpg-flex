-- ============================================================
-- Migration 0271: comms_bolos — BOLO (Be On the Lookout) table
-- ============================================================
-- Referenced by serveIntakePreServeIntel.ts for pre-serve intel
-- checks. Table was expected to exist per design doc but was
-- never created.
-- ============================================================

CREATE TABLE IF NOT EXISTS comms_bolos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_name TEXT NOT NULL,
  reason TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comms_bolos_active
  ON comms_bolos(active)
  WHERE active = 1;

CREATE INDEX IF NOT EXISTS idx_comms_bolos_subject
  ON comms_bolos(subject_name);
