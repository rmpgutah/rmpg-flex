// Intel Search — federated, ranked search across every record type
// (persons, vehicles, calls, cases, warrants, citations, FIs, …) backed
// by /api/intel/search (FTS5 + identifier sniffing). Person hits carry
// hot flags (ACTIVE WARRANT / OFFICER SAFETY / GANG) and entity-
// resolution cluster info. Phase 1 of the Palantir-grade records work.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import ResolutionReviewPanel from '../components/ResolutionReviewPanel';

export interface IntelHit {
  type: string; id: number; label: string; snippet: string;
  flags: string[]; score: number;
  cluster?: { canonical_person_id: number | null; pending_suggestions: number };
}

const TYPE_LABELS: Record<string, string> = {
  person: 'PERSONS', vehicle: 'VEHICLES', property: 'PROPERTIES', case: 'CASES',
  incident: 'INCIDENTS', call: 'CALLS FOR SERVICE', warrant: 'WARRANTS',
  citation: 'CITATIONS', field_interview: 'FIELD INTERVIEWS',
  trespass_order: 'TRESPASS ORDERS', evidence: 'EVIDENCE',
};

// Where a result row navigates on click — mirrors record-page routes.
// Exported so GlobalSearch can share the same pivot logic.
export function recordPath(hit: { type: string; id: number }): string {
  switch (hit.type) {
    case 'person': return `/intel/person/${hit.id}`;
    case 'vehicle': return `/records?tab=vehicles&id=${hit.id}`;
    case 'warrant': return `/warrants?id=${hit.id}`;
    case 'case': return `/cases?id=${hit.id}`;
    default: return `/forensics?type=${hit.type}&id=${hit.id}`;
  }
}

export default function IntelSearchPage() {
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<IntelHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const navigate = useNavigate();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      apiFetch<{ results: IntelHit[] }>(`/intel/search?q=${encodeURIComponent(q)}`)
        .then((r) => setResults(r.results || []))
        .catch(console.error)
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [q]);

  const grouped = useMemo(() => {
    const filtered = typeFilter ? results.filter((r) => r.type === typeFilter) : results;
    const g = new Map<string, IntelHit[]>();
    for (const r of filtered) g.set(r.type, [...(g.get(r.type) || []), r]);
    return g;
  }, [results, typeFilter]);

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="INTEL SEARCH" icon={Search} />
      <ResolutionReviewPanel />
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search persons, vehicles, plates, phones, DOBs, case numbers…"
        className="w-full bg-[#050505] border border-[#222222] px-3 py-2 text-sm text-gray-200 focus:border-[#d4a017] outline-none"
      />
      <div className="flex gap-1 flex-wrap">
        {Object.entries(TYPE_LABELS).map(([t, label]) => (
          <button key={t}
            onClick={() => setTypeFilter(typeFilter === t ? null : t)}
            className={`text-[9px] px-2 py-[3px] border ${typeFilter === t ? 'border-[#d4a017] text-[#d4a017]' : 'border-[#222222] text-[#888888]'}`}>
            {label}
          </button>
        ))}
      </div>
      {loading && <div className="text-[11px] text-[#888888]">Searching…</div>}
      {[...grouped.entries()].map(([type, hits]) => (
        <div key={type} className="bg-[#141414] border border-[#222222]">
          <div className="px-2 py-[3px] text-[9px] font-semibold text-[#d4a017] border-b border-[#1a1a1a]">
            {TYPE_LABELS[type] || type.toUpperCase()} ({hits.length})
          </div>
          {hits.map((h) => (
            <button key={`${h.type}:${h.id}`}
              onClick={() => navigate(recordPath(h))}
              className="w-full text-left px-2 py-[2px] text-[11px] text-gray-200 hover:bg-[#1a1a1a] flex items-center gap-2 border-b border-[#1a1a1a] last:border-b-0">
              <span className="flex-1">{h.label}</span>
              {h.snippet && <span className="text-[#888888] truncate max-w-[300px]">{h.snippet}</span>}
              {h.flags.map((f) => (
                <span key={f} className="text-[9px] font-semibold text-red-500">{f}</span>
              ))}
              {h.cluster && h.cluster.pending_suggestions > 0 && (
                <span className="text-[9px] text-[#d4a017]">
                  {h.cluster.pending_suggestions} possible match{h.cluster.pending_suggestions > 1 ? 'es' : ''}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
      {!loading && q.trim().length >= 2 && results.length === 0 && (
        <div className="text-[11px] text-[#888888]">No results.</div>
      )}
    </div>
  );
}
