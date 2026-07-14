// client/src/hooks/useJurisdiction.ts
// Resolves + lets an operator override which county's assessor/recorder a
// Business/Property record's address falls under. Wraps
// GET/POST /api/assessor/jurisdiction.

import { useCallback, useState } from 'react';
import { apiFetch } from './useApi';

export type County = 'salt_lake' | 'utah' | 'summit' | 'tooele' | 'unsupported';
export type OverridableCounty = Exclude<County, 'unsupported'>;

export interface JurisdictionInfo {
  resolved_county: County;
  override: OverridableCounty | null;
  effective_county: County;
  label: string;
  manual_url: string;
}

interface UseJurisdictionOptions {
  recordType?: 'business' | 'property';
  recordId?: number | string;
}

export function useJurisdiction(address: string, options: UseJurisdictionOptions = {}) {
  const [info, setInfo] = useState<JurisdictionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInfo = useCallback(async () => {
    if (!address.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ address });
      if (options.recordType && options.recordId != null) {
        params.set('record_type', options.recordType);
        params.set('record_id', String(options.recordId));
      }
      const res = await apiFetch<JurisdictionInfo>(`/assessor/jurisdiction?${params.toString()}`);
      setInfo(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve jurisdiction');
    } finally {
      setLoading(false);
    }
  }, [address, options.recordType, options.recordId]);

  const setOverride = useCallback(async (county: OverridableCounty | null) => {
    if (!options.recordType || options.recordId == null) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch('/assessor/jurisdiction', {
        method: 'POST',
        body: JSON.stringify({ record_type: options.recordType, record_id: options.recordId, county }),
      });
      await fetchInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set jurisdiction override');
    } finally {
      setLoading(false);
    }
  }, [options.recordType, options.recordId, fetchInfo]);

  return { info, loading, error, fetchInfo, setOverride };
}
