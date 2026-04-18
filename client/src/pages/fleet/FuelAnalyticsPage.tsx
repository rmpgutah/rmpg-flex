// ═══════════════════════════════════════════════════════════════
// RMPG Flex — Fuel Analytics Page
//
// Fleet-wide dashboard built on three aggregate endpoints the server
// exposes for the v2 expansion:
//   GET /api/fleet/fuel/analytics/overview   — totals, per-vehicle,
//                                              trend, top stations,
//                                              flagged leaderboard
//   GET /api/fleet/fuel/analytics/by-officer — per-driver rollups
//   GET /api/fleet/fuel/analytics/by-card    — per-card monthly spend
//
// Data-loading is kicked off in parallel so the first paint shows the
// stat cards while the heavier tables trickle in. Each section falls
// back to an empty-state panel when its endpoint returns zero rows.
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useMemo, useState } from 'react';
import {
  Fuel, DollarSign, Gauge, AlertTriangle, TrendingUp, TrendingDown,
  Users, CreditCard, MapPin, BarChart3, ArrowLeft, RefreshCw, FileText,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import PanelTitleBar from '../../components/PanelTitleBar';
import { apiFetch } from '../../hooks/useApi';
import type {
  FuelAnalyticsOverview, FuelAnalyticsByOfficer, FuelAnalyticsByCard,
} from '../../types';
import { generateFleetFuelAnalyticsPdf } from './utils/fleetFuelAnalyticsPdf';

const DEFAULT_WINDOW_DAYS = 90;
const WINDOW_OPTIONS: { value: number; label: string }[] = [
  { value: 30,  label: '30 days' },
  { value: 90,  label: '90 days' },
  { value: 180, label: '6 months' },
  { value: 365, label: '1 year' },
];

function fmtCurrency(n: number | null | undefined, digits = 2): string {
  if (n == null) return '—';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
function fmtNumber(n: number | null | undefined, digits = 0): string {
  if (n == null) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default function FuelAnalyticsPage() {
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW_DAYS);
  const [overview, setOverview] = useState<FuelAnalyticsOverview | null>(null);
  const [byOfficer, setByOfficer] = useState<FuelAnalyticsByOfficer[]>([]);
  const [byCard, setByCard] = useState<FuelAnalyticsByCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (days: number) => {
    setLoading(true);
    setError('');
    try {
      const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
      // Kick all three requests off in parallel — independent aggregates,
      // no reason to serialize.
      const [ov, officers, cards] = await Promise.all([
        apiFetch<FuelAnalyticsOverview>(`/fleet/fuel/analytics/overview?days=${days}`),
        apiFetch<{ data: FuelAnalyticsByOfficer[] }>(`/fleet/fuel/analytics/by-officer?since=${since}`),
        apiFetch<{ data: FuelAnalyticsByCard[] }>('/fleet/fuel/analytics/by-card'),
      ]);
      setOverview(ov);
      setByOfficer(officers.data || []);
      setByCard(cards.data || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(windowDays); /* eslint-disable-next-line */ }, [windowDays]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-surface-base">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Link to="/fleet" className="toolbar-btn text-[10px]" title="Back to Fleet">
            <ArrowLeft className="w-3 h-3" /> Fleet
          </Link>
          <h1 className="text-sm font-bold text-rmpg-100 uppercase tracking-wider flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-brand-400" /> Fuel Analytics
          </h1>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[9px] text-rmpg-500 uppercase mr-1">Window</label>
          <select className="select-dark text-[10px] min-h-[28px] py-0.5"
            value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
            {WINDOW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button type="button" className="toolbar-btn text-[10px]" onClick={() => load(windowDays)} disabled={loading}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          {/* Mirror of this dashboard, formatted for print/board review.
              Disabled until the three datasets have all loaded so the
              PDF doesn't ship with empty sections. */}
          <button type="button" className="toolbar-btn toolbar-btn-primary text-[10px]"
            onClick={() => overview && generateFleetFuelAnalyticsPdf({ overview, byOfficer, byCard })}
            disabled={!overview || loading}
            title="Download a printable PDF of this dashboard">
            <FileText className="w-3 h-3" /> Print Report
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

      {/* Totals strip */}
      {overview && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Stat icon={Fuel} color="text-cyan-400" label="Fills" value={fmtNumber(overview.totals.fill_count)} />
          <Stat icon={Fuel} color="text-cyan-400" label="Gallons" value={fmtNumber(overview.totals.total_gallons, 1)} />
          <Stat icon={DollarSign} color="text-green-400" label="Total Cost" value={fmtCurrency(overview.totals.total_cost)} />
          <Stat icon={DollarSign} color="text-amber-400" label="Avg $/Gal" value={overview.totals.avg_cpg != null ? `$${overview.totals.avg_cpg.toFixed(3)}` : '—'} />
          <Stat icon={AlertTriangle} color="text-amber-400" label="Flag Rate" value={`${overview.totals.flag_rate.toFixed(1)}%`} />
        </div>
      )}

      {/* Monthly trend */}
      {overview && overview.monthly_trend.length >= 2 && (
        <div className="panel-beveled bg-surface-sunken p-3">
          <PanelTitleBar title="Monthly Trend" icon={TrendingUp} />
          <MonthlyTrendChart data={overview.monthly_trend} />
        </div>
      )}

      {/* Two-column layout for rankings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Per-vehicle ranking */}
        <div className="panel-beveled bg-surface-sunken">
          <PanelTitleBar title="Vehicles by Cost" icon={Gauge} />
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full text-[10px] font-mono">
              <thead className="bg-surface-raised sticky top-0">
                <tr className="text-left text-[9px] uppercase text-rmpg-500">
                  <th className="px-2 py-1.5">Vehicle</th>
                  <th className="px-2 py-1.5 text-right">Fills</th>
                  <th className="px-2 py-1.5 text-right">Gal</th>
                  <th className="px-2 py-1.5 text-right">Cost</th>
                  <th className="px-2 py-1.5 text-right">Avg MPG</th>
                  <th className="px-2 py-1.5 text-right">Flag %</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.vehicles || []).filter(v => v.fill_count > 0).map((v) => (
                  <tr key={v.id} className="border-t border-rmpg-800">
                    <td className="px-2 py-1 text-rmpg-200">#{v.vehicle_number} {[v.year, v.make, v.model].filter(Boolean).join(' ')}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{v.fill_count}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{v.total_gallons.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-green-400">{fmtCurrency(v.total_cost)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-brand-400">{v.avg_mpg != null ? v.avg_mpg.toFixed(1) : '—'}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${v.flag_rate > 10 ? 'text-amber-400' : 'text-rmpg-500'}`}>{v.flag_rate.toFixed(1)}%</td>
                  </tr>
                ))}
                {(overview?.vehicles || []).filter(v => v.fill_count > 0).length === 0 && (
                  <tr><td colSpan={6} className="text-center text-[10px] text-rmpg-500 py-4">No fills in this window</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top stations */}
        <div className="panel-beveled bg-surface-sunken">
          <PanelTitleBar title="Top Stations" icon={MapPin} />
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full text-[10px] font-mono">
              <thead className="bg-surface-raised sticky top-0">
                <tr className="text-left text-[9px] uppercase text-rmpg-500">
                  <th className="px-2 py-1.5">Station</th>
                  <th className="px-2 py-1.5 text-right">Fills</th>
                  <th className="px-2 py-1.5 text-right">Spent</th>
                  <th className="px-2 py-1.5 text-right">Avg $/Gal</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.top_stations || []).map((s, i) => (
                  <tr key={i} className="border-t border-rmpg-800">
                    <td className="px-2 py-1 text-rmpg-200 truncate max-w-[200px]" title={s.station}>{s.station}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{s.fill_count}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-green-400">{fmtCurrency(s.total_spent)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{s.avg_cpg != null ? `$${s.avg_cpg.toFixed(3)}` : '—'}</td>
                  </tr>
                ))}
                {(overview?.top_stations || []).length === 0 && (
                  <tr><td colSpan={4} className="text-center text-[10px] text-rmpg-500 py-4">No stations recorded</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Per-officer */}
        <div className="panel-beveled bg-surface-sunken">
          <PanelTitleBar title="Drivers" icon={Users} />
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full text-[10px] font-mono">
              <thead className="bg-surface-raised sticky top-0">
                <tr className="text-left text-[9px] uppercase text-rmpg-500">
                  <th className="px-2 py-1.5">Driver</th>
                  <th className="px-2 py-1.5 text-right">Fills</th>
                  <th className="px-2 py-1.5 text-right">Gal</th>
                  <th className="px-2 py-1.5 text-right">Cost</th>
                  <th className="px-2 py-1.5 text-right">Avg MPG</th>
                  <th className="px-2 py-1.5 text-right">Flag %</th>
                </tr>
              </thead>
              <tbody>
                {byOfficer.map((o, i) => (
                  <tr key={i} className="border-t border-rmpg-800">
                    <td className="px-2 py-1 text-rmpg-200">
                      {o.display_name}
                      {o.officer_id == null && <span className="ml-1 text-[8px] text-rmpg-600">(no driver recorded)</span>}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{o.fill_count}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{o.total_gallons.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-green-400">{fmtCurrency(o.total_cost)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-brand-400">{o.avg_mpg != null ? o.avg_mpg.toFixed(1) : '—'}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${o.flag_rate > 10 ? 'text-amber-400' : 'text-rmpg-500'}`}>{o.flag_rate.toFixed(1)}%</td>
                  </tr>
                ))}
                {byOfficer.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-[10px] text-rmpg-500 py-4">No driver attribution recorded yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Per-card */}
        <div className="panel-beveled bg-surface-sunken">
          <PanelTitleBar title="Fuel Cards — Monthly Spend" icon={CreditCard} />
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full text-[10px] font-mono">
              <thead className="bg-surface-raised sticky top-0">
                <tr className="text-left text-[9px] uppercase text-rmpg-500">
                  <th className="px-2 py-1.5">Card</th>
                  <th className="px-2 py-1.5">Vehicle</th>
                  <th className="px-2 py-1.5 text-right">Spent</th>
                  <th className="px-2 py-1.5 text-right">Limit</th>
                  <th className="px-2 py-1.5">Utilization</th>
                </tr>
              </thead>
              <tbody>
                {byCard.map((c) => {
                  const status = c.spend_status;
                  const color = status === 'over' ? 'bg-red-600' : status === 'watch' ? 'bg-amber-500' : 'bg-green-500';
                  return (
                    <tr key={c.card_id} className="border-t border-rmpg-800">
                      <td className="px-2 py-1 text-rmpg-200">{c.card_number}{c.provider ? ` · ${c.provider}` : ''}</td>
                      <td className="px-2 py-1 text-rmpg-400">{c.vehicle_number ? `#${c.vehicle_number}` : '(unassigned)'}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-green-400">{fmtCurrency(c.spent)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{c.monthly_limit != null ? fmtCurrency(c.monthly_limit) : '—'}</td>
                      <td className="px-2 py-1 w-40">
                        {c.pct_of_limit != null ? (
                          <div className="flex items-center gap-1.5">
                            <div className="flex-1 h-2 bg-surface-base border border-rmpg-800 overflow-hidden">
                              <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, c.pct_of_limit)}%` }} />
                            </div>
                            <span className="text-[9px] tabular-nums text-rmpg-400 w-10 text-right">{c.pct_of_limit.toFixed(0)}%</span>
                          </div>
                        ) : <span className="text-[9px] text-rmpg-600">no limit</span>}
                      </td>
                    </tr>
                  );
                })}
                {byCard.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-[10px] text-rmpg-500 py-4">No fuel cards configured</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Flagged leaderboard */}
        {overview && overview.flagged_leaderboard.length > 0 && (
          <div className="panel-beveled bg-surface-sunken lg:col-span-2">
            <PanelTitleBar title="Flagged-Entry Leaderboard" icon={TrendingDown} />
            <div className="p-2 flex flex-wrap gap-2">
              {overview.flagged_leaderboard.map((v) => (
                <div key={v.id} className="panel-beveled bg-surface-base border border-amber-700/40 p-2 flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  <div>
                    <div className="text-[10px] font-bold text-rmpg-200">#{v.vehicle_number} {[v.make, v.model].filter(Boolean).join(' ')}</div>
                    <div className="text-[9px] font-mono text-amber-400">{v.flagged_count} flagged fills</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Small helpers ──────────────────────────────────────────────

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

function MonthlyTrendChart({ data }: { data: Array<{ month: string; cost: number; gallons: number; fills: number }> }) {
  const maxCost = useMemo(() => Math.max(...data.map(d => d.cost), 1), [data]);
  const maxGal = useMemo(() => Math.max(...data.map(d => d.gallons), 1), [data]);
  return (
    <div className="p-2">
      <div className="flex items-end gap-0.5 h-24">
        {data.map((d) => (
          <div key={d.month} className="flex-1 flex flex-col items-center justify-end h-full gap-px"
            title={`${d.month}: ${d.gallons.toFixed(1)} gal, $${d.cost.toFixed(2)}, ${d.fills} fills`}>
            <div className="w-full flex items-end justify-center gap-0.5 h-full">
              <div className="bg-cyan-600/60 w-1/2 border-t border-cyan-400" style={{ height: `${(d.gallons / maxGal) * 100}%`, minHeight: '1px' }} />
              <div className="bg-amber-600/60 w-1/2 border-t border-amber-400" style={{ height: `${(d.cost / maxCost) * 100}%`, minHeight: '1px' }} />
            </div>
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
      <div className="flex justify-center gap-3 mt-2 text-[8px] text-rmpg-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-cyan-400"></span>Gallons</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-400"></span>Cost</span>
      </div>
    </div>
  );
}
