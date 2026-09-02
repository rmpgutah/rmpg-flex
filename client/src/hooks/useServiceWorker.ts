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

    // Track whether a SW was already controlling the page when this hook mounted.
    // A controllerchange from null→SW is first-install and should NOT trigger a
    // reload (the page already has fresh content). A change from SW→SW means a
    // new version took over and the page needs to reload to pick up new assets.
    let hadController = !!navigator.serviceWorker.controller;

    const handleControllerChange = () => {
      // Fallback for the case where sw.js's SW_UPDATED message didn't arrive
      // (e.g. a race between matchAll() and clients.claim() in the activate
      // handler). controllerchange fires reliably AFTER clients.claim(), so
      // this path always catches a new-version takeover even when the message
      // path misses it.
      if (hadController && !unmounted) {
        setUpdateAvailable(true);
      }
      hadController = true;
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
        //
        // 60-second debounce: field officers frequently switch between the app
        // and other tools (maps, radio, phone). The old 10-second debounce
        // triggered update checks on almost every app switch, which combined
        // with the SW update cycle to cause frequent reloads.
        let lastVisibleCheck = 0;
        visibilityCheck = () => {
          if (document.visibilityState !== 'visible') return;
          const now = Date.now();
          if (now - lastVisibleCheck < 60_000) return; // debounce — 60s for field devices
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
      // SW background sync asks the page to flush the write queue when the
      // device reconnects (SW cannot call apiFetch directly — it lacks the
      // session cookie/JWT that the page holds in memory).
      if (event.data?.type === 'SYNC_PUSH_REQUESTED') {
        import('../utils/offlineQueue').then(({ processQueue }) => {
          processQueue(fetch).catch(() => {});
        });
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
