import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from './useApi';
import type { NavTripDetectionState, NavTrip } from '../types';

const LS_KEY = 'rmpg_nav_detection';
const DETECTION_WINDOW_MS = 180_000; // 3 minutes after login to detect movement
const STATIONARY_RADIUS_M = 61; // ~200 ft
const WINDOW_CHECK_MS = 10_000; // 10-second window for movement confirmation
const WIFI_JITTER_M = 30; // ignore sub-30m jumps as WiFi triangulation noise

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function loadState(): NavTripDetectionState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveState(state: NavTripDetectionState) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* quota */ }
}

function clearState() {
  try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
}

export interface UseNavTripDetectionOptions {
  /** Current GPS position { lat, lng, accuracy } or null */
  position: { latitude: number; longitude: number; accuracy?: number | null } | null;
  /** Whether GPS is tracking (user is logged in) */
  isTracking: boolean;
  /** Whether the nav page is visible / app is in foreground */
  isForeground: boolean;
  /** Callback when a trip is auto-started */
  onTripStarted?: (trip: NavTrip) => void;
  /** Callback when a trip is auto-ended */
  onTripEnded?: (trip: NavTrip) => void;
  /** Callback when a trip is confirmed/cancelled */
  onTripUpdated?: (trip: NavTrip) => void;
}

export function useNavTripDetection(opts: UseNavTripDetectionOptions) {
  const { position, isTracking, isForeground, onTripStarted, onTripEnded, onTripUpdated } = opts;

  const [detection, setDetection] = useState<NavTripDetectionState>(() =>
    loadState() || {
      loginPosition: null,
      loginTime: null,
      movementConfirmed: false,
      pendingTripId: null,
      activeTripId: null,
      lastMovementAt: null,
      stationarySince: null,
      bufferStartTime: null,
      bufferPosition: null,
      windowStartTime: null,
      windowStartPosition: null,
      windowMovementDetected: false,
    },
  );

  const [currentTrip, setCurrentTrip] = useState<NavTrip | null>(null);
  const detectionRef = useRef(detection);
  detectionRef.current = detection;

  // ── Persist state ─────────────────────────────────────────
  useEffect(() => { saveState(detection); }, [detection]);

  // ── Fetch current trip on mount / foreground ──────────────
  const fetchCurrentTrip = useCallback(async () => {
    try {
      const res = await apiFetch<{ trip: NavTrip | null }>('/nav/trip/current');
      if (res?.trip) {
        setCurrentTrip(res.trip);
        setDetection((prev) => ({
          ...prev,
          activeTripId: res.trip!.status === 'active' ? res.trip!.id : prev.activeTripId,
          pendingTripId: res.trip!.status === 'pending' ? res.trip!.id : prev.pendingTripId,
        }));
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchCurrentTrip(); }, [fetchCurrentTrip, isForeground]);

  // ── Check for take-home vehicle ───────────────────────────
  const [hasTakeHome, setHasTakeHome] = useState(false);
  useEffect(() => {
    apiFetch<{ has_take_home: boolean }>('/nav/vehicle-take-home')
      .then((r) => { if (r) setHasTakeHome(r.has_take_home); })
      .catch(() => {});
  }, []);

  // ── Core movement detection ───────────────────────────────
  useEffect(() => {
    if (!isTracking || !position) return;

    const now = Date.now();
    const { latitude, longitude, accuracy } = position;

    setDetection((prev) => {
      const next = { ...prev };

      // First position = login position
      if (!next.loginPosition && isTracking) {
        next.loginPosition = { lat: latitude, lng: longitude, accuracy: accuracy ?? 0 };
        next.loginTime = now;
        next.bufferStartTime = now;
        next.bufferPosition = { lat: latitude, lng: longitude };
        return next;
      }

      // Already confirmed movement — skip detection
      if (next.movementConfirmed || next.activeTripId) return next;

      // Past detection window (3 min) — stop trying
      if (next.loginTime && now - next.loginTime > DETECTION_WINDOW_MS) {
        // Cancel any pending trip if no movement confirmed
        if (next.pendingTripId && !next.movementConfirmed) {
          cancelTrip(next.pendingTripId);
          next.pendingTripId = null;
        }
        return next;
      }

      // ── WiFi jitter filter ──────────────────────────────
      // Ignore small jumps typical of WiFi triangulation on desktop
      if (next.bufferPosition) {
        const distFromBuffer = haversineM(
          next.bufferPosition.lat, next.bufferPosition.lng,
          latitude, longitude,
        );
        // Sub-30m jumps within the stationary radius are WiFi noise — skip
        if (distFromBuffer < WIFI_JITTER_M && distFromBuffer < STATIONARY_RADIUS_M) {
          return next;
        }
      }

      // ── Movement detection with 10-second confirmation window ──
      if (next.loginPosition) {
        const distFromLogin = haversineM(
          next.loginPosition.lat, next.loginPosition.lng,
          latitude, longitude,
        );

        // Check for movement >200ft from login position
        if (distFromLogin > STATIONARY_RADIUS_M) {
          // Start or continue the 10-second confirmation window
          if (!next.windowStartTime) {
            next.windowStartTime = now;
            next.windowStartPosition = { lat: latitude, lng: longitude };
            next.windowMovementDetected = false;
          }

          const windowElapsed = now - next.windowStartTime;
          if (windowElapsed <= WINDOW_CHECK_MS) {
            // Within the 10s window — check if still >200ft from window start
            const distFromWindowStart = haversineM(
              next.windowStartPosition!.lat, next.windowStartPosition!.lng,
              latitude, longitude,
            );
            if (distFromWindowStart > WIFI_JITTER_M) {
              next.windowMovementDetected = true;
            }
          } else {
            // 10s window expired without sustained movement — reset
            if (!next.windowMovementDetected) {
              next.windowStartTime = null;
              next.windowStartPosition = null;
            }
          }

          // Movement confirmed: sustained >200ft in 10s window
          if (next.windowMovementDetected && !next.movementConfirmed) {
            next.movementConfirmed = true;
            next.lastMovementAt = now;
            next.bufferPosition = { lat: latitude, lng: longitude };

            // Auto-start trip if we have a pending one or need to create
            if (next.pendingTripId) {
              confirmTrip(next.pendingTripId)
                .then((trip) => {
                  if (!trip) return;
                  setCurrentTrip(trip);
                  onTripStarted?.(trip);
                  setDetection((p) => ({ ...p, activeTripId: trip.id, pendingTripId: null }));
                })
                .catch(() => {});
            } else {
              startTrip(latitude, longitude, accuracy)
                .then((trip) => {
                  if (!trip) return;
                  setCurrentTrip(trip);
                  onTripStarted?.(trip);
                  setDetection((p) => ({ ...p, pendingTripId: trip.id }));
                })
                .catch(() => {});
            }
          }

          return next;
        }

        // User is still within 200ft of login
        if (!next.bufferStartTime) {
          next.bufferStartTime = now;
          next.bufferPosition = { lat: latitude, lng: longitude };
        }

        const bufferElapsed = now - next.bufferStartTime;
        if (bufferElapsed >= DETECTION_WINDOW_MS) {
          // 3 minutes stationary — clear pending record
          if (next.pendingTripId && !next.movementConfirmed) {
            cancelTrip(next.pendingTripId);
            next.pendingTripId = null;
          }
          // Reset buffer for next cycle
          next.bufferStartTime = now;
          next.bufferPosition = { lat: latitude, lng: longitude };
          next.windowStartTime = null;
          next.windowStartPosition = null;
          next.windowMovementDetected = false;
        }
      }

      return next;
    });
  }, [position, isTracking]);

  // ── Start trip (POST to server) ───────────────────────────
  const startTrip = useCallback(async (lat: number, lng: number, accuracy?: number | null): Promise<NavTrip | null> => {
    try {
      const res = await apiFetch<{ success: boolean; trip_id: number; status: string }>('/nav/trip/start', {
        method: 'POST',
        body: JSON.stringify({ start_lat: lat, start_lng: lng, start_accuracy: accuracy }),
      });
      if (res?.trip_id) {
        // Immediately confirm it since we detected real movement
        const confirmRes = await apiFetch<{ success: boolean; status: string }>(
          `/nav/trip/${res.trip_id}/confirm`, { method: 'PUT' },
        );
        if (confirmRes?.success) {
          const trip = await apiFetch<{ trip: NavTrip }>(`/nav/trip/${res.trip_id}`);
          return trip?.trip || null;
        }
      }
      return null;
    } catch { return null; }
  }, []);

  const confirmTrip = useCallback(async (tripId: number): Promise<NavTrip | null> => {
    try {
      await apiFetch(`/nav/trip/${tripId}/confirm`, { method: 'PUT' });
      const res = await apiFetch<{ trip: NavTrip }>(`/nav/trip/${tripId}`);
      return res?.trip || null;
    } catch { return null; }
  }, []);

  const cancelTrip = useCallback(async (tripId: number) => {
    try { await apiFetch(`/nav/trip/${tripId}/cancel`, { method: 'PUT' }); } catch { /* silent */ }
  }, []);

  // ── Manual trip controls ──────────────────────────────────
  const startManualTrip = useCallback(async (lat: number, lng: number, accuracy?: number | null) => {
    const trip = await startTrip(lat, lng, accuracy);
    if (trip) {
      setCurrentTrip(trip);
      setDetection((prev) => ({
        ...prev, activeTripId: trip.id, movementConfirmed: true,
      }));
      onTripStarted?.(trip);
    }
  }, [startTrip, onTripStarted]);

  const endCurrentTrip = useCallback(async (endLat?: number | null, endLng?: number | null) => {
    const tripId = detectionRef.current.activeTripId || detectionRef.current.pendingTripId;
    if (!tripId) return;
    try {
      await apiFetch(`/nav/trip/${tripId}/end`, {
        method: 'PUT',
        body: JSON.stringify({ end_lat: endLat, end_lng: endLng }),
      });
      const res = await apiFetch<{ trip: NavTrip }>(`/nav/trip/${tripId}`);
      if (res?.trip) onTripEnded?.(res.trip);
      setCurrentTrip(null);
      setDetection((prev) => ({
        ...prev, activeTripId: null, pendingTripId: null,
        movementConfirmed: false, loginPosition: null, loginTime: null,
      }));
      clearState();
    } catch { /* silent */ }
  }, [onTripEnded]);

  // ── Periodic route updates for active trip ────────────────
  useEffect(() => {
    if (!detection.activeTripId || !position || !isTracking) return;
    const interval = setInterval(() => {
      const pt = {
        lat: position.latitude,
        lng: position.longitude,
        ts: new Date().toISOString(),
        speed: undefined as number | undefined,
        heading: undefined as number | undefined,
      };
      apiFetch(`/nav/trip/${detection.activeTripId}/update`, {
        method: 'PUT',
        body: JSON.stringify({
          route_points: [pt],
          current_lat: pt.lat,
          current_lng: pt.lng,
        }),
      }).catch(() => {});
    }, 15_000); // every 15 seconds
    return () => clearInterval(interval);
  }, [detection.activeTripId, position, isTracking]);

  // ── Auto-end trip when user goes stationary for >5 minutes ──
  useEffect(() => {
    if (!detection.activeTripId || !position || !isTracking) return;
    if (!detection.lastMovementAt) return;
    const check = setInterval(() => {
      if (Date.now() - (detectionRef.current.lastMovementAt ?? 0) > 300_000) {
        endCurrentTrip(position.latitude, position.longitude);
      }
    }, 30_000);
    return () => clearInterval(check);
  }, [detection.activeTripId, detection.lastMovementAt, position, isTracking, endCurrentTrip]);

  // ── Update lastMovementAt when position changes significantly ──
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!position || !detection.activeTripId) return;
    if (lastPosRef.current) {
      const d = haversineM(lastPosRef.current.lat, lastPosRef.current.lng, position.latitude, position.longitude);
      if (d > WIFI_JITTER_M) {
        setDetection((prev) => ({ ...prev, lastMovementAt: Date.now() }));
      }
    }
    lastPosRef.current = { lat: position.latitude, lng: position.longitude };
  }, [position, detection.activeTripId]);

  // ── Cleanup on unmount (don't cancel active trips) ────────
  useEffect(() => {
    return () => { saveState(detectionRef.current); };
  }, []);

  return {
    detection,
    currentTrip,
    hasTakeHome,
    startManualTrip,
    endCurrentTrip,
    fetchCurrentTrip,
  };
}
