-- 0101: Utah jail/booking roster source registry (Intel Wave 3a).
-- Bookings themselves land in the existing arrest_records table; this
-- registry tracks each county/state source + scrape health.
-- ⚠️ Apply directly to live D1 (785de7ae) after merge.
CREATE TABLE IF NOT EXISTS jail_roster_sources (
  source_key TEXT PRIMARY KEY,          -- e.g. 'ut-salt-lake', 'ut-udc'
  display_name TEXT NOT NULL,
  county TEXT,
  state TEXT NOT NULL DEFAULT 'UT',
  source_url TEXT,
  kind TEXT NOT NULL DEFAULT 'manual',  -- html|json|browser|portal|manual
  status TEXT NOT NULL DEFAULT 'pending', -- active|pending|disabled
  last_run_at TEXT,
  last_status TEXT,
  row_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
