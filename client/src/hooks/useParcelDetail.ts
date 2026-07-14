// client/src/hooks/useParcelDetail.ts
// Full advanced parcel detail (all ~35 typed fields + raw_data_json) for
// the "advanced data" expandable view — deliberately separate from
// useAssessorLookup, which only ever needs the lightweight ParcelSummary
// shape for the on-blur picker.

import { useCallback, useState } from 'react';
import { apiFetch } from './useApi';

export interface ParcelDetail {
  parcel_number: string;
  source: string;
  source_url: string;
  [key: string]: unknown;
  raw_data_json: Record<string, string>;
}

interface ParcelDetailResponse {
  ok: boolean;
  parcel: ParcelDetail | null;
  code: string;
}

export function useParcelDetail() {
  const [parcel, setParcel] = useState<ParcelDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async (parcelNumber: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<ParcelDetailResponse>(`/assessor/parcel/${encodeURIComponent(parcelNumber)}`);
      if (!res.ok || !res.parcel) {
        setError('No detail available for this parcel');
        setParcel(null);
        return;
      }
      setParcel(res.parcel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load parcel detail');
      setParcel(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return { parcel, loading, error, fetchDetail };
}
