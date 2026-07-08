// ============================================================
// RMPG Flex — Fleet.io Insights dashboard (PR 7b)
// ------------------------------------------------------------
// Consumes the /api/fleet-viz/* aggregate routes that shipped as PR 7-9
// backend (#1500). This route is intentionally scoped 'rmpg-only' in the
// sidebar because the moat charts (V7 calls-per-gallon) join RMPG-only
// data (officers + cad_units + calls_for_service) that Fleet.io's own
// dashboard literally can't query.
//
// PR 7b focuses on the foundations + the strongest moat:
//   F1: KPI ribbon (5 cells, period-switchable)
//   F3: Readiness board (per-vehicle status grid)
//   V7: Calls per gallon (the "why RMPG, not just Fleet.io" headline)
//
// Follow-up PRs (8b/9b) will add V1 Fleet Map, V2 PM Gantt, V3 MPG
// scatter, V4 cost-per-mile stack, V5 WO Sankey, V6 fuel anomalies,
// V8 PM-upcoming table — same pattern, each on its own card here.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { resolveMapboxAccessToken, initMapbox, isMapboxReady } from '../../../../utils/mapboxLoader';
import { applyRmpgBasemap } from '../../../../utils/mapboxBasemap';
import { isValidLngLat } from '../../../../utils/mapMarkers';
import {
  ResponsiveContainer, ScatterChart, Scatter,
  XAxis, YAxis, ZAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend,
} from 'recharts';
import { Check } from 'lucide-react';
import { apiFetchV2 } from '../hooks/apiFetchV2';
import { SectionHeader } from '../shell/SectionHeader';
import { useFleetV2View } from '../hooks/useFleetV2Audit';
import { useAuth } from '../../../../context/AuthContext';

// Resolve a CSS custom property to a literal hex/rgb string for recharts
// fills (recharts can't follow `var(--…)` at runtime — it copies the prop
// into a generated <path fill="…">). Falls back to the hard-coded brand
// hex if the var isn't on the element (e.g. SSR / pre-paint). Computed
// once per mount; theme switches don't re-color recharts visuals until
// the next route mount, which is acceptable for analytics screens.
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined' || !window.document) return fallback;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

// ─── Shared period switcher ─────────────────────────────────

type Period = '30d' | '90d' | 'ytd';
const PERIOD_LABELS: Record<Period, string> = { '30d': '30d', '90d': '90d', ytd: 'YTD' };

// ─── F1: KPI ribbon ────────────────────────────────────────

interface KpiResp {
  period: string;
  in_service: number;
  in_shop: number;
  overdue_pms: number;
  avg_mpg: number;
  cost_per_mile: number | null;
  total_cost: number;
  miles_driven: number;
}

function KpiRibbonFleetIo({ period }: { period: Period }) {
  const [data, setData] = useState<KpiResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null); setError(null);
    apiFetchV2<KpiResp>(`/fleet-viz/kpi?period=${period}`)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((err) => { if (!cancelled) setError(err?.message ?? 'Failed to load'); });
    return () => { cancelled = true; };
  }, [period]);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      <KpiCell label="In service" value={fmt(data?.in_service)} />
      <KpiCell label="In shop" value={fmt(data?.in_shop)} />
      <KpiCell label="Overdue PMs" value={fmt(data?.overdue_pms)} tone={data && data.overdue_pms > 0 ? 'warn' : 'normal'} />
      <KpiCell label="Avg MPG" value={data?.avg_mpg != null ? data.avg_mpg.toFixed(1) : '—'} />
      <KpiCell label="Cost / mi" value={fmtUsd(data?.cost_per_mile ?? undefined)} />
      {error ? <div className="col-span-full text-xs text-red-400">KPI: {error}</div> : null}
    </div>
  );
}

function KpiCell({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'warn' }) {
  return (
    <div className="rounded-sm border border-rmpg-700 bg-surface-raised px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-rmpg-400">{label}</div>
      <div className={`text-base font-semibold mt-0.5 ${tone === 'warn' ? 'text-amber-400' : 'text-rmpg-100'}`}>
        {value}
      </div>
    </div>
  );
}

// ─── F3: Readiness board ───────────────────────────────────

interface ReadinessRow {
  id: number;
  vehicle_name: string | null;
  vehicle_number: string | null;
  status: string;
  current_mileage: number | null;
  miles_to_pm: number | null;
  open_work_orders: number;
  last_inspection_failed: number | null;
  last_fuel_level: string | null;
}

function ReadinessCard() {
  const [rows, setRows] = useState<ReadinessRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetchV2<{ data: ReadinessRow[] }>('/fleet-viz/readiness')
      .then((r) => { if (!cancelled) setRows(r.data ?? []); })
      .catch((err) => { if (!cancelled) setError(err?.message ?? 'Failed to load'); });
    return () => { cancelled = true; };
  }, []);
  return (
    <Card title="Readiness board" hint={`${rows?.length ?? '—'} vehicles`}>
      {error ? <div className="text-xs text-red-400">{error}</div> :
       rows == null ? <Skeleton lines={6} /> :
       rows.length === 0 ? <div className="text-xs text-rmpg-400">No vehicles found.</div> :
       (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-rmpg-400 border-b border-rmpg-700">
              <th className="py-1 pr-2">Vehicle</th>
              <th className="py-1 px-2">Status</th>
              <th className="py-1 px-2 text-right">Miles to PM</th>
              <th className="py-1 px-2 text-right">Open WOs</th>
              <th className="py-1 px-2">Last insp</th>
              <th className="py-1 pl-2">Fuel</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((r) => (
              <tr key={r.id} className="border-b border-rmpg-800/40">
                <td className="py-1 pr-2 text-rmpg-100">
                  {r.vehicle_number ?? `#${r.id}`}{r.vehicle_name ? <span className="text-rmpg-400"> · {r.vehicle_name}</span> : null}
                </td>
                <td className="py-1 px-2"><StatusBadge status={r.status} /></td>
                <td className={`py-1 px-2 text-right ${typeof r.miles_to_pm === 'number' && r.miles_to_pm <= 0 ? 'text-red-400' : typeof r.miles_to_pm === 'number' && r.miles_to_pm <= 500 ? 'text-amber-400' : 'text-rmpg-100'}`}>
                  {typeof r.miles_to_pm === 'number' ? r.miles_to_pm.toLocaleString() : '—'}
                </td>
                <td className={`py-1 px-2 text-right ${r.open_work_orders > 0 ? 'text-amber-400' : 'text-rmpg-100'}`}>
                  {r.open_work_orders}
                </td>
                <td className="py-1 px-2">
                  {r.last_inspection_failed === 1
                    ? <span className="text-red-400">FAIL</span>
                    : r.last_inspection_failed === 0 ? <span className="text-emerald-400">PASS</span>
                    : <span className="text-rmpg-400">—</span>}
                </td>
                <td className="py-1 pl-2 text-rmpg-100">{r.last_fuel_level ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
       )}
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'in_service' ? 'bg-emerald-500/15 text-emerald-300' :
               status === 'maintenance' ? 'bg-amber-500/15 text-amber-300' :
               status === 'out_of_service' ? 'bg-red-500/15 text-red-300' :
               'bg-rmpg-700/40 text-rmpg-300';
  return <span className={`px-1.5 py-0.5 rounded-sm text-[10px] uppercase tracking-wide ${tone}`}>{status.replace(/_/g, ' ')}</span>;
}

// ─── V7: Calls per gallon — THE moat ───────────────────────

interface CallsPerGallonRow {
  officer_id: number;
  officer_name: string;
  total_gallons: number;
  calls_handled: number;
  calls_per_gallon: number;
}

function CallsPerGallonCard({ period }: { period: Period }) {
  const [rows, setRows] = useState<CallsPerGallonRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRows(null); setError(null);
    apiFetchV2<{ data: CallsPerGallonRow[] }>(`/fleet-viz/calls-per-gallon?period=${period}`)
      .then((r) => { if (!cancelled) setRows(r.data ?? []); })
      .catch((err) => { if (!cancelled) setError(err?.message ?? 'Failed to load'); });
    return () => { cancelled = true; };
  }, [period]);
  const max = rows && rows.length > 0 ? Math.max(...rows.map((r) => r.calls_per_gallon)) : 1;
  return (
    <Card
      title="Calls per gallon"
      hint="RMPG exclusive — Fleet.io can't build this"
      tone="moat"
    >
      {error ? <div className="text-xs text-red-400">{error}</div> :
       rows == null ? <Skeleton lines={6} /> :
       rows.length === 0 ? <div className="text-xs text-rmpg-400">No officer fuel data yet for this period.</div> :
       (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-rmpg-400 border-b border-rmpg-700">
              <th className="py-1 pr-2">Officer</th>
              <th className="py-1 px-2 text-right">Calls</th>
              <th className="py-1 px-2 text-right">Gallons</th>
              <th className="py-1 pl-2 text-right">Calls/gal</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 15).map((r) => (
              <tr key={r.officer_id} className="border-b border-rmpg-800/40">
                <td className="py-1 pr-2 text-rmpg-100">{r.officer_name}</td>
                <td className="py-1 px-2 text-right text-rmpg-100">{r.calls_handled.toLocaleString()}</td>
                <td className="py-1 px-2 text-right text-rmpg-100">{r.total_gallons.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                <td className="py-1 pl-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-20 h-1.5 bg-rmpg-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-500"
                        style={{ width: `${max > 0 ? (r.calls_per_gallon / max) * 100 : 0}%` }}
                        role="presentation"
                      />
                    </div>
                    <span className="text-rmpg-100 font-mono w-12 text-right">{r.calls_per_gallon.toFixed(2)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
       )}
    </Card>
  );
}

// ─── Layout helpers ────────────────────────────────────────

function Card({
  title, hint, tone = 'normal', children,
}: {
  title: string; hint?: string; tone?: 'normal' | 'moat'; children: React.ReactNode;
}) {
  const accent = tone === 'moat' ? 'border-brand-500/40' : 'border-rmpg-700';
  return (
    <div className={`rounded-sm border ${accent} bg-surface-raised p-4`}>
      <div className="flex items-baseline justify-between mb-2 gap-3">
        <h2 className="text-sm font-semibold text-rmpg-100">{title}</h2>
        {hint ? <span className={`text-[10px] uppercase tracking-wide ${tone === 'moat' ? 'text-brand-400' : 'text-rmpg-400'}`}>{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Skeleton({ lines }: { lines: number }) {
  return (
    <div className="space-y-1.5 animate-pulse">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 bg-rmpg-800 rounded-sm" />
      ))}
    </div>
  );
}

function PeriodChips({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className="inline-flex rounded-sm border border-rmpg-700 overflow-hidden text-xs" role="group" aria-label="Period">
      {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={period === p}
          onClick={() => onChange(p)}
          className={`px-2.5 py-1 ${period === p ? 'bg-brand-500/20 text-brand-300' : 'text-rmpg-400 hover:text-rmpg-100'}`}
        >
          {PERIOD_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

function fmt(n: number | null | undefined): string {
  return typeof n === 'number' ? n.toLocaleString() : '—';
}
function fmtUsd(n: number | null | undefined): string {
  if (typeof n !== 'number') return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

// ─── Route ─────────────────────────────────────────────────

const PERIOD_STORAGE_BASE = 'rmpg_fleet_insights_period';

// Per-user scoping — shared-workstation pattern is real here (dispatch ↔
// patrol on the same MDT); without the suffix everyone shared a key and
// the last officer's preference clobbered the next one's. Anonymous /
// pre-auth fall back to the bare key so the helper still works in tests
// and the (rare) un-logged-in state. Pattern mirrors LawBookPage's
// `rmpg_lawbook_recent_<user.id>` key. The OLD bare key is read once as
// a one-time migration so existing operators don't lose their choice.
function periodKey(userId: string | number | undefined): string {
  return userId != null ? `${PERIOD_STORAGE_BASE}_${userId}` : PERIOD_STORAGE_BASE;
}

// Pull initial period from localStorage so the choice persists across reloads
// (PR 9b saved-view persistence). Falls back to '90d' for fresh installs and
// silently to in-memory state if localStorage is unavailable (SSR / private).
export function readSavedPeriod(userId?: string | number): Period {
  if (typeof window === 'undefined' || !window.localStorage) return '90d';
  try {
    const k = periodKey(userId);
    let raw = window.localStorage.getItem(k);
    // One-time migration from the shared bare key.
    if (!raw && userId != null) {
      raw = window.localStorage.getItem(PERIOD_STORAGE_BASE);
      if (raw === '30d' || raw === '90d' || raw === 'ytd') {
        try { window.localStorage.setItem(k, raw); } catch { /* quota — silent */ }
      }
    }
    if (raw === '30d' || raw === '90d' || raw === 'ytd') return raw;
  } catch { /* private mode → fall through */ }
  return '90d';
}

function savePeriod(period: Period, userId?: string | number): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try { window.localStorage.setItem(periodKey(userId), period); } catch { /* quota / private — silent */ }
}

export function InsightsRoute() {
  useFleetV2View('/fleet/v2/insights');
  const { user } = useAuth();
  const uid = user?.id;
  const [period, setPeriodState] = useState<Period>(() => readSavedPeriod(uid));
  const setPeriod = (next: Period) => { setPeriodState(next); savePeriod(next, uid); };
  return (
    <div className="h-full flex flex-col">
      <SectionHeader
        title="Insights"
        actions={<PeriodChips period={period} onChange={setPeriod} />}
      />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <KpiRibbonFleetIo period={period} />
        <FleetMapCard />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ReadinessCard />
          <CallsPerGallonCard period={period} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MpgByOfficerScatterCard period={period} />
          <CostPerMileStackCard period={period} />
        </div>
        <FuelAnomaliesCard period={period} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PmUpcomingCard />
          <WorkOrderFlowCard period={period} />
        </div>
        <PmTimelineCard />
        <p className="text-[10px] text-rmpg-500 pt-2">
          Backed by <code>/api/fleet-viz/*</code> aggregates (PR 7-9 backend #1500). Period persisted per-user to localStorage (<code>{periodKey(uid)}</code>).
        </p>
      </div>
    </div>
  );
}

// ─── V3: MPG by officer (scatter) ─────────────────────────

interface MpgByOfficerResp {
  period: string;
  samples: { officer_id: number; officer_name: string; mpg: number; gallons: number; fuel_date: string }[];
  by_officer: { officer_id: number; officer_name: string; samples: number; mean_mpg: number; total_gallons: number; total_cost: number }[];
}

function MpgByOfficerScatterCard({ period }: { period: Period }) {
  const [data, setData] = useState<MpgByOfficerResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null); setErr(null);
    apiFetchV2<MpgByOfficerResp>(`/fleet-viz/mpg-by-officer?period=${period}`)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setErr(e?.message ?? 'Failed to load'); });
    return () => { cancelled = true; };
  }, [period]);
  return (
    <Card
      title="MPG by officer"
      hint="RMPG exclusive — joins fuel + officers"
      tone="moat"
    >
      {err ? <div className="text-xs text-red-400">{err}</div> :
       data == null ? <Skeleton lines={6} /> :
       !Array.isArray(data.by_officer) || data.by_officer.length === 0 ? <div className="text-xs text-rmpg-400">No officer-tagged fuel entries this period.</div> :
       (
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="#1e293b" />
              <XAxis
                type="number"
                dataKey="total_gallons"
                name="Gallons"
                tick={{ fill: 'var(--text-muted, #94a3b8)', fontSize: 9 }}
                label={{ value: 'Total gallons', position: 'insideBottom', offset: -4, fill: 'var(--text-muted, #94a3b8)', fontSize: 9 }}
              />
              <YAxis
                type="number"
                dataKey="mean_mpg"
                name="Mean MPG"
                tick={{ fill: 'var(--text-muted, #94a3b8)', fontSize: 9 }}
                label={{ value: 'Mean MPG', angle: -90, position: 'insideLeft', fill: 'var(--text-muted, #94a3b8)', fontSize: 9 }}
              />
              <ZAxis type="number" dataKey="samples" range={[40, 240]} name="Sample count" />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', fontSize: 10 }}
                formatter={(value, name) => [typeof value === 'number' ? value.toFixed(1) : value, name]}
                labelFormatter={() => ''}
              />
              <Scatter data={data.by_officer} fill={cssVar('--brand-gold', '#d4a017')} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
       )}
    </Card>
  );
}

// ─── V4: Cost per mile stack ──────────────────────────────

interface CostPerMileResp {
  period: string;
  count: number;
  data: { vehicle_id: number; vehicle_number: string | null; vehicle_name: string | null; miles: number; fuel: number; maintenance: number; parts: number; total: number; cost_per_mile: number | null }[];
}

function CostPerMileStackCard({ period }: { period: Period }) {
  const [data, setData] = useState<CostPerMileResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null); setErr(null);
    apiFetchV2<CostPerMileResp>(`/fleet-viz/cost-per-mile?period=${period}`)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setErr(e?.message ?? 'Failed to load'); });
    return () => { cancelled = true; };
  }, [period]);
  const topRows = (Array.isArray(data?.data) ? data!.data : [])
    .filter((r) => r.miles > 0)
    .sort((a, b) => (b.cost_per_mile ?? 0) - (a.cost_per_mile ?? 0))
    .slice(0, 10)
    .map((r) => ({
      name: r.vehicle_number ?? r.vehicle_name ?? `#${r.vehicle_id}`,
      fuel: r.fuel,
      maintenance: r.maintenance,
      parts: r.parts,
      total: r.total,
      cpm: r.cost_per_mile ?? 0,
    }));
  return (
    <Card title="Cost per mile — top 10" hint={`${data?.count ?? '—'} vehicles`}>
      {err ? <div className="text-xs text-red-400">{err}</div> :
       data == null ? <Skeleton lines={6} /> :
       topRows.length === 0 ? <div className="text-xs text-rmpg-400">No vehicles with mileage this period.</div> :
       (
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={topRows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="#1e293b" />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-muted, #94a3b8)', fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={48} />
              <YAxis tick={{ fill: 'var(--text-muted, #94a3b8)', fontSize: 9 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', fontSize: 10 }}
                formatter={(value, name) => [typeof value === 'number' ? `$${value.toFixed(2)}` : value, name]}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="fuel" stackId="a" fill="#3b82f6" />
              <Bar dataKey="maintenance" stackId="a" fill={cssVar('--brand-gold', '#d4a017')} />
              <Bar dataKey="parts" stackId="a" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
       )}
    </Card>
  );
}

// ─── V6: Fuel anomalies ───────────────────────────────────

interface FuelAnomalyEntry {
  id: number; fuel_date: string; gallons: number; total_cost: number;
  // Server returns driver_name (TEXT) — fleet_fuel_log has no driver_id column.
  driver_name: string | null; vehicle_id: number;
  cost_per_gallon: number; z_gallons: number; z_cost_per_gallon: number;
  flagged: boolean;
}

interface FuelAnomaliesResp { period: string; count: number; data: FuelAnomalyEntry[]; }

function FuelAnomaliesCard({ period }: { period: Period }) {
  const [data, setData] = useState<FuelAnomaliesResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null); setErr(null);
    apiFetchV2<FuelAnomaliesResp>(`/fleet-viz/fuel-anomalies?period=${period}`)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setErr(e?.message ?? 'Failed to load'); });
    return () => { cancelled = true; };
  }, [period]);
  const flagged = (Array.isArray(data?.data) ? data!.data : []).filter((e) => e.flagged);
  return (
    <Card title="Fuel anomalies" hint={`${flagged.length} flagged (|z|>2)`}>
      {err ? <div className="text-xs text-red-400">{err}</div> :
       data == null ? <Skeleton lines={6} /> :
       flagged.length === 0 ? (
         <div className="text-[10px] text-emerald-400 px-2 py-1 border border-emerald-500/40 rounded-sm bg-emerald-500/10 inline-flex items-center gap-1">
           <Check className="w-3 h-3" aria-hidden="true" /> No anomalies this period.
         </div>
       ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-left text-rmpg-400 border-b border-rmpg-700">
                <th className="py-1 pr-2">Date</th>
                <th className="py-1 px-2">Vehicle</th>
                <th className="py-1 px-2 text-right">Gallons</th>
                <th className="py-1 px-2 text-right">$/gal</th>
                <th className="py-1 px-2 text-right">z(gal)</th>
                <th className="py-1 pl-2 text-right">z($/gal)</th>
              </tr>
            </thead>
            <tbody>
              {flagged.slice(0, 12).map((e) => (
                <tr key={e.id} className="border-b border-rmpg-800/40">
                  <td className="py-1 pr-2 font-mono text-rmpg-300">{e.fuel_date.slice(0, 10)}</td>
                  <td className="py-1 px-2 text-rmpg-100">#{e.vehicle_id}</td>
                  <td className="py-1 px-2 text-right text-rmpg-100">{e.gallons.toFixed(1)}</td>
                  <td className="py-1 px-2 text-right text-rmpg-100">${e.cost_per_gallon.toFixed(2)}</td>
                  <td className={`py-1 px-2 text-right font-mono ${Math.abs(e.z_gallons) > 2 ? 'text-amber-400' : 'text-rmpg-300'}`}>
                    {e.z_gallons.toFixed(2)}
                  </td>
                  <td className={`py-1 pl-2 text-right font-mono ${Math.abs(e.z_cost_per_gallon) > 2 ? 'text-amber-400' : 'text-rmpg-300'}`}>
                    {e.z_cost_per_gallon.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
       )}
    </Card>
  );
}

// ─── V8: PM upcoming (table) ─────────────────────────────

interface PmUpcomingResp {
  count: number;
  data: {
    id: number;
    vehicle_number: string | null;
    vehicle_name: string | null;
    current_mileage: number | null;
    next_service_mileage: number | null;
    next_service_date: string | null;
    miles_to_pm: number | null;
  }[];
}

function PmUpcomingCard() {
  const [data, setData] = useState<PmUpcomingResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null); setErr(null);
    apiFetchV2<PmUpcomingResp>('/fleet-viz/pm-upcoming?limit=12')
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setErr(e?.message ?? 'Failed to load'); });
    return () => { cancelled = true; };
  }, []);
  const rows = Array.isArray(data?.data) ? data!.data : [];
  const overdueCount = rows.filter((r) => (r.miles_to_pm ?? 0) <= 0).length;
  return (
    <Card
      title="PM upcoming"
      hint={overdueCount > 0 ? `${overdueCount} overdue` : `${rows.length} due soon`}
    >
      {err ? <div className="text-xs text-red-400">{err}</div> :
       data == null ? <Skeleton lines={6} /> :
       rows.length === 0 ? <div className="text-xs text-rmpg-400">No PMs scheduled.</div> :
       (
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-left text-rmpg-400 border-b border-rmpg-700">
              <th className="py-1 pr-2">Vehicle</th>
              <th className="py-1 px-2 text-right">Current mi</th>
              <th className="py-1 px-2 text-right">Next at</th>
              <th className="py-1 px-2 text-right">Miles to PM</th>
              <th className="py-1 pl-2">By date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const overdue = (r.miles_to_pm ?? 0) <= 0;
              return (
                <tr key={r.id} className="border-b border-rmpg-800/40">
                  <td className="py-1 pr-2 text-rmpg-100">{r.vehicle_number ?? r.vehicle_name ?? `#${r.id}`}</td>
                  <td className="py-1 px-2 text-right font-mono text-rmpg-300">{fmt(r.current_mileage)}</td>
                  <td className="py-1 px-2 text-right font-mono text-rmpg-300">{fmt(r.next_service_mileage)}</td>
                  <td className={`py-1 px-2 text-right font-mono ${overdue ? 'text-red-400 font-semibold' : 'text-rmpg-100'}`}>
                    {r.miles_to_pm == null ? '—' : fmt(r.miles_to_pm)}
                  </td>
                  <td className="py-1 pl-2 font-mono text-rmpg-300">{(r.next_service_date ?? '').slice(0, 10) || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
       )}
    </Card>
  );
}

// ─── V5: Work order flow (status counts) ──────────────────

interface WoFlowResp {
  period: string;
  nodes: { name: string; count: number }[];
}

const WO_STATUS_TONES: Record<string, string> = {
  open: '#f59e0b',
  in_progress: '#3b82f6',
  waiting_parts: '#a855f7',
  completed: '#10b981',
  cancelled: '#64748b',
};

function WorkOrderFlowCard({ period }: { period: Period }) {
  const [data, setData] = useState<WoFlowResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null); setErr(null);
    apiFetchV2<WoFlowResp>(`/fleet-viz/work-order-flow?period=${period}`)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setErr(e?.message ?? 'Failed to load'); });
    return () => { cancelled = true; };
  }, [period]);
  const nodes = Array.isArray(data?.nodes) ? data!.nodes : [];
  const total = nodes.reduce((s, n) => s + (n.count ?? 0), 0);
  return (
    <Card title="Work order flow" hint={`${total} total`}>
      {err ? <div className="text-xs text-red-400">{err}</div> :
       data == null ? <Skeleton lines={4} /> :
       total === 0 ? <div className="text-xs text-rmpg-400">No work orders this period.</div> :
       (
         <div className="space-y-2">
           {/* Horizontal stacked bar — 100% width split by status. The Sankey
               proper would need d3-sankey + edge weights; with only nodes
               (no transition counts in the data), a stacked bar conveys the
               same total breakdown more honestly. */}
           <div className="w-full h-6 flex rounded-sm overflow-hidden border border-rmpg-700">
             {nodes.filter((n) => n.count > 0).map((n) => (
               <div
                 key={n.name}
                 title={`${n.name}: ${n.count}`}
                 style={{
                   width: `${(n.count / total) * 100}%`,
                   background: WO_STATUS_TONES[n.name] ?? '#475569',
                 }}
               />
             ))}
           </div>
           <table className="w-full text-[10px]">
             <tbody>
               {nodes.map((n) => (
                 <tr key={n.name} className="border-b border-rmpg-800/40">
                   <td className="py-1 pr-2">
                     <span
                       className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle"
                       style={{ background: WO_STATUS_TONES[n.name] ?? '#475569' }}
                     />
                     <span className="text-rmpg-100">{n.name.replace('_', ' ')}</span>
                   </td>
                   <td className="py-1 text-right font-mono text-rmpg-100">{n.count.toLocaleString()}</td>
                   <td className="py-1 pl-2 text-right text-rmpg-400 w-12">
                     {total > 0 ? `${((n.count / total) * 100).toFixed(0)}%` : '—'}
                   </td>
                 </tr>
               ))}
             </tbody>
           </table>
         </div>
       )}
    </Card>
  );
}

// ─── V2: PM timeline (overdue / upcoming / future bucketed) ────

interface PmTimelineResp {
  horizon_days: number;
  count: number;
  data: {
    vehicle_id: number;
    vehicle_number: string | null;
    vehicle_name: string | null;
    next_service_date: string | null;
    next_service_mileage: number | null;
    current_mileage: number | null;
    bucket: 'overdue' | 'upcoming' | 'future';
  }[];
}

const BUCKET_TONES: Record<string, string> = {
  overdue: 'bg-red-500/15 text-red-300 border-red-500/40',
  upcoming: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  future: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
};

function PmTimelineCard() {
  const [data, setData] = useState<PmTimelineResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null); setErr(null);
    apiFetchV2<PmTimelineResp>('/fleet-viz/pm-timeline?horizon_days=90')
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setErr(e?.message ?? 'Failed to load'); });
    return () => { cancelled = true; };
  }, []);
  const rows = Array.isArray(data?.data) ? data!.data : [];
  const counts = { overdue: 0, upcoming: 0, future: 0 };
  for (const r of rows) counts[r.bucket] = (counts[r.bucket] ?? 0) + 1;
  return (
    <Card
      title="PM timeline (90-day horizon)"
      hint={`${counts.overdue} overdue · ${counts.upcoming} upcoming · ${counts.future} future`}
    >
      {err ? <div className="text-xs text-red-400">{err}</div> :
       data == null ? <Skeleton lines={5} /> :
       rows.length === 0 ? <div className="text-xs text-rmpg-400">No vehicles with PM schedule.</div> :
       (
         <div className="overflow-x-auto">
           <table className="w-full text-[10px]">
             <thead>
               <tr className="text-left text-rmpg-400 border-b border-rmpg-700">
                 <th className="py-1 pr-2">Vehicle</th>
                 <th className="py-1 px-2">Bucket</th>
                 <th className="py-1 px-2 text-right">Current mi</th>
                 <th className="py-1 px-2 text-right">PM at mi</th>
                 <th className="py-1 pl-2">PM by date</th>
               </tr>
             </thead>
             <tbody>
               {rows.slice(0, 16).map((r) => (
                 <tr key={r.vehicle_id} className="border-b border-rmpg-800/40">
                   <td className="py-1 pr-2 text-rmpg-100">{r.vehicle_number ?? r.vehicle_name ?? `#${r.vehicle_id}`}</td>
                   <td className="py-1 px-2">
                     <span className={`px-1.5 py-0.5 rounded-sm text-[9px] uppercase tracking-wide border ${BUCKET_TONES[r.bucket] ?? ''}`}>
                       {r.bucket}
                     </span>
                   </td>
                   <td className="py-1 px-2 text-right font-mono text-rmpg-300">{fmt(r.current_mileage)}</td>
                   <td className="py-1 px-2 text-right font-mono text-rmpg-300">{fmt(r.next_service_mileage)}</td>
                   <td className="py-1 pl-2 font-mono text-rmpg-300">{(r.next_service_date ?? '').slice(0, 10) || '—'}</td>
                 </tr>
               ))}
             </tbody>
           </table>
           {rows.length > 16 ? (
             <div className="text-[9px] text-rmpg-500 mt-1">+ {rows.length - 16} more vehicles</div>
           ) : null}
         </div>
       )}
    </Card>
  );
}

// ─── V1: Fleet Map (Mapbox) ───────────────────────────────

interface FleetMapResp {
  count: number;
  data: {
    id: number;
    vehicle_name: string | null;
    vehicle_number: string | null;
    status: string | null;
    current_mileage: number | null;
    next_service_mileage: number | null;
    miles_to_pm: number | null;
    assigned_unit_id: number | null;
    lat: number | null;
    lng: number | null;
    gps_ts: string | null;
    readiness: 'ready' | 'attention' | 'unavailable';
  }[];
}

const READINESS_COLORS: Record<string, string> = {
  ready: '#10b981',       // emerald-500
  attention: '#f59e0b',   // amber-500
  unavailable: '#64748b', // slate-500
};

// Salt Lake City defaults — the operator base. Mapbox falls back to a wider
// fit if any markers land outside this view.
const DEFAULT_CENTER: [number, number] = [-111.89, 40.76];
const DEFAULT_ZOOM = 11;

function FleetMapCard() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  // Monotonic counter for the rebuild effect — if `data` lands twice in quick
  // succession the older invocation aborts before it touches markers, so a
  // poll + manual refresh interleave can't tear down the freshly-built batch.
  const rebuildGen = useRef(0);
  const [data, setData] = useState<FleetMapResp | null>(null);
  // Split error sources: a /fleet-viz/fleet-map 500 (back-end SQL) is NOT
  // the same as a Mapbox-side failure (missing access token). They used to
  // share one `err` so a transient API hiccup falsely flashed "MAPBOX
  // UNAVAILABLE" — confusing operators because mapbox.com itself was fine.
  const [dataErr, setDataErr] = useState<string | null>(null);
  const [mapErr, setMapErr] = useState<string | null>(null);

  // Fetch once on mount. The endpoint is cheap (single fleet_vehicles scan +
  // a correlated subquery per row to grab the freshest breadcrumb), so a
  // single 30 s polling refresh keeps the marker positions live without
  // pounding the GPS table.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiFetchV2<FleetMapResp>('/fleet-viz/fleet-map')
        .then((r) => { if (!cancelled) { setData(r); setDataErr(null); } })
        .catch((e) => { if (!cancelled) setDataErr(e?.message ?? 'Failed to load'); });
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Initialize the Mapbox instance once the container is mounted.
  // Re-initializing on every data change would be wasteful — instead we keep
  // the map alive and only rebuild markers below when `data` changes.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    // If the token wasn't injected at build time the Mapbox constructor will
    // throw "An API access token is required to use Mapbox GL." — fail soft
    // by surfacing the error in the card rather than crashing the dashboard.
    (async () => {
      try {
        // mapboxLoader.ts sets mapboxgl.accessToken at module-import time from
        // VITE_MAPBOX_ACCESS_TOKEN, so a token at build time gets us in directly;
        // otherwise resolveMapboxAccessToken() pulls it from the worker proxy
        // (/api/integrations/mapbox/client-token). Either way the access token
        // is set before `new mapboxgl.Map` runs.
        if (!isMapboxReady()) {
          const token = await resolveMapboxAccessToken();
          if (cancelled) return;
          if (!token) {
            setMapErr('An API access token is required to use Mapbox GL.');
            return;
          }
          initMapbox(token);
        }
        if (cancelled || !containerRef.current) return;
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          attributionControl: false,
        });
        map.addControl(new mapboxgl.AttributionControl({ compact: true }));
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
        mapRef.current = map;
        // Clear any prior mapErr (e.g. a transient init failure) — a
        // successful map init means Mapbox is alive. Without this, the
        // "MAPBOX UNAVAILABLE" chip persists even after the map renders.
        if (!cancelled) setMapErr(null);
      } catch (e) {
        if (!cancelled) setMapErr(e instanceof Error ? e.message : 'Mapbox initialization failed');
      }
    })();
    return () => {
      // Tear down on unmount only (when the card itself goes away).
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Rebuild markers whenever fleet data lands. Drops the prior batch so we
  // don't pile dot-marker DOM nodes on every 30 s refresh. The generation
  // counter aborts mid-rebuild if a fresher `data` arrived — otherwise a poll
  // + manual refresh interleave could remove the just-added markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    const myGen = ++rebuildGen.current;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // isValidLngLat rejects NaN/Infinity AND the exact (0,0) no-fix signature
    // ClearPath emits before its first GPS lock, so an idle vehicle without a
    // GPS fix doesn't ghost on the African coast.
    // Optional-chain `data.data` — a partial response (200 with `{}`) would
    // otherwise crash the rebuild effect with "Cannot read properties of
    // undefined (reading 'filter')". The /fleet-map handler always returns
    // `{ count, data: [...] }`, but a future shape drift shouldn't be a TypeError.
    const located = (data.data ?? []).filter((v) => isValidLngLat(v.lng, v.lat));
    if (located.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    for (const v of located) {
      if (myGen !== rebuildGen.current) return;
      const el = document.createElement('div');
      el.style.cssText = `
        width: 14px; height: 14px; border-radius: 50%;
        background: ${READINESS_COLORS[v.readiness] ?? '#64748b'};
        border: 2px solid #0d1722; cursor: pointer;
        box-shadow: 0 0 4px rgba(0,0,0,0.6);
      `;
      const label = v.vehicle_number ?? v.vehicle_name ?? `#${v.id}`;
      // Popup color inherits via `currentColor` instead of a hardcoded hex —
      // if the popup ever renders on a light-themed surface (or if the brand
      // palette shifts), the text follows the surrounding theme tokens
      // instead of staying frozen at `#0d1722`.
      const popup = new mapboxgl.Popup({ offset: 12, closeButton: false }).setHTML(`
        <div class="rmpg-fleet-popup" style="font: 11px monospace; color: currentColor;">
          <div style="font-weight: 600;">${escapeHtml(label)}</div>
          <div>readiness: <strong>${v.readiness}</strong></div>
          ${v.miles_to_pm != null ? `<div>miles to PM: ${v.miles_to_pm.toLocaleString()}</div>` : ''}
          ${v.gps_ts ? `<div style="opacity: .7;">last seen ${escapeHtml(v.gps_ts)}</div>` : ''}
        </div>
      `);
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([v.lng as number, v.lat as number])
        .setPopup(popup)
        .addTo(map);
      markersRef.current.push(marker);
      bounds.extend([v.lng as number, v.lat as number]);
    }
    if (located.length > 1) {
      map.fitBounds(bounds, { padding: 40, maxZoom: 13, duration: 0 });
    } else {
      map.setCenter([located[0].lng as number, located[0].lat as number]);
      map.setZoom(13);
    }
  }, [data]);

  const located = data?.data?.filter((v) => isValidLngLat(v.lng, v.lat)) ?? [];
  const counts = { ready: 0, attention: 0, unavailable: 0 };
  for (const v of located) counts[v.readiness] = (counts[v.readiness] ?? 0) + 1;

  // Two distinct failure modes, two distinct labels.
  const hint = mapErr
    ? 'mapbox unavailable'
    : dataErr
    ? 'fleet feed unavailable'
    : data
    ? `${located.length} located · ${counts.ready} ready · ${counts.attention} attention · ${counts.unavailable} offline`
    : 'loading…';
  return (
    <Card title="Fleet map" hint={hint}>
      {mapErr ? (
        <div className="text-xs text-amber-300 px-3 py-2 border border-amber-500/40 rounded-sm bg-amber-500/10">
          {mapErr}
          {mapErr.includes('access token') ? (
            <div className="mt-1 text-[10px] text-amber-200/70">
              Set <code>VITE_MAPBOX_ACCESS_TOKEN</code> in <code>client/.env</code> or Cloudflare Pages env vars.
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div
            ref={containerRef}
            className="w-full rounded-sm border border-rmpg-700 overflow-hidden"
            style={{ height: 320 }}
            aria-label="Fleet vehicle map"
          />
          {dataErr ? (
            <div className="mt-2 text-[10px] text-amber-300 px-2 py-1 border border-amber-500/40 rounded-sm bg-amber-500/10">
              Vehicle positions are temporarily unavailable: {dataErr}
            </div>
          ) : null}
        </>
      )}
      {data && located.length === 0 && !mapErr && !dataErr ? (
        <div className="mt-2 text-[10px] text-rmpg-400">
          No vehicles have a recent GPS breadcrumb (vehicles need <code>assigned_unit_id</code> + a row in <code>gps_breadcrumbs</code> to plot).
        </div>
      ) : null}
    </Card>
  );
}

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
