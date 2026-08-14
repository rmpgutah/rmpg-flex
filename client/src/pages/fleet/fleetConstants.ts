// Shared constants for the Fleet module. Kept in one file so
// FleetVehicleListPanel, FleetStatsBar, and FleetPage all reference
// the same source of truth rather than diverging copies.

import type { FleetVehicleStatus } from '../../types';

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
export const UTILIZATION_LIFETIME_MILES = 150_000;

export type FleetViewMode = 'dashboard' | 'analysis' | 'work_orders' | 'vendors' | 'service' | 'driver_performance';

export const FLEET_VIEWS: { id: FleetViewMode; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'analysis', label: 'Analysis Reports' },
  { id: 'work_orders', label: 'Work Orders' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'service', label: 'Service' },
  { id: 'driver_performance', label: 'Driver Performance' },
];
