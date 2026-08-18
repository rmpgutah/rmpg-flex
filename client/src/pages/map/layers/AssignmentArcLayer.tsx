import { useEffect } from 'react';
import type mapboxgl from 'mapbox-gl';
import { useMapContext } from '../MapContext';

// Hex literals are intentional — Mapbox GL cannot resolve CSS variables in paint properties.
// See CLAUDE.md: "Mapbox GL cannot resolve `var(--x)` in a paint property".
const PRIORITY_COLORS: Record<string, string> = {
  '1': '#ef4444', // sev-critical
  '2': '#f97316', // sev-high
  '3': '#f59e0b', // sev-warn
  '4': '#22c55e', // sev-low
};
const DEFAULT_ARC_COLOR = '#94a3b8'; // silver/muted

const SOURCE_ID = 'assignment-arcs';
const LAYER_ID = 'assignment-arcs-line';

export default function AssignmentArcLayer() {
  const { map, units, calls } = useMapContext();

  useEffect(() => {
    if (!map) return;

    const features = units
      .filter(u => u.latitude != null && u.longitude != null && u.call_number != null)
      .flatMap(u => {
        const call = calls.find(c => c.call_number === u.call_number);
        if (!call || call.latitude == null || call.longitude == null) return [];
        return [{
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [u.longitude!, u.latitude!],
              [call.longitude!, call.latitude!],
            ],
          },
          properties: { priority: call.priority ?? '4' },
        }];
      });

    const geojson: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };

    if (map.getSource(SOURCE_ID)) {
      (map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource).setData(geojson);
    } else {
      map.addSource(SOURCE_ID, { type: 'geojson', data: geojson });
    }

    if (!map.getLayer(LAYER_ID)) {
      map.addLayer({
        id: LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': [
            'match', ['get', 'priority'],
            '1', PRIORITY_COLORS['1'],
            '2', PRIORITY_COLORS['2'],
            '3', PRIORITY_COLORS['3'],
            DEFAULT_ARC_COLOR,
          ],
          'line-width': 1.5,
          'line-opacity': 0.7,
          'line-dasharray': [2, 3],
        },
      });
    }

    return () => {
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch { /* map may already be destroyed */ }
    };
  }, [map, units, calls]);

  return null;
}
