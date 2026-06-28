-- 0064_mileage_anchor_audit.sql
-- Per-(officer,unit) mileage anchor + immutable admin-fix audit log.
-- Powers:
--   1. Auto-pickup: when an officer starts a new patrol / CFS on the same unit,
--      suggest the last known ending mileage so they don't have to re-type the
--      number from memory.
--   2. Admin correction: an admin (admin/manager/supervisor) can fix an
--      inaccurate ending_mileage on a closed CFS; the system rewrites the
--      bad row, propagates the delta to all later rows in the same scope
--      (so the chain stays mathematically consistent), and updates the
--      anchor so future auto-pickups start at the corrected baseline.
--   3. Audit: every fix writes an immutable mileage_audit row (admin, before,
--      after, delta, cascade count, reason) so the chain is fully traceable
--      for the FORM PS-211 trip log and any forensic inquiry.
--
-- Scope key conventions:
--   officer_unit:{officer_id}:{unit_id}  — primary, most accurate
--   officer:{officer_id}                 — fallback when unit is unknown
--   unit:{unit_id}                       — fallback when officer is unknown
--
-- Idempotent: every DDL uses IF NOT EXISTS. Safe to re-apply.

CREATE TABLE IF NOT EXISTS mileage_anchor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('officer_unit','officer','unit')),
  scope_key TEXT NOT NULL UNIQUE,
  officer_id INTEGER,
  unit_id INTEGER,
  current_mileage REAL NOT NULL DEFAULT 0,
  offset_miles REAL NOT NULL DEFAULT 0,
  last_entry_table TEXT,
  last_entry_id INTEGER,
  last_entry_at TEXT,
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (officer_id) REFERENCES users(id),
  FOREIGN KEY (unit_id) REFERENCES units(id)
);

CREATE INDEX IF NOT EXISTS idx_mileage_anchor_officer ON mileage_anchor(officer_id);
CREATE INDEX IF NOT EXISTS idx_mileage_anchor_unit ON mileage_anchor(unit_id);
CREATE INDEX IF NOT EXISTS idx_mileage_anchor_scope_key ON mileage_anchor(scope_key);

CREATE TABLE IF NOT EXISTS mileage_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_type TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  officer_id INTEGER,
  unit_id INTEGER,
  entry_table TEXT NOT NULL,
  entry_id INTEGER NOT NULL,
  field TEXT NOT NULL CHECK(field IN ('starting_mileage','ending_mileage')),
  before_value REAL,
  after_value REAL,
  delta REAL NOT NULL,
  cascade_count INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_mileage_audit_scope ON mileage_audit(scope_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mileage_audit_entry ON mileage_audit(entry_table, entry_id);
CREATE INDEX IF NOT EXISTS idx_mileage_audit_created_at ON mileage_audit(created_at DESC);
