import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';
import { getOverlayMarkerClass } from '../utils/mapMarkerBuilders';
import type { OverlayMarker } from '../utils/mapMarkerBuilders';

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

interface UseMapGeofencesOptions {
  onAlert?: (alert: GeofenceAlert) => void;
}

interface UseMapGeofencesReturn {
  geofences: Geofence[];
  loading: boolean;
  drawingMode: boolean;
  setDrawingMode: (v: boolean) => void;
  drawnVertices: { lat: number; lng: number }[];
  clearDrawing: () => void;
  alerts: GeofenceAlert[];
}

let audioCtxCache: AudioContext | null = null;

function playGeofenceBeep(isEnter: boolean): void {
  try {
    const audible = localStorage.getItem('rmpg-audible-alerts');
    if (audible === 'false' || audible === '0') return;

    if (!audioCtxCache) {
      audioCtxCache = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioCtxCache;
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.value = isEnter ? 880 : 440;
    gain.gain.value = 0.15;

    const now = ctx.currentTime;
    osc.start(now);

    if (isEnter) {
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.setValueAtTime(0, now + 0.08);
      gain.gain.setValueAtTime(0.15, now + 0.12);
      gain.gain.setValueAtTime(0, now + 0.2);
      osc.stop(now + 0.22);
    } else {
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.stop(now + 0.27);
    }
  } catch {
    // Audio not available — silent fail
  }
}

function parsePolygonCoords(coordStr: string): { lat: number; lng: number }[] {
  try {
    const parsed = JSON.parse(coordStr);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((p: any) => p.lat != null && p.lng != null)
        .map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
        .filter((p: { lat: number; lng: number }) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    }
  } catch {
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

function computeCentroid(path: { lat: number; lng: number }[]): { lat: number; lng: number } {
  if (path.length === 0) return { lat: 0, lng: 0 };
  const sum = path.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / path.length, lng: sum.lng / path.length };
}

export function useMapGeofences(
  map: mapboxgl.Map | null,
  enabled: boolean,
  options?: UseMapGeofencesOptions,
): UseMapGeofencesReturn {
  const { subscribe } = useWebSocket();

  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawingMode, setDrawingMode] = useState(false);
  const [drawnVertices, setDrawnVertices] = useState<{ lat: number; lng: number }[]>([]);
  const [alerts, setAlerts] = useState<GeofenceAlert[]>([]);

  const drawMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const clickHandlerRef = useRef<((e: mapboxgl.MapMouseEvent) => void) | null>(null);
  const dblClickHandlerRef = useRef<(() => void) | null>(null);
  const sourceId = 'geofences';
  const labelSourceId = 'geofence-labels';
  const drawSourceId = 'geofence-draw';

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
      .catch((err) => {
        if (!cancelled) {
          console.warn('[useMapGeofences] Geofences fetch failed:', err);
          setGeofences([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [enabled]);

  useEffect(() => {
    if (!map) return;

    if (map.getLayer(sourceId)) map.removeLayer(sourceId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    if (map.getLayer(labelSourceId)) map.removeLayer(labelSourceId);
    if (map.getSource(labelSourceId)) map.removeSource(labelSourceId);

    if (!enabled || geofences.length === 0) return;

    const ZONE_TYPE_COLORS: Record<string, string> = {
      restricted: '#dc2626',
      patrol: '#888888',
      safety: '#f59e0b',
      exclusion: '#ef4444',
      monitoring: '#8b5cf6',
      property: '#22c55e',
    };

    const alertCounts = new Map<number, number>();
    alerts.forEach((a) => {
      alertCounts.set(a.geofenceId, (alertCounts.get(a.geofenceId) || 0) + 1);
    });

    const polyFeatures: any[] = [];
    const labelFeatures: any[] = [];

    geofences.forEach((fence) => {
      if (!fence.is_active || !fence.polygon_coords) return;

      const path = parsePolygonCoords(fence.polygon_coords);
      if (path.length < 3) return;

      const color = ZONE_TYPE_COLORS[fence.zone_type?.toLowerCase()] || fence.color || '#888888';
      const coords = path.map(p => [p.lng, p.lat] as [number, number]);
      coords.push(coords[0]);

      polyFeatures.push({
        type: 'Feature' as const,
        geometry: { type: 'Polygon' as const, coordinates: [coords] },
        properties: { id: fence.id, name: fence.name, color, zone_type: fence.zone_type, alert_on_enter: fence.alert_on_enter, alert_on_exit: fence.alert_on_exit, alertCount: alertCounts.get(fence.id) || 0 },
      });

      const centroid = computeCentroid(path);
      labelFeatures.push({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [centroid.lng, centroid.lat] as [number, number] },
        properties: { name: fence.name, alertCount: alertCounts.get(fence.id) || 0 },
      });
    });

    if (polyFeatures.length > 0) {
      map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: polyFeatures } });
      map.addLayer({
        id: sourceId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.1,
          'fill-outline-color': ['get', 'color'],
        },
      });
      map.addLayer({
        id: `${sourceId}-outline`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-opacity': 0.7,
        },
      });

      map.on('click', sourceId, (e) => {
        const feature = e.features?.[0];
        if (!feature || !feature.properties) return;
        const p = feature.properties;
        const color = p.color as string;
        const alertCount = p.alertCount as number;

        const html = `
          <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222">
            <div style="font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}">${p.name}</div>
            <table style="width:100%;font-size:11px;border-collapse:collapse">
              <tr><td style="color:#888888;padding:1px 6px 1px 0">Type</td><td style="color:#e0e0e0">${p.zone_type || 'Unknown'}</td></tr>
              <tr><td style="color:#888888;padding:1px 6px 1px 0">Alerts</td><td style="color:${alertCount > 0 ? '#f59e0b' : '#e0e0e0'}">${alertCount}</td></tr>
              <tr><td style="color:#888888;padding:1px 6px 1px 0">Enter Alerts</td><td style="color:#e0e0e0">${p.alert_on_enter ? 'Yes' : 'No'}</td></tr>
              <tr><td style="color:#888888;padding:1px 6px 1px 0">Exit Alerts</td><td style="color:#e0e0e0">${p.alert_on_exit ? 'Yes' : 'No'}</td></tr>
            </table>
          </div>
        `;
        const popup = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false })
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(map);
      });
    }

    if (labelFeatures.length > 0) {
      map.addSource(labelSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: labelFeatures } });
      map.addLayer({
        id: labelSourceId,
        type: 'symbol',
        source: labelSourceId,
        layout: {
          'text-field': ['concat', ['get', 'name'], ['case', ['>', ['get', 'alertCount'], 0], ['concat', ' (', ['to-string', ['get', 'alertCount']], ')'], '']],
          'text-size': 10,
          'text-font': ['Open Sans Regular'],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 1,
        },
      });
    }

    return () => {
      if (map.getLayer(`${sourceId}-outline`)) map.removeLayer(`${sourceId}-outline`);
      if (map.getLayer(sourceId)) map.removeLayer(sourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      if (map.getLayer(labelSourceId)) map.removeLayer(labelSourceId);
      if (map.getSource(labelSourceId)) map.removeSource(labelSourceId);
    };
  }, [map, enabled, geofences, alerts]);

  useEffect(() => {
    if (!map) return;

    if (clickHandlerRef.current) {
      map.off('click', clickHandlerRef.current);
      clickHandlerRef.current = null;
    }
    if (dblClickHandlerRef.current) {
      map.off('dblclick', dblClickHandlerRef.current);
      dblClickHandlerRef.current = null;
    }

    if (!drawingMode) {
      map.doubleClickZoom.enable();
      return;
    }

    map.doubleClickZoom.disable();

    const vertices: { lat: number; lng: number }[] = [];

    const onClick = (e: mapboxgl.MapMouseEvent) => {
      if (!e.lngLat) return;
      const point = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      vertices.push(point);
      setDrawnVertices([...vertices]);

      const markerEl = document.createElement('div');
      markerEl.style.cssText = 'width:10px;height:10px;background:#d4a017;border:2px solid #050505;border-radius:50%;';
      const marker = new mapboxgl.Marker({ element: markerEl }).setLngLat([point.lng, point.lat]).addTo(map);
      drawMarkersRef.current.push(marker);

      const coords = vertices.map(v => [v.lng, v.lat] as [number, number]);
      const lineData = { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: coords }, properties: {} };
      if (map.getSource(drawSourceId)) {
        (map.getSource(drawSourceId) as mapboxgl.GeoJSONSource).setData(lineData);
      } else {
        map.addSource(drawSourceId, { type: 'geojson', data: lineData });
        map.addLayer({ id: `${drawSourceId}-line`, type: 'line', source: drawSourceId, paint: { 'line-color': '#d4a017', 'line-width': 2, 'line-opacity': 0.9 } });
      }
    };

    const onDblClick = () => {
      setDrawingMode(false);
    };

    map.on('click', onClick);
    map.on('dblclick', onDblClick);

    clickHandlerRef.current = onClick;
    dblClickHandlerRef.current = onDblClick;

    return () => {
      if (clickHandlerRef.current) {
        map.off('click', clickHandlerRef.current);
        clickHandlerRef.current = null;
      }
      if (dblClickHandlerRef.current) {
        map.off('dblclick', dblClickHandlerRef.current);
        dblClickHandlerRef.current = null;
      }
      map.doubleClickZoom.enable();
    };
  }, [map, drawingMode]);

  const clearDrawing = useCallback(() => {
    drawMarkersRef.current.forEach((m) => m.remove());
    drawMarkersRef.current = [];
    if (map) {
      if (map.getLayer(`${drawSourceId}-line`)) map.removeLayer(`${drawSourceId}-line`);
      if (map.getSource(drawSourceId)) map.removeSource(drawSourceId);
    }
    setDrawnVertices([]);
    setDrawingMode(false);
  }, [map]);

  useEffect(() => {
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
        setAlerts((prev) => [alert, ...prev].slice(0, 50));
        playGeofenceBeep(alert.eventType === 'enter');
        options?.onAlert?.(alert);
      }
    });

    return unsub;
  }, [subscribe, options?.onAlert]);

  useEffect(() => {
    return () => {
      drawMarkersRef.current.forEach((m) => m.remove());
      drawMarkersRef.current = [];
      if (clickHandlerRef.current && map) map.off('click', clickHandlerRef.current);
      if (dblClickHandlerRef.current && map) map.off('dblclick', dblClickHandlerRef.current);
    };
  }, [map]);

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
