import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from './useApi';
import type { NavTripDetectionState, NavTrip } from '../types';

const LS_KEY = 'rmpg_nav_detection';
const DETECTION_WINDOW_MS = 180_000; // 3 minutes after login to detect movement
const STATIONARY_RADIUS_M = 61; // ~200 ft — "definitely left the parking spot" signal
const DEPARTURE_RADIUS_M = 500; // trip auto-starts only once the vehicle is 500m from its anchor
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
  try {
    // Do NOT persist raw GPS coordinates to localStorage (sensitive location data
    // at rest — CWE-312). The anchor/buffer/window positions are transient working
    // memory for the detector and re-seed from the next live fix on reload (see the
    // `!loginPosition` re-anchor branch in the detection effect); only the
    // non-location bookkeeping (trip ids, timestamps, flags) needs to survive.
    const persisted: NavTripDetectionState = {
      ...state,
      loginPosition: null,
      bufferPosition: null,
      windowStartPosition: null,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(persisted));
  } catch { /* quota */ }
}

function clearState() {
  try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
}

export interface UseNavTripDetectionOptions {
  /** Current GPS position { lat, lng, accuracy } or null.
   *  speed (m/s) and heading (deg) are optional — when supplied they ride along
   *  on the live route breadcrumbs so the trip's max-speed populates. */
  position: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    speed?: number | null;
    heading?: number | null;
  } | null;
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

  const isStartingRef = useRef(false);
  // Latest position kept in a ref so the interval-driven uploaders below can read
  // the current fix WITHOUT listing `position` in their dependency arrays. The
  // `position` prop is a fresh object literal every GPS fix (~1/sec), so binding
  // an interval effect to it would tear down + recreate the interval every second
  // and it would never live long enough to fire (the bug that silently dropped
  // all live trip movement data). speed (m/s) / heading ride along for max-speed.
  const positionRef = useRef<{
    latitude: number;
    longitude: number;
    speed?: number | null;
    heading?: number | null;
  } | null>(null);

  // ── Persist state ─────────────────────────────────────────
  useEffect(() => { saveState(detection); }, [detection]);

  // ── Fetch current trip on mount / foreground ──────────────
  const fetchCurrentTrip = useCallback(async () => {
    try {
      const res = await apiFetch<{ trip: NavTrip | null }>('/nav/trip/current');
      if (res?.trip) {
        setCurrentTrip(res.trip);
        // 'paused' is treated as in-progress here (same as 'active') — the trip
        // is still the officer's current trip, just dwelling at a station
        // geofence. Nulling activeTripId for a paused trip (as this used to do,
        // since only 'active'/'pending' were checked) made the client think
        // nothing was in progress on the next mount/foreground fetch: the
        // paused badge would flip off even though the trip is still paused
        // server-side, AND movement detection would re-arm from scratch —
        // risking a duplicate trip being started on the next drive away from
        // the station instead of resuming the existing one.
        const isInProgress = res.trip!.status === 'active' || res.trip!.status === 'paused';
        setDetection((prev) => ({
          ...prev,
          activeTripId: isInProgress ? res.trip!.id : null,
          pendingTripId: res.trip!.status === 'pending' ? res.trip!.id : null,
          // Seed lastMovementAt when ADOPTING an active trip from the server (app
          // reopened mid-trip). The auto-end interval bails on `!lastMovementAt`,
          // so without a baseline an adopted trip could only ever auto-end after
          // the next significant move — park immediately after reopening and it
          // would hang active until the server's stale reaper caught it. Do NOT
          // seed it for a paused trip — being stopped is the expected, intended
          // state of a pause, not idle abandonment, and /trip/:id/end already
          // rejects non-active/pending trips server-side (see PUT /trip/:id/end),
          // so there's no auto-end risk left to guard against here.
          lastMovementAt: res.trip!.status === 'active'
            ? (prev.lastMovementAt ?? Date.now())
            : prev.lastMovementAt,
        }));
      } else {
        // Server has NO active/pending trip. If our persisted state still points
        // at one (e.g. the server auto-closed a stale active trip from a prior
        // session, or a trip ended elsewhere), clear the stale ids and re-arm
        // detection — otherwise activeTripId stays set forever and the detector
        // skips, so the officer can never log another trip. (Self-heal for the
        // poison-pill state where one abandoned trip bricked all future ones.)
        setCurrentTrip(null);
        setDetection((prev) => (prev.activeTripId || prev.pendingTripId)
          ? {
              ...prev,
              activeTripId: null,
              pendingTripId: null,
              movementConfirmed: false,
              loginPosition: null,
              loginTime: null,
              windowStartTime: null,
              windowStartPosition: null,
              windowMovementDetected: false,
            }
          : prev);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchCurrentTrip(); }, [fetchCurrentTrip, isForeground]);

  useEffect(() => {
    if (position) {
      positionRef.current = {
        latitude: position.latitude,
        longitude: position.longitude,
        speed: position.speed ?? null,
        heading: position.heading ?? null,
      };
    }
  }, [position]);

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

      // Past detection window (3 min) with no departure detected. The officer
      // has been parked here; RE-ARM the window against the current position
      // instead of going dead for the whole session. Without this, auto-detection
      // only ever works in the first 3 min after the app gets a fix — an officer
      // who sits a while before driving (the common take-home case) would never
      // auto-log a trip. Re-anchoring makes it a rolling "departed from where I
      // was sitting" detector. (Only reached when NOT already on a trip — the
      // movementConfirmed/activeTripId guard above returns first.)
      if (next.loginTime && now - next.loginTime > DETECTION_WINDOW_MS) {
        // In-transit guard: if the vehicle has clearly left its parking spot
        // (>200ft from the anchor) but hasn't crossed the 500m departure radius
        // yet (slow surface streets, parking-lot creep), do NOT re-anchor — that
        // would move the trip's start point mid-departure and the recorded trip
        // would begin at some arbitrary spot instead of the true origin. Extend
        // the window and keep the original anchor.
        if (next.loginPosition) {
          const distFromAnchor = haversineM(
            next.loginPosition.lat, next.loginPosition.lng, latitude, longitude,
          );
          if (distFromAnchor > STATIONARY_RADIUS_M) {
            next.loginTime = now;
            return next;
          }
        }
        if (next.pendingTripId && !next.movementConfirmed) {
          cancelTrip(next.pendingTripId);
          next.pendingTripId = null;
        }
        next.loginPosition = { lat: latitude, lng: longitude, accuracy: accuracy ?? 0 };
        next.loginTime = now;
        next.bufferStartTime = now;
        next.bufferPosition = { lat: latitude, lng: longitude };
        next.windowStartTime = null;
        next.windowStartPosition = null;
        next.windowMovementDetected = false;
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

        // Trip detection gate: only arm once the vehicle is >500m from the
        // anchor (login/park) position. The trip itself is recorded FROM the
        // anchor, not from this 500m boundary — see the auto-start below.
        if (distFromLogin > DEPARTURE_RADIUS_M) {
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
            if (!isStartingRef.current) {
              isStartingRef.current = true;
              if (next.pendingTripId) {
                confirmTrip(next.pendingTripId)
                  .then((trip) => {
                    if (!trip) return;
                    setCurrentTrip(trip);
                    onTripStarted?.(trip);
                    setDetection((p) => ({ ...p, activeTripId: trip.id, pendingTripId: null }));
                  })
                  .catch(() => {})
                  .finally(() => { isStartingRef.current = false; });
              } else {
                // Anchor the trip at the ORIGINAL login/park position, not the
                // current fix — by the time the 500m departure gate confirms,
                // the vehicle is already 500m+ down the road. Recording from the
                // anchor keeps start point + distance true to the real origin.
                const anchor = next.loginPosition!;
                const anchorTs = next.loginTime;
                const confirmFix = { lat: latitude, lng: longitude };
                startTrip(anchor.lat, anchor.lng, anchor.accuracy)
                  .then((trip) => {
                    if (!trip) return;
                    setCurrentTrip(trip);
                    onTripStarted?.(trip);
                    // startTrip() POSTs /start AND PUTs /confirm, so the returned
                    // trip is already 'active' — record it as activeTripId, NOT
                    // pendingTripId. The route-update + auto-end intervals both
                    // guard `if (!activeTripId) return`, so leaving this as a
                    // pending id meant every AUTO-detected trip recorded zero live
                    // breadcrumbs and never auto-ended (only manual trips, which set
                    // activeTripId directly, worked). Seed lastMovementAt so the
                    // 5-min stationary auto-end has a baseline. Mirrors the
                    // confirmTrip branch above.
                    setDetection((p) => ({ ...p, activeTripId: trip.id, pendingTripId: null, lastMovementAt: Date.now() }));
                    // Backfill the anchor→confirmation leg into route_points so
                    // the server's distance math (which only sums route_points —
                    // it starts at '[]') credits the first 500m instead of
                    // beginning the polyline at the departure boundary.
                    apiFetch(`/nav/trip/${trip.id}/update`, {
                      method: 'PUT',
                      body: JSON.stringify({
                        route_points: [
                          { lat: anchor.lat, lng: anchor.lng, ts: new Date(anchorTs ?? Date.now()).toISOString() },
                          { lat: confirmFix.lat, lng: confirmFix.lng, ts: new Date().toISOString() },
                        ],
                        current_lat: confirmFix.lat,
                        current_lng: confirmFix.lng,
                      }),
                    }).catch(() => {});
                  })
                  .catch(() => {})
                  .finally(() => { isStartingRef.current = false; });
              }
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
    // Depend on the primitive coordinates, NOT the `position` object. This effect
    // always calls setDetection, which re-renders the consumer; if we depended on
    // the object ref and the caller rebuilt it each render, the re-render would
    // re-fire this effect → setDetection → re-render → infinite loop. Keying on
    // lat/lng means a setDetection-driven re-render with unchanged coordinates
    // does NOT re-run this effect. (The provider also memoizes position, but this
    // makes the hook safe for any caller.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.latitude, position?.longitude, isTracking]);

  // ── Start trip (POST to server) ───────────────────────────
  const startTrip = useCallback(async (lat: number, lng: number, accuracy?: number | null, detectedBy: 'auto' | 'manual' = 'auto'): Promise<NavTrip | null> => {
    try {
      const res = await apiFetch<{ success: boolean; trip_id: number; status: string }>('/nav/trip/start', {
        method: 'POST',
        body: JSON.stringify({ start_lat: lat, start_lng: lng, start_accuracy: accuracy, detected_by: detectedBy }),
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
    const trip = await startTrip(lat, lng, accuracy, 'manual');
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
  // NOTE: `position` is deliberately NOT in the dependency array. It changes
  // ~1/sec (a new object literal per GPS fix), and including it would clear +
  // recreate this 15s interval on every fix so it could never fire — which is
  // exactly why live trip movement data was never being recorded. We read the
  // latest fix from positionRef inside the tick instead. The interval is bound
  // only to the trip id + tracking flag, both of which change rarely.
  const activeTripId = detection.activeTripId;
  useEffect(() => {
    if (!activeTripId || !isTracking) return;
    const interval = setInterval(() => {
      const pos = positionRef.current;
      if (!pos) return; // no fix yet — skip this tick, try again in 15s
      // route_points carry speed in MPH (matches the server's max_speed_mph math);
      // gps speed is m/s, so convert. Heading passes through as-is (degrees).
      const speedMph = pos.speed != null ? pos.speed * 2.23694 : undefined;
      const pt = {
        lat: pos.latitude,
        lng: pos.longitude,
        ts: new Date().toISOString(),
        speed: speedMph,
        heading: pos.heading ?? undefined,
      };
      apiFetch(`/nav/trip/${activeTripId}/update`, {
        method: 'PUT',
        body: JSON.stringify({
          route_points: [pt],
          current_lat: pt.lat,
          current_lng: pt.lng,
          current_speed: speedMph,
        }),
      }).catch(() => {});
    }, 15_000); // every 15 seconds
    return () => clearInterval(interval);
  }, [activeTripId, isTracking]);

  // ── Auto-end trip when user goes stationary for >5 minutes ──
  // Same fix as the route-update interval: bind only to the trip id + tracking
  // flag (read fix + lastMovementAt from refs), never to `position`, or the 30s
  // interval is reset every GPS fix and the 5-minute stationary check never runs.
  useEffect(() => {
    if (!activeTripId || !isTracking) return;
    const check = setInterval(() => {
      const lastMovement = detectionRef.current.lastMovementAt;
      if (!lastMovement) return;
      if (Date.now() - lastMovement > 300_000) {
        const pos = positionRef.current;
        endCurrentTrip(pos?.latitude ?? null, pos?.longitude ?? null);
      }
    }, 30_000);
    return () => clearInterval(check);
  }, [activeTripId, isTracking, endCurrentTrip]);

  // ── Keep the machine awake while a trip is active (Electron) ──
  // On the Toughbook, ask the main process to hold a powerSaveBlocker for the
  // duration of an active trip so the OS doesn't suspend the app mid-patrol —
  // otherwise the route-update + auto-end intervals stop firing when the
  // officer isn't looking at the screen. The display may still sleep; only
  // system suspension is prevented. Released the moment the trip ends (or the
  // detector unmounts). No-op on the web/mobile build (no window.electron).
  useEffect(() => {
    const electron = (window as any).electron;
    if (!electron?.isElectron || typeof electron.keepAwake !== 'function') return;
    if (activeTripId) {
      electron.keepAwake().catch(() => { /* power blocker is best-effort */ });
      return () => { electron.allowSleep?.().catch(() => {}); };
    }
    // No active trip — make sure any prior blocker is released.
    electron.allowSleep?.().catch(() => {});
  }, [activeTripId]);

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
