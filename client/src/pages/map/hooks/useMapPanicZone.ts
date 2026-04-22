// ============================================================
// RMPG Flex — useMapPanicZone Hook
// Draws concentric circles on the map when a panic alert is
// triggered. Circle colors reflect panic status:
//   active      — red pulsing circles
//   acknowledged — amber solid circles (no pulse)
//   resolved    — green fading circles (fade out, then remove)
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
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

// ─── Hook ───────────────────────────────────────────────────

export function useMapPanicZone(
  map: google.maps.Map | null,
  enabled: boolean,
): UseMapPanicZoneReturn {
  const [activePanic, setActivePanic] = useState<PanicData | null>(null);
  const { subscribe } = useWebSocket();

  const innerCircleRef = useRef<google.maps.Circle | null>(null);
  const outerCircleRef = useRef<google.maps.Circle | null>(null);
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
    if (innerCircleRef.current) {
      innerCircleRef.current.setMap(null);
      innerCircleRef.current = null;
    }
    if (outerCircleRef.current) {
      outerCircleRef.current.setMap(null);
      outerCircleRef.current = null;
    }
  }, []);

  // ── Dismiss function ──────────────────────────────────────

  const dismiss = useCallback(() => {
    clearOverlays();
    setActivePanic(null);
  }, [clearOverlays]);

  // ── Update circle colors for a given status ───────────────

  const updateCircleStatus = useCallback((status: PanicStatus) => {
    const colors = STATUS_COLORS[status];

    if (innerCircleRef.current) {
      innerCircleRef.current.setOptions({
        fillColor: colors.innerFill,
        fillOpacity: colors.innerFillOpacity,
        strokeColor: colors.innerStroke,
      });
    }
    if (outerCircleRef.current) {
      outerCircleRef.current.setOptions({
        fillColor: colors.outerFill,
        fillOpacity: colors.outerFillOpacity,
        strokeColor: colors.outerStroke,
      });
    }

    // Stop pulsing for non-active statuses
    if (status !== 'active' && pulseTimerRef.current) {
      clearInterval(pulseTimerRef.current);
      pulseTimerRef.current = null;
      // Reset stroke opacity to solid
      if (innerCircleRef.current) {
        innerCircleRef.current.setOptions({ strokeOpacity: 1.0 });
      }
    }

    // Fade out and remove for resolved status
    if (status === 'resolved') {
      let opacity = 1.0;
      fadeIntervalRef.current = setInterval(() => {
        opacity -= 0.1;
        if (opacity <= 0) {
          clearOverlays();
          setActivePanic(null);
          return;
        }
        if (innerCircleRef.current) {
          innerCircleRef.current.setOptions({
            strokeOpacity: opacity,
            fillOpacity: opacity * 0.12,
          });
        }
        if (outerCircleRef.current) {
          outerCircleRef.current.setOptions({
            strokeOpacity: opacity * 0.6,
            fillOpacity: opacity * 0.06,
          });
        }
      }, 500); // 10 steps * 500ms = 5 seconds total fade

      // Safety net: force remove after 6 seconds
      fadeTimerRef.current = setTimeout(() => {
        clearOverlays();
        setActivePanic(null);
      }, 6000);
    }
  }, [clearOverlays]);

  // ── Draw panic zone circles ───────────────────────────────

  const drawPanicZone = useCallback((lat: number, lng: number, status: PanicStatus = 'active') => {
    if (!map || !window.google?.maps) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    clearOverlays();

    const center = { lat, lng };
    const colors = STATUS_COLORS[status];

    // Inner circle — 200m radius
    innerCircleRef.current = new google.maps.Circle({
      center,
      radius: 200,
      fillColor: colors.innerFill,
      fillOpacity: colors.innerFillOpacity,
      strokeColor: colors.innerStroke,
      strokeWeight: 3,
      strokeOpacity: 1.0,
      map,
      clickable: false,
      zIndex: 50,
    });

    // Outer circle — 400m radius
    outerCircleRef.current = new google.maps.Circle({
      center,
      radius: 400,
      fillColor: colors.outerFill,
      fillOpacity: colors.outerFillOpacity,
      strokeColor: colors.outerStroke,
      strokeWeight: 2,
      strokeOpacity: 0.6,
      map,
      clickable: false,
      zIndex: 49,
    });

    // Auto-zoom to panic location
    map.setCenter(center);
    map.setZoom(15);

    // Pulsing animation only for active status
    if (status === 'active') {
      let pulseHigh = true;
      pulseTimerRef.current = setInterval(() => {
        if (innerCircleRef.current) {
          pulseHigh = !pulseHigh;
          innerCircleRef.current.setOptions({
            strokeOpacity: pulseHigh ? 1.0 : 0.3,
          });
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

    // New panic alert — draw active (red pulsing) circles
    const unsubAlert = subscribe('panic_alert', (message) => {
      const data = (message.data || message.payload) as any;
      if (!data) return;

      const lat = Number(data.latitude);
      const lng = Number(data.longitude);

      // Only draw if we have valid coordinates
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

    // Acknowledged — switch to amber solid circles
    const unsubAck = subscribe('panic_acknowledged', (_message) => {
      setActivePanic(prev => prev ? { ...prev, status: 'acknowledged' } : prev);
      updateCircleStatus('acknowledged');
    });

    // Resolved — switch to green fading circles
    const unsubResolved = subscribe('panic_resolved', (_message) => {
      setActivePanic(prev => prev ? { ...prev, status: 'resolved' } : prev);
      updateCircleStatus('resolved');
    });

    // Cancelled — immediately remove circles
    const unsubCancelled = subscribe('panic_cancelled', (_message) => {
      clearOverlays();
      setActivePanic(null);
    });

    // False alarm — immediately remove circles
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
      if (innerCircleRef.current) {
        innerCircleRef.current.setMap(null);
        innerCircleRef.current = null;
      }
      if (outerCircleRef.current) {
        outerCircleRef.current.setMap(null);
        outerCircleRef.current = null;
      }
    };
  }, []);

  return { activePanic, dismiss };
}
