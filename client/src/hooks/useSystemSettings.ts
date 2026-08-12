import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './useApi';

/** Typed, defaulted fleet operational thresholds read from system_settings. */
export interface FleetThresholds {
  utilizationMaxMiles: number;
  expiryWarnDays: number;
  serviceWarnDays: number;
}

const FLEET_DEFAULTS: FleetThresholds = {
  utilizationMaxMiles: 150000,
  expiryWarnDays: 30,
  serviceWarnDays: 14,
};

function parseNum(map: Record<string, string>, key: string, fallback: number): number {
  const v = Number(map[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Fetch the system settings map once and expose typed, defaulted fleet thresholds.
 *  Returns defaults immediately (safe to render before the fetch completes). */
export function useFleetThresholds(): FleetThresholds {
  const [thresholds, setThresholds] = useState<FleetThresholds>(FLEET_DEFAULTS);
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    apiFetch<{ system?: Record<string, string> }>('/settings').then((res) => {
      const sys = res?.system ?? {};
      setThresholds({
        utilizationMaxMiles: parseNum(sys, 'fleet_utilization_max_miles', FLEET_DEFAULTS.utilizationMaxMiles),
        expiryWarnDays: parseNum(sys, 'fleet_expiry_warn_days', FLEET_DEFAULTS.expiryWarnDays),
        serviceWarnDays: parseNum(sys, 'fleet_service_warn_days', FLEET_DEFAULTS.serviceWarnDays),
      });
    }).catch(() => { /* stay on defaults */ });
  }, []);

  return thresholds;
}
