import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';
import { useWebSocket } from '../context/WebSocketContext';

export interface PanicAlert {
  id: number;
  user_id: number;
  user_name?: string;
  badge_number?: string;
  call_sign?: string;
  status: 'active' | 'acknowledged' | 'resolved' | 'cancelled' | 'false_alarm';
  source: string;
  created_at: string;
}

export interface UsePanicAlertsResult {
  alerts: PanicAlert[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePanicAlerts(): UsePanicAlertsResult {
  const [alerts, setAlerts] = useState<PanicAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { subscribe } = useWebSocket();
  const mountedRef = useRef(true);

  const refetch = useCallback(() => {
    apiFetch<PanicAlert[]>('/dispatch/panic')
      .then((rows) => {
        if (!mountedRef.current) return;
        setAlerts(rows.filter(a => a.status === 'active' || a.status === 'acknowledged'));
        setError(null);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : 'Failed to load panic alerts';
        console.error('[usePanicAlerts] fetch error:', err);
        setError(message);
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refetch();
    return () => {
      mountedRef.current = false;
    };
  }, [refetch]);

  useEffect(() => {
    const unsub = subscribe('panic_alert', () => {
      if (mountedRef.current) refetch();
    });
    return unsub;
  }, [subscribe, refetch]);

  return { alerts, loading, error, refetch };
}
