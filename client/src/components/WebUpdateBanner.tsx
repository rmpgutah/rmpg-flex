import { useEffect, useRef } from 'react';
import { useServiceWorker } from '../hooks/useServiceWorker';
import { devLog } from '../utils/devLog';

/**
 * Silent PWA update applier.
 * When a new service worker is detected, automatically applies the update
 * in the background with no visible UI. The page reloads seamlessly.
 *
 * Web browsers: SW skipWaiting + window.location.reload().
 * Electron desktop: forceRefresh IPC (clears Chromium HTTP cache, service
 * workers, cachestorage, then reloads). Falls back to applyUpdate() if the
 * forceRefresh bridge isn't available (older EXE without the new preload).
 */
export default function WebUpdateBanner() {
  const { updateAvailable, applyUpdate } = useServiceWorker();
  const autoApplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const electron = (window as any).electron;
  const isElectron = !!electron?.isElectron;

  // Auto-apply update silently after a brief delay
  useEffect(() => {
    if (!updateAvailable) return;

    if (autoApplyTimerRef.current) {
      clearTimeout(autoApplyTimerRef.current);
    }

    autoApplyTimerRef.current = setTimeout(() => {
      if (isElectron && typeof electron?.forceRefresh === 'function') {
        devLog('[WEB-UPDATE] Electron — invoking forceRefresh IPC');
        electron.forceRefresh().catch((err: any) => {
          devLog('[WEB-UPDATE] forceRefresh failed, falling back to applyUpdate', err);
          applyUpdate();
        });
      } else {
        devLog('[WEB-UPDATE] Applying service worker update silently');
        applyUpdate();
      }
    }, 2000);

    return () => {
      if (autoApplyTimerRef.current) {
        clearTimeout(autoApplyTimerRef.current);
      }
    };
  }, [updateAvailable, applyUpdate, isElectron, electron]);

  // Render nothing — completely invisible
  return null;
}
