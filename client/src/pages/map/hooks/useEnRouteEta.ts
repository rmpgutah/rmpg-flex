import { useEffect, useRef, useState } from 'react';
import type { MapUnit, ActiveCall } from '../utils/mapConstants';
import type { EnRouteEta } from '../utils/mapMarkers';
import { fetchMapboxRoute } from '../../../utils/mapboxRouting';

const METERS_PER_MILE = 1609.34;
// Refetch cadence: real drive time doesn't change meaningfully faster than
// this, and it keeps a busy dispatch board well under Mapbox's Directions
// rate limits even with a dozen units en route simultaneously.
const REFRESH_MS = 30_000;

/**
 * ETA/distance for every currently en-route unit, keyed by the call_number
 * of the call it's matched to (mirrors the `unit.call_number === call.call_number`
 * join already used elsewhere in MapboxMapPage.tsx — units carry no
 * dedicated foreign key to a call row on the map's client-side shape).
 * Returns real routed duration/distance from Mapbox Directions, not a
 * straight-line estimate, refreshed on a fixed interval rather than on
 * every GPS poll tick.
 */
export function useEnRouteEta(units: MapUnit[], calls: ActiveCall[]): Record<string, EnRouteEta> {
  const [etas, setEtas] = useState<Record<string, EnRouteEta>>({});
  const unitsRef = useRef(units);
  const callsRef = useRef(calls);
  unitsRef.current = units;
  callsRef.current = calls;

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const currentUnits = unitsRef.current;
      const currentCalls = callsRef.current;
      const pairs = currentUnits
        .filter((u) => u.status === 'enroute' && u.call_number && u.latitude != null && u.longitude != null)
        .map((u) => ({ unit: u, call: currentCalls.find((c) => c.call_number === u.call_number) }))
        .filter((p): p is { unit: MapUnit; call: ActiveCall } =>
          p.call != null && p.call.latitude != null && p.call.longitude != null);

      if (pairs.length === 0) {
        if (!cancelled) setEtas({});
        return;
      }

      const results = await Promise.all(pairs.map(async ({ unit, call }) => {
        // Isolate one unit's failing fetch from the rest of the batch — a
        // rejection here must not blank the ETA for every other en-route
        // unit on the same tick (see useEnRouteEta.test.ts).
        let route;
        try {
          route = await fetchMapboxRoute(
            { lng: unit.longitude as number, lat: unit.latitude as number },
            { lng: call.longitude as number, lat: call.latitude as number },
          );
        } catch (err) {
          console.warn('[useEnRouteEta] route fetch failed', err);
          return null;
        }
        if (!route) return null;
        return {
          callNumber: call.call_number,
          eta: { etaSeconds: route.durationSec, distanceMiles: route.distanceMeters / METERS_PER_MILE },
        };
      }));

      if (cancelled) return;
      const next: Record<string, EnRouteEta> = {};
      for (const r of results) {
        if (r) next[r.callNumber] = r.eta;
      }
      setEtas(next);
    };

    tick();
    const interval = setInterval(tick, REFRESH_MS);
    return () => { cancelled = true; clearInterval(interval); };
    // Re-running this effect only on mount + interval (not on every `units`/
    // `calls` change) is intentional: those arrays get a new reference on
    // every poll, and refetching Directions on every poll tick is exactly
    // the abuse pattern this hook exists to avoid. unitsRef/callsRef give
    // the interval's closure access to current data without that dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return etas;
}
