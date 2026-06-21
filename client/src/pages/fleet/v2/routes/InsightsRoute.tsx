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
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../hooks/useApi';
import { SectionHeader } from '../shell/SectionHeader';
import { useFleetV2View } from '../hooks/useFleetV2Audit';

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
    apiFetch<KpiResp>(`/fleet-viz/kpi?period=${period}`)
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
    apiFetch<{ data: ReadinessRow[] }>('/fleet-viz/readiness')
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
               status === 'in_shop' ? 'bg-amber-500/15 text-amber-300' :
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
    apiFetch<{ data: CallsPerGallonRow[] }>(`/fleet-viz/calls-per-gallon?period=${period}`)
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

export function InsightsRoute() {
  useFleetV2View('/fleet/v2/insights');
  const [period, setPeriod] = useState<Period>('90d');
  return (
    <div className="h-full flex flex-col">
      <SectionHeader
        title="Insights"
        actions={<PeriodChips period={period} onChange={setPeriod} />}
      />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <KpiRibbonFleetIo period={period} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ReadinessCard />
          <CallsPerGallonCard period={period} />
        </div>
        <p className="text-[10px] text-rmpg-500 pt-2">
          Backed by <code>/api/fleet-viz/*</code> aggregates landed in PR 7-9 backend (#1500). Additional charts (V1 Fleet Map, V3 MPG-by-officer, V4 cost-per-mile, V6 fuel anomalies) land in follow-up PRs.
        </p>
      </div>
    </div>
  );
}
