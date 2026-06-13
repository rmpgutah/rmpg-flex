// Case dashboard + SLA badge (v2 Phase 3). Reads the /api/cases/stats
// payload (extended with closed/overdue/clearance_rate/aging/by_investigator).
import { Briefcase, AlertTriangle, CheckCircle, Clock, TrendingUp, Gauge } from 'lucide-react';
import PanelTitleBar from './PanelTitleBar';
import { computeSlaStatus, slaBadge, type SlaInput } from '../utils/caseSla';

/** Compact SLA badge for case rows / detail header. Renders nothing when the
 *  case has no live deadline (closed, or no due_date/sla_hours). */
export function SlaBadge({ caseRow }: { caseRow: SlaInput }) {
  const b = slaBadge(computeSlaStatus(caseRow).state);
  if (!b) return null;
  return (
    <span className="text-[8px] font-bold px-1 py-0.5 border whitespace-nowrap" style={{ color: b.color, borderColor: `${b.color}66` }}>
      {b.label}
    </span>
  );
}

interface DashStats {
  total?: number; open?: number; closed?: number; overdue?: number;
  clearance_rate?: number; avg_solvability?: number;
  aging?: { d0_7: number; d8_30: number; d31_90: number; d90p: number };
  by_investigator?: { investigator: string; count: number }[];
  by_status?: Record<string, number>;
  by_priority?: Record<string, number>;
}

function StatCard({ label, value, color, icon: Icon, onClick, suffix }: {
  label: string; value: number | string; color: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  onClick?: () => void; suffix?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`panel-beveled p-3 flex items-center gap-3 text-left ${onClick ? 'hover:bg-rmpg-800/40 transition-colors cursor-pointer' : ''}`}
    >
      <Icon className="w-5 h-5 flex-shrink-0" style={{ color }} />
      <div className="min-w-0">
        <div className="text-[9px] font-mono text-rmpg-500 uppercase tracking-wider">{label}</div>
        <div className="text-lg font-bold tabular-nums" style={{ color }}>{value}{suffix || ''}</div>
      </div>
    </Tag>
  );
}

export function CaseDashboardView({ stats, onShowOverdue }: { stats: DashStats | null; onShowOverdue: () => void }) {
  const s = stats || {};
  const aging = s.aging || { d0_7: 0, d8_30: 0, d31_90: 0, d90p: 0 };
  const agingTotal = aging.d0_7 + aging.d8_30 + aging.d31_90 + aging.d90p;
  const agingRows: { label: string; n: number; color: string }[] = [
    { label: '0–7 days', n: aging.d0_7, color: '#22c55e' },
    { label: '8–30 days', n: aging.d8_30, color: '#d4a017' },
    { label: '31–90 days', n: aging.d31_90, color: '#f59e0b' },
    { label: '90+ days', n: aging.d90p, color: '#ef4444' },
  ];
  const investigators = s.by_investigator || [];

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-surface-base">
      <PanelTitleBar title="Case Dashboard" icon={Gauge} />
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent p-3 space-y-4">
        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <StatCard label="Total" value={s.total ?? 0} color="#e5e5e5" icon={Briefcase} />
          <StatCard label="Open" value={s.open ?? 0} color="#22c55e" icon={Clock} />
          <StatCard label="Overdue" value={s.overdue ?? 0} color="#ef4444" icon={AlertTriangle} onClick={onShowOverdue} />
          <StatCard label="Closed" value={s.closed ?? 0} color="#888888" icon={CheckCircle} />
          <StatCard label="Clearance" value={s.clearance_rate ?? 0} suffix="%" color="#d4a017" icon={TrendingUp} />
          <StatCard label="Avg Solvability" value={s.avg_solvability ?? 0} suffix="%" color="#f59e0b" icon={Gauge} />
        </div>

        {/* Aging of open cases */}
        <div className="panel-beveled p-3">
          <div className="text-[10px] font-mono text-rmpg-500 uppercase mb-2">Open Case Aging</div>
          {agingTotal === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-2">No open cases</div>
          ) : (
            <div className="space-y-1.5">
              {agingRows.map((r) => (
                <div key={r.label} className="flex items-center gap-2">
                  <div className="w-20 text-[9px] text-rmpg-400 flex-shrink-0">{r.label}</div>
                  <div className="flex-1 h-3 bg-surface-sunken border border-rmpg-800 relative">
                    <div className="h-full" style={{ width: `${agingTotal ? (r.n / agingTotal) * 100 : 0}%`, background: r.color }} />
                  </div>
                  <div className="w-8 text-right text-[10px] font-bold tabular-nums" style={{ color: r.color }}>{r.n}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Caseload by investigator */}
        <div className="panel-beveled p-3">
          <div className="text-[10px] font-mono text-rmpg-500 uppercase mb-2">Open Caseload by Investigator</div>
          {investigators.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-2">No open cases</div>
          ) : (
            <table className="w-full text-[10px]">
              <tbody>
                {investigators.map((row, i) => (
                  <tr key={i} className="border-b border-rmpg-800 last:border-0">
                    <td className="py-[3px] text-rmpg-300">{row.investigator}</td>
                    <td className="py-[3px] text-right font-bold text-white tabular-nums w-12">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
