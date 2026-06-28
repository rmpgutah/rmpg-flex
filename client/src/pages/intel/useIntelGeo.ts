// Fetch the geospatial intel feature arrays for the map. Debounce-free; the
// time-window control drives a refetch via the `days` dependency.
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import type { GeoFeature } from './map/geoLayers';

export interface GeoResponse { layers: Record<string, GeoFeature[]>; geocoding: { pending: number } }

const EMPTY: GeoResponse = { layers: {}, geocoding: { pending: 0 } };

export function useIntelGeo(initialDays = 30) {
  const [days, setDays] = useState(initialDays);
  const [data, setData] = useState<GeoResponse>(EMPTY);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<GeoResponse>(`/intel/geo?days=${days}`)
      .then((r) => setData(r && r.layers ? r : EMPTY))
      .catch(() => setData(EMPTY))
      .finally(() => setLoading(false));
  }, [days]);
  useEffect(load, [load]);

  return { data, loading, days, setDays, reload: load };
}
