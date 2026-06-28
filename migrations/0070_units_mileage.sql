-- Migration 0070 — add units.mileage column (Claude Opus 4.8 PR d3001d25)
-- Required by PUT /api/dispatch/units/:id/mileage (CAD "MI" command).
-- The column was missing from the initial schema (0001) and never ported
-- from the legacy patrol-mileage table. Discovered when mileage guardrails
-- were retrofitted to the handler — the handler wrote to the column but
-- D1 returned SQLITE_ERROR "no such column: mileage" because the live
-- table had never been ALTER'd.

-- D1 does NOT support IF NOT EXISTS on ADD COLUMN, so re-apply will fail.
-- The Worker reconciles missing columns at boot (see CLAUDE.md line 78-79:
-- "the Worker reconciles missing columns at boot").

ALTER TABLE units ADD COLUMN mileage REAL;

-- Also back-populate any legacy patrol_mileage records into units.
-- The duty/mileage flow writes unit.mileage directly; fleet_vehicles.
-- current_mileage is the fleet-side canonical, but the units-side is
-- what the NAV instrument cluster and MileagePromptModal read.
