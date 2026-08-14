import { useCallback } from 'react';
import { useToast } from '../../../components/ToastProvider';
import { apiFetch } from '../../../hooks/useApi';
import type { FleetPersonnelData } from '../../../types';

interface Deps {
  selectedId: string | number | null;
  fetchDetail: (id: string | number) => Promise<void>;
  fetchVehicles: (opts?: { silent?: boolean }) => void;
  fetchPersonnel: (id: string | number) => Promise<void>;
  fetchAssignments: (id: string | number) => Promise<void>;
  personnelData: FleetPersonnelData | null;
}

export interface FleetPersonnelActionsResult {
  handleAssignVehicle: (unitId: string) => Promise<void>;
  handleUnassignVehicle: () => Promise<void>;
  handleAddPersonnelNote: (note: string) => Promise<void>;
  handleDeletePersonnelNote: (noteId: string) => Promise<void>;
  handleRefreshPersonnel: () => void;
}

export function useFleetPersonnelActions({
  selectedId,
  fetchDetail,
  fetchVehicles,
  fetchPersonnel,
  fetchAssignments,
  personnelData,
}: Deps): FleetPersonnelActionsResult {
  const { addToast } = useToast();

  const handleAssignVehicle = useCallback(async (unitId: string) => {
    if (selectedId == null) return;
    try {
      await apiFetch(`/fleet/${selectedId}/assign`, { method: 'PUT', body: JSON.stringify({ unit_id: unitId }) });
      addToast('Vehicle assigned successfully', 'success');
      fetchDetail(selectedId);
      fetchVehicles({ silent: true });
      fetchPersonnel(selectedId);
      fetchAssignments(selectedId);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to assign vehicle', 'error');
    }
  }, [selectedId, fetchDetail, fetchVehicles, fetchPersonnel, fetchAssignments, addToast]);

  const handleUnassignVehicle = useCallback(async () => {
    if (selectedId == null) return;
    try {
      await apiFetch(`/fleet/${selectedId}/assign`, { method: 'PUT', body: JSON.stringify({ unit_id: null }) });
      addToast('Vehicle unassigned successfully', 'success');
      fetchDetail(selectedId);
      fetchVehicles({ silent: true });
      fetchPersonnel(selectedId);
      fetchAssignments(selectedId);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to unassign vehicle', 'error');
    }
  }, [selectedId, fetchDetail, fetchVehicles, fetchPersonnel, fetchAssignments, addToast]);

  const handleAddPersonnelNote = useCallback(async (note: string) => {
    if (selectedId == null) return;
    try {
      const officerId = personnelData?.officer?.id;
      const officerName = personnelData?.officer?.full_name;
      await apiFetch(`/fleet/${selectedId}/personnel-notes`, {
        method: 'POST',
        // Handler INSERTs `content`; send both so the note text persists
        // (live fleet_personnel_notes has both `content` and `note` columns).
        body: JSON.stringify({ content: note, note, officer_id: officerId || null, officer_name: officerName || null }),
      });
      addToast('Note added', 'success');
      fetchPersonnel(selectedId);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to add note', 'error');
    }
  }, [selectedId, personnelData, fetchPersonnel, addToast]);

  const handleDeletePersonnelNote = useCallback(async (noteId: string) => {
    if (selectedId == null) return;
    try {
      await apiFetch(`/fleet/${selectedId}/personnel-notes/${noteId}`, { method: 'DELETE' });
      addToast('Note deleted', 'success');
      fetchPersonnel(selectedId);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete note', 'error');
    }
  }, [selectedId, fetchPersonnel, addToast]);

  const handleRefreshPersonnel = useCallback(() => {
    if (selectedId) fetchPersonnel(selectedId);
  }, [selectedId, fetchPersonnel]);

  return {
    handleAssignVehicle,
    handleUnassignVehicle,
    handleAddPersonnelNote,
    handleDeletePersonnelNote,
    handleRefreshPersonnel,
  };
}
