// client/src/hooks/useAssessorLookup.ts
// On-blur Assessor lookup. Returns parcels, loading, error, plus
// dismiss() / refetch() controls. Surfaces fallback-chain metadata
// (source / degraded / manual_url) so the panel can tell the user when
// they're looking at AI-derived or stale data.

import { useCallback, useRef, useState } from 'react';
import { apiFetch } from './useApi';

export interface ParcelSummary {
  parcel_number: string;
  owner_of_record: string | null;
  situs_address: string | null;
  land_sqft: number | null;
  total_market_value: number | null;
  detail_url: string;
  /** Recorder-only counties (Tooele) populate these instead of value fields. */
  recorded_document_url?: string | null;
  recorded_document_type?: string | null;
}

export type LookupSource =
  | 'firecrawl' | 'direct' | 'ai' | 'stale_cache' | 'cache' | 'none';

export type LookupCode =
  | 'ok' | 'not_configured' | 'no_match' | 'upstream_error' | 'timeout'
  | 'missing_address';

interface LookupResponse {
  ok: boolean;
  parcels: ParcelSummary[];
  cached: boolean;
  source: LookupSource;
  code: LookupCode;
  degraded: boolean;
  manual_url: string;
  diagnostic?: string;
}

const DIGIT_RE = /\d/;

export function useAssessorLookup() {
  const [parcels, setParcels] = useState<ParcelSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<LookupCode | null>(null);
  const [source, setSource] = useState<LookupSource | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  const lastAddress = useRef<string | null>(null);

  const fetchParcels = useCallback(async (address: string, fresh = false) => {
    setError(null);
    const trimmed = address.trim();
    if (!trimmed || !DIGIT_RE.test(trimmed)) {
      setParcels(null);
      setCode(null);
      setSource(null);
      setDegraded(false);
      setManualUrl(null);
      return;
    }
    lastAddress.current = trimmed;
    inFlight.current?.abort();
    const ctl = new AbortController();
    inFlight.current = ctl;
    setLoading(true);
    const qs = `/assessor/parcels?address=${encodeURIComponent(trimmed)}${fresh ? '&fresh=1' : ''}`;
    try {
      const res = await apiFetch<LookupResponse>(qs, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      setParcels(res.parcels ?? []);
      setCached(res.cached);
      setSource(res.source);
      setCode(res.code);
      setDegraded(res.degraded);
      setManualUrl(res.manual_url);
    } catch (e) {
      if (ctl.signal.aborted) return;
      setParcels([]);
      setCode('upstream_error');
      setSource('none');
      setDegraded(false);
      setError(e instanceof Error ? e.message : 'Assessor lookup failed');
      setManualUrl(`https://apps.saltlakecounty.gov/assessor/new/query.cfm?address=${encodeURIComponent(trimmed)}`);
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, []);

  const lookup = useCallback((address: string) => fetchParcels(address, false), [fetchParcels]);

  const dismiss = useCallback(() => {
    setParcels(null);
    setCode(null);
    setSource(null);
    setDegraded(false);
    setError(null);
  }, []);

  const retry = useCallback(() => {
    if (lastAddress.current) lookup(lastAddress.current);
  }, [lookup]);

  const refresh = useCallback(() => {
    if (lastAddress.current) fetchParcels(lastAddress.current, true);
  }, [fetchParcels]);

  return {
    parcels,
    loading,
    error,
    code,
    source,
    degraded,
    manualUrl,
    cached,
    lookup,
    dismiss,
    retry,
    refresh,
  };
}
