// Enhanced Route + ETA Overlay — route line with ETA callout bubbles
// Fetches from /api/mapbox/directions and renders route polyline with
// distance/ETA markers along the path. Essential for unit→call routing.
import { useCallback, useState, useRef } from 'react';
import type mapboxgl from 'mapbox-gl';
import { getDirections } from '../utils/mapboxServices';

const ROUTE_SOURCE_ID = 'rmpg-routes-polyline';
const ROUTE_LAYER_ID = 'rmpg-routes-polyline-layer';
const ARROW_LAYER_ID = 'rmpg-routes-arrow-layer';
const ETA_SOURCE_ID = 'rmpg-routes-eta-source';
const ETA_LAYER_ID = 'rmpg-routes-eta-layer';

export interface RouteInfo {
  distanceMeters: number;
  durationSeconds: number;
  distanceText: string;
  etaText: string;
  geometry: GeoJSON.LineString;
  midpoint: [number, number]; // [lng, lat] for ETA label placement
}

export interface UnitCallPair {
  unitCallSign: string;
  callNumber: string;
  unitLat: number;
  unitLng: number;
  callLat: number;
  callLng: number;
}

export function useMapboxRoutes(map: mapboxgl.Map | null) {
  const [activeRoutes, setActiveRoutes] = useState<RouteInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const clearFromMap = useCallback(() => {
    if (!map) return;
    try {
      [ROUTE_LAYER_ID, ARROW_LAYER_ID, ETA_LAYER_ID].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      [ROUTE_SOURCE_ID, ETA_SOURCE_ID].forEach((id) => {
        if (map.getSource(id)) map.removeSource(id);
      });
    } catch { /* ignore */ }
  }, [map]);

  const renderRoutes = useCallback((routes: RouteInfo[], m: mapboxgl.Map) => {
    clearFromMap();

    // All route polylines in one FeatureCollection
    const lineFeatures: GeoJSON.Feature[] = routes.map((r, i) => ({
      type: 'Feature',
      properties: { routeIndex: i, eta: r.etaText, distance: r.distanceText },
      geometry: r.geometry,
    }));

    // ETA label points at midpoints
    const etaFeatures: GeoJSON.Feature[] = routes.map((r, i) => ({
      type: 'Feature',
      properties: { routeIndex: i, eta: r.etaText, distance: r.distanceText },
      geometry: { type: 'Point', coordinates: r.midpoint },
    }));

    m.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: lineFeatures },
    });

    m.addSource(ETA_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: etaFeatures },
    });

    // Base route line
    m.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#d4a017',
        'line-width': 3,
        'line-opacity': 0.85,
      },
    });

    // Direction arrow overlay (dashed, slightly wider)
    m.addLayer({
      id: ARROW_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#0a0a0a',
        'line-width': 5,
        'line-opacity': 0.5,
        'line-dasharray': [1, 3],
      },
    });

    // ETA bubble labels
    m.addLayer({
      id: ETA_LAYER_ID,
      type: 'symbol',
      source: ETA_SOURCE_ID,
      layout: {
        'text-field': ['concat', ['get', 'eta'], '  ', ['get', 'distance']],
        'text-size': 10,
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
        'text-offset': [0, -1.5],
      },
      paint: {
        'text-color': '#d4a017',
        'text-halo-color': '#0a0a0a',
        'text-halo-width': 2.5,
      },
    });
  }, [clearFromMap]);

  const computeRoute = useCallback(async (pair: UnitCallPair) => {
    if (!map) return null;
    setLoading(true);
    try {
      const data = await getDirections(
        [[pair.unitLng, pair.unitLat], [pair.callLng, pair.callLat]],
        'driving-traffic',
        false,
      );
      const route = data.routes?.[0];
      if (!route) return null;

      const coords = route.geometry.coordinates as [number, number][];
      const midIdx = Math.floor(coords.length / 2);
      const midpoint = coords[midIdx];
      const etaMin = Math.round(route.duration / 60);

      const info: RouteInfo = {
        distanceMeters: Math.round(route.distance),
        durationSeconds: Math.round(route.duration),
        distanceText: `${(route.distance * 0.000621371).toFixed(1)} mi`,
        etaText: etaMin < 1 ? '< 1 min' : `${etaMin} min`,
        geometry: route.geometry,
        midpoint,
      };

      setActiveRoutes((prev) => {
        const updated = [...prev.filter((r) => !isSameRoute(r, pair)), info];
        if (map.loaded()) renderRoutes(updated, map);
        return updated;
      });

      return info;
    } catch (err) {
      console.warn('[useMapboxRoutes] compute failed:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [map, renderRoutes]);

  const computeAllRoutes = useCallback(async (
    pairs: UnitCallPair[],
    highlightBest = true,
  ) => {
    if (!map || pairs.length === 0) return;
    setLoading(true);

    const results = await Promise.allSettled(
      pairs.map((pair) =>
        getDirections(
          [[pair.unitLng, pair.unitLat], [pair.callLng, pair.callLat]],
          'driving-traffic',
          false,
        )
      )
    );

    const routes: RouteInfo[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.routes?.[0]) {
        const route = r.value.routes[0];
        const coords = route.geometry.coordinates as [number, number][];
        const midIdx = Math.floor(coords.length / 2);
        const etaMin = Math.round(route.duration / 60);
        routes.push({
          distanceMeters: Math.round(route.distance),
          durationSeconds: Math.round(route.duration),
          distanceText: `${(route.distance * 0.000621371).toFixed(1)} mi`,
          etaText: etaMin < 1 ? '< 1 min' : `${etaMin} min`,
          geometry: route.geometry,
          midpoint: coords[midIdx],
        });
      }
    });

    if (highlightBest) {
      routes.sort((a, b) => a.durationSeconds - b.durationSeconds);
    }

    setActiveRoutes(routes);
    if (map.loaded()) renderRoutes(routes, map);
    setLoading(false);
  }, [map, renderRoutes]);

  const clear = useCallback(() => {
    clearFromMap();
    setActiveRoutes([]);
  }, [clearFromMap]);

  return { activeRoutes, loading, computeRoute, computeAllRoutes, clear };
}

function isSameRoute(route: RouteInfo, pair: UnitCallPair): boolean {
  // Simple dedup check — if it involves the same unit+call combo, treat as same
  const midLat = route.midpoint[1];
  const midLng = route.midpoint[0];
  const avgLat = (pair.unitLat + pair.callLat) / 2;
  const avgLng = (pair.unitLng + pair.callLng) / 2;
  return Math.abs(midLat - avgLat) < 0.01 && Math.abs(midLng - avgLng) < 0.01;
}
