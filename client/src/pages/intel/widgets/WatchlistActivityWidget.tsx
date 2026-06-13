import WidgetFrame from './WidgetFrame';
import type { IntelOverview } from '../useIntelOverview';

type Row = IntelOverview['watchlist_activity'][number];

export default function WatchlistActivityWidget(
  { rows, onSelect }: { rows: Row[]; onSelect: (type: string, id: number, label: string) => void },
) {
  return (
    <WidgetFrame title="⚑ Watchlist Activity" note="live">
      {rows.length === 0 && <div className="text-[10px] text-[#555]">No recent activity.</div>}
      {rows.map((r, i) => (
        <button key={i} onClick={() => onSelect(r.entity_type, r.entity_id, r.label)}
          className="w-full flex items-center gap-2 py-[5px] border-b border-[#131313] last:border-b-0 text-left">
          <span className="text-[11px] text-[#e8e8e8] flex-1 truncate">{r.label}</span>
          <span className="text-[10px] text-[#666] truncate max-w-[140px]">{r.event}</span>
        </button>
      ))}
    </WidgetFrame>
  );
}
