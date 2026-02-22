import React from 'react';
import {
  Car, Fuel, ClipboardCheck, Radio, BarChart3, Settings, Wrench, X, Clock, Users,
  Archive, RotateCcw, Trash2,
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
import { formatMilitary } from './utils/fleetFormatters';
import PrintRecordButton from '../../components/PrintRecordButton';

export type DetailTab = 'overview' | 'fuel' | 'inspections' | 'assignments' | 'personnel' | 'analytics';

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
  out_of_service: '#ef4444', retired: '#6b7280',
};

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

const TABS: { key: DetailTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'overview', label: 'Overview', icon: Car },
  { key: 'fuel', label: 'Fuel', icon: Fuel },
  { key: 'inspections', label: 'Inspections', icon: ClipboardCheck },
  { key: 'assignments', label: 'Assignments', icon: Radio },
  { key: 'personnel', label: 'Personnel', icon: Users },
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

export default function FleetDetailPanel({
  detail, maintenance, fuelLogs, fuelSummary, inspections, assignments,
  analytics, analyticsLoading, personnelData, personnelLoading,
  activeTab, onTabChange,
  onEditVehicle, onLogMaintenance, onLogFuel, onNewInspection,
  onAssignVehicle, onUnassignVehicle, onAddPersonnelNote, onDeletePersonnelNote, onRefreshPersonnel,
  onArchiveVehicle, onUnarchiveVehicle, onDeleteVehicle, isArchived,
  onClose,
}: Props) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Detail header */}
      <div className="px-4 py-3 border-b border-rmpg-700 flex items-start justify-between bg-surface-sunken">
        <div>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded flex items-center justify-center border ${
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
            {getExpiryStatus(detail.registration_expiry) === 'expired' && (
              <span className="px-2 py-0.5 text-[9px] font-bold bg-red-900/50 text-red-400 border border-red-700/50 animate-pulse">REG EXPIRED</span>
            )}
            {getExpiryStatus(detail.insurance_expiry) === 'expired' && (
              <span className="px-2 py-0.5 text-[9px] font-bold bg-red-900/50 text-red-400 border border-red-700/50 animate-pulse">INS EXPIRED</span>
            )}
            {getExpiryStatus(detail.next_service_due) === 'expired' && (
              <span className="px-2 py-0.5 text-[9px] font-bold bg-amber-900/50 text-amber-400 border border-amber-700/50">SERVICE OVERDUE</span>
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
        <div className="flex items-center gap-1.5">
          <PrintRecordButton recordType="fleet" recordData={detail} identifier={detail.vehicle_number} entityType="fleet" entityId={detail.id} label="Print" />
          {!isArchived && (
            <>
              <button className="toolbar-btn" onClick={onEditVehicle}>
                <Settings className="w-3 h-3" /> Edit
              </button>
              <button className="toolbar-btn toolbar-btn-primary" onClick={onLogMaintenance}>
                <Wrench className="w-3 h-3" /> Maintenance
              </button>
              {detail.status === 'retired' && (
                <button className="toolbar-btn text-amber-400 hover:text-amber-300" onClick={onArchiveVehicle} title="Archive this retired vehicle">
                  <Archive className="w-3 h-3" /> Archive
                </button>
              )}
            </>
          )}
          {isArchived && (
            <>
              <button className="toolbar-btn text-green-400 hover:text-green-300" onClick={onUnarchiveVehicle} title="Unarchive this vehicle">
                <RotateCcw className="w-3 h-3" /> Unarchive
              </button>
              <button className="toolbar-btn text-red-400 hover:text-red-300" onClick={onDeleteVehicle} title="Permanently delete this vehicle">
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            </>
          )}
          <button
            className="p-1 hover:bg-rmpg-700 text-rmpg-400 hover:text-white transition-colors"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center border-b border-rmpg-700 px-1 bg-surface-base">
        {TABS.map(({ key, label, icon: Icon }) => {
          const isActive = activeTab === key;
          return (
          <button
            key={key}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase font-bold tracking-wider transition-colors border-b-2 ${
              isActive
                ? 'text-white border-brand-500 bg-brand-900/10'
                : 'text-rmpg-400 border-transparent hover:text-rmpg-200 hover:bg-rmpg-700/20'
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
      {activeTab === 'overview' && <FleetOverviewTab detail={detail} maintenance={maintenance} />}
      {activeTab === 'fuel' && <FleetFuelTab fuelLogs={fuelLogs} summary={fuelSummary} onAddFuel={onLogFuel} />}
      {activeTab === 'inspections' && <FleetInspectionsTab inspections={inspections} onNewInspection={onNewInspection} />}
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
      {activeTab === 'analytics' && <FleetAnalyticsTab analytics={analytics} loading={analyticsLoading} />}
    </div>
  );
}
