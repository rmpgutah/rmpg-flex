// GPS Breadcrumb Road Snapping — Map Matching API
import { useRef, useCallback, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { matchToRoad } from '../utils/mapboxServices';

const SOURCE_ID = 'rmpg-matched-source';
const RAW_SOURCE_ID = 'rmpg-matched-raw-source';
const MATCHED_LAYER_ID = 'rmpg-matched-layer';
const RAW_LAYER_ID = 'rmpg-matched-raw-layer';

interface MatchResult {
  geometry: GeoJSON.LineString;
  confidence: number;
  distance: number;
  duration: number;
}

export function useMapboxMapMatching(map: mapboxgl.Map | null) {
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const visibleRef = useRef(false);

  const clearFromMap = useCallback(() => {
    if (!map) return;
    visibleRef.current = false;
    try {
      if (map.getLayer(MATCHED_LAYER_ID)) map.removeLayer(MATCHED_LAYER_ID);
      if (map.getLayer(RAW_LAYER_ID)) map.removeLayer(RAW_LAYER_ID);
      if (map.getSource(MATCHED_LAYER_ID)) map.removeSource(SOURCE_ID);
      if (map.getSource(RAW_LAYER_ID)) map.removeSource(RAW_SOURCE_ID);
    } catch { /* ignore */ }
  }, [map]);

  const renderOnMap = useCallback((
    rawCoords: [number, number][],
    matched: GeoJSON.LineString,
    m: mapboxgl.Map,
  ) => {
    clearFromMap();
    visibleRef.current = true;

    // Raw GPS track (dim, dashed)
    m.addSource(RAW_SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: rawCoords },
      },
    });
    m.addLayer({
      id: RAW_LAYER_ID,
      type: 'line',
      source: RAW_SOURCE_ID,
      paint: {
        'line-color': '#888888',
        'line-width': 1.5,
        'line-opacity': 0.35,
        'line-dasharray': [2, 3],
      },
    });

    // Matched road-snapped track (solid, gold)
    m.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: matched },
    });
    m.addLayer({
      id: MATCHED_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      paint: {
        'line-color': '#d4a017',
        'line-width': 2.5,
        'line-opacity': 0.75,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }, [clearFromMap]);

  const matchTrack = useCallback(async (
    coordinates: [number, number][],
    profile: 'driving' | 'walking' | 'cycling' = 'driving',
  ) => {
    if (!map || coordinates.length < 2) return;
    setLoading(true);
    try {
      const result = await matchToRoad(coordinates, profile);
      const bestMatch = result.matchings?.[0];
      if (bestMatch && map.loaded()) {
        const r: MatchResult = {
          geometry: bestMatch.geometry,
          confidence: bestMatch.confidence,
          distance: bestMatch.distance,
          duration: bestMatch.duration,
        };
        renderOnMap(coordinates, bestMatch.geometry, map);
        setMatchResult(r);
      }
    } catch (err) {
      console.warn('[useMapboxMapMatching] match failed:', err);
    } finally {
      setLoading(false);
    }
  }, [map, renderOnMap]);

  return { matchResult, loading, matchTrack, clear: clearFromMap };
}
