import React, { useState, useEffect, useCallback } from 'react';
import {
  Car, Plus, Wrench, Search, Gauge, AlertTriangle, CheckCircle,
  Calendar, Shield, Tag, Radio, BarChart3, Archive, RotateCcw, Trash2,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';
import { usePersistedTab } from '../../hooks/usePersistedState';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import { useToast } from '../../components/ToastProvider';
import PanelTitleBar from '../../components/PanelTitleBar';
import RmpgLogo from '../../components/RmpgLogo';
import PrintButton from '../../components/PrintButton';
import { nowLocalISO, toDatetimeLocal } from './utils/fleetFormatters';
import GaugeRing from './components/GaugeRing';
import FleetDetailPanel, { type DetailTab } from './FleetDetailPanel';
import FleetAnalyticsTab from './tabs/FleetAnalyticsTab';
import VehicleFormModal, { type VehicleFormState, EMPTY_VEHICLE_FORM } from './modals/VehicleFormModal';
import MaintenanceFormModal, { type MaintenanceFormState, EMPTY_MAINT_FORM } from './modals/MaintenanceFormModal';
import FuelLogModal, { type FuelFormState, EMPTY_FUEL_FORM } from './modals/FuelLogModal';
import InspectionFormModal, { type InspectionFormState, EMPTY_INSPECTION_FORM } from './modals/InspectionFormModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import MaintenanceMonitor from './components/MaintenanceMonitor';
import type {
  FleetVehicle, FleetMaintenance, FleetVehicleStatus,
  FleetFuelLog, FleetFuelSummary, FleetInspection, FleetAssignment, FleetAnalytics,
  FleetPersonnelData,
} from '../../types';

// ============================================================
// RMPG Flex — Fleet Vehicle Management Page (Refactored)
// ============================================================

type ModalMode = 'none' | 'new_vehicle' | 'edit_vehicle' | 'log_maintenance' | 'edit_maintenance' | 'log_fuel' | 'edit_fuel' | 'new_inspection' | 'edit_inspection';

const STATUS_COLOR: Record<FleetVehicleStatus, string> = {
  in_service: '#22c55e', maintenance: '#f59e0b',
  out_of_service: '#ef4444', retired: '#6b7280',
};

const STATUS_LABEL: Record<FleetVehicleStatus, string> = {
  in_service: 'In Service', maintenance: 'Maintenance',
  out_of_service: 'Out of Service', retired: 'Retired',
};

const VEHICLE_STATUSES: { value: FleetVehicleStatus; label: string }[] = [
  { value: 'in_service', label: 'In Service' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'out_of_service', label: 'Out of Service' },
  { value: 'retired', label: 'Retired' },
];

function getExpiryStatus(dateStr?: string): 'ok' | 'expiring' | 'expired' | 'none' {
  if (!dateStr) return 'none';
  const exp = new Date(dateStr);
  const now = new Date();
  if (exp < now) return 'expired';
  const thirtyDays = new Date();
  thirtyDays.setDate(thirtyDays.getDate() + 30);
  if (exp <= thirtyDays) return 'expiring';
  return 'ok';
}

function parseEquipment(eq: unknown): string[] {
  if (Array.isArray(eq)) return eq;
  if (typeof eq === 'string') { try { return JSON.parse(eq); } catch { return []; } }
  return [];
}

export default function FleetPage() {
  const { addToast } = useToast();

  // Core state
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [detail, setDetail] = useState<FleetVehicle | null>(null);
  const [maintenance, setMaintenance] = useState<FleetMaintenance[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Tab & modal state
  const [activeTab, setActiveTab] = usePersistedTab('rmpg_fleet_tab', 'overview' as DetailTab, ['overview', 'fuel', 'inspections', 'assignments', 'personnel', 'analytics'] as const);
  const [modal, setModal] = useState<ModalMode>('none');
  const [vehicleForm, setVehicleForm] = useState<VehicleFormState>(EMPTY_VEHICLE_FORM);
  const [maintForm, setMaintForm] = useState<MaintenanceFormState>(EMPTY_MAINT_FORM);
  const [fuelForm, setFuelForm] = useState<FuelFormState>(EMPTY_FUEL_FORM);
  const [inspectionForm, setInspectionForm] = useState<InspectionFormState>(EMPTY_INSPECTION_FORM);
  const [saving, setSaving] = useState(false);

  // New feature data
  const [fuelLogs, setFuelLogs] = useState<FleetFuelLog[]>([]);
  const [fuelSummary, setFuelSummary] = useState<FleetFuelSummary | null>(null);
  const [inspections, setInspections] = useState<FleetInspection[]>([]);
  const [assignments, setAssignments] = useState<FleetAssignment[]>([]);
  const [analytics, setAnalytics] = useState<FleetAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [personnelData, setPersonnelData] = useState<FleetPersonnelData | null>(null);
  const [personnelLoading, setPersonnelLoading] = useState(false);

  // Fleet-wide analytics for no-selection state
  const [fleetAnalytics, setFleetAnalytics] = useState<FleetAnalytics | null>(null);
  const [fleetAnalyticsLoading, setFleetAnalyticsLoading] = useState(false);

  // Archive / Delete state
  const [showArchived, setShowArchived] = useState(false);
  const [deletingVehicleId, setDeletingVehicleId] = useState<string | number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Editing state — tracks which record is being edited
  const [editingFuelId, setEditingFuelId] = useState<string | null>(null);
  const [editingMaintenanceId, setEditingMaintenanceId] = useState<string | null>(null);
  const [editingInspectionId, setEditingInspectionId] = useState<string | null>(null);

  // Delete confirmation state for sub-records
  const [deletingFuel, setDeletingFuel] = useState<FleetFuelLog | null>(null);
  const [deletingMaintenance, setDeletingMaintenance] = useState<FleetMaintenance | null>(null);
  const [deletingInspection, setDeletingInspection] = useState<FleetInspection | null>(null);

  useUnsavedChanges(modal !== 'none');

  // ----------------------------------------------------------
  // Data fetching
  // ----------------------------------------------------------

  const fetchVehicles = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const resp = await apiFetch<{ data: FleetVehicle[]; pagination: any }>(`/fleet?archived=${showArchived}`);
      setVehicles(Array.isArray(resp) ? resp : resp.data || []);
    } catch (err) {
      if (!options?.silent) addToast('Failed to load fleet vehicles', 'error');
    }
  }, [addToast, showArchived]);

  useEffect(() => { fetchVehicles(); }, [fetchVehicles]);

  // Live sync — auto-refresh when any device modifies fleet (silent to avoid unmounting UI)
  const silentRefreshVehicles = useCallback(() => fetchVehicles({ silent: true }), [fetchVehicles]);
  useLiveSync('fleet', silentRefreshVehicles);

  const fetchDetail = useCallback(async (id: string | number) => {
    try {
      const data = await apiFetch<FleetVehicle & { recent_maintenance?: FleetMaintenance[]; maintenance?: FleetMaintenance[] }>(`/fleet/${id}`);
      const { recent_maintenance, maintenance: maint, ...vehicle } = data;
      setDetail(vehicle);
      setMaintenance(recent_maintenance || maint || []);
    } catch (err) {
      addToast('Failed to load vehicle details', 'error');
    }
  }, [addToast]);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  // Reset tab when selecting different vehicle
  useEffect(() => {
    setActiveTab('overview');
    setFuelLogs([]);
    setFuelSummary(null);
    setInspections([]);
    setAssignments([]);
    setAnalytics(null);
    setPersonnelData(null);
  }, [selectedId]);

  // Lazy-load tab data
  useEffect(() => {
    if (!selectedId) return;
    if (activeTab === 'fuel') fetchFuelLogs(selectedId);
    if (activeTab === 'inspections') fetchInspections(selectedId);
    if (activeTab === 'assignments') fetchAssignments(selectedId);
    if (activeTab === 'analytics') fetchVehicleAnalytics();
    if (activeTab === 'personnel') fetchPersonnel(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, activeTab]);

  // Fetch fleet-wide analytics when no vehicle selected
  useEffect(() => {
    if (!selectedId) {
      fetchFleetAnalytics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const fetchFuelLogs = async (id: string | number) => {
    try {
      const data = await apiFetch<{ data: FleetFuelLog[]; summary: FleetFuelSummary }>(`/fleet/${id}/fuel`);
      setFuelLogs(data.data || []);
      setFuelSummary(data.summary || null);
    } catch { addToast('Failed to load fuel logs', 'error'); }
  };

  const fetchInspections = async (id: string | number) => {
    try {
      const data = await apiFetch<{ data: FleetInspection[] }>(`/fleet/${id}/inspections`);
      setInspections(data.data || []);
    } catch { addToast('Failed to load inspections', 'error'); }
  };

  const fetchAssignments = async (id: string | number) => {
    try {
      const data = await apiFetch<{ data: FleetAssignment[] }>(`/fleet/${id}/assignments`);
      setAssignments(data.data || []);
    } catch { addToast('Failed to load assignments', 'error'); }
  };

  const fetchVehicleAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const data = await apiFetch<FleetAnalytics>('/fleet/analytics');
      setAnalytics(data);
    } catch { addToast('Failed to load analytics', 'error'); }
    finally { setAnalyticsLoading(false); }
  };

  const fetchPersonnel = async (id: string | number) => {
    setPersonnelLoading(true);
    try {
      const data = await apiFetch<FleetPersonnelData>(`/fleet/${id}/personnel`);
      setPersonnelData(data);
    } catch { addToast('Failed to load personnel data', 'error'); }
    finally { setPersonnelLoading(false); }
  };

  const fetchFleetAnalytics = async () => {
    setFleetAnalyticsLoading(true);
    try {
      const data = await apiFetch<FleetAnalytics>('/fleet/analytics');
      setFleetAnalytics(data);
    } catch { /* silent - fleet analytics is optional */ }
    finally { setFleetAnalyticsLoading(false); }
  };

  // ----------------------------------------------------------
  // Filter logic
  // ----------------------------------------------------------

  const filtered = vehicles.filter((v) => {
    if (filterStatus !== 'all' && v.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const haystack = `${v.vehicle_number} ${v.make} ${v.model} ${v.plate_number} ${v.vin}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // ----------------------------------------------------------
  // Stats
  // ----------------------------------------------------------

  const statusCounts = vehicles.reduce((acc, v) => {
    acc[v.status] = (acc[v.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totalMileage = vehicles.reduce((sum, v) => sum + (v.current_mileage || 0), 0);
  const avgMileage = vehicles.length > 0 ? Math.round(totalMileage / vehicles.length) : 0;

  const needsService = vehicles.filter(v => {
    if (!v.next_service_due) return false;
    return new Date(v.next_service_due) <= new Date();
  }).length;

  const registrationExpiring = vehicles.filter(v => {
    if (!v.registration_expiry) return false;
    const exp = new Date(v.registration_expiry);
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    return exp <= thirtyDays;
  }).length;

  const insuranceExpiring = vehicles.filter(v => {
    if (!v.insurance_expiry) return false;
    const exp = new Date(v.insurance_expiry);
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    return exp <= thirtyDays;
  }).length;

  const assignedVehicles = vehicles.filter(v => v.assigned_unit_call_sign).length;

  // ----------------------------------------------------------
  // CRUD handlers
  // ----------------------------------------------------------

  const handleSaveVehicle = async () => {
    if (!vehicleForm.vehicle_number.trim()) { addToast('Vehicle number is required', 'warning'); return; }
    setSaving(true);
    try {
      const equipArr = vehicleForm.equipment_str.split(',').map(s => s.trim()).filter(Boolean);
      const payload = {
        vehicle_number: vehicleForm.vehicle_number.trim(),
        make: vehicleForm.make.trim() || null,
        model: vehicleForm.model.trim() || null,
        year: vehicleForm.year ? parseInt(vehicleForm.year, 10) : null,
        color: vehicleForm.color.trim() || null,
        vin: vehicleForm.vin.trim() || null,
        plate_number: vehicleForm.plate_number.trim() || null,
        plate_state: vehicleForm.plate_state.trim() || null,
        status: vehicleForm.status,
        current_mileage: vehicleForm.current_mileage ? parseInt(vehicleForm.current_mileage, 10) : null,
        insurance_expiry: vehicleForm.insurance_expiry || null,
        registration_expiry: vehicleForm.registration_expiry || null,
        equipment: equipArr,
        notes: vehicleForm.notes.trim() || null,
      };
      if (modal === 'new_vehicle') {
        await apiFetch('/fleet', { method: 'POST', body: JSON.stringify(payload) });
        addToast('Vehicle created successfully', 'success');
      } else if (modal === 'edit_vehicle' && selectedId != null) {
        await apiFetch(`/fleet/${selectedId}`, { method: 'PUT', body: JSON.stringify(payload) });
        addToast('Vehicle updated successfully', 'success');
        fetchDetail(selectedId);
      }
      setModal('none');
      fetchVehicles({ silent: true });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save vehicle', 'error');
    } finally { setSaving(false); }
  };

  const handleSaveMaintenance = async () => {
    if (!maintForm.description.trim()) { addToast('Description is required', 'warning'); return; }
    if (selectedId == null) return;
    setSaving(true);
    try {
      const payload = {
        type: maintForm.type,
        description: maintForm.description.trim(),
        mileage_at_service: maintForm.mileage_at_service ? parseInt(maintForm.mileage_at_service, 10) : null,
        cost: maintForm.cost ? parseFloat(maintForm.cost) : null,
        vendor: maintForm.vendor.trim() || null,
        performed_by: maintForm.performed_by.trim() || null,
        performed_at: maintForm.performed_at || nowLocalISO(),
        next_due_date: maintForm.next_due_date || null,
      };
      if (modal === 'edit_maintenance' && editingMaintenanceId) {
        await apiFetch(`/fleet/maintenance/${editingMaintenanceId}`, { method: 'PUT', body: JSON.stringify(payload) });
        addToast('Maintenance updated successfully', 'success');
      } else {
        await apiFetch(`/fleet/${selectedId}/maintenance`, { method: 'POST', body: JSON.stringify(payload) });
        addToast('Maintenance logged successfully', 'success');
      }
      setModal('none');
      setEditingMaintenanceId(null);
      fetchDetail(selectedId);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save maintenance', 'error');
    } finally { setSaving(false); }
  };

  const handleSaveFuel = async () => {
    if (!fuelForm.fuel_date || !fuelForm.gallons) { addToast('Date and gallons are required', 'warning'); return; }
    if (selectedId == null) return;
    setSaving(true);
    try {
      const payload = {
        fuel_date: fuelForm.fuel_date,
        gallons: parseFloat(fuelForm.gallons),
        cost_per_gallon: fuelForm.cost_per_gallon ? parseFloat(fuelForm.cost_per_gallon) : null,
        total_cost: fuelForm.total_cost ? parseFloat(fuelForm.total_cost) : null,
        odometer_reading: fuelForm.odometer_reading ? parseInt(fuelForm.odometer_reading, 10) : null,
        fuel_type: fuelForm.fuel_type,
        station: fuelForm.station.trim() || null,
        notes: fuelForm.notes.trim() || null,
      };
      if (modal === 'edit_fuel' && editingFuelId) {
        await apiFetch(`/fleet/fuel/${editingFuelId}`, { method: 'PUT', body: JSON.stringify(payload) });
        addToast('Fuel entry updated successfully', 'success');
      } else {
        await apiFetch(`/fleet/${selectedId}/fuel`, { method: 'POST', body: JSON.stringify(payload) });
        addToast('Fuel entry logged successfully', 'success');
      }
      setModal('none');
      setEditingFuelId(null);
      fetchFuelLogs(selectedId);
      if (payload.odometer_reading) fetchDetail(selectedId); // refresh mileage
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save fuel entry', 'error');
    } finally { setSaving(false); }
  };

  const handleSaveInspection = async () => {
    if (!inspectionForm.inspector_name.trim()) { addToast('Inspector name is required', 'warning'); return; }
    if (selectedId == null) return;
    setSaving(true);
    try {
      const payload = {
        inspection_type: inspectionForm.inspection_type,
        inspector_name: inspectionForm.inspector_name.trim(),
        inspection_date: inspectionForm.inspection_date,
        overall_result: inspectionForm.overall_result,
        mileage: inspectionForm.mileage ? parseInt(inspectionForm.mileage, 10) : null,
        items: inspectionForm.items,
        notes: inspectionForm.notes.trim() || null,
      };
      if (modal === 'edit_inspection' && editingInspectionId) {
        await apiFetch(`/fleet/inspections/${editingInspectionId}`, { method: 'PUT', body: JSON.stringify(payload) });
        addToast('Inspection updated successfully', 'success');
      } else {
        await apiFetch(`/fleet/${selectedId}/inspections`, { method: 'POST', body: JSON.stringify(payload) });
        addToast('Inspection submitted successfully', 'success');
      }
      setModal('none');
      setEditingInspectionId(null);
      fetchInspections(selectedId);
      if (payload.mileage) fetchDetail(selectedId);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save inspection', 'error');
    } finally { setSaving(false); }
  };

  // Personnel CRUD handlers
  const handleAssignVehicle = async (unitId: string) => {
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
  };

  const handleUnassignVehicle = async () => {
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
  };

  const handleAddPersonnelNote = async (note: string) => {
    if (selectedId == null) return;
    try {
      const officerId = personnelData?.officer?.id;
      const officerName = personnelData?.officer?.full_name;
      await apiFetch(`/fleet/${selectedId}/personnel-notes`, {
        method: 'POST',
        body: JSON.stringify({ note, officer_id: officerId || null, officer_name: officerName || null }),
      });
      addToast('Note added', 'success');
      fetchPersonnel(selectedId);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to add note', 'error');
    }
  };

  const handleDeletePersonnelNote = async (noteId: string) => {
    if (selectedId == null) return;
    try {
      await apiFetch(`/fleet/${selectedId}/personnel-notes/${noteId}`, { method: 'DELETE' });
      addToast('Note deleted', 'success');
      fetchPersonnel(selectedId);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete note', 'error');
    }
  };

  const handleRefreshPersonnel = () => {
    if (selectedId) fetchPersonnel(selectedId);
  };

  // Archive / Unarchive / Delete handlers
  const handleArchiveVehicle = async () => {
    if (selectedId == null) return;
    try {
      await apiFetch(`/fleet/${selectedId}/archive`, { method: 'POST' });
      addToast('Vehicle archived', 'success');
      setSelectedId(null);
      setDetail(null);
      fetchVehicles({ silent: true });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to archive vehicle', 'error');
    }
  };

  const handleUnarchiveVehicle = async () => {
    if (selectedId == null) return;
    try {
      await apiFetch(`/fleet/${selectedId}/unarchive`, { method: 'POST' });
      addToast('Vehicle unarchived', 'success');
      setSelectedId(null);
      setDetail(null);
      fetchVehicles({ silent: true });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to unarchive vehicle', 'error');
    }
  };

  const handleDeleteVehicle = async () => {
    if (deletingVehicleId == null) return;
    setIsDeleting(true);
    try {
      await apiFetch(`/fleet/${deletingVehicleId}`, { method: 'DELETE' });
      addToast('Vehicle deleted', 'success');
      setDeletingVehicleId(null);
      setSelectedId(null);
      setDetail(null);
      fetchVehicles({ silent: true });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete vehicle', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  // Modal openers
  const openNewVehicle = () => { setVehicleForm(EMPTY_VEHICLE_FORM); setModal('new_vehicle'); };
  const openEditVehicle = () => {
    if (!detail) return;
    setVehicleForm({
      vehicle_number: detail.vehicle_number || '', make: detail.make || '', model: detail.model || '',
      year: detail.year ? String(detail.year) : '', color: detail.color || '', vin: detail.vin || '',
      plate_number: detail.plate_number || '', plate_state: detail.plate_state || '',
      status: detail.status, current_mileage: detail.current_mileage ? String(detail.current_mileage) : '',
      insurance_expiry: toDatetimeLocal(detail.insurance_expiry),
      registration_expiry: toDatetimeLocal(detail.registration_expiry),
      equipment_str: parseEquipment(detail.equipment).join(', '), notes: detail.notes || '',
    });
    setModal('edit_vehicle');
  };
  const openLogMaintenance = () => {
    setMaintForm({
      ...EMPTY_MAINT_FORM,
      performed_at: nowLocalISO(),
      mileage_at_service: detail?.current_mileage ? String(detail.current_mileage) : '',
    });
    setModal('log_maintenance');
  };
  const openLogFuel = () => {
    setFuelForm({
      ...EMPTY_FUEL_FORM,
      fuel_date: nowLocalISO(),
      odometer_reading: detail?.current_mileage ? String(detail.current_mileage) : '',
    });
    setModal('log_fuel');
  };
  const openNewInspection = () => {
    setInspectionForm({
      ...EMPTY_INSPECTION_FORM,
      inspection_date: nowLocalISO(),
      mileage: detail?.current_mileage ? String(detail.current_mileage) : '',
    });
    setModal('new_inspection');
  };

  // ── Edit openers (pre-populate form with existing record data) ──
  const openEditFuel = (log: FleetFuelLog) => {
    setFuelForm({
      fuel_date: toDatetimeLocal(log.fuel_date),
      gallons: String(log.gallons),
      cost_per_gallon: log.cost_per_gallon != null ? String(log.cost_per_gallon) : '',
      total_cost: log.total_cost != null ? String(log.total_cost) : '',
      odometer_reading: log.odometer_reading != null ? String(log.odometer_reading) : '',
      fuel_type: log.fuel_type,
      station: log.station || '',
      notes: log.notes || '',
    });
    setEditingFuelId(log.id);
    setModal('edit_fuel');
  };

  const openEditMaintenance = (record: FleetMaintenance) => {
    setMaintForm({
      type: record.type,
      description: record.description,
      mileage_at_service: record.mileage_at_service != null ? String(record.mileage_at_service) : '',
      cost: record.cost != null ? String(record.cost) : '',
      vendor: record.vendor || '',
      performed_by: record.performed_by || '',
      performed_at: toDatetimeLocal(record.performed_at),
      next_due_date: record.next_due_date ? toDatetimeLocal(record.next_due_date) : '',
    });
    setEditingMaintenanceId(record.id);
    setModal('edit_maintenance');
  };

  const openEditInspection = (inspection: FleetInspection) => {
    setInspectionForm({
      inspection_type: inspection.inspection_type,
      inspector_name: inspection.inspector_name,
      inspection_date: toDatetimeLocal(inspection.inspection_date),
      mileage: inspection.mileage != null ? String(inspection.mileage) : '',
      overall_result: inspection.overall_result,
      items: inspection.items.map(i => ({ ...i })),
      notes: inspection.notes || '',
    });
    setEditingInspectionId(inspection.id);
    setModal('edit_inspection');
  };

  // ── Delete handlers ──
  const handleDeleteFuel = async () => {
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
  };

  const handleDeleteMaintenance = async () => {
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
  };

  const handleDeleteInspection = async () => {
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
  };

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  return (
    <div className="flex flex-col h-full animate-fade-in bg-surface-base">

      {/* ====== FLEET STATS DASHBOARD ====== */}
      <div className="flex-shrink-0 border-b border-rmpg-700" style={{ background: '#161616' }}>
        <PanelTitleBar title="FLEET MANAGEMENT" icon={Car}>
          <RmpgLogo height={16} iconOnly />
          <span className="toolbar-separator" />
          <div className="flex items-center gap-2 text-[10px] font-mono text-rmpg-400 mr-3">
            <Car className="w-3 h-3" />
            <span>Total: <strong className="text-white">{vehicles.length}</strong></span>
            <span className="text-rmpg-600">|</span>
            <span>Assigned: <strong className="text-amber-400">{assignedVehicles}</strong></span>
          </div>
          <button
            className={`toolbar-btn ${showArchived ? 'text-amber-400 border-amber-600/50' : ''}`}
            onClick={() => { setShowArchived(!showArchived); setSelectedId(null); setDetail(null); }}
          >
            <Archive className="w-3 h-3" /> {showArchived ? 'Viewing Archives' : 'Show Archives'}
          </button>
          {!showArchived && (
            <button className="toolbar-btn toolbar-btn-primary" onClick={openNewVehicle}>
              <Plus className="w-3 h-3" /> New Vehicle
            </button>
          )}
          <PrintButton />
        </PanelTitleBar>

        {/* Stats Bar — compact inline row */}
        <div className="px-4 py-2 flex items-center gap-4">
          {/* Status Gauges */}
          <div className="flex items-center gap-2">
            {VEHICLE_STATUSES.map(({ value, label }) => (
              <button
                key={value}
                className={`panel-beveled px-2.5 py-1.5 flex items-center gap-2 cursor-pointer transition-all ${
                  filterStatus === value ? 'ring-1 ring-brand-500 bg-brand-900/10' : 'bg-surface-base hover:border-rmpg-400'
                }`}
                onClick={() => setFilterStatus(filterStatus === value ? 'all' : value)}
              >
                <GaugeRing
                  value={statusCounts[value] || 0}
                  max={vehicles.length || 1}
                  color={STATUS_COLOR[value]}
                  label={label}
                  size={38}
                />
                <div className="text-left">
                  <div className="text-sm font-bold font-mono" style={{ color: STATUS_COLOR[value] }}>
                    {statusCounts[value] || 0}
                  </div>
                  <div className="text-[7px] text-rmpg-400 uppercase tracking-wider leading-none">{label}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Separator */}
          <div className="h-8 w-px bg-rmpg-600 flex-shrink-0" />

          {/* Quick Stats */}
          <div className="flex items-center gap-3 text-[10px] font-mono">
            <div className="flex items-center gap-1.5" title="Due for Service">
              {needsService > 0 ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> : <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
              <span className="text-rmpg-400">Service:</span>
              <span className="font-bold" style={{ color: needsService > 0 ? '#f59e0b' : '#22c55e' }}>{needsService}</span>
            </div>
            <div className="flex items-center gap-1.5" title="Expiring Registration/Insurance">
              <Shield className="w-3.5 h-3.5 text-red-400" />
              <span className="text-rmpg-400">Expiring:</span>
              <span className="font-bold" style={{ color: (registrationExpiring + insuranceExpiring) > 0 ? '#ef4444' : '#22c55e' }}>
                {registrationExpiring + insuranceExpiring}
              </span>
            </div>
            <div className="flex items-center gap-1.5" title="Average Mileage">
              <Gauge className="w-3.5 h-3.5 text-brand-400" />
              <span className="text-rmpg-400">Avg:</span>
              <span className="font-bold text-brand-400">{avgMileage > 0 ? avgMileage.toLocaleString() : '-'}</span>
            </div>
            <div className="flex items-center gap-1.5" title="Total Fleet Mileage">
              <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-rmpg-400">Total:</span>
              <span className="font-bold text-cyan-400">{totalMileage > 0 ? `${(totalMileage / 1000).toFixed(0)}k mi` : '-'}</span>
            </div>
          </div>

          {/* Alert Badges — right aligned */}
          {(needsService > 0 || registrationExpiring > 0 || insuranceExpiring > 0) && (
            <div className="flex items-center gap-2 ml-auto">
              {needsService > 0 && (
                <div className="flex items-center gap-1 px-2 py-0.5 bg-amber-900/20 border border-amber-700/30 text-[9px] text-amber-400">
                  <Wrench className="w-2.5 h-2.5" /> {needsService} overdue
                </div>
              )}
              {registrationExpiring > 0 && (
                <div className="flex items-center gap-1 px-2 py-0.5 bg-red-900/20 border border-red-700/30 text-[9px] text-red-400">
                  <Calendar className="w-2.5 h-2.5" /> {registrationExpiring} reg
                </div>
              )}
              {insuranceExpiring > 0 && (
                <div className="flex items-center gap-1 px-2 py-0.5 bg-red-900/20 border border-red-700/30 text-[9px] text-red-400">
                  <Shield className="w-2.5 h-2.5" /> {insuranceExpiring} ins
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ====== SPLIT LAYOUT ====== */}
      <div className="flex flex-1 overflow-hidden">

        {/* ---- LEFT PANEL: Vehicle List ---- */}
        <div className="flex flex-col" style={{ width: '36%', minWidth: 300, maxWidth: 440, background: '#1a2636' }}>
          <div className="flex items-center gap-2 px-2 py-1.5 border-b border-rmpg-700" style={{ background: '#141e2b' }}>
            <select
              className="select-dark text-[10px] py-1 px-2"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">All Status</option>
              {VEHICLE_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <div className="flex-1 relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
              <input
                className="input-dark w-full text-[10px] py-1 pl-6 pr-2"
                placeholder="Search vehicles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="text-center py-8">
                <Car className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                <p className="text-[11px] text-rmpg-500">No vehicles found</p>
              </div>
            )}
            {filtered.map((v) => {
              const isSelected = selectedId != null && String(v.id) === String(selectedId);
              const statusColor = STATUS_COLOR[v.status];
              const regStatus = getExpiryStatus(v.registration_expiry);
              const insStatus = getExpiryStatus(v.insurance_expiry);
              const svcStatus = getExpiryStatus(v.next_service_due);
              const hasAlert = regStatus === 'expired' || insStatus === 'expired' || svcStatus === 'expired';
              const hasWarning = regStatus === 'expiring' || insStatus === 'expiring' || svcStatus === 'expiring';

              return (
                <div
                  key={v.id}
                  className={`px-3 py-2.5 cursor-pointer border-b border-rmpg-700 transition-colors ${
                    isSelected ? 'panel-inset' : 'hover:bg-rmpg-800'
                  }`}
                  style={isSelected ? { background: '#141e2b', borderLeft: `3px solid ${statusColor}` } : { borderLeft: '3px solid transparent' }}
                  onClick={() => setSelectedId(v.id)}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`relative flex-shrink-0 w-9 h-9 rounded flex items-center justify-center border ${
                      v.status === 'in_service' ? 'bg-green-900/20 border-green-700/40' :
                      v.status === 'maintenance' ? 'bg-amber-900/20 border-amber-700/40' :
                      v.status === 'out_of_service' ? 'bg-red-900/20 border-red-700/40' :
                      'bg-rmpg-800/50 border-rmpg-700/40'
                    }`}>
                      <Car className="w-4 h-4" style={{ color: statusColor }} />
                      {hasAlert && (
                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full flex items-center justify-center animate-pulse">
                          <span className="text-[6px] text-white font-bold">!</span>
                        </div>
                      )}
                      {!hasAlert && hasWarning && (
                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 rounded-full flex items-center justify-center">
                          <span className="text-[6px] text-white font-bold">!</span>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-sm font-bold ${isSelected ? 'text-green-400' : 'text-rmpg-200'}`}>
                          {v.vehicle_number}
                        </span>
                        <span className={`px-1 py-0.5 text-[8px] font-bold uppercase border ${
                          v.status === 'in_service' ? 'bg-green-900/30 text-green-400 border-green-700/40' :
                          v.status === 'maintenance' ? 'bg-amber-900/30 text-amber-400 border-amber-700/40' :
                          v.status === 'out_of_service' ? 'bg-red-900/30 text-red-400 border-red-700/40' :
                          'bg-rmpg-800 text-rmpg-400 border-rmpg-600'
                        }`}>
                          {STATUS_LABEL[v.status]}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-rmpg-300">
                          {[v.year, v.make, v.model].filter(Boolean).join(' ')}
                        </span>
                        {v.color && <span className="text-[9px] text-rmpg-500">({v.color})</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {v.plate_number && (
                          <span className="font-mono text-[9px] text-rmpg-500 flex items-center gap-0.5">
                            <Tag className="w-2.5 h-2.5" />{v.plate_state ? `${v.plate_state} ` : ''}{v.plate_number}
                          </span>
                        )}
                        {v.current_mileage != null && v.current_mileage > 0 && (
                          <span className="text-[9px] text-rmpg-500 flex items-center gap-0.5">
                            <Gauge className="w-2.5 h-2.5" />{v.current_mileage.toLocaleString()} mi
                          </span>
                        )}
                        {v.assigned_unit_call_sign && (
                          <span className="text-[9px] text-amber-400 flex items-center gap-0.5">
                            <Radio className="w-2.5 h-2.5" />{v.assigned_unit_call_sign}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-0.5">
                      {regStatus === 'expired' && <span className="text-[8px] text-red-400 font-bold">REG EXP</span>}
                      {regStatus === 'expiring' && <span className="text-[8px] text-amber-400">REG SOON</span>}
                      {insStatus === 'expired' && <span className="text-[8px] text-red-400 font-bold">INS EXP</span>}
                      {insStatus === 'expiring' && <span className="text-[8px] text-amber-400">INS SOON</span>}
                      {svcStatus === 'expired' && <span className="text-[8px] text-amber-400 font-bold">SVC DUE</span>}
                    </div>
                  </div>
                  {/* Utilization bar */}
                  {v.current_mileage != null && v.current_mileage > 0 && (
                    <div className="mt-1.5 w-full">
                      <div className="flex justify-between text-[7px] text-rmpg-600 mb-0.5">
                        <span>UTILIZATION</span>
                        <span className="font-mono">{Math.min(100, Math.round((v.current_mileage / 150000) * 100))}%</span>
                      </div>
                      <div className="w-full h-1 bg-rmpg-700 overflow-hidden">
                        <div
                          className="h-full transition-all duration-300"
                          style={{
                            width: `${Math.min(100, (v.current_mileage / 150000) * 100)}%`,
                            background: v.current_mileage < 75000 ? '#22c55e'
                              : v.current_mileage < 120000 ? '#f59e0b' : '#ef4444',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ---- DIVIDER ---- */}
        <div className="flex-shrink-0 w-px bg-rmpg-600" />

        {/* ---- RIGHT PANEL ---- */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#1a2636' }}>
          {selectedId == null || !detail ? (
            // Fleet-wide: Maintenance Monitor + Analytics when no vehicle selected
            <div className="flex-1 overflow-y-auto">
              <MaintenanceMonitor onSelectVehicle={(id) => { setSelectedId(id); fetchDetail(id); }} />
              {fleetAnalytics ? (
                <div className="px-3 pb-3">
                  <FleetAnalyticsTab analytics={fleetAnalytics} loading={fleetAnalyticsLoading} />
                </div>
              ) : (
                <div className="flex items-center justify-center py-8">
                  <div className="text-center">
                    <Car className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                    <p className="text-xs text-rmpg-500">Select a vehicle to view details</p>
                    <p className="text-[10px] text-rmpg-600 mt-1">{vehicles.length} vehicles in fleet</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <FleetDetailPanel
              detail={detail}
              maintenance={maintenance}
              fuelLogs={fuelLogs}
              fuelSummary={fuelSummary}
              inspections={inspections}
              assignments={assignments}
              analytics={analytics}
              analyticsLoading={analyticsLoading}
              personnelData={personnelData}
              personnelLoading={personnelLoading}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onEditVehicle={openEditVehicle}
              onLogMaintenance={openLogMaintenance}
              onLogFuel={openLogFuel}
              onNewInspection={openNewInspection}
              onEditFuel={openEditFuel}
              onDeleteFuel={(log) => setDeletingFuel(log)}
              onEditMaintenance={openEditMaintenance}
              onDeleteMaintenance={(record) => setDeletingMaintenance(record)}
              onEditInspection={openEditInspection}
              onDeleteInspection={(insp) => setDeletingInspection(insp)}
              onAssignVehicle={handleAssignVehicle}
              onUnassignVehicle={handleUnassignVehicle}
              onAddPersonnelNote={handleAddPersonnelNote}
              onDeletePersonnelNote={handleDeletePersonnelNote}
              onRefreshPersonnel={handleRefreshPersonnel}
              onArchiveVehicle={handleArchiveVehicle}
              onUnarchiveVehicle={handleUnarchiveVehicle}
              onDeleteVehicle={() => setDeletingVehicleId(selectedId)}
              isArchived={showArchived}
              onClose={() => { setSelectedId(null); setDetail(null); }}
            />
          )}
        </div>
      </div>

      {/* ====== MODALS ====== */}
      <VehicleFormModal
        isOpen={modal === 'new_vehicle' || modal === 'edit_vehicle'}
        mode={modal === 'edit_vehicle' ? 'edit_vehicle' : 'new_vehicle'}
        form={vehicleForm}
        onChange={setVehicleForm}
        onSave={handleSaveVehicle}
        onClose={() => setModal('none')}
        saving={saving}
      />
      <MaintenanceFormModal
        isOpen={modal === 'log_maintenance' || modal === 'edit_maintenance'}
        mode={modal === 'edit_maintenance' ? 'edit' : 'create'}
        form={maintForm}
        onChange={setMaintForm}
        onSave={handleSaveMaintenance}
        onClose={() => { setModal('none'); setEditingMaintenanceId(null); }}
        saving={saving}
      />
      <FuelLogModal
        isOpen={modal === 'log_fuel' || modal === 'edit_fuel'}
        mode={modal === 'edit_fuel' ? 'edit' : 'create'}
        form={fuelForm}
        onChange={setFuelForm}
        onSave={handleSaveFuel}
        onClose={() => { setModal('none'); setEditingFuelId(null); }}
        saving={saving}
      />
      <InspectionFormModal
        isOpen={modal === 'new_inspection' || modal === 'edit_inspection'}
        mode={modal === 'edit_inspection' ? 'edit' : 'create'}
        form={inspectionForm}
        onChange={setInspectionForm}
        onSave={handleSaveInspection}
        onClose={() => { setModal('none'); setEditingInspectionId(null); }}
        saving={saving}
      />

      {/* Delete Vehicle Confirmation */}
      <ConfirmDialog
        isOpen={deletingVehicleId !== null}
        onClose={() => setDeletingVehicleId(null)}
        onConfirm={handleDeleteVehicle}
        title="Delete Vehicle"
        message="Are you sure you want to permanently delete this vehicle? All maintenance, fuel, and inspection records will also be deleted. This action cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
      {/* Delete Fuel Log Confirmation */}
      <ConfirmDialog
        isOpen={deletingFuel !== null}
        onClose={() => setDeletingFuel(null)}
        onConfirm={handleDeleteFuel}
        title="Delete Fuel Log"
        message={`Delete the fuel log for ${deletingFuel?.gallons?.toFixed(3) || ''} gallons on ${deletingFuel?.fuel_date ? new Date(deletingFuel.fuel_date).toLocaleDateString() : ''}? This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
      {/* Delete Maintenance Confirmation */}
      <ConfirmDialog
        isOpen={deletingMaintenance !== null}
        onClose={() => setDeletingMaintenance(null)}
        onConfirm={handleDeleteMaintenance}
        title="Delete Maintenance Record"
        message={`Delete the ${deletingMaintenance?.type?.replace(/_/g, ' ') || ''} record: "${deletingMaintenance?.description || ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
      {/* Delete Inspection Confirmation */}
      <ConfirmDialog
        isOpen={deletingInspection !== null}
        onClose={() => setDeletingInspection(null)}
        onConfirm={handleDeleteInspection}
        title="Delete Inspection"
        message={`Delete the ${deletingInspection?.inspection_type?.replace(/_/g, ' ') || ''} inspection from ${deletingInspection?.inspection_date ? new Date(deletingInspection.inspection_date).toLocaleDateString() : ''}? This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
