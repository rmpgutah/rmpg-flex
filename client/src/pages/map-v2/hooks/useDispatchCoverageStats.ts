import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';
import type { Unit, CallForService } from '../../../types';
import { devWarn } from '../../../utils/devLog';

export interface CoverageStats {
  unitsTotal: number;
  unitsAvailable: number;
  unitsDispatched: number;
  unitsEnroute: number;
  unitsOnscene: number;
  unitsBusy: number;
  unitsOffDuty: number;
  callsP1: number;
  callsP2: number;
  callsActive: number;
  callsPending: number;
}

const ZERO: CoverageStats = {
  unitsTotal: 0, unitsAvailable: 0, unitsDispatched: 0, unitsEnroute: 0,
  unitsOnscene: 0, unitsBusy: 0, unitsOffDuty: 0,
  callsP1: 0, callsP2: 0, callsActive: 0, callsPending: 0,
};

/**
 * Live dispatch-coverage stats for the V2 status bar.
 *
 * Fetches /dispatch/units + /dispatch/calls?limit=200 on first mount
 * and on every dispatch_update / unit_update WS event (1s debounced
 * so a burst of unit position updates doesn't hammer the API).
 *
 * Derived counts are computed client-side from the raw arrays so the
 * shape can evolve without a server round-trip.
 */
export function useDispatchCoverageStats(): CoverageStats {
  const [stats, setStats] = useState<CoverageStats>(ZERO);
  const { subscribe } = useWebSocket();

  const refetch = useCallback(async () => {
    try {
      const [callsRes, unitsRes] = await Promise.all([
        apiFetch<any>('/dispatch/calls?limit=200'),
        apiFetch<Unit[]>('/dispatch/units'),
      ]);
      const callsRaw: any[] = Array.isArray(callsRes?.data) ? callsRes.data : Array.isArray(callsRes) ? callsRes : [];
      const calls: CallForService[] = callsRaw;
      const units: Unit[] = Array.isArray(unitsRes) ? unitsRes : [];

      const next: CoverageStats = {
        unitsTotal: units.length,
        unitsAvailable: units.filter((u) => u.status === 'available').length,
        unitsDispatched: units.filter((u) => u.status === 'dispatched').length,
        unitsEnroute: units.filter((u) => u.status === 'enroute').length,
        unitsOnscene: units.filter((u) => u.status === 'onscene').length,
        unitsBusy: units.filter((u) => u.status === 'busy').length,
        unitsOffDuty: units.filter((u) => u.status === 'off_duty' || u.status === 'out_of_service').length,
        callsActive: calls.filter((c) => c.status !== 'cleared' && c.status !== 'cancelled' && c.status !== 'closed').length,
        callsP1: calls.filter((c) => c.priority === 'P1' && c.status !== 'cleared' && c.status !== 'cancelled' && c.status !== 'closed').length,
        callsP2: calls.filter((c) => c.priority === 'P2' && c.status !== 'cleared' && c.status !== 'cancelled' && c.status !== 'closed').length,
        callsPending: calls.filter((c) => c.status === 'pending' || c.status === 'on_hold').length,
      };
      setStats(next);
    } catch (err) {
      devWarn('[map-v2] coverage stats refetch failed:', err);
    }
  }, []);

  useEffect(() => {
    refetch();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refetch, 1000);
    };
    const unsubUnit = subscribe('unit_update', debounced);
    const unsubDispatch = subscribe('dispatch_update', debounced);
    return () => {
      if (timer) clearTimeout(timer);
      unsubUnit();
      unsubDispatch();
    };
  }, [refetch, subscribe]);

  return stats;
}
