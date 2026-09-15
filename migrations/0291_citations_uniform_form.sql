-- ============================================================
-- 0291_citations_uniform_form.sql
-- ============================================================
-- Reconfigures citations onto the official State of Utah
-- "UNIFORM CITATION OR INFORMATION AND SUMMONS TO APPEAR"
-- (form rev 10/13, the e-filed layout) instead of the in-house
-- approximation that citationUtahMaster.ts rendered before.
--
-- The official form captures ~45 fields the RMS never modeled
-- (CDL/restriction/birth place, motorcycle + picture-ID flags,
-- full physical descriptors, commercial-vehicle weights, mile
-- post / direction / interstate / military, complainant and
-- prosecuting agency, and the whole court-disposition strip).
--
-- They go in a 1:1 OVERFLOW TABLE, not on `citations`:
-- `citations` already carries 72 columns and D1's SQLite is
-- compiled with SQLITE_MAX_COLUMN=100 — a 101st column makes the
-- table UNREADABLE, not merely un-SELECTable (CLAUDE.md gotcha
-- #19). 72 + 45 = 117, so ALTERing `citations` would brick it.
-- Same 1:1 pattern as `calls_for_service_ext`.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS). The two ALTERs on
-- citation_violations target a 17-column table, nowhere near the
-- cap; D1 has no IF NOT EXISTS on ADD COLUMN, so a re-apply logs
-- duplicate-column and is treated as success by
-- scripts/d1PendingMigrations.ts.
-- ============================================================

CREATE TABLE IF NOT EXISTS citations_ext (
  citation_id INTEGER PRIMARY KEY,

  -- ── Caption / issuing identity ──────────────────────────
  -- "STATE OF UTAH / COUNTY OF ___ / CITY OF ___" caption block
  -- plus the ORI printed at the top right of the official form.
  ori TEXT,
  issuing_agency TEXT,
  prosecuting_agency TEXT,
  caption_county TEXT,
  caption_city TEXT,

  -- ── Defendant name split ────────────────────────────────
  -- The form prints Last / First / Middle in three separate
  -- boxes; `citations.person_name` stays the combined display
  -- form so existing readers are unaffected.
  person_last TEXT,
  person_first TEXT,
  person_middle TEXT,

  -- ── Defendant address split ─────────────────────────────
  person_city TEXT,
  person_state TEXT,
  person_zip TEXT,
  person_phone TEXT,

  -- ── Driver license block ────────────────────────────────
  dl_state TEXT,
  dl_expires TEXT,
  dl_restriction TEXT,
  cdl_presented INTEGER,          -- 1 yes / 0 no / NULL not asked
  motorcycle_endorsed INTEGER,
  picture_id INTEGER,
  birth_place TEXT,
  -- Full SSN as printed on the paper form. Officer-entered and
  -- optional. NEVER returned by the list endpoint — see the
  -- explicit column list in GET /api/citations.
  ssn TEXT,

  -- ── Physical descriptors ────────────────────────────────
  person_sex TEXT,
  person_race TEXT,
  person_height TEXT,
  person_weight TEXT,
  person_eyes TEXT,
  person_hair TEXT,

  -- ── Vehicle / vessel ────────────────────────────────────
  vehicle_plate_expires TEXT,
  vehicle_type TEXT,              -- form's "Vehicle Type", distinct from model

  -- ── Commercial vehicle block ────────────────────────────
  gvwr TEXT,
  occupants_16_plus INTEGER,
  company_unit TEXT,
  company_city_state TEXT,
  actual_weight TEXT,
  weight_limit TEXT,

  -- ── Incident detail ─────────────────────────────────────
  incident_city TEXT,
  incident_county TEXT,
  mile_post TEXT,
  direction_of_travel TEXT,
  interstate INTEGER,
  military INTEGER,

  -- ── Court / notice to appear ────────────────────────────
  court_phone TEXT,

  -- ── Officer / complainant ───────────────────────────────
  officer_id_number TEXT,
  complainant TEXT,
  complainant_phone TEXT,

  -- ── Court disposition strip (filled post-adjudication) ──
  final_charge TEXT,
  disposition TEXT,               -- dismissed | diversion | plea_in_abeyance | declination
  fine_imposed REAL,
  fine_suspended REAL,
  jail_days INTEGER,
  jail_suspended INTEGER,
  conviction_date TEXT,
  date_sent_to_dld TEXT,
  docket_number TEXT,
  judge_name TEXT,
  felony_death INTEGER,
  felony_serious_bodily INTEGER,

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (citation_id) REFERENCES citations(id) ON DELETE CASCADE
);

-- ── citation_violations: per-offense columns the form prints ──
-- The offense table on the official form has a U / CO / CY column
-- (Utah Code / County ordinance / City ordinance) and a separate
-- SEVERITY column, neither of which the child table modeled.
ALTER TABLE citation_violations ADD COLUMN code_type TEXT;
ALTER TABLE citation_violations ADD COLUMN severity TEXT;
