// Intel Search — federated, ranked search across every record type
// (persons, vehicles, calls, cases, warrants, citations, FIs, …) backed
// by /api/intel/search (FTS5 + identifier sniffing). Person hits carry
// hot flags (ACTIVE WARRANT / OFFICER SAFETY / GANG) and entity-
// resolution cluster info. Phase 1 of the Palantir-grade records work.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import ResolutionReviewPanel from '../components/ResolutionReviewPanel';
import SuggestedLinksPanel from '../components/SuggestedLinksPanel';

import { type IntelHit, TYPE_LABELS, recordPath } from './intel/intelTypes';
import { downloadTextFile, intelHitsToCsv, shareSearchUrl } from '../utils/intelHitExport';
export { recordPath };
export type { IntelHit };

const RECENT_KEY = 'rmpg_intel_search_recent';

export default function IntelSearchPage() {
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<IntelHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [flagsOnly, setFlagsOnly] = useState(false);
  const [sort, setSort] = useState<'score' | 'label'>('score');
  const [recent, setRecent] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
  });
  const navigate = useNavigate();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      apiFetch<{ results: IntelHit[] }>(`/intel/search?q=${encodeURIComponent(q)}`)
        .then((r) => {
          setResults(r.results || []);
          setRecent((prev) => {
            const next = [q.trim(), ...prev.filter((x) => x !== q.trim())].slice(0, 8);
            try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* */ }
            return next;
          });
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'INPUT') { e.preventDefault(); inputRef.current?.focus(); }
      if (e.key === 'Escape') { setTypeFilter(null); setFlagsOnly(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const grouped = useMemo(() => {
    let filtered = typeFilter ? results.filter((r) => r.type === typeFilter) : results;
    if (flagsOnly) filtered = filtered.filter((r) => (r.flags ?? []).length > 0);
    filtered = [...filtered].sort((a, b) => sort === 'label' ? a.label.localeCompare(b.label) : b.score - a.score);
    const g = new Map<string, IntelHit[]>();
    for (const r of filtered) g.set(r.type, [...(g.get(r.type) || []), r]);
    return g;
  }, [results, typeFilter, flagsOnly, sort]);

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="INTEL SEARCH" icon={Search} />
      <ResolutionReviewPanel />
      <SuggestedLinksPanel />
      <input
        ref={inputRef}
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search persons, vehicles, plates, phones, DOBs, case numbers…"
        aria-label="Search persons, vehicles, plates, phones, dates of birth, and case numbers"
        className="w-full bg-surface-overlay border border-border-default px-3 py-2 text-sm text-rmpg-200 focus:[border-color:var(--field-label-color)] outline-none"
      />
      <div className="flex gap-2 flex-wrap items-center">
        <button type="button" className={`text-[9px] px-2 py-[3px] border ${flagsOnly ? '[border-color:var(--field-label-color)]' : 'border-border-default text-fg-muted'}`} onClick={() => setFlagsOnly((v) => !v)}>FLAGS ONLY</button>
        <button type="button" className="text-[9px] px-2 py-[3px] border border-border-default text-fg-muted" onClick={() => setSort((s) => s === 'score' ? 'label' : 'score')}>SORT: {sort.toUpperCase()}</button>
        <button type="button" className="text-[9px] px-2 py-[3px] border border-border-default text-fg-muted" onClick={() => navigator.clipboard.writeText(shareSearchUrl(q)).catch(() => undefined)}>COPY LINK</button>
        <button type="button" className="text-[9px] px-2 py-[3px] border border-border-default text-fg-muted" disabled={results.length === 0} onClick={() => downloadTextFile('intel-search.csv', intelHitsToCsv(results))}>EXPORT CSV</button>
        <span className="text-[9px] text-fg-muted ml-auto font-mono">{results.length} hits</span>
      </div>
      {recent.length > 0 && q.trim().length < 2 && (
        <div className="flex gap-1 flex-wrap">
          {recent.map((r) => (
            <button key={r} type="button" onClick={() => setQ(r)} className="text-[9px] px-2 py-[3px] border border-border-default text-fg-muted">{r}</button>
          ))}
        </div>
      )}
      <div className="flex gap-1 flex-wrap">
        {Object.entries(TYPE_LABELS).map(([t, label]) => (
          <button key={t}
            onClick={() => setTypeFilter(typeFilter === t ? null : t)}
            className={`text-[9px] px-2 py-[3px] border ${typeFilter === t ? '[border-color:var(--field-label-color)] [color:var(--panel-header-color)]' : 'border-border-default text-fg-muted'}`}>
            {label}
          </button>
        ))}
      </div>
      {loading && <div className="text-[11px] text-fg-muted">Searching…</div>}
      {[...grouped.entries()].map(([type, hits]) => (
        <div key={type} className="bg-surface-base border border-border-default">
          <div className="px-2 py-[3px] text-[9px] font-semibold [color:var(--panel-header-color)] border-b border-border-default">
            {TYPE_LABELS[type] || type.toUpperCase()} ({hits.length})
          </div>
          {hits.map((h) => (
            <button key={`${h.type}:${h.id}`}
              onClick={() => navigate(recordPath(h))}
              className="w-full text-left px-2 py-[2px] text-[11px] text-rmpg-200 hover:bg-surface-raised flex items-center gap-2 border-b border-border-default last:border-b-0">
              <span className="flex-1">{h.label}</span>
              {h.snippet && <span className="text-fg-muted truncate max-w-[300px]">{h.snippet}</span>}
              {h.flags.map((f) => (
                <span key={f} className="text-[9px] font-semibold text-red-500">{f}</span>
              ))}
              {h.cluster && h.cluster.pending_suggestions > 0 && (
                <span className="text-[9px] [color:var(--panel-header-color)]">
                  {h.cluster.pending_suggestions} possible match{h.cluster.pending_suggestions > 1 ? 'es' : ''}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
      {!loading && q.trim().length >= 2 && results.length === 0 && (
        <div className="text-[11px] text-fg-muted">No results.</div>
      )}
    </div>
  );
}
