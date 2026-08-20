import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { parseTimestamp } from '../../utils/dateUtils';
import { apiFetch } from '../../hooks/useApi';
import {
  Car, Fuel, ClipboardCheck, Radio, BarChart3, Settings, Wrench, X, Clock, Users,
  Archive, RotateCcw, Trash2, Printer, ChevronDown, Circle, AlertTriangle, AlertOctagon,
  DollarSign, Pencil, Tag, Video, CreditCard, MapPin, RefreshCw,
} from 'lucide-react';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import { useMenuActions } from '../../utils/contextMenuActions';
import type {
  FleetVehicle, FleetMaintenance, FleetFuelLog, FleetFuelSummary,
  FleetInspection, FleetAssignment, FleetAnalytics, FleetVehicleStatus,
  FleetPersonnelData,
} from '../../types';
import FleetRouteOptimizer from './components/FleetRouteOptimizer';
import FleetOptimizationHistoryCard from './components/FleetOptimizationHistoryCard';
import FleetOverviewTab from './tabs/FleetOverviewTab';
import FleetFuelTab from './tabs/FleetFuelTab';
import FleetInspectionsTab from './tabs/FleetInspectionsTab';
import FleetAssignmentsTab from './tabs/FleetAssignmentsTab';
import FleetPersonnelTab from './tabs/FleetPersonnelTab';
import FleetAnalyticsTab from './tabs/FleetAnalyticsTab';
import FleetTiresTab from './tabs/FleetTiresTab';
import FleetDamageTab from './tabs/FleetDamageTab';
import FleetRecallsTab from './tabs/FleetRecallsTab';
import FleetCostsTab from './tabs/FleetCostsTab';
import FleetDashCamTab from './tabs/FleetDashCamTab';
import FleetFuelCardsTab from './tabs/FleetFuelCardsTab';
import FleetExpensesTab from './tabs/FleetExpensesTab';
import type { CostCategory } from './modals/FleetCostFormModal';
import type { FleetLoan, FleetInsurancePolicy, FleetAccessory, FleetUtilityCost, FleetOtherCost, FleetCostSummary } from '../../types';
import { formatMilitary } from './utils/fleetFormatters';
import { generateFleetFuelReport } from './utils/fleetFuelReport';
import { generateFlaggedAuditPdf } from './utils/flaggedAuditPdf';
import { generateFleetVehicleSummaryPdf } from './utils/fleetVehicleSummaryPdf';
import { generateFleetMaintenanceHistoryPdf } from './utils/fleetMaintenanceHistoryPdf';
import PrintRecordButton from '../../components/PrintRecordButton';
import EmailedDocuments from '../../components/EmailedDocuments';
import SpillmanModuleGroup from '../../components/spillman/SpillmanModuleGroup';
import type { ModuleGroupSpec } from '../../components/spillman/SpillmanModuleGroup';

export type DetailTab = 'overview' | 'fuel' | 'costs' | 'inspections' | 'assignments' | 'personnel' | 'analytics' | 'tires' | 'damage' | 'recalls' | 'dashcam' | 'fuel_cards' | 'expenses' | 'routes';
export type CostSubTab = 'loan' | 'insurance' | 'accessory' | 'utility' | 'other';

const STATUS_LED: Record<FleetVehicleStatus, string> = {
  in_service: 'led-dot led-green', maintenance: 'led-dot led-amber',
  out_of_service: 'led-dot led-red', retired: 'led-dot led-off',
};
const STATUS_LABEL: Record<FleetVehicleStatus, string> = {
  in_service: 'In Service', maintenance: 'Maintenance',
  out_of_service: 'Out of Service', retired: 'Retired',
};
const STATUS_COLOR: Record<FleetVehicleStatus, string> = {
  in_service: 'var(--sev-ok)', maintenance: 'var(--sev-warn)',
  out_of_service: 'var(--sev-critical)', retired: 'var(--text-muted)',
};

function getExpiryStatus(dateStr?: string): 'ok' | 'expiring' | 'expired' | 'none' {
  if (!dateStr) return 'none';
  // parseTimestamp reads naive timestamps as UTC and date-only strings as local
  const exp = parseTimestamp(dateStr);
  const now = new Date();
  if (exp < now) return 'expired';
  const thirtyDays = new Date();
  thirtyDays.setDate(thirtyDays.getDate() + 30);
  if (exp <= thirtyDays) return 'expiring';
  return 'ok';
}

const TABS: { key: DetailTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'overview', label: 'Overview', icon: Car },
  { key: 'fuel', label: 'Fuel', icon: Fuel },
  { key: 'costs', label: 'Costs', icon: DollarSign },
  { key: 'inspections', label: 'Inspections', icon: ClipboardCheck },
  { key: 'assignments', label: 'Assignments', icon: Radio },
  { key: 'personnel', label: 'Personnel', icon: Users },
  { key: 'tires', label: 'Tires', icon: Circle },
  { key: 'damage', label: 'Damage', icon: AlertTriangle },
  { key: 'recalls', label: 'Recalls', icon: AlertOctagon },
  { key: 'analytics', label: 'Analytics', icon: BarChart3 },
  { key: 'dashcam', label: 'Dash Cam', icon: Video },
  { key: 'fuel_cards', label: 'Fuel Cards', icon: CreditCard },
];

/** Read-only vehicle record data the panel renders. */
export interface FleetDetailData {
  detail: FleetVehicle;
  maintenance: FleetMaintenance[];
  fuelLogs: FleetFuelLog[];
  fuelSummary: FleetFuelSummary | null;
  inspections: FleetInspection[];
  assignments: FleetAssignment[];
  analytics: FleetAnalytics | null;
  analyticsLoading: boolean;
  personnelData: FleetPersonnelData | null;
  personnelLoading: boolean;
  gpsMileage: any;
  gpsMileageLoading: boolean;
  isArchived: boolean;
}

/** Cost-of-ownership tab (Loan / Insurance / Accessory / Utility / Other) — data + its own controls. */
export interface FleetDetailCosts {
  loans: FleetLoan[];
  insurancePolicies: FleetInsurancePolicy[];
  accessories: FleetAccessory[];
  utilities: FleetUtilityCost[];
  otherCosts: FleetOtherCost[];
  summary: FleetCostSummary | null;
  subTab: CostSubTab;
  onSubTabChange: (t: CostSubTab) => void;
  onAdd: (category: CostCategory) => void;
  onEdit: (category: CostCategory, record: any) => void;
  onDelete: (category: CostCategory, record: any) => void;
  onSaveBudgets?: (rows: { category: string; monthly_budget: number }[]) => Promise<void>;
}

/** Everything the panel can ask the page to do. */
export interface FleetDetailActions {
  onEditVehicle: () => void;
  onLogMaintenance: () => void;
  onLogFuel: () => void;
  onNewInspection: () => void;
  onViewAllWorkOrders: () => void;
  onEditFuel?: (log: FleetFuelLog) => void;
  onDeleteFuel?: (log: FleetFuelLog) => void;
  onBulkDeleteFuel?: (logs: FleetFuelLog[]) => void;
  onEditMaintenance?: (record: FleetMaintenance) => void;
  onDeleteMaintenance?: (record: FleetMaintenance) => void;
  onEditInspection?: (inspection: FleetInspection) => void;
  onDeleteInspection?: (inspection: FleetInspection) => void;
  onAnalyticsPeriodChange?: (period: string) => void;
  onAssignVehicle: (unitId: string) => void;
  onUnassignVehicle: () => void;
  onAddPersonnelNote: (note: string) => void;
  onDeletePersonnelNote: (noteId: string) => void;
  onRefreshPersonnel: () => void;
  onArchiveVehicle: () => void;
  onUnarchiveVehicle: () => void;
  onDeleteVehicle: () => void;
  onFetchGpsMileage: (days?: number) => void;
  onSyncGpsMileage: () => void;
  onClose: () => void;
}

interface Props {
  data: FleetDetailData;
  costs: FleetDetailCosts;
  actions: FleetDetailActions;
  // The panel's own control state — not data, not an action.
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
}

// fleet_maintenance rows carry the real DB columns (type/performed_at/mileage_at_service),
// not the legacy service_type/service_date/odometer_reading names the PDF's
// FleetMaintenanceEntry contract uses — map field-by-field rather than passing rows through.
export function mapMaintenanceLogsForPdf(maintenance: FleetMaintenance[]) {
  return maintenance.map((m: any) => ({
    service_date: m.performed_at,
    service_type: m.type,
    description: m.description,
    cost: m.cost,
    odometer_reading: m.mileage_at_service,
    vendor: m.vendor,
    labor_cost: m.labor_cost,
    service_tasks: m.service_tasks,
  }));
}

// ── Fleet Print Menu (dropdown to select report type) ──
function FleetPrintMenu({ detail, fuelLogs, maintenance, fuelSummary }: {
  detail: FleetVehicle;
  fuelLogs: FleetFuelLog[];
  maintenance: FleetMaintenance[];
  fuelSummary?: FleetFuelSummary | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const reportOptions = [
    { key: 'status', label: 'Vehicle Status' },
    { key: 'fuel_logs', label: 'Fuel Logs' },
    { key: 'maintenance', label: 'Maintenance' },
    { key: 'mileage_summary', label: 'Mileage / Day' },
    { key: 'vehicle_summary', label: 'Vehicle Summary PDF' },
    { key: 'maintenance_history', label: 'Maintenance History PDF' },
  ] as const;

  const buildRecordData = (reportType: string) => ({
    ...detail,
    report_type: reportType,
    fuel_logs: fuelLogs.map((f: any) => ({
      fuel_date: f.fuel_date,
      gallons: f.gallons,
      total_cost: f.total_cost,
      cost_per_gallon: f.cost_per_gallon,
      odometer_reading: f.odometer_reading,
      station: f.station,
      fuel_type: f.fuel_type,
      distance: f.distance,
      efficiency: f.efficiency,
      mpg: f.mpg,
      calc_distance: f.calc_distance,
      cost_per_mile: f.cost_per_mile,
      running_avg_mpg: f.running_avg_mpg,
    })),
    fuel_summary: fuelSummary ? {
      total_gallons: fuelSummary.total_gallons,
      total_cost: fuelSummary.total_cost,
      avg_mpg: fuelSummary.avg_mpg,
      avg_cost_per_gallon: fuelSummary.avg_cost_per_gallon,
      best_mpg: fuelSummary.best_mpg,
      worst_mpg: fuelSummary.worst_mpg,
      total_distance: fuelSummary.total_distance,
      cost_per_mile: fuelSummary.cost_per_mile,
      fuel_cost_per_day: fuelSummary.fuel_cost_per_day,
    } : undefined,
    maintenance_logs: mapMaintenanceLogsForPdf(maintenance),
  });

  const handleDirectPdf = async (key: string) => {
    if (key === 'vehicle_summary') {
      // Fetch the full cost summary from the server (all 7 categories)
      let costTotals: { fuel?: number; maintenance?: number; expenses?: number; loans?: number; insurance?: number; accessories?: number; utilities?: number } = {};
      try {
        const costData = await apiFetch<{
          categories: { fuel: number; maintenance: number; loans: number; insurance: number; accessories: number; utilities: number; expenses: number };
        }>(`/fleet/${detail.id}/cost-summary`);
        if (costData?.categories) {
          costTotals = costData.categories;
        }
      } catch {
        // Fallback to locally available fuel + maintenance data
        const fuelTotal = fuelSummary?.total_cost ?? fuelLogs.reduce((s, f) => s + (Number(f.total_cost) || 0), 0);
        const maintenanceTotal = maintenance.reduce((s, m) => s + (Number(m.cost) || 0), 0);
        costTotals = { fuel: fuelTotal, maintenance: maintenanceTotal };
      }
      generateFleetVehicleSummaryPdf({
        vehicle: detail,
        assignedUnit: detail.assigned_unit_call_sign || undefined,
        costTotals,
        recentMaintenance: maintenance.slice(0, 5),
      });
    } else if (key === 'maintenance_history') {
      generateFleetMaintenanceHistoryPdf({ vehicle: detail, records: maintenance });
    }
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="toolbar-btn" onClick={() => setOpen(!open)}>
        <Printer className="w-3 h-3" /> Print <ChevronDown className="w-2.5 h-2.5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-50 bg-rmpg-700 border border-rmpg-500 rounded-sm shadow-lg min-w-[180px]">
          {reportOptions.map((opt) => (
            opt.key === 'vehicle_summary' || opt.key === 'maintenance_history' ? (
              <button
                key={opt.key}
                type="button"
                onClick={() => handleDirectPdf(opt.key)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-rmpg-600 text-white"
              >
                {opt.label}
              </button>
            ) : (
              <PrintRecordButton
                key={opt.key}
                recordType="fleet"
                recordData={buildRecordData(opt.key)}
                identifier={`${detail.vehicle_number}_${opt.key}`}
                entityType="fleet"
                entityId={detail.id}
                label={opt.label}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-rmpg-600 border-none rounded-none"
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}

export default function FleetDetailPanel({ data, costs, actions, activeTab, onTabChange }: Props) {
  // Destructured back to the original identifiers so the render tree below is unchanged.
  const {
    detail, maintenance, fuelLogs, fuelSummary, inspections, assignments,
    analytics, analyticsLoading, personnelData, personnelLoading,
    gpsMileage, gpsMileageLoading, isArchived,
  } = data;
  const {
    loans, insurancePolicies, accessories, utilities, otherCosts,
    summary: costSummary, subTab: costSubTab, onSubTabChange: onCostSubTabChange,
    onAdd: onAddCost, onEdit: onEditCost, onDelete: onDeleteCost, onSaveBudgets,
  } = costs;
  const {
    onEditVehicle, onLogMaintenance, onLogFuel, onNewInspection, onViewAllWorkOrders,
    onEditFuel, onDeleteFuel, onBulkDeleteFuel,
    onEditMaintenance, onDeleteMaintenance, onEditInspection, onDeleteInspection,
    onAnalyticsPeriodChange,
    onAssignVehicle, onUnassignVehicle, onAddPersonnelNote, onDeletePersonnelNote, onRefreshPersonnel,
    onArchiveVehicle, onUnarchiveVehicle, onDeleteVehicle,
    onFetchGpsMileage, onSyncGpsMileage, onClose,
  } = actions;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin'; // Admin God Mode

  // Right-click context menu for the vehicle header (acts on this record).
  const { openMenu } = useContextMenu();
  const cm = useMenuActions();
  const buildVehicleMenu = (): ContextMenuItem[] => [
    ...(!isArchived ? [cm.action('Edit vehicle', onEditVehicle, { icon: <Pencil size={12} /> })] : []),
    cm.separator(),
    cm.copy('Copy unit #', detail.vehicle_number),
    ...(detail.plate_number ? [cm.copy('Copy plate', detail.plate_number, <Tag size={12} />)] : []),
    ...(detail.vin ? [cm.copy('Copy VIN', detail.vin)] : []),
    cm.copyId(detail.id),
    ...((isArchived || isAdmin)
      ? [cm.separator(), cm.action('Delete', onDeleteVehicle, { danger: true, icon: <Trash2 size={12} /> })]
      : []),
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Detail header */}
      <div
        className="flex-shrink-0 px-4 py-3 border-b border-rmpg-700 flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-0 bg-surface-sunken transition-colors duration-200"
        onContextMenu={(e) => openMenu(e, buildVehicleMenu())}
      >
        <div>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-sm flex items-center justify-center border ${
              detail.status === 'in_service' ? 'bg-green-900/30 border-green-700/50' :
              detail.status === 'maintenance' ? 'bg-amber-900/30 border-amber-700/50' :
              detail.status === 'out_of_service' ? 'bg-red-900/30 border-red-700/50' :
              'bg-rmpg-800 border-rmpg-700'
            }`}>
              <Car className="w-5 h-5" style={{ color: STATUS_COLOR[detail.status] }} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-rmpg-100 font-mono">{detail.vehicle_number}</h2>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-rmpg-300">
                <span>{[detail.year, detail.make, detail.model].filter(Boolean).join(' ')}</span>
                {detail.color && <span className="text-rmpg-500">({detail.color})</span>}
              </div>
            </div>
          </div>

          {/* Status badges row */}
          <div className="flex gap-2 mt-2.5">
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] font-bold uppercase border ${
              detail.status === 'in_service' ? 'bg-green-900/50 text-green-400 border-green-700/50'
                : detail.status === 'maintenance' ? 'bg-amber-900/50 text-amber-400 border-amber-700/50'
                : detail.status === 'out_of_service' ? 'bg-red-900/50 text-red-400 border-red-700/50'
                : 'bg-rmpg-800 text-rmpg-400 border-rmpg-600'
            }`}>
              <span className={STATUS_LED[detail.status]} />
              {STATUS_LABEL[detail.status]}
            </span>
            {detail.assigned_unit_call_sign && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold bg-amber-900/30 text-amber-400 border border-amber-700/40">
                <Radio className="w-3 h-3" /> {detail.assigned_unit_call_sign}
              </span>
            )}
            {maintenance.length > 0 && (
              <span className="px-2 py-0.5 text-[9px] font-bold bg-brand-900/40 text-brand-300 border border-brand-700/50">{maintenance.length} service{maintenance.length !== 1 ? 's' : ''}</span>
            )}
            {getExpiryStatus(detail.registration_expiry) === 'expired' && (
              <span className="px-2 py-0.5 text-[9px] font-bold bg-red-900/50 text-red-400 border border-red-700/50 animate-pulse">REG EXPIRED</span>
            )}
            {getExpiryStatus(detail.insurance_expiry) === 'expired' && (
              <span className="px-2 py-0.5 text-[9px] font-bold bg-red-900/50 text-red-400 border border-red-700/50 animate-pulse">INS EXPIRED</span>
            )}
            {getExpiryStatus(detail.next_service_due) === 'expired' && (
              <span className="px-2 py-0.5 text-[9px] font-bold bg-amber-900/50 text-amber-400 border border-amber-700/50">SERVICE OVERDUE</span>
            )}
            {(() => {
              const nextMi = detail.next_service_mileage;
              const curMi = detail.current_mileage;
              if (nextMi && curMi) {
                const milesLeft = nextMi - curMi;
                if (milesLeft <= 0) return <span className="px-2 py-0.5 text-[9px] font-bold bg-red-900/50 text-red-400 border border-red-700/50 animate-pulse">MILEAGE SERVICE OVERDUE</span>;
                if (milesLeft <= 100) return <span className="px-2 py-0.5 text-[9px] font-bold bg-red-900/50 text-red-400 border border-red-700/50">SERVICE IN {milesLeft} MI</span>;
                if (milesLeft <= 500) return <span className="px-2 py-0.5 text-[9px] font-bold bg-amber-900/50 text-amber-400 border border-amber-700/50">SERVICE IN {milesLeft} MI</span>;
              }
              return null;
            })()}
          </div>

          {/* GPS-derived mileage section */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <button type="button"
              className={`toolbar-btn text-[9px] ${gpsMileageLoading ? 'opacity-50' : ''}`}
              onClick={() => onFetchGpsMileage()}
              disabled={gpsMileageLoading}
              title="Compute GPS-derived mileage from dispatch breadcrumbs">
              <MapPin className="w-3 h-3" />
              {gpsMileageLoading ? 'Computing...' : gpsMileage ? 'GPS Mileage ▼' : 'Get GPS Mileage'}
            </button>
            {gpsMileage && !gpsMileage.error && (
              <>
                <span className="text-[9px] text-rmpg-400 font-mono">
                  <span className="text-green-400 font-bold">{gpsMileage.total_miles?.toFixed(1)}</span> mi
                  ({gpsMileage.valid_segments} segments, {gpsMileage.time_span_hours?.toFixed(0)}h)
                </span>
                {gpsMileage.unit_call_sign && (
                  <span className="text-[9px] text-rmpg-500 font-mono">via {gpsMileage.unit_call_sign}</span>
                )}
                <button type="button"
                  className="toolbar-btn toolbar-btn-primary text-[9px]"
                  onClick={onSyncGpsMileage}
                  disabled={gpsMileageLoading}
                  title="Add GPS-calculated miles to the vehicle odometer">
                  <RefreshCw className="w-3 h-3" /> Sync Odo
                </button>
              </>
            )}
            {gpsMileage?.error && (
              <span className="text-[9px] text-rmpg-500 italic font-mono">{gpsMileage.error}</span>
            )}
          </div>

          {/* Timestamps row */}
          {(detail.created_at || detail.updated_at) && (
            <div className="flex items-center gap-3 mt-2 text-[8px] text-rmpg-600 font-mono">
              <Clock className="w-2.5 h-2.5" />
              {detail.created_at && <span>Created: {formatMilitary(detail.created_at)}</span>}
              {detail.updated_at && <span>Updated: {formatMilitary(detail.updated_at)}</span>}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <FleetPrintMenu detail={detail} fuelLogs={fuelLogs} maintenance={maintenance} fuelSummary={fuelSummary} />
          {!isArchived && (
            <>
              <button type="button" className="toolbar-btn" onClick={onEditVehicle}>
                <Settings className="w-3 h-3" /> Edit
              </button>
              <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={onLogMaintenance}>
                <Wrench className="w-3 h-3" /> Maintenance
              </button>
              {detail.status === 'retired' && (
                <button type="button" className="toolbar-btn text-amber-400 hover:text-amber-300" onClick={onArchiveVehicle} title="Archive this retired vehicle">
                  <Archive className="w-3 h-3" /> Archive
                </button>
              )}
            </>
          )}
          {isArchived && (
            <>
              <button type="button" className="toolbar-btn text-green-400 hover:text-green-300" onClick={onUnarchiveVehicle} title="Unarchive this vehicle">
                <RotateCcw className="w-3 h-3" /> Unarchive
              </button>
              <button type="button" className="toolbar-btn text-red-400 hover:text-red-300" onClick={onDeleteVehicle} title="Permanently delete this vehicle">
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            </>
          )}
          {!isArchived && isAdmin && (
            <button type="button" className="toolbar-btn text-red-400 hover:text-red-300" onClick={onDeleteVehicle} title="Admin: Delete this vehicle">
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          )}
          <button type="button"
            className="p-1 hover:bg-rmpg-700 text-rmpg-400 hover:text-rmpg-100 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50"
            onClick={onClose}
            aria-label="Close vehicle details">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tab Bar — grouped Spillman module strip */}
      <SpillmanModuleGroup
        groups={[
          {
            label: 'Status',
            tone: 'steel',
            tabs: [
              { id: 'overview',   label: 'Overview' },
              { id: 'fuel',       label: 'Fuel' },
              { id: 'fuel_cards', label: 'Fuel Cards' },
            ],
          },
          {
            label: 'Maintenance',
            tone: 'gold',
            tabs: [
              { id: 'inspections', label: 'Inspections' },
              { id: 'tires',       label: 'Tires' },
              { id: 'damage',      label: 'Damage' },
              { id: 'recalls',     label: 'Recalls' },
            ],
          },
          {
            label: 'Personnel & Ops',
            tone: 'neutral',
            tabs: [
              { id: 'assignments', label: 'Assignments' },
              { id: 'personnel',   label: 'Personnel' },
              { id: 'costs',       label: 'Costs' },
            ],
          },
          {
            label: 'Intelligence',
            tone: 'green',
            tabs: [
              { id: 'analytics', label: 'Analytics' },
              { id: 'dashcam',   label: 'Dash Cam' },
              { id: 'routes',    label: 'Routes' },
            ],
          },
        ] as ModuleGroupSpec[]}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as DetailTab)}
      />

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-y-auto min-h-0 scrollbar-dark" role="tabpanel" aria-label={`${activeTab} tab content`}>
        {activeTab === 'overview' && (
          <>
            <FleetOverviewTab detail={detail} maintenance={maintenance} onEditMaintenance={onEditMaintenance} onDeleteMaintenance={onDeleteMaintenance} />
            {/* Emailed Documents (outbound PDFs sent from this record) */}
            <div className="p-2"><EmailedDocuments recordType="fleet" recordId={detail.id} /></div>
          </>
        )}
        {activeTab === 'fuel' && (
          <FleetFuelTab
            fuelLogs={fuelLogs}
            summary={fuelSummary}
            onAddFuel={onLogFuel}
            onEditFuel={onEditFuel}
            onDeleteFuel={onDeleteFuel}
            onBulkDeleteFuel={onBulkDeleteFuel}
            onGenerateReport={() => generateFleetFuelReport({
              vehicle: detail,
              fuelLogs,
              summary: fuelSummary,
            })}
            onGenerateFlaggedAudit={() => generateFlaggedAuditPdf({
              // Client-side filter to just flagged rows — avoids a server
              // round-trip since we already have the full fuel history
              // loaded for this vehicle.
              logs: fuelLogs.filter((l: any) => !!l.flags),
              scopeLabel: `#${detail.vehicle_number} ${[detail.year, detail.make, detail.model].filter(Boolean).join(' ')}`.trim(),
              dateRange: {
                from: fuelLogs[fuelLogs.length - 1]?.fuel_date,
                to:   fuelLogs[0]?.fuel_date,
              },
            })}
          />
        )}
        {activeTab === 'costs' && (
          <FleetCostsTab
            vehicleId={detail.id}
            onViewAllWorkOrders={onViewAllWorkOrders}
            loans={loans}
            insurance={insurancePolicies}
            accessories={accessories}
            utilities={utilities}
            other={otherCosts}
            summary={costSummary}
            subTab={costSubTab}
            onSubTabChange={onCostSubTabChange}
            onAdd={onAddCost}
            onEdit={onEditCost}
            onDelete={onDeleteCost}
            onSaveBudgets={onSaveBudgets}
          />
        )}
        {activeTab === 'inspections' && <FleetInspectionsTab inspections={inspections} onNewInspection={onNewInspection} onEditInspection={onEditInspection} onDeleteInspection={onDeleteInspection} />}
        {activeTab === 'assignments' && <FleetAssignmentsTab assignments={assignments} />}
        {activeTab === 'personnel' && (
          <FleetPersonnelTab
            vehicleId={String(detail.id)}
            personnelData={personnelData}
            assignments={assignments}
            loading={personnelLoading}
            onAssign={onAssignVehicle}
            onUnassign={onUnassignVehicle}
            onAddNote={onAddPersonnelNote}
            onDeleteNote={onDeletePersonnelNote}
            onRefresh={onRefreshPersonnel}
          />
        )}
        {activeTab === 'tires' && <FleetTiresTab vehicleId={detail.id} />}
        {activeTab === 'damage' && <FleetDamageTab vehicleId={detail.id} />}
        {activeTab === 'recalls' && <FleetRecallsTab vehicleId={detail.id} />}
        {activeTab === 'expenses' && <FleetExpensesTab vehicle={detail} canManage={['admin', 'manager', 'supervisor', 'officer'].includes(user?.role || '')} />}
        {activeTab === 'dashcam' && <FleetDashCamTab vehicleId={detail.id} />}
        {activeTab === 'analytics' && (
          <FleetAnalyticsTab analytics={analytics} loading={analyticsLoading} onPeriodChange={onAnalyticsPeriodChange} />
        )}
        {activeTab === 'fuel_cards' && <FleetFuelCardsTab />}
        {activeTab === 'routes' && (
          <div className="p-3 space-y-3">
            <FleetRouteOptimizer
              vehicleId={detail.id}
              unitId={detail.assigned_unit_id ?? null}
              callSign={detail.assigned_unit_call_sign || detail.vehicle_number}
            />
            <FleetOptimizationHistoryCard />
          </div>
        )}
      </div>
    </div>
  );
}
