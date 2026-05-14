// ============================================================
// RMPG Flex — Mapbox Search Box Hook
// ============================================================
// Headless hook wrapping @mapbox/search-js-react's SearchBox
// for programmatic search. Use this when you need search results
// without a UI component (e.g., for custom search panels).
//
// Mapbox Developer Cheatsheet: Search Box API
// ============================================================

import { useState, useCallback, useRef, useEffect } from 'react';
import { getMapboxTokenStatus } from '../utils/mapboxApiKey';

// ── Types ──────────────────────────────────────────────────

export interface SearchBoxResult {
  id: string;
  name: string;
  full_address: string;
  place_type: string;
  latitude: number;
  longitude: number;
  properties: Record<string, unknown>;
}

export interface UseMapboxSearchBoxResult {
  /** Whether the Mapbox token is available */
  available: boolean;
  /** Perform a search query */
  search: (query: string) => Promise<SearchBoxResult[]>;
  /** Current results */
  results: SearchBoxResult[];
  /** Whether a search is in progress */
  searching: boolean;
  /** Clear results */
  clear: () => void;
}

// ── Defaults ───────────────────────────────────────────────

const SLC_PROXIMITY: [number, number] = [-111.891, 40.7608];

// ── Hook ───────────────────────────────────────────────────

export function useMapboxSearchBox(options?: {
  proximity?: [number, number];
  country?: string;
  limit?: number;
  types?: string[];
}): UseMapboxSearchBoxResult {
  const [results, setResults] = useState<SearchBoxResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [available, setAvailable] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const proximity = options?.proximity || SLC_PROXIMITY;
  const country = options?.country || 'US';
  const limit = options?.limit || 5;

  // Check if Mapbox is configured (server-side proxy handles the token)
  useEffect(() => {
    let cancelled = false;
    getMapboxTokenStatus().then(status => {
      if (!cancelled && status.configured) {
        setAvailable(true);
      }
    }).catch(() => { /* no token */ });
    return () => { cancelled = true; };
  }, []);

  const search = useCallback(async (query: string): Promise<SearchBoxResult[]> => {
    if (!available || !query.trim()) {
      setResults([]);
      return [];
    }

    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setSearching(true);
    try {
      // Route through server-side proxy to protect access token
      const params = new URLSearchParams({
        q: query.trim(),
        country,
        limit: String(limit),
        proximity: proximity.join(','),
      });
      if (options?.types?.length) params.set('types', options.types.join(','));

      // Use apiFetch for authenticated server-side geocoding
      const { apiFetch } = await import('../hooks/useApi');
      const data = await apiFetch<{ results: Array<{ name: string; full_address: string; latitude: number; longitude: number; place_type: string; relevance: number }> }>(
        `/mapbox/geocode/forward?${params}`
      );

      if (abort.signal.aborted) return [];

      const mapped: SearchBoxResult[] = (data.results || []).map((r, idx) => ({
        id: `result-${idx}`,
        name: r.name || r.full_address || '',
        full_address: r.full_address || '',
        place_type: r.place_type || '',
        latitude: r.latitude ?? 0,
        longitude: r.longitude ?? 0,
        properties: r as unknown as Record<string, unknown>,
      }));

      if (!abort.signal.aborted) {
        setResults(mapped);
        setSearching(false);
      }
      return mapped;
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setSearching(false);
      }
      return [];
    }
  }, [country, limit, proximity, options?.types]);

  const clear = useCallback(() => {
    setResults([]);
    if (abortRef.current) abortRef.current.abort();
  }, []);

  return { available, search, results, searching, clear };
}
