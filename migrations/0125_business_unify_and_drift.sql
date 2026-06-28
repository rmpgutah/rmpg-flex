-- 0125 — Business unification onto the canonical `businesses` table +
--        Records/Incident schema-drift reconciliation.
--
-- ⚠️ Apply directly to LIVE D1 (785de7ae) after merge — deploy migration apply
--    is continue-on-error and ADD COLUMN is not idempotent on re-run.
--
-- Context: business records were split across two stores — `properties` rows
-- with business_type set (Records → Business tab) and the standalone
-- `businesses` table (call-linking + business photos/visits/vehicles). This
-- makes `businesses` the single source of truth.

-- ── Part A: businesses gains the columns the Records Business CRUD needs ──
-- (these were being written to `properties` before unification).
ALTER TABLE businesses ADD COLUMN latitude REAL;
ALTER TABLE businesses ADD COLUMN longitude REAL;
ALTER TABLE businesses ADD COLUMN annual_revenue TEXT;
ALTER TABLE businesses ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE businesses ADD COLUMN flags TEXT;

-- ── Part A data: migrate business rows out of `properties` into `businesses` ──
-- Dedup by name+address against rows already present; only non-archived sources.
INSERT INTO businesses (
  name, address, city, state, zip, business_type, phone, email, website,
  dba_name, ein, license_number, owner_name, owner_phone, contact_name, contact_phone, contact_email,
  industry, employee_count, annual_revenue, status, notes, latitude, longitude, created_at)
SELECT
  p.name, p.address, p.city, p.state, p.zip, p.business_type, p.phone, p.email, p.website,
  p.dba_name, p.ein, p.license_number, p.owner_name, p.owner_phone, p.contact_name, p.contact_phone, p.contact_email,
  p.industry, p.employee_count, p.annual_revenue, COALESCE(p.status, 'active'), p.notes, p.latitude, p.longitude,
  COALESCE(p.created_at, datetime('now'))
FROM properties p
WHERE p.business_type IS NOT NULL AND p.business_type != '' AND p.archived_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM businesses b
    WHERE lower(b.name) = lower(p.name)
      AND lower(COALESCE(b.address, '')) = lower(COALESCE(p.address, ''))
  );

-- Soft-archive the migrated property rows so `properties` = real-estate only.
-- (Soft, not DELETE — keeps any property_id FK references intact and reversible.)
UPDATE properties SET archived_at = datetime('now')
WHERE business_type IS NOT NULL AND business_type != '' AND archived_at IS NULL;

-- ── Part B: cases civil/court columns (case-mgmt v3 shipped with no migration;
--    the UPDATE in cases.ts is unguarded → was 500ing on live). ──
ALTER TABLE cases ADD COLUMN court_case_number TEXT;
ALTER TABLE cases ADD COLUMN court_id INTEGER;
ALTER TABLE cases ADD COLUMN plaintiff_person_id INTEGER;
ALTER TABLE cases ADD COLUMN defendant_person_id INTEGER;
ALTER TABLE cases ADD COLUMN attorney_person_id INTEGER;
ALTER TABLE cases ADD COLUMN signed_filed_date TEXT;
ALTER TABLE cases ADD COLUMN response_deadline_days INTEGER;
ALTER TABLE cases ADD COLUMN amount_demanded TEXT;
ALTER TABLE cases ADD COLUMN cause_of_action TEXT;

-- ── Part B: call action audit log (was runtime-created only in dispatch/calls.ts;
--    absent on live so the audit trail silently no-ops until first write). ──
CREATE TABLE IF NOT EXISTS cfs_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER,
  action TEXT,
  verb TEXT,
  params TEXT,
  narrative TEXT,
  actor_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
