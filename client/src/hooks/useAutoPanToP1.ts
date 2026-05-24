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
  enabled?: boolean;
  priorities?: string[];
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

  const seenIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!enabled || !map) return;

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
