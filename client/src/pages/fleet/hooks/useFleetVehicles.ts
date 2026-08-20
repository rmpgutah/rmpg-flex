import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { useLiveSync } from '../../../hooks/useLiveSync';
import { useToast } from '../../../components/ToastProvider';
import type { FleetVehicle } from '../../../types';

/** Page size requested from `/api/fleet`. The server defaults to 200 and the
 *  list silently truncated past it before Phase 1; we now ask explicitly and
 *  surface `vehicleTotal` so the UI can say "showing N of M" rather than
 *  quietly dropping rows. */
export const FLEET_PAGE_SIZE = 500;

export interface FleetVehiclesResult {
  vehicles: FleetVehicle[];
  vehicleTotal: number | null;
  filtered: FleetVehicle[];
  filterStatus: string;
  setFilterStatus: (s: string) => void;
  searchQuery: string;
  setSearchQuery: (s: string) => void;
  showArchived: boolean;
  setShowArchived: (b: boolean) => void;
  statusCounts: Record<string, number>;
  avgMileage: number;
  refetch: (options?: { silent?: boolean }) => Promise<void>;
}

/** Fleet vehicle list, its filters, and the stats derived from it.
 *
 *  `filtered` applies the status + search filters; `statusCounts` and
 *  `avgMileage` are deliberately derived from the FULL list, so the gauge row
 *  keeps reporting the fleet while the list below it is filtered.
 *
 *  Re-fetches whenever `showArchived` flips, and subscribes to the 'fleet'
 *  live-sync channel with a silent refresh (a toast on every remote edit would
 *  be noise, and a non-silent refresh unmounts UI mid-interaction). */
export function useFleetVehicles(): FleetVehiclesResult {
  const { addToast } = useToast();
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [vehicleTotal, setVehicleTotal] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const refetch = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const resp = await apiFetch<{ data: FleetVehicle[]; pagination?: { total?: number } }>(
        `/fleet?archived=${showArchived}&per_page=${FLEET_PAGE_SIZE}`,
      );
      const rows = Array.isArray(resp) ? resp : resp.data || [];
      setVehicles(rows);
      const total = Array.isArray(resp) ? rows.length : resp.pagination?.total;
      // Coerce rather than type-check. The server declares `total?: number`,
      // but if it ever serialises a numeric string the strict typeof check
      // silently fell back to rows.length — i.e. reported "nothing truncated"
      // on a response that was truncated, which is the exact failure this
      // count exists to make visible.
      const totalNum = Number(total);
      setVehicleTotal(Number.isFinite(totalNum) && totalNum > 0 ? totalNum : rows.length);
    } catch {
      if (!options?.silent) addToast('Failed to load fleet vehicles', 'error');
    }
  }, [addToast, showArchived]);

  useEffect(() => { refetch(); }, [refetch]);

  const silentRefresh = useCallback(() => refetch({ silent: true }), [refetch]);
  useLiveSync('fleet', silentRefresh);

  const filtered = useMemo(() => vehicles.filter((v) => {
    if (filterStatus !== 'all' && v.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const haystack = `${v.vehicle_number} ${v.make} ${v.model} ${v.plate_number} ${v.vin}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  }), [vehicles, filterStatus, searchQuery]);

  const statusCounts = useMemo(() => vehicles.reduce((acc, v) => {
    acc[v.status] = (acc[v.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>), [vehicles]);

  const avgMileage = useMemo(() => {
    if (vehicles.length === 0) return 0;
    const total = vehicles.reduce((sum, v) => sum + (v.current_mileage || 0), 0);
    return Math.round(total / vehicles.length);
  }, [vehicles]);

  return {
    vehicles, vehicleTotal, filtered,
    filterStatus, setFilterStatus, searchQuery, setSearchQuery,
    showArchived, setShowArchived,
    statusCounts, avgMileage, refetch,
  };
}
