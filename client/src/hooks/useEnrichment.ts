import { useState, useCallback } from 'react';
import { apiFetch } from './useApi';

export interface EnrichmentSeed {
  first_name: string;
  last_name: string;
  dob?: string;
  city?: string;
  state?: string;
  address?: string;
  phone?: string;
  email?: string;
  dl_number?: string;
  ssn_last4?: string;
}

export interface EnrichmentAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  type?: string;
  source: string;
}

export interface EnrichedRecord {
  name?: string;
  dob?: string;
  addresses: EnrichmentAddress[];
  phones: string[];
  emails: string[];
  dl_number?: string;
  ssn_last4?: string;
  business_associations?: string[];
  watchlist_flags?: string[];
  source: string;
}

export interface SourceResult {
  source: string;
  ok: boolean;
  latency_ms: number;
  records: EnrichedRecord[];
  error?: string;
}

export interface EnrichmentResponse {
  match_tier: 'CONFIRMED' | 'UNCONFIRMED';
  anchors: string[];
  sources: SourceResult[];
  records: EnrichedRecord[];
  confirmed_count: number;
  cached: boolean;
  stale: boolean;
  searched_at: string;
}

export function useEnrichment() {
  const [result, setResult]   = useState<EnrichmentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const search = useCallback(async (seed: EnrichmentSeed, options?: { refresh?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const qs = options?.refresh ? '?refresh=1' : '';
      const res = await apiFetch<EnrichmentResponse>(`/enrichment/search${qs}`, {
        method: 'POST',
        body: JSON.stringify(seed),
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => { setResult(null); setError(null); }, []);

  return { search, result, loading, error, reset };
}
