-- 0096: Utah Sex Offender Registry local store + poll runs.
-- Populated by an authorized agency feed (OffenderWatch LE API / Utah BCI
-- feed) via the SOR poller, or by admin import. NOT scraped from the public
-- communitynotification.com site, which blocks automated access and whose
-- terms of use prohibit harvesting. The deep records sweep queries this
-- table by name on every ID scan. (Applied to live D1 2026-06-11.)

CREATE TABLE IF NOT EXISTS utah_sex_offenders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  registry_id TEXT,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  date_of_birth TEXT,
  aliases TEXT,
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
  offense TEXT,
  risk_level TEXT,
  registration_status TEXT,
  compliance_status TEXT,
  photo_url TEXT,
  source TEXT,
  last_seen_at TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_utah_sor_name ON utah_sex_offenders(last_name, first_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_utah_sor_registry ON utah_sex_offenders(registry_id);

CREATE TABLE IF NOT EXISTS utah_sor_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT,
  records_seen INTEGER DEFAULT 0,
  records_upserted INTEGER DEFAULT 0,
  detail TEXT
);
