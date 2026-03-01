import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';

// ============================================================
// GPS Tracking Hook — True 1-Second Breadcrumb Collection
//
// Guarantees one GPS point per second by combining:
//  1. watchPosition (fires whenever the GPS hardware has new data)
//  2. A 1-second interval timer that emits either the latest
//     watchPosition reading, or an interpolated/held position
//
// Smoothing: exponential moving average (EMA) reduces GPS jitter
// while preserving genuine movement. Stationary detection snaps
// to the centroid when the device isn't moving.
//
// MANDATORY MODE: GPS tracking is ALWAYS ON for all logged-in
// users. Location sharing cannot be disabled. A blocking overlay
// is shown if the user denies location permission.
// ============================================================

export interface GpsState {
  /** Whether GPS tracking is actively running */
  isTracking: boolean;
  /** Current smoothed latitude */
  latitude: number | null;
  /** Current smoothed longitude */
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
  /** Actual GPS data rate (points per second measured) */
  dataRate: number;
}

interface UseGpsTrackingOptions {
  /** Interval in ms between batch sends to server (default: 5000 = 5s) */
  batchIntervalMs?: number;
  /** Enable high-accuracy GPS (uses more battery) */
  highAccuracy?: boolean;
  /** Maximum accuracy in meters — points above this are discarded (default: 150) */
  maxAccuracyMeters?: number;
  /** Maximum plausible speed in m/s for jump detection (default: 90 = ~200 mph) */
  maxSpeedMs?: number;
}

// ─── Constants ──────────────────────────────────────────────

/** How often to batch-send collected points to the server */
const DEFAULT_BATCH_INTERVAL = 5000;
/** Reject GPS readings less accurate than this (meters) */
const DEFAULT_MAX_ACCURACY = 150;
/** Reject points implying movement faster than this (m/s). 90 m/s ~ 200 mph */
const DEFAULT_MAX_SPEED = 90;
/** EMA smoothing factor: 0.3 = responsive to movement, still dampens jitter */
const EMA_ALPHA = 0.3;
/** If device moves less than this (meters) in 3 seconds, consider stationary */
const STATIONARY_THRESHOLD = 3;
/** Number of seconds to check for stationary state */
const STATIONARY_WINDOW = 3;
/** Max points to hold in queue before force-sending (5 min of 1/sec data) */
const MAX_QUEUE_SIZE = 300;
/** 1-second tick rate for guaranteed data collection */
const TICK_INTERVAL = 1000;

// ─── GPS Point Queue Item ───────────────────────────────────
interface QueuedPoint {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: string; // ISO 8601
}

// ─── Raw GPS reading from the browser ───────────────────────
interface RawReading {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  time: number; // Date.now()
}

// ─── Haversine Distance (meters) ────────────────────────────
function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Linear interpolation helper ────────────────────────────
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function useGpsTracking(options?: UseGpsTrackingOptions) {
  const {
    batchIntervalMs = DEFAULT_BATCH_INTERVAL,
    highAccuracy = true,
    maxAccuracyMeters = DEFAULT_MAX_ACCURACY,
    maxSpeedMs = DEFAULT_MAX_SPEED,
  } = options || {};

  const [isTracking, setIsTracking] = useState(false);

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
    permissionPending: true,
    dataRate: 0,
  });

  const watchIdRef = useRef<number | null>(null);
  const batchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Core tracking refs ───────────────────────────────────
  // Points queued for the next batch send
  const queueRef = useRef<QueuedPoint[]>([]);
  // Latest raw reading from watchPosition (unsmoothed)
  const latestRawRef = useRef<RawReading | null>(null);
  // EMA-smoothed position
  const smoothedRef = useRef<{ lat: number; lng: number } | null>(null);
  // Last accepted point for jump detection
  const lastAcceptedRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  // Recent positions for stationary detection (last N seconds)
  const recentPositionsRef = useRef<Array<{ lat: number; lng: number; time: number }>>([]);
  // Is the device currently stationary?
  const isStationaryRef = useRef(false);
  // Stationary centroid when detected
  const stationaryCentroidRef = useRef<{ lat: number; lng: number } | null>(null);
  // Data rate tracking
  const tickCountRef = useRef(0);
  const dataRateWindowRef = useRef<number[]>([]);
  // First position flag
  const firstPositionSentRef = useRef(false);
  // Last tick time for interpolation
  const lastTickTimeRef = useRef(0);
  // Previous raw reading for interpolation between readings
  const prevRawRef = useRef<RawReading | null>(null);

  // Fetch the user's assigned unit on mount
  useEffect(() => {
    apiFetch<{ id: number; call_sign: string; status: string } | null>('/dispatch/gps/my-unit')
      .then((unit) => {
        if (unit) {
          setState((prev) => ({ ...prev, unitCallSign: unit.call_sign, unitId: unit.id }));
        }
      })
      .catch(() => {});
  }, []);

  // ─── Batch send ───────────────────────────────────────────
  const sendBatch = useCallback(async () => {
    const points = queueRef.current;
    if (points.length === 0) return;

    // Snapshot and clear
    queueRef.current = [];

    try {
      // Server accepts max 60 points per request. Split if needed.
      for (let i = 0; i < points.length; i += 60) {
        const chunk = points.slice(i, i + 60);
        await apiFetch('/dispatch/gps', {
          method: 'POST',
          body: JSON.stringify({ points: chunk }),
        });
      }
      setState((prev) => ({
        ...prev,
        lastSentAt: new Date().toISOString(),
        error: null,
      }));
    } catch (err) {
      // Re-enqueue failed points (prepend so order is maintained)
      queueRef.current = [...points, ...queueRef.current];
      // Cap queue to prevent memory leak
      if (queueRef.current.length > MAX_QUEUE_SIZE) {
        queueRef.current = queueRef.current.slice(-MAX_QUEUE_SIZE);
      }
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to send GPS position',
      }));
    }
  }, []);

  // ─── Send first position immediately ──────────────────────
  const sendImmediate = useCallback(async (point: QueuedPoint) => {
    try {
      await apiFetch('/dispatch/gps', {
        method: 'POST',
        body: JSON.stringify({ points: [point] }),
      });
      setState((prev) => ({
        ...prev,
        lastSentAt: new Date().toISOString(),
        error: null,
      }));
    } catch {
      queueRef.current.push(point);
    }
  }, []);

  // ─── EMA Smoothing ────────────────────────────────────────
  // Applies exponential moving average to reduce GPS jitter.
  // Alpha controls responsiveness: higher = more responsive but noisier.
  const smoothPosition = useCallback((rawLat: number, rawLng: number): { lat: number; lng: number } => {
    if (!smoothedRef.current) {
      // First reading — no smoothing possible
      smoothedRef.current = { lat: rawLat, lng: rawLng };
      return { lat: rawLat, lng: rawLng };
    }

    // If stationary, snap to centroid
    if (isStationaryRef.current && stationaryCentroidRef.current) {
      return { ...stationaryCentroidRef.current };
    }

    // EMA: smoothed = alpha * raw + (1 - alpha) * previous_smoothed
    const lat = EMA_ALPHA * rawLat + (1 - EMA_ALPHA) * smoothedRef.current.lat;
    const lng = EMA_ALPHA * rawLng + (1 - EMA_ALPHA) * smoothedRef.current.lng;

    smoothedRef.current = { lat, lng };
    return { lat, lng };
  }, []);

  // ─── Stationary Detection ─────────────────────────────────
  // Checks if all recent positions are within STATIONARY_THRESHOLD meters.
  // If so, snaps to the centroid to eliminate jitter while stopped.
  const updateStationaryState = useCallback((lat: number, lng: number) => {
    const now = Date.now();
    recentPositionsRef.current.push({ lat, lng, time: now });

    // Keep only the last STATIONARY_WINDOW seconds
    const cutoff = now - STATIONARY_WINDOW * 1000;
    recentPositionsRef.current = recentPositionsRef.current.filter(p => p.time >= cutoff);

    // Need at least 2 seconds of data to determine
    if (recentPositionsRef.current.length < 2) {
      isStationaryRef.current = false;
      return;
    }

    // Calculate max spread from first point
    const first = recentPositionsRef.current[0];
    let maxDist = 0;
    for (const p of recentPositionsRef.current) {
      const d = haversineMeters(first.lat, first.lng, p.lat, p.lng);
      if (d > maxDist) maxDist = d;
    }

    if (maxDist <= STATIONARY_THRESHOLD) {
      isStationaryRef.current = true;
      // Calculate centroid
      let sumLat = 0, sumLng = 0;
      for (const p of recentPositionsRef.current) {
        sumLat += p.lat;
        sumLng += p.lng;
      }
      const n = recentPositionsRef.current.length;
      stationaryCentroidRef.current = { lat: sumLat / n, lng: sumLng / n };
    } else {
      isStationaryRef.current = false;
      stationaryCentroidRef.current = null;
    }
  }, []);

  // ─── Jump Detection ───────────────────────────────────────
  const isJump = useCallback((lat: number, lng: number): boolean => {
    const last = lastAcceptedRef.current;
    if (!last) return false;

    const now = Date.now();
    const dtSeconds = (now - last.time) / 1000;
    if (dtSeconds <= 0) return false;

    const distance = haversineMeters(last.lat, last.lng, lat, lng);
    const impliedSpeed = distance / dtSeconds;
    return impliedSpeed > maxSpeedMs;
  }, [maxSpeedMs]);

  // ─── 1-Second Tick: The Heart of Guaranteed Collection ────
  // This runs every second regardless of watchPosition. It either:
  //  - Uses the latest raw reading if it arrived within the last 1.5s
  //  - Interpolates between the previous and latest reading
  //  - Holds the last known position if GPS is lagging
  const onTick = useCallback(() => {
    const now = Date.now();
    const raw = latestRawRef.current;

    if (!raw) return; // No GPS fix yet

    let pointLat: number;
    let pointLng: number;
    let pointAccuracy = raw.accuracy;
    let pointHeading = raw.heading;
    let pointSpeed = raw.speed;

    const rawAge = now - raw.time;

    if (rawAge < 1500) {
      // Fresh reading (< 1.5 seconds old) — use it directly with smoothing
      const smoothed = smoothPosition(raw.lat, raw.lng);
      pointLat = smoothed.lat;
      pointLng = smoothed.lng;
    } else if (prevRawRef.current && rawAge < 5000) {
      // GPS is lagging (1.5–5s since last raw update)
      // Interpolate between prev and current based on estimated motion
      const prev = prevRawRef.current;
      const totalDt = raw.time - prev.time;
      if (totalDt > 0 && raw.speed !== null && raw.speed > 0.5) {
        // Moving — extrapolate slightly forward based on heading/speed
        const extrapolateSec = rawAge / 1000;
        const headingRad = raw.heading !== null
          ? (raw.heading * Math.PI) / 180
          : Math.atan2(raw.lng - prev.lng, raw.lat - prev.lat);
        const distMeters = raw.speed * extrapolateSec;
        const dLat = (distMeters * Math.cos(headingRad)) / 111320;
        const dLng = (distMeters * Math.sin(headingRad)) / (111320 * Math.cos(raw.lat * Math.PI / 180));
        const smoothed = smoothPosition(raw.lat + dLat, raw.lng + dLng);
        pointLat = smoothed.lat;
        pointLng = smoothed.lng;
      } else {
        // Stationary or no speed data — hold position
        const smoothed = smoothPosition(raw.lat, raw.lng);
        pointLat = smoothed.lat;
        pointLng = smoothed.lng;
      }
    } else {
      // Very stale (>5s) — hold last known position
      const smoothed = smoothedRef.current || { lat: raw.lat, lng: raw.lng };
      pointLat = smoothed.lat;
      pointLng = smoothed.lng;
    }

    // Update stationary detection
    updateStationaryState(raw.lat, raw.lng);

    // Create the 1-second point
    const point: QueuedPoint = {
      lat: Math.round(pointLat * 1e7) / 1e7, // 7 decimal places (~1cm precision)
      lng: Math.round(pointLng * 1e7) / 1e7,
      accuracy: pointAccuracy !== null ? Math.round(pointAccuracy * 10) / 10 : null,
      heading: pointHeading !== null ? Math.round(pointHeading * 10) / 10 : null,
      speed: pointSpeed !== null ? Math.round(pointSpeed * 100) / 100 : null,
      timestamp: new Date(now).toISOString(),
    };

    // Queue it
    queueRef.current.push(point);

    // Update last accepted
    lastAcceptedRef.current = { lat: pointLat, lng: pointLng, time: now };
    lastTickTimeRef.current = now;

    // Update data rate counter
    tickCountRef.current++;

    // Calculate data rate every 10 seconds
    dataRateWindowRef.current.push(now);
    const rateWindow = 10000;
    dataRateWindowRef.current = dataRateWindowRef.current.filter(t => t >= now - rateWindow);
    if (dataRateWindowRef.current.length > 1) {
      const elapsed = (now - dataRateWindowRef.current[0]) / 1000;
      if (elapsed > 0) {
        const rate = Math.round((dataRateWindowRef.current.length / elapsed) * 10) / 10;
        setState(prev => ({ ...prev, dataRate: rate }));
      }
    }

    // Update UI with smoothed position
    setState(prev => ({
      ...prev,
      latitude: pointLat,
      longitude: pointLng,
      accuracy: pointAccuracy,
      heading: pointHeading,
      speed: pointSpeed,
    }));

    // Send first position immediately for real-time map icon placement
    if (!firstPositionSentRef.current) {
      firstPositionSentRef.current = true;
      sendImmediate(point);
    }

    // Safety: if queue is getting too large, force a send
    if (queueRef.current.length >= 55) {
      sendBatch();
    }
  }, [smoothPosition, updateStationaryState, sendImmediate, sendBatch]);

  // ─── Start Tracking ───────────────────────────────────────
  const startTracking = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState(prev => ({
        ...prev,
        error: 'Geolocation not supported by this browser',
        permissionPending: false,
      }));
      return;
    }

    setState(prev => ({ ...prev, permissionPending: true, permissionDenied: false }));
    firstPositionSentRef.current = false;
    tickCountRef.current = 0;
    dataRateWindowRef.current = [];

    // watchPosition: fires whenever the GPS hardware has a new reading
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy, heading, speed } = position.coords;

        // Accuracy gate
        if (accuracy > maxAccuracyMeters) return;

        // Jump detection
        if (isJump(latitude, longitude)) return;

        // Store as latest raw reading
        prevRawRef.current = latestRawRef.current;
        latestRawRef.current = {
          lat: latitude,
          lng: longitude,
          accuracy,
          heading,
          speed,
          time: Date.now(),
        };

        // Clear permission state on first success
        setState(prev => ({
          ...prev,
          error: null,
          permissionDenied: false,
          permissionPending: false,
        }));
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
            break;
          case err.TIMEOUT:
            msg = 'Location request timed out. Retrying...';
            break;
        }
        setState(prev => ({
          ...prev,
          error: msg,
          permissionDenied: denied,
          permissionPending: false,
        }));

        // If denied, retry every 10 seconds
        if (denied) {
          if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = setTimeout(() => {
            navigator.geolocation.getCurrentPosition(
              () => {
                stopTracking();
                startTracking();
              },
              () => {
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
        timeout: 10000,
        maximumAge: 0, // Always fresh — never use cached position
      }
    );
    watchIdRef.current = watchId;

    // 1-second tick: guarantees exactly 1 point per second
    const tickId = setInterval(onTick, TICK_INTERVAL);
    tickIntervalRef.current = tickId;

    // Batch send interval: drains queue to server
    const batchId = setInterval(sendBatch, batchIntervalMs);
    batchIntervalRef.current = batchId;

    setIsTracking(true);
  }, [batchIntervalMs, highAccuracy, maxAccuracyMeters, isJump, onTick, sendBatch]);

  // ─── Stop Tracking ────────────────────────────────────────
  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (tickIntervalRef.current !== null) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    if (batchIntervalRef.current !== null) {
      clearInterval(batchIntervalRef.current);
      batchIntervalRef.current = null;
    }
    if (retryTimeoutRef.current !== null) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    // Flush remaining points
    if (queueRef.current.length > 0) {
      sendBatch();
    }
    setIsTracking(false);
  }, [sendBatch]);

  // Toggle — GPS is mandatory, but can restart if stopped
  const toggleTracking = useCallback(() => {
    if (!isTracking) {
      startTracking();
    }
  }, [isTracking, startTracking]);

  // AUTO-START on mount — GPS is mandatory
  useEffect(() => {
    startTracking();
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (tickIntervalRef.current !== null) {
        clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = null;
      }
      if (batchIntervalRef.current !== null) {
        clearInterval(batchIntervalRef.current);
        batchIntervalRef.current = null;
      }
      if (retryTimeoutRef.current !== null) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-start tracking when app returns to foreground
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !isTracking) {
        startTracking();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isTracking, startTracking]);

  // WakeLock: prevent device sleep from interrupting GPS
  useEffect(() => {
    let wakeLock: any = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch {
        // WakeLock not available — degrade gracefully
      }
    };

    requestWakeLock();

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
