-- Service-location notations: operator-authored constraints on how and
-- when a specific address, business, or person can be served.
--
-- Examples:
--   ACME Corp. — closed weekends, M-F 08:00–17:00, cutoff 15:30
--   123 Main St — gated community, call ahead, no service after dark
--   John Doe — confirmed works nights, attempt 08:00–10:00 only
--
-- Matching at intake: entity_name (case-insensitive) and/or address_norm
-- (normalized address). The most recently updated active note wins when
-- multiple rows match.

CREATE TABLE IF NOT EXISTS serve_location_notes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Matching criteria — at least one required
  entity_type     TEXT    NOT NULL DEFAULT 'address',  -- 'business'|'person'|'address'
  entity_name     TEXT,           -- business or person name (case-insensitive)
  entity_id       INTEGER,        -- FK to businesses.id or persons.id if resolved
  address_norm    TEXT,           -- normalized address (normAddr) for secondary match

  -- Human-readable notation (shown verbatim in briefings / map popups)
  note_text       TEXT    NOT NULL,
  note_type       TEXT    NOT NULL DEFAULT 'hours',  -- 'hours'|'access'|'security'|'preference'|'other'

  -- Structured scheduling constraints extracted/entered from note_text
  days_available  TEXT,   -- JSON integer array e.g. [1,2,3,4,5] (0=Sun). NULL = any day
  hours_start     TEXT,   -- HH:MM earliest acceptable attempt
  hours_end       TEXT,   -- HH:MM latest acceptable attempt
  cutoff_time     TEXT,   -- HH:MM stops accepting service (≤ hours_end)

  -- Author and lifecycle
  created_by      INTEGER,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  active          INTEGER NOT NULL DEFAULT 1
);

-- Fast case-insensitive name lookup
CREATE INDEX IF NOT EXISTS idx_sln_name
  ON serve_location_notes(LOWER(entity_name))
  WHERE entity_name IS NOT NULL;

-- Fast normalized-address lookup
CREATE INDEX IF NOT EXISTS idx_sln_addr
  ON serve_location_notes(address_norm)
  WHERE address_norm IS NOT NULL;

-- FK-resolved entity lookup
CREATE INDEX IF NOT EXISTS idx_sln_entity
  ON serve_location_notes(entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

-- Add location_note_id to attempt schedules so the calendar can show
-- constraint badges without a per-slot JOIN.
ALTER TABLE serve_attempt_schedules
  ADD COLUMN location_note_id INTEGER;
