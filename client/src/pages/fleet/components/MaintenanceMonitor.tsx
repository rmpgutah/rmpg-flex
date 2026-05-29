import { useState, useEffect } from 'react';
import { Wrench, AlertTriangle, Clock, CheckCircle, ChevronRight, Loader2 } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp } from '../../../utils/dateUtils';

interface FleetVehicle {
  id: string;
  vehicle_number: string;
  make: string;
  model: string;
  year: number | null;
  status: string;
  current_mileage: number | null;
  last_service_date: string | null;
  next_service_due: string | null;
  assigned_unit_call_sign?: string | null;
}

interface Props {
  onSelectVehicle: (id: string) => void;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = parseTimestamp(dateStr);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return parseTimestamp(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

export default function MaintenanceMonitor({ onSelectVehicle }: Props) {
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<any>('/fleet?per_page=200');
        setVehicles(res?.vehicles || res?.data || []);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  // Categorize vehicles by maintenance urgency
  const overdue: FleetVehicle[] = [];
  const dueSoon: FleetVehicle[] = [];    // within 7 days
  const upcoming: FleetVehicle[] = [];   // within 30 days
  const onTrack: FleetVehicle[] = [];

  for (const v of vehicles) {
    const days = daysUntil(v.next_service_due);
    if (days === null) {
      onTrack.push(v);
    } else if (days < 0) {
      overdue.push(v);
    } else if (days <= 7) {
      dueSoon.push(v);
    } else if (days <= 30) {
      upcoming.push(v);
    } else {
      onTrack.push(v);
    }
  }

  // Sort overdue/dueSoon by most urgent first
  overdue.sort((a, b) => (daysUntil(a.next_service_due) ?? 0) - (daysUntil(b.next_service_due) ?? 0));
  dueSoon.sort((a, b) => (daysUntil(a.next_service_due) ?? 0) - (daysUntil(b.next_service_due) ?? 0));
  upcoming.sort((a, b) => (daysUntil(a.next_service_due) ?? 0) - (daysUntil(b.next_service_due) ?? 0));

  const inMaintenance = vehicles.filter(v => v.status === 'maintenance');

  if (loading) {
    return (
      <div className="p-3">
        <div className="panel-beveled p-4 bg-surface-base border-t-2 border-t-brand-500">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-brand-400 animate-spin" role="status" aria-label="Loading" />
            <span className="text-xs text-rmpg-300">Loading maintenance data…</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {/* Summary Cards */}
      <div className="panel-beveled p-3 bg-surface-base border-t-2 border-t-brand-500">
        <div className="flex items-center gap-2 mb-3">
          <Wrench className="w-4 h-4 text-brand-400" />
          <h3 className="text-xs font-bold text-rmpg-100 uppercase tracking-wider">Maintenance Monitor</h3>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-surface-sunken p-2 border border-rmpg-700">
            <div className="text-[9px] uppercase tracking-wider text-rmpg-500 font-bold">Overdue</div>
            <div className={`text-lg font-mono font-bold ${overdue.length > 0 ? 'text-red-400' : 'text-green-400'}`}>
              {overdue.length}
            </div>
          </div>
          <div className="bg-surface-sunken p-2 border border-rmpg-700">
            <div className="text-[9px] uppercase tracking-wider text-rmpg-500 font-bold">Due This Week</div>
            <div className={`text-lg font-mono font-bold ${dueSoon.length > 0 ? 'text-amber-400' : 'text-green-400'}`}>
              {dueSoon.length}
            </div>
          </div>
          <div className="bg-surface-sunken p-2 border border-rmpg-700">
            <div className="text-[9px] uppercase tracking-wider text-rmpg-500 font-bold">In Maintenance</div>
            <div className="text-lg font-mono font-bold text-amber-400">{inMaintenance.length}</div>
          </div>
          <div className="bg-surface-sunken p-2 border border-rmpg-700">
            <div className="text-[9px] uppercase tracking-wider text-rmpg-500 font-bold">On Track</div>
            <div className="text-lg font-mono font-bold text-green-400">{onTrack.length}</div>
          </div>
        </div>
      </div>

      {/* Overdue Vehicles */}
      {overdue.length > 0 && (
        <div className="panel-beveled p-3 bg-surface-base border-l-2 border-l-red-500">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Overdue Service</span>
          </div>
          <div className="space-y-1">
            {overdue.map(v => {
              const days = daysUntil(v.next_service_due);
              return (
                <button type="button"
                  key={v.id}
                  onClick={() => onSelectVehicle(v.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 bg-red-900/20 border border-red-800/30 hover:bg-red-900/40 transition-colors text-left"
                >
                  <span className="text-[11px] font-mono font-bold text-white">{v.vehicle_number}</span>
                  <span className="text-[10px] text-rmpg-300 flex-1 truncate">
                    {v.year} {v.make} {v.model}
                  </span>
                  <span className="text-[10px] font-bold text-red-400">
                    {Math.abs(days ?? 0)}d overdue
                  </span>
                  <ChevronRight className="w-3 h-3 text-rmpg-500" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Due This Week */}
      {dueSoon.length > 0 && (
        <div className="panel-beveled p-3 bg-surface-base border-l-2 border-l-amber-500">
          <div className="flex items-center gap-1.5 mb-2">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Due This Week</span>
          </div>
          <div className="space-y-1">
            {dueSoon.map(v => {
              const days = daysUntil(v.next_service_due);
              return (
                <button type="button"
                  key={v.id}
                  onClick={() => onSelectVehicle(v.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 bg-amber-900/15 border border-amber-800/30 hover:bg-amber-900/30 transition-colors text-left"
                >
                  <span className="text-[11px] font-mono font-bold text-white">{v.vehicle_number}</span>
                  <span className="text-[10px] text-rmpg-300 flex-1 truncate">
                    {v.year} {v.make} {v.model}
                  </span>
                  <span className="text-[10px] font-bold text-amber-400">
                    {days === 0 ? 'Today' : `${days}d`}
                  </span>
                  <ChevronRight className="w-3 h-3 text-rmpg-500" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming (30 days) */}
      {upcoming.length > 0 && (
        <div className="panel-beveled p-3 bg-surface-base border-l-2 border-l-brand-500">
          <div className="flex items-center gap-1.5 mb-2">
            <CheckCircle className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Upcoming (30 Days)</span>
          </div>
          <div className="space-y-1">
            {upcoming.slice(0, 5).map(v => {
              const days = daysUntil(v.next_service_due);
              return (
                <button type="button"
                  key={v.id}
                  onClick={() => onSelectVehicle(v.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 bg-surface-sunken border border-rmpg-700 hover:bg-rmpg-700 transition-colors text-left"
                >
                  <span className="text-[11px] font-mono font-bold text-white">{v.vehicle_number}</span>
                  <span className="text-[10px] text-rmpg-300 flex-1 truncate">
                    {v.year} {v.make} {v.model}
                  </span>
                  <span className="text-[10px] text-rmpg-400">
                    {formatDate(v.next_service_due)}
                  </span>
                  <ChevronRight className="w-3 h-3 text-rmpg-500" />
                </button>
              );
            })}
            {upcoming.length > 5 && (
              <p className="text-[9px] text-rmpg-500 pl-2">+{upcoming.length - 5} more</p>
            )}
          </div>
        </div>
      )}

      {/* No maintenance needed */}
      {overdue.length === 0 && dueSoon.length === 0 && upcoming.length === 0 && (
        <div className="panel-beveled p-3 bg-surface-base border-l-2 border-l-green-600 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-500" />
          <span className="text-[11px] text-green-400 font-semibold">All vehicles on track — no service due within 30 days</span>
        </div>
      )}
    </div>
  );
}
