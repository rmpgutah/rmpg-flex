import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';

export type SafetyAlertType =
  | 'shots_fired'
  | 'officer_down'
  | 'pursuit'
  | 'hazmat'
  | 'armed_subject'
  | 'barricaded'
  | 'hostage'
  | 'bomb_threat'
  | 'active_shooter'
  | 'missing_officer';

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
  shots_fired: 'Shots Fired',
  officer_down: 'Officer Down',
  pursuit: 'Pursuit',
  hazmat: 'HAZMAT',
  armed_subject: 'Armed Subject',
  barricaded: 'Barricaded Subject',
  hostage: 'Hostage',
  bomb_threat: 'Bomb Threat',
  active_shooter: 'Active Shooter',
  missing_officer: 'Missing Officer',
};

export const ALERT_SEVERITY_COLORS: Record<string, string> = {
  officer_down: '#ef4444',
  active_shooter: '#ef4444',
  shots_fired: '#f59e0b',
  armed_subject: '#f59e0b',
  pursuit: '#888888',
  hazmat: '#888888',
  bomb_threat: '#f59e0b',
  barricaded: '#f59e0b',
  hostage: '#ef4444',
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
    case 'officer_down':
    case 'active_shooter': return TONE_PATTERNS.critical;
    case 'shots_fired':
    case 'armed_subject': return TONE_PATTERNS.high;
    case 'pursuit': return TONE_PATTERNS.siren;
    case 'hazmat':
    case 'bomb_threat': return TONE_PATTERNS.warning;
    default: return TONE_PATTERNS.info;
  }
}

export function useMapAlerts(map: mapboxgl.Map | null): UseMapAlertsReturn {
  const [alerts, setAlerts] = useState<SafetyAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const { subscribe } = useWebSocket();

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const sourceId = 'safety-alerts';
  const audioCtxRef = useRef<AudioContext | null>(null);

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
      if (map) {
        if (map.getLayer(sourceId)) map.removeLayer(sourceId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      }
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
      audioCtxRef.current?.close().catch(() => {});
    };
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
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = pattern.frequencies[i];
        osc.type = 'square';
        gain.gain.value = 0.15;
        const dur = pattern.durations[i] / 1000;
        osc.start(time);
        osc.stop(time + dur);
        time += dur + pattern.gaps[i] / 1000;
      }
    } catch (err) {
      console.warn('[useMapAlerts] Audio playback failed:', err);
    }
  }, []);

  const renderAlertCircles = useCallback(() => {
    if (!map) return;

    if (map.getLayer(sourceId)) map.removeLayer(sourceId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    if (!popupRef.current) popupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });

    const activeAlerts = alerts.filter(a => !a.expired);
    if (activeAlerts.length === 0) return;

    const features = activeAlerts.map(alert => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [alert.lng, alert.lat] as [number, number] },
      properties: { id: alert.id, type: alert.type, color: ALERT_SEVERITY_COLORS[alert.type] || '#f59e0b', radius: alert.radius, details: alert.details, acknowledged: alert.acknowledged, timestamp: alert.timestamp },
    }));

    map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({
      id: sourceId,
      type: 'circle',
      source: sourceId,
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['get', 'radius'],
        'circle-opacity': ['case', ['get', 'acknowledged'], 0.06, 0.12],
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': 2,
        'circle-stroke-opacity': ['case', ['get', 'acknowledged'], 0.4, 0.8],
      },
    });

    map.on('click', sourceId, (e) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;
      const p = feature.properties;
      const html = `<div style="font-family:monospace;font-size:11px;color:#e0e0e0;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid ${p.color}40"><div style="font-weight:bold;font-size:12px;color:${p.color};margin-bottom:4px">${ALERT_TYPE_LABELS[p.type as SafetyAlertType] || p.type}</div><div style="font-size:9px;color:#9ca3af">${p.details}</div><div style="font-size:8px;color:#545454;margin-top:4px">${new Date(p.timestamp as string).toLocaleString()}</div></div>`;
      if (popupRef.current) popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
  }, [map, alerts]);

  useEffect(() => {
    renderAlertCircles();
  }, [map, alerts, renderAlertCircles]);

  const handleIncomingAlert = useCallback((data: unknown) => {
    const alertData = data as { id: string; type: SafetyAlertType; lat: number; lng: number; details: string; radius?: number; timestamp: string };
    if (!alertData.id || !alertData.type || alertData.lat == null || alertData.lng == null) {
      console.warn('[useMapAlerts] Received alert with missing required fields, ignoring');
      return;
    }

    const newAlert: SafetyAlert = {
      id: alertData.id, type: alertData.type, lat: alertData.lat, lng: alertData.lng,
      details: alertData.details, radius: (alertData.radius != null && Number.isFinite(alertData.radius) && alertData.radius > 0) ? alertData.radius : 500,
      timestamp: alertData.timestamp, acknowledged: false, expired: false,
    };

    setAlerts((prev) => {
      if (prev.some((a) => a.id === newAlert.id)) return prev;
      return [newAlert, ...prev].slice(0, MAX_HISTORY);
    });

    playAlertSound(newAlert.type);
  }, [playAlertSound]);

  useEffect(() => {
    const unsub = subscribe('safety:broadcast' as 'dispatch_update', handleIncomingAlert);
    return unsub;
  }, [subscribe, handleIncomingAlert]);

  const broadcastAlert = useCallback(async (type: SafetyAlertType, lat: number, lng: number, details: string, radius?: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setLoading(true);
    try {
      await apiFetch<{ success: boolean; id: string }>('/map/safety/safety-alert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, lat, lng, details, radius: radius || 500 }),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const acknowledgeAlert = useCallback((alertId: string) => {
    setAlerts((prev) => prev.map((a) => a.id === alertId && !a.acknowledged ? { ...a, acknowledged: true } : a));
  }, []);

  const clearAlert = useCallback((alertId: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  }, []);

  const clearAllAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  const activeAlerts = useMemo(() => alerts.filter((a) => !a.expired), [alerts]);
  const alertHistory = useMemo(() => alerts, [alerts]);

  return { broadcastAlert, activeAlerts, alertHistory, acknowledgeAlert, clearAlert, clearAllAlerts, loading };
}
