// Supercharged Intel Search: parser → /api/intel/query → facets + clustered
// preview cards. Card click drives the right context panel; Open routes to the
// record. Replaces the old flat IntelSearchPage at /intel/search.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseQuery } from './useQueryParser';
import { useIntelQuery } from './useIntelQuery';
import { clusterHits } from './clusterHits';
import { useIntelContext } from './IntelContext';
import { recordPath } from './intelTypes';
import SearchBar from './search/SearchBar';
import FacetSidebar from './search/FacetSidebar';
import ResultGroup, { groupByType } from './search/ResultGroup';
import { stepIndex } from './search/stepIndex';
import { useSavedSearches } from './useSavedSearches';

export default function IntelSearch() {
  const [raw, setRaw] = useState('');
  const [activeType, setActiveType] = useState<string | null>(null);
  const [activeFlags, setActiveFlags] = useState<string[]>([]);
  const { results, facets, loading, error, run } = useIntelQuery();
  const { selectEntity } = useIntelContext();
  const { save } = useSavedSearches();
  const navigate = useNavigate();
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(debounce.current);
    if (raw.trim().length < 2) return;
    debounce.current = setTimeout(() => run(parseQuery(raw), raw), 250);
    return () => clearTimeout(debounce.current);
  }, [raw, run]);

  const clustered = useMemo(() => {
    let r = results;
    if (activeType) r = r.filter((h) => h.type === activeType);
    if (activeFlags.length) r = r.filter((h) => activeFlags.every((f) => h.flags.some((hf) => hf.toLowerCase().includes(f))));
    return clusterHits(r);
  }, [results, activeType, activeFlags]);

  // Grouped + flat views share one order so the keyboard cursor maps to the DOM.
  const grouped = useMemo(() => groupByType(clustered), [clustered]);
  const flat = useMemo(() => grouped.flatMap(([, items]) => items), [grouped]);
  const [cursor, setCursor] = useState(-1);
  useEffect(() => setCursor(-1), [flat]);
  const highlightKey = cursor >= 0 && flat[cursor] ? `${flat[cursor].hit.type}:${flat[cursor].hit.id}` : null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => stepIndex(c < 0 ? -1 : c, +1, flat.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => stepIndex(c < 0 ? 0 : c, -1, flat.length)); }
    else if (e.key === 'Enter' && cursor >= 0 && flat[cursor]) {
      const h = flat[cursor].hit;
      if (e.metaKey || e.ctrlKey) navigate(recordPath({ type: h.type, id: h.id }));
      else selectEntity(h.type, h.id, h.label);
    }
  };

  const toggleType = (t: string) => setActiveType((cur) => (cur === t ? null : t));
  const toggleFlag = (f: string) => setActiveFlags((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));

  return (
    <div className="p-3 space-y-3" onKeyDown={onKeyDown}>
      <SearchBar value={raw} onChange={setRaw} onSave={(name) => save(name, raw)} />
      {error && <div className="text-[10px] text-[#ff6b5e]">Search error: {error}</div>}

      <div className="flex gap-4">
        {(Object.keys(facets.byType).length > 0) && (
          <FacetSidebar facets={facets} activeType={activeType} activeFlags={activeFlags}
            onToggleType={toggleType} onToggleFlag={toggleFlag} />
        )}
        <div className="flex-1 min-w-0 space-y-2">
          {loading && <div className="text-[11px] text-[#888]">Searching…</div>}
          {!loading && raw.trim().length >= 2 && clustered.length === 0 && <div className="text-[11px] text-[#888]">No results.</div>}
          {clustered.length > 0 && (
            <div className="font-mono text-[9px] text-[#666] px-1">{clustered.length} result{clustered.length === 1 ? '' : 's'}</div>
          )}
          {grouped.map(([type, items]) => (
            <ResultGroup key={type} type={type} items={items} highlightKey={highlightKey}
              onSelect={selectEntity}
              onOpen={(t, id) => navigate(recordPath({ type: t, id }))} />
          ))}
          {raw.trim().length < 2 && (
            <div className="text-[11px] text-[#555] pt-6 text-center">
              Type to search. Use operators like <span className="text-[#d4a017] font-mono">plate:</span>,
              <span className="text-[#d4a017] font-mono"> name:"…"</span>,
              <span className="text-[#d4a017] font-mono"> flag:warrant</span>, or just a name / plate / phone.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
