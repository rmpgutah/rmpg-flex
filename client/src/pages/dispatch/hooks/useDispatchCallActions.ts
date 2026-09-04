// ============================================================
// useDispatchCallActions — Call-lifecycle cluster for DispatchPage
// ============================================================
// Owns the 14 handlers that mutate a call's lifecycle state plus
// their associated modal/transient state. Exists to keep this
// cohesive cluster out of the 6,500-line DispatchPage component.
//
// Handlers grouped by sub-concern:
//   Status transitions: handleStatusChange, handleHoldCall, handleResumeCall,
//                       handleRevertStatus
//   Disposition flow:   handleClearWithDisposition, handleConfirmClear
//   Archive / delete:   handleArchive, handleUnarchive, handleBulkArchive,
//                       handleDeleteAnyCall
//   One-shot actions:   handlePriorityChange, handleLeNotify, handleGenerateIncident
//
// State staying in DispatchPage (passed in as args):
//   selectedCall / setSelectedCall / setCalls / setArchivedCalls / setUnits
//   setArchivedLoaded / refetchAll
//
// State owned here (returned to JSX):
//   deleteCallTarget, isDeletingCall, dispositionPromptCallId,
//   isGenerating, isBulkArchiving

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import type { CallForService, CallStatus } from '../../../types';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { mapDbCall } from '../utils/dispatchMappers';
import { announceLocalAction } from '../../../utils/voiceAlerts';

export interface UseDispatchCallActionsArgs {
  selectedCall: CallForService | null;
  setSelectedCall: React.Dispatch<React.SetStateAction<CallForService | null>>;
  setCalls: React.Dispatch<React.SetStateAction<CallForService[]>>;
  setArchivedCalls: React.Dispatch<React.SetStateAction<CallForService[]>>;
  setUnits: React.Dispatch<React.SetStateAction<any[]>>;
  refreshUnits: () => Promise<void>;
  setArchivedLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  /** Called by handleBulkArchive to refresh the active-calls list after a bulk op. */
  refetchAll: () => Promise<void> | void;
}

export function useDispatchCallActions(args: UseDispatchCallActionsArgs) {
  const {
    selectedCall, setSelectedCall, setCalls, setArchivedCalls,
    setUnits, refreshUnits, setArchivedLoaded, refetchAll,
  } = args;
  const { addToast } = useToast();
  const navigate = useNavigate();

  // ── Owned state ───────────────────────────────────────────
  const [deleteCallTarget, setDeleteCallTarget] = useState<CallForService | null>(null);
  const [isDeletingCall, setIsDeletingCall] = useState(false);
  const [dispositionPromptCallId, setDispositionPromptCallId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isBulkArchiving, setIsBulkArchiving] = useState(false);

  // ── Archive / unarchive (declared early so handleStatusChange can call it) ──
  const handleArchive = useCallback(async (callId: string) => {
    try {
      // The /archive handler returns a bare {message}, NOT the call row — mapping
      // that into mapDbCall() produced a blank call (id 'undefined', empty fields)
      // that overwrote the real one in the archived list. Reuse the in-memory row
      // instead. `moved` is captured inside the functional updater so we don't need
      // the full `calls` array in this hook's scope.
      await apiFetch(`/dispatch/calls/${callId}/archive`, { method: 'POST' });
      let moved: CallForService | undefined;
      setCalls((prev) => {
        moved = prev.find((c) => c.id === callId);
        return prev.filter((c) => c.id !== callId);
      });
      if (moved) {
        const archived: CallForService = { ...moved, status: 'archived' as CallStatus };
        setArchivedCalls((prev) => [archived, ...prev]);
      }
      setSelectedCall((prev) => prev?.id === callId ? null : prev);
    } catch (err) {
      addToast('Failed to archive call', 'error');
    }
  }, [setCalls, setArchivedCalls, setSelectedCall, addToast]);

  const handleUnarchive = useCallback(async (callId: string) => {
    try {
      // Same bare-{message} response as /archive — reuse the in-memory archived
      // row rather than mapping the ack into a blank call. The server restores
      // status to 'closed' (see /:id/unarchive).
      await apiFetch(`/dispatch/calls/${callId}/unarchive`, { method: 'POST' });
      let moved: CallForService | undefined;
      setArchivedCalls((prev) => {
        moved = prev.find((c) => c.id === callId);
        return prev.filter((c) => c.id !== callId);
      });
      if (moved) {
        const restored: CallForService = { ...moved, status: 'closed' as CallStatus };
        setCalls((prev) => [restored, ...prev]);
        setSelectedCall((prev) => prev?.id === callId ? restored : prev);
      }
    } catch (err) {
      addToast('Failed to unarchive call', 'error');
    }
  }, [setCalls, setArchivedCalls, setSelectedCall, addToast]);

  const handleBulkArchive = useCallback(async () => {
    setIsBulkArchiving(true);
    try {
      const result = await apiFetch<any>('/dispatch/calls/archive-bulk', {
        method: 'POST',
        body: JSON.stringify({ statuses: ['cleared', 'closed', 'cancelled'] }),
      });
      if (result.archived_count > 0) {
        await refetchAll();
        setArchivedLoaded(false);
        setArchivedCalls([]);
      }
    } catch (err) {
      addToast('Failed to bulk archive calls', 'error');
    } finally {
      setIsBulkArchiving(false);
    }
  }, [refetchAll, setArchivedLoaded, setArchivedCalls, addToast]);

  // ── Status transitions ────────────────────────────────────
  const handleStatusChange = useCallback(async (
    callId: string,
    newStatus: CallStatus,
    extraBody?: Record<string, any>,
  ) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus, ...extraBody }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
      if (newStatus === 'cleared' || newStatus === 'closed') {
        announceLocalAction('call_closed', `Call ${updatedCall.call_number} ${newStatus}.`);
      }
      // Clearing/closing/cancelling frees assigned units → refresh.
      if (newStatus === 'cleared' || newStatus === 'closed' || newStatus === 'cancelled') {
        await refreshUnits();
      }
      // NOTE: Auto-archive on closed/cancelled was removed 2026-06-05. The
      // previous behavior immediately archived the call after close/cancel,
      // which set selectedCall to null and jarringly closed the detail panel
      // mid-workflow. The 5-minute auto-archive timer (DispatchPage.tsx line
      // ~2050) still handles stale cleared calls; manual archive is available
      // via the Archive button for immediate cleanup.
    } catch (err) {
      addToast('Failed to update call status', 'error');
    }
  }, [setCalls, setSelectedCall, refreshUnits, addToast]);

  const handleHoldCall = useCallback(async (callId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/hold`, { method: 'POST' });
      // Server now returns the full row (incl. held_at) → mapDbCall derives the
      // synthetic 'on_hold' status. Guard the legacy bare-{message} shape: if no
      // id came back, update in place rather than blanking the card.
      if (result && result.id != null) {
        const updatedCall = mapDbCall(result);
        setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
        setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
      } else {
        const hold = (c: CallForService): CallForService => ({ ...c, status: 'on_hold' as CallStatus });
        setCalls((prev) => prev.map((c) => c.id === callId ? hold(c) : c));
        setSelectedCall((prev) => prev?.id === callId ? hold(prev) : prev);
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to hold call', 'error');
    }
  }, [setCalls, setSelectedCall, addToast]);

  const handleResumeCall = useCallback(async (callId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/resume`, { method: 'POST' });
      if (result && result.id != null) {
        const updatedCall = mapDbCall(result);
        setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
        setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
      } else {
        // Bare-ack fallback: restore a sensible non-held status from assignments.
        const resume = (c: CallForService): CallForService =>
          ({ ...c, status: (c.assigned_units?.length ? 'dispatched' : 'pending') as CallStatus });
        setCalls((prev) => prev.map((c) => c.id === callId ? resume(c) : c));
        setSelectedCall((prev) => prev?.id === callId ? resume(prev) : prev);
      }
    } catch (err) {
      addToast('Failed to resume call', 'error');
    }
  }, [setCalls, setSelectedCall, addToast]);

  const handleRevertStatus = useCallback(async (callId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/revert-status`, { method: 'POST' });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
      // Reverting from cleared re-dispatches the unit → refresh units.
      await refreshUnits();
    } catch (err) {
      addToast('Failed to revert call status', 'error');
    }
  }, [setCalls, setSelectedCall, refreshUnits, addToast]);

  // ── Disposition flow ──────────────────────────────────────
  const handleClearWithDisposition = useCallback((callId: string) => {
    setDispositionPromptCallId(callId);
  }, []);

  const handleConfirmClear = useCallback(async (
    disposition: string,
    createIncident?: boolean,
  ) => {
    if (!dispositionPromptCallId) return;
    const callId = dispositionPromptCallId;
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'cleared', disposition }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
      await refreshUnits();

      if (createIncident) {
        try {
          await apiFetch(`/dispatch/calls/${callId}/generate-incident`, { method: 'POST' });
          navigate('/incidents');
        } catch (err) {
          const apiErr = err as { error?: string; message?: string };
          addToast(apiErr.error || (err instanceof Error ? err.message : 'Failed to create incident report'), 'error');
        }
      }
    } catch (err) {
      addToast('Failed to clear call', 'error');
    }
    setDispositionPromptCallId(null);
  }, [dispositionPromptCallId, setCalls, setSelectedCall, refreshUnits, navigate, addToast]);

  // ── Remove (soft-delete / archive a call) ─────────────────
  // The server now soft-deletes (tombstones calls_for_service_ext.deleted_at)
  // instead of physically deleting — the call leaves the board but stays
  // recoverable by an admin. Gated to senior roles server-side (403 otherwise).
  const handleDeleteAnyCall = useCallback(async () => {
    if (!deleteCallTarget) return;
    const callNum = deleteCallTarget.call_number;
    setIsDeletingCall(true);
    try {
      await apiFetch(`/dispatch/calls/${deleteCallTarget.id}`, { method: 'DELETE' });
      setCalls((prev) => prev.filter((c) => c.id !== deleteCallTarget.id));
      setArchivedCalls((prev) => prev.filter((c) => c.id !== deleteCallTarget.id));
      setSelectedCall((prev) => prev?.id === deleteCallTarget.id ? null : prev);
      setDeleteCallTarget(null);
      addToast(`Call ${callNum} removed (archived, admin-recoverable)`, 'success');
    } catch (err) {
      const apiErr = err as { message?: string; error?: string };
      addToast(apiErr.message || apiErr.error || 'Failed to remove call', 'error');
    } finally {
      setIsDeletingCall(false);
    }
  }, [deleteCallTarget, setCalls, setArchivedCalls, setSelectedCall, addToast]);

  // ── One-shot actions ──────────────────────────────────────
  const handlePriorityChange = useCallback(async (callId: string, priority: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority }),
      });
      if (result) {
        const updated = mapDbCall(result);
        setCalls((prev) => prev.map((c) => c.id === callId ? updated : c));
        setSelectedCall((prev) => prev?.id === callId ? updated : prev);
        addToast(`Priority changed to ${priority}`, 'success');
      }
    } catch (err) {
      addToast('Failed to change priority', 'error');
    }
  }, [setCalls, setSelectedCall, addToast]);

  const handleLeNotify = useCallback(async (callId: string, agency?: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/le-notification`, {
        method: 'POST',
        body: JSON.stringify({ agency: agency || 'Local PD' }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
      addToast('Law enforcement notified', 'success');
    } catch (err) {
      addToast('Failed to notify LE', 'error');
    }
  }, [setCalls, setSelectedCall, addToast]);

  const handleGenerateIncident = useCallback(async () => {
    if (!selectedCall) return;
    setIsGenerating(true);
    try {
      const incident = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/generate-incident`, {
        method: 'POST',
      });
      addToast(`Incident ${incident.incident_number || ''} created`, 'success');
      navigate('/incidents');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('already exists')) {
        addToast('An incident report already exists for this call', 'info');
        navigate('/incidents');
        return;
      }
      addToast(msg || 'Failed to generate incident report', 'error');
    } finally {
      setIsGenerating(false);
    }
  }, [selectedCall, navigate, addToast]);

  return {
    // Owned state
    deleteCallTarget, setDeleteCallTarget,
    isDeletingCall,
    dispositionPromptCallId, setDispositionPromptCallId,
    isGenerating,
    isBulkArchiving,
    // Handlers
    handleStatusChange,
    handleHoldCall,
    handleResumeCall,
    handleRevertStatus,
    handleClearWithDisposition,
    handleConfirmClear,
    handleArchive,
    handleUnarchive,
    handleBulkArchive,
    handleDeleteAnyCall,
    handlePriorityChange,
    handleLeNotify,
    handleGenerateIncident,
  };
}
