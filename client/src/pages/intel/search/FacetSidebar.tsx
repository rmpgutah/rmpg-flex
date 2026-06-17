import type { Facets } from '../useIntelQuery';

export default function FacetSidebar({ facets, activeType, activeFlags, onToggleType, onToggleFlag }: {
  facets: Facets;
  activeType: string | null;
  activeFlags: string[];
  onToggleType: (t: string) => void;
  onToggleFlag: (f: string) => void;
}) {
  const types = Object.entries(facets.byType).sort((a, b) => b[1] - a[1]);
  const flags = Object.entries(facets.byFlag).sort((a, b) => b[1] - a[1]);
  const Row = ({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) => (
    <button onClick={onClick}
      className={`w-full flex items-center justify-between px-2 py-[4px] rounded-[2px] text-[11px] ${active ? 'bg-surface-sunken text-[#d4a017]' : 'text-rmpg-300 hover:bg-surface-sunken'}`}>
      <span className="capitalize truncate">{label.replace('_', ' ')}</span>
      <span className="font-mono text-[9px] text-[#888]">{count}</span>
    </button>
  );
  return (
    <div className="w-[150px] shrink-0 space-y-3">
      {types.length > 0 && (
        <div>
          <div className="font-mono text-[8px] tracking-widest text-rmpg-500 uppercase px-2 mb-1">Type</div>
          {types.map(([t, n]) => <Row key={t} label={t} count={n} active={activeType === t} onClick={() => onToggleType(t)} />)}
        </div>
      )}
      {flags.length > 0 && (
        <div>
          <div className="font-mono text-[8px] tracking-widest text-rmpg-500 uppercase px-2 mb-1">Flag</div>
          {flags.map(([f, n]) => <Row key={f} label={f} count={n} active={activeFlags.includes(f)} onClick={() => onToggleFlag(f)} />)}
        </div>
      )}
    </div>
  );
}
