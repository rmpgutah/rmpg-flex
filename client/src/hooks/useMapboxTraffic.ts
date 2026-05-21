// Traffic Overlay — Mapbox traffic tileset overlay
// Adds real-time traffic data as a layer on the Mapbox GL JS map.
// Shows congestion levels (low → moderate → heavy → severe) on roads.
import { useEffect, useCallback, useState, useRef } from 'react';

const TRAFFIC_SOURCE_ID = 'rmpg-traffic-source';
const TRAFFIC_LAYER_ID = 'rmpg-traffic-layer';

export function useMapboxTraffic(map: mapboxgl.Map | null) {
  const [visible, setVisible] = useState(false);
  const addedRef = useRef(false);

  const addTrafficLayer = useCallback(() => {
    if (!map || addedRef.current) return;
    try {
      // Mapbox provides traffic tiles at:
      // mapbox://mapbox.mapbox-traffic-v1 (vector tiles)
      // This is only available with a Mapbox account that includes traffic data.
      map.addSource(TRAFFIC_SOURCE_ID, {
        type: 'vector',
        url: 'mapbox://mapbox.mapbox-traffic-v1',
      });

      map.addLayer({
        id: TRAFFIC_LAYER_ID,
        type: 'line',
        source: TRAFFIC_SOURCE_ID,
        'source-layer': 'traffic',
        paint: {
          'line-color': [
            'match', ['get', 'congestion'],
            'low', '#64d264',
            'moderate', '#d4a017',
            'heavy', '#f07828',
            'severe', '#f03c3c',
            '#888888',
          ],
          'line-width': 2,
          'line-opacity': 0.7,
        },
        layout: { visibility: visible ? 'visible' : 'none' },
      });

      addedRef.current = true;
    } catch (err: any) {
      // Mapbox traffic tileset may require special access or account tier
      console.warn('[useMapboxTraffic] traffic layer unavailable:', err.message);
    }
  }, [map, visible]);

  const toggle = useCallback(() => {
    setVisible((prev) => !prev);
  }, []);

  const show = useCallback(() => setVisible(true), []);
  const hide = useCallback(() => setVisible(false), []);

  // Update layer visibility when state changes
  useEffect(() => {
    if (!map || !addedRef.current) return;
    try {
      if (map.getLayer(TRAFFIC_LAYER_ID)) {
        map.setLayoutProperty(TRAFFIC_LAYER_ID, 'visibility', visible ? 'visible' : 'none');
      }
    } catch { /* layer may not exist yet */ }
  }, [map, visible]);

  return { visible, toggle, show, hide, addTrafficLayer };
}
