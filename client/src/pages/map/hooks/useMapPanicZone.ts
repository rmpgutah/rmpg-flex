import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { useWebSocket } from '../../../context/WebSocketContext';

type PanicStatus = 'active' | 'acknowledged' | 'resolved';

interface PanicData {
  callSign: string;
  lat: number;
  lng: number;
  timestamp: string;
  userName?: string;
  callNumber?: string;
  locationAddress?: string;
  panicId?: number;
  status: PanicStatus;
}

interface UseMapPanicZoneReturn {
  activePanic: PanicData | null;
  dismiss: () => void;
}

const STATUS_COLORS: Record<PanicStatus, {
  innerFill: string; innerStroke: string; innerFillOpacity: number;
  outerFill: string; outerStroke: string; outerFillOpacity: number;
}> = {
  active: {
    innerFill: '#dc2626', innerStroke: '#dc2626', innerFillOpacity: 0.15,
    outerFill: '#f59e0b', outerStroke: '#f59e0b', outerFillOpacity: 0.08,
  },
  acknowledged: {
    innerFill: '#f59e0b', innerStroke: '#f59e0b', innerFillOpacity: 0.12,
    outerFill: '#d97706', outerStroke: '#d97706', outerFillOpacity: 0.06,
  },
  resolved: {
    innerFill: '#22c55e', innerStroke: '#22c55e', innerFillOpacity: 0.12,
    outerFill: '#16a34a', outerStroke: '#16a34a', outerFillOpacity: 0.06,
  },
};

export function useMapPanicZone(
  map: mapboxgl.Map | null,
  enabled: boolean,
): UseMapPanicZoneReturn {
  const [activePanic, setActivePanic] = useState<PanicData | null>(null);
  const { subscribe } = useWebSocket();

  const pulseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const innerSourceId = 'panic-inner';
  const outerSourceId = 'panic-outer';

  const clearOverlays = useCallback(() => {
    if (pulseTimerRef.current) { clearInterval(pulseTimerRef.current); pulseTimerRef.current = null; }
    if (fadeTimerRef.current) { clearTimeout(fadeTimerRef.current); fadeTimerRef.current = null; }
    if (fadeIntervalRef.current) { clearInterval(fadeIntervalRef.current); fadeIntervalRef.current = null; }
    if (map) {
      [innerSourceId, outerSourceId].forEach(id => {
        if (map.getLayer(`${id}-circle`)) map.removeLayer(`${id}-circle`);
        if (map.getSource(id)) map.removeSource(id);
      });
    }
  }, [map]);

  const dismiss = useCallback(() => {
    clearOverlays();
    setActivePanic(null);
  }, [clearOverlays]);

  const updateCircleStatus = useCallback((status: PanicStatus) => {
    const colors = STATUS_COLORS[status];
    const mapInstance = map;
    if (!mapInstance) return;

    if (mapInstance.getLayer(`${innerSourceId}-circle`)) {
      mapInstance.setPaintProperty(`${innerSourceId}-circle`, 'circle-color', colors.innerFill);
      mapInstance.setPaintProperty(`${innerSourceId}-circle`, 'circle-opacity', colors.innerFillOpacity);
      mapInstance.setPaintProperty(`${innerSourceId}-circle`, 'circle-stroke-color', colors.innerStroke);
    }
    if (mapInstance.getLayer(`${outerSourceId}-circle`)) {
      mapInstance.setPaintProperty(`${outerSourceId}-circle`, 'circle-color', colors.outerFill);
      mapInstance.setPaintProperty(`${outerSourceId}-circle`, 'circle-opacity', colors.outerFillOpacity);
      mapInstance.setPaintProperty(`${outerSourceId}-circle`, 'circle-stroke-color', colors.outerStroke);
    }

    if (status !== 'active' && pulseTimerRef.current) {
      clearInterval(pulseTimerRef.current);
      pulseTimerRef.current = null;
      if (mapInstance.getLayer(`${innerSourceId}-circle`)) {
        mapInstance.setPaintProperty(`${innerSourceId}-circle`, 'circle-stroke-opacity', 1.0);
      }
    }

    if (status === 'resolved') {
      let opacity = 1.0;
      fadeIntervalRef.current = setInterval(() => {
        opacity -= 0.1;
        if (opacity <= 0) {
          clearOverlays();
          setActivePanic(null);
          return;
        }
        if (mapInstance.getLayer(`${innerSourceId}-circle`)) {
          mapInstance.setPaintProperty(`${innerSourceId}-circle`, 'circle-stroke-opacity', opacity);
          mapInstance.setPaintProperty(`${innerSourceId}-circle`, 'circle-opacity', opacity * 0.12);
        }
        if (mapInstance.getLayer(`${outerSourceId}-circle`)) {
          mapInstance.setPaintProperty(`${outerSourceId}-circle`, 'circle-stroke-opacity', opacity * 0.6);
          mapInstance.setPaintProperty(`${outerSourceId}-circle`, 'circle-opacity', opacity * 0.06);
        }
      }, 500);

      fadeTimerRef.current = setTimeout(() => {
        clearOverlays();
        setActivePanic(null);
      }, 6000);
    }
  }, [map, clearOverlays]);

  const drawPanicZone = useCallback((lat: number, lng: number, status: PanicStatus = 'active') => {
    if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

    clearOverlays();

    const center: [number, number] = [lng, lat];
    const colors = STATUS_COLORS[status];

    const innerData = { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: center }, properties: {} };
    const outerData = { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: center }, properties: {} };

    map.addSource(innerSourceId, { type: 'geojson', data: innerData });
    map.addLayer({
      id: `${innerSourceId}-circle`,
      type: 'circle',
      source: innerSourceId,
      paint: {
        'circle-color': colors.innerFill,
        'circle-radius': 200,
        'circle-opacity': colors.innerFillOpacity,
        'circle-stroke-color': colors.innerStroke,
        'circle-stroke-width': 3,
        'circle-stroke-opacity': 1.0,
      },
    });

    map.addSource(outerSourceId, { type: 'geojson', data: outerData });
    map.addLayer({
      id: `${outerSourceId}-circle`,
      type: 'circle',
      source: outerSourceId,
      paint: {
        'circle-color': colors.outerFill,
        'circle-radius': 400,
        'circle-opacity': colors.outerFillOpacity,
        'circle-stroke-color': colors.outerStroke,
        'circle-stroke-width': 2,
        'circle-stroke-opacity': 0.6,
      },
    });

    map.flyTo({ center, zoom: 15 });

    if (status === 'active') {
      let pulseHigh = true;
      pulseTimerRef.current = setInterval(() => {
        pulseHigh = !pulseHigh;
        if (map.getLayer(`${innerSourceId}-circle`)) {
          map.setPaintProperty(`${innerSourceId}-circle`, 'circle-stroke-opacity', pulseHigh ? 1.0 : 0.3);
        }
      }, 500);
    }
  }, [map, clearOverlays]);

  useEffect(() => {
    if (!enabled) {
      clearOverlays();
      return;
    }

    const unsubAlert = subscribe('panic_alert', (message) => {
      const data = (message.data || message.payload) as any;
      if (!data) return;

      const lat = Number(data.latitude);
      const lng = Number(data.longitude);
      if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return;

      const panicData: PanicData = {
        callSign: data.unit_call_sign || data.badge_number || 'Unknown',
        lat,
        lng,
        timestamp: data.triggered_at || new Date().toISOString(),
        userName: data.user_name,
        callNumber: data.call_number,
        locationAddress: data.location_address,
        panicId: data.panic_id,
        status: 'active',
      };

      setActivePanic(panicData);
      if (map) {
        drawPanicZone(lat, lng, 'active');
      }
    });

    const unsubAck = subscribe('panic_acknowledged', () => {
      setActivePanic(prev => prev ? { ...prev, status: 'acknowledged' } : prev);
      updateCircleStatus('acknowledged');
    });

    const unsubResolved = subscribe('panic_resolved', () => {
      setActivePanic(prev => prev ? { ...prev, status: 'resolved' } : prev);
      updateCircleStatus('resolved');
    });

    const unsubCancelled = subscribe('panic_cancelled', () => {
      clearOverlays();
      setActivePanic(null);
    });

    const unsubFalse = subscribe('panic_false_alarm', () => {
      clearOverlays();
      setActivePanic(null);
    });

    return () => {
      unsubAlert();
      unsubAck();
      unsubResolved();
      unsubCancelled();
      unsubFalse();
    };
  }, [enabled, subscribe, map, drawPanicZone, clearOverlays, updateCircleStatus]);

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current) { clearInterval(pulseTimerRef.current); pulseTimerRef.current = null; }
      if (fadeTimerRef.current) { clearTimeout(fadeTimerRef.current); fadeTimerRef.current = null; }
      if (fadeIntervalRef.current) { clearInterval(fadeIntervalRef.current); fadeIntervalRef.current = null; }
    };
  }, []);

  return { activePanic, dismiss };
}
