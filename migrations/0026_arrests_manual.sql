-- ============================================================
-- 0026_arrests_manual.sql
-- ============================================================
-- Manual booking / arrest records (Phase 1 RMS).
--
-- Two tables:
--   - arrest_records — shared between manual and (future) JailBase
--     poller. entry_source = 'manual' | 'jailbase' distinguishes.
--     Manual rows have NULL jailbase_id; poller rows are unique on
--     (jailbase_id, source_id).
--   - arrest_cross_links — generic linkage from an arrest to other
--     records (persons, citations, court_events, warrants, calls).
--
-- Notes vs legacy:
--   - Legacy schema was incomplete: CREATE TABLE listed only the
--     poller fields, but route handlers referenced manual fields
--     (release_date, bail_amount, booking_checklist, miranda_data,
--     etc) that were never added. This migration enumerates every
--     column the handlers actually use, so the port works against
--     a fresh D1 — no addCol() boot-patches needed.
--   - JSON-in-TEXT for checklist / property_inventory / miranda_data
--     mirrors legacy. Single-officer-per-booking workflow tolerates
--     it; concurrent multi-officer edits would lose updates but
--     that's the documented contract from the legacy app.
--
-- Poller-side endpoints (credentials, toggle, /poller/*, sync, etc)
-- are deferred to Phase 2 per the retirement plan ("Convert pollers
-- to scheduled() cron handlers"). This PR ports the manual subset.
-- ============================================================

CREATE TABLE IF NOT EXISTS arrest_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Poller-side identifiers (NULL for manual)
  jailbase_id TEXT,
  source_id TEXT,
  source_name TEXT,
  -- Subject
  full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  middle_name TEXT,
  date_of_birth TEXT,
  gender TEXT,
  race TEXT,
  height TEXT,
  weight TEXT,
  hair_color TEXT,
  eye_color TEXT,
  address TEXT,
  -- Booking
  booking_date TEXT,
  release_date TEXT,
  booking_number TEXT,
  agency TEXT,
  county TEXT,
  state TEXT,
  charges TEXT,                       -- JSON array stringified
  bail_amount REAL,
  hold_reason TEXT,
  notes TEXT,
  status TEXT DEFAULT 'active',       -- active|released|transferred|bonded|closed
  -- Media
  mugshot_url TEXT,
  details_url TEXT,
  -- Source tracking
  entry_source TEXT,                  -- 'manual' | 'jailbase' | ...
  entered_by INTEGER,                 -- user id
  raw_record TEXT,                    -- poller-side raw payload
  -- JSON columns for the manual booking workflow
  booking_checklist TEXT,             -- JSON {item_key: {at, by, by_id, notes}}
  property_inventory TEXT,            -- JSON [{id, description, category, quantity, ...}]
  miranda_data TEXT,                  -- JSON {read_at, read_by, acknowledged, witness, ...}
  -- Audit
  fetched_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  -- Manual rows have NULL jailbase_id/source_id; SQLite UNIQUE allows
  -- multiple NULL combos so manual entries don't collide.
  UNIQUE(jailbase_id, source_id),
  FOREIGN KEY (entered_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_arrests_status ON arrest_records(status);
CREATE INDEX IF NOT EXISTS idx_arrests_entry_source ON arrest_records(entry_source);
CREATE INDEX IF NOT EXISTS idx_arrests_booking_date ON arrest_records(booking_date);
CREATE INDEX IF NOT EXISTS idx_arrests_full_name ON arrest_records(full_name);
CREATE INDEX IF NOT EXISTS idx_arrests_fetched_at ON arrest_records(fetched_at);

CREATE TABLE IF NOT EXISTS arrest_cross_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arrest_record_id INTEGER NOT NULL,
  linked_type TEXT NOT NULL,          -- 'person' | 'citation' | 'court_event' | 'warrant' | 'call'
  linked_id INTEGER NOT NULL,
  match_type TEXT,                    -- 'manual' | 'auto_name' | 'auto_dob' | ...
  match_confidence REAL,              -- 0..1 for auto matches; NULL for manual
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (arrest_record_id) REFERENCES arrest_records(id) ON DELETE CASCADE,
  UNIQUE(arrest_record_id, linked_type, linked_id)
);

CREATE INDEX IF NOT EXISTS idx_arrest_links_arrest ON arrest_cross_links(arrest_record_id);
CREATE INDEX IF NOT EXISTS idx_arrest_links_linked ON arrest_cross_links(linked_type, linked_id);
