import { useEffect, useRef } from 'react';
import { devLog, devWarn } from '../utils/devLog';

// ─── Types ───────────────────────────────────────────────────
interface UpdateStatus {
  status: 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error';
  version?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  message?: string;
  releaseDate?: string;
}

interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  getVersion: () => Promise<string>;
  onUpdateStatus: (callback: (data: UpdateStatus) => void) => () => void;
  checkForUpdates: () => void;
  installUpdate: () => void;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}

// ─── Electron Silent Update Listener ────────────────────────
// Downloads updates silently in the background. No UI, no popups.
// Updates install automatically when the user quits the app.
export default function UpdateBanner() {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const electron = window.electron;
    if (!electron?.isElectron || !electron.onUpdateStatus) return;

    // Listen silently — log to console only for diagnostics
    cleanupRef.current = electron.onUpdateStatus((data: UpdateStatus) => {
      if (data.status === 'downloading') {
        devLog(`[UPDATE] Downloading v${data.version}... ${data.percent || 0}%`);
      } else if (data.status === 'ready') {
        devLog(`[UPDATE] v${data.version} ready — will install on next quit`);
      } else if (data.status === 'error') {
        devWarn('[UPDATE] Check failed:', data.message);
      }
    });

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  // Render nothing — completely invisible
  return null;
}
