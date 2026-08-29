import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import {
  Car, Plus, Wrench, Gauge, Archive, DollarSign, FileText,
  CheckCircle, Calendar, Shield, Eye, Trash2, Tag, Activity, LayoutDashboard,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import { useMenuActions } from '../../utils/contextMenuActions';
import { parseTimestamp, safeDateStr } from '../../utils/dateUtils';
import { usePersistedTab } from '../../hooks/usePersistedState';
import { useToast } from '../../components/ToastProvider';
import { useAuth } from '../../context/AuthContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import PanelTitleBar from '../../components/PanelTitleBar';
import RmpgLogo from '../../components/RmpgLogo';
import PrintButton from '../../components/PrintButton';
import FloatingSaveBar from '../../components/FloatingSaveBar';
import UnsavedChangesGuard from '../../components/UnsavedChangesGuard';
import { nowLocalISO, toDatetimeLocal } from './utils/fleetFormatters';
import FleetDetailPanel, { type DetailTab, type CostSubTab } from './FleetDetailPanel';
import FleetCostFormModal from './modals/FleetCostFormModal';
import VehicleFormModal, { EMPTY_VEHICLE_FORM } from './modals/VehicleFormModal';
import MaintenanceFormModal, { EMPTY_MAINT_FORM } from './modals/MaintenanceFormModal';
import FuelLogModal, { EMPTY_FUEL_FORM } from './modals/FuelLogModal';
import InspectionFormModal, { EMPTY_INSPECTION_FORM } from './modals/InspectionFormModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import ExportButton from '../../components/ExportButton';
import { useFleetVehicles } from './hooks/useFleetVehicles';
import { useVehicleDetail } from './hooks/useVehicleDetail';
import { useFleetCosts } from './hooks/useFleetCosts';
import { useFleetForms, type ModalMode } from './hooks/useFleetForms';
import { useFleetDeleteActions } from './hooks/useFleetDeleteActions';
import { useFleetPersonnelActions } from './hooks/useFleetPersonnelActions';
import FleetVehicleListPanel from './components/FleetVehicleListPanel';
import FleetStatsBar from './components/FleetStatsBar';
import FleetDashboardViews from './components/FleetDashboardViews';
import FleetPretripModal from './components/FleetPretripModal';
import type {
  FleetVehicle, FleetMaintenance, FleetFuelLog,
  FleetFuelSummary, FleetInspection, FleetAnalytics, FuelType,
} from '../../types';
import { toDisplayLabel } from '../../utils/formatters';
import type { FleetViewMode } from './fleetConstants';
import { downloadTextFile, fleetListToCsv } from '../../utils/rmsListExport';

// ============================================================
// RMPG Flex — Fleet Vehicle Management Page
// ============================================================

function parseEquipment(eq: unknown): string[] {
  if (Array.isArray(eq)) return eq;
  if (typeof eq === 'string') { try { return JSON.parse(eq); } catch { return []; } }
  return [];
}

export default function FleetPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const { openMenu } = useContextMenu();
  const cm = useMenuActions();

  // ── Vehicle list ──────────────────────────────────────────
  const {
    vehicles, vehicleTotal, filtered,
    filterStatus, setFilterStatus, searchQuery, setSearchQuery,
    showArchived, setShowArchived,
    statusCounts, avgMileage, refetch: fetchVehicles,
  } = useFleetVehicles();
  const [selectedId, setSelectedId] = useState<string | number | null>(null);

  const vehicleNumberById = useMemo(() => {
    const m = new Map<string | number, string>();
    for (const v of vehicles) m.set(v.id, v.vehicle_number || `#${v.id}`);
    return m;
  }, [vehicles]);

  // ── View mode (no vehicle selected) ──────────────────────
  const [viewMode, setViewMode] = usePersistedTab(
    'rmpg_fleet_view_mode',
    'dashboard' as FleetViewMode,
    ['dashboard', 'analysis', 'work_orders', 'vendors', 'service', 'driver_performance'] as const,
  );
  const [workOrdersVehicleFilter, setWorkOrdersVehicleFilter] = useState<number | null>(null);

  // ── Fleet-wide analytics (no vehicle selected) ───────────
  const [fleetAnalytics, setFleetAnalytics] = useState<FleetAnalytics | null>(null);
  const [fleetAnalyticsLoading, setFleetAnalyticsLoading] = useState(false);

  const fetchFleetAnalytics = useCallback(async (period?: string) => {
    setFleetAnalyticsLoading(true);
    try {
      const q = period ? `?period=${period}` : '';
      const data = await apiFetch<FleetAnalytics>(`/fleet/analytics${q}`);
      if (data && typeof data === 'object') setFleetAnalytics(data);
    } catch { /* fleet analytics is supplemental — fail silently */ }
    finally { setFleetAnalyticsLoading(false); }
  }, []);

  useEffect(() => {
    if (!selectedId) fetchFleetAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ── Ref bridges (see useVehicleDetail JSDoc) ─────────────
  const resetCostsRef = useRef<() => void>(() => {});
  const costsLazyLoadRef = useRef<(tab: string, id: string | number) => void>(() => {});

  const resetPerVehicleCostState = useCallback(() => { resetCostsRef.current(); }, []);
  const handleDetailLazyLoad = useCallback((tab: DetailTab, id: string | number) => {
    costsLazyLoadRef.current(tab, id);
  }, []);

  // ── Per-vehicle detail, lazy tabs, analytics, GPS mileage ─
  const {
    detail, maintenance, fuelLogs, fuelSummary, inspections, assignments,
    analytics, analyticsLoading, personnelData, personnelLoading,
    gpsMileage, gpsMileageLoading,
    activeTab, setActiveTab,
    fetchDetail, fetchFuelLogs, fetchInspections, fetchAssignments,
    fetchPersonnel, fetchVehicleAnalytics, fetchGpsMileage, syncGpsMileage, clearDetail,
  } = useVehicleDetail(selectedId, resetPerVehicleCostState, handleDetailLazyLoad);

  // ── Costs tab ─────────────────────────────────────────────
  const {
    loans, insurancePolicies, accessories, utilities, otherCosts, costSummary,
    costSubTab, setCostSubTab,
    costModalOpen, costCategory, costMode, costInitial, editingCostId, savingCost, deletingCost,
    costPerMile, costPerMileLoading,
    handleAddCost, handleEditCost, handleDeleteCost, confirmDeleteCost, cancelDeleteCost,
    handleSaveCost, handleSaveBudgets, closeCostModal,
    loadCostPerMile, clearCostPerMile, resetCosts, onCostsLazyLoad,
  } = useFleetCosts(selectedId, fuelSummary, maintenance);
  resetCostsRef.current = resetCosts;
  costsLazyLoadRef.current = onCostsLazyLoad;

  // ── Form modals ───────────────────────────────────────────
  const modalRef = useRef<ModalMode>('none');
  const {
    modal, setModal,
    vehicleForm, setVehicleForm, maintForm, setMaintForm,
    fuelForm, setFuelForm, inspectionForm, setInspectionForm,
    editingFuelId, editingMaintenanceId, editingInspectionId,
    setEditingFuelId, setEditingMaintenanceId, setEditingInspectionId,
    saving, isDirtyAny, drafts: { v, m, f, i },
    handleSaveVehicle, handleSaveMaintenance, handleSaveFuel, handleSaveInspection,
    activeSaveHandler, activeCancelHandler,
  } = useFleetForms({
    selectedId,
    onVehicleSaved: () => {
      if (modalRef.current === 'edit_vehicle' && selectedId != null) fetchDetail(selectedId);
      fetchVehicles({ silent: true });
    },
    onMaintenanceSaved: () => { if (selectedId != null) fetchDetail(selectedId); },
    onFuelSaved: (odometerChanged) => {
      if (selectedId == null) return;
      fetchFuelLogs(selectedId);
      if (odometerChanged) fetchDetail(selectedId);
    },
    onInspectionSaved: (mileageChanged) => {
      if (selectedId == null) return;
      fetchInspections(selectedId);
      if (mileageChanged) fetchDetail(selectedId);
    },
  });
  modalRef.current = modal;

  // ── Delete / archive actions ──────────────────────────────
  const {
    deletingVehicleId, setDeletingVehicleId, isDeleting,
    handleDeleteVehicle, handleArchiveVehicle, handleUnarchiveVehicle,
    deletingFuel, setDeletingFuel, handleDeleteFuel, handleBulkDeleteFuel,
    deletingMaintenance, setDeletingMaintenance, handleDeleteMaintenance,
    deletingInspection, setDeletingInspection, handleDeleteInspection,
  } = useFleetDeleteActions({
    selectedId, setSelectedId,
    fetchDetail, fetchFuelLogs, fetchInspections, fetchVehicles, clearDetail,
  });

  // ── Personnel actions ─────────────────────────────────────
  const {
    handleAssignVehicle, handleUnassignVehicle,
    handleAddPersonnelNote, handleDeletePersonnelNote, handleRefreshPersonnel,
  } = useFleetPersonnelActions({
    selectedId, fetchDetail, fetchVehicles, fetchPersonnel, fetchAssignments, personnelData,
  });

  // ── Pre-trip modal ────────────────────────────────────────
  const [showPretripModal, setShowPretripModal] = useState(false);

  // ── Computed stats ────────────────────────────────────────
  const needsService = vehicles.filter(v => {
    if (!v.next_service_due) return false;
    return parseTimestamp(v.next_service_due) <= new Date();
  }).length;
  const registrationExpiring = vehicles.filter(v => {
    if (!v.registration_expiry) return false;
    const exp = parseTimestamp(v.registration_expiry);
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    return exp <= thirtyDays;
  }).length;
  const insuranceExpiring = vehicles.filter(v => {
    if (!v.insurance_expiry) return false;
    const exp = parseTimestamp(v.insurance_expiry);
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    return exp <= thirtyDays;
  }).length;
  const assignedVehicles = vehicles.filter(v => v.assigned_unit_call_sign).length;

  const selectedVehicle = detail;

  // ── Modal openers ─────────────────────────────────────────
  const openNewVehicle = () => { setVehicleForm(EMPTY_VEHICLE_FORM); setModal('new_vehicle'); };
  const openEditVehicle = () => {
    if (!detail) return;
    setVehicleForm({
      vehicle_number: detail.vehicle_number || '', make: detail.make || '', model: detail.model || '',
      year: detail.year ? String(detail.year) : '', color: detail.color || '', vin: detail.vin || '',
      plate_number: detail.plate_number || '', plate_state: detail.plate_state || '',
      status: detail.status, current_mileage: detail.current_mileage ? String(detail.current_mileage) : '',
      next_service_mileage: detail.next_service_mileage ? String(detail.next_service_mileage) : '',
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
    const last: any = Array.isArray(fuelLogs) && fuelLogs.length ? fuelLogs[0] : null;
    setFuelForm({
      ...EMPTY_FUEL_FORM,
      fuel_date: nowLocalISO(),
      odometer_reading: detail?.current_mileage ? String(detail.current_mileage) : '',
      ...(last ? {
        fuel_type: (last.fuel_type as FuelType) || 'regular',
        station: last.station ?? '',
        payment_method: last.payment_method ?? '',
        driver_name: last.driver_name ?? '',
        location: last.location ?? '',
      } : {}),
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
  const openEditFuel = (log: FleetFuelLog) => {
    setFuelForm({
      fuel_date: toDatetimeLocal(log.fuel_date),
      gallons: log.gallons != null ? String(log.gallons) : '',
      cost_per_gallon: log.cost_per_gallon != null ? String(log.cost_per_gallon) : '',
      total_cost: log.total_cost != null ? String(log.total_cost) : '',
      odometer_reading: (log as any).odometer != null ? String((log as any).odometer)
        : (log.odometer_reading != null ? String(log.odometer_reading) : ''),
      fuel_type: log.fuel_type,
      station: log.station || '',
      notes: log.notes || '',
      is_full_tank: (log as any).is_full_tank == null ? true : !!(log as any).is_full_tank,
      payment_method: (log as any).payment_method || '',
      driver_name: (log as any).driver_name || '',
      location: (log as any).location || '',
    });
    setEditingFuelId(log.id);
    setModal('edit_fuel');
  };
  const openEditMaintenance = (record: FleetMaintenance) => {
    setMaintForm({
      type: record.type || '',
      description: record.description || '',
      mileage_at_service: record.mileage_at_service != null ? String(record.mileage_at_service) : '',
      cost: record.cost != null ? String(record.cost) : '',
      labor_cost: record.labor_cost != null ? String(record.labor_cost) : '',
      vendor: record.vendor || '',
      performed_by: record.performed_by || '',
      performed_at: toDatetimeLocal(record.performed_at),
      next_due_date: record.next_due_date ? toDatetimeLocal(record.next_due_date) : '',
      next_due_mileage: (record as any).next_due_mileage != null ? String((record as any).next_due_mileage) : '',
      service_tasks: record.service_tasks || '',
      notes: (record as any).notes || '',
    });
    setEditingMaintenanceId(record.id);
    setModal('edit_maintenance');
  };
  const openEditInspection = (inspection: FleetInspection) => {
    const rawItems = Array.isArray(inspection.items) ? inspection.items : [];
    const items = rawItems.map((i: any) => ({
      category: i.category ?? 'FIELD',
      item: i.item ?? i.label ?? '',
      status: i.status ?? (i.result === 'fail' ? 'fail' : 'pass'),
      notes: i.notes ?? i.note ?? '',
    }));
    setInspectionForm({
      inspection_type: inspection.inspection_type ?? 'pre_trip',
      inspector_name: inspection.inspector_name ?? '',
      inspection_date: toDatetimeLocal(inspection.inspection_date),
      mileage: inspection.mileage != null ? String(inspection.mileage) : '',
      overall_result: inspection.overall_result ?? 'pass',
      items,
      notes: inspection.notes || '',
    });
    setEditingInspectionId(inspection.id);
    setModal('edit_inspection');
  };

  // ── Right-click context menu for vehicle list rows ────────
  const buildVehicleMenu = useCallback((vehicle: FleetVehicle): ContextMenuItem[] => {
    const label = `${vehicle.vehicle_number}${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).length ? ' — ' + [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') : ''}`;
    return [
      cm.action('Open vehicle', () => setSelectedId(vehicle.id), { icon: <Eye size={12} /> }),
      cm.separator(),
      cm.copy('Copy unit #', vehicle.vehicle_number),
      ...(vehicle.plate_number ? [cm.copy('Copy plate', vehicle.plate_number, <Tag size={12} />)] : []),
      ...(vehicle.vin ? [cm.copy('Copy VIN', vehicle.vin)] : []),
      cm.copyId(vehicle.id),
      ...(isAdmin && !showArchived
        ? [cm.separator(), cm.action('Delete', () => setDeletingVehicleId(vehicle.id), { danger: true, icon: <Trash2 size={12} /> })]
        : []),
    ];
  }, [cm, isAdmin, showArchived, setDeletingVehicleId]);

  // ── Side effects ──────────────────────────────────────────
  useEffect(() => { document.title = 'Fleet Management — RMPG Flex'; }, []);

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full animate-fade-in bg-surface-base">
      <UnsavedChangesGuard hasUnsavedChanges={isDirtyAny} />
      <FloatingSaveBar visible={isDirtyAny} onSave={activeSaveHandler} onCancel={activeCancelHandler} isSaving={saving} saveLabel="Save" />

      {/* ── Header ── */}
      <div className="flex-shrink-0 border-b border-rmpg-700 bg-surface-sunken">
        <PanelTitleBar title="FLEET MANAGEMENT" icon={Car}>
          <RmpgLogo height={16} iconOnly />
          <span className="toolbar-separator" />
          <div className="flex items-center gap-2 text-[10px] font-mono text-rmpg-400 mr-3">
            <Car className="w-3 h-3" />
            <span>Total: <strong className="text-rmpg-100">{vehicles.length}</strong></span>
            <span className="text-rmpg-600">|</span>
            <span>Assigned: <strong className="text-amber-400">{assignedVehicles}</strong></span>
          </div>
          <button type="button"
            className={`toolbar-btn ${showArchived ? 'text-amber-400 border-amber-600/50' : ''}`}
            onClick={() => { setShowArchived(!showArchived); setSelectedId(null); clearDetail(); }}
          >
            <Archive className="w-3 h-3" /> {showArchived ? 'Viewing Archives' : 'Show Archives'}
          </button>
          {!showArchived && (
            <>
              <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={openNewVehicle}>
                <Plus className="w-3 h-3" /> New Vehicle
              </button>
              {selectedVehicle && (
                <button type="button" className="toolbar-btn" onClick={() => setShowPretripModal(true)}>
                  <CheckCircle className="w-3 h-3" /> Pre-Trip
                </button>
              )}
              {selectedVehicle && (
                <button type="button" className="toolbar-btn" disabled={costPerMileLoading} onClick={() => loadCostPerMile(selectedVehicle.id)}>
                  <Gauge className="w-3 h-3" /> {costPerMileLoading ? 'Loading…' : 'Cost/Mi'}
                </button>
              )}
            </>
          )}
          <button type="button" className="toolbar-btn" onClick={() => navigate('/fleet/dashboard')} title="Fleet Dashboard">
            <LayoutDashboard className="w-3 h-3" /> Dashboard
          </button>
          <button type="button" className="toolbar-btn" onClick={() => navigate('/fleet/reports')} title="Daily Patrol Reports Archive">
            <Calendar className="w-3 h-3" /> Daily Reports
          </button>
          {isAdmin && (
            <button type="button" className="toolbar-btn" onClick={() => navigate('/admin?tab=fleetio_health')} title="Fleet.io Sync Health">
              <Activity className="w-3 h-3" /> Sync Health
            </button>
          )}
          <button
            type="button"
            className="toolbar-btn"
            disabled={filtered.length === 0}
            onClick={() => downloadTextFile('fleet.csv', fleetListToCsv(filtered.map((v) => ({
              unit: v.vehicle_number,
              status: v.status,
              make: v.make ?? '',
              model: v.model ?? '',
              plate: v.plate_number ?? '',
            }))))}
          >CSV</button>
          <ExportButton exportUrl="/api/fleet/export/csv" exportFilename="fleet.csv" />
          <PrintButton />
        </PanelTitleBar>

        <FleetStatsBar
          vehicles={vehicles}
          statusCounts={statusCounts}
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          avgMileage={avgMileage}
          fleetAnalytics={fleetAnalytics}
          needsService={needsService}
          registrationExpiring={registrationExpiring}
          insuranceExpiring={insuranceExpiring}
        />
      </div>

      {/* ── Split layout ── */}
      <div className="flex flex-1 overflow-hidden">
        <FleetVehicleListPanel
          vehicles={vehicles}
          filtered={filtered}
          vehicleTotal={vehicleTotal}
          selectedId={selectedId}
          isMobile={isMobile}
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onSelect={setSelectedId}
          onContextMenu={(e, vehicle) => openMenu(e, buildVehicleMenu(vehicle))}
        />

        {!isMobile && <div className="flex-shrink-0 w-px bg-rmpg-700" />}

        {/* ── Right panel ── */}
        <div className={`${isMobile ? (selectedId ? 'w-full' : 'hidden') : 'flex-1'} flex flex-col overflow-hidden bg-surface-raised`}>
          {selectedId == null || !detail ? (
            <FleetDashboardViews
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onWorkOrdersVehicleFilter={setWorkOrdersVehicleFilter}
              fleetAnalytics={fleetAnalytics}
              fleetAnalyticsLoading={fleetAnalyticsLoading}
              onFetchFleetAnalytics={fetchFleetAnalytics}
              vehicles={vehicles}
              vehicleNumberById={vehicleNumberById}
              workOrdersVehicleFilter={workOrdersVehicleFilter}
              onSelectVehicle={(id) => { setSelectedId(id); fetchDetail(id); }}
            />
          ) : (
            <>
              {isMobile && (
                <button type="button" onClick={() => { setSelectedId(null); clearDetail(); }} className="text-rmpg-400 hover:text-rmpg-100 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 border-b border-rmpg-700/50 bg-surface-sunken">
                  ◀ Back to Vehicles
                </button>
              )}
              <FleetDetailPanel
                data={{
                  detail,
                  maintenance,
                  fuelLogs,
                  fuelSummary,
                  inspections,
                  assignments,
                  analytics,
                  analyticsLoading,
                  personnelData,
                  personnelLoading,
                  gpsMileage,
                  gpsMileageLoading,
                  isArchived: showArchived,
                }}
                costs={{
                  loans,
                  insurancePolicies,
                  accessories,
                  utilities,
                  otherCosts,
                  summary: costSummary,
                  subTab: costSubTab,
                  onSubTabChange: setCostSubTab,
                  onAdd: handleAddCost,
                  onEdit: handleEditCost,
                  onDelete: handleDeleteCost,
                  onSaveBudgets: handleSaveBudgets,
                }}
                actions={{
                  onEditVehicle: openEditVehicle,
                  onLogMaintenance: openLogMaintenance,
                  onLogFuel: openLogFuel,
                  onNewInspection: openNewInspection,
                  onViewAllWorkOrders: () => {
                    setWorkOrdersVehicleFilter(Number(detail.id));
                    setSelectedId(null);
                    clearDetail();
                    setViewMode('work_orders');
                  },
                  onEditFuel: openEditFuel,
                  onDeleteFuel: (log) => setDeletingFuel(log),
                  onBulkDeleteFuel: handleBulkDeleteFuel,
                  onEditMaintenance: openEditMaintenance,
                  onDeleteMaintenance: (record) => setDeletingMaintenance(record),
                  onEditInspection: openEditInspection,
                  onDeleteInspection: (insp) => setDeletingInspection(insp),
                  onAnalyticsPeriodChange: (p) => { if (selectedId) fetchVehicleAnalytics(selectedId, p); },
                  onAssignVehicle: handleAssignVehicle,
                  onUnassignVehicle: handleUnassignVehicle,
                  onAddPersonnelNote: handleAddPersonnelNote,
                  onDeletePersonnelNote: handleDeletePersonnelNote,
                  onRefreshPersonnel: handleRefreshPersonnel,
                  onArchiveVehicle: handleArchiveVehicle,
                  onUnarchiveVehicle: handleUnarchiveVehicle,
                  onDeleteVehicle: () => setDeletingVehicleId(selectedId),
                  onFetchGpsMileage: fetchGpsMileage,
                  onSyncGpsMileage: syncGpsMileage,
                  onClose: () => { setSelectedId(null); clearDetail(); },
                }}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />
            </>
          )}
        </div>
      </div>

      {/* ── Form modals ── */}
      <VehicleFormModal
        isOpen={modal === 'new_vehicle' || modal === 'edit_vehicle'}
        mode={modal === 'edit_vehicle' ? 'edit_vehicle' : 'new_vehicle'}
        form={vehicleForm}
        onChange={setVehicleForm}
        onSave={handleSaveVehicle}
        onClose={() => { v.clearDraft(); setModal('none'); }}
        saving={saving}
        isDirty={v.isDirty}
        draftRestored={v.wasRestored}
        onDiscardDraft={v.clearDraft}
      />
      <MaintenanceFormModal
        isOpen={modal === 'log_maintenance' || modal === 'edit_maintenance'}
        mode={modal === 'edit_maintenance' ? 'edit' : 'create'}
        form={maintForm}
        onChange={setMaintForm}
        onSave={handleSaveMaintenance}
        onClose={() => { m.clearDraft(); setModal('none'); setEditingMaintenanceId(null); }}
        saving={saving}
        isDirty={m.isDirty}
        draftRestored={m.wasRestored}
        onDiscardDraft={m.clearDraft}
      />
      <FuelLogModal
        isOpen={modal === 'log_fuel' || modal === 'edit_fuel'}
        mode={modal === 'edit_fuel' ? 'edit' : 'create'}
        form={fuelForm}
        onChange={setFuelForm}
        onSave={handleSaveFuel}
        onClose={() => { f.clearDraft(); setModal('none'); setEditingFuelId(null); }}
        saving={saving}
        isDirty={f.isDirty}
        draftRestored={f.wasRestored}
        onDiscardDraft={f.clearDraft}
      />
      <InspectionFormModal
        isOpen={modal === 'new_inspection' || modal === 'edit_inspection'}
        mode={modal === 'edit_inspection' ? 'edit' : 'create'}
        form={inspectionForm}
        onChange={setInspectionForm}
        onSave={handleSaveInspection}
        onClose={() => { i.clearDraft(); setModal('none'); setEditingInspectionId(null); }}
        saving={saving}
        isDirty={i.isDirty}
        draftRestored={i.wasRestored}
        onDiscardDraft={i.clearDraft}
      />
      <FleetCostFormModal
        isOpen={costModalOpen}
        category={costCategory}
        mode={costMode}
        initial={costInitial}
        recordId={editingCostId}
        onSave={handleSaveCost}
        onClose={closeCostModal}
        saving={savingCost}
      />

      {/* ── Confirm dialogs ── */}
      <ConfirmDialog
        isOpen={deletingCost !== null}
        onClose={cancelDeleteCost}
        onConfirm={confirmDeleteCost}
        title="Delete Cost Entry"
        message={`Delete this ${deletingCost?.category} entry? This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
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
      <ConfirmDialog
        isOpen={deletingFuel !== null}
        onClose={() => setDeletingFuel(null)}
        onConfirm={handleDeleteFuel}
        title="Delete Fuel Log"
        message={`Delete the fuel log for ${deletingFuel?.gallons?.toFixed(3) || ''} gallons on ${deletingFuel?.fuel_date ? parseTimestamp(deletingFuel.fuel_date).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : ''}? This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
      <ConfirmDialog
        isOpen={deletingMaintenance !== null}
        onClose={() => setDeletingMaintenance(null)}
        onConfirm={handleDeleteMaintenance}
        title="Delete Maintenance Record"
        message={`Delete the ${toDisplayLabel(deletingMaintenance?.type).toUpperCase() || ''} record: "${deletingMaintenance?.description || ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
      <ConfirmDialog
        isOpen={deletingInspection !== null}
        onClose={() => setDeletingInspection(null)}
        onConfirm={handleDeleteInspection}
        title="Delete Inspection"
        message={`Delete the ${toDisplayLabel(deletingInspection?.inspection_type) || ''} inspection from ${deletingInspection?.inspection_date ? parseTimestamp(deletingInspection.inspection_date).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : ''}? This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={isDeleting}
      />

      {/* ── Pre-trip modal ── */}
      <FleetPretripModal
        vehicle={selectedVehicle}
        isOpen={showPretripModal}
        onClose={() => setShowPretripModal(false)}
        onSaved={() => {
          if (selectedId != null) fetchDetail(selectedId);
          fetchVehicles({ silent: true });
        }}
      />

      {/* ── Cost/mile popover ── */}
      {costPerMile && (
        <div className="fixed bottom-16 right-4 left-4 md:left-auto z-40 bg-surface-raised border border-rmpg-600 rounded p-4 w-auto md:w-[300px] shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-rmpg-100">Cost Analysis: {costPerMile.vehicle_number}</h4>
            <button type="button" onClick={clearCostPerMile} className="text-rmpg-400 hover:text-rmpg-100">&times;</button>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-rmpg-400">Fuel Cost</div>
              <div className="text-rmpg-100 font-mono">${costPerMile.total_fuel_cost?.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-rmpg-400">Maint Cost</div>
              <div className="text-rmpg-100 font-mono">${costPerMile.total_maintenance_cost?.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-rmpg-400">Total Cost</div>
              <div className="text-green-400 font-mono font-bold">${costPerMile.total_cost?.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-rmpg-400">Cost/Mile</div>
              <div className="text-amber-400 font-mono font-bold">{costPerMile.cost_per_mile != null ? `$${costPerMile.cost_per_mile.toFixed(2)}` : 'N/A'}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
