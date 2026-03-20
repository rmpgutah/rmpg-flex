import { useEffect, useState, useCallback } from 'react';

// How often to poll for SW updates (2 minutes — forced updates)
const UPDATE_CHECK_INTERVAL = 2 * 60 * 1000;

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

    const handleControllerChange = () => {
      // The SW controller changed — a new version activated
      // Signal that an update is available so the UI can prompt the user
      if (!document.hidden && !unmounted) {
        setUpdateAvailable(true);
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
            reg.update().catch(() => {
              // Network errors during update check are non-fatal
            });
          }, UPDATE_CHECK_INTERVAL);
        } else if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = undefined;
        }

      } catch {
        // SW registration failed (e.g., no HTTPS in production) — not critical
      }
    };

    // Listen for messages from the SW (e.g., SW_UPDATED)
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SW_UPDATED') {
        // The new SW activated and cleaned old caches — refresh to load new assets
        setUpdateAvailable(true);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    registerSW();

    return () => {
      unmounted = true;
      if (checkInterval) clearInterval(checkInterval);
      navigator.serviceWorker.removeEventListener('message', handleMessage);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  return { updateAvailable, applyUpdate };
}
