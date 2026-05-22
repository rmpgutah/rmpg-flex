import { useRef, useState, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';

const TRAFFIC_SOURCE = 'rmpg-traffic';
const TRAFFIC_LAYER = 'rmpg-traffic-layer';

export function useMapTrafficLayer() {
  const [showTraffic, setShowTraffic] = useState(false);
  const layerRef = useRef<{ remove: () => void } | null>(null);

  const toggleTraffic = useCallback((map: mapboxgl.Map | null) => {
    setShowTraffic((prev) => {
      const next = !prev;
      if (next && map) {
        try {
          map.addSource(TRAFFIC_SOURCE, {
            type: 'vector',
            tiles: ['https://mapbox-traffic.ashish.workers.dev/{z}/{x}/{y}.mvt'],
            minzoom: 6,
            maxzoom: 18,
          });
          map.addLayer({
            id: TRAFFIC_LAYER,
            type: 'line',
            source: TRAFFIC_SOURCE,
            'source-layer': 'traffic',
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'congestion'], 'low'], '#22c55e',
                ['==', ['get', 'congestion'], 'moderate'], '#eab308',
                ['==', ['get', 'congestion'], 'heavy'], '#f97316',
                ['==', ['get', 'congestion'], 'severe'], '#ef4444',
                '#888888'
              ],
              'line-opacity': 0.7,
              'line-width': 2,
            },
            layout: { visibility: 'visible' },
          });
        } catch {
          console.warn('[useMapTrafficLayer] Traffic layer unavailable');
        }
      } else if (map) {
        try {
          if (map.getLayer(TRAFFIC_LAYER)) map.removeLayer(TRAFFIC_LAYER);
          if (map.getSource(TRAFFIC_SOURCE)) map.removeSource(TRAFFIC_SOURCE);
        } catch {
          // cleanup errors harmless
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (layerRef.current) {
        layerRef.current.remove();
        layerRef.current = null;
      }
    };
  }, []);

  return { showTraffic, toggleTraffic };
}
