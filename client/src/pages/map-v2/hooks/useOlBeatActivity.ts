import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';
import type { CallForService } from '../../../types';
import { devWarn } from '../../../utils/devLog';

/**
 * Map of beat_id (or beat_code) → count of active calls inside that
 * beat polygon. Server-derived from /dispatch/calls active set:
 * each call's beat_id (already populated server-side via geofence
 * auto-fill) is bucketed into the count map.
 *
 * Refetches debounced 1s on dispatch_update WS events. Used by
 * useOlBeatLayer to color beats heat-style and label them with
 * counts when active >0.
 */
export function useOlBeatActivity(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const { subscribe } = useWebSocket();

  const refetch = useCallback(async () => {
    try {
      const callsRes = await apiFetch<any>('/dispatch/calls?limit=200');
      const callsRaw: any[] = Array.isArray(callsRes?.data) ? callsRes.data : Array.isArray(callsRes) ? callsRes : [];
      const calls: CallForService[] = callsRaw;
      const next: Record<string, number> = {};
      for (const c of calls) {
        // Active = not cleared/closed/cancelled
        if (c.status === 'cleared' || c.status === 'closed' || c.status === 'cancelled') continue;
        const key = (c as any).beat_id || (c as any).beat_code;
        if (!key) continue;
        next[key] = (next[key] || 0) + 1;
      }
      setCounts(next);
    } catch (err) {
      devWarn('[map-v2] beat activity fetch failed:', err);
    }
  }, []);

  useEffect(() => {
    refetch();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refetch, 1000);
    };
    const unsub = subscribe('dispatch_update', debounced);
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [refetch, subscribe]);

  return counts;
}
