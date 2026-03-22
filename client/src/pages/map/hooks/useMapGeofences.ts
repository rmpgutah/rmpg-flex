// ============================================================
// RMPG Flex — useMapGeofences Hook
// Geofence zone display, draw mode, and WebSocket alerts.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';

// ─── Types ──────────────────────────────────────────────────

export interface Geofence {
  id: number;
  name: string;
  zone_type: string;
  polygon_coords: string;
  alert_on_enter: number;
  alert_on_exit: number;
  color: string;
  is_active: number;
}

export interface GeofenceAlert {
  geofenceId: number;
  geofenceName: string;
  unitCallSign: string;
  eventType: 'enter' | 'exit';
  timestamp: string;
}

interface UseMapGeofencesReturn {
  geofences: Geofence[];
  loading: boolean;
  drawingMode: boolean;
  setDrawingMode: (v: boolean) => void;
  drawnVertices: google.maps.LatLngLiteral[];
  clearDrawing: () => void;
  alerts: GeofenceAlert[];
}

// ─── Parse polygon coords ───────────────────────────────────

function parsePolygonCoords(coordStr: string): google.maps.LatLngLiteral[] {
  try {
    const parsed = JSON.parse(coordStr);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((p: any) => p.lat != null && p.lng != null)
        .map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
    }
  } catch {
    // Try comma-separated format: "lat,lng;lat,lng;..."
    try {
      return coordStr.split(';').map((pair) => {
        const [lat, lng] = pair.split(',').map(Number);
        return { lat, lng };
      }).filter((p) => !isNaN(p.lat) && !isNaN(p.lng));
    } catch {
      // Give up
    }
  }
  return [];
}

// ─── Compute centroid ───────────────────────────────────────

function computeCentroid(path: google.maps.LatLngLiteral[]): google.maps.LatLngLiteral {
  if (path.length === 0) return { lat: 0, lng: 0 };
  const sum = path.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / path.length, lng: sum.lng / path.length };
}

// ─── Hook ───────────────────────────────────────────────────

export function useMapGeofences(
  map: google.maps.Map | null,
  enabled: boolean,
): UseMapGeofencesReturn {
  const { subscribe } = useWebSocket();

  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawingMode, setDrawingMode] = useState(false);
  const [drawnVertices, setDrawnVertices] = useState<google.maps.LatLngLiteral[]>([]);
  const [alerts, setAlerts] = useState<GeofenceAlert[]>([]);

  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const labelsRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const drawMarkersRef = useRef<google.maps.Marker[]>([]);
  const drawPolylineRef = useRef<google.maps.Polyline | null>(null);
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const dblClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);

  // ── Fetch geofences ─────────────────────────────────────

  useEffect(() => {
    if (!enabled) {
      setGeofences([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    apiFetch<Geofence[]>('/map/geofences')
      .then((data) => {
        if (!cancelled) {
          setGeofences(data || []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGeofences([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [enabled]);

  // ── Render geofence polygons ────────────────────────────

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    // Clear existing
    polygonsRef.current.forEach((p) => p.setMap(null));
    polygonsRef.current = [];
    labelsRef.current.forEach((l) => { l.map = null; });
    labelsRef.current = [];

    if (!enabled || geofences.length === 0) return;

    geofences.forEach((fence) => {
      if (!fence.is_active || !fence.polygon_coords) return;

      const path = parsePolygonCoords(fence.polygon_coords);
      if (path.length < 3) return;

      const color = fence.color || '#3b82f6';

      const polygon = new google.maps.Polygon({
        paths: path,
        fillColor: color,
        fillOpacity: 0.1,
        strokeColor: color,
        strokeWeight: 2,
        strokeOpacity: 0.7,
        map,
        clickable: false,
        zIndex: 6,
      });

      polygonsRef.current.push(polygon);

      // Add label at centroid using AdvancedMarkerElement
      if (window.google?.maps?.marker?.AdvancedMarkerElement) {
        const centroid = computeCentroid(path);
        const labelEl = document.createElement('div');
        labelEl.style.cssText = 'background:rgba(0,0,0,0.7);color:white;font-size:10px;font-family:monospace;padding:2px 6px;border-radius:2px;white-space:nowrap;pointer-events:none';
        labelEl.textContent = fence.name;

        const labelMarker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: centroid,
          content: labelEl,
          zIndex: 7,
        });

        labelsRef.current.push(labelMarker);
      }
    });

    return () => {
      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current = [];
      labelsRef.current.forEach((l) => { l.map = null; });
      labelsRef.current = [];
    };
  }, [map, enabled, geofences]);

  // ── Drawing mode ────────────────────────────────────────

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    // Clean up previous drawing listeners
    if (clickListenerRef.current) {
      google.maps.event.removeListener(clickListenerRef.current);
      clickListenerRef.current = null;
    }
    if (dblClickListenerRef.current) {
      google.maps.event.removeListener(dblClickListenerRef.current);
      dblClickListenerRef.current = null;
    }

    if (!drawingMode) {
      // Restore double-click zoom
      map.setOptions({ disableDoubleClickZoom: false });
      return;
    }

    // Disable double-click zoom while drawing
    map.setOptions({ disableDoubleClickZoom: true });

    const vertices: google.maps.LatLngLiteral[] = [];

    // Click to add vertex
    clickListenerRef.current = map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;

      const point = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      vertices.push(point);
      setDrawnVertices([...vertices]);

      // Add vertex marker
      const marker = new google.maps.Marker({
        position: point,
        map,
        icon: {
          path: 0, // google.maps.SymbolPath.CIRCLE
          scale: 5,
          fillColor: '#d4a017',
          fillOpacity: 1,
          strokeColor: '#0d1520',
          strokeWeight: 2,
        },
        clickable: false,
        zIndex: 9999,
      });
      drawMarkersRef.current.push(marker);

      // Update polyline
      if (!drawPolylineRef.current) {
        drawPolylineRef.current = new google.maps.Polyline({
          path: vertices,
          strokeColor: '#d4a017',
          strokeWeight: 2,
          strokeOpacity: 0.9,
          map,
          zIndex: 9998,
        });
      } else {
        drawPolylineRef.current.setPath(vertices);
      }
    });

    // Double-click to finish
    dblClickListenerRef.current = map.addListener('dblclick', () => {
      setDrawingMode(false);
    });

    return () => {
      if (clickListenerRef.current) {
        google.maps.event.removeListener(clickListenerRef.current);
        clickListenerRef.current = null;
      }
      if (dblClickListenerRef.current) {
        google.maps.event.removeListener(dblClickListenerRef.current);
        dblClickListenerRef.current = null;
      }
      map.setOptions({ disableDoubleClickZoom: false });
    };
  }, [map, drawingMode]);

  // ── Clear drawing ───────────────────────────────────────

  const clearDrawing = useCallback(() => {
    drawMarkersRef.current.forEach((m) => m.setMap(null));
    drawMarkersRef.current = [];
    if (drawPolylineRef.current) {
      drawPolylineRef.current.setMap(null);
      drawPolylineRef.current = null;
    }
    setDrawnVertices([]);
    setDrawingMode(false);
  }, []);

  // ── WebSocket alerts ────────────────────────────────────

  useEffect(() => {
    // Subscribe to geofence alerts via the data_changed message type
    // (server broadcasts geofence events as data_changed with entity='geofence')
    const unsub = subscribe('data_changed' as any, (msg: any) => {
      const payload = msg.payload || msg.data;
      if (payload && payload.entity === 'geofence' && payload.event) {
        const alert: GeofenceAlert = {
          geofenceId: payload.geofenceId,
          geofenceName: payload.geofenceName || 'Unknown Zone',
          unitCallSign: payload.unitCallSign || 'Unknown',
          eventType: payload.event === 'enter' ? 'enter' : 'exit',
          timestamp: payload.timestamp || new Date().toISOString(),
        };
        setAlerts((prev) => [alert, ...prev].slice(0, 50)); // keep last 50
      }
    });

    return unsub;
  }, [subscribe]);

  // ── Cleanup on unmount ──────────────────────────────────

  useEffect(() => {
    return () => {
      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current = [];
      labelsRef.current.forEach((l) => { l.map = null; });
      labelsRef.current = [];
      drawMarkersRef.current.forEach((m) => m.setMap(null));
      drawMarkersRef.current = [];
      if (drawPolylineRef.current) {
        drawPolylineRef.current.setMap(null);
        drawPolylineRef.current = null;
      }
      if (clickListenerRef.current) {
        google.maps.event.removeListener(clickListenerRef.current);
      }
      if (dblClickListenerRef.current) {
        google.maps.event.removeListener(dblClickListenerRef.current);
      }
    };
  }, []);

  return {
    geofences,
    loading,
    drawingMode,
    setDrawingMode,
    drawnVertices,
    clearDrawing,
    alerts,
  };
}
