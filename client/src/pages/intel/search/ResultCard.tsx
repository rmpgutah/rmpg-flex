import { authedImageUrl } from '../../../hooks/useApi';
import type { ClusteredHit } from '../clusterHits';
import { formatEnumValue } from '../../../utils/formatters';

// Entity-type label colours — use CSS-variable-backed Tailwind tokens so the
// card re-themes between night and day without edits here. Semantic mapping:
//   person / case  → brand gold  (brand-400)
//   vehicle        → green-400   (emerald, distinct from gold)
//   warrant        → red-400     (alert)
//   incident       → amber-400   (caution)
//   call           → cyan-400    (comms)
const TYPE_TAG: Record<string, string> = {
  person: 'text-brand-400', vehicle: 'text-green-400', warrant: 'text-red-400',
  case: 'text-brand-400', incident: 'text-amber-400', call: 'text-cyan-400',
};

export default function ResultCard({ clustered, onSelect, onOpen, highlighted }: {
  clustered: ClusteredHit;
  onSelect: (type: string, id: number, label: string) => void;
  onOpen: (type: string, id: number) => void;
  highlighted?: boolean;
}) {
  const h = clustered.hit;
  return (
    <div className={`bg-surface-overlay rounded-[2px] p-2 flex items-center gap-3 border ${highlighted ? 'border-brand-500' : 'border-border-default hover:border-border-subtle'}`}>
      {h.type === 'person' && (
        h.photo_url
          ? <img src={authedImageUrl(h.photo_url)} alt="" className="w-9 h-11 object-cover rounded-[2px] border border-border-default shrink-0" />
          : <div className="w-9 h-11 bg-surface-sunken border border-border-default rounded-[2px] shrink-0" />
      )}
      <button type="button" className="flex-1 min-w-0 text-left" onClick={() => onSelect(h.type, h.id, h.label)}>
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[8px] uppercase ${TYPE_TAG[h.type] || 'text-rmpg-400'}`}>{formatEnumValue(h.type)}</span>
          {clustered.linkedCount > 1 && (
            <span className="font-mono text-[8px] text-brand-400 border border-brand-900 rounded-[2px] px-[4px]">{clustered.linkedCount} linked</span>
          )}
        </div>
        <div className="text-[12px] text-rmpg-200 truncate">{h.label || `#${h.id}`}</div>
        {h.snippet && <div className="text-[10px] text-rmpg-500 truncate">{h.snippet}</div>}
        <div className="flex gap-1 mt-[3px] flex-wrap">
          {h.flags.map((f) => (
            <span key={f} className="font-mono text-[8px] px-[5px] py-[1px] rounded-[2px] bg-red-950 text-red-400">{f}</span>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-[3px]">
          <div className="h-[3px] w-[60px] bg-surface-sunken rounded-[2px] overflow-hidden" data-testid="relevance-bar">
            <div className="h-full bg-brand-500" style={{ width: `${Math.max(8, Math.min(100, h.score))}%` }} />
          </div>
          {h.date && <span className="font-mono text-[8px] text-rmpg-500">{h.date}</span>}
        </div>
      </button>
      <button onClick={() => onOpen(h.type, h.id)}
        className="font-mono text-[8px] tracking-wide text-brand-400 border border-border-subtle rounded-[2px] px-2 py-[6px] uppercase shrink-0">Open</button>
    </div>
  );
}
