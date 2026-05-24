import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';

export type SafetyAlertType =
  | 'shots_fired' | 'officer_down' | 'pursuit' | 'hazmat' | 'armed_subject'
  | 'barricaded' | 'hostage' | 'bomb_threat' | 'active_shooter' | 'missing_officer';

export interface SafetyAlert {
  id: string;
  type: SafetyAlertType;
  lat: number;
  lng: number;
  details: string;
  radius: number;
  timestamp: string;
  acknowledged: boolean;
  expired: boolean;
}

export const ALERT_TYPE_LABELS: Record<SafetyAlertType, string> = {
  shots_fired: 'Shots Fired', officer_down: 'Officer Down', pursuit: 'Pursuit',
  hazmat: 'HAZMAT', armed_subject: 'Armed Subject', barricaded: 'Barricaded Subject',
  hostage: 'Hostage', bomb_threat: 'Bomb Threat', active_shooter: 'Active Shooter',
  missing_officer: 'Missing Officer',
};

export const ALERT_SEVERITY_COLORS: Record<string, string> = {
  officer_down: '#ef4444', active_shooter: '#ef4444', shots_fired: '#f59e0b',
  armed_subject: '#f59e0b', pursuit: '#888888', hazmat: '#888888',
  bomb_threat: '#f59e0b', barricaded: '#f59e0b', hostage: '#ef4444',
  missing_officer: '#a855f7',
};

interface UseMapAlertsReturn {
  broadcastAlert: (type: SafetyAlertType, lat: number, lng: number, details: string, radius?: number) => Promise<void>;
  activeAlerts: SafetyAlert[];
  alertHistory: SafetyAlert[];
  acknowledgeAlert: (alertId: string) => void;
  clearAlert: (alertId: string) => void;
  clearAllAlerts: () => void;
  loading: boolean;
}

const MAX_HISTORY = 50;
const ALERT_EXPIRY_MS = 30 * 60 * 1000;

type TonePattern = { frequencies: number[]; durations: number[]; gaps: number[] };

const TONE_PATTERNS: Record<string, TonePattern> = {
  critical: { frequencies: [1200, 1200, 1200], durations: [120, 120, 120], gaps: [80, 80, 0] },
  high: { frequencies: [880, 1100], durations: [150, 150], gaps: [100, 0] },
  siren: { frequencies: [700, 900, 700, 900], durations: [200, 200, 200, 200], gaps: [50, 50, 50, 0] },
  warning: { frequencies: [440], durations: [500], gaps: [0] },
  info: { frequencies: [660], durations: [250], gaps: [0] },
};

function getAlertPattern(type: SafetyAlertType): TonePattern {
  switch (type) {
    case 'officer_down': case 'active_shooter': return TONE_PATTERNS.critical;
    case 'shots_fired': case 'armed_subject': return TONE_PATTERNS.high;
    case 'pursuit': return TONE_PATTERNS.siren;
    case 'hazmat': case 'bomb_threat': return TONE_PATTERNS.warning;
    default: return TONE_PATTERNS.info;
  }
}

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

export function useMapAlerts(map: mapboxgl.Map | null): UseMapAlertsReturn {
  const [alerts, setAlerts] = useState<SafetyAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const { subscribe } = useWebSocket();

  const sourceIdsRef = useRef<Map<string, string>>(new Map());
  const pulseTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);

  function removeAlertLayer(alertId: string) {
    if (!map) return;
    const layerId = `alert-layer-${alertId}`;
    const sourceId = `alert-source-${alertId}`;
    try {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    } catch { /* ignore */ }
    sourceIdsRef.current.delete(alertId);
  }

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setAlerts((prev) => prev.map((a) => {
        if (!a.expired && now - new Date(a.timestamp).getTime() > ALERT_EXPIRY_MS) return { ...a, expired: true };
        return a;
      }));
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      pulseTimersRef.current.forEach((t) => clearInterval(t));
      pulseTimersRef.current.clear();
      sourceIdsRef.current.forEach((_, id) => removeAlertLayer(id));
      sourceIdsRef.current.clear();
      audioCtxRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  const playAlertSound = useCallback((type: SafetyAlertType) => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const pattern = getAlertPattern(type);
      let time = ctx.currentTime;
      for (let i = 0; i < pattern.frequencies.length; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = pattern.frequencies[i];
        osc.type = 'square';
        gain.gain.value = 0.15;
        const dur = pattern.durations[i] / 1000;
        osc.start(time); osc.stop(time + dur);
        time += dur + pattern.gaps[i] / 1000;
      }
    } catch (err) { console.warn('[useMapAlerts] Audio playback failed:', err); }
  }, []);

  const renderAlertCircle = useCallback((alert: SafetyAlert) => {
    if (!map) return;
    if (!Number.isFinite(alert.lat) || !Number.isFinite(alert.lng)) return;
    removeAlertLayer(alert.id);
    const existingTimer = pulseTimersRef.current.get(alert.id);
    if (existingTimer) { clearInterval(existingTimer); pulseTimersRef.current.delete(alert.id); }

    const color = ALERT_SEVERITY_COLORS[alert.type] || '#f59e0b';
    const poly = circleToPolygon([alert.lng, alert.lat], alert.radius);
    const sourceId = `alert-source-${alert.id}`;
    const layerId = `alert-layer-${alert.id}`;
    sourceIdsRef.current.set(alert.id, sourceId);

    map.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [poly] } }] },
    });
    map.addLayer({ id: layerId, type: 'fill', source: sourceId, paint: { 'fill-color': color, 'fill-opacity': alert.acknowledged ? 0.06 : 0.12, 'fill-outline-color': color } });
  }, [map]);

  const removeAlertLayerSafe = useCallback((alertId: string) => {
    removeAlertLayer(alertId);
    const timer = pulseTimersRef.current.get(alertId);
    if (timer) { clearInterval(timer); pulseTimersRef.current.delete(alertId); }
  }, []);

  const handleIncomingAlert = useCallback((data: unknown) => {
    const alertData = data as any;
    if (!alertData.id || !alertData.type || alertData.lat == null || alertData.lng == null) {
      console.warn('[useMapAlerts] Received alert with missing required fields, ignoring');
      return;
    }
    const newAlert: SafetyAlert = {
      id: alertData.id, type: alertData.type, lat: alertData.lat, lng: alertData.lng,
      details: alertData.details, radius: (alertData.radius != null && Number.isFinite(alertData.radius) && alertData.radius > 0) ? alertData.radius : 500,
      timestamp: alertData.timestamp, acknowledged: false, expired: false,
    };
    setAlerts((prev) => prev.some((a) => a.id === newAlert.id) ? prev : [newAlert, ...prev].slice(0, MAX_HISTORY));
    renderAlertCircle(newAlert);
    playAlertSound(newAlert.type);
  }, [renderAlertCircle, playAlertSound]);

  useEffect(() => {
    const unsub = subscribe('safety:broadcast' as any, handleIncomingAlert);
    return unsub;
  }, [subscribe, handleIncomingAlert]);

  useEffect(() => {
    if (!map) return;
    alerts.forEach((a) => { if (!a.expired) renderAlertCircle(a); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  const broadcastAlert = useCallback(async (type: SafetyAlertType, lat: number, lng: number, details: string, radius?: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setLoading(true);
    try {
      await apiFetch<{ success: boolean; id: string }>('/map/safety/safety-alert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, lat, lng, details, radius: radius || 500 }),
      });
    } finally { setLoading(false); }
  }, []);

  const acknowledgeAlert = useCallback((alertId: string) => {
    setAlerts((prev) => prev.map((a) => {
      if (a.id === alertId && !a.acknowledged) {
        const timer = pulseTimersRef.current.get(alertId);
        if (timer) { clearInterval(timer); pulseTimersRef.current.delete(alertId); }
        const sourceId = sourceIdsRef.current.get(alertId);
        if (sourceId && map && map.getLayer(`alert-layer-${alertId}`)) {
          map.setPaintProperty(`alert-layer-${alertId}`, 'fill-opacity', 0.06);
        }
        return { ...a, acknowledged: true };
      }
      return a;
    }));
  }, [map]);

  const clearAlert = useCallback((alertId: string) => {
    removeAlertLayerSafe(alertId);
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  }, [removeAlertLayerSafe]);

  const clearAllAlerts = useCallback(() => {
    sourceIdsRef.current.forEach((_, id) => removeAlertLayer(id));
    sourceIdsRef.current.clear();
    pulseTimersRef.current.forEach((t) => clearInterval(t));
    pulseTimersRef.current.clear();
    setAlerts([]);
  }, []);

  const activeAlerts = useMemo(() => alerts.filter((a) => !a.expired), [alerts]);
  const alertHistory = useMemo(() => alerts, [alerts]);

  return { broadcastAlert, activeAlerts, alertHistory, acknowledgeAlert, clearAlert, clearAllAlerts, loading };
}