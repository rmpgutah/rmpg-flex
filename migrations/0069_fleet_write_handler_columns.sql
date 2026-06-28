-- 0069_fleet_write_handler_columns.sql
-- UPDATE audit (SET columns vs live D1) found six fleet write handlers in
-- src/routes/fleet.ts targeting columns their tables never had. /api/fleet
-- routes to the rewrite and each handler returns a hard 500 on failure, so
-- these were live user-facing breaks whenever the action was taken:
--   PUT /decommissioning/:id/complete  -> salvage_value, disposal_method
--   PUT /decommissioning/:id/step       -> equipment_stripped, data_wiped, environmental_cleared
--   PUT /compliance/defects/:id/resolve -> resolved, resolved_date, resolution
--   PUT /operations/pool-reservations/:id/checkout|checkin -> status, checked_out, checked_in
--   PUT /risk/theft-reports/:id/recover -> recovered, recovery_date, recovery_condition
--   PUT /procurement/bids/:id/select    -> selected
--   PUT /warranty-claims/:id/approve    -> approved, approved_date
-- All tables exist and are small (far under the 100-col D1 cap) — additive only.
-- D1 has no IF NOT EXISTS on ADD COLUMN; re-apply failures are expected/ignored.
-- Applied directly to live D1 (785de7ae) on 2026-06-02.
ALTER TABLE fleet_decommissioning ADD COLUMN salvage_value REAL;
ALTER TABLE fleet_decommissioning ADD COLUMN disposal_method TEXT;
ALTER TABLE fleet_decommissioning ADD COLUMN equipment_stripped INTEGER DEFAULT 0;
ALTER TABLE fleet_decommissioning ADD COLUMN data_wiped INTEGER DEFAULT 0;
ALTER TABLE fleet_decommissioning ADD COLUMN environmental_cleared INTEGER DEFAULT 0;
ALTER TABLE fleet_defect_reports ADD COLUMN resolved INTEGER DEFAULT 0;
ALTER TABLE fleet_defect_reports ADD COLUMN resolved_date TEXT;
ALTER TABLE fleet_defect_reports ADD COLUMN resolution TEXT;
ALTER TABLE fleet_pool_reservations ADD COLUMN status TEXT;
ALTER TABLE fleet_pool_reservations ADD COLUMN checked_out TEXT;
ALTER TABLE fleet_pool_reservations ADD COLUMN checked_in TEXT;
ALTER TABLE fleet_vehicle_theft ADD COLUMN recovered INTEGER DEFAULT 0;
ALTER TABLE fleet_vehicle_theft ADD COLUMN recovery_date TEXT;
ALTER TABLE fleet_vehicle_theft ADD COLUMN recovery_condition TEXT;
ALTER TABLE fleet_vendor_bids ADD COLUMN selected INTEGER DEFAULT 0;
ALTER TABLE fleet_warranty_claims ADD COLUMN approved INTEGER DEFAULT 0;
ALTER TABLE fleet_warranty_claims ADD COLUMN approved_date TEXT;
