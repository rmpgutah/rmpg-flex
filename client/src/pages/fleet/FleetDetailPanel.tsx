import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  Car, Fuel, ClipboardCheck, Radio, BarChart3, Settings, Wrench, X, Clock, Users,
  Archive, RotateCcw, Trash2, Printer, ChevronDown, Circle, AlertTriangle, AlertOctagon,
} from 'lucide-react';
import type {
  FleetVehicle, FleetMaintenance, FleetFuelLog, FleetFuelSummary,
  FleetInspection, FleetAssignment, FleetAnalytics, FleetVehicleStatus,
  FleetPersonnelData,
} from '../../types';
import FleetOverviewTab from './tabs/FleetOverviewTab';
import FleetFuelTab from './tabs/FleetFuelTab';
import FleetInspectionsTab from './tabs/FleetInspectionsTab';
import FleetAssignmentsTab from './tabs/FleetAssignmentsTab';
import FleetPersonnelTab from './tabs/FleetPersonnelTab';
import FleetAnalyticsTab from './tabs/FleetAnalyticsTab';
import FleetTiresTab from './tabs/FleetTiresTab';
import FleetDamageTab from './tabs/FleetDamageTab';
import FleetRecallsTab from './tabs/FleetRecallsTab';
import { formatMilitary } from './utils/fleetFormatters';
import PrintRecordButton from '../../components/PrintRecordButton';

export type DetailTab = 'overview' | 'fuel' | 'inspections' | 'assignments' | 'personnel' | 'analytics' | 'tires' | 'damage' | 'recalls';

const STATUS_LED: Record<FleetVehicleStatus, string> = {
  in_service: 'led-dot led-green', maintenance: 'led-dot led-amber',
  out_of_service: 'led-dot led-red', retired: 'led-dot led-off',
};
const STATUS_LABEL: Record<FleetVehicleStatus, string> = {
  in_service: 'In Service', maintenance: 'Maintenance',
  out_of_service: 'Out of Service', retired: 'Retired',
};
const STATUS_COLOR: Record<FleetVehicleStatus, string> = {
  in_service: '#22c55e', maintenance: '#f59e0b',
  out_of_service: '#ef4444', retired: '#666666',
};

function getExpiryStatus(dateStr?: string): 'ok' | 'expiring' | 'expired' | 'none' {
  if (!dateStr) return 'none';
  // Force local-time parse for date-only strings to avoid UTC timezone shift
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00` : dateStr;
  const exp = new Date(normalized);
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
  { key: 'inspections', label: 'Inspections', icon: ClipboardCheck },
  { key: 'assignments', label: 'Assignments', icon: Radio },
  { key: 'personnel', label: 'Personnel', icon: Users },
  { key: 'tires', label: 'Tires', icon: Circle },
  { key: 'damage', label: 'Damage', icon: AlertTriangle },
  { key: 'recalls', label: 'Recalls', icon: AlertOctagon },
  { key: 'analytics', label: 'Analytics', icon: BarChart3 },
];

interface Props {
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
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onEditVehicle: () => void;
  onLogMaintenance: () => void;
  onLogFuel: () => void;
  onNewInspection: () => void;
  onEditFuel?: (log: FleetFuelLog) => void;
  onDeleteFuel?: (log: FleetFuelLog) => void;
  onEditMaintenance?: (record: FleetMaintenance) => void;
  onDeleteMaintenance?: (record: FleetMaintenance) => void;
  onEditInspection?: (inspection: FleetInspection) => void;
  onDeleteInspection?: (inspection: FleetInspection) => void;
  onAssignVehicle: (unitId: string) => void;
  onUnassignVehicle: () => void;
  onAddPersonnelNote: (note: string) => void;
  onDeletePersonnelNote: (noteId: string) => void;
  onRefreshPersonnel: () => void;
  onArchiveVehicle: () => void;
  onUnarchiveVehicle: () => void;
  onDeleteVehicle: () => void;
  isArchived: boolean;
  onClose: () => void;
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
    maintenance_logs: maintenance.map((m: any) => ({
      service_date: m.service_date,
      service_type: m.service_type,
      description: m.description,
      cost: m.cost,
      odometer_reading: m.odometer_reading,
      vendor: m.vendor,
      labor_cost: m.labor_cost,
      service_tasks: m.service_tasks,
    })),
  });

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="toolbar-btn" onClick={() => setOpen(!open)}>
        <Printer className="w-3 h-3" /> Print <ChevronDown className="w-2.5 h-2.5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-50 bg-rmpg-700 border border-rmpg-500 rounded-sm shadow-lg min-w-[180px]">
          {reportOptions.map((opt) => (
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
          ))}
        </div>
      )}
    </div>
  );
}

export default function FleetDetailPanel({
  detail, maintenance, fuelLogs, fuelSummary, inspections, assignments,
  analytics, analyticsLoading, personnelData, personnelLoading,
  activeTab, onTabChange,
  onEditVehicle, onLogMaintenance, onLogFuel, onNewInspection,
  onEditFuel, onDeleteFuel, onEditMaintenance, onDeleteMaintenance, onEditInspection, onDeleteInspection,
  onAssignVehicle, onUnassignVehicle, onAddPersonnelNote, onDeletePersonnelNote, onRefreshPersonnel,
  onArchiveVehicle, onUnarchiveVehicle, onDeleteVehicle, isArchived,
  onClose,
}: Props) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin'; // Admin God Mode
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Detail header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-rmpg-700 flex items-start justify-between bg-surface-sunken transition-colors duration-200">
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
              <h2 className="text-lg font-bold text-white font-mono">{detail.vehicle_number}</h2>
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
              const nextMi = (detail as any).next_service_mileage;
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
        <div className="flex items-center gap-1.5">
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
            className="p-1 hover:bg-rmpg-700 text-rmpg-400 hover:text-white transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50"
            onClick={onClose}
            aria-label="Close vehicle details">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex-shrink-0 flex items-center border-b border-rmpg-700 px-1 bg-surface-base overflow-x-auto" style={{ scrollbarWidth: 'none' }} role="tablist" aria-label="Vehicle detail tabs">
        {TABS.map(({ key, label, icon: Icon }) => {
          const isActive = activeTab === key;
          return (
          <button type="button"
            key={key}
            role="tab"
            aria-selected={isActive}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase font-bold tracking-wider whitespace-nowrap transition-all duration-200 border-b-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50 ${
              isActive
                ? 'text-white border-brand-500 bg-brand-900/10'
                : 'text-rmpg-400 border-transparent hover:text-rmpg-200 hover:bg-rmpg-700/20 hover:border-rmpg-500/50'
            }`}
            onClick={() => onTabChange(key)}
          >
            <Icon className={`w-3 h-3 ${isActive ? 'text-brand-400' : ''}`} />
            {label}
          </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-dark" role="tabpanel" aria-label={`${activeTab} tab content`}>
        {activeTab === 'overview' && <FleetOverviewTab detail={detail} maintenance={maintenance} onEditMaintenance={onEditMaintenance} onDeleteMaintenance={onDeleteMaintenance} />}
        {activeTab === 'fuel' && <FleetFuelTab fuelLogs={fuelLogs} summary={fuelSummary} onAddFuel={onLogFuel} onEditFuel={onEditFuel} onDeleteFuel={onDeleteFuel} />}
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
        {activeTab === 'analytics' && <FleetAnalyticsTab analytics={analytics} loading={analyticsLoading} />}
      </div>
    </div>
  );
}
