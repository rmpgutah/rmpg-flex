import WidgetFrame from './WidgetFrame';
import type { IntelOverview } from '../useIntelOverview';

type Row = IntelOverview['escalation_leaderboard'][number];
const max = (rows: Row[]) => Math.max(1, ...rows.map((r) => r.score));

export default function EscalationLeaderboardWidget(
  { rows, onSelect }: { rows: Row[]; onSelect: (type: string, id: number, label: string) => void },
) {
  const m = max(rows);
  return (
    <WidgetFrame title="↗ Escalation Leaderboard" note="30d">
      {rows.length === 0 && <div className="text-[10px] text-rmpg-500">No recent escalation.</div>}
      {rows.map((r) => (
        <button key={r.person_id} onClick={() => onSelect('person', r.person_id, r.label)}
          className="w-full flex items-center gap-2 py-[5px] border-b border-border-subtle last:border-b-0 text-left">
          <span className="w-[96px] truncate text-[11px] text-[#e0e0e0]">{r.label}</span>
          <span className="flex-1 h-[7px] bg-surface-base rounded-[1px] overflow-hidden">
            <span className="block h-full bg-gradient-to-r from-[#7a5a10] to-[#d4a017]"
              style={{ width: `${Math.round((r.score / m) * 100)}%` }} />
          </span>
          <span className="font-mono text-[9px] text-[#d4a017] w-[26px] text-right">{r.score}</span>
        </button>
      ))}
    </WidgetFrame>
  );
}
