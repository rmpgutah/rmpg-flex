-- 0122 — offender_alerts compliance/registration columns
-- Adds the four columns the SexOffenderRegistryPage compliance workflow
-- reads/writes: tier (drives the verification cadence), registration_status
-- (compliant / non_compliant), and the verify round-trip timestamps.
-- D1 does NOT support IF NOT EXISTS on ADD COLUMN; the router also ensures
-- these at runtime (ensureComplianceColumns), so a re-apply failure here is
-- tolerated (deploy step is continue-on-error).
ALTER TABLE offender_alerts ADD COLUMN tier INTEGER;
ALTER TABLE offender_alerts ADD COLUMN registration_status TEXT;
ALTER TABLE offender_alerts ADD COLUMN last_verification TEXT;
ALTER TABLE offender_alerts ADD COLUMN next_verification_due TEXT;
