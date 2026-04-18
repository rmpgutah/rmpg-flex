import React from 'react';
import { Fuel, DollarSign, Gauge, Plus, MapPin, Calendar, Pencil, Trash2, TrendingUp, TrendingDown, Route } from 'lucide-react';
import type { FleetFuelLog, FleetFuelSummary, FuelType } from '../../../types';
import { formatMilitary } from '../utils/fleetFormatters';

const FUEL_TYPE_BADGE: Record<FuelType, { bg: string; text: string; border: string }> = {
  regular: { bg: 'bg-rmpg-800', text: 'text-rmpg-300', border: 'border-rmpg-600' },
  premium: { bg: 'bg-amber-900/30', text: 'text-amber-400', border: 'border-amber-700/40' },
  diesel: { bg: 'bg-gray-900/30', text: 'text-gray-400', border: 'border-gray-700/40' },
};

function mpgColor(mpg: number | null | undefined): string {
  if (mpg == null) return 'text-rmpg-500';
  if (mpg > 20) return 'text-green-400';
  if (mpg >= 15) return 'text-amber-400';
  return 'text-red-400';
}

function mpgBgColor(mpg: number | null | undefined): string {
  if (mpg == null) return 'bg-rmpg-800/50';
  if (mpg > 20) return 'bg-green-900/20';
  if (mpg >= 15) return 'bg-amber-900/20';
  return 'bg-red-900/20';
}

/** Tiny SVG sparkline for MPG trend */
function MpgSparkline({ logs }: { logs: FleetFuelLog[] }) {
  // Get last 20 entries with MPG in chronological order (oldest first)
  const withMpg = [...logs]
    .filter(l => l.mpg != null && l.mpg! > 0)
    .reverse()
    .slice(-20);

  if (withMpg.length < 2) return null;

  const values = withMpg.map(l => l.mpg!);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const w = 320;
  const h = 40;
  const padding = 2;
  const usableH = h - padding * 2;
  const usableW = w - padding * 2;

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * usableW;
    const y = padding + usableH - ((v - min) / range) * usableH;
    return `${x},${y}`;
  });

  const areaPoints = [
    `${padding},${h - padding}`,
    ...points,
    `${padding + usableW},${h - padding}`,
  ].join(' ');

  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const avgY = padding + usableH - ((avg - min) / range) * usableH;

  return (
    <div className="panel-beveled bg-surface-sunken p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[8px] text-rmpg-500 uppercase font-bold tracking-wider">MPG Trend (Last {values.length} Fills)</span>
        <div className="flex items-center gap-3 text-[8px] text-rmpg-500">
          <span>Low: <span className={`font-mono font-bold ${mpgColor(min)}`}>{min.toFixed(1)}</span></span>
          <span>Avg: <span className="font-mono font-bold text-brand-400">{avg.toFixed(1)}</span></span>
          <span>High: <span className={`font-mono font-bold ${mpgColor(max)}`}>{max.toFixed(1)}</span></span>
        </div>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible">
        {/* Area fill */}
        <polygon points={areaPoints} fill="rgba(136,136,136,0.15)" />
        {/* Average line */}
        <line x1={padding} y1={avgY} x2={padding + usableW} y2={avgY} stroke="rgba(212,160,23,0.3)" strokeWidth="0.5" strokeDasharray="3,3" />
        {/* Trend line */}
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke="#888888"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Data points */}
        {values.map((v, i) => {
          const x = padding + (i / (values.length - 1)) * usableW;
          const y = padding + usableH - ((v - min) / range) * usableH;
          const color = v > 20 ? '#4ade80' : v >= 15 ? '#fbbf24' : '#f87171';
          return <circle key={i} cx={x} cy={y} r="2" fill={color} />;
        })}
      </svg>
    </div>
  );
}

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
      {/* Summary Stats — Top Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <Fuel className="w-3.5 h-3.5 mx-auto text-gray-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-gray-400">
            {summary ? summary.total_gallons.toFixed(3) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Total Gallons</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <DollarSign className="w-3.5 h-3.5 mx-auto text-green-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-green-400">
            ${summary ? summary.total_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Total Cost</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <Gauge className="w-3.5 h-3.5 mx-auto text-brand-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-brand-400">
            {summary?.avg_mpg != null ? summary.avg_mpg.toFixed(1) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Avg MPG</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <DollarSign className="w-3.5 h-3.5 mx-auto text-amber-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-amber-400">
            ${summary ? summary.avg_cost_per_gallon.toFixed(3) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Avg $/Gal</div>
        </div>
      </div>

      {/* Summary Stats — Second Row (efficiency details) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <Route className="w-3.5 h-3.5 mx-auto text-gray-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-gray-400">
            {summary?.total_distance != null ? summary.total_distance.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Total Miles</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <DollarSign className="w-3.5 h-3.5 mx-auto text-purple-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-purple-400">
            {summary?.cost_per_mile != null ? `$${summary.cost_per_mile.toFixed(3)}` : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Cost/Mile</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <TrendingUp className="w-3.5 h-3.5 mx-auto text-green-400 mb-1" />
          <div className={`text-sm font-bold font-mono tabular-nums ${mpgColor(summary?.best_mpg)}`}>
            {summary?.best_mpg != null ? summary.best_mpg.toFixed(1) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Best MPG</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <TrendingDown className="w-3.5 h-3.5 mx-auto text-red-400 mb-1" />
          <div className={`text-sm font-bold font-mono tabular-nums ${mpgColor(summary?.worst_mpg)}`}>
            {summary?.worst_mpg != null ? summary.worst_mpg.toFixed(1) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Worst MPG</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <DollarSign className="w-3.5 h-3.5 mx-auto text-orange-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-orange-400">
            {summary?.fuel_cost_per_day != null ? `$${summary.fuel_cost_per_day.toFixed(2)}` : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">$/Day</div>
        </div>
      </div>

      {/* MPG Sparkline */}
      <MpgSparkline logs={fuelLogs} />

      {/* Action Bar */}
      <div className="flex items-center justify-between">
        <h3 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
          <Fuel className="w-3 h-3" /> Fuel Log ({fuelLogs.length})
        </h3>
        <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={onAddFuel}>
          <Plus className="w-3 h-3" /> Add Fuel Log
        </button>
      </div>

      {/* Fuel Log List */}
      {fuelLogs.length === 0 ? (
        <div className="text-center py-12 panel-beveled bg-surface-base">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full border border-rmpg-700 flex items-center justify-center" style={{ background: '#050505' }}>
            <Fuel className="w-8 h-8 text-rmpg-600" />
          </div>
          <p className="text-xs text-rmpg-400 font-semibold">No Fuel Logs Recorded</p>
          <p className="text-[10px] text-rmpg-600 mt-1.5 max-w-[280px] mx-auto leading-relaxed">
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
            const dist = log.calc_distance ?? log.distance ?? null;
            return (
              <div key={log.id} className="panel-beveled p-2.5 flex items-center gap-3 bg-surface-base">
                <div className="flex-shrink-0 w-8 h-8 rounded-sm flex items-center justify-center bg-gray-900/20 border border-gray-700/40">
                  <Fuel className="w-4 h-4 text-gray-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-rmpg-200 font-mono font-bold">
                      {log.gallons.toFixed(3)} gal
                    </span>
                    <span className={`px-1 py-0.5 text-[8px] font-bold uppercase border ${badge.bg} ${badge.text} ${badge.border}`}>
                      {log.fuel_type}
                    </span>
                    {log.total_cost != null && (
                      <span className="text-[10px] text-green-400 font-mono">${log.total_cost.toFixed(2)}</span>
                    )}
                    {/* MPG badge */}
                    {log.mpg != null && (
                      <span className={`px-1.5 py-0.5 text-[9px] font-bold font-mono tabular-nums border rounded-sm ${mpgBgColor(log.mpg)} ${mpgColor(log.mpg)} border-current/20`}>
                        {log.mpg.toFixed(1)} MPG
                      </span>
                    )}
                    {/* Cost per mile */}
                    {log.cost_per_mile != null && (
                      <span className="px-1 py-0.5 text-[8px] font-mono tabular-nums text-purple-400 bg-purple-900/20 border border-purple-700/30">
                        ${log.cost_per_mile.toFixed(3)}/mi
                      </span>
                    )}
                    {/* Distance */}
                    {dist != null && dist > 0 && (
                      <span className="text-[9px] font-mono tabular-nums text-gray-400">
                        {dist.toFixed(1)} mi
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
