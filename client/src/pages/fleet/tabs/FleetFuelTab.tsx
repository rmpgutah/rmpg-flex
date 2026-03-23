import React from 'react';
import { Fuel, DollarSign, Gauge, Plus, MapPin, Calendar, Pencil, Trash2 } from 'lucide-react';
import type { FleetFuelLog, FleetFuelSummary, FuelType } from '../../../types';
import { formatMilitary } from '../utils/fleetFormatters';

const FUEL_TYPE_BADGE: Record<FuelType, { bg: string; text: string; border: string }> = {
  regular: { bg: 'bg-rmpg-800', text: 'text-rmpg-300', border: 'border-rmpg-600' },
  premium: { bg: 'bg-amber-900/30', text: 'text-amber-400', border: 'border-amber-700/40' },
  diesel: { bg: 'bg-blue-900/30', text: 'text-blue-400', border: 'border-blue-700/40' },
};

interface Props {
  fuelLogs: FleetFuelLog[];
  summary: FleetFuelSummary | null;
  onAddFuel: () => void;
  onEditFuel?: (log: FleetFuelLog) => void;
  onDeleteFuel?: (log: FleetFuelLog) => void;
}

export default function FleetFuelTab({ fuelLogs, summary, onAddFuel, onEditFuel, onDeleteFuel }: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="panel-beveled p-2.5 text-center" style={{ background: '#0d1520' }}>
          <Fuel className="w-3.5 h-3.5 mx-auto text-cyan-400 mb-1" />
          <div className="text-sm font-bold font-mono text-cyan-400">
            {summary ? summary.total_gallons.toFixed(3) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Total Gallons</div>
        </div>
        <div className="panel-beveled p-2.5 text-center" style={{ background: '#0d1520' }}>
          <DollarSign className="w-3.5 h-3.5 mx-auto text-green-400 mb-1" />
          <div className="text-sm font-bold font-mono text-green-400">
            ${summary ? summary.total_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Total Cost</div>
        </div>
        <div className="panel-beveled p-2.5 text-center" style={{ background: '#0d1520' }}>
          <Gauge className="w-3.5 h-3.5 mx-auto text-brand-400 mb-1" />
          <div className="text-sm font-bold font-mono text-brand-400">
            {summary?.avg_mpg != null ? summary.avg_mpg.toFixed(1) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Avg MPG</div>
        </div>
        <div className="panel-beveled p-2.5 text-center" style={{ background: '#0d1520' }}>
          <DollarSign className="w-3.5 h-3.5 mx-auto text-amber-400 mb-1" />
          <div className="text-sm font-bold font-mono text-amber-400">
            ${summary ? summary.avg_cost_per_gallon.toFixed(3) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Avg $/Gal</div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between">
        <h3 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
          <Fuel className="w-3 h-3" /> Fuel Log ({fuelLogs.length})
        </h3>
        <button type="button" className="toolbar-btn toolbar-btn-primary" onClick={onAddFuel}>
          <Plus className="w-3 h-3" /> Add Fuel Log
        </button>
      </div>

      {/* Fuel Log List */}
      {fuelLogs.length === 0 ? (
        <div className="text-center py-10 panel-beveled bg-surface-base">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center" style={{ background: '#0d1520' }}>
            <Fuel className="w-7 h-7 text-rmpg-600" />
          </div>
          <p className="text-[11px] text-rmpg-400 font-semibold">No Fuel Logs Recorded</p>
          <p className="text-[9px] text-rmpg-600 mt-1 max-w-[260px] mx-auto">
            Track fuel consumption, cost per gallon, and station visits to monitor fleet fuel efficiency.
          </p>
          <button type="button" className="toolbar-btn toolbar-btn-primary mt-3" onClick={onAddFuel}>
            <Plus className="w-3 h-3" /> Log First Entry
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {fuelLogs.map((log) => {
            const badge = FUEL_TYPE_BADGE[log.fuel_type] || FUEL_TYPE_BADGE.regular;
            return (
              <div key={log.id} className="panel-beveled p-2.5 flex items-center gap-3 bg-surface-base">
                <div className="flex-shrink-0 w-8 h-8 rounded-sm flex items-center justify-center bg-cyan-900/20 border border-cyan-700/40">
                  <Fuel className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-rmpg-200 font-mono font-bold">
                      {log.gallons.toFixed(3)} gal
                    </span>
                    <span className={`px-1 py-0.5 text-[8px] font-bold uppercase border ${badge.bg} ${badge.text} ${badge.border}`}>
                      {log.fuel_type}
                    </span>
                    {log.total_cost != null && (
                      <span className="text-[10px] text-green-400 font-mono">${log.total_cost.toFixed(2)}</span>
                    )}
                    {/* Efficiency badge — compare to fleet average */}
                    {summary && log.cost_per_gallon != null && (
                      <span className={`px-1 py-0.5 text-[8px] font-bold border ${
                        log.cost_per_gallon <= summary.avg_cost_per_gallon
                          ? 'bg-green-900/20 text-green-400 border-green-700/30'
                          : 'bg-red-900/20 text-red-400 border-red-700/30'
                      }`}>
                        {log.cost_per_gallon <= summary.avg_cost_per_gallon ? 'BELOW AVG' : 'ABOVE AVG'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-500">
                    <span className="flex items-center gap-0.5">
                      <Calendar className="w-2.5 h-2.5" />
                      {formatMilitary(log.fuel_date)}
                    </span>
                    {log.station && (
                      <span className="flex items-center gap-0.5">
                        <MapPin className="w-2.5 h-2.5" />{log.station}
                      </span>
                    )}
                    {log.odometer_reading != null && (
                      <span className="flex items-center gap-0.5">
                        <Gauge className="w-2.5 h-2.5" />{log.odometer_reading.toLocaleString()} mi
                      </span>
                    )}
                    {log.cost_per_gallon != null && (
                      <span>${log.cost_per_gallon.toFixed(3)}/gal</span>
                    )}
                  </div>
                  {log.notes && <p className="text-[9px] text-rmpg-400 mt-0.5">{log.notes}</p>}
                </div>
                {/* Admin Edit / Delete */}
                {(onEditFuel || onDeleteFuel) && (
                  <div className="flex-shrink-0 flex items-center gap-1">
                    {onEditFuel && (
                      <button type="button"
                        className="p-1 text-rmpg-500 hover:text-brand-400 hover:bg-rmpg-700 rounded-sm transition-colors"
                        onClick={(e) => { e.stopPropagation(); onEditFuel(log); }}
                        title="Edit fuel log"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    {onDeleteFuel && (
                      <button type="button"
                        className="p-1 text-rmpg-500 hover:text-red-400 hover:bg-red-900/20 rounded-sm transition-colors"
                        onClick={(e) => { e.stopPropagation(); onDeleteFuel(log); }}
                        title="Delete fuel log"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
