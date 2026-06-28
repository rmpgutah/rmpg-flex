-- 0099: Intel watchlist — alert when a watched person/vehicle appears
-- in new activity (Palantir Phase 4). Swept by the per-minute cron;
-- alerts land in the existing notifications inbox.
-- ⚠️ Apply directly to live D1 (785de7ae) after merge (deploy step is
-- continue-on-error).
CREATE TABLE IF NOT EXISTS intel_watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,            -- 'person' | 'vehicle'
  entity_id INTEGER NOT NULL,
  reason TEXT,
  added_by INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_alert_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (entity_type, entity_id, added_by)
);
CREATE INDEX IF NOT EXISTS idx_iw_active ON intel_watchlist(active, entity_type);
