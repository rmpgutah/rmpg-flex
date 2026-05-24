-- ============================================================
-- 0034_patrol.sql
-- ============================================================
-- Patrol checkpoints + scans + breaks + tour verifications.
-- Phase 1 RMS port. Column set consolidates the initial CREATE plus
-- every legacy addCol() boot-patch (assigned_officer_id, location_
-- description, special_instructions, weather_json) up-front, since
-- D1 has no runtime boot reconciler.
--
-- evidence/* is NOT in this migration — the legacy /api/evidence
-- routes depend on the Dashcam AI subsystem (Ed25519 chain-of-custody
-- signing, prosecutor export bundle, filesystem storage adapter) that
-- has not been ported to the Worker. Tracked as a separate port.
-- ============================================================

CREATE TABLE IF NOT EXISTS patrol_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  assigned_officer_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  location_description TEXT,
  special_instructions TEXT,
  latitude REAL,
  longitude REAL,
  qr_code TEXT,
  sequence_order INTEGER NOT NULL DEFAULT 0,
  scan_required_interval_minutes INTEGER NOT NULL DEFAULT 60,
  is_active INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_patrol_checkpoints_property ON patrol_checkpoints(property_id);
CREATE INDEX IF NOT EXISTS idx_patrol_checkpoints_active ON patrol_checkpoints(is_active);

-- ── patrol_scans — append-only scan log ──
CREATE TABLE IF NOT EXISTS patrol_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkpoint_id INTEGER NOT NULL REFERENCES patrol_checkpoints(id) ON DELETE CASCADE,
  officer_id INTEGER NOT NULL REFERENCES users(id),
  scanned_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  latitude REAL,
  longitude REAL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'on_time' CHECK(status IN ('on_time','late','missed')),
  weather_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_patrol_scans_checkpoint ON patrol_scans(checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_patrol_scans_officer ON patrol_scans(officer_id);
CREATE INDEX IF NOT EXISTS idx_patrol_scans_when ON patrol_scans(scanned_at);

-- ── patrol_breaks — duty break tracking ──
CREATE TABLE IF NOT EXISTS patrol_breaks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL REFERENCES users(id),
  shift_date TEXT NOT NULL,
  break_start TEXT NOT NULL,
  break_end TEXT,
  break_type TEXT NOT NULL DEFAULT 'break' CHECK(break_type IN ('break','meal','rest')),
  duration_minutes REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_patrol_breaks_officer ON patrol_breaks(officer_id, shift_date);

-- ── patrol_tour_verifications — supervisor sign-off on a tour ──
CREATE TABLE IF NOT EXISTS patrol_tour_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL REFERENCES users(id),
  tour_date TEXT NOT NULL,
  verified_by INTEGER REFERENCES users(id),
  verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','rejected','pending')),
  notes TEXT,
  total_scans INTEGER NOT NULL DEFAULT 0,
  on_time_scans INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(officer_id, tour_date)
);

CREATE INDEX IF NOT EXISTS idx_patrol_tour_verifications_officer ON patrol_tour_verifications(officer_id);
CREATE INDEX IF NOT EXISTS idx_patrol_tour_verifications_date ON patrol_tour_verifications(tour_date);
