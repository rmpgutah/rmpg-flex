-- 0065_fleet_costs_schema_repair.sql
-- ============================================================
-- Repair missing/incorrect columns in fleet costs tables.
--
-- Problem: Server handlers (src/routes/fleet.ts) INSERT/UPDATE
-- columns that never existed in the D1 migration schemas. Found
-- during Fleet system audit 2026-06-04.
--
-- 1. fleet_insurance missing 4 handler-written columns:
--    premium_frequency, deductible, liability_limit, status
-- 2. fleet_accessories (0053 version) missing vendor, removed_date
--    (0057's CREATE IF NOT EXISTS is blocked by 0053's table)
-- 3. fleet_utility_costs has completely different schema — the old
--    (0053) columns cost_type/amount/billing_period/due_date/paid
--    conflict with the new handler columns category/provider/
--    cost_amount/cost_frequency/period_start/period_end
-- 4. fleet_inspections missing inspector TEXT column (complements
--    0064 target — included here for environments where 0064
--    wasn't applied yet)
--
-- Applied directly to live D1 (785de7ae) on 2026-06-04.
-- D1 has no ADD COLUMN IF NOT EXISTS; re-apply errors harmlessly.
-- ============================================================

-- ── 1. fleet_insurance ──
ALTER TABLE fleet_insurance ADD COLUMN premium_frequency TEXT DEFAULT 'monthly';
ALTER TABLE fleet_insurance ADD COLUMN deductible REAL;
ALTER TABLE fleet_insurance ADD COLUMN liability_limit REAL;
ALTER TABLE fleet_insurance ADD COLUMN status TEXT DEFAULT 'active';

-- ── 2. fleet_accessories ──
ALTER TABLE fleet_accessories ADD COLUMN vendor TEXT;
ALTER TABLE fleet_accessories ADD COLUMN removed_date TEXT;

-- ── 3. fleet_utility_costs — add handler columns alongside the old ones ──
ALTER TABLE fleet_utility_costs ADD COLUMN category TEXT;
ALTER TABLE fleet_utility_costs ADD COLUMN provider TEXT;
ALTER TABLE fleet_utility_costs ADD COLUMN cost_amount REAL;
ALTER TABLE fleet_utility_costs ADD COLUMN cost_frequency TEXT DEFAULT 'monthly';
ALTER TABLE fleet_utility_costs ADD COLUMN period_start TEXT;
ALTER TABLE fleet_utility_costs ADD COLUMN period_end TEXT;

-- ── 4. fleet_inspections ──
ALTER TABLE fleet_inspections ADD COLUMN inspector TEXT;
