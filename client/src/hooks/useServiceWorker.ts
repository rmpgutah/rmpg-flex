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

      } catch (err) {
        console.warn('[useServiceWorker] Registration failed:', err);
      }
    };

    // Listen for messages from the SW (e.g., SW_UPDATED).
    // Behavior change 2026-05-05: when the SW activates a new bundle,
    // auto-reload the page after a short delay so users always see the
    // newest assets without needing a manual hard-reload. Previously
    // this only set updateAvailable=true and waited for the user to
    // dismiss a banner — but in practice the banner was easy to miss
    // and operators kept reporting "changes aren't visible" because
    // their browser was still serving the cached pdfGenerator chunk.
    // The 1.5s delay gives any in-flight tool tip / form submit a
    // chance to finish before reload.
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SW_UPDATED') {
        setUpdateAvailable(true);
        try {
          // Skip auto-reload if the user is in the middle of editing
          // an unsaved form — there's no perfect signal for "active
          // edit", so we use a heuristic: skip if any input/textarea
          // currently has focus.
          const ae = document.activeElement;
          const editingTags = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
          if (ae && editingTags.has(ae.tagName)) return;
          setTimeout(() => {
            try { window.location.reload(); } catch { /* noop */ }
          }, 1500);
        } catch { /* noop — fall back to manual reload prompt */ }
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
