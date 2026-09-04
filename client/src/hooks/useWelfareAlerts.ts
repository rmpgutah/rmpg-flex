import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';
import { useWebSocket } from '../context/WebSocketContext';

export interface WelfareAlert {
  user_id: number;
  officer_name?: string;
  badge_number?: string;
  call_sign?: string;
  status: 'normal' | 'prompted' | 'overdue' | 'emergency';
  minutes_since_last_check?: number;
}

const POLL_INTERVAL_MS = 60_000;

export interface UseWelfareAlertsResult {
  alerts: WelfareAlert[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useWelfareAlerts(): UseWelfareAlertsResult {
  const [alerts, setAlerts] = useState<WelfareAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { subscribe } = useWebSocket();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const refetch = useCallback(() => {
    apiFetch<WelfareAlert[]>('/dispatch/welfare/status')
      .then((rows) => {
        if (!mountedRef.current) return;
        setAlerts(rows.filter(a => a.status === 'emergency' || a.status === 'overdue'));
        setError(null);
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        console.warn('[useWelfareAlerts] fetch failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to load welfare status');
      })
      .finally(() => { if (mountedRef.current) setLoading(false); });
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  // /welfare/escalate broadcasts a distinct 'welfare_alert' WS type this
  // codebase's WSMessageType union doesn't include yet (checked
  // client/src/types/index.ts) — rather than widen that shared type as a
  // side effect of this UI-only phase, poll to catch escalation updates.
  // panic_alert IS subscribed below since /welfare/help shares panic.ts's
  // broadcastPanic() helper, covering the higher-urgency real-time case.
  useEffect(() => {
    mountedRef.current = true;
    timerRef.current = setInterval(refetch, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refetch]);

  useEffect(() => {
    const unsub = subscribe('panic_alert', () => refetch());
    return unsub;
  }, [subscribe, refetch]);

  return { alerts, loading, error, refetch };
}
