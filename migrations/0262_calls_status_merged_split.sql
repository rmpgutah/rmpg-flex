-- SQLite does not support ALTER TABLE … ALTER CHECK, so we recreate the table
-- to add 'merged' and 'split' to the status CHECK constraint. Without them the
-- merge handler (calls.ts line 1023) hits a constraint violation and 500s on
-- every call-merge attempt.
--
-- Also ensures run_card_id / run_card_applied_at exist on calls_for_service_ext
-- (they appear in the baseline snapshot but the numbered migration 0014 left
-- the ALTER statements commented out, so they may be absent on databases built
-- purely from numbered migrations).
--
-- The CHECK recreation must be done atomically. We use the standard SQLite
-- table-rebuild idiom: rename → create → copy → drop.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS calls_for_service_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_number TEXT UNIQUE,
  call_type TEXT NOT NULL,
  call_type_code TEXT,
  priority INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN (
      'pending','dispatched','enroute','onscene',
      'cleared','closed','cancelled','archived',
      'on_hold','merged','split'
    )),
  location TEXT,
  latitude REAL,
  longitude REAL,
  caller_name TEXT,
  caller_phone TEXT,
  narrative TEXT,
  notes TEXT,
  assigned_unit TEXT,
  disposition TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  cleared_at TEXT,
  closed_at TEXT,
  dispatched_at TEXT,
  enroute_at TEXT,
  onscene_at TEXT,
  officer_id INTEGER,
  district TEXT,
  beat TEXT,
  zone TEXT,
  response_time INTEGER,
  unit_count INTEGER DEFAULT 0,
  supervisor_notified INTEGER DEFAULT 0,
  sensitive INTEGER DEFAULT 0,
  archived_at TEXT,
  is_test INTEGER DEFAULT 0,
  source TEXT DEFAULT 'manual',
  channel TEXT,
  radio_channel TEXT,
  hold_reason TEXT,
  parent_call_id INTEGER,
  held_at TEXT
);

INSERT OR IGNORE INTO calls_for_service_new
  SELECT
    id, call_number, call_type, call_type_code, priority,
    CASE status
      WHEN 'merged' THEN 'merged'
      WHEN 'split'  THEN 'split'
      WHEN 'on_hold' THEN 'on_hold'
      ELSE status
    END,
    location, latitude, longitude,
    caller_name, caller_phone, narrative, notes,
    assigned_unit, disposition,
    created_at, updated_at, cleared_at, closed_at,
    dispatched_at, enroute_at, onscene_at,
    officer_id, district, beat, zone,
    response_time, unit_count,
    supervisor_notified, sensitive,
    archived_at, is_test, source, channel, radio_channel,
    hold_reason, parent_call_id, held_at
  FROM calls_for_service;

DROP TABLE calls_for_service;
ALTER TABLE calls_for_service_new RENAME TO calls_for_service;

PRAGMA foreign_keys = ON;

-- Ensure run_card tracking columns exist on the ext table (0014 left these
-- commented out; baseline/schema.sql has them but numbered-migration builds
-- may not).
ALTER TABLE calls_for_service_ext ADD COLUMN run_card_id INTEGER;
ALTER TABLE calls_for_service_ext ADD COLUMN run_card_applied_at TEXT;
