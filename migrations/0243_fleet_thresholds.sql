-- 0243_fleet_thresholds.sql
-- Fleet operational thresholds — moved from hardcoded literals to admin-configurable
-- system_settings rows. Defaults match the previous literals exactly so this
-- migration ships with zero behavior change until an admin edits a value.
-- Idempotent: INSERT OR IGNORE is safe to re-apply.

INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order)
VALUES
  ('fleet', 'fleet_utilization_max_miles', '150000', 'number',
   'Fleet Utilization Max (miles)',
   'Mileage at which a vehicle is considered fully utilized (100%). Used to color-code the utilization bar.',
   10),
  ('fleet', 'fleet_expiry_warn_days', '30', 'number',
   'Expiry Warning Window (days)',
   'Days before registration, insurance, or other expiry dates to show a warning indicator.',
   11),
  ('fleet', 'fleet_service_warn_days', '14', 'number',
   'Service Warning Window (days)',
   'Days before next scheduled service date to show a SERVICE SOON badge.',
   12);
