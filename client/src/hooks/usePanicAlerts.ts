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
  refetch: () => void;
}

export function usePanicAlerts(): UsePanicAlertsResult {
  const [alerts, setAlerts] = useState<PanicAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const { subscribe } = useWebSocket();
  const mountedRef = useRef(true);

  const refetch = useCallback(() => {
    apiFetch<PanicAlert[]>('/dispatch/panic')
      .then((rows) => { if (mountedRef.current) setAlerts(rows.filter(a => a.status === 'active' || a.status === 'acknowledged')); })
      .catch(() => {})
      .finally(() => { if (mountedRef.current) setLoading(false); });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  useEffect(() => {
    const unsub = subscribe('panic_alert', () => refetch());
    return unsub;
  }, [subscribe, refetch]);

  return { alerts, loading, refetch };
}
