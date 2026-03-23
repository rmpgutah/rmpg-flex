// ============================================================
// RMPG Flex — useMapAlerts Hook
// Safety alert system: broadcast, receive, visualize, and
// manage officer safety alerts with WebSocket integration
// and Web Audio API sound differentiation.
// ============================================================

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';

// ─── Types ──────────────────────────────────────────────────

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
  pursuit: '#3b82f6',
  hazmat: '#3b82f6',
  bomb_threat: '#f59e0b',
  barricaded: '#f59e0b',
  hostage: '#ef4444',
  missing_officer: '#a855f7',
};

interface UseMapAlertsReturn {
  broadcastAlert: (
    type: SafetyAlertType,
    lat: number,
    lng: number,
    details: string,
    radius?: number,
  ) => Promise<void>;
  activeAlerts: SafetyAlert[];
  alertHistory: SafetyAlert[];
  acknowledgeAlert: (alertId: string) => void;
  clearAlert: (alertId: string) => void;
  clearAllAlerts: () => void;
  loading: boolean;
}

// ─── Constants ──────────────────────────────────────────────

const MAX_HISTORY = 50;
const ALERT_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

// ─── Audio Patterns ─────────────────────────────────────────

type TonePattern = {
  frequencies: number[];
  durations: number[];
  gaps: number[];
};

const TONE_PATTERNS: Record<string, TonePattern> = {
  // Rapid high-pitched alarm — 3 beeps
  critical: {
    frequencies: [1200, 1200, 1200],
    durations: [120, 120, 120],
    gaps: [80, 80, 0],
  },
  // Two sharp tones
  high: {
    frequencies: [880, 1100],
    durations: [150, 150],
    gaps: [100, 0],
  },
  // Alternating siren
  siren: {
    frequencies: [700, 900, 700, 900],
    durations: [200, 200, 200, 200],
    gaps: [50, 50, 50, 0],
  },
  // Low continuous tone
  warning: {
    frequencies: [440],
    durations: [500],
    gaps: [0],
  },
  // Single attention tone
  info: {
    frequencies: [660],
    durations: [250],
    gaps: [0],
  },
};

function getAlertPattern(type: SafetyAlertType): TonePattern {
  switch (type) {
    case 'officer_down':
    case 'active_shooter':
      return TONE_PATTERNS.critical;
    case 'shots_fired':
    case 'armed_subject':
      return TONE_PATTERNS.high;
    case 'pursuit':
      return TONE_PATTERNS.siren;
    case 'hazmat':
    case 'bomb_threat':
      return TONE_PATTERNS.warning;
    default:
      return TONE_PATTERNS.info;
  }
}

// ─── Hook ───────────────────────────────────────────────────

export function useMapAlerts(
  map: google.maps.Map | null,
): UseMapAlertsReturn {
  const [alerts, setAlerts] = useState<SafetyAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const { subscribe } = useWebSocket();

  const circlesRef = useRef<Map<string, google.maps.Circle>>(new Map());
  const pulseTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);

  // ── Expiry timer ────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setAlerts((prev) =>
        prev.map((a) => {
          if (!a.expired && now - new Date(a.timestamp).getTime() > ALERT_EXPIRY_MS) {
            return { ...a, expired: true };
          }
          return a;
        }),
      );
    }, 30_000); // check every 30s

    return () => clearInterval(interval);
  }, []);

  // ── Cleanup on unmount ──────────────────────────────────

  useEffect(() => {
    return () => {
      circlesRef.current.forEach((c) => c.setMap(null));
      circlesRef.current.clear();
      pulseTimersRef.current.forEach((t) => clearInterval(t));
      pulseTimersRef.current.clear();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  // ── Play alert sound ────────────────────────────────────

  const playAlertSound = useCallback((type: SafetyAlertType) => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

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
    } catch {
      // Audio not available — silently fail
    }
  }, []);

  // ── Render alert circle on map ──────────────────────────

  const renderAlertCircle = useCallback(
    (alert: SafetyAlert) => {
      if (!map || !window.google?.maps) return;

      // Remove existing
      const existing = circlesRef.current.get(alert.id);
      if (existing) {
        existing.setMap(null);
      }
      const existingTimer = pulseTimersRef.current.get(alert.id);
      if (existingTimer) {
        clearInterval(existingTimer);
      }

      const color = ALERT_SEVERITY_COLORS[alert.type] || '#f59e0b';

      const circle = new google.maps.Circle({
        center: { lat: alert.lat, lng: alert.lng },
        radius: alert.radius,
        map,
        fillColor: color,
        fillOpacity: 0.12,
        strokeColor: color,
        strokeOpacity: 0.8,
        strokeWeight: 2,
        zIndex: 200,
      });

      circlesRef.current.set(alert.id, circle);

      // Pulse animation (only if not acknowledged)
      if (!alert.acknowledged) {
        let visible = true;
        const timer = setInterval(() => {
          visible = !visible;
          circle.setOptions({
            fillOpacity: visible ? 0.12 : 0.25,
            strokeOpacity: visible ? 0.8 : 0.4,
          });
        }, 800);
        pulseTimersRef.current.set(alert.id, timer);
      }
    },
    [map],
  );

  // ── Remove alert circle from map ────────────────────────

  const removeAlertCircle = useCallback((alertId: string) => {
    const circle = circlesRef.current.get(alertId);
    if (circle) {
      circle.setMap(null);
      circlesRef.current.delete(alertId);
    }
    const timer = pulseTimersRef.current.get(alertId);
    if (timer) {
      clearInterval(timer);
      pulseTimersRef.current.delete(alertId);
    }
  }, []);

  // ── Handle incoming alert ───────────────────────────────

  const handleIncomingAlert = useCallback(
    (data: unknown) => {
      const alertData = data as {
        id: string;
        type: SafetyAlertType;
        lat: number;
        lng: number;
        details: string;
        radius?: number;
        timestamp: string;
      };

      // Validate required fields before creating alert
      if (!alertData.id || !alertData.type || alertData.lat == null || alertData.lng == null) {
        console.warn('[useMapAlerts] Received alert with missing required fields, ignoring');
        return;
      }

      const newAlert: SafetyAlert = {
        id: alertData.id,
        type: alertData.type,
        lat: alertData.lat,
        lng: alertData.lng,
        details: alertData.details,
        radius: alertData.radius || 500,
        timestamp: alertData.timestamp,
        acknowledged: false,
        expired: false,
      };

      setAlerts((prev) => {
        // Prevent duplicates
        if (prev.some((a) => a.id === newAlert.id)) return prev;
        const updated = [newAlert, ...prev].slice(0, MAX_HISTORY);
        return updated;
      });

      renderAlertCircle(newAlert);
      playAlertSound(newAlert.type);
    },
    [renderAlertCircle, playAlertSound],
  );

  // ── WebSocket subscription ──────────────────────────────

  useEffect(() => {
    const unsub = subscribe('safety:broadcast' as any, handleIncomingAlert);
    return unsub;
  }, [subscribe, handleIncomingAlert]);

  // ── Re-render circles when map becomes available ────────

  useEffect(() => {
    if (!map) return;
    alerts.forEach((a) => {
      if (!a.expired) {
        renderAlertCircle(a);
      }
    });
    // Only run when map reference changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // ── Broadcast alert ─────────────────────────────────────

  const broadcastAlert = useCallback(
    async (
      type: SafetyAlertType,
      lat: number,
      lng: number,
      details: string,
      radius?: number,
    ) => {
      setLoading(true);
      try {
        await apiFetch<{ success: boolean; id: string }>(
          '/map/safety/safety-alert',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type,
              lat,
              lng,
              details,
              radius: radius || 500,
            }),
          },
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // ── Acknowledge alert ───────────────────────────────────

  const acknowledgeAlert = useCallback(
    (alertId: string) => {
      setAlerts((prev) =>
        prev.map((a) => {
          if (a.id === alertId && !a.acknowledged) {
            // Stop pulsing
            const timer = pulseTimersRef.current.get(alertId);
            if (timer) {
              clearInterval(timer);
              pulseTimersRef.current.delete(alertId);
            }
            // Set circle to static
            const circle = circlesRef.current.get(alertId);
            if (circle) {
              circle.setOptions({ fillOpacity: 0.06, strokeOpacity: 0.4 });
            }
            return { ...a, acknowledged: true };
          }
          return a;
        }),
      );
    },
    [],
  );

  // ── Clear single alert ──────────────────────────────────

  const clearAlert = useCallback(
    (alertId: string) => {
      removeAlertCircle(alertId);
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    },
    [removeAlertCircle],
  );

  // ── Clear all alerts ────────────────────────────────────

  const clearAllAlerts = useCallback(() => {
    circlesRef.current.forEach((c) => c.setMap(null));
    circlesRef.current.clear();
    pulseTimersRef.current.forEach((t) => clearInterval(t));
    pulseTimersRef.current.clear();
    setAlerts([]);
  }, []);

  // ── Derived state (memoized to avoid re-renders) ────────

  const activeAlerts = useMemo(() => alerts.filter((a) => !a.expired), [alerts]);
  const alertHistory = useMemo(() => alerts, [alerts]);

  return {
    broadcastAlert,
    activeAlerts,
    alertHistory,
    acknowledgeAlert,
    clearAlert,
    clearAllAlerts,
    loading,
  };
}
