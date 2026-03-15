import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';
import { devLog } from '../utils/devLog';

// ============================================================
// GPS Tracking Hook — 1-Second Breadcrumb Collection
//
// Captures every position update from the browser Geolocation API
// (~1/second with high accuracy), filters out bad data, and
// batch-sends to the server every BATCH_INTERVAL_MS.
//
// MANDATORY MODE: GPS tracking is ALWAYS ON for all logged-in
// users. Location sharing cannot be disabled. A blocking overlay
// is shown if the user denies location permission.
// ============================================================

/** Position source: how the lat/lng was obtained */
export type PositionSource = 'gps' | 'wifi' | 'ip' | 'unknown';

/** Network connection type detected via Network Information API */
export type ConnectionType = 'wifi' | 'cellular' | 'ethernet' | 'none' | 'unknown';

export interface GpsState {
  /** Whether GPS tracking is actively running */
  isTracking: boolean;
  /** Current latitude from browser geolocation */
  latitude: number | null;
  /** Current longitude from browser geolocation */
  longitude: number | null;
  /** Accuracy in meters */
  accuracy: number | null;
  /** Heading in degrees (0-360, null if unavailable) */
  heading: number | null;
  /** Speed in m/s (null if unavailable) */
  speed: number | null;
  /** Last time we successfully sent position to server */
  lastSentAt: string | null;
  /** Error message if something went wrong */
  error: string | null;
  /** Whether the user's browser supports geolocation */
  isSupported: boolean;
  /** The unit call sign assigned to this user (if any) */
  unitCallSign: string | null;
  /** The unit ID assigned to this user (if any) */
  unitId: number | null;
  /** Whether GPS permission was denied (blocks app usage) */
  permissionDenied: boolean;
  /** Whether we're still waiting for location permission */
  permissionPending: boolean;
  /** Current network connection type (wifi/cellular/ethernet/none) */
  connectionType: ConnectionType;
  /** How the current position was obtained (gps/wifi/ip) */
  positionSource: PositionSource;
}

interface UseGpsTrackingOptions {
  /** Interval in ms between batch sends to server (default: 5000 = 5s) */
  batchIntervalMs?: number;
  /** Enable high-accuracy GPS (uses more battery) */
  highAccuracy?: boolean;
  /** Maximum accuracy in meters — points above this are discarded (default: 100) */
  maxAccuracyMeters?: number;
  /** Maximum plausible speed in m/s for jump detection (default: 100 = ~360 km/h) */
  maxSpeedMs?: number;
}

// ─── Constants ──────────────────────────────────────────────
/** Whether the current device is likely a desktop/laptop (no GPS hardware). */
const IS_DESKTOP = typeof window !== 'undefined' && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

/** How often to batch-send collected points to the server (15 seconds).
 *  Increased from 5s to reduce bandwidth on mobile WiFi / vehicle networks
 *  while still providing timely breadcrumb updates. */
const DEFAULT_BATCH_INTERVAL = 15000;
/** Reject GPS readings less accurate than this (meters).
 *  Set to 200 to accept WiFi-based positioning on mobile/vehicle networks
 *  (typically 80–150m accuracy, occasionally worse in parking structures). */
const DEFAULT_MAX_ACCURACY = 200;
/** Reject points that imply movement faster than this (m/s). 100 m/s ≈ 224 mph */
const DEFAULT_MAX_SPEED = 100;
/** Maximum in-memory queue size to prevent unbounded growth during network outages.
 *  At 1 point/sec with 15s batch interval, normal operation uses ~15 points.
 *  500 points covers ~8 minutes of offline operation before oldest are evicted. */
const MAX_QUEUE_SIZE = 500;

// ─── GPS Point Queue Item ───────────────────────────────────
interface QueuedPoint {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: string; // ISO 8601
  source: PositionSource;
}

// ─── Network Information API ────────────────────────────────
// Detect WiFi vs cellular vs ethernet using the Network Information API.
// Used to adapt tracking behavior for in-vehicle WiFi / mobile hotspots.
function getConnectionType(): ConnectionType {
  try {
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (!conn) return 'unknown';
    const type = conn.type; // 'wifi', 'cellular', 'ethernet', 'none', etc.
    if (type === 'wifi') return 'wifi';
    if (type === 'cellular') return 'cellular';
    if (type === 'ethernet') return 'ethernet';
    if (type === 'none') return 'none';
    // effectiveType gives '4g', '3g', '2g', 'slow-2g' — implies cellular
    if (!type && conn.effectiveType) return 'cellular';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Infer position source from accuracy: GPS <50m, WiFi 50–300m, IP >300m */
function inferPositionSource(accuracy: number | null, connType: ConnectionType): PositionSource {
  if (accuracy == null) return 'unknown';
  if (accuracy <= 50) return 'gps';
  if (accuracy <= 300) return 'wifi';
  return 'ip';
}

// ─── Haversine Distance (meters) ────────────────────────────
/** Calculate distance between two lat/lng points in meters. */
function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── localStorage GPS Failover Queue ─────────────────────
const LS_GPS_QUEUE_KEY = 'rmpg_gps_failover_queue';
const LS_MAX_QUEUED_POINTS = 100;

function loadFailoverQueue(): QueuedPoint[] {
  try {
    const raw = localStorage.getItem(LS_GPS_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-LS_MAX_QUEUED_POINTS) : [];
  } catch {
    return [];
  }
}

function saveFailoverQueue(points: QueuedPoint[]): void {
  try {
    localStorage.setItem(LS_GPS_QUEUE_KEY, JSON.stringify(points.slice(-LS_MAX_QUEUED_POINTS)));
  } catch {
    // localStorage full or unavailable — degrade gracefully
  }
}

function clearFailoverQueue(): void {
  try {
    localStorage.removeItem(LS_GPS_QUEUE_KEY);
  } catch {
    // ignore
  }
}

/** How long (ms) without a position callback before heartbeat restarts watchPosition */
const HEARTBEAT_STALE_THRESHOLD = 30000; // 30 seconds
/** Shorter stale threshold on WiFi — vehicle WiFi is less reliable */
const HEARTBEAT_STALE_THRESHOLD_WIFI = 15000; // 15 seconds
/** How often to check for stale GPS (ms) */
const HEARTBEAT_INTERVAL = 15000; // 15 seconds

// ─── Electron Desktop Detection ──────────────────────────────
// Desktop Electron apps often lack GPS hardware. Chromium's
// navigator.geolocation may silently fail even with the Google API
// key set. We detect Electron and provide an IP-based fallback.
const IS_ELECTRON = typeof window !== 'undefined' && !!(window as any).electron?.isElectron;

export function useGpsTracking(options?: UseGpsTrackingOptions) {
  const {
    batchIntervalMs = DEFAULT_BATCH_INTERVAL,
    highAccuracy = true,
    maxAccuracyMeters = DEFAULT_MAX_ACCURACY,
    maxSpeedMs = DEFAULT_MAX_SPEED,
  } = options || {};

  // GPS is ALWAYS tracking — mandatory for all users
  const [isTracking, setIsTracking] = useState<boolean>(false);

  const [state, setState] = useState<Omit<GpsState, 'isTracking'>>({
    latitude: null,
    longitude: null,
    accuracy: null,
    heading: null,
    speed: null,
    lastSentAt: null,
    error: null,
    isSupported: typeof navigator !== 'undefined' && 'geolocation' in navigator,
    unitCallSign: null,
    unitId: null,
    permissionDenied: false,
    permissionPending: false,
    connectionType: getConnectionType(),
    positionSource: 'unknown',
  });

  const watchIdRef = useRef<number | null>(null);
  const batchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Timestamp of last received position callback — used by heartbeat */
  const lastCallbackTimeRef = useRef<number>(Date.now());

  // ─── Electron IP fallback ────────────────────────────────
  const ipFallbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Network-change restart timer — stored so it can be cleared on unmount
  const networkChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Point queue ──────────────────────────────────────────
  // Every watchPosition callback pushes here. The batch interval drains it.
  const queueRef = useRef<QueuedPoint[]>([]);
  // Track the last accepted point for jump detection
  const lastAcceptedRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  // Keep the latest position for UI display (real-time dot on map)
  const latestPositionRef = useRef<QueuedPoint | null>(null);
  // Flag: send first position immediately for real-time icon placement
  const firstPositionSentRef = useRef(false);
  // GPS source: 'browser' (default) or 'clearpathgps' (hardware tracker manages position)
  const gpsSourceRef = useRef<string>('browser');

  // Fetch the user's assigned unit on mount
  useEffect(() => {
    apiFetch<{ id: number; call_sign: string; status: string; gps_source?: string } | null>('/dispatch/gps/my-unit')
      .then((unit) => {
        if (unit) {
          setState((prev) => ({ ...prev, unitCallSign: unit.call_sign, unitId: unit.id }));
          gpsSourceRef.current = unit.gps_source || 'browser';
        }
      })
      .catch(() => {
        // User may not have a unit assigned — that's fine, GPS still mandatory
      });
  }, []);

  // ─── Batch send ───────────────────────────────────────────
  // Drains the queue and POSTs all collected points to the server.
  // On failure, persists points to localStorage so they survive page reloads.
  const sendBatch = useCallback(async () => {
    // Skip POST when a hardware GPS tracker (ClearPathGPS) is managing this unit's position
    if (gpsSourceRef.current === 'clearpathgps') {
      queueRef.current = [];
      clearFailoverQueue();
      return;
    }

    // Merge any previously failed points from localStorage
    const failoverPoints = loadFailoverQueue();
    const currentPoints = queueRef.current;
    const allPoints = [...failoverPoints, ...currentPoints];
    if (allPoints.length === 0) return;

    // Snapshot and clear — if the send fails, persist to localStorage
    queueRef.current = [];

    try {
      await apiFetch('/dispatch/gps', {
        method: 'POST',
        body: JSON.stringify({ points: allPoints, device_type: IS_DESKTOP ? 'desktop' : 'mobile' }),
      });
      // Success — clear the failover queue
      clearFailoverQueue();
      setState((prev) => ({
        ...prev,
        lastSentAt: new Date().toISOString(),
        error: null,
      }));
    } catch (err) {
      // Re-enqueue current points in memory (capped), persist to localStorage
      queueRef.current = [...currentPoints, ...queueRef.current].slice(-MAX_QUEUE_SIZE);
      saveFailoverQueue(allPoints.slice(-LS_MAX_QUEUED_POINTS));
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to send GPS position',
      }));
    }
  }, []);

  // ─── Send single position immediately (for first fix) ────
  const sendImmediate = useCallback(async (point: QueuedPoint) => {
    // Skip POST when a hardware GPS tracker is managing this unit's position
    if (gpsSourceRef.current === 'clearpathgps') return;

    try {
      await apiFetch('/dispatch/gps', {
        method: 'POST',
        body: JSON.stringify({ points: [point], device_type: IS_DESKTOP ? 'desktop' : 'mobile' }),
      });
      setState((prev) => ({
        ...prev,
        lastSentAt: new Date().toISOString(),
        error: null,
      }));
    } catch {
      // Will be retried in next batch
      queueRef.current.push(point);
    }
  }, []);

  // ─── GPS point filter ────────────────────────────────────
  // Returns true if the point should be accepted into the queue.
  const shouldAcceptPoint = useCallback((
    lat: number, lng: number, accuracy: number | null,
  ): boolean => {
    // 1. Accuracy gate — reject low-quality readings
    if (accuracy !== null && accuracy > maxAccuracyMeters) {
      return false;
    }

    // 2. Jump detection — reject teleportation artifacts
    const last = lastAcceptedRef.current;
    if (last) {
      const now = Date.now();
      const dtSeconds = (now - last.time) / 1000;
      if (dtSeconds > 0) {
        const distance = haversineMeters(last.lat, last.lng, lat, lng);
        const impliedSpeed = distance / dtSeconds; // m/s
        if (impliedSpeed > maxSpeedMs) {
          return false;
        }
      }
    }

    return true;
  }, [maxAccuracyMeters, maxSpeedMs]);

  // ─── Electron IP Geolocation Fallback ──────────────────────
  // When navigator.geolocation fails on desktop Electron (no GPS
  // hardware), poll the main process for IP-based geolocation.
  const tryIpFallback = useCallback(async () => {
    if (!IS_ELECTRON) return;
    try {
      const loc = await (window as any).electron.getIpLocation();
      if (!loc || loc.latitude == null) return;

      // Feed heartbeat so it doesn't trigger restart loops
      lastCallbackTimeRef.current = Date.now();

      const connType = getConnectionType();

      // Update UI state exactly like a normal geolocation callback
      setState((prev) => ({
        ...prev,
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy || 5000,
        heading: null,
        speed: null,
        error: null,
        permissionDenied: false,
        permissionPending: false,
        connectionType: connType,
        positionSource: 'ip',
      }));

      // Queue the point for batch send
      const point: QueuedPoint = {
        lat: loc.latitude,
        lng: loc.longitude,
        accuracy: loc.accuracy || 5000,
        heading: null,
        speed: null,
        timestamp: new Date().toISOString(),
        source: 'ip',
      };

      if (shouldAcceptPoint(loc.latitude, loc.longitude, loc.accuracy || 5000)) {
        lastAcceptedRef.current = { lat: loc.latitude, lng: loc.longitude, time: Date.now() };
        latestPositionRef.current = point;
        queueRef.current.push(point);
        if (queueRef.current.length > MAX_QUEUE_SIZE) {
          queueRef.current = queueRef.current.slice(-MAX_QUEUE_SIZE);
        }

        // Send first position immediately for map icon
        if (!firstPositionSentRef.current) {
          firstPositionSentRef.current = true;
          sendImmediate(point);
        }
      }
    } catch {
      // IP fallback failed — degrade gracefully
    }
  }, [shouldAcceptPoint, sendImmediate]);

  // Starts the periodic IP fallback poller (Electron desktop only)
  const startIpFallbackPoller = useCallback(() => {
    if (!IS_ELECTRON || ipFallbackIntervalRef.current) return;
    devLog('[GPS] Browser geolocation unavailable — starting IP fallback poller');
    tryIpFallback(); // Immediate first attempt
    ipFallbackIntervalRef.current = setInterval(tryIpFallback, DEFAULT_BATCH_INTERVAL);
  }, [tryIpFallback]);

  // Start tracking
  const startTracking = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState((prev) => ({
        ...prev,
        error: 'Geolocation not supported by this browser',
        permissionPending: false,
      }));
      return;
    }

    // Clean up any existing tracking to prevent stacking intervals on recursive restarts
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (batchIntervalRef.current !== null) {
      clearInterval(batchIntervalRef.current);
      batchIntervalRef.current = null;
    }
    if (heartbeatRef.current !== null) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    setState((prev) => ({ ...prev, permissionPending: true, permissionDenied: false }));
    firstPositionSentRef.current = false;

    // Start watching position — fires on every GPS update (~1/second)
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy, heading, speed } = position.coords;

        // Update heartbeat timestamp — proves watchPosition is still delivering
        lastCallbackTimeRef.current = Date.now();

        // Detect connection type and infer position source
        const connType = getConnectionType();
        const source = inferPositionSource(accuracy, connType);

        // Update UI state (always, even if filtered from queue)
        setState((prev) => ({
          ...prev,
          latitude,
          longitude,
          accuracy,
          heading,
          speed,
          error: null,
          permissionDenied: false,
          permissionPending: false,
          connectionType: connType,
          positionSource: source,
        }));

        // Filter — only queue good points
        if (!shouldAcceptPoint(latitude, longitude, accuracy)) {
          return;
        }

        const point: QueuedPoint = {
          lat: latitude,
          lng: longitude,
          accuracy,
          heading,
          speed,
          timestamp: new Date().toISOString(),
          source,
        };

        // Update tracking refs
        lastAcceptedRef.current = { lat: latitude, lng: longitude, time: Date.now() };
        latestPositionRef.current = point;

        // Queue for next batch — cap at MAX_QUEUE_SIZE to prevent
        // unbounded memory growth during prolonged network outages
        queueRef.current.push(point);
        if (queueRef.current.length > MAX_QUEUE_SIZE) {
          queueRef.current = queueRef.current.slice(-MAX_QUEUE_SIZE);
        }

        // Send first position immediately for real-time map icon
        if (!firstPositionSentRef.current) {
          firstPositionSentRef.current = true;
          sendImmediate(point);
        }
      },
      (err) => {
        let msg = 'GPS error';
        let denied = false;
        switch (err.code) {
          case err.PERMISSION_DENIED:
            msg = 'Location permission denied. You MUST enable location access to use RMPG Flex.';
            denied = true;
            break;
          case err.POSITION_UNAVAILABLE:
            msg = 'Location unavailable. Check GPS/location services.';
            // On desktop Electron without GPS hardware, start IP fallback
            startIpFallbackPoller();
            break;
          case err.TIMEOUT:
            msg = 'Location request timed out. Retrying...';
            // On desktop Electron, start IP fallback in case GPS never resolves
            startIpFallbackPoller();
            break;
        }
        setState((prev) => ({
          ...prev,
          error: msg,
          permissionDenied: denied,
          permissionPending: false,
        }));

        // If denied, retry every 10 seconds in case user changes permission
        if (denied) {
          if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = setTimeout(() => {
            navigator.geolocation.getCurrentPosition(
              () => {
                // Permission restored — restart tracking
                stopTracking();
                startTracking();
              },
              () => {
                // Still denied — keep retrying
                retryTimeoutRef.current = setTimeout(() => {
                  stopTracking();
                  startTracking();
                }, 15000);
              },
              { timeout: 5000 }
            );
          }, 10000);
        }
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout: 20000,      // 20s — generous for WiFi/vehicle networks
        maximumAge: 5000,    // Accept positions up to 5s old (helps on WiFi gaps)
      }
    );
    watchIdRef.current = watchId;

    // Start batch send interval
    const interval = setInterval(sendBatch, batchIntervalMs);
    batchIntervalRef.current = interval;

    // Start heartbeat — detects when watchPosition stops delivering callbacks
    // (common on mobile when OS reclaims resources or GPS hardware sleeps).
    // Uses a shorter threshold on WiFi since vehicle WiFi is less stable.
    lastCallbackTimeRef.current = Date.now();
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      const staleDuration = Date.now() - lastCallbackTimeRef.current;
      const connType = getConnectionType();
      const threshold = connType === 'wifi' ? HEARTBEAT_STALE_THRESHOLD_WIFI : HEARTBEAT_STALE_THRESHOLD;
      if (staleDuration > threshold && watchIdRef.current !== null) {
        console.warn(`[GPS] No position callback in ${Math.round(staleDuration / 1000)}s (connection: ${connType})`);
        // On Electron desktop, use IP fallback instead of endlessly restarting
        if (IS_ELECTRON) {
          startIpFallbackPoller();
          return;
        }
        // Clear the stale watch and restart — forces re-acquisition on WiFi networks
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
        stopTracking();
        startTracking();
      }
    }, HEARTBEAT_INTERVAL);

    setIsTracking(true);
  }, [batchIntervalMs, highAccuracy, sendBatch, sendImmediate, shouldAcceptPoint, startIpFallbackPoller]);

  // Stop tracking (internal use only — users cannot call this)
  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (batchIntervalRef.current !== null) {
      clearInterval(batchIntervalRef.current);
      batchIntervalRef.current = null;
    }
    if (retryTimeoutRef.current !== null) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (heartbeatRef.current !== null) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (ipFallbackIntervalRef.current !== null) {
      clearInterval(ipFallbackIntervalRef.current);
      ipFallbackIntervalRef.current = null;
    }
    // Flush any remaining points before stopping
    if (queueRef.current.length > 0) {
      sendBatch();
    }
    setIsTracking(false);
  }, [sendBatch]);

  // Toggle is now a no-op — GPS is mandatory, but we keep the function
  // for backward compatibility (the button in the toolbar is now just a status indicator)
  const toggleTracking = useCallback(() => {
    // GPS is mandatory — cannot be toggled off
    // If not tracking, try to restart
    if (!isTracking) {
      startTracking();
    }
  }, [isTracking, startTracking]);

  // AUTO-START on mount — GPS is mandatory for all logged-in users
  useEffect(() => {
    startTracking();
    return () => {
      // Cleanup on unmount
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (batchIntervalRef.current !== null) {
        clearInterval(batchIntervalRef.current);
        batchIntervalRef.current = null;
      }
      if (retryTimeoutRef.current !== null) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      if (heartbeatRef.current !== null) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (ipFallbackIntervalRef.current !== null) {
        clearInterval(ipFallbackIntervalRef.current);
        ipFallbackIntervalRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-start tracking when app returns to foreground (handles mobile app resume)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !isTracking) {
        startTracking();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isTracking, startTracking]);

  // ─── Network change listener ────────────────────────────────
  // When the device switches between WiFi ↔ cellular (e.g., entering/leaving
  // a vehicle with in-vehicle WiFi), watchPosition may silently stop delivering
  // callbacks. Listen for connection changes and proactively restart tracking
  // to force re-acquisition on the new network.
  useEffect(() => {
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (!conn) return;

    let prevType = conn.type || conn.effectiveType || 'unknown';

    const handleNetworkChange = () => {
      const newType = conn.type || conn.effectiveType || 'unknown';
      const newConnType = getConnectionType();
      devLog(`[GPS] Network changed: ${prevType} → ${newType} (${newConnType})`);
      setState((prev) => ({ ...prev, connectionType: newConnType }));

      // Flush any queued points before restarting
      if (queueRef.current.length > 0) {
        sendBatch();
      }

      // Restart watchPosition to force re-acquisition on the new network
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      // Short delay to let the new network stabilize, then restart
      if (networkChangeTimerRef.current) clearTimeout(networkChangeTimerRef.current);
      networkChangeTimerRef.current = setTimeout(() => {
        networkChangeTimerRef.current = null;
        stopTracking();
        startTracking();
      }, 1000);

      prevType = newType;
    };

    conn.addEventListener('change', handleNetworkChange);
    return () => {
      conn.removeEventListener('change', handleNetworkChange);
      if (networkChangeTimerRef.current) {
        clearTimeout(networkChangeTimerRef.current);
        networkChangeTimerRef.current = null;
      }
    };
  }, [sendBatch, stopTracking, startTracking]);

  // ─── Online/offline listener ───────────────────────────────
  // Handle browser online/offline events (covers WiFi disconnect/reconnect)
  useEffect(() => {
    const handleOnline = () => {
      devLog('[GPS] Browser online — restarting tracking');
      setState((prev) => ({ ...prev, connectionType: getConnectionType() }));
      if (!isTracking) {
        startTracking();
      }
    };
    const handleOffline = () => {
      devLog('[GPS] Browser offline — queueing locally');
      setState((prev) => ({ ...prev, connectionType: 'none' }));
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isTracking, startTracking]);

  // Request WakeLock to prevent device sleep from interrupting GPS tracking
  // (supported on Chrome Android, Chrome Desktop, Edge, etc.)
  useEffect(() => {
    let wakeLock: any = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
          wakeLock.addEventListener('release', () => {
            // Re-acquire on release (e.g., when user switches tabs then comes back)
          });
        }
      } catch {
        // WakeLock not available or permission denied — degrade gracefully
      }
    };

    requestWakeLock();

    // Re-acquire wake lock when page becomes visible again
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') requestWakeLock();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wakeLock) wakeLock.release().catch(() => {});
    };
  }, []);

  return {
    ...state,
    isTracking,
    startTracking,
    stopTracking,
    toggleTracking,
  };
}
