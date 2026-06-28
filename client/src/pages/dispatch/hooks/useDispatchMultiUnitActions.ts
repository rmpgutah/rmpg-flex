// ============================================================
// useDispatchMultiUnitActions — Multi-unit dispatch cluster
// ============================================================
// Owns the 4 handlers that operate on multiple units at once
// (or on a unit-to-unit transfer / auto-assign / closest-unit
// lookup) plus the multi-select state used by the unit picker.
//
// Handlers:
//   handleSuggestClosestUnit — read-only; toasts the closest available
//                               unit's call sign + distance
//   handleAutoAssign         — POST /auto-assign; server picks the
//                               unit, returns the updated call
//   handleMultiUnitDispatch  — POST /dispatch with a list of unit_ids
//   handleTransferCall       — POST /transfer with from_unit_id +
//                               to_unit_id
//
// All four take callId as an explicit param — no closure over
// selectedCall, so the hook signature stays narrow.

import { useCallback, useState } from 'react';
import type { CallForService, Unit } from '../../../types';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { mapDbCall, mapDbUnit, looksLikeCallRow } from '../utils/dispatchMappers';

export interface UseDispatchMultiUnitActionsArgs {
  setCalls: React.Dispatch<React.SetStateAction<CallForService[]>>;
  setSelectedCall: React.Dispatch<React.SetStateAction<CallForService | null>>;
  setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
}

export function useDispatchMultiUnitActions(args: UseDispatchMultiUnitActionsArgs) {
  const { setCalls, setSelectedCall, setUnits } = args;
  const { addToast } = useToast();

  // ── Owned state ───────────────────────────────────────────
  const [multiSelectUnits, setMultiSelectUnits] = useState<string[]>([]);

  // ── Internal helper: refresh units (mirrors sister hooks) ──
  const refreshUnits = useCallback(async () => {
    const unitsRes = await apiFetch<any[]>('/dispatch/units');
    setUnits((Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit));
  }, [setUnits]);

  // ── Handlers ──────────────────────────────────────────────

  const handleSuggestClosestUnit = useCallback(async (callId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/closest-unit`);
      const sug = result?.suggestion;
      if (!sug) {
        addToast(result?.reason || 'No available units with GPS', 'info');
        return;
      }
      const dist = typeof sug.distance_miles === 'number' ? sug.distance_miles.toFixed(2) : '?';
      addToast(`Closest: ${sug.call_sign} — ${dist} mi (${sug.officer_name || 'unassigned'})`, 'success');
    } catch (err: any) {
      addToast(err?.message || err?.error || 'Failed to compute closest unit', 'error');
    }
  }, [addToast]);

  const handleAutoAssign = useCallback(async (callId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/auto-assign`, { method: 'POST' });
      // DEFENSIVE: only replace the call if the response is a full row; never let
      // a partial/error body blank the dispatch (refreshUnits + live-sync reconcile).
      if (looksLikeCallRow(result)) {
        const updatedCall = mapDbCall(result);
        setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
        setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
      }
      await refreshUnits();
      addToast(`Auto-assigned ${result.auto_assigned_unit} (${result.distance_miles} mi)`, 'success');
    } catch (err: any) {
      addToast(err?.message || err?.error || 'No available units', 'error');
    }
  }, [setCalls, setSelectedCall, refreshUnits, addToast]);

  const handleMultiUnitDispatch = useCallback(async (callId: string, unitIds: string[]) => {
    if (unitIds.length === 0) return;
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ unit_ids: unitIds.map(Number) }),
      });
      // DEFENSIVE: fall back to merging the dispatched ids locally rather than
      // letting a non-row response blank the call.
      const apply = (c: CallForService): CallForService => looksLikeCallRow(result)
        ? mapDbCall(result)
        : { ...c, assigned_units: Array.from(new Set([...(c.assigned_units || []), ...unitIds.map(String)])) };
      setCalls((prev) => prev.map((c) => c.id === callId ? apply(c) : c));
      setSelectedCall((prev) => prev?.id === callId ? apply(prev) : prev);
      await refreshUnits();
      setMultiSelectUnits([]);
      addToast(`${unitIds.length} units dispatched`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to dispatch units', 'error');
    }
  }, [setCalls, setSelectedCall, refreshUnits, addToast]);

  const handleTransferCall = useCallback(async (callId: string, fromUnitId: string, toUnitId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ from_unit_id: fromUnitId, to_unit_id: toUnitId }),
      });
      // DEFENSIVE: only replace the call if the response is a full row; never let
      // a partial/error body blank the dispatch (refreshUnits + live-sync reconcile).
      if (looksLikeCallRow(result)) {
        const updatedCall = mapDbCall(result);
        setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
        setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
      }
      await refreshUnits();
      addToast('Call transferred', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Transfer failed', 'error');
    }
  }, [setCalls, setSelectedCall, refreshUnits, addToast]);

  return {
    multiSelectUnits, setMultiSelectUnits,
    handleSuggestClosestUnit,
    handleAutoAssign,
    handleMultiUnitDispatch,
    handleTransferCall,
  };
}
