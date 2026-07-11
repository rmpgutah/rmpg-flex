import { useCallback, useRef } from 'react';
import type mapboxgl from 'mapbox-gl';

export function useMultiUnitRouting(options: { map: mapboxgl.Map | null | undefined }) {
  const routesRef = useRef<Map<string, unknown>>(new Map());

  const clearRoutes = useCallback(() => {
    routesRef.current.clear();
  }, []);

  return {
    routes: routesRef.current,
    clearRoutes,
    addRoute: useCallback((_unitId: string, _coordinates: [number, number][]) => {}, []),
    removeRoute: useCallback((_unitId: string) => {}, []),
  };
}
