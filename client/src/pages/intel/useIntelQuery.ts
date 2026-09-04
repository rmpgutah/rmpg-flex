// Calls /api/intel/query with the parsed structured params. Returns enriched
// hits + facet counts. Debounced by the caller; this just fetches.
import { useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { toQueryParams, type ParsedQuery } from './useQueryParser';

export interface QueryHit {
  type: string; id: number; label: string; snippet: string;
  flags: string[]; score: number; photo_url?: string | null;
  cluster?: { canonical_person_id: number | null; pending_suggestions: number };
  date?: string | null;
}
export interface Facets { byType: Record<string, number>; byFlag: Record<string, number> }

export function useIntelQuery() {
  const [results, setResults] = useState<QueryHit[]>([]);
  const [facets, setFacets] = useState<Facets>({ byType: {}, byFlag: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback((parsed: ParsedQuery, raw: string) => {
    const qp = toQueryParams(parsed);
    if (Object.keys(qp).length === 0) { setResults([]); setFacets({ byType: {}, byFlag: {} }); return; }
    qp.raw = raw; // for server-side history
    setLoading(true);
    apiFetch<{ results: QueryHit[]; facets: Facets }>(`/intel/query?${new URLSearchParams(qp).toString()}`)
      .then((r) => { setResults(r.results || []); setFacets(r.facets || { byType: {}, byFlag: {} }); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'search failed'))
      .finally(() => setLoading(false));
  }, []);

  return { results, facets, loading, error, run };
}
