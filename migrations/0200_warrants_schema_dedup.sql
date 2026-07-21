-- ============================================================
-- 0200: warrants schema dedup
-- ============================================================
-- The `warrants` table accumulated duplicate column pairs from years of
-- incremental patches (see docs/superpowers/specs/2026-07-21-warrant-tab-
-- backend-rebuild-design.md). This migration backfills each canonical
-- column from its deprecated twin wherever the canonical value is NULL,
-- then drops the deprecated column. Canonical choices were verified against
-- actual usage across src/ and client/src/ during planning — `type` and
-- `subject_person_id` (not `warrant_type`/`person_id`) are what's actually
-- read/written everywhere, including the frontend's Warrant TS interface.
-- ============================================================

-- type / warrant_type — always dual-written historically, so this backfill
-- is defensive (covers any row that predates the dual-write, e.g. rows
-- inserted directly via D1 console/import).
UPDATE warrants SET type = warrant_type WHERE type IS NULL AND warrant_type IS NOT NULL;

-- subject_person_id / person_id — person_id has no read/write call sites
-- anywhere in src/ or client/src/ (confirmed via repo-wide grep during
-- planning); this backfill exists only in case some row has data in
-- person_id that was never mirrored to subject_person_id.
UPDATE warrants SET subject_person_id = person_id WHERE subject_person_id IS NULL AND person_id IS NOT NULL;

-- charge_description / offense / offense_description — priority order
-- matches the COALESCE(charge_description, offense_description, offense)
-- pattern already used in src/routes/warrants.ts's national-search route.
UPDATE warrants SET charge_description = offense_description WHERE charge_description IS NULL AND offense_description IS NOT NULL;
UPDATE warrants SET charge_description = offense WHERE charge_description IS NULL AND offense IS NOT NULL;

-- issuing_court / court
UPDATE warrants SET issuing_court = court WHERE issuing_court IS NULL AND court IS NOT NULL;

-- issuing_judge / judge
UPDATE warrants SET issuing_judge = judge WHERE issuing_judge IS NULL AND judge IS NOT NULL;

-- bail_amount / bond_amount
UPDATE warrants SET bail_amount = bond_amount WHERE bail_amount IS NULL AND bond_amount IS NOT NULL;

-- expires_at / expiry_date
UPDATE warrants SET expires_at = expiry_date WHERE expires_at IS NULL AND expiry_date IS NOT NULL;

-- served_at / service_date
UPDATE warrants SET served_at = service_date WHERE served_at IS NULL AND service_date IS NOT NULL;

-- Drop the now-redundant columns. Requires SQLite 3.35+ (D1's underlying
-- engine supports this). This migration is tracked once in d1_migrations
-- (see scripts/apply-migration.sh) — it is NOT designed to be re-run, unlike
-- the ADD-COLUMN migrations elsewhere in this repo that tolerate re-apply.
ALTER TABLE warrants DROP COLUMN warrant_type;
ALTER TABLE warrants DROP COLUMN person_id;
ALTER TABLE warrants DROP COLUMN offense;
ALTER TABLE warrants DROP COLUMN offense_description;
ALTER TABLE warrants DROP COLUMN court;
ALTER TABLE warrants DROP COLUMN judge;
ALTER TABLE warrants DROP COLUMN bond_amount;
ALTER TABLE warrants DROP COLUMN expiry_date;
ALTER TABLE warrants DROP COLUMN service_date;
