// ============================================================
// RMPG Flex — useMapPanicZone Hook
// Draws concentric circles on the map when a panic alert is
// triggered. Circle colors reflect panic status:
//   active      — red pulsing circles
//   acknowledged — amber solid circles (no pulse)
//   resolved    — green fading circles (fade out, then remove)
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { useWebSocket } from '../../../context/WebSocketContext';

// ─── Types ──────────────────────────────────────────────────

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

// ─── Circle color config by status ──────────────────────────

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

const INNER_LAYER = 'panic-inner-layer';
const INNER_SOURCE = 'panic-inner-source';
const OUTER_LAYER = 'panic-outer-layer';
const OUTER_SOURCE = 'panic-outer-source';

function circleToPolygon(center: [number, number], radiusM: number, segments = 32): [number, number][] {
  const coords: [number, number][] = [];
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(center[1] * Math.PI / 180);
  const dLat = radiusM / metersPerDegLat;
  const dLng = radiusM / metersPerDegLng;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    coords.push([center[0] + dLng * Math.cos(angle), center[1] + dLat * Math.sin(angle)]);
  }
  return coords;
}

function removePanicLayers(map: mapboxgl.Map | null) {
  if (!map) return;
  try {
    if (map.getLayer(INNER_LAYER)) map.removeLayer(INNER_LAYER);
    if (map.getSource(INNER_SOURCE)) map.removeSource(INNER_SOURCE);
    if (map.getLayer(OUTER_LAYER)) map.removeLayer(OUTER_LAYER);
    if (map.getSource(OUTER_SOURCE)) map.removeSource(OUTER_SOURCE);
  } catch { /* ignore */ }
}

// ─── Hook ───────────────────────────────────────────────────

export function useMapPanicZone(
  map: mapboxgl.Map | null,
  enabled: boolean,
): UseMapPanicZoneReturn {
  const [activePanic, setActivePanic] = useState<PanicData | null>(null);
  const { subscribe } = useWebSocket();

  const pulseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Clear circles and animation ───────────────────────────

  const clearOverlays = useCallback(() => {
    if (pulseTimerRef.current) {
      clearInterval(pulseTimerRef.current);
      pulseTimerRef.current = null;
    }
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    if (fadeIntervalRef.current) {
      clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = null;
    }
    removePanicLayers(map);
  }, [map]);

  // ── Dismiss function ──────────────────────────────────────

  const dismiss = useCallback(() => {
    clearOverlays();
    setActivePanic(null);
  }, [clearOverlays]);

  // ── Update circle colors for a given status ───────────────

  const updateCircleStatus = useCallback((status: PanicStatus) => {
    const colors = STATUS_COLORS[status];
    if (!map) return;

    if (map.getLayer(INNER_LAYER)) {
      map.setPaintProperty(INNER_LAYER, 'fill-color', colors.innerFill);
      map.setPaintProperty(INNER_LAYER, 'fill-opacity', colors.innerFillOpacity);
    }
    if (map.getLayer(OUTER_LAYER)) {
      map.setPaintProperty(OUTER_LAYER, 'fill-color', colors.outerFill);
      map.setPaintProperty(OUTER_LAYER, 'fill-opacity', colors.outerFillOpacity);
    }

    if (status !== 'active' && pulseTimerRef.current) {
      clearInterval(pulseTimerRef.current);
      pulseTimerRef.current = null;
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
        if (map.getLayer(INNER_LAYER)) {
          map.setPaintProperty(INNER_LAYER, 'fill-opacity', opacity * 0.12);
        }
        if (map.getLayer(OUTER_LAYER)) {
          map.setPaintProperty(OUTER_LAYER, 'fill-opacity', opacity * 0.06);
        }
      }, 500);

      fadeTimerRef.current = setTimeout(() => {
        clearOverlays();
        setActivePanic(null);
      }, 6000);
    }
  }, [map, clearOverlays]);

  // ── Draw panic zone circles ───────────────────────────────

  const drawPanicZone = useCallback((lat: number, lng: number, status: PanicStatus = 'active') => {
    if (!map) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    clearOverlays();

    const colors = STATUS_COLORS[status];

    const innerPoly = circleToPolygon([lng, lat], 200);
    map.addSource(INNER_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [innerPoly] } }] },
    });
    map.addLayer({
      id: INNER_LAYER,
      type: 'fill',
      source: INNER_SOURCE,
      paint: {
        'fill-color': colors.innerFill,
        'fill-opacity': colors.innerFillOpacity,
        'fill-outline-color': colors.innerStroke,
      },
    });

    const outerPoly = circleToPolygon([lng, lat], 400);
    map.addSource(OUTER_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [outerPoly] } }] },
    });
    map.addLayer({
      id: OUTER_LAYER,
      type: 'fill',
      source: OUTER_SOURCE,
      paint: {
        'fill-color': colors.outerFill,
        'fill-opacity': colors.outerFillOpacity,
        'fill-outline-color': colors.outerStroke,
      },
    });

    map.setCenter([lng, lat]);
    map.setZoom(15);

    if (status === 'active') {
      let pulseHigh = true;
      pulseTimerRef.current = setInterval(() => {
        pulseHigh = !pulseHigh;
        if (map && map.getLayer(INNER_LAYER)) {
          map.setPaintProperty(INNER_LAYER, 'fill-opacity', pulseHigh ? colors.innerFillOpacity : colors.innerFillOpacity * 0.3);
        }
      }, 500);
    }
  }, [map, clearOverlays]);

  // ── Subscribe to panic WebSocket events ───────────────────

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

    const unsubAck = subscribe('panic_acknowledged', (_message) => {
      setActivePanic(prev => prev ? { ...prev, status: 'acknowledged' } : prev);
      updateCircleStatus('acknowledged');
    });

    const unsubResolved = subscribe('panic_resolved', (_message) => {
      setActivePanic(prev => prev ? { ...prev, status: 'resolved' } : prev);
      updateCircleStatus('resolved');
    });

    const unsubCancelled = subscribe('panic_cancelled', (_message) => {
      clearOverlays();
      setActivePanic(null);
    });

    const unsubFalse = subscribe('panic_false_alarm', (_message) => {
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

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current) {
        clearInterval(pulseTimerRef.current);
        pulseTimerRef.current = null;
      }
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
      }
      removePanicLayers(map);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return { activePanic, dismiss };
}
