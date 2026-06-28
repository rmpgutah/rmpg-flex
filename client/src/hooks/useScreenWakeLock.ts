import { useEffect, useRef } from 'react';

// Holds a Screen Wake Lock while `active` is true and the page is visible.
// Scoped (vs. always-on) per battery-friendliness decision — callers pass
// true while the user is on an active call, the map foreground, or any
// other screen where the display must not sleep.
//
// Wake Lock requires a user-activation token. If `active` flips true
// before the first gesture, we defer acquisition until the first
// click/keydown/touch, then re-acquire on visibility changes.
export function useScreenWakeLock(active: boolean): void {
  const sentinelRef = useRef<any>(null);
  const gestureSeenRef = useRef(false);

  useEffect(() => {
    if (!('wakeLock' in navigator)) return;

    let cancelled = false;

    const release = async () => {
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (s) {
        try { await s.release(); } catch { /* benign */ }
      }
    };

    const acquire = async () => {
      if (cancelled || !active) return;
      if (sentinelRef.current) return;
      if (document.visibilityState !== 'visible') return;
      if (!gestureSeenRef.current) return;
      try {
        const s = await (navigator as any).wakeLock.request('screen');
        if (cancelled) { try { await s.release(); } catch { /* benign */ } return; }
        sentinelRef.current = s;
        s.addEventListener('release', () => { sentinelRef.current = null; });
      } catch (err: any) {
        if (err?.name !== 'NotAllowedError') {
          console.warn('[useScreenWakeLock] request failed:', err);
        }
      }
    };

    const onGesture = () => {
      gestureSeenRef.current = true;
      acquire();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    if (active) {
      acquire(); // Succeeds if a prior gesture already happened
      window.addEventListener('click', onGesture);
      window.addEventListener('keydown', onGesture);
      window.addEventListener('touchstart', onGesture);
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      cancelled = true;
      window.removeEventListener('click', onGesture);
      window.removeEventListener('keydown', onGesture);
      window.removeEventListener('touchstart', onGesture);
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [active]);
}
