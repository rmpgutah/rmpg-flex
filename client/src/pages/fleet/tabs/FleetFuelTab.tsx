import { useEffect, useMemo, useState } from 'react';
import { Fuel, DollarSign, Gauge, Plus, MapPin, Calendar, Pencil, Trash2, TrendingUp, TrendingDown, Route, FileText, AlertTriangle, User, CreditCard, Copy } from 'lucide-react';
import type { FleetFuelLog, FleetFuelSummary, FuelType } from '../../../types';
import { formatMilitary } from '../utils/fleetFormatters';
import { formatEnumValue, toDisplayLabel } from '../../../utils/formatters';
import FleetioConflictBadge from '../../../components/FleetioConflictBadge';
import type { ConflictBadgeConflict } from '../../../components/FleetioConflictBadge';
import { apiFetch } from '../../../hooks/useApi';

const FUEL_TYPE_BADGE: Record<FuelType, { bg: string; text: string; border: string }> = {
  regular: { bg: 'bg-rmpg-800', text: 'text-rmpg-300', border: 'border-rmpg-600' },
  premium: { bg: 'bg-amber-900/30', text: 'text-amber-400', border: 'border-amber-700/40' },
  diesel: { bg: 'bg-surface-sunken/30', text: 'text-rmpg-400', border: 'border-border-default/40' },
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

/** Tiny SVG sparkline for $/gallon price trend (chronological, oldest→newest). */
function PriceSparkline({ logs }: { logs: FleetFuelLog[] }) {
  const withPrice = [...logs]
    .filter(l => l.cost_per_gallon != null && l.cost_per_gallon! > 0)
    .reverse()
    .slice(-20);
  if (withPrice.length < 2) return null;
  const values = withPrice.map(l => l.cost_per_gallon!);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 320, h = 40, padding = 2;
  const usableH = h - padding * 2, usableW = w - padding * 2;
  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * usableW;
    const y = padding + usableH - ((v - min) / range) * usableH;
    return `${x},${y}`;
  });
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const avgY = padding + usableH - ((avg - min) / range) * usableH;
  const last = values[values.length - 1];
  const first = values[0];
  const trendUp = last > first;
  return (
    <div className="panel-beveled bg-surface-sunken p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[8px] text-rmpg-500 uppercase font-bold tracking-wider">$/Gal Price Trend (Last {values.length} Fills)</span>
        <div className="flex items-center gap-3 text-[8px] text-rmpg-500">
          <span>Low: <span className="font-mono font-bold text-green-400">${min.toFixed(3)}</span></span>
          <span>Avg: <span className="font-mono font-bold text-brand-400">${avg.toFixed(3)}</span></span>
          <span>High: <span className="font-mono font-bold text-red-400">${max.toFixed(3)}</span></span>
          <span className={trendUp ? 'text-red-400' : 'text-green-400'}>{trendUp ? '▲' : '▼'} ${last.toFixed(3)}</span>
        </div>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible">
        <line x1={padding} y1={avgY} x2={padding + usableW} y2={avgY} stroke="rgb(var(--accent-silver-400-rgb) / 0.3)" strokeWidth="0.5" strokeDasharray="3,3" />
        <polyline points={points.join(' ')} fill="none" stroke="var(--accent-silver-400)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {values.map((v, i) => {
          const x = padding + (i / (values.length - 1)) * usableW;
          const y = padding + usableH - ((v - min) / range) * usableH;
          return <circle key={i} cx={x} cy={y} r="2" fill="var(--accent-silver-400)" />;
        })}
      </svg>
    </div>
  );
}

/** Monthly spend mini bar-chart (last 12 months with data). */
function MonthlySpendBars({ logs }: { logs: FleetFuelLog[] }) {
  const byMonth = new Map<string, { cost: number; gallons: number }>();
  for (const l of logs) {
    const m = (l.fuel_date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) continue;
    const a = byMonth.get(m) ?? { cost: 0, gallons: 0 };
    a.cost += typeof l.total_cost === 'number' ? l.total_cost : 0;
    a.gallons += typeof l.gallons === 'number' ? l.gallons : 0;
    byMonth.set(m, a);
  }
  const months = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-12);
  if (months.length < 2) return null;
  const maxCost = Math.max(...months.map(([, a]) => a.cost)) || 1;
  return (
    <div className="panel-beveled bg-surface-sunken p-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[8px] text-rmpg-500 uppercase font-bold tracking-wider">Monthly Spend (Last {months.length} Months)</span>
        <span className="text-[8px] text-rmpg-500">Total: <span className="font-mono font-bold text-green-400">${months.reduce((s, [, a]) => s + a.cost, 0).toFixed(2)}</span></span>
      </div>
      {/* Each column is h-full so it inherits a DEFINITE height from the h-20
          row, and the bar sits in its own flex-1 track. A percentage height
          only resolves against a definite-height parent — the column
          previously had none (flex children size to content under
          items-end), so every bar computed to zero and the chart rendered
          blank while the month labels and total still showed. jsdom has no
          layout engine, so only a real browser can catch this. */}
      <div className="flex items-end gap-1 h-20">
        {months.map(([month, a]) => (
          <div key={month} className="flex-1 h-full flex flex-col items-center justify-end gap-0.5 group" title={`${month}: $${a.cost.toFixed(2)} · ${a.gallons.toFixed(1)} gal`}>
            <span className="text-[7px] text-rmpg-500 font-mono opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">${Math.round(a.cost)}</span>
            <div className="w-full flex-1 flex items-end min-h-0">
              <div className="w-full bg-green-700/60 hover:bg-green-500 transition-colors rounded-t-sm" style={{ height: `${Math.max(2, (a.cost / maxCost) * 100)}%` }} />
            </div>
            <span className="text-[6px] text-rmpg-600 font-mono">{month.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Minutes within which two same-vehicle, same-gallons fills are treated as
 *  one physical fill. Fleet.io-pulled twins land 0–5 min from their native
 *  row (296 s was the widest observed on live D1); a genuine second fill of
 *  byte-identical volume that soon is not a real scenario. */
const NEAR_DUP_WINDOW_MIN = 10;

/** How many of the fields an operator actually fills in are populated. Used
 *  to decide which row in a duplicate group SURVIVES — a Fleet.io-pulled row
 *  carries only date + gallons, so it must never win over the native row
 *  that has the odometer, driver, station and payment method on it. */
export function fuelLogCompleteness(log: FleetFuelLog): number {
  const l = log as unknown as Record<string, unknown>;
  const filled = (v: unknown) => v != null && v !== '';
  return [
    l.total_cost, l.odometer, l.odometer_reading, l.driver_name, l.station,
    l.payment_method, l.location, l.notes, l.cost_per_gallon, l.fuel_type,
  ].filter(filled).length;
}

/**
 * Groups fuel logs representing the SAME physical fill. Two passes:
 *
 *  1. Exact: same vehicle_id + fuel_date + total_cost — a fuel-card import
 *     landing on top of a manual log. All three must be non-null so missing
 *     data never manufactures a false match.
 *
 *  2. Near: same vehicle_id + same gallons, timestamps within
 *     NEAR_DUP_WINDOW_MIN. This is the Fleet.io `/pull` twin, which pass 1
 *     structurally CANNOT see: the pulled row has total_cost = null (so it
 *     was skipped outright) and its timestamp differs from the native row by
 *     seconds (so the exact key never collided). 22 such rows accumulated
 *     unnoticed on live D1 — visible in the fuel log as bare "10.991 gal"
 *     entries with no cost, station or driver, and unreachable by "Delete
 *     Duplicates". Gallons must match and be > 0; two null-gallon rows are
 *     not evidence of anything.
 *
 * Returns only groups with 2+ members; single entries are never "duplicates."
 */
function findDuplicateGroups(logs: FleetFuelLog[]): Map<string, FleetFuelLog[]> {
  const groups = new Map<string, FleetFuelLog[]>();
  const claimed = new Set<FleetFuelLog>();

  // ── Pass 1: exact vehicle + date + cost ──
  for (const log of logs) {
    if (log.total_cost == null || !log.fuel_date) continue;
    const key = `${log.vehicle_id}|${log.fuel_date}|${log.total_cost.toFixed(2)}`;
    const g = groups.get(key) ?? [];
    g.push(log);
    groups.set(key, g);
  }
  for (const [key, g] of groups) {
    if (g.length < 2) groups.delete(key);
    else for (const l of g) claimed.add(l);
  }

  // ── Pass 2: same vehicle + gallons, near in time ──
  const byVehicleGallons = new Map<string, FleetFuelLog[]>();
  for (const log of logs) {
    if (claimed.has(log)) continue;
    const gallons = typeof log.gallons === 'number' ? log.gallons : null;
    if (gallons == null || !(gallons > 0) || !log.fuel_date) continue;
    const ts = Date.parse(log.fuel_date);
    if (Number.isNaN(ts)) continue;
    const k = `${log.vehicle_id}|${gallons.toFixed(3)}`;
    byVehicleGallons.set(k, [...(byVehicleGallons.get(k) ?? []), log]);
  }
  for (const [k, bucket] of byVehicleGallons) {
    if (bucket.length < 2) continue;
    // Cluster chronologically: consecutive entries within the window belong
    // to the same physical fill.
    const sorted = [...bucket].sort(
      (a, b) => Date.parse(a.fuel_date as string) - Date.parse(b.fuel_date as string),
    );
    let cluster: FleetFuelLog[] = [sorted[0]];
    const flush = (c: FleetFuelLog[], idx: number) => {
      if (c.length >= 2) groups.set(`near|${k}|${idx}`, c);
    };
    let clusterIdx = 0;
    for (let i = 1; i < sorted.length; i++) {
      const gapMin = Math.abs(
        Date.parse(sorted[i].fuel_date as string)
        - Date.parse(sorted[i - 1].fuel_date as string),
      ) / 60000;
      if (gapMin <= NEAR_DUP_WINDOW_MIN) cluster.push(sorted[i]);
      else { flush(cluster, clusterIdx++); cluster = [sorted[i]]; }
    }
    flush(cluster, clusterIdx);
  }
  return groups;
}

interface Props {
  fuelLogs: FleetFuelLog[];
  summary: FleetFuelSummary | null;
  onAddFuel: () => void;
  onEditFuel?: (log: FleetFuelLog) => void;
  onDeleteFuel?: (log: FleetFuelLog) => void;
  /** Invoked by the "Delete Duplicates" banner action with every
   *  non-kept entry across all duplicate groups. Distinct from
   *  `onDeleteFuel`: that one only opens a single-record confirm dialog
   *  (sets state, doesn't call the API), so calling it in a loop just
   *  batches down to the last item — this prop is the actual bulk delete. */
  onBulkDeleteFuel?: (logs: FleetFuelLog[]) => void;
  /** Invoked when the user clicks the "Report" button — parent composes
   *  the per-vehicle fuel PDF using the vehicle object + logs + summary. */
  onGenerateReport?: () => void;
  /** Invoked when the user clicks "Flagged Audit" — parent composes the
   *  flagged-audit PDF, pre-filtering to logs that have `.flags` set. */
  onGenerateFlaggedAudit?: () => void;
}

export default function FleetFuelTab({
  fuelLogs, summary, onAddFuel, onEditFuel, onDeleteFuel, onBulkDeleteFuel,
  onGenerateReport, onGenerateFlaggedAudit,
}: Props) {
  // Count flagged entries so we can label the Audit button + gate visibility
  const flaggedCount = fuelLogs.filter((l: any) => !!l.flags).length;

  const duplicateGroups = useMemo(() => findDuplicateGroups(fuelLogs), [fuelLogs]);
  const duplicateIds = useMemo(() => {
    const s = new Set<string>();
    for (const g of duplicateGroups.values()) for (const l of g) s.add(String(l.id));
    return s;
  }, [duplicateGroups]);
  const duplicateCount = fuelLogs.filter((l) => duplicateIds.has(String(l.id))).length;

  const [conflicts, setConflicts] = useState<Map<number, ConflictBadgeConflict[]>>(new Map());
  useEffect(() => {
    const ids = fuelLogs.map((l) => Number(l.id));
    if (!ids.length) { setConflicts(new Map()); return; }
    apiFetch<{ conflicts: Record<string, unknown>[] }>(`/fleetio/conflicts?table=fleet_fuel_log&ids=${ids.join(',')}`)
      .then((r) => {
        const map = new Map<number, ConflictBadgeConflict[]>();
        for (const c of r?.conflicts ?? []) {
          const rmpgId = c.rmpg_id as number;
          if (!map.has(rmpgId)) map.set(rmpgId, []);
          map.get(rmpgId)!.push({
            id: c.id as number,
            field: c.field as string,
            local_value: c.local_value as string | null | undefined,
            remote_value: c.remote_value as string | null | undefined,
            resolution: c.resolution as string | null | undefined,
          });
        }
        setConflicts(map);
      })
      .catch(() => {});
  }, [fuelLogs]);

  return (
    <div className="p-4 space-y-3">
      {/* Summary Stats — Top Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <Fuel className="w-3.5 h-3.5 mx-auto text-rmpg-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-rmpg-400">
            {summary?.total_gallons != null ? summary.total_gallons.toFixed(3) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Total Gallons</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <DollarSign className="w-3.5 h-3.5 mx-auto text-green-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-green-400">
            ${summary?.total_cost != null ? summary.total_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
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
            ${summary?.avg_cost_per_gallon != null ? summary.avg_cost_per_gallon.toFixed(3) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Avg $/Gal</div>
        </div>
      </div>

      {/* Summary Stats — Second Row (efficiency details) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <Route className="w-3.5 h-3.5 mx-auto text-rmpg-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-rmpg-400">
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

      {/* Trend charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <MpgSparkline logs={fuelLogs} />
        <PriceSparkline logs={fuelLogs} />
      </div>
      <MonthlySpendBars logs={fuelLogs} />

      {/* Action Bar */}
      <div className="flex items-center justify-between">
        <h3 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
          <Fuel className="w-3 h-3" /> Fuel Log ({fuelLogs.length})
        </h3>
        <div className="flex items-center gap-2 print:hidden">
          {onGenerateFlaggedAudit && flaggedCount > 0 && (
            <button type="button" className="toolbar-btn text-amber-400" onClick={onGenerateFlaggedAudit}
              title={`Download flagged-fills audit PDF (${flaggedCount} flagged)`}>
              <AlertTriangle className="w-3 h-3" /> Audit ({flaggedCount})
            </button>
          )}
          {onGenerateReport && fuelLogs.length > 0 && (
            <button type="button" className="toolbar-btn" onClick={onGenerateReport} title="Download per-vehicle fuel report PDF">
              <FileText className="w-3 h-3" /> Report
            </button>
          )}
          <button type="button" className="toolbar-btn toolbar-btn-primary" onClick={onAddFuel}>
            <Plus className="w-3 h-3" /> Add Fuel Log
          </button>
        </div>
      </div>

      {/* Possible-duplicate banner — same vehicle + date + total cost, e.g. a
          fuel-card import landing on top of a manual entry for the same fill-up. */}
      {onBulkDeleteFuel && duplicateCount > 0 && (
        <div className="panel-beveled p-2.5 bg-amber-900/10 border border-amber-700/40 flex items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-2 text-[10px] text-amber-400">
            <Copy className="w-3.5 h-3.5 flex-shrink-0" />
            <span>
              <span className="font-bold">{duplicateCount} possible duplicate{duplicateCount === 1 ? '' : 's'}</span>
              {' '}across {duplicateGroups.size} group{duplicateGroups.size === 1 ? '' : 's'} — same date + total cost, or same gallons minutes apart.
            </span>
          </div>
          <button
            type="button"
            className="toolbar-btn text-amber-400 flex-shrink-0"
            onClick={() => {
              // Keep the MOST COMPLETE entry per group, tie-breaking on the
              // lowest id. Keeping the lowest id outright (the previous rule)
              // is actively destructive for Fleet.io twins: the pulled row —
              // which has no odometer, driver or cost — is sometimes the
              // lower id, so the operator's fully-populated record was the
              // one deleted. Completeness first makes the survivor the row
              // holding real data regardless of insertion order.
              //
              // `onDeleteFuel` only opens a single-record confirm dialog (sets
              // state, doesn't call the API) — calling it once per extra in a
              // loop just batches down to the last item, so this collects
              // every extra across every group into one bulk-delete call.
              const toDelete: FleetFuelLog[] = [];
              for (const group of duplicateGroups.values()) {
                const [, ...extras] = [...group].sort((a, b) => {
                  const byCompleteness = fuelLogCompleteness(b) - fuelLogCompleteness(a);
                  return byCompleteness !== 0 ? byCompleteness : Number(a.id) - Number(b.id);
                });
                toDelete.push(...extras);
              }
              onBulkDeleteFuel(toDelete);
            }}
            title="Keep the most complete entry in each duplicate group and delete the rest"
          >
            <Trash2 className="w-3 h-3" /> Delete Duplicates
          </button>
        </div>
      )}

      {/* Fuel Log List */}
      {fuelLogs.length === 0 ? (
        <div className="text-center py-12 panel-beveled bg-surface-base">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full border border-rmpg-700 flex items-center justify-center" style={{ background: 'var(--surface-deep)' }}>
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
                <div className="flex-shrink-0 w-8 h-8 rounded-sm flex items-center justify-center bg-surface-sunken/20 border border-border-default/40">
                  <Fuel className="w-4 h-4 text-rmpg-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-rmpg-200 font-mono font-bold">
                      {log.gallons != null ? log.gallons.toFixed(3) : '-'} gal
                    </span>
                    <span className={`px-1 py-0.5 text-[8px] font-bold uppercase border ${badge.bg} ${badge.text} ${badge.border}`}>
                      {formatEnumValue(log.fuel_type)}
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
                      <span className="text-[9px] font-mono tabular-nums text-rmpg-400">
                        {dist.toFixed(1)} mi
                      </span>
                    )}
                    {/* Partial-fill flag — full tanks are the norm, so only
                        call out partials (they're excluded from MPG). */}
                    {(log.is_full_tank === 0 || log.is_full_tank === false) && (
                      <span className="px-1 py-0.5 text-[8px] font-bold uppercase text-amber-400 bg-amber-900/20 border border-amber-700/30">Partial</span>
                    )}
                    {duplicateIds.has(String(log.id)) && (
                      <span className="flex items-center gap-0.5 px-1 py-0.5 text-[8px] font-bold uppercase text-amber-400 bg-amber-900/20 border border-amber-700/30" title="Same vehicle, date, and total cost as another entry">
                        <Copy className="w-2.5 h-2.5" /> Dup
                      </span>
                    )}
                    {conflicts.get(Number(log.id))?.map((c) => (
                      <FleetioConflictBadge key={c.id} conflict={c} compact />
                    ))}
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
                    {(log.odometer_reading ?? log.odometer) != null && (
                      <span className="flex items-center gap-0.5">
                        <Gauge className="w-2.5 h-2.5" />{(log.odometer_reading ?? log.odometer)!.toLocaleString()} mi
                      </span>
                    )}
                    {log.cost_per_gallon != null && (
                      <span>${log.cost_per_gallon.toFixed(3)}/gal</span>
                    )}
                    {log.driver_name && (
                      <span className="flex items-center gap-0.5"><User className="w-2.5 h-2.5" />{log.driver_name}</span>
                    )}
                    {log.payment_method && (
                      <span className="flex items-center gap-0.5"><CreditCard className="w-2.5 h-2.5" />{toDisplayLabel(log.payment_method)}</span>
                    )}
                    {log.location && (
                      <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{log.location}</span>
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
