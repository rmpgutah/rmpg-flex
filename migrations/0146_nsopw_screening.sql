-- 0146: Nationwide Sex Offender Registry (NSOPW) screening.
-- Spec: docs/superpowers/specs/2026-06-22-nationwide-sor-nsopw-design.md
--
-- Slots a new `nsopw` source into the existing screening framework
-- (mig 0106 + 0120). Because the screening_hits / screening_source_state
-- / screening_scan_runs tables already exist, the framework gives us
-- the cron sweep, review queue (client/src/pages/intel/ReviewQueues.tsx),
-- confirm/dismiss, and dossier integration for free as soon as the
-- adapter is registered. This migration adds three NSOPW-specific
-- artifacts:
--
--   national_sex_offenders  — persisted hits (analog to utah_sex_offenders;
--                             flat search columns + detail_json blob).
--   nsopw_query_cache       — query-level cache keyed by normalized
--                             {surname|forename|dob}, with TTL.
--   nsopw_runs              — per-query run log + ad-hoc batch run log.
--
-- D1 does NOT support IF NOT EXISTS on ADD COLUMN. The Worker reconciles
-- missing columns at runtime via ensureNsopwColumns() in src/utils/nsopw/
-- index.ts; deploy.yml runs migrations with continue-on-error.
--
-- 🔴 APPLY TO LIVE 785de7ae after merge.

CREATE TABLE IF NOT EXISTS national_sex_offenders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- NSOPW federates queries to participating jurisdictions. Each row
  -- here is one offender record returned by NSOPW; the jurisdiction
  -- is the state/territory/tribe that owns the source-of-truth record.
  nsopw_offender_id TEXT,           -- NSOPW-side internal id when present
  jurisdiction TEXT,                -- 'UT', 'CO', 'AZ', etc.
  jurisdiction_label TEXT,          -- 'Utah Bureau of Criminal Identification'
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  suffix TEXT,
  aliases TEXT,                     -- JSON array of strings
  date_of_birth TEXT,               -- 'YYYY-MM-DD' when known
  sex TEXT,
  race TEXT,
  height TEXT,
  weight TEXT,
  hair_color TEXT,
  eye_color TEXT,
  scars_marks TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  offense TEXT,                     -- top-line offense summary
  risk_level TEXT,                  -- jurisdiction-native tier label
  tier INTEGER,                     -- normalized 1/2/3 when derivable
  registration_status TEXT,         -- 'compliant', 'non_compliant', 'absconder', etc.
  compliance_status TEXT,
  photo_url TEXT,
  detail_url TEXT,                  -- jurisdiction's deep-link to the public record
  detail_json TEXT,                 -- full NSOPW response blob for this offender
  last_seen_at TEXT,                -- last time NSOPW returned this record
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_nsopw_name
  ON national_sex_offenders(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_nsopw_jurisdiction
  ON national_sex_offenders(jurisdiction);
-- Composite for the cross-ref by name + DOB (the user's stated requirement).
CREATE INDEX IF NOT EXISTS idx_nsopw_name_dob
  ON national_sex_offenders(last_name, first_name, date_of_birth);
-- offender_id can collide across jurisdictions; uniqueness is per-jurisdiction.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nsopw_jur_offender
  ON national_sex_offenders(jurisdiction, nsopw_offender_id);

-- Query-level cache. Keyed by the normalized {surname|forename|dob} blob
-- so 'Smith, John 1985-06-12' / 'SMITH JOHN A 06/12/1985' collapse to one
-- key. Hits avoid burning MOU API quota; misses also cache so we don't
-- re-query a known-empty name on every CFS subject add.
CREATE TABLE IF NOT EXISTS nsopw_query_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key TEXT NOT NULL,          -- normalized identity hash
  query_surname TEXT,
  query_forename TEXT,
  query_dob TEXT,
  result_count INTEGER DEFAULT 0,   -- 0 = clear-at-time-T, >0 = hit set size
  hit_offender_ids TEXT,            -- JSON array of national_sex_offenders.id
  raw_response TEXT,                -- full NSOPW JSON envelope (for audit/replay)
  jurisdiction_coverage TEXT,       -- JSON map: { 'UT': 'ok', 'CA': 'timeout', ... }
  queried_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL          -- queried_at + cache_ttl_days
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nsopw_cache_key
  ON nsopw_query_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_nsopw_cache_expires
  ON nsopw_query_cache(expires_at);

-- Per-query run log + ad-hoc batch run log. Distinct from
-- screening_scan_runs (which is engine-wide); this one carries
-- NSOPW-specific detail like jurisdiction coverage, MOU rate-limit
-- response codes, and per-run quota tracking.
CREATE TABLE IF NOT EXISTS nsopw_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'query',  -- 'query' | 'sweep' | 'manual' | 'backfill'
  triggered_by TEXT,                   -- 'cron' | 'cfs_subject_add' | 'person_create' | 'manual' | user_id
  query_surname TEXT,
  query_forename TEXT,
  query_dob TEXT,
  cache_hit INTEGER DEFAULT 0,
  candidates_returned INTEGER DEFAULT 0,
  confirmed_matches INTEGER DEFAULT 0,
  possible_matches INTEGER DEFAULT 0,
  excluded_matches INTEGER DEFAULT 0,
  http_status INTEGER,
  latency_ms INTEGER,
  error TEXT,
  ran_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nsopw_runs_kind ON nsopw_runs(kind, ran_at DESC);

-- Seed the screening_source_state row so the per-source cadence gate
-- treats NSOPW like every other source. scan_interval_days=7 picks up
-- newly-registered offenders within a week (an LE-appropriate cadence
-- between Utah's daily push and the global 180-day default).
INSERT OR IGNORE INTO screening_source_state (source_key, enabled, scan_interval_days)
  VALUES ('nsopw', 1, 7);
