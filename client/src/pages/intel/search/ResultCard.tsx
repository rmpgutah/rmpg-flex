import { authedImageUrl } from '../../../hooks/useApi';
import type { ClusteredHit } from '../clusterHits';

const TYPE_TAG: Record<string, string> = {
  person: 'text-[#d4a017]', vehicle: 'text-[#10b981]', warrant: 'text-[#ff6b5e]',
  case: 'text-[#d4a017]', incident: 'text-[#f59e0b]', call: 'text-[#22d3ee]',
};

export default function ResultCard({ clustered, onSelect, onOpen, highlighted }: {
  clustered: ClusteredHit;
  onSelect: (type: string, id: number, label: string) => void;
  onOpen: (type: string, id: number) => void;
  highlighted?: boolean;
}) {
  const h = clustered.hit;
  return (
    <div className={`bg-surface-overlay rounded-[2px] p-2 flex items-center gap-3 border ${highlighted ? 'border-[#d4a017]' : 'border-border-default hover:border-border-subtle'}`}>
      {h.type === 'person' && (
        h.photo_url
          ? <img src={authedImageUrl(h.photo_url)} alt="" className="w-9 h-11 object-cover rounded-[2px] border border-border-default shrink-0" />
          : <div className="w-9 h-11 bg-surface-sunken border border-border-default rounded-[2px] shrink-0" />
      )}
      <button className="flex-1 min-w-0 text-left" onClick={() => onSelect(h.type, h.id, h.label)}>
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[8px] uppercase ${TYPE_TAG[h.type] || 'text-[#888]'}`}>{h.type}</span>
          {clustered.linkedCount > 1 && (
            <span className="font-mono text-[8px] text-[#d4a017] border border-[#3a2a08] rounded-[2px] px-[4px]">{clustered.linkedCount} linked</span>
          )}
        </div>
        <div className="text-[12px] text-rmpg-200 truncate">{h.label || `#${h.id}`}</div>
        {h.snippet && <div className="text-[10px] text-rmpg-500 truncate">{h.snippet}</div>}
        <div className="flex gap-1 mt-[3px] flex-wrap">
          {h.flags.map((f) => (
            <span key={f} className="font-mono text-[8px] px-[5px] py-[1px] rounded-[2px] bg-[#3a0d0a] text-[#ff6b5e]">{f}</span>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-[3px]">
          <div className="h-[3px] w-[60px] bg-surface-sunken rounded-[2px] overflow-hidden" data-testid="relevance-bar">
            <div className="h-full bg-[#d4a017]" style={{ width: `${Math.max(8, Math.min(100, h.score))}%` }} />
          </div>
          {h.date && <span className="font-mono text-[8px] text-rmpg-500">{h.date}</span>}
        </div>
      </button>
      <button onClick={() => onOpen(h.type, h.id)}
        className="font-mono text-[8px] tracking-wide text-[#d4a017] border border-border-subtle rounded-[2px] px-2 py-[6px] uppercase shrink-0">Open</button>
    </div>
  );
}
