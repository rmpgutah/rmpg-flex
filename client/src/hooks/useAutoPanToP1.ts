// ============================================================
// RMPG Flex — useAutoPanToP1
// Auto-pans the map to a newly-arrived P1 (priority 1) call so
// dispatchers don't miss high-priority events while looking at
// another part of the map. Only fires on NEW calls — existing
// P1s in the initial load don't trigger a pan.
//
// A single pan per call ID; re-clearing+re-opening the same P1
// won't re-pan (seenIdsRef tracks it for the session). This
// prevents the map from chasing ghost updates.
// ============================================================

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';

interface CallLike {
  id: string | number;
  priority?: string | null;
  status?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface Options {
  /** If false, the hook is a no-op. Lets dispatchers disable auto-pan. */
  enabled?: boolean;
  /** Which priority values should trigger a pan. Default: only P1. */
  priorities?: string[];
  /** Ignore calls whose status is in this list (cleared / closed etc). */
  ignoreStatuses?: string[];
}

const DEFAULT_PRIORITIES = ['P1', '1'];
const DEFAULT_IGNORE_STATUSES = ['CLEARED', 'CLOSED', 'CANCELED', 'CANCELLED'];

export function useAutoPanToP1(
  map: mapboxgl.Map | null,
  calls: CallLike[],
  options: Options = {},
) {
  const enabled = options.enabled ?? true;
  const priorities = options.priorities ?? DEFAULT_PRIORITIES;
  const ignoreStatuses = options.ignoreStatuses ?? DEFAULT_IGNORE_STATUSES;

  // Track seen call IDs across renders. Initialize lazily with the CURRENT
  // calls so existing P1s on page load don't trigger a pan — only truly
  // new dispatches during this session do.
  const seenIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!enabled || !map) return;

    // First render: seed seenIds with everything currently on screen so we
    // only pan for arrivals AFTER this.
    if (seenIdsRef.current == null) {
      seenIdsRef.current = new Set(calls.map((c) => String(c.id)));
      return;
    }

    const seen = seenIdsRef.current;
    for (const call of calls) {
      const id = String(call.id);
      if (seen.has(id)) continue;
      seen.add(id);

      const pri = (call.priority || '').toUpperCase();
      if (!priorities.some((p) => p.toUpperCase() === pri)) continue;

      const status = (call.status || '').toUpperCase();
      if (ignoreStatuses.some((s) => s.toUpperCase() === status)) continue;

      const lat = call.latitude;
      const lng = call.longitude;
      if (lat == null || lng == null) continue;

      try {
        map.panTo([lng, lat]);
      } catch {
        // Map may have been torn down mid-pan — ignore.
      }
    }
  }, [map, calls, enabled, priorities, ignoreStatuses]);
}
