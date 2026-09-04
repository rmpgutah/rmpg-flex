import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { BarChart3, RefreshCw, Target, TrendingUp, TrendingDown, Users } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { refreshAccessToken } from '../../utils/tokenRefresh';
import { useToast } from '../../components/ToastProvider';
import AttemptTimelineModal from '../../components/serve/AttemptTimelineModal';
import type { ServeJob } from '../../types';
import { safeDateStr } from '../../utils/dateUtils';
import ServeQueueToolsPanel from '../../components/serve/ServeQueueToolsPanel';
import { formatEnumValue } from '../../utils/formatters';

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

interface TimeToServeResponse {
  period_days: number;
  sample_size: number;
  avg_days: number;
  median_days: number;
  p90_days: number;
}

interface WeeklyTrendRow {
  week_start: string;
  total_attempts: number;
  successful_attempts: number;
  queues_served: number;
  queues_created: number;
  success_rate: number;
}
interface WeeklyTrendResponse {
  period_weeks: number;
  weeks: WeeklyTrendRow[];
}

interface WorkloadRow {
  officer_id: number;
  officer_name: string;
  assigned_count: number;
  overdue_count: number;
  todays_attempts: number;
  over_capacity: boolean;
}
interface WorkloadResponse {
  capacity_threshold: number;
  servers: WorkloadRow[];
  over_capacity_count: number;
}

interface BulkReassignResponse {
  success: boolean;
  reassigned_count: number;
  reassigned_attempt_ids: number[];
  skipped_attempt_ids: number[];
  affected_queue_ids: number[];
}

interface BulkStatusResponse {
  success: boolean;
  updated_queue_count: number;
  affected_queue_ids: number[];
  status: string;
}

const BULK_STATUS_OPTIONS = ['pending', 'assigned', 'in_progress', 'served', 'attempted', 'failed', 'cancelled'] as const;

function rateColor(rate: number): string {
  return rate >= 80 ? 'text-green-400' : rate >= 60 ? 'text-amber-400' : 'text-red-400';
}

interface ScheduleAnalytics {
  summary: { total_attempts: number; success_rate: number };
  by_day_of_week: Record<string, { total: number; served: number }>;
  by_hour: Record<string, { total: number; served: number }>;
  /** Keyed "<dow 0-6>|<band>" — the cross-tab the grid renders. */
  by_day_band?: Record<string, { total: number; served: number }>;
  bands?: string[];
  timezone?: string;
  /** More attempts existed in the window than were scanned. */
  truncated?: boolean;
  scanned?: number;
}

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BANDS = ['morning', 'afternoon', 'evening'] as const;
const BAND_LABEL: Record<string, string> = {
  morning: 'Morning (–12p)',
  afternoon: 'Afternoon (12–5p)',
  evening: 'Evening (5p+)',
};

/**
 * Cell shading for the timing grid.
 *
 * Deliberately NOT the rateColor severity ramp: a low success rate in a given
 * slot is not a fault condition, it is just a less productive hour, and
 * painting a third of the grid red would read as an alarm. Uses a single
 * green intensity ramp instead, so the eye picks the best slots by weight.
 *
 * Cells under `MIN_SAMPLE` attempts render as "thin" rather than coloured —
 * one lucky serve in a slot with n=1 is 100% and would otherwise outrank a
 * genuinely reliable slot with n=12.
 */
const MIN_SAMPLE = 3;
function cellStyle(cell: { total: number; served: number } | undefined): { cls: string; title: string } {
  if (!cell || cell.total === 0) {
    return { cls: 'bg-surface-sunken/40 text-fg-muted border-border-subtle', title: 'No attempts' };
  }
  const rate = Math.round((cell.served / cell.total) * 100);
  const base = `${cell.served}/${cell.total} served (${rate}%)`;
  if (cell.total < MIN_SAMPLE) {
    return {
      cls: 'bg-surface-sunken/60 text-fg-secondary border-border-default/40 border-dashed',
      title: `${base} — too few attempts to trust`,
    };
  }
  const cls =
    rate >= 75 ? 'bg-green-500/45 text-green-100 border-green-500/60'
    : rate >= 50 ? 'bg-green-500/28 text-green-200 border-green-600/50'
    : rate >= 25 ? 'bg-green-500/14 text-rmpg-200 border-border-default/50'
    : 'bg-surface-sunken/70 text-fg-secondary border-border-default/40';
  return { cls, title: base };
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
    } catch (err) {
      setDailyError(err instanceof Error ? err.message : 'Failed to load daily summary');
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
    } catch (err) {
      setServerPerfError(err instanceof Error ? err.message : 'Failed to load server performance');
    }
  }, [range]);

  const fetchSuccessByType = useCallback(async () => {
    setSuccessByTypeError(null);
    try {
      const data = await apiFetch<SuccessByTypeResponse>(`/serve-dashboard/success-rate-by-type?days=${range}`);
      setSuccessByType(data);
    } catch (err) {
      setSuccessByTypeError(err instanceof Error ? err.message : 'Failed to load success rates');
    }
  }, [range]);

  const fetchCountyBreakdown = useCallback(async () => {
    setCountyError(null);
    try {
      const data = await apiFetch<CountyBreakdownResponse>(`/serve-dashboard/county-breakdown?days=${range}`);
      setCountyBreakdown(data);
    } catch (err) {
      setCountyError(err instanceof Error ? err.message : 'Failed to load county breakdown');
    }
  }, [range]);

  const [ttsRange, setTtsRange] = useState<RangeDays>(90);
  const [timeToServe, setTimeToServe] = useState<TimeToServeResponse | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);

  const [weeklyTrend, setWeeklyTrend] = useState<WeeklyTrendResponse | null>(null);
  const [weeklyTrendError, setWeeklyTrendError] = useState<string | null>(null);

  const fetchTimeToServe = useCallback(async () => {
    setTtsError(null);
    try {
      const data = await apiFetch<TimeToServeResponse>(`/serve-dashboard/time-to-serve?days=${ttsRange}`);
      setTimeToServe(data);
    } catch (err) {
      setTtsError(err instanceof Error ? err.message : 'Failed to load time-to-serve');
    }
  }, [ttsRange]);

  // ── Best time to serve ────────────────────────────────────────────────────
  // 7 days × 3 time bands. The bands match serveDiligenceChain.ts exactly, so
  // the "vary your time-of-day" guidance on a job card and the "here's when we
  // actually succeed" grid here speak the same language rather than two.
  const [timing, setTiming] = useState<ScheduleAnalytics | null>(null);
  const [timingError, setTimingError] = useState<string | null>(null);

  const fetchTiming = useCallback(async () => {
    setTimingError(null);
    try {
      const start = new Date(Date.now() - range * 86_400_000).toISOString().slice(0, 10);
      const data = await apiFetch<ScheduleAnalytics>(`/process-server/schedule-analytics?start_date=${start}`);
      setTiming(data);
    } catch (err) {
      setTimingError(err instanceof Error ? err.message : 'Failed to load timing analytics');
    }
  }, [range]);

  const fetchWeeklyTrend = useCallback(async () => {
    setWeeklyTrendError(null);
    try {
      const data = await apiFetch<WeeklyTrendResponse>('/serve-dashboard/weekly-trend?weeks=12');
      setWeeklyTrend(data);
    } catch (err) {
      setWeeklyTrendError(err instanceof Error ? err.message : 'Failed to load weekly trend');
    }
  }, []);

  const [workload, setWorkload] = useState<WorkloadResponse | null>(null);
  const [workloadError, setWorkloadError] = useState<string | null>(null);

  const [expandedOfficerId, setExpandedOfficerId] = useState<number | null>(null);
  const [officerJobs, setOfficerJobs] = useState<ServeJob[]>([]);
  const [officerJobsLoading, setOfficerJobsLoading] = useState(false);

  const [timelineQueueId, setTimelineQueueId] = useState<number | null>(null);

  const fetchWorkload = useCallback(async () => {
    setWorkloadError(null);
    try {
      const data = await apiFetch<WorkloadResponse>('/serve-dashboard/workload-distribution');
      setWorkload(data);
    } catch (err) {
      setWorkloadError(err instanceof Error ? err.message : 'Failed to load workload');
    }
  }, []);

  useEffect(() => { fetchWorkload(); }, [fetchWorkload, refreshKey]);

  const toggleOfficerExpand = useCallback(async (officerId: number) => {
    if (expandedOfficerId === officerId) {
      setExpandedOfficerId(null);
      setOfficerJobs([]);
      return;
    }
    setExpandedOfficerId(officerId);
    setOfficerJobsLoading(true);
    try {
      const jobs = await apiFetch<ServeJob[]>(`/process-server?officer_id=${officerId}`);
      setOfficerJobs(jobs ?? []);
    } catch {
      setOfficerJobs([]);
      addToast('Failed to load officer jobs', 'error');
    } finally {
      setOfficerJobsLoading(false);
    }
  }, [expandedOfficerId, addToast]);

  useEffect(() => { fetchDaily(); }, [fetchDaily, refreshKey]);
  useEffect(() => { fetchServerPerf(); }, [fetchServerPerf, refreshKey]);
  useEffect(() => { fetchSuccessByType(); }, [fetchSuccessByType, refreshKey]);
  useEffect(() => { fetchCountyBreakdown(); }, [fetchCountyBreakdown, refreshKey]);
  useEffect(() => { fetchTimeToServe(); }, [fetchTimeToServe, refreshKey]);
  useEffect(() => { fetchWeeklyTrend(); }, [fetchWeeklyTrend, refreshKey]);
  useEffect(() => { fetchTiming(); }, [fetchTiming, refreshKey]);

  // [24] First-attempt rate stat card
  const [firstAttemptRate, setFirstAttemptRate] = useState<{ total: number; first_attempt_served: number; rate: number } | null>(null);
  const fetchFirstAttemptRate = useCallback(async () => {
    try {
      const d = await apiFetch<{ total: number; first_attempt_served: number; rate: number }>('/serve/stats/first-attempt-rate');
      setFirstAttemptRate(d);
    } catch {}
  }, []);
  useEffect(() => { fetchFirstAttemptRate(); }, [fetchFirstAttemptRate, refreshKey]);

  // [25] Attempt velocity sparkline
  const [velocity, setVelocity] = useState<{ last_7_days: number; prior_7_days: number; trend: number } | null>(null);
  const fetchVelocity = useCallback(async () => {
    try {
      const d = await apiFetch<{ last_7_days: number; prior_7_days: number; trend: number }>('/serve/stats/velocity');
      setVelocity(d);
    } catch {}
  }, []);
  useEffect(() => { fetchVelocity(); }, [fetchVelocity, refreshKey]);

  // [29] Client breakdown table
  const [clientBreakdown, setClientBreakdown] = useState<Array<{ client: string; total: number; served: number; failed: number; active: number }>>([]);
  const fetchClientBreakdown = useCallback(async () => {
    try {
      const d = await apiFetch<Array<{ client: string; total: number; served: number; failed: number; active: number }>>('/serve/client-breakdown');
      setClientBreakdown(d);
    } catch {}
  }, []);
  useEffect(() => { fetchClientBreakdown(); }, [fetchClientBreakdown, refreshKey]);

  const refreshAll = () => setRefreshKey((k) => k + 1);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const [exporting, setExporting] = useState(false);
  const exportPopoverRef = useRef<HTMLDivElement>(null);

  // Close export popover on click outside or Escape — mirrors ExportButton.tsx.
  useEffect(() => {
    if (!exportOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (exportPopoverRef.current && !exportPopoverRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setExportOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [exportOpen]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('rmpg_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const body = JSON.stringify({
        status: exportStatus || undefined,
        startDate: exportStartDate || undefined,
        endDate: exportEndDate || undefined,
        format: 'csv',
      });
      let res = await fetch('/api/serve-dashboard/export', {
        method: 'POST',
        headers,
        body,
      });

      if (res.status === 401) {
        const newToken = await refreshAccessToken();
        if (newToken) {
          headers['Authorization'] = `Bearer ${newToken}`;
          res = await fetch('/api/serve-dashboard/export', {
            method: 'POST',
            headers,
            body,
          });
        }
      }

      if (!res.ok) throw new Error(`Export failed with status ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `serve_export_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
      addToast('Export downloaded', 'success');
      setExportOpen(false);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  // h-full + overflow-y-auto is REQUIRED, not decorative. ServePage renders every
  // tab inside `flex-1 overflow-hidden`, which gives the tab a fixed height and
  // clips anything taller with no scrollbar and no error — measured live at
  // clientHeight 843 vs scrollHeight 1357, i.e. 514px of this tab simply
  // unreachable. Route and Stats already carry their own scroller; Analytics,
  // Performance and Assign did not, so they silently truncated. Matches the
  // `h-full overflow-y-auto ... scrollbar-dark` convention those tabs use.
  return (
    <div className="h-full overflow-y-auto p-4 space-y-4 scrollbar-dark">
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
          <div className="relative" ref={exportPopoverRef}>
            <button
              type="button"
              onClick={() => setExportOpen((o) => !o)}
              className="text-[10px] px-2 py-1 rounded-[2px] bg-surface-raised border border-rmpg-700 text-rmpg-300 hover:text-rmpg-100 transition-colors"
            >
              Export
            </button>
            {exportOpen && (
              <div className="absolute right-0 mt-1 z-10 w-56 bg-surface-base border border-rmpg-700 rounded-[2px] shadow-xl p-3 space-y-2">
                <select
                  value={exportStatus}
                  onChange={(e) => setExportStatus(e.target.value)}
                  className="w-full text-[10px] px-2 py-1 rounded-[2px] bg-surface-raised border border-rmpg-700 text-rmpg-200"
                >
                  <option value="">All statuses</option>
                  {BULK_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <input
                  type="date"
                  value={exportStartDate}
                  onChange={(e) => setExportStartDate(e.target.value)}
                  className="w-full text-[10px] px-2 py-1 rounded-[2px] bg-surface-raised border border-rmpg-700 text-rmpg-200"
                />
                <input
                  type="date"
                  value={exportEndDate}
                  onChange={(e) => setExportEndDate(e.target.value)}
                  className="w-full text-[10px] px-2 py-1 rounded-[2px] bg-surface-raised border border-rmpg-700 text-rmpg-200"
                />
                <button
                  type="button"
                  disabled={exporting}
                  onClick={handleExport}
                  className="w-full text-[10px] px-2 py-1 rounded-[2px] bg-brand-gold-500/10 border border-brand-gold-500/30 text-brand-gold-400 hover:bg-brand-gold-500/20 transition-colors disabled:opacity-40"
                >
                  {exporting ? 'Exporting…' : 'Download CSV'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── [24][25][29] Quick-stat row: first-attempt rate + velocity + client breakdown ── */}
      <div className="grid grid-cols-3 gap-2">
        {/* [24] First-attempt rate */}
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-2 flex flex-col gap-1">
          <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-fg-muted">
            <Target className="w-3 h-3" />
            First-Attempt Rate
          </div>
          {firstAttemptRate ? (
            <>
              <span className="text-2xl font-bold tabular-nums text-rmpg-100">{firstAttemptRate.rate}%</span>
              <span className="text-[9px] text-fg-muted">
                {firstAttemptRate.first_attempt_served}/{firstAttemptRate.total} closed jobs
              </span>
            </>
          ) : (
            <span className="text-[10px] text-fg-muted">Loading…</span>
          )}
        </div>

        {/* [25] Attempt velocity */}
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-2 flex flex-col gap-1">
          <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-fg-muted">
            {velocity && velocity.trend >= 0
              ? <TrendingUp className="w-3 h-3 text-green-400" />
              : <TrendingDown className="w-3 h-3 text-red-400" />}
            Attempt Velocity
          </div>
          {velocity ? (
            <>
              <span className="text-2xl font-bold tabular-nums text-rmpg-100">{velocity.last_7_days}</span>
              <span className={`text-[9px] ${velocity.trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {velocity.trend >= 0 ? '+' : ''}{velocity.trend} vs prior 7d
              </span>
            </>
          ) : (
            <span className="text-[10px] text-fg-muted">Loading…</span>
          )}
        </div>

        {/* [29] Active client count */}
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-2 flex flex-col gap-1">
          <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-fg-muted">
            <Users className="w-3 h-3" />
            Active Clients
          </div>
          <span className="text-2xl font-bold tabular-nums text-rmpg-100">
            {clientBreakdown.filter((c) => c.active > 0).length}
          </span>
          <span className="text-[9px] text-fg-muted">{clientBreakdown.length} total</span>
        </div>
      </div>

      {/* [29] Client breakdown table */}
      {clientBreakdown.length > 0 && (
        <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3 space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
            Client / Attorney Breakdown
          </span>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-fg-muted font-semibold text-[9px]">
                <th className="text-left py-[3px] px-2">Client</th>
                <th className="text-right py-[3px] px-2">Total</th>
                <th className="text-right py-[3px] px-2">Active</th>
                <th className="text-right py-[3px] px-2">Served</th>
                <th className="text-right py-[3px] px-2">Failed</th>
              </tr>
            </thead>
            <tbody>
              {clientBreakdown.slice(0, 15).map((row) => (
                <tr key={row.client} className="border-t border-rmpg-700/30">
                  <td className="py-[2px] px-2 text-rmpg-200 truncate max-w-[140px]">{row.client}</td>
                  <td className="py-[2px] px-2 text-right tabular-nums text-fg-secondary">{row.total}</td>
                  <td className="py-[2px] px-2 text-right tabular-nums text-brand-400">{row.active}</td>
                  <td className="py-[2px] px-2 text-right tabular-nums text-green-400">{row.served}</td>
                  <td className="py-[2px] px-2 text-right tabular-nums text-red-400">{row.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
                    <td className="px-3 py-[2px] text-rmpg-200 capitalize">{formatEnumValue(t.attempt_type)}</td>
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

      {/* ── Time to serve ── */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-rmpg-400 uppercase font-semibold tracking-wider">Time to Serve</span>
          <div className="flex gap-px text-[10px]">
            {([7, 30, 90] as RangeDays[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setTtsRange(d)}
                className={`px-2 py-0.5 rounded-[2px] transition-colors ${
                  ttsRange === d
                    ? 'bg-brand-gold-500/20 text-brand-gold-400 border border-brand-gold-500/30'
                    : 'text-rmpg-400 hover:text-rmpg-200 border border-transparent'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        {ttsError && <div className="text-[10px] text-red-400">{ttsError}</div>}
        {!ttsError && timeToServe && (
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-xl font-bold tabular-nums font-mono text-rmpg-100">{timeToServe.avg_days}</div>
              <div className="text-[9px] text-rmpg-400 mt-0.5">Avg Days</div>
            </div>
            <div>
              <div className="text-xl font-bold tabular-nums font-mono text-rmpg-100">{timeToServe.median_days}</div>
              <div className="text-[9px] text-rmpg-400 mt-0.5">Median Days</div>
            </div>
            <div>
              <div className="text-xl font-bold tabular-nums font-mono text-rmpg-100">{timeToServe.p90_days}</div>
              <div className="text-[9px] text-rmpg-400 mt-0.5">P90 Days</div>
            </div>
          </div>
        )}
        {!ttsError && timeToServe && (
          <div className="text-[9px] text-rmpg-500 text-center">
            Based on {timeToServe.sample_size} successful serve(s) in the last {timeToServe.period_days} days
          </div>
        )}
      </div>

      <ServeQueueToolsPanel />

      {/* ── Best time to serve ── */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-fg-muted uppercase font-semibold tracking-wider">
            Best Time to Serve · {range}d
          </span>
          <span className="text-[9px] text-fg-muted">
            success rate by day × time-of-day (Mountain)
          </span>
        </div>
        {timingError && <div className="text-[10px] text-red-400">{timingError}</div>}
        {!timingError && timing?.by_day_band && (
          <div className="mt-2 overflow-x-auto">
            <table className="text-[9px] border-separate border-spacing-[2px]">
              <thead>
                <tr>
                  <th className="w-24" />
                  {DOW_SHORT.map((d, i) => (
                    <th
                      key={d}
                      className={`px-2 py-[2px] font-semibold tabular-nums ${
                        i === 0 || i === 6 ? 'text-accent-silver-300' : 'text-fg-muted'
                      }`}
                      title={i === 0 || i === 6 ? 'Weekend — carries extra weight in a diligence record' : undefined}
                    >
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BANDS.map((band) => (
                  <tr key={band}>
                    <td className="pr-2 text-right text-fg-muted whitespace-nowrap">{BAND_LABEL[band]}</td>
                    {DOW_SHORT.map((_, dow) => {
                      const cell = timing.by_day_band?.[`${dow}|${band}`];
                      const { cls, title } = cellStyle(cell);
                      return (
                        <td key={dow} className="p-0">
                          <div
                            title={`${DOW_SHORT[dow]} ${BAND_LABEL[band]} — ${title}`}
                            className={`px-2 py-[3px] text-center border rounded-[2px] tabular-nums ${cls}`}
                          >
                            {cell?.total ? `${Math.round((cell.served / cell.total) * 100)}%` : '·'}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center gap-3 mt-1.5 text-[9px] text-fg-muted">
              <span>Darker = higher success rate</span>
              <span className="px-1 border border-dashed border-border-default/40 rounded-[2px]">dashed</span>
              <span>= fewer than {MIN_SAMPLE} attempts, not yet meaningful</span>
              <span className="ml-auto tabular-nums">
                {timing.truncated ? 'most recent ' : ''}
                {timing.summary.total_attempts} attempts · {timing.summary.success_rate}% overall
              </span>
            </div>
          </div>
        )}
        {!timingError && timing && !timing.by_day_band && (
          <div className="text-[10px] text-fg-muted">
            Timing breakdown unavailable — the API returned no day/band cross-tab.
          </div>
        )}
      </div>

      {/* ── Weekly trend ── */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] p-3 space-y-1">
        <span className="text-[9px] text-rmpg-400 uppercase font-semibold tracking-wider">Weekly Trend (12 weeks)</span>
        {weeklyTrendError && <div className="text-[10px] text-red-400">{weeklyTrendError}</div>}
        {!weeklyTrendError && (weeklyTrend?.weeks.length ?? 0) > 0 && (
          <div className="space-y-1 mt-2">
            {weeklyTrend!.weeks.map((w) => (
              <div key={w.week_start} className="flex items-center gap-2 text-[9px]">
                <span className="w-16 text-rmpg-400 tabular-nums shrink-0">{w.week_start}</span>
                <div className="flex-1 h-[6px] bg-rmpg-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500"
                    style={{ width: `${Math.min(w.success_rate, 100)}%` }}
                  />
                </div>
                <span className="w-10 text-right text-rmpg-300 tabular-nums shrink-0">{w.total_attempts}</span>
                <span className={`w-10 text-right tabular-nums shrink-0 font-semibold ${rateColor(w.success_rate)}`}>
                  {w.success_rate}%
                </span>
              </div>
            ))}
          </div>
        )}
        {!weeklyTrendError && (weeklyTrend?.weeks.length ?? 0) === 0 && (
          <div className="text-[11px] text-rmpg-500 text-center py-4">No activity in the last 12 weeks.</div>
        )}
      </div>

      {/* ── Workload distribution ── */}
      <div className="bg-surface-raised border border-rmpg-700 rounded-[2px] overflow-hidden">
        <div className="px-3 py-2 border-b border-rmpg-700 flex items-center justify-between">
          <span className="text-[9px] text-rmpg-400 uppercase font-semibold tracking-wider">Workload Distribution</span>
          {workload && workload.over_capacity_count > 0 && (
            <span className="text-[9px] text-red-400 font-semibold">
              {workload.over_capacity_count} over capacity
            </span>
          )}
        </div>
        {workloadError && <div className="text-[10px] text-red-400 px-3 py-2">{workloadError}</div>}
        {!workloadError && (workload?.servers.length ?? 0) > 0 && (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-rmpg-800">
                <th className="text-left px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Officer</th>
                <th className="text-right px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Assigned</th>
                <th className="text-right px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Overdue</th>
                <th className="text-right px-3 py-[3px] text-rmpg-500 font-semibold text-[9px]">Today</th>
              </tr>
            </thead>
            <tbody>
              {workload!.servers.map((s) => (
                <Fragment key={s.officer_id}>
                  <tr
                    key={s.officer_id}
                    className={`border-b border-rmpg-800 cursor-pointer hover:bg-surface-base/60 ${s.over_capacity ? 'bg-red-950/20' : ''}`}
                    onClick={() => toggleOfficerExpand(s.officer_id)}
                  >
                    <td className="px-3 py-[2px] text-rmpg-200">{s.officer_name}</td>
                    <td className={`px-3 py-[2px] text-right tabular-nums font-semibold ${s.over_capacity ? 'text-red-400' : 'text-rmpg-300'}`}>
                      {s.assigned_count}
                    </td>
                    <td className="px-3 py-[2px] text-right text-amber-400 tabular-nums">{s.overdue_count}</td>
                    <td className="px-3 py-[2px] text-right text-rmpg-400 tabular-nums">{s.todays_attempts}</td>
                  </tr>
                  {expandedOfficerId === s.officer_id && (
                    <tr key={`${s.officer_id}-expanded`}>
                      <td colSpan={4} className="p-0">
                        <OfficerJobsPanel
                          jobs={officerJobs}
                          loading={officerJobsLoading}
                          officerId={s.officer_id}
                          onOpenTimeline={setTimelineQueueId}
                          onBulkActionComplete={async () => {
                            fetchWorkload();
                            setOfficerJobsLoading(true);
                            try {
                              const jobs = await apiFetch<ServeJob[]>(`/process-server?officer_id=${s.officer_id}`);
                              setOfficerJobs(jobs ?? []);
                            } catch {
                              addToast('Failed to refresh officer jobs', 'error');
                            } finally {
                              setOfficerJobsLoading(false);
                            }
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        {!workloadError && (workload?.servers.length ?? 0) === 0 && (
          <div className="text-[11px] text-rmpg-500 text-center py-4">No officers with active assignments.</div>
        )}
      </div>

      {timelineQueueId != null && (
        <AttemptTimelineModal queueId={timelineQueueId} onClose={() => setTimelineQueueId(null)} />
      )}
    </div>
  );
}

interface OfficerJobsPanelProps {
  jobs: ServeJob[];
  loading: boolean;
  officerId: number;
  onOpenTimeline: (queueId: number) => void;
  onBulkActionComplete: () => void;
}

function OfficerJobsPanel({ jobs, loading, officerId, onOpenTimeline, onBulkActionComplete }: OfficerJobsPanelProps) {
  const { addToast } = useToast();
  const [selectedAttemptIds, setSelectedAttemptIds] = useState<Set<number>>(new Set());
  const [reassignTarget, setReassignTarget] = useState('');
  const [bulkStatus, setBulkStatus] = useState<typeof BULK_STATUS_OPTIONS[number]>('failed');
  const [submitting, setSubmitting] = useState(false);

  const allAttempts = jobs.flatMap((j) => (j.attempts ?? []).map((a) => ({ ...a, jobRecipient: j.recipient_name, jobId: j.id })));

  const toggleAttempt = (id: number) => {
    setSelectedAttemptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkReassign = async () => {
    const toServerId = parseInt(reassignTarget, 10);
    if (!toServerId || toServerId === officerId || selectedAttemptIds.size === 0) return;
    setSubmitting(true);
    try {
      const res = await apiFetch<BulkReassignResponse>('/serve-dashboard/bulk-reassign', {
        method: 'POST',
        body: JSON.stringify({
          fromServerId: officerId,
          toServerId,
          attemptIds: Array.from(selectedAttemptIds),
        }),
      });
      addToast(`Reassigned ${res.reassigned_count} attempt(s)`, 'success');
      setSelectedAttemptIds(new Set());
      onBulkActionComplete();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Reassign failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkStatusUpdate = async () => {
    if (selectedAttemptIds.size === 0) return;
    setSubmitting(true);
    try {
      const res = await apiFetch<BulkStatusResponse>('/serve-dashboard/bulk-status-update', {
        method: 'POST',
        body: JSON.stringify({
          attemptIds: Array.from(selectedAttemptIds),
          status: bulkStatus,
        }),
      });
      addToast(`Updated ${res.updated_queue_count} job(s) to "${res.status}"`, 'success');
      setSelectedAttemptIds(new Set());
      onBulkActionComplete();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Status update failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="text-[10px] text-rmpg-500 text-center py-3 bg-surface-base/40">Loading jobs…</div>;
  }
  if (allAttempts.length === 0) {
    return <div className="text-[10px] text-rmpg-500 text-center py-3 bg-surface-base/40">No attempts recorded for this officer's assigned jobs.</div>;
  }

  return (
    <div className="bg-surface-base/40 border-t border-rmpg-800 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="number"
          placeholder="Reassign to officer ID"
          value={reassignTarget}
          onChange={(e) => setReassignTarget(e.target.value)}
          className="w-40 text-[10px] px-2 py-1 rounded-[2px] bg-surface-raised border border-rmpg-700 text-rmpg-200"
        />
        <button
          type="button"
          disabled={submitting || selectedAttemptIds.size === 0 || !reassignTarget || parseInt(reassignTarget, 10) === officerId}
          onClick={handleBulkReassign}
          className="text-[10px] px-2 py-1 rounded-[2px] bg-brand-500/10 border border-brand-500/30 text-brand-400 hover:bg-brand-500/20 transition-colors disabled:opacity-40"
        >
          Reassign Selected ({selectedAttemptIds.size})
        </button>
        <select
          value={bulkStatus}
          onChange={(e) => setBulkStatus(e.target.value as typeof BULK_STATUS_OPTIONS[number])}
          className="text-[10px] px-2 py-1 rounded-[2px] bg-surface-raised border border-rmpg-700 text-rmpg-200"
        >
          {BULK_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button
          type="button"
          disabled={submitting || selectedAttemptIds.size === 0}
          onClick={handleBulkStatusUpdate}
          className="text-[10px] px-2 py-1 rounded-[2px] bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-40"
        >
          Set Status Selected ({selectedAttemptIds.size})
        </button>
      </div>

      <table className="w-full text-[9px]">
        <thead>
          <tr className="border-b border-rmpg-800">
            <th className="w-6 px-2 py-[2px]" />
            <th className="text-left px-2 py-[2px] text-rmpg-500 font-semibold">Job</th>
            <th className="text-left px-2 py-[2px] text-rmpg-500 font-semibold">Attempt #</th>
            <th className="text-left px-2 py-[2px] text-rmpg-500 font-semibold">Result</th>
            <th className="text-left px-2 py-[2px] text-rmpg-500 font-semibold">Date</th>
            <th className="w-16 px-2 py-[2px]" />
          </tr>
        </thead>
        <tbody>
          {allAttempts.map((a) => (
            <tr key={a.id} className="border-b border-rmpg-800/60 last:border-0">
              <td className="px-2 py-[2px]">
                <input
                  type="checkbox"
                  checked={selectedAttemptIds.has(a.id)}
                  onChange={() => toggleAttempt(a.id)}
                  aria-label={`Select attempt ${a.id}`}
                />
              </td>
              <td className="px-2 py-[2px] text-rmpg-300">{a.jobRecipient}</td>
              <td className="px-2 py-[2px] text-rmpg-400 tabular-nums">{a.attempt_number}</td>
              <td className="px-2 py-[2px] text-rmpg-300">{formatEnumValue(a.result)}</td>
              <td className="px-2 py-[2px] text-rmpg-500 tabular-nums">{safeDateStr(a.attempt_at, "")}</td>
              <td className="px-2 py-[2px] text-right">
                <button
                  type="button"
                  onClick={() => onOpenTimeline(a.jobId)}
                  className="text-brand-400 hover:text-brand-300 transition-colors"
                >
                  Timeline
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
