// ============================================================
// HR Console — Corporate Ops tab (clock / fleet / dispatch / map / serve)
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Link2, Play, RefreshCw, Loader2 } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import PanelTitleBar from '../../../components/PanelTitleBar';

interface Snapshot {
  day: string;
  clocked_in_now: number;
  scheduled_today: number;
  hours_today: number;
  duty_miles_today: number;
  serve_attempts_today: number;
  fleet_service_due: number;
  mileage_flags_today: number;
  handbook_pending?: number;
  cost_per_mile_30d?: number | null;
  low_fuel_units?: Array<{ id: number; vehicle_number: string | null; fuel_level: number | null }>;
  on_duty: Array<{ officer_id: number; full_name: string; call_sign: string | null; vehicle_number: string | null }>;
  recent_runs: Array<{ id: number; kind: string; status: string; item_count: number; started_at: string }>;
}

interface Enhancer {
  id: number;
  feature: string;
  change: string;
  benefit: string;
}

const RUN_KINDS = [
  { kind: 'nightly_bundle', label: 'Nightly bundle' },
  { kind: 'mileage_reconcile', label: 'Mileage reconcile' },
  { kind: 'payroll_clock_sync', label: 'Payroll from clocks' },
  { kind: 'attendance_tardy', label: 'Tardy backfill' },
  { kind: 'shift_unattended', label: 'Unattended shifts' },
  { kind: 'stale_open_shifts', label: 'Stale open shifts' },
  { kind: 'serve_duty_gaps', label: 'Serve off-clock' },
  { kind: 'fleet_service_due', label: 'Fleet service due' },
];

export default function CorporateOpsTab() {
  const { addToast } = useToast();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [enhancers, setEnhancers] = useState<Enhancer[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, e] = await Promise.all([
        apiFetch<Snapshot>('/corporate-ops/snapshot'),
        apiFetch<{ enhancers: Enhancer[] }>('/corporate-ops/enhancers'),
      ]);
      setSnap(s);
      setEnhancers(e.enhancers ?? []);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to load corporate ops', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { void load(); }, [load]);

  const run = async (kind: string) => {
    setRunning(kind);
    try {
      await apiFetch('/corporate-ops/runs', { method: 'POST', body: JSON.stringify({ kind }) });
      addToast(`Workflow ${kind} started`, 'success');
      await load();
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Run failed', 'error');
    } finally {
      setRunning(null);
    }
  };

  const cards = snap ? [
    { label: 'Clocked in', value: snap.clocked_in_now },
    { label: 'Scheduled today', value: snap.scheduled_today },
    { label: 'Hours today', value: Number(snap.hours_today ?? 0).toFixed(1) },
    { label: 'Duty miles', value: Number(snap.duty_miles_today ?? 0).toFixed(1) },
    { label: 'Serve attempts', value: snap.serve_attempts_today },
    { label: 'Fleet due', value: snap.fleet_service_due },
    { label: 'Mileage flags', value: snap.mileage_flags_today },
    { label: 'Handbook pending', value: snap.handbook_pending ?? 0 },
    { label: 'Low fuel cars', value: snap.low_fuel_units?.length ?? 0 },
    { label: 'CPM 30d', value: snap.cost_per_mile_30d != null ? `$${Number(snap.cost_per_mile_30d).toFixed(2)}` : '—' },
  ] : [];

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="CORPORATE OPS" icon={Link2}>
        <button type="button" onClick={() => void load()} className="text-rmpg-400 hover:text-rmpg-100 p-1" aria-label="Refresh corporate snapshot">
          <RefreshCw size={14} />
        </button>
      </PanelTitleBar>
      {loading && !snap ? (
        <div className="flex items-center gap-2 text-rmpg-400 text-xs"><Loader2 size={14} className="animate-spin" /> Loading linkage…</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2">
          {cards.map((c) => (
            <div key={c.label} className="panel-beveled p-2.5 text-center bg-surface-raised">
              <div className="text-sm font-mono font-bold text-rmpg-100">{c.value}</div>
              <div className="text-[8px] uppercase text-[color:var(--field-label-color)]">{c.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {RUN_KINDS.map((r) => (
          <button
            key={r.kind}
            type="button"
            disabled={running != null}
            onClick={() => void run(r.kind)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wide border border-rmpg-600 bg-surface-raised text-rmpg-200 hover:border-accent-silver-500 disabled:opacity-50"
          >
            {running === r.kind ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            {r.label}
          </button>
        ))}
      </div>

      {snap?.on_duty && snap.on_duty.length > 0 && (
        <div className="panel-beveled p-3">
          <h3 className="text-[9px] uppercase font-semibold mb-2" style={{ color: 'var(--panel-header-color)' }}>On duty (clock + unit + vehicle)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {snap.on_duty.map((o) => (
              <div key={o.officer_id} className="text-[11px] text-rmpg-200 font-mono">
                {o.full_name} · {o.call_sign ?? '—'} · {o.vehicle_number ?? 'no car'}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel-beveled overflow-x-auto bg-surface-sunken">
        <table className="table-dark w-full">
          <thead>
            <tr>
              <th className="text-left w-8">#</th>
              <th className="text-left">Function / Feature / Repair</th>
              <th className="text-left">What was added, upgraded, and or fixed</th>
              <th className="text-left">The benefit that comes of this doing</th>
            </tr>
          </thead>
          <tbody>
            {enhancers.map((e) => (
              <tr key={e.id}>
                <td className="font-mono text-rmpg-400">{e.id}</td>
                <td className="text-rmpg-100">{e.feature}</td>
                <td className="text-rmpg-300">{e.change}</td>
                <td className="text-rmpg-300">{e.benefit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
