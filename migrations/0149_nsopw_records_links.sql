-- 0149: NSOPW offender ↔ canonical records linkage.
-- ----------------------------------------------------
-- The operator's intent: NSOPW data shouldn't live in an isolated
-- pool — every matched offender should populate / link to the
-- canonical RMPG records (persons, properties, vehicles). On match:
--
--   1. national_sex_offenders.person_id     ← persons.id (auto-
--      created if no existing match by name + DOB). One person
--      record per real-world offender, regardless of how many
--      times they're returned by future federated queries.
--
--   2. nsopw_offender_properties (join)     ← properties.id rows
--      auto-created for each non-TRANSIENT / non-INCARCERATED
--      location in the NSOPW response. location_type captures
--      whether this is a RESIDENCE / WORK / etc. so the link
--      semantics survive.
--
--   3. nsopw_offender_vehicles (join)       ← future hook for
--      per-state detail-page enrichment (NSOPW federated response
--      does not return vehicles; the table is ready when a
--      jurisdiction scraper provides them).
--
-- D1 has no IF NOT EXISTS on ADD COLUMN — the Worker self-heals
-- via ensureNsopwColumns() at runtime.
--
-- 🔴 APPLY TO LIVE 785de7ae after merge.

ALTER TABLE national_sex_offenders ADD COLUMN person_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_nsopw_person ON national_sex_offenders(person_id);

-- Multi-location: one offender can have RESIDENCE + WORK + EDUCATIONAL.
-- (offender_id, property_id, location_type) is the dedup key so
-- re-running a federated query is idempotent.
CREATE TABLE IF NOT EXISTS nsopw_offender_properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offender_id INTEGER NOT NULL,        -- → national_sex_offenders.id
  property_id INTEGER NOT NULL,        -- → properties.id
  location_type TEXT,                  -- 'RESIDENCE' | 'WORK' | 'INCARCERATED' | 'STUDENT' | 'OTHER'
  location_name TEXT,                  -- NSOPW location.name when present
  latitude REAL,
  longitude REAL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nsopw_offprop_uniq
  ON nsopw_offender_properties(offender_id, property_id, location_type);
CREATE INDEX IF NOT EXISTS idx_nsopw_offprop_active
  ON nsopw_offender_properties(active, offender_id);
CREATE INDEX IF NOT EXISTS idx_nsopw_offprop_property
  ON nsopw_offender_properties(property_id);

-- Vehicles join: future-hook. NSOPW federated response does not
-- carry vehicle data; per-state detail enrichment (offenderUri
-- scrape) would populate this. Table shipped now so the schema
-- doesn't need to keep moving.
CREATE TABLE IF NOT EXISTS nsopw_offender_vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offender_id INTEGER NOT NULL,         -- → national_sex_offenders.id
  vehicle_id INTEGER NOT NULL,          -- → vehicles_records.id
  source TEXT NOT NULL DEFAULT 'nsopw_enrichment',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nsopw_offveh_uniq
  ON nsopw_offender_vehicles(offender_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_nsopw_offveh_active
  ON nsopw_offender_vehicles(active, offender_id);

-- Sentinel client for NSOPW-imported properties. The properties
-- table requires client_id NOT NULL; this row gives every NSOPW-
-- imported property a stable parent. Idempotent: INSERT OR IGNORE
-- on the (sentinel) name match.
INSERT OR IGNORE INTO clients (name, notes)
  VALUES (
    'NSOPW — Auto-Imported',
    'Sentinel client for properties imported from NSOPW federated SOR matches. ' ||
    'Properties under this client were created by the NSOPW records-link path ' ||
    '(src/utils/nsopw/recordsLink.ts) when an offender match returned a new address.'
  );
