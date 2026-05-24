// ============================================================
// useDispatchUnitActions — Unit-management cluster for DispatchPage
// ============================================================
// Owns the create/edit/delete-unit modal state plus the five
// API-call handlers that mutate units (create, update, delete,
// assign to call, unassign, drag-assign). Exists to keep this
// cohesive cluster out of the 6,000-line DispatchPage component.
//
// State staying in DispatchPage (passed in as args):
//   - units / setUnits         (units list is consumed across many handlers)
//   - selectedCall / setSelectedCall (also consumed widely)
//   - setCalls                 (called from many other places too)
//
// State owned here (returned to JSX via the hook's result):
//   - showCreateUnitModal, editingUnit, newUnit{CallSign|OfficerId|Status},
//     unitCreating, deletingUnit, unitDeleting

import { useCallback, useState } from 'react';
import type { CallForService, Unit } from '../../../types';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { mapDbCall, mapDbUnit } from '../utils/dispatchMappers';
import { announceLocalAction } from '../../../utils/voiceAlerts';

export interface UseDispatchUnitActionsArgs {
  selectedCall: CallForService | null;
  setSelectedCall: React.Dispatch<React.SetStateAction<CallForService | null>>;
  units: Unit[];
  setCalls: React.Dispatch<React.SetStateAction<CallForService[]>>;
  setUnits: React.Dispatch<React.SetStateAction<Unit[]>>;
  /** Called after handleAssignUnit succeeds — typically closes the attach-unit dropdown. */
  onAssignSuccess?: () => void;
}

export function useDispatchUnitActions(args: UseDispatchUnitActionsArgs) {
  const { selectedCall, setSelectedCall, units, setCalls, setUnits, onAssignSuccess } = args;
  const { addToast } = useToast();

  // ── Modal state (create/edit) ──────────────────────────────
  const [showCreateUnitModal, setShowCreateUnitModal] = useState(false);
  const [newUnitCallSign, setNewUnitCallSign] = useState('');
  const [newUnitOfficerId, setNewUnitOfficerId] = useState('');
  const [newUnitStatus, setNewUnitStatus] = useState<string>('available');
  const [unitCreating, setUnitCreating] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);

  // ── Modal state (delete) ───────────────────────────────────
  const [deletingUnit, setDeletingUnit] = useState<Unit | null>(null);
  const [unitDeleting, setUnitDeleting] = useState(false);

  // ── Refresh helper (replaces 5 inline copies of the same fetch) ──
  const refreshUnits = useCallback(async () => {
    const unitsRes = await apiFetch<any[]>('/dispatch/units');
    setUnits((Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit));
  }, [setUnits]);

  // ── Handlers ───────────────────────────────────────────────

  const handleSaveUnit = useCallback(async () => {
    const cs = newUnitCallSign.trim();
    if (!cs) { addToast('Call sign is required', 'error'); return; }
    setUnitCreating(true);
    try {
      if (editingUnit) {
        await apiFetch(`/dispatch/units/${editingUnit.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            call_sign: cs,
            officer_id: newUnitOfficerId || null,
            status: newUnitStatus,
          }),
        });
      } else {
        await apiFetch('/dispatch/units', {
          method: 'POST',
          body: JSON.stringify({
            call_sign: cs,
            officer_id: newUnitOfficerId || null,
            status: newUnitStatus || 'available',
          }),
        });
      }
      await refreshUnits();
      setNewUnitCallSign('');
      setNewUnitOfficerId('');
      setNewUnitStatus('available');
      setEditingUnit(null);
      setShowCreateUnitModal(false);
    } catch (err: any) {
      addToast(err?.error || err?.message || `Failed to ${editingUnit ? 'update' : 'create'} unit`, 'error');
    } finally {
      setUnitCreating(false);
    }
  }, [newUnitCallSign, editingUnit, newUnitOfficerId, newUnitStatus, refreshUnits, addToast]);

  const openEditUnit = useCallback((unit: Unit) => {
    setEditingUnit(unit);
    setNewUnitCallSign(unit.call_sign);
    setNewUnitOfficerId(unit.officer_id || '');
    setNewUnitStatus(unit.status);
    setShowCreateUnitModal(true);
  }, []);

  const handleDeleteUnit = useCallback(async () => {
    if (!deletingUnit) return;
    setUnitDeleting(true);
    try {
      await apiFetch(`/dispatch/units/${deletingUnit.id}`, { method: 'DELETE' });
      await refreshUnits();
      setDeletingUnit(null);
    } catch (err: any) {
      addToast(err?.error || err?.message || 'Failed to delete unit', 'error');
    } finally {
      setUnitDeleting(false);
    }
  }, [deletingUnit, refreshUnits, addToast]);

  const handleAssignUnit = useCallback(async (unitId: string) => {
    if (!selectedCall) return;
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/assign-unit`, {
        method: 'POST',
        body: JSON.stringify({ unit_id: unitId }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === selectedCall.id ? updatedCall : c));
      setSelectedCall(updatedCall);
      onAssignSuccess?.();
      const assignedUnit = units.find((u) => String(u.id) === String(unitId));
      if (assignedUnit) {
        announceLocalAction('unit_dispatched', `Unit ${assignedUnit.call_sign} dispatched to ${selectedCall.call_number}.`);
      }
      await refreshUnits();
    } catch (err: any) {
      console.error('Failed to assign unit:', err);
      addToast(err?.message || 'Failed to assign unit', 'error');
    }
  }, [selectedCall, units, setCalls, setSelectedCall, onAssignSuccess, refreshUnits, addToast]);

  const handleDragAssignUnit = useCallback(async (callId: string, unitId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/assign-unit`, {
        method: 'POST',
        body: JSON.stringify({ unit_id: unitId }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
      await refreshUnits();
      addToast(`Unit assigned to call`, 'success');
    } catch (err: any) {
      addToast(err?.error || err?.message || 'Failed to assign unit via drag', 'error');
    }
  }, [setCalls, setSelectedCall, refreshUnits, addToast]);

  const handleUnassignUnit = useCallback(async (unitId: string) => {
    if (!selectedCall) return;
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/unassign-unit`, {
        method: 'POST',
        body: JSON.stringify({ unit_id: unitId }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === selectedCall.id ? updatedCall : c));
      setSelectedCall(updatedCall);
      await refreshUnits();
    } catch (err: any) {
      console.error('Failed to unassign unit:', err);
      addToast(err?.message || 'Failed to unassign unit', 'error');
    }
  }, [selectedCall, setCalls, setSelectedCall, refreshUnits, addToast]);

  return {
    // Create/edit modal state
    showCreateUnitModal,
    setShowCreateUnitModal,
    editingUnit,
    setEditingUnit,
    newUnitCallSign,
    setNewUnitCallSign,
    newUnitOfficerId,
    setNewUnitOfficerId,
    newUnitStatus,
    setNewUnitStatus,
    unitCreating,
    // Delete modal state
    deletingUnit,
    setDeletingUnit,
    unitDeleting,
    // Handlers
    openEditUnit,
    handleSaveUnit,
    handleDeleteUnit,
    handleAssignUnit,
    handleDragAssignUnit,
    handleUnassignUnit,
  };
}
