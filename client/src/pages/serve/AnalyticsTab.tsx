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

  useEffect(() => { fetchDaily(); }, [fetchDaily, refreshKey]);

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
    </div>
  );
}
