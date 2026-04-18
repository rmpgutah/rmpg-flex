// ═══════════════════════════════════════════════════════════════
// Fuel Gauge Card — compact tank-level indicator for the Fleet
// vehicle grid. Renders inside each vehicle tile.
//
// The gauge data is computed server-side by GET /api/fleet/fuel/gauges
// (see fleet.ts) so the grid only does ONE fetch for the entire fleet
// rather than N per-vehicle calls. This component is purely presentational.
//
// Status colors:
//   ok       — green   (>=3 days of fuel remaining)
//   low      — amber   (1–3 days)
//   critical — red     (< 1 day, fill up now)
//   unknown  — gray    (no data yet — vehicle has never been fueled)
// ═══════════════════════════════════════════════════════════════

import React from 'react';
import { Fuel, AlertTriangle } from 'lucide-react';

export interface FuelGaugeData {
  vehicle_id: number;
  vehicle_number: string;
  tank_capacity: number | null;
  status: 'ok' | 'low' | 'critical' | 'unknown';
  last_fill_date: string | null;
  last_fill_gallons: number | null;
  days_since_fill: number | null;
  avg_daily_gallons: number | null;
  estimated_current_gallons: number | null;
  estimated_pct: number | null; // 0..100
  days_remaining: number | null;
}

const STATUS_STYLE: Record<string, { bar: string; text: string; ring: string; label: string }> = {
  ok:       { bar: 'bg-green-500',  text: 'text-green-400',  ring: 'border-green-700/40',  label: 'OK' },
  low:      { bar: 'bg-amber-500',  text: 'text-amber-400',  ring: 'border-amber-700/40',  label: 'LOW' },
  critical: { bar: 'bg-red-600',    text: 'text-red-400',    ring: 'border-red-700/40',    label: 'CRIT' },
  unknown:  { bar: 'bg-gray-600',   text: 'text-gray-500',   ring: 'border-gray-700/40',   label: '—' },
};

export default function FuelGaugeCard({ gauge }: { gauge: FuelGaugeData | null | undefined }) {
  if (!gauge || gauge.status === 'unknown') {
    return (
      <div className="mt-1.5 w-full opacity-50">
        <div className="flex justify-between text-[7px] text-rmpg-600 mb-0.5">
          <span className="flex items-center gap-0.5"><Fuel className="w-2.5 h-2.5" />FUEL</span>
          <span className="font-mono">no data</span>
        </div>
        <div className="w-full h-1 bg-rmpg-700 overflow-hidden">
          <div className="h-full bg-gray-700" style={{ width: '0%' }} />
        </div>
      </div>
    );
  }

  const style = STATUS_STYLE[gauge.status] || STATUS_STYLE.unknown;
  const pct = gauge.estimated_pct ?? null;
  const widthPct = pct != null ? Math.max(2, pct) : 0; // floor at 2% so the bar is visible even at near-empty

  return (
    <div className={`mt-1.5 w-full panel-beveled bg-surface-base border ${style.ring} px-1.5 py-1`}>
      <div className="flex justify-between items-center text-[7px] mb-0.5">
        <span className="flex items-center gap-0.5 text-rmpg-500">
          <Fuel className={`w-2.5 h-2.5 ${style.text}`} />
          FUEL
        </span>
        <span className={`font-mono font-bold ${style.text}`}>
          {pct != null ? `${pct.toFixed(0)}%` : '—'}
          {gauge.status === 'critical' && <AlertTriangle className="w-2 h-2 inline ml-0.5" />}
        </span>
      </div>
      <div
        className="w-full h-1.5 bg-surface-sunken border border-rmpg-800 overflow-hidden"
        role="progressbar"
        aria-valuenow={pct ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Estimated tank: ${pct != null ? pct.toFixed(0) : '?'}%, ${gauge.days_remaining != null ? gauge.days_remaining.toFixed(1) : '?'} days remaining`}
      >
        <div className={`h-full ${style.bar} transition-all duration-500`} style={{ width: `${widthPct}%` }} />
      </div>
      <div className="flex justify-between text-[7px] text-rmpg-600 mt-0.5 font-mono">
        <span>
          {gauge.days_since_fill != null
            ? `${gauge.days_since_fill}d ago`
            : 'never filled'}
        </span>
        <span className={style.text}>
          {gauge.days_remaining != null ? `~${gauge.days_remaining.toFixed(0)}d left` : '—'}
        </span>
      </div>
    </div>
  );
}
