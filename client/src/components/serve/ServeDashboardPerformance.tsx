import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Briefcase, UserCheck, BarChart3, Clock, Calendar } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';
import PanelTitleBar from '../PanelTitleBar';

interface ServeSummary {
  total: number;
  pending: number;
  served: number;
  failed: number;
  overdue: number;
}

interface OfficerRate {
  officer_id: number;
  full_name: string;
  total: number;
  served: number;
  failed: number;
  success_pct: number;
}

interface DeadlineJob {
  id: number;
  recipient_name: string | null;
  recipient_address: string | null;
  deadline: string;
  status: string;
  case_number: string | null;
}

interface SuccessRatesResp {
  officers: OfficerRate[];
}

export default function ServeDashboardPerformance() {
  const [summary, setSummary] = useState<ServeSummary | null>(null);
  const [officers, setOfficers] = useState<OfficerRate[]>([]);
  const [deadlines, setDeadlines] = useState<DeadlineJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduleAnalytics, setScheduleAnalytics] = useState<{ summary: { total_attempts: number; success_rate: number }; by_day_of_week: Record<string, { total: number; served: number }>; by_hour: Record<string, { total: number; served: number }> } | null>(null);

  const refetch = useCallback(async () => {
    try {
      if (!summary) setLoading(true);
      const [sum, rates, dl, analytics] = await Promise.all([
        apiFetch<ServeSummary>('/serve/stats/summary'),
        apiFetch<SuccessRatesResp>('/serve/success-rates'),
        apiFetch<DeadlineJob[]>('/serve/deadlines?days=7'),
        apiFetch<any>('/serve/schedule-analytics?start_date=' + new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)),
      ]);
      setSummary(sum);
      setOfficers(rates.officers ?? []);
      setDeadlines(dl ?? []);
      setScheduleAnalytics(analytics);
    } catch {
      // Silently fail — dashboard widget must never break the page
    } finally {
      setLoading(false);
    }
  }, [summary]);

  useEffect(() => { refetch(); }, [refetch]);

  // Silent refresh every 60s + on process-server module events
  const tick = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => {
    tick.current = setInterval(refetch, 60_000);
    return () => clearInterval(tick.current);
  }, [refetch]);
  useLiveSync(['process-server'], refetch);

  const sorted = [...officers].sort((a, b) => b.success_pct - a.success_pct).slice(0, 6);

  return (
    <div className="panel-beveled bg-surface-base shadow-md shadow-black/10">
      <PanelTitleBar title="PROCESS SERVER PERFORMANCE" icon={Briefcase} />

      {loading ? (
        <div className="p-4 text-rmpg-400 text-[11px]">Loading serve data...</div>
      ) : (
        <div className="p-3 space-y-3">
          {/* Stat cards row */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-surface-raised rounded px-2 py-1.5 text-center">
              <div className="text-[9px] text-rmpg-400 uppercase font-bold">Pending</div>
              <div className="text-lg font-bold font-mono tabular-nums text-amber-400">{summary?.pending ?? 0}</div>
            </div>
            <div className="bg-surface-raised rounded px-2 py-1.5 text-center">
              <div className="text-[9px] text-rmpg-400 uppercase font-bold">Served</div>
              <div className="text-lg font-bold font-mono tabular-nums text-green-400">{summary?.served ?? 0}</div>
            </div>
            <div className="bg-surface-raised rounded px-2 py-1.5 text-center">
              <div className="text-[9px] text-rmpg-400 uppercase font-bold">Failed</div>
              <div className="text-lg font-bold font-mono tabular-nums text-red-400">{summary?.failed ?? 0}</div>
            </div>
            <div className="bg-surface-raised rounded px-2 py-1.5 text-center">
              <div className="text-[9px] text-rmpg-400 uppercase font-bold">Overdue</div>
              <div className="text-lg font-bold font-mono tabular-nums text-rose-400">{summary?.overdue ?? 0}</div>
            </div>
          </div>

          {/* Officer performance table */}
          {sorted.length > 0 && (
            <div>
              <div className="text-[9px] text-rmpg-400 uppercase font-bold mb-1 tracking-wider flex items-center gap-1">
                <UserCheck className="w-3 h-3" /> Officer Success Rates
              </div>
              <div className="divide-y divide-surface-raised">
                {sorted.map((o) => (
                  <div key={o.officer_id} className="flex items-center justify-between py-1">
                    <span className="text-[11px] text-rmpg-200 truncate mr-2">{o.full_name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-rmpg-400 font-mono">{o.served}/{o.total}</span>
                      <span className={`text-[11px] font-bold font-mono tabular-nums ${o.success_pct >= 70 ? 'text-green-400' : o.success_pct >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                        {o.success_pct}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upcoming deadlines */}
          {deadlines.length > 0 && (
            <div>
              <div className="text-[9px] text-rmpg-400 uppercase font-bold mb-1 tracking-wider flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Upcoming Deadlines ({deadlines.length})
              </div>
              <div className="divide-y divide-surface-raised max-h-[120px] overflow-y-auto">
                {deadlines.slice(0, 5).map((d) => (
                  <div key={d.id} className="flex items-center justify-between py-1">
                    <div className="truncate mr-2">
                      <span className="text-[11px] text-rmpg-200">{d.recipient_name ?? 'Unknown'}</span>
                      {d.recipient_address && (
                        <span className="text-[10px] text-rmpg-400 ml-1">— {d.recipient_address}</span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono text-rmpg-400 shrink-0">
                      {d.deadline ? new Date(d.deadline + 'T23:59:59').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!summary && officers.length === 0 && deadlines.length === 0 && (
            <div className="text-[11px] text-rmpg-400 text-center py-2">No serve data available</div>
          )}

          {/* Schedule Analytics */}
          {scheduleAnalytics && (
            <div>
              <div className="text-[9px] text-rmpg-400 uppercase font-bold mb-1 tracking-wider flex items-center gap-1">
                <BarChart3 className="w-3 h-3" /> Schedule Performance (30d)
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div className="bg-surface-raised rounded px-2 py-1 text-center">
                  <div className="text-[9px] text-rmpg-400 uppercase font-bold">Attempts</div>
                  <div className="text-sm font-bold font-mono tabular-nums text-rmpg-100">{scheduleAnalytics.summary.total_attempts}</div>
                </div>
                <div className="bg-surface-raised rounded px-2 py-1 text-center">
                  <div className="text-[9px] text-rmpg-400 uppercase font-bold">Success Rate</div>
                  <div className="text-sm font-bold font-mono tabular-nums text-green-400">{scheduleAnalytics.summary.success_rate}%</div>
                </div>
              </div>
              {/* Day-of-week mini bar */}
              {Object.keys(scheduleAnalytics.by_day_of_week).length > 0 && (
                <div className="text-[9px] text-rmpg-500 mb-1">By day of week</div>
              )}
              <div className="flex gap-1 mb-1 flex-wrap">
                {Object.entries(scheduleAnalytics.by_day_of_week).map(([day, stats]) => (
                  <div key={day} className="flex-1 min-w-[36px] text-center bg-surface-base rounded-sm px-1 py-0.5 border border-rmpg-700/50">
                    <div className="text-[8px] text-rmpg-500 font-bold uppercase">{day.slice(0, 3)}</div>
                    <div className={`text-[10px] font-bold font-mono ${stats.total > 0 ? (stats.served / stats.total) >= 0.7 ? 'text-green-400' : (stats.served / stats.total) >= 0.4 ? 'text-amber-400' : 'text-red-400' : 'text-rmpg-500'}`}>
                      {stats.total > 0 ? `${Math.round((stats.served / stats.total) * 100)}%` : '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
