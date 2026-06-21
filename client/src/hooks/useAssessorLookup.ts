// client/src/hooks/useAssessorLookup.ts
// On-blur Assessor lookup. Returns parcels, loading, error, plus
// dismiss() / refetch() controls. Lookup is debounced to dedupe rapid blurs.

import { useCallback, useRef, useState } from 'react';
import { apiFetch } from './useApi';

export interface ParcelSummary {
  parcel_number: string;
  owner_of_record: string | null;
  situs_address: string | null;
  land_sqft: number | null;
  total_market_value: number | null;
  detail_url: string;
}

interface LookupResponse {
  parcels: ParcelSummary[];
  cached: boolean;
  source_url: string | null;
}

const DIGIT_RE = /\d/;

export function useAssessorLookup() {
  const [parcels, setParcels] = useState<ParcelSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  const lookup = useCallback(async (address: string) => {
    setError(null);
    const trimmed = address.trim();
    if (!trimmed || !DIGIT_RE.test(trimmed)) {
      setParcels(null);
      return;
    }
    inFlight.current?.abort();
    const ctl = new AbortController();
    inFlight.current = ctl;
    setLoading(true);
    try {
      const res = await apiFetch<LookupResponse>(
        `/assessor/parcels?address=${encodeURIComponent(trimmed)}`,
        { signal: ctl.signal },
      );
      if (!ctl.signal.aborted) {
        setParcels(res.parcels);
        setCached(res.cached);
      }
    } catch (e: any) {
      if (!ctl.signal.aborted) setError(e?.message ?? 'Assessor lookup failed');
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, []);

  const dismiss = useCallback(() => setParcels(null), []);
  return { parcels, loading, error, cached, lookup, dismiss };
}
