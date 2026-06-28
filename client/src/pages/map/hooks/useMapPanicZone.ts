import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { useWebSocket } from '../../../context/WebSocketContext';
import { whenStyleReady } from '../utils/safeAddSource';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from '../../../utils/mapboxSafeLayer';

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
        safeRemoveLayer(map, `${id}-circle`);
        safeRemoveSource(map, id);
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

    if (hasLayer(mapInstance, `${innerSourceId}-circle`)) {
      mapInstance.setPaintProperty(`${innerSourceId}-circle`, 'circle-color', colors.innerFill);
      mapInstance.setPaintProperty(`${innerSourceId}-circle`, 'circle-opacity', colors.innerFillOpacity);
      mapInstance.setPaintProperty(`${innerSourceId}-circle`, 'circle-stroke-color', colors.innerStroke);
    }
    if (hasLayer(mapInstance, `${outerSourceId}-circle`)) {
      mapInstance.setPaintProperty(`${outerSourceId}-circle`, 'circle-color', colors.outerFill);
      mapInstance.setPaintProperty(`${outerSourceId}-circle`, 'circle-opacity', colors.outerFillOpacity);
      mapInstance.setPaintProperty(`${outerSourceId}-circle`, 'circle-stroke-color', colors.outerStroke);
    }

    if (status !== 'active' && pulseTimerRef.current) {
      clearInterval(pulseTimerRef.current);
      pulseTimerRef.current = null;
      if (hasLayer(mapInstance, `${innerSourceId}-circle`)) {
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
        if (hasLayer(mapInstance, `${innerSourceId}-circle`)) {
          mapInstance.setPaintProperty(`${innerSourceId}-circle`, 'circle-stroke-opacity', opacity);
          mapInstance.setPaintProperty(`${innerSourceId}-circle`, 'circle-opacity', opacity * 0.12);
        }
        if (hasLayer(mapInstance, `${outerSourceId}-circle`)) {
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

    whenStyleReady(map, () => {
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

      if (status === 'active') {
        let pulseHigh = true;
        pulseTimerRef.current = setInterval(() => {
          pulseHigh = !pulseHigh;
          if (hasLayer(map, `${innerSourceId}-circle`)) {
            map.setPaintProperty(`${innerSourceId}-circle`, 'circle-stroke-opacity', pulseHigh ? 1.0 : 0.3);
          }
        }, 500);
      }
    });

    map.flyTo({ center, zoom: 15 });
  }, [map, clearOverlays]);

  useEffect(() => {
    if (!enabled) {
      clearOverlays();
      return;
    }

    // The worker emits the ENTIRE panic lifecycle as ONE message type,
    // 'panic_alert', discriminated by msg.action (panic_activated /
    // panic_acknowledged / panic_resolved / panic_cancelled / panic_false_alarm)
    // — the same contract PanicButton consumes. The old code subscribed to
    // discrete 'panic_acknowledged'/'panic_resolved'/'panic_cancelled'/
    // 'panic_false_alarm' TYPES the worker NEVER emits, so the map panic zone was
    // drawn on activation but NEVER cleared/updated when the panic was
    // resolved/cancelled (a stuck officer-safety overlay). It also read
    // message.data/payload + data.latitude, but the frame is flat with the row
    // under .panic — so the zone could fail to draw at all. Fix: one 'panic_alert'
    // subscription that reads the row like PanicButton and branches on action.
    const unsub = subscribe('panic_alert', (msg: any) => {
      const env = (msg.data || msg.payload || msg) as any;
      const panic = env.panic || env;                       // the panic_alerts row
      const action: string = msg.action || env.action || 'panic_activated';

      if (action === 'panic_cancelled' || action === 'panic_false_alarm') {
        clearOverlays();
        setActivePanic(null);
        return;
      }
      if (action === 'panic_acknowledged') {
        setActivePanic(prev => prev ? { ...prev, status: 'acknowledged' } : prev);
        updateCircleStatus('acknowledged');
        return;
      }
      if (action === 'panic_resolved') {
        setActivePanic(prev => prev ? { ...prev, status: 'resolved' } : prev);
        updateCircleStatus('resolved');
        return;
      }

      // panic_activated (or any unrecognized action): draw/refresh the zone.
      const lat = Number(panic.latitude ?? env.latitude);
      const lng = Number(panic.longitude ?? env.longitude);
      if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return;

      const panicData: PanicData = {
        callSign: panic.unit_call_sign || panic.call_sign || panic.badge_number || env.unit_call_sign || 'Unknown',
        lat,
        lng,
        timestamp: panic.triggered_at || panic.created_at || env.triggered_at || new Date().toISOString(),
        userName: panic.user_name ?? env.user_name,
        callNumber: panic.call_number ?? env.call_number,
        locationAddress: panic.location_address ?? env.location_address,
        panicId: panic.id ?? env.panic_id ?? env.id,
        status: 'active',
      };

      setActivePanic(panicData);
      if (map) {
        drawPanicZone(lat, lng, 'active');
      }
    });

    return () => {
      unsub();
    };
  }, [enabled, subscribe, map, drawPanicZone, clearOverlays, updateCircleStatus]);

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current) { clearInterval(pulseTimerRef.current); pulseTimerRef.current = null; }
      if (fadeTimerRef.current) { clearTimeout(fadeTimerRef.current); fadeTimerRef.current = null; }
      if (fadeIntervalRef.current) { clearInterval(fadeIntervalRef.current); fadeIntervalRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return { activePanic, dismiss };
}
