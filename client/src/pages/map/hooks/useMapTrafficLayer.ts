import { useRef, useState, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';

export function useMapTrafficLayer() {
  const [showTraffic, setShowTraffic] = useState(false);
  const layerRef = useRef<{ remove: () => void } | null>(null);

  const toggleTraffic = useCallback((map: mapboxgl.Map | null) => {
    setShowTraffic((prev) => {
      const next = !prev;
      // Mapbox GL JS does not have a built-in traffic layer.
      // Traffic data can be added via custom tile sources or third-party providers.
      // For now, this is a no-op with state tracking.
      if (next && map) {
        // Placeholder: add traffic tile source if available
        if (!map.getSource('traffic')) {
          // To add real traffic, configure a traffic tile source:
          // map.addSource('traffic', { type: 'vector', tiles: ['https://your-traffic-provider/{z}/{x}/{y}.pbf'] });
          // map.addLayer({ id: 'traffic-layer', type: 'line', source: 'traffic', ... });
        }
      } else if (map) {
        if (map.getLayer('traffic-layer')) map.removeLayer('traffic-layer');
        if (map.getSource('traffic')) map.removeSource('traffic');
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
