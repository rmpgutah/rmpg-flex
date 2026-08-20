// Hook that fetches the most recent completed Optimization V2 job and
// renders its routes as visual layers on the map.
//
// Pattern mirrors useMapboxServeJobs.ts.

import { useCallback, useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';
import {
  renderOptimizationSolution,
  removeOptimizationLayers,
  fitToOptimizationBounds,
  type StopCoordinate,
} from '../utils/mapboxOptimizationLayer';
import type { V2Solution, JobPollResult } from '../utils/mapboxOptimizationV2';
import { getMapboxAccessToken } from '../utils/mapboxRouting';

interface RecentJobRow {
  job_id: string;
  status: string;
  job_type: string;
  solution: string | null; // JSON string
  created_at: string;
}

interface RecentJobsResponse {
  jobs: RecentJobRow[];
}

export interface OptimizationRoutesState {
  /** Whether the overlay is currently visible. */
  visible: boolean;
  loading: boolean;
  error: string | null;
  /** job_id of the most recent complete solution being displayed. */
  activeJobId: string | null;
  /** Toggle visibility on / off. */
  toggle: () => void;
  /** Force a reload from the API. */
  refresh: () => void;
  /** Clear all rendered layers. */
  clear: () => void;
}

/**
 * Build StopCoordinate entries from an already-loaded set of active calls.
 * Location names in Optimization V2 solutions are `"call-{id}"` for dispatch
 * jobs and bare `"{id}"` for serve-run / patrol-beat jobs.
 */
function buildStopCoordsFromCalls(
  solution: V2Solution,
  calls: Array<{ id: string | number; call_number?: string | null; latitude?: number | null; longitude?: number | null }>,
): StopCoordinate[] {
  // Index calls by both their raw id and their numeric equivalent so lookups
  // work regardless of whether the solution uses "call-{id}" or bare "{id}".
  const callByNumId = new Map<number, typeof calls[number]>();
  for (const c of calls) {
    const n = Number(c.id);
    if (Number.isFinite(n)) callByNumId.set(n, c);
  }

  const result: StopCoordinate[] = [];

  for (const route of solution.routes) {
    for (const stop of route.stops) {
      if (stop.type !== 'service') continue;
      // Support "call-{id}" prefix and bare numeric ids.
      const rawId = stop.location.startsWith('call-')
        ? stop.location.slice(5)
        : stop.location;
      const numericId = Number(rawId);
      if (!Number.isFinite(numericId)) continue;

      const call = callByNumId.get(numericId);
      if (!call || call.latitude == null || call.longitude == null) continue;

      result.push({
        locationName: stop.location,
        lng: call.longitude,
        lat: call.latitude,
        label: call.call_number ?? `Call ${numericId}`,
      });
    }
  }

  return result;
}

export function useMapboxOptimizationRoutes(
  map: mapboxgl.Map | null,
  /** Active calls already loaded on the map — used to resolve stop coordinates. */
  activeCalls: Array<{
    id: string | number;
    call_number?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }>,
): OptimizationRoutesState {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const cleanupRef = useRef<(() => void) | null>(null);

  const clear = useCallback(() => {
    if (!map) return;
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    removeOptimizationLayers(map);
    setActiveJobId(null);
  }, [map]);

  const renderSolution = useCallback(
    (solution: V2Solution, jobId: string) => {
      if (!map) return;
      const stopCoords = buildStopCoordsFromCalls(solution, activeCalls);

      const token = getMapboxAccessToken();
      const cleanup = whenStyleReady(map, () => {
        removeOptimizationLayers(map);
        renderOptimizationSolution(map, solution, stopCoords, {
          fetchRouteLine: token.length > 0,
          mapboxToken: token || undefined,
        }).then(() => {
          if (stopCoords.length > 0) {
            fitToOptimizationBounds(map, solution, stopCoords);
          }
        }).catch((err: unknown) => {
          console.warn('[useMapboxOptimizationRoutes] render failed:', err);
        });
      });
      cleanupRef.current = cleanup;
      setActiveJobId(jobId);
    },
    [map, activeCalls],
  );

  const fetchAndRender = useCallback(async () => {
    if (!map) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch recent jobs from the API.
      const data = await apiFetch<RecentJobsResponse>('/mapbox/optimization-v2');
      const jobs = data?.jobs ?? [];

      // Find the most recent completed job with a solution.
      const completed = jobs.find((j) => j.status === 'complete' && j.solution);
      if (!completed || !completed.solution) {
        setError('No completed optimization jobs found. Run an optimization first.');
        return;
      }

      let solution: V2Solution;
      try {
        const parsed = JSON.parse(completed.solution) as JobPollResult;
        if (!parsed.solution) throw new Error('missing solution key');
        solution = parsed.solution;
      } catch {
        // The DB may store the V2Solution directly rather than wrapped in JobPollResult.
        try {
          solution = JSON.parse(completed.solution) as V2Solution;
        } catch {
          setError('Could not parse optimization solution data.');
          return;
        }
      }

      renderSolution(solution, completed.job_id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load optimization routes';
      console.warn('[useMapboxOptimizationRoutes] fetch failed:', err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [map, renderSolution]);

  const toggle = useCallback(() => {
    setVisible((prev) => {
      const next = !prev;
      if (!next) {
        // Turning off — clear layers.
        if (map) removeOptimizationLayers(map);
        setActiveJobId(null);
      }
      return next;
    });
  }, [map]);

  const refresh = useCallback(() => {
    if (visible) fetchAndRender();
  }, [visible, fetchAndRender]);

  // Fetch + render when visibility turns on.
  useEffect(() => {
    if (!map || !visible) {
      if (!visible && map) {
        removeOptimizationLayers(map);
        setActiveJobId(null);
      }
      return;
    }
    fetchAndRender();
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [map, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up when map unmounts.
  useEffect(() => {
    if (!map) return;
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      removeOptimizationLayers(map);
    };
  }, [map]);

  return { visible, loading, error, activeJobId, toggle, refresh, clear };
}
