import { useState, useEffect, useRef, useCallback } from 'react';
import { Download, X, RefreshCw, AlertTriangle } from 'lucide-react';
import { devLog } from '../utils/devLog';

// ─── Types ───────────────────────────────────────────────────
interface UpdateCheckResponse {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  mandatory: boolean;
  minClientVersion?: string;
  releaseDate?: string;
  downloadUrl?: string;
  downloadSize?: string;
  downloadBytes?: number;
}

// ─── Build-time version injected by Vite define ─────────────
const BUILD_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

// ─── Platform Detection ─────────────────────────────────────
function isCapacitorAndroid(): boolean {
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.() && cap?.getPlatform?.() === 'android') return true;
  const ua = navigator.userAgent;
  return /Android/i.test(ua) && /wv|Version\/\d/.test(ua);
}

async function getAppVersion(): Promise<string> {
  // 1. Try Capacitor App plugin (reads versionName from build.gradle)
  try {
    const cap = (window as any).Capacitor;
    if (cap?.Plugins?.App?.getInfo) {
      const info = await cap.Plugins.App.getInfo();
      if (info.version && info.version !== '0.0.0') {
        try { localStorage.setItem('rmpg_apk_version', info.version); } catch { /* quota */ }
        return info.version;
      }
    }
  } catch {
    // Plugin not available
  }

  // 2. Use Vite build-time constant
  if (BUILD_VERSION && BUILD_VERSION !== '0.0.0') {
    return BUILD_VERSION;
  }

  // 3. Fallback to localStorage cache
  return localStorage.getItem('rmpg_apk_version') || BUILD_VERSION || '0.0.0';
}

// ─── Constants ──────────────────────────────────────────────
const CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 min
const INITIAL_DELAY_MS = 5000;            // 5 sec after load

// ─── Android Update Checker ─────────────────────────────────
// Shows a dismissible update dialog when a newer APK is available.
// The "Download Update" button opens the APK download link.
export default function AndroidUpdateChecker() {
  const [isAndroid] = useState(() => isCapacitorAndroid());
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResponse | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const checkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkForUpdates = useCallback(async () => {
    try {
      const version = await getAppVersion();

      const res = await fetch(
        `/api/updates/check?platform=android&currentVersion=${encodeURIComponent(version)}`,
        { headers: { 'Cache-Control': 'no-cache' } },
      );

      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      const data: UpdateCheckResponse = await res.json();

      if (data.updateAvailable && data.downloadUrl) {
        devLog(
          `[ANDROID-UPDATE] Update v${data.currentVersion} → v${data.latestVersion}`,
        );
        setUpdateInfo(data);
      } else {
        // Up to date — cache version and clear stale info
        if (data.currentVersion && data.currentVersion !== '0.0.0') {
          try { localStorage.setItem('rmpg_apk_version', data.currentVersion); } catch { /* quota */ }
        }
        setUpdateInfo(null);
        setDismissed(false); // allow future prompts
      }
    } catch (err: any) {
      console.error('[ANDROID-UPDATE] Check failed:', err.message);
    }
  }, []);

  // Initial check + periodic checking
  useEffect(() => {
    if (!isAndroid) return;

    const initTimer = setTimeout(() => checkForUpdates(), INITIAL_DELAY_MS);
    checkTimerRef.current = setInterval(() => checkForUpdates(), CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initTimer);
      if (checkTimerRef.current) clearInterval(checkTimerRef.current);
    };
  }, [isAndroid, checkForUpdates]);

  // Handle download — open APK URL
  const handleDownload = useCallback(() => {
    if (!updateInfo?.downloadUrl) return;
    setDownloading(true);

    const serverOrigin = window.location.origin;
    const fullUrl = updateInfo.downloadUrl.startsWith('http')
      ? updateInfo.downloadUrl
      : `${serverOrigin}${updateInfo.downloadUrl}`;

    // Try Capacitor Browser plugin first, then fallback approaches
    try {
      const cap = (window as any).Capacitor;
      if (cap?.Plugins?.Browser?.open) {
        cap.Plugins.Browser.open({ url: fullUrl });
      } else {
        // Direct link click — works in Android WebView
        const a = document.createElement('a');
        a.href = fullUrl;
        a.download = '';
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch {
      // Last resort
      window.open(fullUrl, '_system');
    }

    setTimeout(() => setDownloading(false), 3000);
  }, [updateInfo]);

  // ── Don't render if: not Android, no update, or dismissed ──
  if (!isAndroid || !updateInfo?.updateAvailable || dismissed) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)', WebkitBackdropFilter: 'blur(4px)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="mx-4 w-full max-w-sm"
        style={{
          background: 'linear-gradient(180deg, #1a2636 0%, #0d1520 100%)',
          border: '1px solid #1e3048',
          borderTop: '3px solid #888888',
          boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <span className="text-sm font-bold text-white uppercase tracking-wider">
              Update Available
            </span>
          </div>
          <button type="button"
            onClick={() => setDismissed(true)}
            className="p-1 text-rmpg-400 hover:text-white hover:bg-rmpg-700 transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-3">
          {/* Version info */}
          <div className="flex items-center justify-center gap-4">
            <div className="text-center">
              <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-0.5">
                Current
              </div>
              <div className="text-lg font-mono font-bold text-rmpg-300">
                v{updateInfo.currentVersion}
              </div>
            </div>
            <div className="text-rmpg-500 text-lg">&rarr;</div>
            <div className="text-center">
              <div className="text-[10px] text-green-400 uppercase tracking-wider mb-0.5">
                Latest
              </div>
              <div className="text-lg font-mono font-bold text-green-400">
                v{updateInfo.latestVersion}
              </div>
            </div>
          </div>

          {/* Size info */}
          {updateInfo.downloadSize && (
            <div className="text-center text-xs text-rmpg-400">
              Download size: {updateInfo.downloadSize}
            </div>
          )}

          {/* Download button */}
          <button type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 font-bold text-sm uppercase tracking-wider transition-all"
            style={{
              background: downloading
                ? 'linear-gradient(180deg, #1e3048 0%, #1a2636 100%)'
                : 'linear-gradient(180deg, #888888 0%, #333333 100%)',
              color: downloading ? '#8a9aaa' : '#fff',
              border: '1px solid',
              borderColor: downloading ? '#2a3e58' : '#d41515',
            }}
          >
            {downloading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Opening Download...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Download Update
              </>
            )}
          </button>

          {/* Dismiss */}
          <button type="button"
            onClick={() => setDismissed(true)}
            className="w-full text-center text-xs text-rmpg-400 hover:text-rmpg-200 py-1 transition-colors"
          >
            Remind me later
          </button>
        </div>
      </div>
    </div>
  );
}
