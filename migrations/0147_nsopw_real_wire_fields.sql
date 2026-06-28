-- 0147: NSOPW reconnaissance follow-up — extend national_sex_offenders to
-- carry fields the real wire format provides (mig 0146 codes them off in
-- types.ts, this migration brings them into D1).
--
-- Findings sourced from live capture 2026-06-22:
--   tests/fixtures/nsopw/john-smith-search.real.json (399 offenders).
--
-- Three new columns:
--   absconder       — present on 94% of records; whether the registrant
--                     is currently in absconder status. Boolean 0/1.
--   age             — present on 97% of records; integer age at time of
--                     query. Cheaper than computing from dob.
--   locations_json  — NSOPW returns locations[] (multi-location: home +
--                     work + incarceration site). Flat columns hold the
--                     primary; the full array goes here for the dossier.
--
-- D1 doesn't support IF NOT EXISTS on ADD COLUMN — these ALTERs fail
-- harmlessly on re-apply (deploy.yml is continue-on-error; the Worker
-- self-heals via ensureNsopwColumns()).
--
-- 🔴 APPLY TO LIVE 785de7ae after merge.

ALTER TABLE national_sex_offenders ADD COLUMN absconder INTEGER DEFAULT 0;
ALTER TABLE national_sex_offenders ADD COLUMN age INTEGER;
ALTER TABLE national_sex_offenders ADD COLUMN locations_json TEXT;

-- nsopw_runs gains a per-jurisdiction stats column. The federated response
-- carries `responseTime` ms per state — surfacing which jurisdictions are
-- slow is operationally useful (sets ops expectations for partial coverage).
ALTER TABLE nsopw_runs ADD COLUMN jurisdiction_stats_json TEXT;
