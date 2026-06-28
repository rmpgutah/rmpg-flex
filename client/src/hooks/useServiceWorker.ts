import { useEffect, useState, useCallback } from 'react';

// How often to poll for SW updates (2 minutes — forced updates)
// Bumped 2min → 15min 2026-05-05. The aggressive 2-minute interval
// was generating periodic reg.update() pings every two minutes per
// open tab — fine on browser, but Electron felt sluggish from the
// constant SW chatter. 15 minutes is plenty for production deploys.
const UPDATE_CHECK_INTERVAL = 15 * 60 * 1000;

/**
 * Service Worker registration + automatic update detection.
 *
 * Registers the SW on mount, listens for update events,
 * and periodically polls for new SW versions.
 *
 * Returns:
 * - updateAvailable: true when a new SW is waiting to activate
 * - applyUpdate: call this to activate the waiting SW and reload
 */
export function useServiceWorker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  // Apply update — tell waiting SW to activate, then reload the page
  const applyUpdate = useCallback(() => {
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    // Reload after a short delay to let the new SW take over
    setTimeout(() => window.location.reload(), 300);
  }, [registration]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let checkInterval: ReturnType<typeof setInterval> | undefined;
    let unmounted = false;
    let visibilityCheck: (() => void) | undefined;

    const handleControllerChange = () => {
      // The SW controller changed — a new version activated
      // Only reload if the page isn't already reloading
      if (!document.hidden) {
        // The SW_UPDATED message from sw.js will also trigger this
      }
    };

    const registerSW = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', {
          updateViaCache: 'none', // Always check the server for sw.js changes
        });
        setRegistration(reg);

        // If there's already a waiting worker, an update is available
        if (reg.waiting) {
          setUpdateAvailable(true);
        }

        // Listen for new service workers installing
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            // When the new SW is installed and waiting to activate
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              setUpdateAvailable(true);
            }
          });
        });

        // Periodically check for updates (skip if already unmounted)
        if (!unmounted) {
          checkInterval = setInterval(() => {
            reg.update().catch((err) => {
              console.warn('[useServiceWorker] Update check failed:', err);
            });
          }, UPDATE_CHECK_INTERVAL);
        }

        // Also check the moment the tab regains focus / visibility. The 15-min
        // poll alone meant a freshly-deployed change could stay invisible for up
        // to 15 minutes on an already-open console; an operator switching back to
        // the tab now picks up the new bundle right away (debounced to avoid a
        // burst of update() calls when focus + visibility fire together).
        let lastVisibleCheck = 0;
        visibilityCheck = () => {
          if (document.visibilityState !== 'visible') return;
          const now = Date.now();
          if (now - lastVisibleCheck < 10_000) return; // debounce
          lastVisibleCheck = now;
          reg.update().catch(() => { /* offline / transient — interval retries */ });
        };
        document.addEventListener('visibilitychange', visibilityCheck);
        window.addEventListener('focus', visibilityCheck);

      } catch (err) {
        console.warn('[useServiceWorker] Registration failed:', err);
      }
    };

    // Listen for messages from the SW (e.g., SW_UPDATED). We ONLY flip
    // `updateAvailable` here — the actual page reload is owned by
    // WebUpdateBanner, which gates it on a "safe to reload" check (no
    // focused field, no open modal) and retries until that's true.
    //
    // History: this used to reload here too (with its own focus heuristic),
    // but WebUpdateBanner ALSO reloads off `updateAvailable` WITHOUT that
    // guard — so the two raced and the banner won, force-reloading mid-edit
    // and wiping unsaved work ("changes lost / app keeps reverting", 2026-06-02).
    // One gated reload authority (the banner) fixes that.
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SW_UPDATED') {
        setUpdateAvailable(true);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    registerSW();

    return () => {
      unmounted = true;
      if (checkInterval) clearInterval(checkInterval);
      if (visibilityCheck) {
        document.removeEventListener('visibilitychange', visibilityCheck);
        window.removeEventListener('focus', visibilityCheck);
      }
      navigator.serviceWorker.removeEventListener('message', handleMessage);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  return { updateAvailable, applyUpdate };
}
