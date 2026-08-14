import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { usePersistedTab } from '../../../hooks/usePersistedState';
import type { DetailTab } from '../FleetDetailPanel';
import type {
  FleetVehicle, FleetMaintenance, FleetFuelLog, FleetFuelSummary,
  FleetInspection, FleetAssignment, FleetAnalytics, FleetPersonnelData,
} from '../../../types';

/** Valid values for the persisted per-vehicle detail tab. Kept in one place so
 *  the `usePersistedTab` validator and the lazy-load switch can never drift. */
const DETAIL_TABS = [
  'overview', 'fuel', 'costs', 'inspections', 'assignments', 'personnel',
  'tires', 'damage', 'recalls', 'analytics', 'dashcam', 'fuel_cards',
] as const;

export interface VehicleDetailResult {
  detail: FleetVehicle | null;
  maintenance: FleetMaintenance[];
  fuelLogs: FleetFuelLog[];
  fuelSummary: FleetFuelSummary | null;
  inspections: FleetInspection[];
  assignments: FleetAssignment[];
  analytics: FleetAnalytics | null;
  analyticsLoading: boolean;
  personnelData: FleetPersonnelData | null;
  personnelLoading: boolean;
  gpsMileage: unknown;
  gpsMileageLoading: boolean;
  activeTab: DetailTab;
  setActiveTab: (t: DetailTab) => void;
  fetchDetail: (id: string | number) => Promise<void>;
  fetchFuelLogs: (id: string | number) => Promise<void>;
  fetchInspections: (id: string | number) => Promise<void>;
  fetchAssignments: (id: string | number) => Promise<void>;
  fetchPersonnel: (id: string | number) => Promise<void>;
  fetchVehicleAnalytics: (id: string | number, period?: string) => Promise<void>;
  fetchGpsMileage: (days?: number) => Promise<void>;
  syncGpsMileage: () => Promise<void>;
  clearDetail: () => void;
}

/** Selected-vehicle detail plus the lazily-loaded per-tab datasets.
 *
 *  **What it does:** owns the `/fleet/:id` detail record, the recent-maintenance
 *  list that comes with it, the persisted detail tab (`rmpg_fleet_tab`), and the
 *  per-tab datasets (fuel, inspections, assignments, personnel, analytics). Each
 *  per-tab dataset is fetched lazily, only when its tab becomes active.
 *
 *  **How to use it:** pass the currently selected vehicle id and a callback that
 *  clears any caller-owned per-vehicle state (cost-of-ownership rows, GPS
 *  mileage). Detail fetching, tab reset and lazy loading are all automatic; the
 *  returned `fetch*` functions exist for explicit refreshes after a mutation.
 *
 *  **What it depends on:** `apiFetch`, `useToast`, `usePersistedTab`.
 *
 *  ⚠️ The reset effect and the lazy-load effect are COUPLED and must stay in
 *  this file, in this declaration order, adjacent. The reset sets
 *  `skipNextLazyLoadRef` because `setActiveTab('overview')` is not visible until
 *  the next render; without the skip, the lazy-load effect runs in the SAME
 *  commit reading the stale tab and fetches the previous tab's data against the
 *  new vehicle. React runs effects in declaration order, which is the entire
 *  guarantee. Splitting them across two hooks makes this depend on call order in
 *  the component — untypechecked, and it fails as a race.
 *
 *  ⚠️ `onLazyLoad` exists so that tab-keyed fetches owned by OTHER hooks
 *  (`useFleetCosts`) run inside this hook's ONE skip-guarded effect instead of a
 *  second effect keyed off the same `activeTab`. A second effect elsewhere cannot
 *  see `skipNextLazyLoadRef`, so it re-derives the exact race documented above and
 *  fires a full round of requests on every vehicle switch. Anything that should
 *  fetch "when tab X becomes active" belongs here, via this callback. */
export function useVehicleDetail(
  selectedId: string | number | null,
  onCostsReset: () => void,
  onLazyLoad?: (tab: DetailTab, id: string | number) => void,
): VehicleDetailResult {
  const { addToast } = useToast();
  const [detail, setDetail] = useState<FleetVehicle | null>(null);
  const [maintenance, setMaintenance] = useState<FleetMaintenance[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FleetFuelLog[]>([]);
  const [fuelSummary, setFuelSummary] = useState<FleetFuelSummary | null>(null);
  const [inspections, setInspections] = useState<FleetInspection[]>([]);
  const [assignments, setAssignments] = useState<FleetAssignment[]>([]);
  const [analytics, setAnalytics] = useState<FleetAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [personnelData, setPersonnelData] = useState<FleetPersonnelData | null>(null);
  const [personnelLoading, setPersonnelLoading] = useState(false);
  const [gpsMileage, setGpsMileage] = useState<unknown>(null);
  const [gpsMileageLoading, setGpsMileageLoading] = useState(false);
  const [activeTab, setActiveTab] = usePersistedTab('rmpg_fleet_tab', 'overview' as DetailTab, DETAIL_TABS);

  // The reset-on-vehicle-change effect must not run on mount, or it
  // clobbers the tab usePersistedTab just restored — which made that
  // persistence dead code. Track the last selected (non-null) vehicle id
  // instead of a simple mount flag: selectedId starts null, so the OLD
  // "first effect run" guard consumed itself on mount (null selection)
  // and treated the operator's actual first vehicle click (null -> A) as
  // "not mount", clobbering the restored tab back to 'overview'.
  const lastVehicleIdRef = useRef<string | number | null>(null);
  const skipNextLazyLoadRef = useRef(false);
  // Held in a ref so a caller passing an inline arrow does not re-run the
  // reset effect (and wipe per-tab state) on every render.
  const onCostsResetRef = useRef(onCostsReset);
  onCostsResetRef.current = onCostsReset;
  // Same ref treatment, same reason: an inline arrow from FleetPage would
  // otherwise re-mint on every render and re-fire the lazy-load effect, which is
  // precisely the runaway-refetch bug this callback was added to eliminate.
  const onLazyLoadRef = useRef(onLazyLoad);
  onLazyLoadRef.current = onLazyLoad;

  const fetchDetail = useCallback(async (id: string | number) => {
    try {
      const data = await apiFetch<FleetVehicle & { recent_maintenance?: FleetMaintenance[]; maintenance?: FleetMaintenance[] }>(`/fleet/${id}`);
      const { recent_maintenance, maintenance: maint, ...vehicle } = data;
      setDetail(vehicle);
      const maintList = recent_maintenance ?? maint;
      setMaintenance(Array.isArray(maintList) ? maintList : []);
    } catch (err) {
      addToast('Failed to load vehicle details', 'error');
    }
  }, [addToast]);

  const fetchFuelLogs = useCallback(async (id: string | number) => {
    try {
      // Request the full fuel history in one shot (per_page=10000). The
      // server raised its cap to match so the Fuel tab shows every entry
      // rather than a paginated slice — lets operators see lifetime
      // consumption + every flagged fill in the period selector.
      const data = await apiFetch<{ data: FleetFuelLog[]; summary: FleetFuelSummary }>(`/fleet/${id}/fuel?per_page=10000`);
      setFuelLogs(Array.isArray(data?.data) ? data.data : []);
      setFuelSummary(data.summary || null);
    } catch { addToast('Failed to load fuel logs', 'error'); }
  }, [addToast]);

  const fetchInspections = useCallback(async (id: string | number) => {
    try {
      // Worker returns a bare array; older builds wrapped in { data }.
      const data = await apiFetch<FleetInspection[] | { data: FleetInspection[] }>(`/fleet/${id}/inspections`);
      setInspections(Array.isArray(data) ? data : data.data || []);
    } catch { addToast('Failed to load inspections', 'error'); }
  }, [addToast]);

  const fetchAssignments = useCallback(async (id: string | number) => {
    try {
      // Worker returns a bare array; older builds wrapped in { data }.
      const data = await apiFetch<FleetAssignment[] | { data: FleetAssignment[] }>(`/fleet/${id}/assignments`);
      setAssignments(Array.isArray(data) ? data : data.data || []);
    } catch { addToast('Failed to load assignments', 'error'); }
  }, [addToast]);

  const fetchVehicleAnalytics = useCallback(async (id: string | number, period?: string) => {
    setAnalyticsLoading(true);
    try {
      const p = period ? `&period=${encodeURIComponent(period)}` : '';
      const data = await apiFetch<FleetAnalytics>(`/fleet/analytics?vehicle_id=${encodeURIComponent(String(id))}${p}`);
      setAnalytics(data);
    } catch { addToast('Failed to load analytics', 'error'); }
    finally { setAnalyticsLoading(false); }
  }, [addToast]);

  const fetchPersonnel = useCallback(async (id: string | number) => {
    setPersonnelLoading(true);
    try {
      const data = await apiFetch<FleetPersonnelData>(`/fleet/${id}/personnel`);
      setPersonnelData(data);
    } catch { addToast('Failed to load personnel data', 'error'); }
    finally { setPersonnelLoading(false); }
  }, [addToast]);

  const fetchGpsMileage = useCallback(async (days = 30) => {
    if (!selectedId) return;
    setGpsMileageLoading(true);
    try {
      const data = await apiFetch<unknown>(`/fleet/${selectedId}/gps-mileage?days=${days}`);
      setGpsMileage(data);
    } catch (err: unknown) {
      if ((err as { code?: string })?.code !== 'NO_UNIT_ASSIGNED') {
        addToast('Failed to compute GPS mileage', 'error');
      }
    } finally { setGpsMileageLoading(false); }
  }, [selectedId, addToast]);

  const syncGpsMileage = useCallback(async () => {
    const mileageData = gpsMileage as { total_miles?: number } | null;
    if (!selectedId || !mileageData?.total_miles) return;
    setGpsMileageLoading(true);
    try {
      const resp = await apiFetch<{ previous_mileage?: number; new_mileage?: number }>(`/fleet/${selectedId}/gps-mileage`, {
        method: 'PUT',
        body: JSON.stringify({ miles_delta: mileageData.total_miles }),
      });
      addToast(`Odometer updated: ${resp.previous_mileage?.toLocaleString()} → ${resp.new_mileage?.toLocaleString()}`, 'success');
      await fetchDetail(selectedId);
      setGpsMileage(null);
    } catch (err: unknown) {
      addToast((err as Error)?.message || 'Failed to sync mileage', 'error');
    } finally { setGpsMileageLoading(false); }
  }, [selectedId, gpsMileage, fetchDetail, addToast]);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  // ── Effect A: reset on vehicle change. MUST be declared before Effect B. ──
  useEffect(() => {
    if (selectedId != null && lastVehicleIdRef.current != null && selectedId !== lastVehicleIdRef.current) {
      setActiveTab('overview');
      // setActiveTab won't be reflected in `activeTab` until the next render,
      // but the lazy-load effect below runs in this SAME commit (it's
      // declared after this effect, so hook-order guarantees it runs right
      // after) and would otherwise read the stale (pre-reset) tab, firing a
      // fetch for the wrong tab against the just-selected vehicle. Skip that
      // one run — the lazy-load effect re-fires anyway once activeTab
      // actually flips to 'overview' (its own dependency changed).
      skipNextLazyLoadRef.current = true;
    }
    if (selectedId != null) {
      lastVehicleIdRef.current = selectedId;
    }
    setFuelLogs([]);
    setFuelSummary(null);
    setInspections([]);
    setAssignments([]);
    setAnalytics(null);
    setPersonnelData(null);
    setGpsMileage(null);
    onCostsResetRef.current();
  }, [selectedId, setActiveTab]);

  // ── Effect B: lazy-load the active tab. MUST be declared after Effect A. ──
  useEffect(() => {
    if (!selectedId) return;
    if (skipNextLazyLoadRef.current) {
      skipNextLazyLoadRef.current = false;
      return;
    }
    if (activeTab === 'fuel') fetchFuelLogs(selectedId);
    if (activeTab === 'inspections') fetchInspections(selectedId);
    if (activeTab === 'assignments') fetchAssignments(selectedId);
    if (activeTab === 'analytics') fetchVehicleAnalytics(selectedId);
    // Personnel tab renders the shared `assignments` state too — fetch both.
    if (activeTab === 'personnel') { fetchPersonnel(selectedId); fetchAssignments(selectedId); }
    // The Costs tab's cost-category fetch lives in useFleetCosts, but it is
    // triggered from HERE via onLazyLoad below, not from an effect of its own.
    // The Costs tab ALSO renders fuel-cost figures sourced from `fuelLogs` /
    // `fuelSummary`, which only this hook owns. Pre-Phase-2 FleetPage fetched
    // both together on Costs-tab activation, so both halves now run inside this
    // one skip-guarded effect.
    if (activeTab === 'costs') fetchFuelLogs(selectedId);
    // Tab-keyed fetches owned by other hooks (useFleetCosts' five cost
    // categories) run HERE so they inherit the skip guard above.
    onLazyLoadRef.current?.(activeTab, selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, activeTab]);

  const clearDetail = useCallback(() => {
    setDetail(null);
    setMaintenance([]);
  }, []);

  return {
    detail, maintenance, fuelLogs, fuelSummary, inspections, assignments,
    analytics, analyticsLoading, personnelData, personnelLoading,
    gpsMileage, gpsMileageLoading,
    activeTab, setActiveTab,
    fetchDetail, fetchFuelLogs, fetchInspections, fetchAssignments,
    fetchPersonnel, fetchVehicleAnalytics, fetchGpsMileage, syncGpsMileage, clearDetail,
  };
}
