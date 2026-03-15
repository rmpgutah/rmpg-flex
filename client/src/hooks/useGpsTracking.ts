import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';

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
/** How often to batch-send collected points to the server (5 seconds).
 *  Shorter interval = better real-time tracking on dispatch map.
 *  At ~1 position/second, each batch carries ~5 points. */
const DEFAULT_BATCH_INTERVAL = 5000;

/** Whether the current device is likely a desktop/laptop (no GPS hardware).
 *  Used to relax accuracy thresholds — WiFi positioning on desktops in moving
 *  vehicles typically returns 100–500m accuracy. */
const IS_DESKTOP = typeof window !== 'undefined' && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

/** Reject GPS readings less accurate than this (meters).
 *  Mobile (GPS hardware): 100m — modern phones get 3-15m; 100m filters WiFi junk.
 *  Desktop (WiFi only):   500m — WiFi triangulation in moving vehicles gives
 *  100–300m typically; 500m cap rejects wild cell-tower estimates. */
const DEFAULT_MAX_ACCURACY = IS_DESKTOP ? 500 : 100;
/** Reject points that imply movement faster than this (m/s). 80 m/s ≈ 179 mph */
const DEFAULT_MAX_SPEED = 80;
/** Minimum distance (meters) between queued points — suppresses stationary jitter.
 *  GPS hardware drifts ±1-3m when still; this threshold prevents filling the
 *  queue with noise while the officer is parked or on foot at a scene. */
const MIN_QUEUE_DISTANCE = 3;

/** Accuracy threshold (meters) above which we apply WiFi smoothing.
 *  When connected via mobile hotspot, WiFi positioning can jump 50-300m between
 *  updates. Smoothing blends new readings with the last good position. */
const WIFI_SMOOTHING_THRESHOLD = 30;

/** Smoothing factor for WiFi readings (0-1). Lower = smoother but laggier.
 *  0.3 means 30% new reading + 70% previous — reduces jumps by ~70%. */
const WIFI_SMOOTHING_ALPHA = 0.3;

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

// ─── Compute Bearing (degrees) ──────────────────────────────
/** Calculate initial bearing from point A to point B (0–360°). */
function computeBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
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

  // ─── Point queue ──────────────────────────────────────────
  // Every watchPosition callback pushes here. The batch interval drains it.
  const queueRef = useRef<QueuedPoint[]>([]);
  /** Maximum in-memory queue size — prevents unbounded growth if sends fail */
  const MAX_QUEUE_SIZE = 500;
  // Track the last accepted point for jump detection
  const lastAcceptedRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  // Keep the latest position for UI display (real-time dot on map)
  const latestPositionRef = useRef<QueuedPoint | null>(null);
  // Flag: send first position immediately for real-time icon placement
  const firstPositionSentRef = useRef(false);
  // Track unitId via ref so sendBatch (empty deps) can read the latest value
  const unitIdRef = useRef<number | null>(null);
  /** Heartbeat restart counter — prevents infinite restart loops */
  const heartbeatRestartCountRef = useRef(0);
  const MAX_HEARTBEAT_RESTARTS = 5;
  /** GPS source for unit — 'browser' (default) or 'clearpathgps' (external tracker) */
  const gpsSourceRef = useRef<string>('browser');

  // Fetch the user's assigned unit on mount
  useEffect(() => {
    apiFetch<{ id: number; call_sign: string; status: string; gps_source?: string } | null>('/dispatch/gps/my-unit')
      .then((unit) => {
        if (unit) {
          unitIdRef.current = unit.id;
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
  const isSendingRef = useRef(false);
  const sendBatch = useCallback(async () => {
    // Guard against concurrent sends (interval can fire while await is pending)
    if (isSendingRef.current) return;
    isSendingRef.current = true;

    try {
      // Merge any previously failed points from localStorage
      const failoverPoints = loadFailoverQueue();
      const currentPoints = [...queueRef.current]; // snapshot copy, not reference
      const allPoints = [...failoverPoints, ...currentPoints];
      if (allPoints.length === 0) return;

      // Clear — new points arriving during await go into fresh array
      queueRef.current = [];

      try {
        await apiFetch('/dispatch/gps', {
          method: 'POST',
          body: JSON.stringify({ points: allPoints, device_type: IS_DESKTOP ? 'desktop' : 'mobile' }),
        });
        // Success — clear the failover queue
        clearFailoverQueue();
        // Check if we need to fetch unit info using ref (avoids stale closure from empty deps)
        const needsUnitFetch = !unitIdRef.current;
        setState((prev) => ({
          ...prev,
          lastSentAt: new Date().toISOString(),
          error: null,
        }));
        // If we didn't have a unit before, the server may have auto-created one.
        // Re-fetch unit info so the status bar shows the call sign.
        if (needsUnitFetch) {
          apiFetch<{ id: number; call_sign: string; status: string } | null>('/dispatch/gps/my-unit')
            .then((unit) => {
              if (unit) {
                unitIdRef.current = unit.id;
                setState((p) => ({ ...p, unitCallSign: unit.call_sign, unitId: unit.id }));
              }
            })
            .catch(() => {});
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Failed to send GPS position';
        console.warn(`[GPS] Batch send failed (${allPoints.length} pts):`, errMsg);
        // Re-enqueue failed points in front of any new arrivals
        queueRef.current = [...currentPoints, ...queueRef.current];
        saveFailoverQueue(allPoints.slice(-LS_MAX_QUEUED_POINTS));
        setState((prev) => ({
          ...prev,
          error: errMsg,
        }));
      }
    } finally {
      isSendingRef.current = false;
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

    const last = lastAcceptedRef.current;
    if (last) {
      const now = Date.now();
      const dtSeconds = (now - last.time) / 1000;
      const distance = haversineMeters(last.lat, last.lng, lat, lng);

      // 2. Minimum distance — suppress stationary GPS jitter (±1-3m drift)
      //    But always accept if >30 seconds have passed (periodic heartbeat point)
      if (distance < MIN_QUEUE_DISTANCE && dtSeconds < 30) {
        return false;
      }

      // 3. Jump detection — reject teleportation artifacts
      if (dtSeconds > 0) {
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

      // Queue the point for batch send.
      // IP geolocation is low-accuracy (~1-5km) but it's the only option when
      // navigator.geolocation fails on desktop. Cap reported accuracy at 5000m.
      const ipAccuracy = Math.min(loc.accuracy || 5000, 5000);
      const point: QueuedPoint = {
        lat: loc.latitude,
        lng: loc.longitude,
        accuracy: ipAccuracy,
        heading: null,
        speed: null,
        timestamp: new Date().toISOString(),
        source: 'ip',
      };

      // IP fallback uses a relaxed accuracy gate — it's low-quality but better
      // than no position data at all. Jump detection still applies.
      const last = lastAcceptedRef.current;
      let acceptIp = true;
      if (last) {
        const dtSeconds = (Date.now() - last.time) / 1000;
        if (dtSeconds > 0) {
          const distance = haversineMeters(last.lat, last.lng, loc.latitude, loc.longitude);
          if (distance / dtSeconds > maxSpeedMs) acceptIp = false;
        }
      }

      if (acceptIp) {
        lastAcceptedRef.current = { lat: loc.latitude, lng: loc.longitude, time: Date.now() };
        latestPositionRef.current = point;
        queueRef.current.push(point);

        // Send first position immediately for map icon
        if (!firstPositionSentRef.current) {
          firstPositionSentRef.current = true;
          sendImmediate(point);
        }
      }
    } catch {
      // IP fallback failed — degrade gracefully
    }
  }, [maxSpeedMs, sendImmediate]);

  // Starts the periodic IP fallback poller (Electron desktop only)
  const startIpFallbackPoller = useCallback(() => {
    if (!IS_ELECTRON || ipFallbackIntervalRef.current) return;
    console.log('[GPS] Browser geolocation unavailable — starting IP fallback poller');
    tryIpFallback(); // Immediate first attempt
    ipFallbackIntervalRef.current = setInterval(tryIpFallback, DEFAULT_BATCH_INTERVAL);
  }, [tryIpFallback]);

  // ─── Internal cleanup ──────────────────────────────────────
  // Shared by stopTracking and startTracking's error handlers.
  // Defined BEFORE both so there's no temporal dead zone issue.
  const cleanupTracking = useCallback((flush = true) => {
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
    if (flush && queueRef.current.length > 0) {
      sendBatch();
    }
  }, [sendBatch]);

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

    setState((prev) => ({ ...prev, permissionPending: true, permissionDenied: false }));
    firstPositionSentRef.current = false;

    // Start watching position — fires on every GPS update (~1/second)
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy, heading, speed } = position.coords;

        // Update heartbeat timestamp — proves watchPosition is still delivering
        lastCallbackTimeRef.current = Date.now();
        // Reset restart counter on successful callback
        heartbeatRestartCountRef.current = 0;

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

        // ── WiFi smoothing for mobile hotspot connections ──
        // When accuracy is >30m (WiFi/cell, not GPS hardware), the position can
        // jump 50-300m between updates due to BSSID database staleness on mobile
        // hotspots. Blend with previous known good position to dampen jumps.
        let smoothLat = latitude;
        let smoothLng = longitude;
        const lastPt = lastAcceptedRef.current;
        if (lastPt && accuracy != null && accuracy > WIFI_SMOOTHING_THRESHOLD) {
          const dist = haversineMeters(lastPt.lat, lastPt.lng, latitude, longitude);
          // Only smooth if the jump is significant but not extreme (extreme = real movement)
          // Small jumps (<10m) don't need smoothing; large jumps (>500m) are probably real movement
          if (dist > 10 && dist < 500) {
            const alpha = WIFI_SMOOTHING_ALPHA;
            smoothLat = lastPt.lat + alpha * (latitude - lastPt.lat);
            smoothLng = lastPt.lng + alpha * (longitude - lastPt.lng);
          }
        }

        // WiFi positioning doesn't provide heading/speed — compute from movement
        let effectiveHeading = heading;
        let effectiveSpeed = speed;
        if (lastPt && (heading == null || speed == null)) {
          const dtSec = (Date.now() - lastPt.time) / 1000;
          const dist = haversineMeters(lastPt.lat, lastPt.lng, smoothLat, smoothLng);
          // Only compute if we've moved a meaningful distance (avoid jitter)
          if (dist > 5 && dtSec > 0) {
            if (heading == null) effectiveHeading = computeBearing(lastPt.lat, lastPt.lng, smoothLat, smoothLng);
            if (speed == null) effectiveSpeed = dist / dtSec;
          }
        }

        const point: QueuedPoint = {
          lat: smoothLat,
          lng: smoothLng,
          accuracy,
          heading: effectiveHeading,
          speed: effectiveSpeed,
          timestamp: new Date().toISOString(),
          source,
        };

        // Update tracking refs (use smoothed coordinates for continuity)
        lastAcceptedRef.current = { lat: smoothLat, lng: smoothLng, time: Date.now() };
        latestPositionRef.current = point;

        // Queue for next batch (cap at MAX_QUEUE_SIZE to prevent unbounded growth)
        if (queueRef.current.length >= MAX_QUEUE_SIZE) {
          queueRef.current = queueRef.current.slice(-Math.floor(MAX_QUEUE_SIZE / 2));
        }
        queueRef.current.push(point);

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

        // If denied, probe every 30 seconds in case user re-grants permission
        // (non-recursive — just a probe, not a full restart cascade)
        if (denied) {
          if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
          const probePermission = () => {
            retryTimeoutRef.current = setTimeout(() => {
              navigator.geolocation.getCurrentPosition(
                () => {
                  // Permission restored — restart tracking (once)
                  cleanupTracking(false);
                  startTracking();
                },
                () => {
                  // Still denied — schedule another probe (not recursive startTracking)
                  probePermission();
                },
                { timeout: 5000 }
              );
            }, 30000);
          };
          probePermission();
        }
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout: 10000,      // 10s — faster retry on poor signal
        maximumAge: 1000,    // Accept positions up to 1s old (fresh fixes only)
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
        // Cap restart attempts to prevent infinite restart loops
        heartbeatRestartCountRef.current++;
        if (heartbeatRestartCountRef.current > MAX_HEARTBEAT_RESTARTS) {
          console.error('[GPS] Max heartbeat restarts reached, stopping restart attempts');
          setState((prev) => ({ ...prev, error: 'GPS signal lost. Refresh the page to retry.' }));
          return;
        }
        // Clear the stale watch and restart
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
        cleanupTracking(false);
        startTracking();
      }
    }, HEARTBEAT_INTERVAL);

    setIsTracking(true);
  }, [batchIntervalMs, highAccuracy, sendBatch, sendImmediate, shouldAcceptPoint, startIpFallbackPoller, cleanupTracking]);

  // Stop tracking (internal use only — users cannot call this)
  const stopTracking = useCallback(() => {
    cleanupTracking(true); // flush queue
    setIsTracking(false);
  }, [cleanupTracking]);

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
      // Flush remaining points and clean up all timers/watchers
      cleanupTracking(true);
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
      console.log(`[GPS] Network changed: ${prevType} → ${newType} (${newConnType})`);
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
      if (networkRestartTimer) clearTimeout(networkRestartTimer);
      networkRestartTimer = setTimeout(() => {
        networkRestartTimer = null;
        stopTracking();
        startTracking();
      }, 1000);

      prevType = newType;
    };

    let networkRestartTimer: ReturnType<typeof setTimeout> | null = null;
    conn.addEventListener('change', handleNetworkChange);
    return () => {
      conn.removeEventListener('change', handleNetworkChange);
      if (networkRestartTimer) clearTimeout(networkRestartTimer);
    };
  }, [sendBatch, stopTracking, startTracking]);

  // ─── Online/offline listener ───────────────────────────────
  // Handle browser online/offline events (covers WiFi disconnect/reconnect)
  useEffect(() => {
    const handleOnline = () => {
      console.log('[GPS] Browser online — restarting tracking');
      setState((prev) => ({ ...prev, connectionType: getConnectionType() }));
      if (!isTracking) {
        startTracking();
      }
    };
    const handleOffline = () => {
      console.log('[GPS] Browser offline — queueing locally');
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
