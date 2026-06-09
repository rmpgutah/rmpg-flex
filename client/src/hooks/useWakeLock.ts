// ============================================================
// useWakeLock — keep the Drive screen awake while Drive Mode is active
//
// Requests a Screen Wake Lock while `active` is true and re-acquires it on
// `visibilitychange` (the browser auto-releases the lock when the tab is
// hidden, so we must re-request when it returns to the foreground).
//
// Clean feature-detect fallback: when navigator.wakeLock is unsupported the
// hook is a no-op and `active` stays false. Exposes manual request/release
// for callers that want explicit control (e.g. a "keep awake" toggle).
//
// NOTE: This is a distinct, Drive-Mode-owned hook from the app-wide
// useScreenWakeLock — it adds an exposed { active, request, release } API
// and an `enabled` gate. It does not modify or replace that hook.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseWakeLockResult {
  /** True while a wake-lock sentinel is currently held. */
  active: boolean;
  /** Manually (re)acquire the lock. Safe to call repeatedly. */
  request: () => Promise<void>;
  /** Manually release the lock. */
  release: () => Promise<void>;
}

function isSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export function useWakeLock(enabled: boolean = true): UseWakeLockResult {
  const sentinelRef = useRef<any>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [active, setActive] = useState(false);

  const release = useCallback(async () => {
    const s = sentinelRef.current;
    sentinelRef.current = null;
    setActive(false);
    if (s) {
      try { await s.release(); } catch { /* benign */ }
    }
  }, []);

  const request = useCallback(async () => {
    if (!isSupported()) return;
    if (!enabledRef.current) return;
    if (sentinelRef.current) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    try {
      const s = await (navigator as any).wakeLock.request('screen');
      sentinelRef.current = s;
      setActive(true);
      if (typeof s.addEventListener === 'function') {
        s.addEventListener('release', () => {
          sentinelRef.current = null;
          setActive(false);
        });
      }
    } catch {
      // NotAllowedError (no user activation / battery saver) → stay inactive.
      sentinelRef.current = null;
      setActive(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupported()) return;

    if (enabled) {
      void request();
    } else {
      void release();
    }

    const onVisibility = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        enabledRef.current &&
        !sentinelRef.current
      ) {
        void request();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      void release();
    };
  }, [enabled, request, release]);

  return { active, request, release };
}

export default useWakeLock;
