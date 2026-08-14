import { Car, Fuel, AlertTriangle, CheckCircle, DollarSign, Gauge, Wrench, Calendar, Shield } from 'lucide-react';
import GaugeRing from './GaugeRing';
import { STATUS_COLOR, STATUS_LABEL, VEHICLE_STATUSES } from '../fleetConstants';
import type { FleetVehicle, FleetAnalytics, FleetVehicleStatus } from '../../../types';
import { useIsMobile } from '../../../hooks/useIsMobile';

interface Props {
  vehicles: FleetVehicle[];
  statusCounts: Record<FleetVehicleStatus, number>;
  filterStatus: string;
  setFilterStatus: (s: string) => void;
  avgMileage: number;
  fleetAnalytics: FleetAnalytics | null;
  needsService: number;
  registrationExpiring: number;
  insuranceExpiring: number;
}

export default function FleetStatsBar({
  vehicles, statusCounts, filterStatus, setFilterStatus, avgMileage,
  fleetAnalytics, needsService, registrationExpiring, insuranceExpiring,
}: Props) {
  const isMobile = useIsMobile();

  return (
    <div className={`py-2 flex items-center gap-4 ${isMobile ? 'px-2 overflow-x-auto scrollbar-dark' : 'px-4'}`} role="group" aria-label="Fleet statistics">
      {/* Status Gauges */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {VEHICLE_STATUSES.map(({ value, label }) => (
          <button
            type="button"
            key={value}
            className={`panel-beveled px-2.5 py-1.5 flex items-center gap-2 cursor-pointer transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50 ${
              filterStatus === value ? 'ring-1 ring-brand-500 bg-brand-900/10' : 'bg-surface-base hover:border-rmpg-400'
            }`}
            aria-label={`Filter by ${label}: ${statusCounts[value] || 0} vehicles`}
            aria-pressed={filterStatus === value}
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

      <div className="h-8 w-px bg-rmpg-600 flex-shrink-0" />

      {/* Quick Stats */}
      <div className="flex items-center gap-3 text-[10px] font-mono flex-wrap">
        <div className="flex items-center gap-1.5" title="In Service / Total">
          <Car className="w-3.5 h-3.5 text-green-400" />
          <span className="text-rmpg-400">Fleet:</span>
          <span className="font-bold text-green-400">{statusCounts['in_service'] || 0}</span>
          <span className="text-rmpg-500">/ {vehicles.length}</span>
        </div>
        <div className="flex items-center gap-1.5" title="Average Fleet MPG">
          <Fuel className="w-3.5 h-3.5 text-green-400" />
          <span className="text-rmpg-400">MPG:</span>
          <span className="font-bold text-green-400">{fleetAnalytics?.fleet_summary?.avg_mpg != null ? fleetAnalytics.fleet_summary.avg_mpg.toFixed(1) : '--'}</span>
        </div>
        <div className="flex items-center gap-1.5" title="Vehicles Needing Service">
          {needsService > 0 ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> : <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
          <span className="text-rmpg-400">Service:</span>
          <span className="font-bold" style={{ color: needsService > 0 ? '#f59e0b' : '#22c55e' }}>{needsService}</span>
        </div>
        <div className="flex items-center gap-1.5" title="Monthly Costs (Maintenance + Fuel)">
          <DollarSign className="w-3.5 h-3.5 text-rmpg-400" />
          <span className="text-rmpg-400">Costs:</span>
          <span className="font-bold text-rmpg-400">
            {fleetAnalytics?.fleet_summary ? `$${(((fleetAnalytics.fleet_summary.total_maintenance_cost || 0) + (fleetAnalytics.fleet_summary.total_fuel_cost || 0)) / 1000).toFixed(1)}k` : '--'}
          </span>
        </div>
        <div className="flex items-center gap-1.5" title="Inspections Failing">
          <CheckCircle className="w-3.5 h-3.5" style={{ color: (fleetAnalytics?.fleet_summary?.inspections_failing || 0) > 0 ? '#ef4444' : '#22c55e' }} />
          <span className="text-rmpg-400">Insp:</span>
          <span className="font-bold" style={{ color: (fleetAnalytics?.fleet_summary?.inspections_failing || 0) > 0 ? '#ef4444' : '#22c55e' }}>
            {fleetAnalytics?.fleet_summary?.inspections_failing ?? '-'}
          </span>
        </div>
        <div className="flex items-center gap-1.5" title="Average Mileage">
          <Gauge className="w-3.5 h-3.5 text-brand-400" />
          <span className="text-rmpg-400">Avg:</span>
          <span className="font-bold text-brand-400">{avgMileage > 0 ? avgMileage.toLocaleString() : '-'}</span>
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
  );
}
