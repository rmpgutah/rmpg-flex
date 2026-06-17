import WidgetFrame from './WidgetFrame';
import type { IntelOverview } from '../useIntelOverview';

type Row = IntelOverview['alerts'][number];
const TAG: Record<string, string> = {
  warrant: 'bg-[#3a0d0a] text-[#ff6b5e]', officer_safety: 'bg-[#3a2a08] text-[#f0c050]',
  gang: 'bg-[#2a0d3a] text-[#c07ff0]', bolo: 'bg-[#3a0d0a] text-[#ff6b5e]',
};

export default function ActiveAlertsWidget(
  { rows, onSelect }: { rows: Row[]; onSelect: (type: string, id: number, label: string) => void },
) {
  return (
    <WidgetFrame title="▲ Active Alerts" note={String(rows.length)}>
      {rows.length === 0 && <div className="text-[10px] text-rmpg-500">No active alerts.</div>}
      {rows.map((r, i) => (
        <button key={i} disabled={!r.person_id} onClick={() => r.person_id && onSelect('person', r.person_id, r.label)}
          className="w-full flex items-center gap-2 py-[5px] border-b border-border-subtle last:border-b-0 text-left disabled:cursor-default">
          <span className={`font-mono text-[8px] px-[5px] py-[1px] rounded-[2px] tracking-wide ${TAG[r.kind] || 'bg-surface-raised text-[#aaa]'}`}>
            {r.kind.replace('_', ' ').toUpperCase()}
          </span>
          <span className="text-[11px] text-rmpg-200 min-w-0 flex-1 truncate">{r.label}</span>
          <span className="text-[10px] text-rmpg-500 truncate max-w-[120px]">{r.detail}</span>
        </button>
      ))}
    </WidgetFrame>
  );
}
