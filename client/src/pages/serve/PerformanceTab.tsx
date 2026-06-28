// client/src/pages/serve/PerformanceTab.tsx
import { useEffect, useState, useCallback } from 'react';
import { BarChart3, RefreshCw, Users, Zap } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';

type Period = 30 | 60 | 90;

interface OverallStats {
  total: number;
  served: number;
  failed: number;
  attempted?: number;
  success_rate: number;
  avg_attempts: number;
}

interface OfficerStats {
  officer_id: number | null;
  officer_name: string | null;
  total: number;
  served: number;
  failed?: number;
  success_rate: number;
}

interface SuccessRatesResponse {
  period_days: number;
  overall: OverallStats;
  by_officer: OfficerStats[];
}

export default function PerformanceTab() {
  const { user } = useAuth();
  const isAdmin = ['admin', 'manager', 'supervisor'].includes(user?.role ?? '');

  const [period, setPeriod] = useState<Period>(90);
  const [data, setData] = useState<SuccessRatesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<{ assigned: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<SuccessRatesResponse>(`/serve/success-rates?days=${period}`);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const handleAutoAssignAll = async () => {
    if (!isAdmin) return;
    setAutoAssigning(true);
    setAssignResult(null);
    try {
      const res = await apiFetch<{ success: boolean; assigned: number }>(
        '/serve/assignments/auto-assign-all',
        { method: 'POST' },
      );
      setAssignResult({ assigned: res.assigned ?? 0 });
    } catch {
      setAssignResult({ assigned: -1 });
    } finally {
      setAutoAssigning(false);
      load();
    }
  };

  const pct = (n: number) => `${n}%`;
  const rateColor = (rate: number) =>
    rate >= 80 ? 'text-green-400' : rate >= 60 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-brand-gold-500" />
          <span className="text-[11px] font-semibold text-rmpg-100 uppercase tracking-wider">Performance</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Period picker */}
          <div className="flex gap-px text-[10px]">
            {([30, 60, 90] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-2 py-0.5 rounded-[2px] transition-colors ${
                  period === p
                    ? 'bg-brand-gold-500/20 text-brand-gold-400 border border-brand-gold-500/30'
                    : 'text-rmpg-400 hover:text-rmpg-200 border border-transparent'
                }`}
              >
                {p}d
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-1 text-rmpg-400 hover:text-rmpg-200 transition-colors disabled:opacity-40"
            aria-label="Refresh performance data"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Overall stats ── */}
      {data?.overall && (
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3 space-y-2">
          <div className="text-[9px] text-rmpg-500 uppercase font-semibold tracking-wider">
            Overall · {data.period_days}d
          </div>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div>
              <div className={`text-xl font-bold tabular-nums font-mono ${rateColor(data.overall.success_rate)}`}>
                {pct(data.overall.success_rate)}
              </div>
              <div className="text-[9px] text-rmpg-400 mt-0.5">Success Rate</div>
            </div>
            <div>
              <div className="text-xl font-bold tabular-nums font-mono text-rmpg-100">
                {data.overall.total}
              </div>
              <div className="text-[9px] text-rmpg-400 mt-0.5">Total Jobs</div>
            </div>
            <div>
              <div className="text-xl font-bold tabular-nums font-mono text-green-400">
                {data.overall.served}
              </div>
              <div className="text-[9px] text-rmpg-400 mt-0.5">Served</div>
            </div>
            <div>
              <div className="text-xl font-bold tabular-nums font-mono text-rmpg-300">
                {data.overall.avg_attempts?.toFixed(1)}
              </div>
              <div className="text-[9px] text-rmpg-400 mt-0.5">Avg Attempts</div>
            </div>
          </div>
          {/* Mini bar chart — served vs total */}
          <div className="mt-1">
            <div className="h-[4px] bg-rmpg-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all"
                style={{ width: `${data.overall.success_rate}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Per-officer breakdown ── */}
      {(data?.by_officer?.length ?? 0) > 0 && (
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] overflow-hidden">
          <div className="px-3 py-2 border-b border-rmpg-700">
            <div className="flex items-center gap-2">
              <Users size={11} className="text-rmpg-400" />
              <span className="text-[9px] text-rmpg-400 uppercase font-semibold tracking-wider">By Officer</span>
            </div>
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-rmpg-800">
                <th className="text-left px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Officer</th>
                <th className="text-right px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Total</th>
                <th className="text-right px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Served</th>
                <th className="text-right px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Rate</th>
                <th className="px-3 py-[3px]" />
              </tr>
            </thead>
            <tbody>
              {data!.by_officer.map((o) => (
                <tr key={o.officer_id ?? 'unassigned'} className="border-b border-rmpg-800 last:border-0">
                  <td className="px-3 py-[2px] text-rmpg-200">{o.officer_name ?? 'Unassigned'}</td>
                  <td className="px-3 py-[2px] text-right text-rmpg-400 tabular-nums">{o.total}</td>
                  <td className="px-3 py-[2px] text-right text-green-400 tabular-nums">{o.served}</td>
                  <td className={`px-3 py-[2px] text-right tabular-nums font-mono font-semibold ${rateColor(o.success_rate)}`}>
                    {pct(o.success_rate)}
                  </td>
                  <td className="px-3 py-[2px] w-20">
                    <div className="h-[3px] bg-rmpg-800 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500" style={{ width: `${o.success_rate}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!data && !loading && (
        <div className="text-[11px] text-rmpg-500 text-center py-6">No data available.</div>
      )}

      {/* ── Admin: Auto-assign-all ── */}
      {isAdmin && (
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Zap size={11} className="text-brand-gold-500" />
            <span className="text-[9px] text-rmpg-400 uppercase font-semibold tracking-wider">Automation</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleAutoAssignAll}
              disabled={autoAssigning}
              className="text-[11px] px-3 py-1 rounded-[2px] bg-brand-gold-500/10 border border-brand-gold-500/30 text-brand-gold-400 hover:bg-brand-gold-500/20 transition-colors disabled:opacity-50"
            >
              {autoAssigning ? 'Assigning…' : 'Auto-Assign All Unassigned'}
            </button>
            {assignResult != null && (
              <span className={`text-[10px] ${assignResult.assigned >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {assignResult.assigned >= 0
                  ? `${assignResult.assigned} job(s) assigned`
                  : 'Assignment failed'}
              </span>
            )}
          </div>
          <div className="text-[9px] text-rmpg-500">
            Distributes pending unassigned jobs to officers by workload (fewest open jobs first).
          </div>
        </div>
      )}
    </div>
  );
}
