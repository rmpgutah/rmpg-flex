import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../../hooks/useApi';

interface SearchResult {
  id: number | string;
  record_type?: string;
  type?: string;
  label?: string;
  subtitle?: string;
}

const MAX_RESULTS = 5;

function normalizeType(r: SearchResult): string {
  return String(r.type ?? r.record_type ?? 'RECORD').toUpperCase();
}

function routeFor(type: string, id: number | string, q: string): string {
  switch (type) {
    case 'PERSON':
      return `/records?person=${encodeURIComponent(String(id))}`;
    case 'VEHICLE':
      return `/records?vehicle=${encodeURIComponent(String(id))}`;
    case 'WARRANT':
      return `/warrants?id=${encodeURIComponent(String(id))}`;
    case 'INCIDENT':
      return `/incidents?id=${encodeURIComponent(String(id))}`;
    case 'CITATION':
      return `/citations?id=${encodeURIComponent(String(id))}`;
    case 'ARREST':
      return `/arrests?id=${encodeURIComponent(String(id))}`;
    case 'EVIDENCE':
      return `/evidence?id=${encodeURIComponent(String(id))}`;
    case 'PROPERTY':
      return `/records?property=${encodeURIComponent(String(id))}`;
    default:
      return `/records?q=${encodeURIComponent(q)}`;
  }
}

export default function QuickSearchCard() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  async function runSearch(q: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<SearchResult[]>(
        `/records/search?q=${encodeURIComponent(q)}`,
      );
      setResults(Array.isArray(data) ? data : []);
      setHasSearched(true);
      setSubmittedQuery(q);
    } catch (e: any) {
      setError(e?.message || 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    runSearch(q);
  }

  function handleChange(v: string) {
    setQuery(v);
    if (v === '') {
      setResults([]);
      setHasSearched(false);
      setSubmittedQuery('');
      setError(null);
    }
  }

  function handleRowClick(r: SearchResult) {
    const t = normalizeType(r);
    navigate(routeFor(t, r.id, submittedQuery));
  }

  // Group results by type, cap at 5 total
  const visibleResults = results.slice(0, MAX_RESULTS);
  const groups: Record<string, SearchResult[]> = {};
  for (const r of visibleResults) {
    const t = normalizeType(r);
    if (!groups[t]) groups[t] = [];
    groups[t].push(r);
  }
  const groupKeys = Object.keys(groups);

  return (
    <section className="bg-[#141414] border border-[#222] p-3">
      <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">
        QUICK SEARCH
      </h2>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="search"
            inputMode="search"
            autoComplete="off"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Person, plate, address…"
            className="w-full h-11 bg-[#050505] border border-[#222] text-white text-base px-3 placeholder:text-gray-600"
          />
          {loading && (
            <span
              aria-label="Searching"
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-block w-4 h-4 border-2 border-[#d4a017] border-t-transparent rounded-full animate-spin"
            />
          )}
        </div>
        <button
          type="submit"
          className="h-11 px-4 bg-[#1a1a1a] border border-[#222] text-[#d4a017] text-xs uppercase tracking-widest"
        >
          Search
        </button>
      </form>

      {error && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-amber-400 text-xs">{error}</span>
          <button
            type="button"
            onClick={() => submittedQuery && runSearch(submittedQuery)}
            className="h-11 px-3 bg-[#1a1a1a] border border-[#222] text-[#d4a017] text-[10px] uppercase tracking-widest"
          >
            Retry
          </button>
        </div>
      )}

      {!error && hasSearched && results.length === 0 && !loading && (
        <div className="mt-2 text-gray-500 text-xs">
          No matches for &quot;{submittedQuery}&quot;.
        </div>
      )}

      {!error && visibleResults.length > 0 && (
        <div className="mt-2">
          {groupKeys.map((type) => (
            <div key={type}>
              {groups[type].map((r, idx) => (
                <button
                  key={`${type}-${r.id}-${idx}`}
                  type="button"
                  onClick={() => handleRowClick(r)}
                  className="py-2 border-b border-[#1a1a1a] text-white text-xs w-full text-left flex items-center"
                >
                  <span className="bg-[#0a0a0a] border border-[#222] text-[#d4a017] text-[9px] font-bold tracking-widest px-1.5 py-0.5 mr-2">
                    {type}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{r.label || `#${r.id}`}</span>
                    {r.subtitle && (
                      <span className="block text-gray-500 text-[10px] truncate">
                        {r.subtitle}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
