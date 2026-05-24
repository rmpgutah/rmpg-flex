-- ============================================================
-- premise_alerts — persistent location-based hazard warnings
-- ============================================================
-- Dispatcher creates one per address with known officer-safety
-- hazards (mental health, weapons present, prior assaults on
-- officers, etc.). Auto-pushed to assigned units within 50m on
-- dispatch (Spillman parity, DI-3).
-- ============================================================

CREATE TABLE IF NOT EXISTS premise_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  alert_type TEXT NOT NULL DEFAULT 'caution',
  alert_level TEXT DEFAULT 'info' CHECK(alert_level IN ('info','warning','critical')),
  title TEXT NOT NULL,
  description TEXT,
  flags TEXT DEFAULT '[]',
  expires_at TEXT,
  created_by INTEGER REFERENCES users(id),
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_premise_alerts_address ON premise_alerts(address);
CREATE INDEX IF NOT EXISTS idx_premise_alerts_coords ON premise_alerts(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_premise_alerts_active ON premise_alerts(active, expires_at);
