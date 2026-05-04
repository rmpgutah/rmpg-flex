// ============================================================
// nativeAppShell — Capacitor-only behaviors wired at app boot
// ============================================================
// No-ops on web (the Capacitor global is absent). Lazy-imports
// the plugins so the web bundle has no Capacitor dependency,
// matching the pattern in `theme.ts` and `organicMapsNav.ts`.
//
// Wires:
//   1. SplashScreen.hide()    — on first React paint (faster than
//      the 2000ms launchShowDuration in capacitor.config.ts)
//   2. App backButton         — Android hardware back: pop history
//      if possible, otherwise exit the app
//   3. App appStateChange     — logs only for now; future code can
//      hang resume-refresh or pause-stop-GPS off this listener

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

function getCap(): CapacitorBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { Capacitor?: CapacitorBridge }).Capacitor;
}

async function hideSplash(): Promise<void> {
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch (err) {
    console.warn('[nativeAppShell] SplashScreen.hide failed', err);
  }
}

async function wireBackButton(): Promise<void> {
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        // At root — exit instead of doing nothing (matches Android user expectation)
        App.exitApp();
      }
    });
  } catch (err) {
    console.warn('[nativeAppShell] backButton listener failed', err);
  }
}

async function wireAppLifecycle(): Promise<void> {
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('appStateChange', ({ isActive }) => {
      // Log only — leave hooks for future resume-refresh / pause-stop-GPS work.
      // Logged at info-level so this is visible in chrome://inspect during APK testing.
      // eslint-disable-next-line no-console
      console.info(`[nativeAppShell] appStateChange isActive=${isActive}`);
    });
  } catch (err) {
    console.warn('[nativeAppShell] appStateChange listener failed', err);
  }
}

/**
 * Idempotent — safe to call once at boot. Returns immediately on web.
 */
export function setupNativeAppShell(): void {
  const cap = getCap();
  if (!cap?.isNativePlatform?.()) return;

  // Fire-and-forget; failures of one plugin don't block the others.
  void hideSplash();
  void wireBackButton();
  void wireAppLifecycle();
}
