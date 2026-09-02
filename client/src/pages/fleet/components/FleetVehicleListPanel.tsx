import { Car, Search, Gauge, Tag, Radio } from 'lucide-react';
import { useRef } from 'react';
import { parseTimestamp } from '../../../utils/dateUtils';
import { useSlashFocus } from '../../../hooks/useSlashFocus';
import GaugeRing from './GaugeRing';
import { STATUS_COLOR, STATUS_LABEL, VEHICLE_STATUSES, UTILIZATION_LIFETIME_MILES } from '../fleetConstants';
import type { FleetVehicle, FleetVehicleStatus } from '../../../types';
import type { ContextMenuItem } from '../../../context/ContextMenuContext';

function getExpiryStatus(dateStr?: string): 'ok' | 'expiring' | 'expired' | 'none' {
  if (!dateStr) return 'none';
  const exp = parseTimestamp(dateStr);
  const now = new Date();
  if (exp < now) return 'expired';
  const thirtyDays = new Date();
  thirtyDays.setDate(thirtyDays.getDate() + 30);
  if (exp <= thirtyDays) return 'expiring';
  return 'ok';
}

interface Props {
  vehicles: FleetVehicle[];
  filtered: FleetVehicle[];
  vehicleTotal: number | null;
  selectedId: string | number | null;
  isMobile: boolean;
  filterStatus: string;
  setFilterStatus: (s: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onSelect: (id: string | number) => void;
  onContextMenu: (e: React.MouseEvent, vehicle: FleetVehicle) => void;
}

export default function FleetVehicleListPanel({
  vehicles, filtered, vehicleTotal, selectedId, isMobile,
  filterStatus, setFilterStatus, searchQuery, setSearchQuery,
  onSelect,   onContextMenu,
}: Props) {
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);
  return (
    <div
      className={`flex flex-col min-h-0 bg-surface-raised ${isMobile ? (selectedId ? 'hidden' : 'w-full') : ''}`}
      style={isMobile ? undefined : { width: '36%', minWidth: 300, maxWidth: 440 }}
    >
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-rmpg-700 bg-surface-base">
        <select
          id="ff-fleetpage-0"
          className="select-dark text-[10px] py-1 px-2 min-h-[36px]"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="all">All Status</option>
          {VEHICLE_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <div className="flex-1 relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" aria-hidden="true" />
          <input
            id="ff-fleetpage-1"
            ref={searchRef}
            className="input-dark w-full text-[10px] py-1 pl-6 pr-2 min-h-[36px] focus:ring-1 focus:ring-brand-500/50 focus:border-brand-600 transition-shadow duration-150"
            placeholder="Search vehicles… (/)"
            aria-label="Search fleet vehicles by number, make, model, or plate"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <span
          data-testid="vehicle-count"
          className="flex-shrink-0 text-[9px] font-mono text-fg-muted tabular-nums"
          title={vehicleTotal != null && vehicleTotal > vehicles.length
            ? `The server returned only ${vehicles.length} of ${vehicleTotal} fleet vehicles. Filtering the loaded rows will not reveal the rest.`
            : `${vehicles.length} vehicles`}
        >
          {vehicleTotal != null && vehicleTotal > vehicles.length
            ? `${vehicles.length} of ${vehicleTotal}`
            : `${vehicles.length}`}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-dark" role="list" aria-label="Fleet vehicles">
        {filtered.length === 0 && (
          <div className="text-center py-12">
            <Car className="w-10 h-10 text-rmpg-600 mx-auto mb-3" />
            <p className="text-[11px] text-rmpg-500 font-medium">No vehicles found</p>
            <p className="text-[9px] text-rmpg-600 mt-1">Adjust your filters or add a new vehicle</p>
          </div>
        )}
        {filtered.map((v, idx) => {
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
              role="listitem"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(v.id); } }}
              className={`px-3 py-2.5 cursor-pointer border-b border-rmpg-700 transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand-500/50 ${
                isSelected ? 'panel-inset' : `hover:bg-rmpg-800 ${idx % 2 === 1 ? 'bg-rmpg-800/15' : ''}`
              }`}
              style={isSelected ? { backgroundColor: 'var(--surface-base)', borderLeft: `3px solid ${statusColor}` } : { borderLeft: '3px solid transparent' }}
              onClick={() => onSelect(v.id)}
              onContextMenu={(e) => onContextMenu(e, v)}
              aria-selected={isSelected}
            >
              <div className="flex items-center gap-2.5">
                <div className={`relative flex-shrink-0 w-9 h-9 rounded-sm flex items-center justify-center border ${
                  v.status === 'in_service' ? 'bg-green-900/20 border-green-700/40' :
                  v.status === 'maintenance' ? 'bg-amber-900/20 border-amber-700/40' :
                  v.status === 'out_of_service' ? 'bg-red-900/20 border-red-700/40' :
                  'bg-rmpg-800/50 border-rmpg-700/40'
                }`}>
                  <Car className="w-4 h-4" style={{ color: statusColor }} />
                  {hasAlert && (
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full flex items-center justify-center animate-pulse">
                      <span className="text-[6px] text-rmpg-100 font-bold">!</span>
                    </div>
                  )}
                  {!hasAlert && hasWarning && (
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 rounded-full flex items-center justify-center">
                      <span className="text-[6px] text-rmpg-100 font-bold">!</span>
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
                      'bg-rmpg-800 text-rmpg-400 border-rmpg-700'
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
                  {v.next_service_due && (() => {
                    const daysUntil = Math.ceil((parseTimestamp(v.next_service_due).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                    if (daysUntil < 0) return <span className="text-[8px] bg-red-900/50 text-red-400 border border-red-700/50 px-1.5 py-0.5 rounded-sm font-bold">OVERDUE {Math.abs(daysUntil)}d</span>;
                    if (daysUntil <= 14) return <span className="text-[8px] bg-amber-900/50 text-amber-400 border border-amber-700/50 px-1.5 py-0.5 rounded-sm font-bold">SERVICE {daysUntil}d</span>;
                    return null;
                  })()}
                </div>
              </div>
              {v.current_mileage != null && v.current_mileage > 0 && (
                <div className="mt-1.5 w-full">
                  <div className="flex justify-between text-[7px] text-rmpg-600 mb-0.5">
                    <span>UTILIZATION</span>
                    <span className="font-mono">{Math.min(100, Math.round((v.current_mileage / UTILIZATION_LIFETIME_MILES) * 100))}%</span>
                  </div>
                  <div
                    className="w-full h-1 bg-rmpg-700 overflow-hidden"
                    role="progressbar"
                    aria-valuenow={Math.min(100, Math.round((v.current_mileage / UTILIZATION_LIFETIME_MILES) * 100))}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Vehicle utilization: ${Math.min(100, Math.round((v.current_mileage / UTILIZATION_LIFETIME_MILES) * 100))}%`}
                  >
                    <div
                      className="h-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, (v.current_mileage / UTILIZATION_LIFETIME_MILES) * 100)}%`,
                        background: v.current_mileage < 75000 ? 'var(--sev-ok)'
                          : v.current_mileage < 120000 ? 'var(--sev-warn)' : 'var(--sev-critical)',
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
  );
}
