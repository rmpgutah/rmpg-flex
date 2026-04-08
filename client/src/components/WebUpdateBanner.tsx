import { useEffect, useRef } from 'react';
import { useServiceWorker } from '../hooks/useServiceWorker';
import { devLog } from '../utils/devLog';

/**
 * Silent PWA update applier.
 * When a new service worker is detected, automatically applies the update
 * in the background with no visible UI. The page reloads seamlessly.
 * Only active in web browsers (not Electron desktop app).
 */
export default function WebUpdateBanner() {
  const { updateAvailable, applyUpdate } = useServiceWorker();
  const autoApplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isElectron = !!(window as any).electron?.isElectron;

  // Auto-apply update silently after a brief delay
  useEffect(() => {
    if (!updateAvailable || isElectron) return;

    if (autoApplyTimerRef.current) {
      clearTimeout(autoApplyTimerRef.current);
    }

    // Apply after 2 seconds — enough for the new SW to settle
    autoApplyTimerRef.current = setTimeout(() => {
      devLog('[WEB-UPDATE] Applying service worker update silently');
      applyUpdate();
    }, 2000);

    return () => {
      if (autoApplyTimerRef.current) {
        clearTimeout(autoApplyTimerRef.current);
      }
    };
  }, [updateAvailable, applyUpdate, isElectron]);

  // Render nothing — completely invisible
  return null;
}
