// Shared constants for the Fleet module. Kept in one file so
// FleetVehicleListPanel, FleetStatsBar, and FleetPage all reference
// the same source of truth rather than diverging copies.

import type { FleetVehicleStatus } from '../../types';
import { getNumSetting, useSystemSetting } from '../../utils/systemSettings';

export const STATUS_COLOR: Record<FleetVehicleStatus, string> = {
  in_service: 'var(--sev-ok)', maintenance: 'var(--sev-warn)',
  out_of_service: 'var(--sev-critical)', retired: 'var(--text-muted)',
};

export const STATUS_LABEL: Record<FleetVehicleStatus, string> = {
  in_service: 'In Service', maintenance: 'Maintenance',
  out_of_service: 'Out of Service', retired: 'Retired',
};

export const VEHICLE_STATUSES: { value: FleetVehicleStatus; label: string }[] = [
  { value: 'in_service', label: 'In Service' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'out_of_service', label: 'Out of Service' },
  { value: 'retired', label: 'Retired' },
];

// Rough patrol-fleet service-life heuristic used only to color-code
// the utilization bar — not a retirement policy.
// Overridable at runtime via system_settings key 'fleet_utilization_max_miles'.
export const UTILIZATION_LIFETIME_MILES = 150_000;

export const FLEET_THRESHOLD_DEFAULTS = {
  utilizationMaxMiles: 150_000,
  expiryWarnDays: 30,
  serviceWarnDays: 14,
} as const;

/** Non-React access: reads from the already-loaded cache with compiled defaults as fallback. */
export function getFleetThresholds() {
  return {
    utilizationMaxMiles: getNumSetting('fleet_utilization_max_miles', FLEET_THRESHOLD_DEFAULTS.utilizationMaxMiles),
    expiryWarnDays:      getNumSetting('fleet_expiry_warn_days',      FLEET_THRESHOLD_DEFAULTS.expiryWarnDays),
    serviceWarnDays:     getNumSetting('fleet_service_warn_days',     FLEET_THRESHOLD_DEFAULTS.serviceWarnDays),
  };
}

/** React hook: re-renders when settings load from the server. */
export function useFleetThresholds() {
  const utilizationMaxMiles = Number(useSystemSetting('fleet_utilization_max_miles', String(FLEET_THRESHOLD_DEFAULTS.utilizationMaxMiles)));
  const expiryWarnDays      = Number(useSystemSetting('fleet_expiry_warn_days',      String(FLEET_THRESHOLD_DEFAULTS.expiryWarnDays)));
  const serviceWarnDays     = Number(useSystemSetting('fleet_service_warn_days',     String(FLEET_THRESHOLD_DEFAULTS.serviceWarnDays)));
  return {
    utilizationMaxMiles: Number.isFinite(utilizationMaxMiles) ? utilizationMaxMiles : FLEET_THRESHOLD_DEFAULTS.utilizationMaxMiles,
    expiryWarnDays:      Number.isFinite(expiryWarnDays)      ? expiryWarnDays      : FLEET_THRESHOLD_DEFAULTS.expiryWarnDays,
    serviceWarnDays:     Number.isFinite(serviceWarnDays)      ? serviceWarnDays     : FLEET_THRESHOLD_DEFAULTS.serviceWarnDays,
  };
}

export type FleetViewMode = 'dashboard' | 'analysis' | 'work_orders' | 'vendors' | 'service' | 'driver_performance';

export const FLEET_VIEWS: { id: FleetViewMode; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'analysis', label: 'Analysis Reports' },
  { id: 'work_orders', label: 'Work Orders' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'service', label: 'Service' },
  { id: 'driver_performance', label: 'Driver Performance' },
];
