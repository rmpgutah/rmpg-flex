/**
 * useMapDirectionsPanel — Google Directions Service equivalent for Mapbox GL.
 *
 * Provides turn-by-turn directions with rendered route line and step-by-step
 * instruction panel. Uses the Mapbox Directions API via mapboxApiService.
 * Replaces Google Directions Service + DirectionsRenderer.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { mapboxDirections, type MapboxDirectionsResponse } from '../services/mapboxApiService';

// ── Types ─────────────────────────────────────────────────

export interface DirectionStep {
  instruction: string;
  type: string;
  distance: string;
  duration: string;
  streetName: string;
}

export interface DirectionsResult {
  steps: DirectionStep[];
  totalDistance: string;
  totalDuration: string;
  geometry: [number, number][];
}

type TravelProfile = 'driving' | 'walking' | 'cycling';

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

// ── Hook ──────────────────────────────────────────────────

export function useMapDirectionsPanel(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
) {
  const [origin, setOrigin] = useState<[number, number] | null>(null);
  const [destination, setDestination] = useState<[number, number] | null>(null);
  const [profile, setProfile] = useState<TravelProfile>('driving');
  const [result, setResult] = useState<DirectionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickMode, setPickMode] = useState<'origin' | 'destination' | null>(null);
  const originMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const destMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const SOURCE_ID = 'directions-route';
  const LAYER_ID = 'directions-route-line';

  // Click handler for picking origin/destination
  useEffect(() => {
    if (!map || !mapLoaded || !pickMode) return;

    const handler = (e: mapboxgl.MapMouseEvent) => {
      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      if (pickMode === 'origin') {
        setOrigin(lngLat);
        // Add/move origin marker
        if (originMarkerRef.current) {
          originMarkerRef.current.setLngLat(lngLat);
        } else {
          const el = document.createElement('div');
          el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#22c55e;border:3px solid #fff;box-shadow:0 0 8px #22c55e80;';
          originMarkerRef.current = new mapboxgl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
        }
      } else {
        setDestination(lngLat);
        if (destMarkerRef.current) {
          destMarkerRef.current.setLngLat(lngLat);
        } else {
          const el = document.createElement('div');
          el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#ef4444;border:3px solid #fff;box-shadow:0 0 8px #ef444480;';
          destMarkerRef.current = new mapboxgl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
        }
      }
      setPickMode(null);
      map.getCanvas().style.cursor = '';
    };

    map.getCanvas().style.cursor = 'crosshair';
    map.once('click', handler);

    return () => {
      map.off('click', handler);
      map.getCanvas().style.cursor = '';
    };
  }, [map, mapLoaded, pickMode]);

  const calculateRoute = useCallback(async () => {
    if (!map || !mapLoaded || !origin || !destination) return;

    setLoading(true);
    try {
      const data = await mapboxDirections([origin, destination], {
        profile,
        steps: true,
        alternatives: false,
      });

      if (!data.routes?.length) {
        setResult(null);
        return;
      }

      const route = data.routes[0];
      const steps: DirectionStep[] = [];

      for (const leg of route.legs) {
        for (const step of leg.steps) {
          steps.push({
            instruction: step.maneuver.instruction,
            type: step.maneuver.type,
            distance: formatDistance(step.distance),
            duration: formatDuration(step.duration),
            streetName: step.name,
          });
        }
      }

      const dirResult: DirectionsResult = {
        steps,
        totalDistance: formatDistance(route.distance),
        totalDuration: formatDuration(route.duration),
        geometry: route.geometry.coordinates,
      };

      setResult(dirResult);

      // Render route line on map
      const geojson: GeoJSON.Feature = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: route.geometry.coordinates },
      };

      if (map.getSource(SOURCE_ID)) {
        (map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource).setData(geojson);
      } else {
        map.addSource(SOURCE_ID, { type: 'geojson', data: geojson });
        map.addLayer({
          id: LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          paint: {
            'line-color': '#d4a017',
            'line-width': 4,
            'line-opacity': 0.85,
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      }

      // Fit to route
      const bounds = new mapboxgl.LngLatBounds();
      route.geometry.coordinates.forEach(c => bounds.extend(c as [number, number]));
      map.fitBounds(bounds, { padding: 80 });
    } catch (err) {
      console.warn('[DirectionsPanel] route failed:', err);
    } finally {
      setLoading(false);
    }
  }, [map, mapLoaded, origin, destination, profile]);

  const clearDirections = useCallback(() => {
    if (map) {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    }
    originMarkerRef.current?.remove();
    originMarkerRef.current = null;
    destMarkerRef.current?.remove();
    destMarkerRef.current = null;
    setOrigin(null);
    setDestination(null);
    setResult(null);
    setPickMode(null);
  }, [map]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      originMarkerRef.current?.remove();
      destMarkerRef.current?.remove();
    };
  }, []);

  return {
    origin,
    destination,
    profile,
    result,
    loading,
    pickMode,
    setOrigin,
    setDestination,
    setProfile,
    setPickMode,
    calculateRoute,
    clearDirections,
  };
}
