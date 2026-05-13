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
import { config } from '@mapbox/search-js-react';
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
  const tokenRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const proximity = options?.proximity || SLC_PROXIMITY;
  const country = options?.country || 'US';
  const limit = options?.limit || 5;

  // Resolve token
  useEffect(() => {
    let cancelled = false;
    getMapboxTokenStatus().then(status => {
      if (!cancelled && status.configured && status.token) {
        tokenRef.current = status.token;
        config.accessToken = status.token;
        setAvailable(true);
      }
    }).catch(() => { /* no token */ });
    return () => { cancelled = true; };
  }, []);

  const search = useCallback(async (query: string): Promise<SearchBoxResult[]> => {
    if (!tokenRef.current || !query.trim()) {
      setResults([]);
      return [];
    }

    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setSearching(true);
    try {
      // Use the Mapbox Geocoding API v6 (Search Box API)
      const params = new URLSearchParams({
        q: query.trim(),
        access_token: tokenRef.current,
        country,
        limit: String(limit),
        proximity: proximity.join(','),
        language: 'en',
      });
      if (options?.types?.length) params.set('types', options.types.join(','));

      const resp = await fetch(
        `https://api.mapbox.com/search/geocode/v6/forward?${params}`,
        { signal: abort.signal }
      );

      if (!resp.ok) {
        setSearching(false);
        return [];
      }

      const data = await resp.json();
      const mapped: SearchBoxResult[] = (data.features || []).map((f: any) => ({
        id: f.id || f.properties?.mapbox_id || '',
        name: f.properties?.name || f.properties?.full_address || '',
        full_address: f.properties?.full_address || '',
        place_type: f.properties?.feature_type || f.type || '',
        latitude: f.geometry?.coordinates?.[1] ?? 0,
        longitude: f.geometry?.coordinates?.[0] ?? 0,
        properties: f.properties || {},
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
