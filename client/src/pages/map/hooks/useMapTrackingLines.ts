import { useEffect, useRef, useState } from 'react';
import { UNIT_STATUS_COLORS } from '../utils/mapConstants';
import type { MapUnit as Unit, ActiveCall } from '../utils/mapConstants';

interface UseMapTrackingLinesParams {
  mapInstanceRef: React.MutableRefObject<google.maps.Map | null>;
  mapLoaded: boolean;
  units: Unit[];
  calls: ActiveCall[];
}

export function useMapTrackingLines({ mapInstanceRef, mapLoaded, units, calls }: UseMapTrackingLinesParams) {
  const trackingLinesRef = useRef<google.maps.Polyline[]>([]);
  const [showTrackingLines, setShowTrackingLines] = useState(true);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    // Clear existing lines
    trackingLinesRef.current.forEach((line) => line.setMap(null));
    trackingLinesRef.current = [];

    if (!showTrackingLines) return;

    // Draw lines from each dispatched/enroute/onscene unit to their assigned call
    units.forEach((unit) => {
      if (unit.latitude == null || unit.longitude == null) return;
      if (!unit.current_call_id) return;
      if (!['dispatched', 'enroute', 'onscene'].includes(unit.status)) return;

      const call = calls.find((c) => String(c.id) === String(unit.current_call_id));
      if (!call || call.latitude == null || call.longitude == null) return;

      const statusColor = UNIT_STATUS_COLORS[unit.status] || '#5a6e80';
      const isDashed = unit.status === 'dispatched';

      const line = new google.maps.Polyline({
        path: [
          { lat: unit.latitude, lng: unit.longitude },
          { lat: call.latitude, lng: call.longitude },
        ],
        geodesic: true,
        strokeColor: statusColor,
        strokeOpacity: isDashed ? 0 : 0.6,
        strokeWeight: 2,
        icons: isDashed ? [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.6, strokeWeight: 2, scale: 3 },
          offset: '0',
          repeat: '15px',
        }] : undefined,
        map,
      });

      trackingLinesRef.current.push(line);
    });
  }, [units, calls, showTrackingLines, mapLoaded, mapInstanceRef]);

  return {
    showTrackingLines,
    setShowTrackingLines,
    trackingLinesRef,
  };
}
