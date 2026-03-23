// ============================================================
// RMPG Flex — Shift Planning Overlay Hook
// ============================================================
// Manages area-based shift planning: select beats/municipalities
// /counties on the map, assign officers/units to those areas,
// and persist shift plans via API. Integrates with the GeoJSON
// layer system's selection mode.
// ============================================================

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { apiFetch } from './useApi';
import { useLiveSync } from './useLiveSync';
import type { GeoFeatureInfo } from './useGeoJsonLayers';

// ── Types ────────────────────────────────────────────────────

export interface AreaAssignment {
  id: string;
  layerId: string;       // e.g., 'beat', 'municipality', 'county'
  featureKey: string;     // e.g., 'SLA/A1', 'Salt Lake City', 'CACHE'
  label: string;          // Display name
  properties: Record<string, any>;
  officerIds: string[];
  officerNames: string[];
  unitIds: string[];
  unitCallSigns: string[];
  shiftStart?: string;    // ISO time HH:mm
  shiftEnd?: string;
  notes?: string;
  color?: string;         // Override highlight color
}

export interface ShiftPlan {
  id: string;
  name: string;
  date: string;          // YYYY-MM-DD
  shiftType: ShiftType;
  assignments: AreaAssignment[];
  status: 'draft' | 'active' | 'completed' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export type ShiftType = 'day' | 'swing' | 'night' | 'custom';

export const SHIFT_TYPES: Record<ShiftType, { label: string; defaultStart: string; defaultEnd: string; color: string }> = {
  day:    { label: 'Day Shift',   defaultStart: '06:00', defaultEnd: '14:00', color: '#f59e0b' },
  swing:  { label: 'Swing Shift', defaultStart: '14:00', defaultEnd: '22:00', color: '#3b82f6' },
  night:  { label: 'Night Shift', defaultStart: '22:00', defaultEnd: '06:00', color: '#a855f7' },
  custom: { label: 'Custom',      defaultStart: '08:00', defaultEnd: '16:00', color: '#6b7280' },
};

const LS_KEY = 'rmpg_shift_plans';

// ── Available Officers/Units (fetched from API) ──────────────

interface OfficerOption {
  id: string;
  full_name: string;
  badge_number: string;
  role: string;
  status: string;
}

interface UnitOption {
  id: string;
  call_sign: string;
  officer_name: string;
  status: string;
}

// ── Hook ─────────────────────────────────────────────────────

export function useShiftPlanning() {
  // ── Plans state (persisted to localStorage + API) ──────────
  const [plans, setPlans] = useState<ShiftPlan[]>(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);

  // ── Available personnel ────────────────────────────────────
  const [officers, setOfficers] = useState<OfficerOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);

  // ── Selection state (areas clicked in selection mode) ──────
  const [selectedAreas, setSelectedAreas] = useState<Set<string>>(new Set()); // "layerId::featureKey"
  const [pendingFeatures, setPendingFeatures] = useState<GeoFeatureInfo[]>([]);

  // ── Computed ───────────────────────────────────────────────
  const activePlan = plans.find((p) => p.id === activePlanId) ?? null;

  // Build assigned features set from the active plan (memoized to avoid re-renders)
  const assignedFeatures = useMemo(() => {
    const set = new Set<string>();
    if (activePlan) {
      for (const a of activePlan.assignments) {
        set.add(`${a.layerId}::${a.featureKey}`);
      }
    }
    return set;
  }, [activePlan]);

  // ── Persist to localStorage ────────────────────────────────
  const plansRef = useRef(plans);
  plansRef.current = plans;
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(plans)); } catch { /* ignore */ }
  }, [plans]);

  // ── Fetch available officers and units ─────────────────────

  const fetchPersonnel = useCallback(async () => {
    try {
      const [officerData, unitData] = await Promise.all([
        apiFetch('/personnel'),
        apiFetch('/dispatch/units'),
      ]);
      const activeOfficers = (officerData as OfficerOption[]).filter(
        (o) => o.status === 'active'
      );
      setOfficers(activeOfficers);
      setUnits(unitData as UnitOption[]);
    } catch (err) {
      console.error('[ShiftPlanning] Failed to fetch personnel:', err);
    }
  }, []);

  useEffect(() => { fetchPersonnel(); }, [fetchPersonnel]);

  // ── Plan CRUD ──────────────────────────────────────────────

  const createPlan = useCallback((name: string, date: string, shiftType: ShiftType) => {
    const plan: ShiftPlan = {
      id: `sp_${Date.now()}`,
      name,
      date,
      shiftType,
      assignments: [],
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setPlans((prev) => [...prev, plan]);
    setActivePlanId(plan.id);
    return plan;
  }, []);

  const deletePlan = useCallback((planId: string) => {
    setPlans((prev) => prev.filter((p) => p.id !== planId));
    if (activePlanId === planId) {
      setActivePlanId(null);
      setSelectionMode(false);
      setSelectedAreas(new Set());
      setPendingFeatures([]);
    }
  }, [activePlanId]);

  const updatePlanStatus = useCallback((planId: string, status: ShiftPlan['status']) => {
    setPlans((prev) => prev.map((p) =>
      p.id === planId ? { ...p, status, updatedAt: new Date().toISOString() } : p
    ));
  }, []);

  const duplicatePlan = useCallback((planId: string, newDate: string) => {
    const source = plansRef.current.find((p) => p.id === planId);
    if (!source) return null;
    const plan: ShiftPlan = {
      ...source,
      id: `sp_${Date.now()}`,
      name: `${source.name} (Copy)`,
      date: newDate,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setPlans((prev) => [...prev, plan]);
    setActivePlanId(plan.id);
    return plan;
  }, []);

  // ── Area selection handling ────────────────────────────────

  const handleFeatureClick = useCallback((info: GeoFeatureInfo) => {
    const key = `${info.layerId}::${info.featureKey}`;

    setSelectedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        setPendingFeatures((pf) => pf.filter((f) => `${f.layerId}::${f.featureKey}` !== key));
      } else {
        next.add(key);
        setPendingFeatures((pf) => [...pf, info]);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedAreas(new Set());
    setPendingFeatures([]);
  }, []);

  // ── Assignment management ──────────────────────────────────

  const assignAreasToOfficers = useCallback((
    officerIds: string[],
    unitIds: string[],
    shiftStart?: string,
    shiftEnd?: string,
    notes?: string,
  ) => {
    if (!activePlanId || pendingFeatures.length === 0) return;

    const officerNames = officerIds.map((id) => {
      const o = officers.find((off) => off.id === id);
      return o ? o.full_name : id;
    });
    const unitCallSigns = unitIds.map((id) => {
      const u = units.find((un) => un.id === id);
      return u ? u.call_sign : id;
    });

    const newAssignments: AreaAssignment[] = pendingFeatures.map((feat) => ({
      id: `aa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      layerId: feat.layerId,
      featureKey: feat.featureKey,
      label: feat.label,
      properties: feat.properties,
      officerIds,
      officerNames,
      unitIds,
      unitCallSigns,
      shiftStart,
      shiftEnd,
      notes,
    }));

    setPlans((prev) => prev.map((p) => {
      if (p.id !== activePlanId) return p;
      // Replace existing assignments for same areas, add new ones
      const existingFiltered = p.assignments.filter(
        (a) => !newAssignments.some((n) => n.layerId === a.layerId && n.featureKey === a.featureKey)
      );
      return {
        ...p,
        assignments: [...existingFiltered, ...newAssignments],
        updatedAt: new Date().toISOString(),
      };
    }));

    // Clear selection after assignment
    clearSelection();
  }, [activePlanId, pendingFeatures, officers, units, clearSelection]);

  const removeAssignment = useCallback((assignmentId: string) => {
    setPlans((prev) => prev.map((p) =>
      p.id === activePlanId
        ? { ...p, assignments: p.assignments.filter((a) => a.id !== assignmentId), updatedAt: new Date().toISOString() }
        : p
    ));
  }, [activePlanId]);

  const removeAllAssignments = useCallback(() => {
    setPlans((prev) => prev.map((p) =>
      p.id === activePlanId
        ? { ...p, assignments: [], updatedAt: new Date().toISOString() }
        : p
    ));
  }, [activePlanId]);

  // ── Toggle selection mode ──────────────────────────────────

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) {
        // Exiting selection mode — clear pending selection
        clearSelection();
      }
      return !prev;
    });
  }, [clearSelection]);

  // ── Coverage stats ─────────────────────────────────────────

  const getCoverageStats = useCallback(() => {
    if (!activePlan) return { assigned: 0, total: 0, officers: 0, units: 0 };
    const uniqueOfficers = new Set<string>();
    const uniqueUnits = new Set<string>();
    for (const a of activePlan.assignments) {
      a.officerIds.forEach((id) => uniqueOfficers.add(id));
      a.unitIds.forEach((id) => uniqueUnits.add(id));
    }
    return {
      assigned: activePlan.assignments.length,
      total: activePlan.assignments.length, // could compare to total features
      officers: uniqueOfficers.size,
      units: uniqueUnits.size,
    };
  }, [activePlan]);

  // ── API persistence (save/load from server) ────────────────

  const savePlanToServer = useCallback(async (planId: string) => {
    const plan = plansRef.current.find((p) => p.id === planId);
    if (!plan) return;
    try {
      await apiFetch('/admin/shift-plans', {
        method: 'POST',
        body: JSON.stringify(plan),
      });
    } catch (err) {
      console.error('[ShiftPlanning] Save to server failed:', err);
      throw err;
    }
  }, []);

  const loadPlansFromServer = useCallback(async () => {
    try {
      const data = await apiFetch('/admin/shift-plans') as ShiftPlan[];
      if (Array.isArray(data) && data.length > 0) {
        setPlans((prev) => {
          // Merge server plans with local (server wins on conflict)
          const serverIds = new Set(data.map((p) => p.id));
          const localOnly = prev.filter((p) => !serverIds.has(p.id));
          return [...data, ...localOnly];
        });
      }
    } catch (err) {
      console.warn('[useShiftPlanning] Server plans fetch failed, using localStorage fallback:', err);
    }
  }, []);

  useEffect(() => { loadPlansFromServer(); }, [loadPlansFromServer]);
  useLiveSync('admin', loadPlansFromServer);

  return {
    // Plans
    plans,
    activePlan,
    activePlanId,
    setActivePlanId,
    createPlan,
    deletePlan,
    updatePlanStatus,
    duplicatePlan,
    savePlanToServer,

    // Selection
    selectionMode,
    toggleSelectionMode,
    setSelectionMode,
    selectedAreas,
    pendingFeatures,
    handleFeatureClick,
    clearSelection,

    // Assignments
    assignedFeatures,
    assignAreasToOfficers,
    removeAssignment,
    removeAllAssignments,

    // Personnel
    officers,
    units,
    fetchPersonnel,

    // Stats
    getCoverageStats,
  };
}
