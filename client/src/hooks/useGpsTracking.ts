import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';

// ============================================================
// GPS Tracking Hook
// Sends the officer's position to the server at a configurable
// interval (default: 15 seconds). Requires browser Geolocation API.
//
// MANDATORY MODE: GPS tracking is ALWAYS ON for all logged-in
// users. Location sharing cannot be disabled. A blocking overlay
// is shown if the user denies location permission.
// ============================================================

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
}

interface UseGpsTrackingOptions {
  /** Interval in milliseconds between server pings (default: 15000 = 15s) */
  intervalMs?: number;
  /** Enable high-accuracy GPS (uses more battery) */
  highAccuracy?: boolean;
}

const DEFAULT_INTERVAL = 30000;

export function useGpsTracking(options?: UseGpsTrackingOptions) {
  const { intervalMs = DEFAULT_INTERVAL, highAccuracy = true } = options || {};

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
    permissionPending: true,
  });

  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestPositionRef = useRef<{ lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null } | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch the user's assigned unit on mount
  useEffect(() => {
    apiFetch<{ id: number; call_sign: string; status: string } | null>('/dispatch/gps/my-unit')
      .then((unit) => {
        if (unit) {
          setState((prev) => ({ ...prev, unitCallSign: unit.call_sign, unitId: unit.id }));
        }
      })
      .catch(() => {
        // User may not have a unit assigned — that's fine, GPS still mandatory
      });
  }, []);

  // Send position to server
  const sendPosition = useCallback(async () => {
    const pos = latestPositionRef.current;
    if (!pos) return;

    try {
      await apiFetch('/dispatch/gps', {
        method: 'POST',
        body: JSON.stringify({
          latitude: pos.lat,
          longitude: pos.lng,
          accuracy: pos.accuracy,
          heading: pos.heading,
          speed: pos.speed,
        }),
      });
      setState((prev) => ({
        ...prev,
        lastSentAt: new Date().toISOString(),
        error: null,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to send GPS position',
      }));
    }
  }, []);

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

    // Start watching position
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy, heading, speed } = position.coords;
        latestPositionRef.current = {
          lat: latitude,
          lng: longitude,
          accuracy,
          heading,
          speed,
        };
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
            // Try once more to see if permission changed
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
        timeout: 10000,
        maximumAge: 5000,
      }
    );
    watchIdRef.current = watchId;

    // Send position immediately, then on interval
    sendPosition();
    const interval = setInterval(sendPosition, intervalMs);
    intervalRef.current = interval;

    setIsTracking(true);
  }, [intervalMs, highAccuracy, sendPosition]);

  // Stop tracking (internal use only — users cannot call this)
  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (retryTimeoutRef.current !== null) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    setIsTracking(false);
  }, []);

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
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (retryTimeoutRef.current !== null) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
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
