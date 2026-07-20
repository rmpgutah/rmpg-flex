-- ============================================================
-- 0197: Traccar GPS integration — device↔unit mappings
-- ============================================================
-- Mirrors cpg_device_mappings (ClearPath's device↔unit table) but kept
-- separate/dedicated rather than extending that table, so Traccar can't
-- collide with or destabilize the already-shipped ClearPath integration.
-- Telemetry events reuse the existing `dashcam_events` table (migration
-- 0117) — it already carries a `source` discriminator column defaulting
-- to 'clearpathgps', clearly designed for exactly this multi-provider
-- reuse; Traccar rows just use source='traccar'. No new events table.
-- ============================================================

CREATE TABLE IF NOT EXISTS traccar_device_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  traccar_unique_id TEXT NOT NULL,
  traccar_device_id INTEGER,
  traccar_display_name TEXT,
  unit_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  ignition_state TEXT,
  last_odometer REAL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_traccar_map_device ON traccar_device_mappings(traccar_unique_id);
CREATE INDEX IF NOT EXISTS idx_traccar_map_unit ON traccar_device_mappings(unit_id);
