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
import { useNavigate } from 'react-router-dom';
import type { CallForService, CallStatus } from '../../../types';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { mapDbCall, mapDbUnit } from '../utils/dispatchMappers';
import { announceLocalAction } from '../../../utils/voiceAlerts';

export interface UseDispatchCallActionsArgs {
  selectedCall: CallForService | null;
  setSelectedCall: React.Dispatch<React.SetStateAction<CallForService | null>>;
  setCalls: React.Dispatch<React.SetStateAction<CallForService[]>>;
  setArchivedCalls: React.Dispatch<React.SetStateAction<CallForService[]>>;
  setUnits: React.Dispatch<React.SetStateAction<any[]>>;
  setArchivedLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  /** Called by handleBulkArchive to refresh the active-calls list after a bulk op. */
  refetchAll: () => Promise<void> | void;
}

export function useDispatchCallActions(args: UseDispatchCallActionsArgs) {
  const {
    selectedCall, setSelectedCall, setCalls, setArchivedCalls,
    setUnits, setArchivedLoaded, refetchAll,
  } = args;
  const { addToast } = useToast();
  const navigate = useNavigate();

  // ── Owned state ───────────────────────────────────────────
  const [deleteCallTarget, setDeleteCallTarget] = useState<CallForService | null>(null);
  const [isDeletingCall, setIsDeletingCall] = useState(false);
  const [dispositionPromptCallId, setDispositionPromptCallId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isBulkArchiving, setIsBulkArchiving] = useState(false);

  // ── Internal helper: refresh units (mirrors useDispatchUnitActions) ──
  const refreshUnits = useCallback(async () => {
    const unitsRes = await apiFetch<any[]>('/dispatch/units');
    setUnits((Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit));
  }, [setUnits]);

  // ── Archive / unarchive (declared early so handleStatusChange can call it) ──
  const handleArchive = useCallback(async (callId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/archive`, { method: 'POST' });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.filter((c) => c.id !== callId));
      setArchivedCalls((prev) => [updatedCall, ...prev]);
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
    } catch (err) {
      console.error('Failed to archive call:', err);
      addToast('Failed to archive call', 'error');
    }
  }, [setCalls, setArchivedCalls, setSelectedCall, addToast]);

  const handleUnarchive = useCallback(async (callId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/unarchive`, { method: 'POST' });
      const updatedCall = mapDbCall(result);
      setArchivedCalls((prev) => prev.filter((c) => c.id !== callId));
      setCalls((prev) => [updatedCall, ...prev]);
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
    } catch (err) {
      console.error('Failed to unarchive call:', err);
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
      console.error('Failed to bulk archive calls:', err);
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
      // Auto-archive on closed/cancelled to clear the "All" view.
      if (newStatus === 'closed' || newStatus === 'cancelled') {
        await handleArchive(callId);
      }
    } catch (err) {
      console.error('Failed to update status:', err);
      addToast('Failed to update call status', 'error');
    }
  }, [setCalls, setSelectedCall, refreshUnits, handleArchive, addToast]);

  const handleHoldCall = useCallback(async (callId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/hold`, { method: 'POST' });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
    } catch (err) {
      console.error('Failed to hold call:', err);
      addToast('Failed to hold call', 'error');
    }
  }, [setCalls, setSelectedCall, addToast]);

  const handleResumeCall = useCallback(async (callId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/resume`, { method: 'POST' });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
    } catch (err) {
      console.error('Failed to resume call:', err);
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
    } catch (err: any) {
      console.error('Failed to revert status:', err);
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
          const token = localStorage.getItem('rmpg_token');
          const incRes = await fetch(`/api/dispatch/calls/${callId}/generate-incident`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          });
          if (incRes.ok) {
            navigate('/incidents');
          } else {
            const errData = await incRes.json().catch(() => ({}));
            addToast(errData.error || 'Failed to create incident report', 'error');
          }
        } catch (err) {
          console.error('Failed to promote call to incident:', err);
          addToast('Failed to create incident report from call', 'error');
        }
      }
    } catch (err: any) {
      console.error('Failed to clear call:', err);
      addToast('Failed to clear call', 'error');
    }
    setDispositionPromptCallId(null);
  }, [dispositionPromptCallId, setCalls, setSelectedCall, refreshUnits, navigate, addToast]);

  // ── Delete (any call) ─────────────────────────────────────
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
      addToast(`Call ${callNum} deleted`, 'success');
    } catch (err: any) {
      addToast(err?.message || err?.error || 'Failed to delete call', 'error');
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
      console.error('Failed to change priority:', err);
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
      console.error('Failed to notify LE:', err);
      addToast('Failed to notify LE', 'error');
    }
  }, [setCalls, setSelectedCall, addToast]);

  const handleGenerateIncident = useCallback(async () => {
    if (!selectedCall) return;
    setIsGenerating(true);
    try {
      // Direct fetch (not apiFetch) to preserve full error response.
      const token = localStorage.getItem('rmpg_token');
      const res = await fetch(`/api/dispatch/calls/${selectedCall.id}/generate-incident`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (res.status === 409) {
        addToast('An incident report already exists for this call', 'info');
        navigate('/incidents');
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || `Request failed with status ${res.status}`);
      }

      const incident = await res.json();
      addToast(`Incident ${incident.incident_number || ''} created`, 'success');
      navigate('/incidents');
    } catch (err: any) {
      console.error('Failed to generate incident:', err);
      addToast(err?.message || 'Failed to generate incident report', 'error');
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
