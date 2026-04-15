// ═══════════════════════════════════════════════════════════════
// RMPG Flex — Fleet Cost Analytics Page
//
// Fleet-wide TCO dashboard — sibling of FuelAnalyticsPage but covering
// all six cost streams (fuel + maintenance + loans + insurance +
// accessories + utilities). The server endpoint /fleet/cost-analytics/
// overview returns totals, per-vehicle rankings, a monthly trend, and
// pre-computed per-vehicle anomaly flags (three detection rules: cost-
// per-mile outliers, MoM spend spikes, category imbalance).
//
// Layout:
//   Header            — title, window selector, refresh
//   Totals strip      — TCO, fleet avg $/mile, category counts
//   Anomalies panel   — flagged vehicles (if any), with reason + severity
//   Category rings    — visual breakdown of fleet-wide spend per category
//   Vehicle ranking   — sortable table, anomaly rows highlighted
//   Monthly trend     — bar chart (time-stamped streams only)
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useMemo, useState } from 'react';
import {
  DollarSign, Gauge, AlertTriangle, TrendingUp, BarChart3,
  ArrowLeft, RefreshCw, FileText, Car, Fuel, Wrench, CreditCard, Shield, Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import PanelTitleBar from '../../components/PanelTitleBar';
import { apiFetch } from '../../hooks/useApi';
import type { CostAnalyticsOverview, CostAnalyticsVehicle } from '../../types';

const WINDOW_OPTIONS: { value: number; label: string }[] = [
  { value: 30,  label: '30 days' },
  { value: 90,  label: '90 days' },
  { value: 180, label: '6 months' },
  { value: 365, label: '1 year' },
  { value: 730, label: '2 years' },
];

// Category colour mapping — matches the cost breakdown bar used on the
// Costs tab + the category chip colours on the timeline.
const CATEGORY_UI: Array<{ key: keyof CostAnalyticsOverview['totals']; label: string; color: string; bar: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'fuel',        label: 'Fuel',        color: 'text-cyan-400',   bar: 'bg-cyan-600',   icon: Fuel },
  { key: 'maintenance', label: 'Maintenance', color: 'text-amber-400',  bar: 'bg-amber-600',  icon: Wrench },
  { key: 'loan',        label: 'Loan',        color: 'text-blue-400',   bar: 'bg-blue-600',   icon: CreditCard },
  { key: 'insurance',   label: 'Insurance',   color: 'text-green-400',  bar: 'bg-green-600',  icon: Shield },
  { key: 'accessories', label: 'Accessories', color: 'text-amber-400',  bar: 'bg-amber-500',  icon: Wrench },
  { key: 'utilities',   label: 'Utilities',   color: 'text-purple-400', bar: 'bg-purple-600', icon: Zap },
];

function fmtCurrency(n: number | null | undefined, digits = 2): string {
  if (n == null) return '—';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
function fmtInt(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

export default function FleetCostAnalyticsPage() {
  const [windowDays, setWindowDays] = useState(365);
  const [overview, setOverview] = useState<CostAnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState<'total' | 'cost_per_mile' | 'anomalies'>('total');

  const load = async (days: number) => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<CostAnalyticsOverview>(`/fleet/cost-analytics/overview?days=${days}`);
      setOverview(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load cost analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(windowDays); /* eslint-disable-next-line */ }, [windowDays]);

  const anomalousVehicles = useMemo(
    () => (overview?.vehicles || []).filter(v => v.anomalies && v.anomalies.length > 0),
    [overview],
  );

  const sortedVehicles = useMemo(() => {
    const list = [...(overview?.vehicles || [])];
    switch (sortBy) {
      case 'cost_per_mile':
        return list.sort((a, b) => (b.cost_per_mile ?? -1) - (a.cost_per_mile ?? -1));
      case 'anomalies':
        return list.sort((a, b) => (b.anomalies?.length || 0) - (a.anomalies?.length || 0));
      case 'total':
      default:
        return list.sort((a, b) => b.total - a.total);
    }
  }, [overview, sortBy]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-surface-base">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Link to="/fleet" className="toolbar-btn text-[10px]" title="Back to Fleet">
            <ArrowLeft className="w-3 h-3" /> Fleet
          </Link>
          <h1 className="text-sm font-bold text-rmpg-100 uppercase tracking-wider flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-brand-400" /> Fleet Cost Analytics
          </h1>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[9px] text-rmpg-500 uppercase mr-1">Window</label>
          <select className="select-dark text-[10px] min-h-[28px] py-0.5"
            value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
            {WINDOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button type="button" className="toolbar-btn text-[10px]" onClick={() => load(windowDays)} disabled={loading}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="panel-beveled p-2 border border-red-700/40 bg-red-900/20">
          <div className="flex items-center gap-1.5 text-[10px] text-red-400">
            <AlertTriangle className="w-3 h-3" />{error}
          </div>
        </div>
      )}

      {overview && (
        <>
          {/* Totals strip — TCO + fleet avg $/mile + active policies/loans */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Stat icon={DollarSign} color="text-cyan-400"   label="Total TCO"  value={fmtCurrency(overview.total_all)} />
            <Stat icon={Gauge}      color="text-brand-400"  label="Fleet Avg $/Mile" value={overview.fleet_avg_cost_per_mile > 0 ? fmtCurrency(overview.fleet_avg_cost_per_mile, 3) : '—'} />
            <Stat icon={Fuel}       color="text-cyan-400"   label="Fuel Fills" value={fmtInt(overview.counts.fuel_fills)} />
            <Stat icon={CreditCard} color="text-blue-400"   label="Active Loans" value={fmtInt(overview.counts.active_loans)} />
            <Stat icon={Shield}     color="text-green-400"  label="Active Policies" value={fmtInt(overview.counts.active_policies)} />
          </div>

          {/* Anomalies — only shown when there's something to flag.
              We intentionally put this ABOVE the ranking table so operators
              see what needs attention before scanning all vehicles. */}
          {anomalousVehicles.length > 0 && (
            <div className="panel-beveled bg-surface-sunken border border-amber-700/40">
              <PanelTitleBar title={`Anomalies (${anomalousVehicles.length})`} icon={AlertTriangle} />
              <div className="p-2 space-y-1.5">
                {anomalousVehicles.map((v) => (
                  <AnomalyRow key={v.id} vehicle={v} />
                ))}
              </div>
            </div>
          )}

          {/* Category breakdown — where the fleet's money goes */}
          <div className="panel-beveled bg-surface-sunken">
            <PanelTitleBar title="Spend by Category" icon={DollarSign} />
            <div className="p-3 space-y-1">
              {CATEGORY_UI.map(({ key, label, color, bar, icon: Icon }) => {
                const amount = Number(overview.totals[key]) || 0;
                const pct = overview.total_all > 0 ? (amount / overview.total_all) * 100 : 0;
                return (
                  <div key={key} className="flex items-center gap-2 text-[10px] font-mono">
                    <Icon className={`w-3 h-3 ${color}`} />
                    <span className={`w-20 ${color}`}>{label}</span>
                    <div className="flex-1 h-2 bg-surface-base border border-rmpg-800 overflow-hidden">
                      <div className={`h-full ${bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                    <span className="text-rmpg-300 w-20 text-right">{fmtCurrency(amount)}</span>
                    <span className="text-rmpg-500 w-12 text-right">{pct.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Vehicle TCO ranking — sortable, anomaly rows highlighted */}
          <div className="panel-beveled bg-surface-sunken">
            <div className="flex items-center justify-between px-3 py-2 border-b border-rmpg-700">
              <h2 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-1.5">
                <Car className="w-3 h-3" /> Vehicles by TCO
              </h2>
              <div className="flex items-center gap-1 text-[9px]">
                <span className="text-rmpg-500">Sort:</span>
                {(['total', 'cost_per_mile', 'anomalies'] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setSortBy(k)}
                    className={`px-2 py-0.5 uppercase ${sortBy === k ? 'bg-brand-900/30 text-brand-400 border border-brand-700/40' : 'text-rmpg-500 hover:text-rmpg-300'}`}>
                    {k === 'cost_per_mile' ? '$/mi' : k === 'anomalies' ? 'flags' : 'Total'}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-[10px] font-mono">
                <thead className="bg-surface-raised sticky top-0">
                  <tr className="text-left text-[9px] uppercase text-rmpg-500">
                    <th className="px-2 py-1.5">Vehicle</th>
                    <th className="px-2 py-1.5 text-right">Fuel</th>
                    <th className="px-2 py-1.5 text-right">Maint</th>
                    <th className="px-2 py-1.5 text-right">Loan</th>
                    <th className="px-2 py-1.5 text-right">Ins.</th>
                    <th className="px-2 py-1.5 text-right">Acc.</th>
                    <th className="px-2 py-1.5 text-right">Util.</th>
                    <th className="px-2 py-1.5 text-right">Total</th>
                    <th className="px-2 py-1.5 text-right">$/Mile</th>
                    <th className="px-2 py-1.5">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedVehicles.length === 0 && (
                    <tr><td colSpan={10} className="text-center text-[10px] text-rmpg-500 py-6">No cost activity in this window</td></tr>
                  )}
                  {sortedVehicles.map((v) => {
                    const hasAnomaly = (v.anomalies?.length || 0) > 0;
                    const rowClass = hasAnomaly ? 'bg-amber-900/10' : '';
                    return (
                      <tr key={v.id} className={`border-t border-rmpg-800 ${rowClass}`}>
                        <td className="px-2 py-1 text-rmpg-200">#{v.vehicle_number} {[v.year, v.make, v.model].filter(Boolean).join(' ')}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-cyan-400">{fmtCurrency(v.fuel_cost)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-amber-400">{fmtCurrency(v.maint_cost)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-blue-400">{fmtCurrency(v.loan_cost)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-green-400">{fmtCurrency(v.insurance_cost)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{fmtCurrency(v.accessory_cost)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-purple-400">{fmtCurrency(v.utility_cost)}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-bold">{fmtCurrency(v.total)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-brand-400">{v.cost_per_mile != null ? fmtCurrency(v.cost_per_mile, 3) : '—'}</td>
                        <td className="px-2 py-1">
                          {hasAnomaly ? (
                            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[8px] font-bold uppercase bg-amber-900/30 text-amber-300 border border-amber-700/40">
                              <AlertTriangle className="w-2.5 h-2.5" />{v.anomalies.length}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Monthly trend — bars for recorded-date streams only */}
          {overview.monthly_trend.length >= 2 && (
            <div className="panel-beveled bg-surface-sunken p-3">
              <PanelTitleBar title="Monthly Trend (Recorded Spend)" icon={TrendingUp} />
              <MonthlyTrendBars data={overview.monthly_trend} />
              <p className="text-[8px] text-rmpg-600 mt-1 text-center">
                Fuel + maintenance + accessories + utilities only. Loan/insurance are smooth monthly recurrences — excluded so the trend isn't flattened.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────

function Stat({ icon: Icon, label, value, color }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
      <Icon className={`w-3.5 h-3.5 mx-auto ${color} mb-1`} />
      <div className={`text-sm font-bold font-mono tabular-nums ${color}`}>{value}</div>
      <div className="text-[7px] text-rmpg-500 uppercase">{label}</div>
    </div>
  );
}

function AnomalyRow({ vehicle }: { vehicle: CostAnalyticsVehicle }) {
  const alerts = vehicle.anomalies.filter(a => a.severity === 'alert');
  const watches = vehicle.anomalies.filter(a => a.severity === 'watch');
  return (
    <div className="panel-beveled p-2 bg-surface-base border border-amber-700/30">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold text-rmpg-200">
          #{vehicle.vehicle_number} {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}
        </span>
        <span className="text-[9px] font-mono text-rmpg-500">TCO: <span className="text-rmpg-300 font-bold">{fmtCurrency(vehicle.total)}</span></span>
        {vehicle.cost_per_mile != null && (
          <span className="text-[9px] font-mono text-rmpg-500">$/mi: <span className="text-brand-400 font-bold">{fmtCurrency(vehicle.cost_per_mile, 3)}</span></span>
        )}
      </div>
      <ul className="mt-1.5 space-y-0.5">
        {[...alerts, ...watches].map((a, i) => (
          <li key={i} className="flex items-start gap-1.5 text-[9px]">
            <span className={`px-1 py-px text-[7px] font-bold uppercase border flex-shrink-0 ${
              a.severity === 'alert' ? 'bg-red-900/30 text-red-400 border-red-700/40' : 'bg-amber-900/30 text-amber-400 border-amber-700/40'
            }`}>{a.severity}</span>
            <span className="text-rmpg-300 font-mono">
              <span className="text-rmpg-500 mr-1.5">{a.kind.replace('_', ' ')}:</span>
              {a.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MonthlyTrendBars({ data }: { data: Array<{ month: string; cost: number }> }) {
  const max = useMemo(() => Math.max(...data.map(d => d.cost), 1), [data]);
  return (
    <div className="p-2">
      <div className="flex items-end gap-0.5 h-24">
        {data.map((d) => (
          <div key={d.month} className="flex-1 flex flex-col items-center justify-end h-full"
            title={`${d.month}: ${fmtCurrency(d.cost)}`}>
            <div className="bg-cyan-600/60 border-t border-cyan-400 w-full"
              style={{ height: `${(d.cost / max) * 100}%`, minHeight: '1px' }} />
          </div>
        ))}
      </div>
      <div className="flex gap-0.5 mt-1">
        {data.map((d) => (
          <div key={d.month} className="flex-1 text-center text-[7px] font-mono text-rmpg-600 tracking-tighter">
            {d.month.slice(5)}/{d.month.slice(2, 4)}
          </div>
        ))}
      </div>
    </div>
  );
}
