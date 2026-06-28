/**
 * useMapOptimization — Mapbox Optimization API (Traveling Salesman).
 *
 * Given multiple waypoints (unit locations, call locations), computes
 * the optimal visit order to minimize travel time. Renders the optimized
 * route on the map. Essential for multi-call dispatch routing.
 */

import { useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { mapboxOptimization, type MapboxOptimizationResponse } from '../services/mapboxApiService';

// ── Types ─────────────────────────────────────────────────

export interface OptimizedStop {
  index: number;
  originalIndex: number;
  name: string;
  location: [number, number];
}

export interface OptimizationResult {
  stops: OptimizedStop[];
  totalDistance: string;
  totalDuration: string;
  geometry: [number, number][];
}

function formatDistance(meters: number): string {
  if (meters >= 1609.34) return `${(meters / 1609.34).toFixed(1)} mi`;
  return `${Math.round(meters * 3.281)} ft`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const SOURCE_ID = 'optimization-route';
const LAYER_ID = 'optimization-route-line';
const STOPS_SOURCE = 'optimization-stops';
const STOPS_LAYER = 'optimization-stops-circles';
const STOPS_LABEL_LAYER = 'optimization-stops-labels';

// ── Hook ──────────────────────────────────────────────────

export function useMapOptimization(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
) {
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [loading, setLoading] = useState(false);

  const optimize = useCallback(async (
    waypoints: Array<{ name: string; location: [number, number] }>,
    options?: { roundtrip?: boolean; profile?: string }
  ) => {
    if (!map || !mapLoaded || waypoints.length < 2) return;

    setLoading(true);
    try {
      const coordinates = waypoints.map(w => w.location);
      const data = await mapboxOptimization(coordinates, {
        profile: options?.profile ?? 'driving',
        steps: true,
        roundtrip: options?.roundtrip ?? false,
        source: 'first',
        destination: 'last',
      });

      if (!data.trips?.length) {
        setResult(null);
        return;
      }

      const trip = data.trips[0];
      const stops: OptimizedStop[] = data.waypoints.map((wp, i) => ({
        index: wp.waypoint_index,
        originalIndex: i,
        name: waypoints[i]?.name || wp.name || `Stop ${i + 1}`,
        location: wp.location,
      }));

      // Sort by waypoint_index (optimized order)
      stops.sort((a, b) => a.index - b.index);

      const optResult: OptimizationResult = {
        stops,
        totalDistance: formatDistance(trip.distance),
        totalDuration: formatDuration(trip.duration),
        geometry: trip.geometry.coordinates,
      };
      setResult(optResult);

      // Render route
      const routeGeoJson: GeoJSON.Feature = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: trip.geometry.coordinates },
      };

      if (map.getSource(SOURCE_ID)) {
        (map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource).setData(routeGeoJson);
      } else {
        map.addSource(SOURCE_ID, { type: 'geojson', data: routeGeoJson });
        map.addLayer({
          id: LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          paint: {
            'line-color': '#a855f7',
            'line-width': 4,
            'line-opacity': 0.85,
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      }

      // Render stop markers
      const stopsGeoJson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: stops.map(s => ({
          type: 'Feature' as const,
          properties: { label: String(s.index + 1), name: s.name },
          geometry: { type: 'Point' as const, coordinates: s.location },
        })),
      };

      if (map.getSource(STOPS_SOURCE)) {
        (map.getSource(STOPS_SOURCE) as mapboxgl.GeoJSONSource).setData(stopsGeoJson);
      } else {
        map.addSource(STOPS_SOURCE, { type: 'geojson', data: stopsGeoJson });
        map.addLayer({
          id: STOPS_LAYER,
          type: 'circle',
          source: STOPS_SOURCE,
          paint: { 'circle-radius': 12, 'circle-color': '#a855f7', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
        });
        map.addLayer({
          id: STOPS_LABEL_LAYER,
          type: 'symbol',
          source: STOPS_SOURCE,
          layout: {
            'text-field': ['get', 'label'],
            'text-size': 10,
            'text-allow-overlap': true,
            'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          },
          paint: { 'text-color': '#fff' },
        });
      }

      // Fit bounds
      const bounds = new mapboxgl.LngLatBounds();
      trip.geometry.coordinates.forEach(c => bounds.extend(c as [number, number]));
      map.fitBounds(bounds, { padding: 60 });
    } catch (err) {
      console.warn('[Optimization] failed:', err);
    } finally {
      setLoading(false);
    }
  }, [map, mapLoaded]);

  const clear = useCallback(() => {
    if (!map) return;
    [STOPS_LABEL_LAYER, STOPS_LAYER, LAYER_ID].forEach(id => {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* safe */ }
    });
    [STOPS_SOURCE, SOURCE_ID].forEach(id => {
      try { if (map.getSource(id)) map.removeSource(id); } catch { /* safe */ }
    });
    setResult(null);
  }, [map]);

  return { result, loading, optimize, clear };
}
