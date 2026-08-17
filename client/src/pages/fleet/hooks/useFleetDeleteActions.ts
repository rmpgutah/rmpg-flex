import { useState, useCallback } from 'react';
import { useToast } from '../../../components/ToastProvider';
import { apiFetch } from '../../../hooks/useApi';
import type { FleetFuelLog, FleetMaintenance, FleetInspection } from '../../../types';

interface Deps {
  selectedId: string | number | null;
  setSelectedId: (id: string | number | null) => void;
  fetchDetail: (id: string | number) => Promise<void>;
  fetchFuelLogs: (id: string | number) => Promise<void>;
  fetchInspections: (id: string | number) => Promise<void>;
  fetchVehicles: (opts?: { silent?: boolean }) => void;
  clearDetail: () => void;
}

export interface FleetDeleteActionsResult {
  // Vehicle-level
  deletingVehicleId: string | number | null;
  setDeletingVehicleId: (id: string | number | null) => void;
  isDeleting: boolean;
  handleDeleteVehicle: () => Promise<void>;
  handleArchiveVehicle: () => Promise<void>;
  handleUnarchiveVehicle: () => Promise<void>;
  // Fuel
  deletingFuel: FleetFuelLog | null;
  setDeletingFuel: (log: FleetFuelLog | null) => void;
  handleDeleteFuel: () => Promise<void>;
  handleBulkDeleteFuel: (logs: FleetFuelLog[]) => Promise<void>;
  // Maintenance
  deletingMaintenance: FleetMaintenance | null;
  setDeletingMaintenance: (r: FleetMaintenance | null) => void;
  handleDeleteMaintenance: () => Promise<void>;
  // Inspection
  deletingInspection: FleetInspection | null;
  setDeletingInspection: (insp: FleetInspection | null) => void;
  handleDeleteInspection: () => Promise<void>;
}

/** Centralises all fleet delete/archive confirm-dialog state and their handlers.
 *  The shared `isDeleting` flag feeds all four ConfirmDialogs' `isLoading` prop. */
export function useFleetDeleteActions({
  selectedId,
  setSelectedId,
  fetchDetail,
  fetchFuelLogs,
  fetchInspections,
  fetchVehicles,
  clearDetail,
}: Deps): FleetDeleteActionsResult {
  const { addToast } = useToast();

  const [deletingVehicleId, setDeletingVehicleId] = useState<string | number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletingFuel, setDeletingFuel] = useState<FleetFuelLog | null>(null);
  const [deletingMaintenance, setDeletingMaintenance] = useState<FleetMaintenance | null>(null);
  const [deletingInspection, setDeletingInspection] = useState<FleetInspection | null>(null);

  const handleDeleteVehicle = useCallback(async () => {
    if (deletingVehicleId == null) return;
    setIsDeleting(true);
    try {
      await apiFetch(`/fleet/${deletingVehicleId}`, { method: 'DELETE' });
      addToast('Vehicle deleted', 'success');
      setDeletingVehicleId(null);
      setSelectedId(null);
      clearDetail();
      fetchVehicles({ silent: true });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete vehicle', 'error');
    } finally { setIsDeleting(false); }
  }, [deletingVehicleId, setSelectedId, clearDetail, fetchVehicles, addToast]);

  const handleArchiveVehicle = useCallback(async () => {
    if (selectedId == null) return;
    try {
      await apiFetch(`/fleet/${selectedId}/archive`, { method: 'POST' });
      addToast('Vehicle archived', 'success');
      setSelectedId(null);
      clearDetail();
      fetchVehicles({ silent: true });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to archive vehicle', 'error');
    }
  }, [selectedId, setSelectedId, clearDetail, fetchVehicles, addToast]);

  const handleUnarchiveVehicle = useCallback(async () => {
    if (selectedId == null) return;
    try {
      await apiFetch(`/fleet/${selectedId}/unarchive`, { method: 'POST' });
      addToast('Vehicle unarchived', 'success');
      setSelectedId(null);
      clearDetail();
      fetchVehicles({ silent: true });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to unarchive vehicle', 'error');
    }
  }, [selectedId, setSelectedId, clearDetail, fetchVehicles, addToast]);

  const handleDeleteFuel = useCallback(async () => {
    if (!deletingFuel || selectedId == null) return;
    setIsDeleting(true);
    try {
      await apiFetch(`/fleet/fuel/${deletingFuel.id}`, { method: 'DELETE' });
      addToast('Fuel log deleted', 'success');
      setDeletingFuel(null);
      fetchFuelLogs(selectedId);
      fetchDetail(selectedId);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete fuel log', 'error');
    } finally { setIsDeleting(false); }
  }, [deletingFuel, selectedId, fetchFuelLogs, fetchDetail, addToast]);

  // Bulk delete for FleetFuelTab's "Delete Duplicates" action. Issues one
  // DELETE per record (rather than reusing handleDeleteFuel in a loop) because
  // state updates batch to the last call — a loop over setDeletingFuel would
  // silently stop after the first iteration.
  const handleBulkDeleteFuel = useCallback(async (logs: FleetFuelLog[]) => {
    if (!logs.length || selectedId == null) return;
    setIsDeleting(true);
    try {
      const results = await Promise.allSettled(
        logs.map((log) => apiFetch(`/fleet/fuel/${log.id}`, { method: 'DELETE' })),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      const succeeded = results.length - failed;
      if (succeeded > 0) addToast(`${succeeded} duplicate fuel log${succeeded === 1 ? '' : 's'} deleted`, 'success');
      if (failed > 0) addToast(`${failed} duplicate${failed === 1 ? '' : 's'} failed to delete`, 'error');
      fetchFuelLogs(selectedId);
      fetchDetail(selectedId);
    } finally { setIsDeleting(false); }
  }, [selectedId, fetchFuelLogs, fetchDetail, addToast]);

  const handleDeleteMaintenance = useCallback(async () => {
    if (!deletingMaintenance || selectedId == null) return;
    setIsDeleting(true);
    try {
      await apiFetch(`/fleet/maintenance/${deletingMaintenance.id}`, { method: 'DELETE' });
      addToast('Maintenance record deleted', 'success');
      setDeletingMaintenance(null);
      fetchDetail(selectedId);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete maintenance record', 'error');
    } finally { setIsDeleting(false); }
  }, [deletingMaintenance, selectedId, fetchDetail, addToast]);

  const handleDeleteInspection = useCallback(async () => {
    if (!deletingInspection || selectedId == null) return;
    setIsDeleting(true);
    try {
      await apiFetch(`/fleet/inspections/${deletingInspection.id}`, { method: 'DELETE' });
      addToast('Inspection deleted', 'success');
      setDeletingInspection(null);
      fetchInspections(selectedId);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete inspection', 'error');
    } finally { setIsDeleting(false); }
  }, [deletingInspection, selectedId, fetchInspections, addToast]);

  return {
    deletingVehicleId, setDeletingVehicleId, isDeleting,
    handleDeleteVehicle, handleArchiveVehicle, handleUnarchiveVehicle,
    deletingFuel, setDeletingFuel, handleDeleteFuel, handleBulkDeleteFuel,
    deletingMaintenance, setDeletingMaintenance, handleDeleteMaintenance,
    deletingInspection, setDeletingInspection, handleDeleteInspection,
  };
}
