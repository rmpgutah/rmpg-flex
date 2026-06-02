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
  /** Heading in degrees (0-360, null if unavailable) — raw device heading. */
  heading: number | null;
  /** Heading smoothed with a circular low-pass + course-over-ground fallback,
   *  so the directional arrow doesn't jitter when stationary or heading is null. */
  headingSmoothed: number | null;
  /** Course over ground (deg) derived from consecutive fixes when the device
   *  actually moved — independent of the (often-null) device compass heading. */
  course: number | null;
  /** Speed in m/s (null if unavailable) */
  speed: number | null;
  /** Number of fixes captured into the exportable session track (0 when capture off). */
  capturedCount: number;
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
  /**
   * READ-ONLY mode. When false, the hook still watches the device position
   * (live latitude/longitude/heading/speed for the UI, plus my-unit info) but
   * NEVER uploads breadcrumbs to the server. Use this for a *second* consumer
   * on a page where Layout's always-mounted tracker already owns the upload —
   * e.g. live turn-by-turn nav — so we don't double-POST GPS. Default: true.
   */
  upload?: boolean;
  /**
   * Record every accepted fix into an in-memory session track that can be
   * exported (CSV / GeoJSON). Off by default so the always-on Layout tracker
   * doesn't accumulate; the map opts in so the operator can capture/export the
   * track they drove. Default: false.
   */
  capture?: boolean;
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

// ─── Heading math (course-over-ground + smoothing) ──────────
/** Initial great-circle bearing (deg, 0=N) from point 1 to point 2. */
function bearingBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2), Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Circular low-pass: nudge `prev` toward `next` by `alpha` along the SHORTEST
 *  arc, so 350°→10° crosses through 0° instead of sweeping backward. */
function blendAngle(prev: number | null, next: number, alpha: number): number {
  if (prev == null || !isFinite(prev)) return next;
  const diff = ((next - prev + 540) % 360) - 180; // shortest signed delta
  return (((prev + alpha * diff) % 360) + 360) % 360;
}

// ─── Haversine Distance (meters) ────────────────────────────
/** Calculate distance between two lat/lng points in meters. */
function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return Infinity;
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
/**
 * Cap on how far the stale-watch restart cadence backs off once we've already
 * restarted MAX_HEARTBEAT_RESTARTS times without a single successful callback.
 * This kills the perpetual ~30s restart loop on a STATIONARY non-Electron
 * device (e.g. a fixed dispatch console whose browser never re-fires
 * watchPosition) — the watchdog keeps retrying, but progressively less often,
 * up to base × this factor (30s → 5 min on cellular, 15s → 2.5 min on WiFi).
 * A single real fix resets heartbeatRestartCountRef to 0 (success handler),
 * instantly collapsing the backoff so a field unit regaining signal resumes
 * the aggressive base cadence with no penalty.
 */
const MAX_HEARTBEAT_BACKOFF_FACTOR = 10;

// ─── Electron Desktop Detection ──────────────────────────────
// Desktop Electron apps often lack GPS hardware. Chromium's
// navigator.geolocation may silently fail even with the Google API
// key set. We detect Electron and provide an IP-based fallback.
const IS_ELECTRON = typeof window !== 'undefined' && !!(window as any).electron?.isElectron;

// ─── Panasonic Toughbook Internal GPS ─────────────────────────
// Toughbooks ship a u-blox NEO-M8N (or similar) on an internal
// virtual COM port. When detected, we bypass navigator.geolocation
// entirely and stream raw NMEA fixes from the Electron main process.
// See desktop/internalGps.js for the parser.
const IS_WINDOWS_ELECTRON =
  IS_ELECTRON && (window as any).electron?.platform === 'win32';

export function useGpsTracking(options?: UseGpsTrackingOptions) {
  const {
    batchIntervalMs = DEFAULT_BATCH_INTERVAL,
    highAccuracy = true,
    maxAccuracyMeters = DEFAULT_MAX_ACCURACY,
    maxSpeedMs = DEFAULT_MAX_SPEED,
    upload = true,
    capture = false,
  } = options || {};

  // Read in the POST helpers (empty-deps useCallbacks) so a read-only consumer
  // never uploads. Kept in a ref so toggling the option doesn't re-create them.
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  const captureEnabledRef = useRef(capture);
  captureEnabledRef.current = capture;

  // GPS is ALWAYS tracking — mandatory for all users
  const [isTracking, setIsTracking] = useState<boolean>(false);

  const [state, setState] = useState<Omit<GpsState, 'isTracking'>>({
    latitude: null,
    longitude: null,
    accuracy: null,
    heading: null,
    headingSmoothed: null,
    course: null,
    speed: null,
    capturedCount: 0,
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
  // Exportable session track (opt-in via `capture`). Capped ring buffer.
  const captureRef = useRef<QueuedPoint[]>([]);
  const MAX_CAPTURE = 10000;
  // Last smoothed heading for the circular low-pass filter.
  const smoothedHeadingRef = useRef<number | null>(null);
  // Flag: send first position immediately for real-time icon placement
  const firstPositionSentRef = useRef(false);
  // Track unitId via ref so sendBatch (empty deps) can read the latest value
  const unitIdRef = useRef<number | null>(null);
  /** Heartbeat restart counter — prevents infinite restart loops */
  const heartbeatRestartCountRef = useRef(0);
  const MAX_HEARTBEAT_RESTARTS = 5;
  /** GPS source for unit — 'browser' (default) or 'clearpathgps' (external tracker) */
  const gpsSourceRef = useRef<string>('browser');
  /** True once we've confirmed the host is a Toughbook (FZ-55) with a live
   *  internal GPS stream. Internal NMEA is PRIMARY; navigator.geolocation
   *  continues to run as a SECONDARY fallback for when GPS lock is lost
   *  (e.g., officer steps inside a concrete building). */
  const useInternalGpsRef = useRef<boolean>(false);
  /** Timestamp (ms) of the last internal-GPS fix. The browser geolocation
   *  callback skips ingestion when this is recent — prevents 200m WiFi
   *  triangulation from polluting the queue while hardware GPS is healthy. */
  const lastInternalGpsAtRef = useRef<number>(0);
  /** How fresh internal GPS must be (ms) before browser fixes are ignored.
   *  15s: u-blox modules can lose lock briefly under bridges or in tunnels;
   *  this gives the browser fallback room to fill the gap. */
  const INTERNAL_GPS_FRESH_MS = 15000;

  // Fetch the user's assigned unit on mount
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ id: number; call_sign: string; status: string; gps_source?: string } | null>('/dispatch/gps/my-unit')
      .then((unit) => {
        if (unit && !cancelled) {
          unitIdRef.current = unit.id;
          setState((prev) => ({ ...prev, unitCallSign: unit.call_sign, unitId: unit.id }));
          gpsSourceRef.current = unit.gps_source || 'browser';
        }
      })
      .catch((err) => {
        console.warn('[useGpsTracking] Unit fetch failed (user may not have a unit assigned):', err);
      });
    return () => { cancelled = true; };
  }, []);

  // ─── Batch send ───────────────────────────────────────────
  // Drains the queue and POSTs all collected points to the server.
  // On failure, persists points to localStorage so they survive page reloads.
  const isSendingRef = useRef(false);
  const mountedRef = useRef(true);
  const sendBatch = useCallback(async () => {
    // Read-only consumer — never upload; drain the queue so it can't grow.
    if (!uploadRef.current) { queueRef.current = []; return; }
    // Guard against concurrent sends (interval can fire while await is pending)
    if (isSendingRef.current) return;
    isSendingRef.current = true;

    try {
      // Merge any previously failed points from localStorage with the live
      // queue, deduping by (timestamp, lat, lng). The failover queue and the
      // in-memory queue can hold the SAME breadcrumb after a failed send (the
      // catch below persists `allPoints` to localStorage AND re-queues the
      // in-memory points), so a naive concat would re-insert duplicates on
      // reconnect — compounding the double-insert this audit (GPS-3) fixes.
      const failoverPoints = loadFailoverQueue();
      const currentPoints = [...queueRef.current]; // snapshot copy, not reference
      const seen = new Set<string>();
      const dedupeKey = (p: QueuedPoint) => `${p.timestamp}|${p.lat}|${p.lng}`;
      const allPoints: QueuedPoint[] = [];
      for (const p of [...failoverPoints, ...currentPoints]) {
        const k = dedupeKey(p);
        if (seen.has(k)) continue;
        seen.add(k);
        allPoints.push(p);
      }
      if (allPoints.length === 0) {
        // Nothing to send — but stale failover entries may linger if every
        // point was a duplicate already covered in-memory. Leave them; the
        // catch path owns failover persistence.
        return;
      }

      // Clear — new points arriving during await go into fresh array
      queueRef.current = [];

      try {
        const result = await apiFetch<{ error?: unknown } | null>('/dispatch/gps', {
          method: 'POST',
          body: JSON.stringify({ points: allPoints, device_type: IS_DESKTOP ? 'desktop' : 'mobile' }),
        });
        // A 200 that carries an error body (e.g. D1 momentarily locked) means
        // the points were NOT persisted. apiFetch already throws on non-2xx, so
        // this only adds the 200-with-error case — without it we'd clear the
        // failover queue and silently drop those breadcrumbs. Throwing routes
        // into the catch below, which re-enqueues both the in-memory and
        // failover queues. (Audit item A.)
        if (result && typeof result === 'object' && (result as { error?: unknown }).error) {
          throw new Error(`GPS upload reported error: ${String((result as { error?: unknown }).error)}`);
        }
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
              if (unit && mountedRef.current) {
                unitIdRef.current = unit.id;
                setState((p) => ({ ...p, unitCallSign: unit.call_sign, unitId: unit.id }));
              }
            })
            .catch((err) => { console.warn('[useGpsTracking] fetch my-unit failed:', err); });
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
  // The caller (ingestPosition / watchPosition) has ALREADY pushed `point` onto
  // queueRef before invoking this. On a successful immediate POST we therefore
  // must REMOVE that exact point from the queue, or the next sendBatch re-sends
  // it — every breadcrumb would land in gps_breadcrumbs twice (Audit GPS-3).
  // On failure we leave it queued (it's already there) so the batch retries it.
  const sendImmediate = useCallback(async (point: QueuedPoint) => {
    // Read-only consumer — never upload.
    if (!uploadRef.current) return;
    // Skip POST when a hardware GPS tracker is managing this unit's position
    if (gpsSourceRef.current === 'clearpathgps') return;

    try {
      await apiFetch('/dispatch/gps', {
        method: 'POST',
        body: JSON.stringify({ points: [point], device_type: IS_DESKTOP ? 'desktop' : 'mobile' }),
      });
      // Sent exactly once — drop this point from the batch queue so sendBatch
      // doesn't re-POST the same breadcrumb. Identity match by reference (the
      // queued object IS this object), with a (timestamp,lat,lng) fallback in
      // case the queue was sliced/copied between push and send.
      queueRef.current = queueRef.current.filter(
        (p) => p !== point && !(p.timestamp === point.timestamp && p.lat === point.lat && p.lng === point.lng),
      );
      setState((prev) => ({
        ...prev,
        lastSentAt: new Date().toISOString(),
        error: null,
      }));
    } catch (err) {
      // Leave the point in the queue (the caller already pushed it) so the next
      // batch retries it. Only re-push if it somehow isn't present anymore.
      console.warn('[useGpsTracking] Immediate GPS send failed, will retry in next batch:', err);
      const stillQueued = queueRef.current.some(
        (p) => p === point || (p.timestamp === point.timestamp && p.lat === point.lat && p.lng === point.lng),
      );
      if (!stillQueued) queueRef.current.push(point);
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
    } catch (err) {
      console.warn('[useGpsTracking] IP geolocation fallback failed:', err);
    }
  }, [maxSpeedMs, sendImmediate]);

  // Starts the periodic IP fallback poller (Electron desktop only)
  const startIpFallbackPoller = useCallback(() => {
    if (!IS_ELECTRON || ipFallbackIntervalRef.current) return;
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
    // Flush any remaining points before stopping (fire-and-forget with error guard)
    if (flush && queueRef.current.length > 0) {
      sendBatch().catch(() => { /* cleanup — ignore send failures */ });
    }
  }, [sendBatch]);

  // ─── Shared position ingestion ───────────────────────────
  // Used by BOTH navigator.geolocation.watchPosition (browser path) AND
  // the Electron internal-GPS IPC stream (Toughbook path). Keeps a single
  // filter/smooth/queue pipeline so both sources behave identically downstream.
  const ingestPosition = useCallback((coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    heading: number | null;
    speed: number | null;
    sourceHint?: PositionSource;
    fromInternalGps?: boolean;
  }) => {
    const { latitude, longitude, accuracy, heading, speed } = coords;

    // Browser geolocation is SECONDARY when internal GPS is active and fresh.
    // Skip browser fixes if a Toughbook NMEA reading arrived within the
    // freshness window — 5m hardware GPS beats 200m WiFi triangulation.
    if (!coords.fromInternalGps && useInternalGpsRef.current) {
      const sinceInternal = Date.now() - lastInternalGpsAtRef.current;
      if (sinceInternal < INTERNAL_GPS_FRESH_MS) return;
    }

    if (coords.fromInternalGps) {
      lastInternalGpsAtRef.current = Date.now();
    }

    lastCallbackTimeRef.current = Date.now();
    heartbeatRestartCountRef.current = 0;

    const connType = getConnectionType();
    // Internal NMEA is always 'gps' regardless of network type
    const source = coords.sourceHint ?? inferPositionSource(accuracy, connType);

    // ── Directional output: course-over-ground + smoothed heading ──
    // Device compass `heading` is frequently null (desktop/WiFi) and noisy at
    // low speed. Derive course from movement between accepted fixes, prefer the
    // device heading only while genuinely moving, and run the result through a
    // circular low-pass so the on-screen arrow glides instead of snapping.
    const prevAccepted = lastAcceptedRef.current;
    let course: number | null = null;
    if (prevAccepted) {
      const movedM = haversineMeters(prevAccepted.lat, prevAccepted.lng, latitude, longitude);
      if (movedM >= 3) course = bearingBetween(prevAccepted.lat, prevAccepted.lng, latitude, longitude);
    }
    const moving = speed != null && speed > 1.5;
    const headingCandidate = heading != null && (moving || course == null) ? heading : (course ?? heading);
    const headingSmoothed = headingCandidate != null
      ? blendAngle(smoothedHeadingRef.current, headingCandidate, 0.35)
      : smoothedHeadingRef.current;
    smoothedHeadingRef.current = headingSmoothed;

    const accepted = shouldAcceptPoint(latitude, longitude, accuracy);
    let capturedCountNext = captureRef.current.length;

    if (accepted) {
      const point: QueuedPoint = {
        lat: latitude,
        lng: longitude,
        accuracy,
        heading,
        speed,
        timestamp: new Date().toISOString(),
        source,
      };

      lastAcceptedRef.current = { lat: latitude, lng: longitude, time: Date.now() };
      latestPositionRef.current = point;

      if (queueRef.current.length >= MAX_QUEUE_SIZE) {
        queueRef.current = queueRef.current.slice(-Math.floor(MAX_QUEUE_SIZE / 2));
      }
      queueRef.current.push(point);

      // Opt-in exportable session track (separate from the upload queue, which
      // gets drained on every batch send).
      if (captureEnabledRef.current) {
        if (captureRef.current.length >= MAX_CAPTURE) captureRef.current.shift();
        captureRef.current.push(point);
        capturedCountNext = captureRef.current.length;
      }

      if (!firstPositionSentRef.current) {
        firstPositionSentRef.current = true;
        sendImmediate(point);
      }
    }

    setState((prev) => ({
      ...prev,
      latitude,
      longitude,
      accuracy,
      heading,
      headingSmoothed,
      course,
      speed,
      capturedCount: capturedCountNext,
      error: null,
      permissionDenied: false,
      permissionPending: false,
      connectionType: connType,
      positionSource: source,
    }));
  }, [shouldAcceptPoint, sendImmediate]);

  // ─── Toughbook internal GPS subscription ─────────────────
  // Detect on mount; if it's a Toughbook with a live COM port, start the
  // native NMEA reader and bypass navigator.geolocation entirely.
  useEffect(() => {
    if (!IS_WINDOWS_ELECTRON) return;
    const electron = (window as any).electron;
    if (!electron?.detectInternalGps) return;

    let unsubUpdate: (() => void) | null = null;
    let unsubError: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const detected = await electron.detectInternalGps();
        if (cancelled) return;
        if (!detected?.isToughbook || !detected?.portPath) {
          console.debug('[useGpsTracking] Not a Toughbook or no GPS port — using navigator.geolocation');
          return;
        }
        const result = await electron.startInternalGps({ portPath: detected.portPath });
        if (cancelled) return;
        if (!result?.ok) {
          console.warn('[useGpsTracking] Internal GPS failed to start, falling back to navigator.geolocation:', result?.error);
          return;
        }
        console.debug('[useGpsTracking] Internal GPS active on', detected.portPath, '— navigator.geolocation disabled');
        useInternalGpsRef.current = true;
        setIsTracking(true);
        setState((prev) => ({ ...prev, permissionPending: false, permissionDenied: false }));

        unsubUpdate = electron.onInternalGpsUpdate((pos: any) => {
          ingestPosition({
            latitude: pos.latitude,
            longitude: pos.longitude,
            accuracy: pos.accuracy ?? null,
            heading: pos.heading ?? null,
            speed: pos.speed ?? null,
            sourceHint: 'gps',
            fromInternalGps: true,
          });
        });
        unsubError = electron.onInternalGpsError((err: any) => {
          console.warn('[useGpsTracking] Internal GPS error:', err?.message);
          setState((prev) => ({ ...prev, error: `Internal GPS: ${err?.message || 'unknown error'}` }));
        });
        // No need to start the batch interval here — startTracking() runs
        // in parallel (browser fallback path) and owns the batch send timer.
      } catch (err) {
        console.warn('[useGpsTracking] Internal GPS detection error:', err);
      }
    })();

    return () => {
      cancelled = true;
      if (unsubUpdate) unsubUpdate();
      if (unsubError) unsubError();
      if (useInternalGpsRef.current && electron?.stopInternalGps) {
        electron.stopInternalGps().catch(() => { /* shutting down */ });
      }
    };
  }, [ingestPosition]);

  // Start tracking
  const startTracking = useCallback(() => {
    // On Toughbook FZ-55, internal NMEA is primary but navigator.geolocation
    // also runs as a SECONDARY fallback — when GPS lock is lost (concrete
    // buildings, parking garages), WiFi triangulation fills the gap.
    // ingestPosition gates browser fixes via lastInternalGpsAtRef.
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
            // Guard against orphaned timers firing after unmount
            if (!mountedRef.current) return;
            retryTimeoutRef.current = setTimeout(() => {
              if (!mountedRef.current) return;
              navigator.geolocation.getCurrentPosition(
                () => {
                  if (!mountedRef.current) return;
                  // Permission restored — restart tracking (once)
                  cleanupTracking(false);
                  startTracking();
                },
                () => {
                  if (!mountedRef.current) return;
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
        // Freshness-first tuning for cellular field devices. The old 10s
        // timeout fired the error callback before a weak-signal fix could
        // land — and the error path never bumps lastCallbackTimeRef, so the
        // heartbeat went stale and tore the watch down in a restart loop
        // (symptom: "No position callback in 31/45/83s"). 27s sits just under
        // HEARTBEAT_STALE_THRESHOLD (30s) so a slow fix has time to arrive
        // before the watchdog restarts.
        timeout: 27000,
        // Keep positions current (≤3s old) — still a touch more tolerant than
        // the old 1s, which forced a cold hardware acquisition on every tick.
        maximumAge: 3000,
      }
    );
    watchIdRef.current = watchId;

    // Start batch send interval (skip entirely for read-only consumers).
    if (uploadRef.current) {
      const interval = setInterval(sendBatch, batchIntervalMs);
      batchIntervalRef.current = interval;
    }

    // Start heartbeat — detects when watchPosition stops delivering callbacks
    // (common on mobile when OS reclaims resources or GPS hardware sleeps).
    // Uses a shorter threshold on WiFi since vehicle WiFi is less stable.
    lastCallbackTimeRef.current = Date.now();
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      const staleDuration = Date.now() - lastCallbackTimeRef.current;
      const connType = getConnectionType();
      const baseThreshold = connType === 'wifi' ? HEARTBEAT_STALE_THRESHOLD_WIFI : HEARTBEAT_STALE_THRESHOLD;
      // Back off the restart cadence once we've already restarted several times
      // with no successful callback in between. The first MAX_HEARTBEAT_RESTARTS
      // restarts stay at the aggressive base cadence (intentional for vehicles on
      // a brief signal drop); beyond that, the threshold grows geometrically up
      // to base × MAX_HEARTBEAT_BACKOFF_FACTOR so a stationary desktop console no
      // longer tears down + recreates the watch every 30s forever. A single real
      // fix resets heartbeatRestartCountRef to 0, collapsing this immediately.
      const overshoot = Math.max(0, heartbeatRestartCountRef.current - MAX_HEARTBEAT_RESTARTS);
      const backoffFactor = Math.min(2 ** overshoot, MAX_HEARTBEAT_BACKOFF_FACTOR);
      const threshold = baseThreshold * backoffFactor;
      if (staleDuration >= threshold && watchIdRef.current !== null) {
        // Throttle log noise: warn while still in the aggressive phase, then
        // drop to debug so a perpetually-stale console doesn't flood the log.
        const log = heartbeatRestartCountRef.current >= MAX_HEARTBEAT_RESTARTS ? console.debug : console.warn;
        log(`[GPS] No position callback in ${Math.round(staleDuration / 1000)}s (connection: ${connType})`);
        // On Electron desktop, use IP fallback instead of endlessly restarting
        if (IS_ELECTRON) {
          startIpFallbackPoller();
          return;
        }
        // Track restart count for state UI but NEVER stop trying — vehicle CADs
        // can't be expected to refresh manually, and a quiet GPS hardware reset
        // (cellular hand-off, ignition cycle, OS power-save) can take many minutes.
        heartbeatRestartCountRef.current++;
        if (heartbeatRestartCountRef.current > MAX_HEARTBEAT_RESTARTS) {
          // Surface the degradation to UI but keep retrying.
          setState((prev) => ({ ...prev, error: `GPS signal stale (${Math.round(staleDuration / 1000)}s) — auto-retrying…` }));
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

  // AUTO-START on first user gesture — modern browsers gate Geolocation
  // (and WakeLock) behind a user-activation token. Calling watchPosition on
  // mount without a gesture causes the browser to silently withhold
  // callbacks (symptom: "No position callback in 45s" watchdog warnings)
  // and emit a "[Violation] geolocation in response to a user gesture" log.
  // We wait for the first click/keydown/touch, then start. If the user has
  // already granted location permission in a prior session, the Permissions
  // API short-circuits the wait so officers don't need to click before GPS
  // resumes.
  useEffect(() => {
    // Reset on (re)mount — refs persist across StrictMode double-mount and
    // route remounts, so without this `mountedRef.current` stays false from
    // a prior unmount and silently disables `setState` guards.
    mountedRef.current = true;

    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      window.removeEventListener('click', start);
      window.removeEventListener('keydown', start);
      window.removeEventListener('touchstart', start);
      startTracking();
    };

    const permApi = (navigator as any).permissions;
    if (permApi?.query) {
      permApi.query({ name: 'geolocation' }).then((res: any) => {
        if (res.state === 'granted') start();
      }).catch(() => { /* Permissions API absent — wait for gesture */ });
    }
    window.addEventListener('click', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
    window.addEventListener('touchstart', start, { once: true });

    return () => {
      mountedRef.current = false;
      window.removeEventListener('click', start);
      window.removeEventListener('keydown', start);
      window.removeEventListener('touchstart', start);
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
    let networkRestartTimer: ReturnType<typeof setTimeout> | null = null;

    const handleNetworkChange = () => {
      const newType = conn.type || conn.effectiveType || 'unknown';
      const newConnType = getConnectionType();
      setState((prev) => ({ ...prev, connectionType: newConnType }));

      // Flush any queued points before restarting (fire-and-forget; restart waits 1s anyway)
      if (queueRef.current.length > 0) {
        sendBatch().catch((e) => console.warn('[GPS] sendBatch on network change failed:', e));
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
      setState((prev) => ({ ...prev, connectionType: getConnectionType() }));
      if (!isTracking) {
        startTracking();
      }
    };
    const handleOffline = () => {
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
    const handleWakeLockRelease = () => {
      // Wake lock released (e.g., user switched tabs) — will re-acquire via visibilitychange
      wakeLock = null;
    };
    const requestWakeLock = async () => {
      // WakeLock requires user-activation context + visible page; otherwise the
      // browser throws NotAllowedError. Skip silently in those cases instead of
      // spamming the console — GPS still works without WakeLock.
      if (!('wakeLock' in navigator)) return;
      if (document.visibilityState !== 'visible') return;
      try {
        wakeLock = await (navigator as any).wakeLock.request('screen');
        wakeLock.addEventListener('release', handleWakeLockRelease);
      } catch (err: any) {
        // NotAllowedError = no user gesture yet; will retry on first user click below.
        if (err?.name !== 'NotAllowedError') {
          console.warn('[useGpsTracking] WakeLock request failed:', err);
        }
      }
    };

    requestWakeLock();

    // Re-acquire wake lock when page becomes visible again, or on first user click.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') requestWakeLock();
    };
    const handleFirstClick = () => {
      requestWakeLock();
      window.removeEventListener('click', handleFirstClick);
      window.removeEventListener('keydown', handleFirstClick);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('click', handleFirstClick, { once: true });
    window.addEventListener('keydown', handleFirstClick, { once: true });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('click', handleFirstClick);
      window.removeEventListener('keydown', handleFirstClick);
      if (wakeLock) {
        wakeLock.removeEventListener('release', handleWakeLockRelease);
        wakeLock.release().catch(() => { /* benign */ });
      }
    };
  }, []);

  // ─── Captured-track accessors / export ───────────────────
  const getCapturedTrack = useCallback((): QueuedPoint[] => captureRef.current.slice(), []);
  const clearCapturedTrack = useCallback(() => {
    captureRef.current = [];
    setState((prev) => ({ ...prev, capturedCount: 0 }));
  }, []);
  /** Serialise the captured session track to a downloadable file payload.
   *  CSV for spreadsheets/evidence, GeoJSON for re-import onto a map. */
  const exportTrack = useCallback((format: 'csv' | 'geojson'): { filename: string; mime: string; content: string } => {
    const pts = captureRef.current;
    const stamp = pts.length ? pts[pts.length - 1].timestamp.replace(/[:.]/g, '-').slice(0, 19) : 'empty';
    if (format === 'geojson') {
      const fc = {
        type: 'FeatureCollection',
        features: pts.map((p) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: { timestamp: p.timestamp, heading: p.heading, speed_ms: p.speed, accuracy_m: p.accuracy, source: p.source },
        })),
      };
      return { filename: `rmpg-track-${stamp}.geojson`, mime: 'application/geo+json', content: JSON.stringify(fc, null, 2) };
    }
    const header = 'timestamp,latitude,longitude,heading_deg,speed_ms,speed_mph,accuracy_m,source';
    const rows = pts.map((p) => [
      p.timestamp, p.lat, p.lng,
      p.heading ?? '', p.speed ?? '', p.speed != null ? (p.speed * 2.237).toFixed(1) : '',
      p.accuracy ?? '', p.source,
    ].join(','));
    return { filename: `rmpg-track-${stamp}.csv`, mime: 'text/csv', content: [header, ...rows].join('\n') };
  }, []);

  return {
    ...state,
    isTracking,
    startTracking,
    stopTracking,
    toggleTracking,
    getCapturedTrack,
    clearCapturedTrack,
    exportTrack,
  };
}
