-- 0062_fleet_inspection_type_checklist.sql
-- The fleet InspectionFormModal submits inspection_type and a full pass/fail
-- checklist (items[]), and FleetInspectionsTab renders insp.inspection_type and
-- insp.items. The live fleet_inspections table had neither column, so the type
-- was dropped (and TYPE_BADGE[undefined] crashed the tab) and the whole
-- checklist was lost. Add the columns. inspector/mileage_at_inspection already
-- exist (the bug there was a field-name mismatch in the handler, fixed in code).
--
-- Applied directly to live D1 (785de7ae) on 2026-06-01. D1 has no IF NOT EXISTS
-- on ADD COLUMN; re-apply errors per-column and the deploy step continues.
ALTER TABLE fleet_inspections ADD COLUMN inspection_type TEXT;
ALTER TABLE fleet_inspections ADD COLUMN checklist TEXT;
