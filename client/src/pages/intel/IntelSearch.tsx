// Supercharged Intel Search: parser → /api/intel/query → facets + clustered
// preview cards. Card click drives the right context panel; Open routes to the
// record. Replaces the old flat IntelSearchPage at /intel/search.
//
// v1047 — Page 30 (Intel Portal) audit:
//   • URL deep-link `?q=…` hydrates the search input on mount and updates the
//     URL (replace, no history spam) as the operator types. Lets dispatch
//     paste a link like `/intel/search?q=name:"Hale"%20flag:warrant` straight
//     to a unit's MDT and have it land already filtered.
//   • Esc smart-cascade: facet filters → query text. Closes the smallest-open
//     state first so a single tap doesn't blow away a long query when the
//     operator only meant to drop the type-facet.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  const [searchParams, setSearchParams] = useSearchParams();
  // Initial query comes from the URL so deep-links (?q=name:"Hale") work.
  const [raw, setRaw] = useState(() => searchParams.get('q') || '');
  const [activeType, setActiveType] = useState<string | null>(null);
  const [activeFlags, setActiveFlags] = useState<string[]>([]);
  const { results, facets, loading, error, run } = useIntelQuery();
  const { selectEntity } = useIntelContext();
  const { save, saved, recent } = useSavedSearches();
  const navigate = useNavigate();
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(debounce.current);
    if (raw.trim().length < 2) {
      // Strip the URL param when the user clears the box so a stale ?q=
      // doesn't ghost into the next visit.
      if (searchParams.get('q')) {
        const next = new URLSearchParams(searchParams);
        next.delete('q');
        setSearchParams(next, { replace: true });
      }
      return;
    }
    debounce.current = setTimeout(() => {
      run(parseQuery(raw), raw);
      // Mirror the live query into the URL (replace — no history spam).
      const next = new URLSearchParams(searchParams);
      if (next.get('q') !== raw) {
        next.set('q', raw);
        setSearchParams(next, { replace: true });
      }
    }, 250);
    return () => clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams
    // setter is stable; explicit dep would force a re-debounce on every
    // unrelated query-string change (e.g. the dashboard's ?entity_id=).
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

  // Esc smart-cascade — clear facets first (smallest-open), then the query.
  // Matches the Court Tracker / Cases / Trespass cascade contract. Skipped
  // while focus is inside an input/textarea so the native form-clear
  // semantics (Esc on a date picker, for example) still work — the
  // SearchBar's <input> handles its own clear behavior via onChange.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      // Allow Esc inside the search input only to clear the query — don't
      // also drop facets in the same tap (cascade rule: smallest first).
      const isSearchInput = t?.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'date';
      if (activeFlags.length > 0 && !isSearchInput) { setActiveFlags([]); return; }
      if (activeType && !isSearchInput) { setActiveType(null); return; }
      if (raw) { setRaw(''); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeFlags, activeType, raw]);

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

  // Distinct empty states. The pre-search "type to search" placeholder must
  // NOT look the same as the post-search zero-matches state — the audit
  // caught operators staring at "no results" while having typed nothing.
  const hasQuery = raw.trim().length >= 2;
  const emptyResults = hasQuery && !loading && clustered.length === 0;

  return (
    <div className="p-3 space-y-3" onKeyDown={onKeyDown}>
      <SearchBar value={raw} onChange={setRaw} onSave={(name) => save(name, raw)} />
      {!hasQuery && (saved.length > 0 || recent.length > 0) && (
        <div className="flex gap-1 flex-wrap">
          {saved.slice(0, 6).map((s) => (
            <button key={`s${s.id}`} onClick={() => setRaw(s.query_text)}
              className="font-mono text-[9px] px-2 py-[3px] rounded-[2px] border border-[#3a2a08] text-brand-400">★ {s.name}</button>
          ))}
          {recent.slice(0, 6).map((r, i) => (
            <button key={`r${i}`} onClick={() => setRaw(r.query_text)}
              className="font-mono text-[9px] px-2 py-[3px] rounded-[2px] border border-border-default text-rmpg-400">{r.query_text}</button>
          ))}
        </div>
      )}
      {error && <div className="text-[10px] text-red-400">Search error: {error}</div>}

      <div className="flex gap-4">
        {(Object.keys(facets.byType).length > 0) && (
          <FacetSidebar facets={facets} activeType={activeType} activeFlags={activeFlags}
            onToggleType={toggleType} onToggleFlag={toggleFlag} />
        )}
        <div className="flex-1 min-w-0 space-y-2">
          {loading && <div className="text-[11px] text-rmpg-500">Searching…</div>}
          {emptyResults && (
            <div className="text-[11px] text-rmpg-400 text-center py-6">
              No results for <span className="font-mono text-brand-400">{raw}</span>.
              {(activeType || activeFlags.length > 0) && (
                <div className="text-[10px] text-rmpg-500 mt-1">Try removing the facet filter ({activeType || activeFlags.join(', ')}) — Esc clears it.</div>
              )}
            </div>
          )}
          {clustered.length > 0 && (
            <div className="font-mono text-[9px] text-rmpg-500 px-1">{clustered.length} result{clustered.length === 1 ? '' : 's'}</div>
          )}
          {grouped.map(([type, items]) => (
            <ResultGroup key={type} type={type} items={items} highlightKey={highlightKey}
              onSelect={selectEntity}
              onOpen={(t, id) => navigate(recordPath({ type: t, id }))} />
          ))}
          {!hasQuery && (
            <div className="text-[11px] text-rmpg-500 pt-6 text-center">
              Type to search. Use operators like <span className="text-brand-400 font-mono">plate:</span>,
              <span className="text-brand-400 font-mono"> name:&quot;…&quot;</span>,
              <span className="text-brand-400 font-mono"> flag:warrant</span>, or just a name / plate / phone.
              <div className="text-[10px] text-rmpg-500 mt-1">Tip: deep-link with <span className="font-mono text-rmpg-400">?q=&lt;query&gt;</span></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
