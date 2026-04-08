// ============================================================
// RMPG Flex — useMapPanicZone Hook
// Draws concentric red/amber circles on the map when a panic
// alert is triggered, with pulsing animation and auto-zoom.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { useWebSocket } from '../../../context/WebSocketContext';

// ─── Types ──────────────────────────────────────────────────

interface PanicData {
  callSign: string;
  lat: number;
  lng: number;
  timestamp: string;
  userName?: string;
  callNumber?: string;
  locationAddress?: string;
}

interface UseMapPanicZoneReturn {
  activePanic: PanicData | null;
  dismiss: () => void;
}

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

  // ── Clear circles and animation ───────────────────────────

  const clearOverlays = useCallback(() => {
    if (pulseTimerRef.current) {
      clearInterval(pulseTimerRef.current);
      pulseTimerRef.current = null;
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

  // ── Draw panic zone circles ───────────────────────────────

  const drawPanicZone = useCallback((lat: number, lng: number) => {
    if (!map || !window.google?.maps) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    clearOverlays();

    const center = { lat, lng };

    // Inner circle — 200m radius, red
    innerCircleRef.current = new google.maps.Circle({
      center,
      radius: 200,
      fillColor: '#dc2626',
      fillOpacity: 0.15,
      strokeColor: '#dc2626',
      strokeWeight: 3,
      strokeOpacity: 1.0,
      map,
      clickable: false,
      zIndex: 50,
    });

    // Outer circle — 400m radius, amber with dashed appearance
    outerCircleRef.current = new google.maps.Circle({
      center,
      radius: 400,
      fillColor: '#f59e0b',
      fillOpacity: 0.08,
      strokeColor: '#f59e0b',
      strokeWeight: 2,
      strokeOpacity: 0.6,
      map,
      clickable: false,
      zIndex: 49,
    });

    // Auto-zoom to panic location
    map.setCenter(center);
    map.setZoom(15);

    // Pulsing animation: toggle inner circle stroke opacity
    let pulseHigh = true;
    pulseTimerRef.current = setInterval(() => {
      if (innerCircleRef.current) {
        pulseHigh = !pulseHigh;
        innerCircleRef.current.setOptions({
          strokeOpacity: pulseHigh ? 1.0 : 0.3,
        });
      }
    }, 500);
  }, [map, clearOverlays]);

  // ── Subscribe to panic_alert WebSocket events ─────────────

  useEffect(() => {
    if (!enabled) {
      clearOverlays();
      return;
    }

    const unsubscribe = subscribe('panic_alert', (message) => {
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
      };

      setActivePanic(panicData);

      if (map) {
        drawPanicZone(lat, lng);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [enabled, subscribe, map, drawPanicZone, clearOverlays]);

  // ── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current) {
        clearInterval(pulseTimerRef.current);
        pulseTimerRef.current = null;
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
