import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';

export interface PremiseAlertListItem {
  id: number;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  alert_type: string;
  alert_level: 'critical' | 'warning' | 'info' | string;
  title: string;
  description?: string;
  flags?: string;
}

const POLL_INTERVAL_MS = 60_000;

export interface UsePremiseAlertsListResult {
  alerts: PremiseAlertListItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePremiseAlertsList(): UsePremiseAlertsListResult {
  const [alerts, setAlerts] = useState<PremiseAlertListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refetch = useCallback(() => {
    // No address/lat/lng query params — the route's own `where` clause
    // (src/routes/dispatch/geography.ts) defaults to all active, unexpired
    // premise alerts when none are provided.
    apiFetch<PremiseAlertListItem[]>('/dispatch/geography/premise-alerts')
      .then((data) => {
        setAlerts(data);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load premise alerts');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  // No WS broadcast exists for premise_alerts create/update — poll only.
  useEffect(() => {
    timerRef.current = setInterval(refetch, POLL_INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [refetch]);

  return { alerts, loading, error, refetch };
}
