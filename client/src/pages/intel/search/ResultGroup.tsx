import type { ClusteredHit } from '../clusterHits';
import { TYPE_LABELS } from '../intelTypes';
import ResultCard from './ResultCard';

// Group clustered hits by entity type, largest group first.
export function groupByType(clustered: ClusteredHit[]): Array<[string, ClusteredHit[]]> {
  const m = new Map<string, ClusteredHit[]>();
  for (const c of clustered) m.set(c.hit.type, [...(m.get(c.hit.type) || []), c]);
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
}

export default function ResultGroup({ type, items, onSelect, onOpen, highlightKey }: {
  type: string; items: ClusteredHit[];
  onSelect: (t: string, id: number, label: string) => void;
  onOpen: (t: string, id: number) => void;
  highlightKey?: string | null;
}) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-[8px] tracking-widest text-rmpg-500 uppercase px-1">
        {TYPE_LABELS[type] || type} <span className="text-[#444]">· {items.length}</span>
      </div>
      {items.map((c) => {
        const key = `${c.hit.type}:${c.hit.id}`;
        return <ResultCard key={key} clustered={c} onSelect={onSelect} onOpen={onOpen} highlighted={highlightKey === key} />;
      })}
    </div>
  );
}
