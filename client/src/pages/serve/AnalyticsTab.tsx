import { useState, useEffect, useCallback } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../../components/ToastProvider';

type RangeDays = 7 | 30 | 90;

interface DailySummary {
  date: string;
  total: number;
  pending: number;
  assigned: number;
  in_progress: number;
  served: number;
  failed: number;
  attempted: number;
  percentages: {
    pending: number; assigned: number; in_progress: number;
    served: number; failed: number; attempted: number;
  };
}

const STATUS_LABELS: Record<keyof DailySummary['percentages'], string> = {
  pending: 'Pending',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  served: 'Served',
  failed: 'Failed',
  attempted: 'Attempted',
};

const STATUS_COLORS: Record<keyof DailySummary['percentages'], string> = {
  pending: 'text-rmpg-300',
  assigned: 'text-brand-400',
  in_progress: 'text-amber-400',
  served: 'text-green-400',
  failed: 'text-red-400',
  attempted: 'text-purple-400',
};

interface ServerPerformanceRow {
  officer_id: number;
  officer_name: string;
  total_attempts: number;
  successful_attempts: number;
  queues_served: number;
  success_rate: number;
  avg_attempts_per_serve: number;
  fastest_serve_hours: number | null;
}
interface ServerPerformanceResponse {
  period_days: number;
  servers: ServerPerformanceRow[];
}

interface SuccessByTypeRow {
  attempt_type: string;
  total: number;
  successful: number;
  failed: number;
  other: number;
  success_rate: number;
}
interface SuccessByTypeResponse {
  period_days: number;
  types: SuccessByTypeRow[];
}

interface CountyRow {
  city: string;
  total: number;
  served: number;
  failed: number;
  pending: number;
  success_rate: number;
  avg_attempts: number;
}
interface CountyBreakdownResponse {
  period_days: number;
  regions: CountyRow[];
}

function rateColor(rate: number): string {
  return rate >= 80 ? 'text-green-400' : rate >= 60 ? 'text-amber-400' : 'text-red-400';
}

export default function AnalyticsTab() {
  const { addToast } = useToast();
  const [range, setRange] = useState<RangeDays>(30);
  const [refreshKey, setRefreshKey] = useState(0);

  const [daily, setDaily] = useState<DailySummary | null>(null);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [dailyError, setDailyError] = useState<string | null>(null);

  const fetchDaily = useCallback(async () => {
    setDailyLoading(true);
    setDailyError(null);
    try {
      const data = await apiFetch<DailySummary>('/serve-dashboard/daily-summary');
      setDaily(data);
    } catch (err: any) {
      setDailyError(err?.message || 'Failed to load daily summary');
    } finally {
      setDailyLoading(false);
    }
  }, []);

  const [serverPerf, setServerPerf] = useState<ServerPerformanceResponse | null>(null);
  const [serverPerfError, setServerPerfError] = useState<string | null>(null);

  const [successByType, setSuccessByType] = useState<SuccessByTypeResponse | null>(null);
  const [successByTypeError, setSuccessByTypeError] = useState<string | null>(null);

  const [countyBreakdown, setCountyBreakdown] = useState<CountyBreakdownResponse | null>(null);
  const [countyError, setCountyError] = useState<string | null>(null);

  const fetchServerPerf = useCallback(async () => {
    setServerPerfError(null);
    try {
      const data = await apiFetch<ServerPerformanceResponse>(`/serve-dashboard/server-performance?days=${range}`);
      setServerPerf(data);
    } catch (err: any) {
      setServerPerfError(err?.message || 'Failed to load server performance');
    }
  }, [range]);

  const fetchSuccessByType = useCallback(async () => {
    setSuccessByTypeError(null);
    try {
      const data = await apiFetch<SuccessByTypeResponse>(`/serve-dashboard/success-rate-by-type?days=${range}`);
      setSuccessByType(data);
    } catch (err: any) {
      setSuccessByTypeError(err?.message || 'Failed to load success rates');
    }
  }, [range]);

  const fetchCountyBreakdown = useCallback(async () => {
    setCountyError(null);
    try {
      const data = await apiFetch<CountyBreakdownResponse>(`/serve-dashboard/county-breakdown?days=${range}`);
      setCountyBreakdown(data);
    } catch (err: any) {
      setCountyError(err?.message || 'Failed to load county breakdown');
    }
  }, [range]);

  useEffect(() => { fetchDaily(); }, [fetchDaily, refreshKey]);
  useEffect(() => { fetchServerPerf(); }, [fetchServerPerf, refreshKey]);
  useEffect(() => { fetchSuccessByType(); }, [fetchSuccessByType, refreshKey]);
  useEffect(() => { fetchCountyBreakdown(); }, [fetchCountyBreakdown, refreshKey]);

  const refreshAll = () => setRefreshKey((k) => k + 1);

  return (
    <div className="p-4 space-y-4">
      {/* ── Header + shared range selector ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-brand-gold-500" />
          <span className="text-[11px] font-semibold text-rmpg-100 uppercase tracking-wider">Analytics</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-px text-[10px]">
            {([7, 30, 90] as RangeDays[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setRange(d)}
                className={`px-2 py-0.5 rounded-[2px] transition-colors ${
                  range === d
                    ? 'bg-brand-gold-500/20 text-brand-gold-400 border border-brand-gold-500/30'
                    : 'text-rmpg-400 hover:text-rmpg-200 border border-transparent'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={refreshAll}
            className="p-1 text-rmpg-400 hover:text-rmpg-200 transition-colors"
            aria-label="Refresh analytics"
          >
            <RefreshCw size={12} className={dailyLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Daily summary ── */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3 space-y-2">
        <div className="text-[9px] text-rmpg-500 uppercase font-semibold tracking-wider">
          Today {daily ? `· ${daily.date}` : ''}
        </div>
        {dailyError && <div className="text-[10px] text-red-400">{dailyError}</div>}
        {!dailyError && daily && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
            {(Object.keys(STATUS_LABELS) as Array<keyof DailySummary['percentages']>).map((key) => (
              <div key={key}>
                <div className={`text-xl font-bold tabular-nums font-mono ${STATUS_COLORS[key]}`}>
                  {daily[key]}
                </div>
                <div className="text-[9px] text-rmpg-400 mt-0.5">{STATUS_LABELS[key]}</div>
                <div className="text-[8px] text-rmpg-500">{daily.percentages[key]}%</div>
              </div>
            ))}
          </div>
        )}
        {!dailyError && !daily && !dailyLoading && (
          <div className="text-[11px] text-rmpg-500 text-center py-4">No data for today.</div>
        )}
      </div>

      {/* ── Server performance ── */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] overflow-hidden">
        <div className="px-3 py-2 border-b border-rmpg-700">
          <span className="text-[9px] text-rmpg-400 uppercase font-semibold tracking-wider">
            Server Performance · {range}d
          </span>
        </div>
        {serverPerfError && <div className="text-[10px] text-red-400 px-3 py-2">{serverPerfError}</div>}
        {!serverPerfError && (serverPerf?.servers.length ?? 0) > 0 && (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-rmpg-800">
                <th className="text-left px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Officer</th>
                <th className="text-right px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Rate</th>
                <th className="text-right px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Avg Attempts</th>
                <th className="text-right px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Fastest (hrs)</th>
              </tr>
            </thead>
            <tbody>
              {serverPerf!.servers.map((s) => (
                <tr key={s.officer_id} className="border-b border-rmpg-800 last:border-0">
                  <td className="px-3 py-[2px] text-rmpg-200">{s.officer_name}</td>
                  <td className={`px-3 py-[2px] text-right tabular-nums font-mono font-semibold ${rateColor(s.success_rate)}`}>
                    {s.success_rate}%
                  </td>
                  <td className="px-3 py-[2px] text-right text-rmpg-400 tabular-nums">{s.avg_attempts_per_serve}</td>
                  <td className="px-3 py-[2px] text-right text-rmpg-400 tabular-nums">
                    {s.fastest_serve_hours != null ? s.fastest_serve_hours.toFixed(1) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!serverPerfError && (serverPerf?.servers.length ?? 0) === 0 && (
          <div className="text-[11px] text-rmpg-500 text-center py-4">No attempts in this period.</div>
        )}
      </div>

      {/* ── Success rate by type + county breakdown (side by side) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] overflow-hidden">
          <div className="px-3 py-2 border-b border-rmpg-700">
            <span className="text-[9px] text-rmpg-400 uppercase font-semibold tracking-wider">Success Rate by Type</span>
          </div>
          {successByTypeError && <div className="text-[10px] text-red-400 px-3 py-2">{successByTypeError}</div>}
          {!successByTypeError && (successByType?.types.length ?? 0) > 0 && (
            <table className="w-full text-[10px]">
              <tbody>
                {successByType!.types.map((t) => (
                  <tr key={t.attempt_type} className="border-b border-rmpg-800 last:border-0">
                    <td className="px-3 py-[2px] text-rmpg-200 capitalize">{t.attempt_type}</td>
                    <td className="px-3 py-[2px] text-right text-rmpg-400 tabular-nums">{t.total}</td>
                    <td className={`px-3 py-[2px] text-right tabular-nums font-mono font-semibold ${rateColor(t.success_rate)}`}>
                      {t.success_rate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!successByTypeError && (successByType?.types.length ?? 0) === 0 && (
            <div className="text-[11px] text-rmpg-500 text-center py-4">No attempts in this period.</div>
          )}
        </div>

        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] overflow-hidden">
          <div className="px-3 py-2 border-b border-rmpg-700">
            <span className="text-[9px] text-rmpg-400 uppercase font-semibold tracking-wider">By City</span>
          </div>
          {countyError && <div className="text-[10px] text-red-400 px-3 py-2">{countyError}</div>}
          {!countyError && (countyBreakdown?.regions.length ?? 0) > 0 && (
            <table className="w-full text-[10px]">
              <tbody>
                {countyBreakdown!.regions.map((r) => (
                  <tr key={r.city} className="border-b border-rmpg-800 last:border-0">
                    <td className="px-3 py-[2px] text-rmpg-200">{r.city}</td>
                    <td className="px-3 py-[2px] text-right text-rmpg-400 tabular-nums">{r.total}</td>
                    <td className={`px-3 py-[2px] text-right tabular-nums font-mono font-semibold ${rateColor(r.success_rate)}`}>
                      {r.success_rate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!countyError && (countyBreakdown?.regions.length ?? 0) === 0 && (
            <div className="text-[11px] text-rmpg-500 text-center py-4">No jobs in this period.</div>
          )}
        </div>
      </div>
    </div>
  );
}
