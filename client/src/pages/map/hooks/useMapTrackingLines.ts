import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { UNIT_STATUS_COLORS } from '../utils/mapConstants';
import type { MapUnit as Unit, ActiveCall } from '../utils/mapConstants';

const SOURCE_ID = 'tracking-lines-source';
const LAYER_ID = 'tracking-lines-layer';

interface UseMapTrackingLinesParams {
  mapInstanceRef: React.MutableRefObject<mapboxgl.Map | null>;
  mapLoaded: boolean;
  units: Unit[];
  calls: ActiveCall[];
}

export function useMapTrackingLines({ mapInstanceRef, mapLoaded, units, calls }: UseMapTrackingLinesParams) {
  const [showTrackingLines, setShowTrackingLines] = useState(true);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    // Remove existing source/layer
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

    if (!showTrackingLines) return;

    const features: GeoJSON.Feature[] = [];

    units.forEach((unit) => {
      if (unit.latitude == null || unit.longitude == null) return;
      if (!unit.current_call_id) return;
      if (!['dispatched', 'enroute', 'onscene'].includes(unit.status)) return;
      if (!isFinite(unit.latitude) || !isFinite(unit.longitude)) return;

      const call = calls.find((c) => String(c.id) === String(unit.current_call_id));
      if (!call || call.latitude == null || call.longitude == null) return;
      if (!isFinite(call.latitude) || !isFinite(call.longitude)) return;
      if (unit.latitude === call.latitude && unit.longitude === call.longitude) return;

      const statusColor = UNIT_STATUS_COLORS[unit.status] || '#666666';
      const isDashed = unit.status === 'dispatched';

      features.push({
        type: 'Feature',
        properties: {
          color: statusColor,
          dashed: isDashed,
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [unit.longitude, unit.latitude],
            [call.longitude, call.latitude],
          ],
        },
      });
    });

    if (features.length === 0) return;

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    map.addLayer({
      id: LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      paint: {
        'line-color': ['get', 'color'],
        'line-opacity': 0.6,
        'line-width': 2,
        'line-dasharray': ['case', ['get', 'dashed'], ['literal', [2, 4]], ['literal', []]],
      },
    });

    return () => {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
    // mapInstanceRef excluded — refs are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, calls, showTrackingLines, mapLoaded]);

  return {
    showTrackingLines,
    setShowTrackingLines,
  };
}