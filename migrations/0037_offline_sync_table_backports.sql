-- ============================================================
-- 0037_offline_sync_table_backports.sql
-- ============================================================
-- Backport 5 tables from legacy D1 (785de7ae) into the new D1
-- (8893480a, bound as DB on rmpg-flex-api) so that POST
-- /api/offline/sync/pull stops returning 500 `no such table` for
-- the browser's offline-cache hydrate.
--
-- Bug chain that led here:
--   PR #636 — added a real /sync/pull handler against 17 tables
--   PR #638 — merge-conflict resolution silently reverted /sync/pull
--             back to a stub (returned 200 with empty rows, so the
--             regression was invisible in console)
--   PR #641 — restored /sync/pull handler against the same 17 tables.
--             Caught the JS regression, but not the schema gap: the
--             new D1 (binding 'DB' on rmpg-flex-api) was never seeded
--             with 5 of those 17 tables. Live MCP check on 2026-05-24:
--                 clients          — missing (legacy: 2 rows)
--                 properties       — missing (legacy: 3 rows)
--                 time_entries     — missing (legacy: 2 rows)
--                 criminal_history — missing (legacy: 0 rows)
--                 trespass_orders  — missing (legacy: 0 rows)
--             Each browser's initial offline-cache fetch hit 5 silent
--             500s — visible in network tab, but the client's catch
--             only console.errors so users saw an inert "Sync failed"
--             banner with no detail.
--
-- This migration is schema-only — no data is copied from legacy. The
-- strangler-fig migration plan is that the new D1 will be the
-- canonical home for these tables eventually; copying tiny snapshots
-- now would only create a drift source if legacy keeps writing.
-- After this lands, offline-cache for these 5 tables hydrates as
-- empty (correct state) until either:
--   (a) writes start landing on the new D1 (per-table cutover), or
--   (b) a follow-up migration explicitly seeds from legacy.
--
-- Schemas are taken VERBATIM from `sqlite_master.sql` on legacy D1.
-- That means they include all the ALTER TABLE ADD COLUMN history
-- baked into a single CREATE TABLE — preserving column order is what
-- keeps `SELECT *` over the wire shape-identical for the client.
--
-- All statements are CREATE TABLE IF NOT EXISTS so this is safe to
-- re-apply (deploy.yml has `continue-on-error: true` on migrations,
-- so idempotence is the real safety net).
--
-- Applied live via Cloudflare D1 API before this migration landed —
-- 2026-05-24, see incident notes for that run. This file is the
-- canonical fix-up so a fresh D1 (CI / new environment) gets the
-- same schema deterministically.
-- ============================================================

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  contract_start TEXT,
  contract_end TEXT,
  sla_response_minutes INTEGER DEFAULT 15,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  billing_email TEXT, billing_address TEXT, contract_type TEXT, contract_value REAL,
  payment_terms TEXT, auto_renew INTEGER, updated_at TEXT, client_code TEXT,
  industry TEXT, website TEXT, tax_id TEXT, payment_method TEXT,
  billing_cycle TEXT, billing_day INTEGER, discount_percent REAL, late_fee_percent REAL,
  total_invoiced REAL, total_paid REAL, outstanding_balance REAL, incident_count INTEGER,
  last_incident_date TEXT, account_manager TEXT, priority_client INTEGER, client_since TEXT,
  rate_per_hour REAL, rate_per_incident REAL, rate_per_cfs REAL, email_verified INTEGER,
  verification_token TEXT, avatar TEXT, last_active_at TEXT
);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  property_type TEXT,
  gate_code TEXT,
  alarm_code TEXT,
  emergency_contact TEXT,
  post_orders TEXT,
  hazard_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  city TEXT, state TEXT, zip TEXT, access_instructions TEXT,
  is_active INTEGER NOT NULL DEFAULT 1, updated_at TEXT, notes TEXT,
  business_type TEXT, structure_type TEXT, occupancy_status TEXT, year_built TEXT,
  square_footage TEXT, number_of_stories TEXT, security_features TEXT,
  key_holder_name TEXT, key_holder_phone TEXT, key_holder_relationship TEXT,
  owner_name TEXT, owner_phone TEXT, last_inspection_date TEXT, archived_at TEXT,
  alarm_account TEXT, alarm_company TEXT, alarm_system TEXT, camera_system TEXT,
  closing_hours TEXT, contact_email TEXT, inspection_status TEXT, known_hazards TEXT,
  opening_hours TEXT, parking_info TEXT, patrol_frequency TEXT, roof_access TEXT,
  secondary_contact_name TEXT, secondary_contact_phone TEXT, utility_shutoffs TEXT,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  schedule_id INTEGER,
  clock_in TEXT NOT NULL,
  clock_out TEXT,
  clock_in_latitude REAL,
  clock_in_longitude REAL,
  total_hours REAL,
  break_start TEXT,
  break_minutes REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','edited','on_break')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  notes TEXT, edit_reason TEXT, edited_by INTEGER, edited_at TEXT,
  FOREIGN KEY (officer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS criminal_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  record_type TEXT,
  offense TEXT NOT NULL,
  offense_level TEXT,
  statute TEXT,
  case_number TEXT,
  agency TEXT,
  jurisdiction TEXT,
  offense_date TEXT,
  disposition TEXT,
  disposition_date TEXT,
  sentence TEXT,
  source TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS trespass_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  subject_photo_url TEXT, order_number TEXT, status TEXT, person_id INTEGER,
  subject_first_name TEXT, subject_last_name TEXT, subject_dob TEXT,
  subject_description TEXT, subject_name TEXT, property_id INTEGER,
  property_name TEXT, property_address TEXT, location TEXT, order_type TEXT,
  reason TEXT, conditions TEXT, duration_days INTEGER, effective_date TEXT,
  expiration_date TEXT, originating_call_id INTEGER, originating_incident_id INTEGER,
  issued_by INTEGER, issued_by_name TEXT, authorized_by TEXT, notes TEXT,
  section_id INTEGER, sector_id INTEGER, zone_id INTEGER, beat_id INTEGER,
  zone_beat TEXT, served_at TEXT, served_by INTEGER, updated_at TEXT, archived_at TEXT
);
