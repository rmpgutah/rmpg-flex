import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { UNIT_STATUS_COLORS } from '../utils/mapConstants';
import type { MapUnit as Unit, ActiveCall } from '../utils/mapConstants';

interface UseMapTrackingLinesParams {
  map: mapboxgl.Map | null;
  mapLoaded: boolean;
  units: Unit[];
  calls: ActiveCall[];
}

export function useMapTrackingLines({ map, mapLoaded, units, calls }: UseMapTrackingLinesParams) {
  const [showTrackingLines, setShowTrackingLines] = useState(true);
  const sourceId = 'tracking-lines';
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  useEffect(() => {
    if (!map || !mapLoaded) return;

    if (map.getLayer(sourceId)) map.removeLayer(sourceId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    if (!showTrackingLines) return;

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ maxWidth: '200px', closeButton: true, closeOnClick: false });
    }

    const features: any[] = [];

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
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: [[unit.longitude, unit.latitude], [call.longitude, call.latitude]] as [number, number][],
        },
        properties: {
          call_sign: unit.call_sign,
          status: unit.status,
          color: statusColor,
          isDashed,
          call_number: call.call_number,
        },
      });
    });

    if (features.length === 0) return;

    map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({
      id: sourceId,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 2,
        'line-opacity': 0.6,
        'line-dasharray': ['case', ['get', 'isDashed'], [2, 2], [1, 0]],
      },
    });

    map.on('click', sourceId, (e) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;
      const p = feature.properties;
      const html = `<div style="font-family:monospace;font-size:11px;color:#e0e0e0;background:#050505;padding:8px 10px;border-radius:4px;border:1px solid #222222"><div style="font-weight:bold;color:${p.color}">${p.call_sign} \u2192 ${p.call_number}</div><div style="font-size:9px;color:#9ca3af;margin-top:2px">${p.status}</div></div>`;
      if (popupRef.current) popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });

    return () => {
      if (map.getLayer(sourceId)) map.removeLayer(sourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [map, units, calls, showTrackingLines, mapLoaded]);

  useEffect(() => {
    return () => {
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    };
  }, []);

  return { showTrackingLines, setShowTrackingLines };
}
