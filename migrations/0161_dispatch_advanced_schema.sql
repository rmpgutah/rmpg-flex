-- ============================================================
-- 0161: Dispatch advanced feature schema
-- ============================================================
-- Adds tables and columns for:
--   - External agency referral tracking
--   - Geofences (entry/exit alerts)
--   - BOLO resolution tracking
--   - Fleet pursuit-rated designation
--   - Unit fatigue tracking (existing columns, new index)
-- ============================================================

-- External agency referral tracking
CREATE TABLE IF NOT EXISTS external_referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL REFERENCES calls_for_service(id),
  agency_name TEXT NOT NULL,
  agency_case_number TEXT,
  referral_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','closed')),
  notes TEXT,
  follow_up_date TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_external_referrals_call ON external_referrals(call_id);
CREATE INDEX IF NOT EXISTS idx_external_referrals_status ON external_referrals(status);

-- Geofences for entry/exit alerts
CREATE TABLE IF NOT EXISTS geofences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  geojson TEXT NOT NULL,
  alert_type TEXT NOT NULL DEFAULT 'info' CHECK(alert_type IN ('info','warning','critical')),
  notify_roles TEXT NOT NULL DEFAULT '["admin","manager","supervisor","dispatcher"]',
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_geofences_active ON geofences(active);

-- BOLO resolution tracking columns
-- Add if table exists (D1 doesn't support IF NOT EXISTS for ALTER)
-- The anomalies.ts handler checks column existence before writing
CREATE TABLE IF NOT EXISTS bolo_resolutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bolo_id INTEGER NOT NULL REFERENCES bolos(id),
  call_id INTEGER REFERENCES calls_for_service(id),
  resolution_type TEXT NOT NULL CHECK(resolution_type IN ('apprehended','recovered','located','unfounded')),
  notes TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_bolo_resolutions_bolo ON bolo_resolutions(bolo_id);

-- Fleet pursuit-rated designation
-- Columns added via ALTER if not present; the handler checks columnExists()
-- since D1 doesn't support IF NOT EXISTS on ALTER TABLE

-- Unit fatigue tracking index
CREATE INDEX IF NOT EXISTS idx_time_entries_open ON time_entries(user_id, clock_out) WHERE clock_out IS NULL;
