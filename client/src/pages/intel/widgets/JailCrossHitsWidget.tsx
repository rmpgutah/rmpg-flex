import WidgetFrame from './WidgetFrame';
import type { IntelOverview } from '../useIntelOverview';

type Row = IntelOverview['jail_cross_hits'][number];

export default function JailCrossHitsWidget(
  { rows, onSelect }: { rows: Row[]; onSelect: (type: string, id: number, label: string) => void },
) {
  return (
    <WidgetFrame title="⛓ Jail Cross-Hits" note="today">
      {rows.length === 0 && <div className="text-[10px] text-rmpg-500">No bookings today.</div>}
      {rows.map((r) => (
        <button key={r.booking_id} disabled={!r.person_id}
          onClick={() => r.person_id && onSelect('person', r.person_id, r.name)}
          className="w-full flex items-center gap-2 py-[5px] border-b border-border-subtle last:border-b-0 text-left disabled:cursor-default">
          {r.match === 'exact'
            ? <span className="font-mono text-[8px] px-[5px] py-[1px] rounded-[2px] bg-[#3a0d0a] text-[#ff6b5e]">MATCH</span>
            : <span className="font-mono text-[8px] px-[5px] py-[1px] rounded-[2px] bg-surface-raised text-[#aaa]">NEW</span>}
          <span className="text-[11px] text-rmpg-200 min-w-0 flex-1 truncate">{r.name}</span>
          <span className="text-[10px] text-rmpg-500">{r.booked_at?.slice(11, 16)}</span>
        </button>
      ))}
    </WidgetFrame>
  );
}
