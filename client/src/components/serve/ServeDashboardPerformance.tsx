import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Briefcase, UserCheck } from 'lucide-react';
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

  const refetch = useCallback(async () => {
    try {
      if (!summary) setLoading(true);
      const [sum, rates, dl] = await Promise.all([
        apiFetch<ServeSummary>('/serve/stats/summary'),
        apiFetch<SuccessRatesResp>('/serve/success-rates'),
        apiFetch<DeadlineJob[]>('/serve/deadlines?days=7'),
      ]);
      setSummary(sum);
      setOfficers(rates.officers ?? []);
      setDeadlines(dl ?? []);
    } catch {
      // Silently fail — dashboard widget must never break the page
    } finally {
      setLoading(false);
    }
  }, [summary]);

  useEffect(() => { refetch(); }, [refetch]);

  // Silent refresh every 60s + on process-server module events
  const tick = useRef<ReturnType<typeof setInterval>>();
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
        </div>
      )}
    </div>
  );
}
