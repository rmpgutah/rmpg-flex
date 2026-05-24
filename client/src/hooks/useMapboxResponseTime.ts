// Response Time Overlay — beat polygons color-coded by average response time
// Fetches /api/dispatch/beat-activity and renders dispatch_beats GeoJSON with
// response time color ramp. Essential for evaluating coverage and response gaps.
import { useCallback, useState, useRef, useEffect } from 'react';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';

interface BeatActivity {
  beat: string;
  calls: number;
  incidents: number;
  citations: number;
  arrests: number;
  avg_response_min: number | null;
  incident_types: string | null;
}

const SOURCE_ID = 'rmpg-resptime-source';
const FILL_LAYER_ID = 'rmpg-resptime-fill';
const LINE_LAYER_ID = 'rmpg-resptime-line';

// Response time color ramp (min → max)
// Green (< 5 min) → Yellow (10 min) → Orange (15 min) → Red (20+)
const RESPONSE_COLORS: [number, string][] = [
  [3, '#4caf50'],
  [7, '#8bc34a'],
  [10, '#ffeb3b'],
  [15, '#ff9800'],
  [20, '#f44336'],
  [30, '#b71c1c'],
];

export function useMapboxResponseTime(map: mapboxgl.Map | null) {
  const [beats, setBeats] = useState<BeatActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const visibleRef = useRef(false);

  useEffect(() => {
    return () => {
      if (!map) return;
      try {
        [FILL_LAYER_ID, LINE_LAYER_ID].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch { /* ignore */ }
    };
  }, [map]);

  const clearFromMap = useCallback(() => {
    if (!map) return;
    visibleRef.current = false;
    try { if (map.getLayer(FILL_LAYER_ID)) map.removeLayer(FILL_LAYER_ID); } catch { /* */ }
    try { if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID); } catch { /* */ }
  }, [map]);

  const renderOnMap = useCallback(async (beatData: BeatActivity[], m: mapboxgl.Map) => {
    // Fetch beat GeoJSON
    let beatGeojson: any;
    try {
      const resp = await fetch('/geojson/beat.geojson');
      beatGeojson = await resp.json();
    } catch {
      console.warn('[useMapboxResponseTime] failed to load beat.geojson');
      return;
    }

    clearFromMap();
    visibleRef.current = true;

    // Merge response time data into GeoJSON properties
    const beatMap = new Map<string, BeatActivity>();
    beatData.forEach((b) => beatMap.set(b.beat, b));

    const features = beatGeojson.features.map((f: any) => {
      const code = f.properties?.beat_code || '';
      const data = beatMap.get(code);
      return {
        ...f,
        properties: {
          ...f.properties,
          avg_response: data?.avg_response_min ?? null,
          calls: data?.calls ?? 0,
          incidents: data?.incidents ?? 0,
        },
      };
    });

    m.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    // Fill layer with response time color ramp
    m.addLayer({
      id: FILL_LAYER_ID,
      type: 'fill',
      source: SOURCE_ID,
      paint: {
        'fill-color': ['interpolate', ['linear'], ['to-number', ['get', 'avg_response'], 99],
          ...RESPONSE_COLORS.flatMap(([t, c]) => [t, c]),
        ],
        'fill-opacity': ['case',
          ['has', 'avg_response'], 0.4,
          0.05,
        ],
      },
    });

    // Outline
    m.addLayer({
      id: LINE_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      paint: {
        'line-color': '#555555',
        'line-width': 0.8,
        'line-opacity': 0.4,
      },
    });
  }, [clearFromMap]);

  const fetchResponseTimes = useCallback(async (days = 30) => {
    if (!map) return;
    setLoading(true);
    try {
      const data = await apiFetch<{ period_days: number; beats: BeatActivity[] }>(
        `/dispatch/beat-activity?days=${days}`
      );
      const b = data?.beats || [];
      setBeats(b);
      if (map.loaded()) await renderOnMap(b, map);
    } catch (err) {
      console.warn('[useMapboxResponseTime] fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [map, renderOnMap]);

  return { beats, loading, fetchResponseTimes, clear: clearFromMap };
}
