/**
 * useMapMatchTrace — Mapbox Map Matching playground equivalent.
 *
 * Snap raw GPS coordinate traces to road network geometry.
 * Renders both the raw trace and matched route for comparison.
 * Uses the Mapbox Map Matching API via mapboxApiService.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { mapboxMapMatch } from '../services/mapboxApiService';

// ── Types ─────────────────────────────────────────────────

export interface MapMatchResult {
  confidence: number;
  matchedGeometry: [number, number][];
  rawTrace: [number, number][];
  duration: number;
  distance: number;
}

const RAW_SOURCE = 'map-match-raw';
const RAW_LAYER = 'map-match-raw-line';
const MATCHED_SOURCE = 'map-match-result';
const MATCHED_LAYER = 'map-match-result-line';
const TRACE_SOURCE = 'map-match-trace-pts';
const TRACE_LAYER = 'map-match-trace-dots';

// ── Hook ──────────────────────────────────────────────────

export function useMapMatchTrace(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
) {
  const [result, setResult] = useState<MapMatchResult | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const tracePointsRef = useRef<[number, number][]>([]);

  const startCollecting = useCallback(() => {
    tracePointsRef.current = [];
    setResult(null);
    setCollecting(true);
  }, []);

  // Click handler to add trace points
  useEffect(() => {
    if (!map || !mapLoaded || !collecting) return;

    const handler = (e: mapboxgl.MapMouseEvent) => {
      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      tracePointsRef.current.push(pt);

      // Render raw trace points
      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: tracePointsRef.current.map(c => ({
          type: 'Feature' as const,
          properties: {},
          geometry: { type: 'Point' as const, coordinates: c },
        })),
      };

      if (map.getSource(TRACE_SOURCE)) {
        (map.getSource(TRACE_SOURCE) as mapboxgl.GeoJSONSource).setData(geojson);
      } else {
        map.addSource(TRACE_SOURCE, { type: 'geojson', data: geojson });
        map.addLayer({
          id: TRACE_LAYER,
          type: 'circle',
          source: TRACE_SOURCE,
          paint: { 'circle-radius': 5, 'circle-color': '#ef4444', 'circle-opacity': 0.8 },
        });
      }

      // Also render raw line
      if (tracePointsRef.current.length >= 2) {
        const lineGeojson: GeoJSON.Feature = {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: tracePointsRef.current },
        };
        if (map.getSource(RAW_SOURCE)) {
          (map.getSource(RAW_SOURCE) as mapboxgl.GeoJSONSource).setData(lineGeojson);
        } else {
          map.addSource(RAW_SOURCE, { type: 'geojson', data: lineGeojson });
          map.addLayer({
            id: RAW_LAYER,
            type: 'line',
            source: RAW_SOURCE,
            paint: { 'line-color': '#ef4444', 'line-width': 2, 'line-opacity': 0.5, 'line-dasharray': [4, 4] },
          });
        }
      }
    };

    map.getCanvas().style.cursor = 'crosshair';
    map.on('click', handler);

    return () => {
      map.off('click', handler);
      map.getCanvas().style.cursor = '';
    };
  }, [map, mapLoaded, collecting]);

  const matchTrace = useCallback(async () => {
    if (!map || !mapLoaded || tracePointsRef.current.length < 2) return;

    setLoading(true);
    setCollecting(false);

    try {
      const data = await mapboxMapMatch(tracePointsRef.current, {
        profile: 'driving',
      });

      if (data.matchings?.length > 0) {
        const matching = data.matchings[0];
        const matchedCoords = (matching.geometry as any).coordinates as [number, number][];

        const matchResult: MapMatchResult = {
          confidence: matching.confidence,
          matchedGeometry: matchedCoords,
          rawTrace: [...tracePointsRef.current],
          duration: matching.duration,
          distance: matching.distance,
        };
        setResult(matchResult);

        // Render matched route
        const geojson: GeoJSON.Feature = {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: matchedCoords },
        };

        if (map.getSource(MATCHED_SOURCE)) {
          (map.getSource(MATCHED_SOURCE) as mapboxgl.GeoJSONSource).setData(geojson);
        } else {
          map.addSource(MATCHED_SOURCE, { type: 'geojson', data: geojson });
          map.addLayer({
            id: MATCHED_LAYER,
            type: 'line',
            source: MATCHED_SOURCE,
            paint: { 'line-color': '#22c55e', 'line-width': 4, 'line-opacity': 0.85 },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          });
        }

        // Fit bounds
        const bounds = new mapboxgl.LngLatBounds();
        matchedCoords.forEach(c => bounds.extend(c));
        map.fitBounds(bounds, { padding: 60 });
      }
    } catch (err) {
      console.warn('[MapMatchTrace] matching failed:', err);
    } finally {
      setLoading(false);
    }
  }, [map, mapLoaded]);

  const clear = useCallback(() => {
    if (!map) return;
    tracePointsRef.current = [];
    setResult(null);
    setCollecting(false);

    [TRACE_LAYER, RAW_LAYER, MATCHED_LAYER].forEach(id => {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* safe */ }
    });
    [TRACE_SOURCE, RAW_SOURCE, MATCHED_SOURCE].forEach(id => {
      try { if (map.getSource(id)) map.removeSource(id); } catch { /* safe */ }
    });
  }, [map]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (!map) return;
      [TRACE_LAYER, RAW_LAYER, MATCHED_LAYER].forEach(id => {
        try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* safe */ }
      });
      [TRACE_SOURCE, RAW_SOURCE, MATCHED_SOURCE].forEach(id => {
        try { if (map.getSource(id)) map.removeSource(id); } catch { /* safe */ }
      });
    };
  }, [map]);

  return {
    result,
    collecting,
    loading,
    tracePointCount: tracePointsRef.current.length,
    startCollecting,
    matchTrace,
    clear,
  };
}
