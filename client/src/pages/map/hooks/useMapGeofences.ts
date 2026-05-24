import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';

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

const GEOFENCE_POLY_SOURCE = 'geofence-poly-source';
const GEOFENCE_POLY_LAYER = 'geofence-poly-layer';
const GEOFENCE_LABEL_SOURCE = 'geofence-label-source';
const GEOFENCE_LABEL_LAYER = 'geofence-label-layer';
const DRAW_LINE_SOURCE = 'geofence-draw-line-source';
const DRAW_LINE_LAYER = 'geofence-draw-line-layer';
const DRAW_VERTEX_SOURCE = 'geofence-draw-vertex-source';
const DRAW_VERTEX_LAYER = 'geofence-draw-vertex-layer';

let audioCtxCache: AudioContext | null = null;

function playGeofenceBeep(isEnter: boolean): void {
  try {
    const audible = localStorage.getItem('rmpg-audible-alerts');
    if (audible === 'false' || audible === '0') return;
    if (!audioCtxCache) audioCtxCache = new (window.AudioContext || (window as any).webkitAudioContext)();
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
  } catch { /* ignore */ }
}

function parsePolygonCoords(coordStr: string): { lat: number; lng: number }[] {
  try {
    const parsed = JSON.parse(coordStr);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((p: any) => p.lat != null && p.lng != null)
        .map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    }
  } catch {
    try {
      return coordStr.split(';').map((pair) => {
        const [lat, lng] = pair.split(',').map(Number);
        return { lat, lng };
      }).filter((p) => !isNaN(p.lat) && !isNaN(p.lng));
    } catch { /* give up */ }
  }
  return [];
}

function computeCentroid(path: { lat: number; lng: number }[]): { lat: number; lng: number } {
  if (path.length === 0) return { lat: 0, lng: 0 };
  const sum = path.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / path.length, lng: sum.lng / path.length };
}

function removeSourceAndLayer(map: mapboxgl.Map, layerId: string, sourceId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch { /* ignore */ }
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

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const clickHandlerRef = useRef<((e: mapboxgl.MapMouseEvent) => void) | null>(null);
  const dblClickHandlerRef = useRef<((e: mapboxgl.MapMouseEvent) => void) | null>(null);

  useEffect(() => {
    if (!enabled) { setGeofences([]); return; }
    let cancelled = false;
    setLoading(true);
    apiFetch<Geofence[]>('/map/geofences')
      .then((data) => { if (!cancelled) { setGeofences(data || []); setLoading(false); } })
      .catch((err) => { if (!cancelled) { console.warn('[useMapGeofences] Geofences fetch failed:', err); setGeofences([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [enabled]);

  useEffect(() => {
    if (!map) return;
    removeSourceAndLayer(map, GEOFENCE_POLY_LAYER, GEOFENCE_POLY_SOURCE);
    removeSourceAndLayer(map, GEOFENCE_LABEL_LAYER, GEOFENCE_LABEL_SOURCE);
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
    alerts.forEach((a) => { alertCounts.set(a.geofenceId, (alertCounts.get(a.geofenceId) || 0) + 1); });

    const polyFeatures: GeoJSON.Feature[] = [];
    const labelFeatures: GeoJSON.Feature[] = [];

    geofences.forEach((fence) => {
      if (!fence.is_active || !fence.polygon_coords) return;
      const path = parsePolygonCoords(fence.polygon_coords);
      if (path.length < 3) return;
      const color = ZONE_TYPE_COLORS[fence.zone_type?.toLowerCase()] || fence.color || '#888888';
      const coords = [...path.map(p => [p.lng, p.lat] as [number, number]), [path[0].lng, path[0].lat]];
      polyFeatures.push({
        type: 'Feature',
        properties: { color, fenceId: fence.id, name: fence.name, zoneType: fence.zone_type || '', alertOnEnter: fence.alert_on_enter, alertOnExit: fence.alert_on_exit },
        geometry: { type: 'Polygon', coordinates: [coords] },
      });

      const centroid = computeCentroid(path);
      const alertCount = alertCounts.get(fence.id) || 0;
      labelFeatures.push({
        type: 'Feature',
        properties: { name: fence.name, color, alertCount },
        geometry: { type: 'Point', coordinates: [centroid.lng, centroid.lat] },
      });
    });

    if (polyFeatures.length > 0) {
      map.addSource(GEOFENCE_POLY_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: polyFeatures } });
      map.addLayer({
        id: GEOFENCE_POLY_LAYER,
        type: 'fill',
        source: GEOFENCE_POLY_SOURCE,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.1,
          'fill-outline-color': ['get', 'color'],
        },
      });

      map.on('click', GEOFENCE_POLY_LAYER, (e) => {
        if (!e.features || e.features.length === 0) return;
        const props = e.features[0].properties;
        if (!props) return;
        const point = e.lngLat;
        const alertCount = alertCounts.get(props.fenceId) || 0;
        const html = `
          <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222">
            <div style="font-weight:bold;font-size:13px;margin-bottom:6px;color:${props.color}">${escapeHtml(props.name)}</div>
            <table style="width:100%;font-size:11px;border-collapse:collapse">
              <tr><td style="color:#888888;padding:1px 6px 1px 0">Type</td><td style="color:#e0e0e0">${escapeHtml(props.zoneType || 'Unknown')}</td></tr>
              <tr><td style="color:#888888;padding:1px 6px 1px 0">Alerts</td><td style="color:${alertCount > 0 ? '#f59e0b' : '#e0e0e0'}">${alertCount}</td></tr>
              <tr><td style="color:#888888;padding:1px 6px 1px 0">Enter Alerts</td><td style="color:#e0e0e0">${props.alertOnEnter ? 'Yes' : 'No'}</td></tr>
              <tr><td style="color:#888888;padding:1px 6px 1px 0">Exit Alerts</td><td style="color:#e0e0e0">${props.alertOnExit ? 'Yes' : 'No'}</td></tr>
            </table>
          </div>
        `;
        if (popupRef.current) popupRef.current.remove();
        popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '300px', offset: 15 })
          .setLngLat(point)
          .setHTML(html)
          .addTo(map);
      });
    }

    if (labelFeatures.length > 0) {
      map.addSource(GEOFENCE_LABEL_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: labelFeatures } });
      map.addLayer({
        id: GEOFENCE_LABEL_LAYER,
        type: 'symbol',
        source: GEOFENCE_LABEL_SOURCE,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 10,
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-offset': [0, -1.5],
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 1,
          'text-halo-blur': 1,
        },
      });
    }

    return () => {
      removeSourceAndLayer(map, GEOFENCE_POLY_LAYER, GEOFENCE_POLY_SOURCE);
      removeSourceAndLayer(map, GEOFENCE_LABEL_LAYER, GEOFENCE_LABEL_SOURCE);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, enabled, geofences]);

  // Drawing mode
  useEffect(() => {
    if (!map) return;

    if (clickHandlerRef.current) { map.off('click', clickHandlerRef.current); clickHandlerRef.current = null; }
    if (dblClickHandlerRef.current) { map.off('dblclick', dblClickHandlerRef.current); dblClickHandlerRef.current = null; }
    removeSourceAndLayer(map, DRAW_LINE_LAYER, DRAW_LINE_SOURCE);
    removeSourceAndLayer(map, DRAW_VERTEX_LAYER, DRAW_VERTEX_SOURCE);

    if (!drawingMode) return;

    const vertices: { lat: number; lng: number }[] = [];

    const onClick = (e: mapboxgl.MapMouseEvent) => {
      const point = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      vertices.push(point);
      setDrawnVertices([...vertices]);

      removeSourceAndLayer(map, DRAW_LINE_LAYER, DRAW_LINE_SOURCE);
      removeSourceAndLayer(map, DRAW_VERTEX_LAYER, DRAW_VERTEX_SOURCE);

      const coords = vertices.map(p => [p.lng, p.lat] as [number, number]);
      map.addSource(DRAW_LINE_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] },
      });
      map.addLayer({ id: DRAW_LINE_LAYER, type: 'line', source: DRAW_LINE_SOURCE, paint: { 'line-color': '#d4a017', 'line-width': 2, 'line-opacity': 0.9 } });

      const vertexFeatures = vertices.map(p => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      }));
      map.addSource(DRAW_VERTEX_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: vertexFeatures },
      });
      map.addLayer({ id: DRAW_VERTEX_LAYER, type: 'circle', source: DRAW_VERTEX_SOURCE, paint: { 'circle-color': '#d4a017', 'circle-radius': 5, 'circle-stroke-color': '#050505', 'circle-stroke-width': 2 } });
    };

    const onDblClick = () => setDrawingMode(false);

    clickHandlerRef.current = onClick;
    dblClickHandlerRef.current = onDblClick;
    map.on('click', onClick);
    map.on('dblclick', onDblClick);

    return () => {
      if (clickHandlerRef.current) { map.off('click', clickHandlerRef.current); clickHandlerRef.current = null; }
      if (dblClickHandlerRef.current) { map.off('dblclick', dblClickHandlerRef.current); dblClickHandlerRef.current = null; }
      removeSourceAndLayer(map, DRAW_LINE_LAYER, DRAW_LINE_SOURCE);
      removeSourceAndLayer(map, DRAW_VERTEX_LAYER, DRAW_VERTEX_SOURCE);
    };
  }, [map, drawingMode]);

  const clearDrawing = useCallback(() => {
    if (map) {
      removeSourceAndLayer(map, DRAW_LINE_LAYER, DRAW_LINE_SOURCE);
      removeSourceAndLayer(map, DRAW_VERTEX_LAYER, DRAW_VERTEX_SOURCE);
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
      if (map) {
        removeSourceAndLayer(map, GEOFENCE_POLY_LAYER, GEOFENCE_POLY_SOURCE);
        removeSourceAndLayer(map, GEOFENCE_LABEL_LAYER, GEOFENCE_LABEL_SOURCE);
        removeSourceAndLayer(map, DRAW_LINE_LAYER, DRAW_LINE_SOURCE);
        removeSourceAndLayer(map, DRAW_VERTEX_LAYER, DRAW_VERTEX_SOURCE);
      }
      if (clickHandlerRef.current) map?.off('click', clickHandlerRef.current);
      if (dblClickHandlerRef.current) map?.off('dblclick', dblClickHandlerRef.current);
    };
  }, [map]);

  return { geofences, loading, drawingMode, setDrawingMode, drawnVertices, clearDrawing, alerts };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) { case '&': return '&amp;'; case '<': return '&lt;'; case '>': return '&gt;'; case '"': return '&quot;'; case "'": return '&#39;'; default: return c; }
  });
}