// ============================================================
// useNavWaypoints — ordered intermediate-stop stack for multi-stop routing
//
// Manages a plain ordered list of stops the officer wants to hit between
// their current position and the final destination (e.g. drop a subpoena,
// then a welfare check, then back to the precinct). Pure state — it knows
// nothing about Mapbox; it just exposes the data + a coords array ready to
// feed a routing `show(waypoints)` method.
// ============================================================

import { useCallback, useMemo, useState } from 'react';

export interface NavWaypoint {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

export interface UseNavWaypointsResult {
  waypoints: NavWaypoint[];
  /** Append a stop. Returns the generated id. */
  addWaypoint: (wp: Omit<NavWaypoint, 'id'> & { id?: string }) => string;
  removeWaypoint: (id: string) => void;
  /** Move the stop at index `from` to index `to`, shifting the rest. */
  reorder: (from: number, to: number) => void;
  clearWaypoints: () => void;
  /** [lng,lat] pairs in order — ready to spread into a routing call. */
  coords: Array<[number, number]>;
}

let seq = 0;
function genId(): string {
  seq += 1;
  return `wp_${Date.now().toString(36)}_${seq}`;
}

export function useNavWaypoints(initial: NavWaypoint[] = []): UseNavWaypointsResult {
  const [waypoints, setWaypoints] = useState<NavWaypoint[]>(initial);

  const addWaypoint = useCallback((wp: Omit<NavWaypoint, 'id'> & { id?: string }): string => {
    const id = wp.id ?? genId();
    setWaypoints((prev) => [...prev, { id, label: wp.label, lat: wp.lat, lng: wp.lng }]);
    return id;
  }, []);

  const removeWaypoint = useCallback((id: string) => {
    setWaypoints((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const reorder = useCallback((from: number, to: number) => {
    setWaypoints((prev) => {
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= prev.length ||
        to >= prev.length
      ) {
        return prev;
      }
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const clearWaypoints = useCallback(() => setWaypoints([]), []);

  const coords = useMemo<Array<[number, number]>>(
    () => waypoints.map((w) => [w.lng, w.lat]),
    [waypoints],
  );

  return { waypoints, addWaypoint, removeWaypoint, reorder, clearWaypoints, coords };
}

export default useNavWaypoints;
