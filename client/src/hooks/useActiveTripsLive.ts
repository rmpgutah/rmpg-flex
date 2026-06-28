// ============================================================
// RMPG Flex — useActiveTripsLive Hook
// Live "current active trip, by unit" map for the dispatch board,
// nav drawer, and map (Tasks 8/9/10 all reuse this).
//
// Two feeds, one source of truth:
//   1. Polling — seed + periodic refresh of /dispatch/trips/active
//      (via the existing useActiveTrips hook). This carries the LIVE
//      rollups (distance_m, duration_s) that grow while a trip is open;
//      lifecycle changes alone wouldn't update those numbers.
//   2. Socket — 'trip_update' lifecycle frames over the SAME AlertHub
//      subscribe bus the board already uses for dispatch_update /
//      unit_position. 'opened' adds a trip; 'closed' removes it (only
//      when the closed trip.id matches the one we're holding, so a
//      stale/duplicate close can't wipe a freshly-opened trip).
//
// We do NOT open a second WebSocket — subscribe() routes through the
// shared WebSocketContext fan-in (see context/WebSocketContext.tsx).
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import { useActiveTrips, type Trip } from './useTrips';
import type { WSMessage } from '../types';

// Match the dispatch board's existing cross-device sync cadence (20s) so the
// live distance/duration on the badge stays fresh without adding a new beat.
const REFRESH_MS = 20000;

/**
 * A live Map<unit_id, Trip> of each unit's currently-active trip.
 * Seeded + periodically refreshed from /dispatch/trips/active, then kept
 * live by 'trip_update' socket frames. Reuse via `getTrip(unitId)`.
 *
 * If a unit somehow has more than one active trip in the poll payload, the
 * last one wins — the API returns at most one active trip per unit in
 * practice (a unit can't be on two trips at once).
 */
export function useActiveTripsLive(): {
  trips: Map<number, Trip>;
  getTrip: (unitId: number | string | null | undefined) => Trip | undefined;
} {
  const { active, reload } = useActiveTrips();
  const { subscribe } = useWebSocket();
  const [trips, setTrips] = useState<Map<number, Trip>>(new Map());

  // Periodic refresh for live rollups (distance/duration grow while open).
  // Skip when the tab is hidden / offline — same gate the board's polls use.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    const eligible = () =>
      (typeof document === 'undefined' || document.visibilityState === 'visible') &&
      (typeof navigator === 'undefined' || navigator.onLine !== false);
    const iv = setInterval(() => { if (eligible()) reloadRef.current(); }, REFRESH_MS);
    return () => clearInterval(iv);
  }, []);

  // Rebuild the map from each poll result. This is the canonical snapshot;
  // socket frames between polls patch it incrementally below.
  useEffect(() => {
    const next = new Map<number, Trip>();
    for (const t of active) {
      if (t.status === 'active') next.set(t.unit_id, t);
    }
    setTrips(next);
  }, [active]);

  // Live lifecycle patches over the shared AlertHub bus.
  useEffect(() => {
    const unsub = subscribe('trip_update', (msg: WSMessage) => {
      const data = (msg as any).data || (msg as any);
      const action = data?.action as string | undefined;
      const trip = data?.trip as Trip | undefined;
      // unit_id can ride at the top level or on the trip itself.
      const rawUnit = data?.unit_id ?? trip?.unit_id;
      const unitId = rawUnit != null ? Number(rawUnit) : NaN;
      if (!Number.isFinite(unitId)) return;

      if (action === 'opened') {
        if (!trip) return;
        setTrips((prev) => {
          const next = new Map(prev);
          next.set(unitId, trip);
          return next;
        });
      } else if (action === 'closed') {
        setTrips((prev) => {
          const cur = prev.get(unitId);
          // Only clear if the closed trip is the one we're holding — a stale or
          // out-of-order close for a superseded trip must not wipe the live one.
          if (!cur) return prev;
          if (trip?.id != null && cur.id !== trip.id) return prev;
          const next = new Map(prev);
          next.delete(unitId);
          return next;
        });
      }
    });
    return unsub;
  }, [subscribe]);

  const getTrip = (unitId: number | string | null | undefined): Trip | undefined => {
    if (unitId == null) return undefined;
    const n = Number(unitId);
    return Number.isFinite(n) ? trips.get(n) : undefined;
  };

  return { trips, getTrip };
}

export default useActiveTripsLive;
