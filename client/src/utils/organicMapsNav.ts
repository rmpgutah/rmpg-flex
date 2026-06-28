// Navigation handoff — routes to the best available maps app per platform.
//   Android Capacitor → native Organic Maps via Intent (turn-by-turn once
//     the api-android signup is wired up in OrganicMapsPlugin.java;
//     geo: pin fallback in the meantime).
//   Everything else (desktop browser, Electron, iOS web) → OpenStreetMap
//     directions URL opened in a new tab. Reliable cross-platform routing
//     so desktop dispatchers can hand off to officers or check a route.
//
// Mirrors the Capacitor access pattern used elsewhere in the codebase
// (e.g. client/src/hooks/useIsMobile.ts) — reads `(window as any).Capacitor`
// at call time instead of importing `@capacitor/core`, so the web build
// has no Capacitor dependency and silently falls back in the browser.

type OrganicMapsPlugin = {
  isInstalled: () => Promise<{ installed: boolean }>;
  openAtPoint: (opts: { lat: number; lng: number; label?: string }) => Promise<void>;
  startNavigation: (opts: { lat: number; lng: number; label?: string }) => Promise<{ mode: string }>;
};

function getCap(): any {
  return (typeof window !== 'undefined') ? (window as any).Capacitor : undefined;
}

export function isAndroidNative(): boolean {
  const cap = getCap();
  return !!(cap?.isNativePlatform?.() && cap?.getPlatform?.() === 'android');
}

function getPlugin(): OrganicMapsPlugin | null {
  if (!isAndroidNative()) return null;
  const cap = getCap();
  return (cap?.Plugins?.OrganicMaps as OrganicMapsPlugin) || null;
}

export async function isOrganicMapsInstalled(): Promise<boolean> {
  const p = getPlugin();
  if (!p) return false;
  try {
    const { installed } = await p.isInstalled();
    return installed;
  } catch {
    return false;
  }
}

/** OpenStreetMap directions URL — works in any browser, any OS. */
function osmDirectionsUrl(lat: number, lng: number, label?: string): string {
  const dest = `${lat},${lng}`;
  const q = label ? `&to=${encodeURIComponent(label)}` : '';
  return `https://www.openstreetmap.org/directions?engine=graphhopper_car&to=${dest}${q}`;
}

/**
 * Universal "navigate to this point" handoff.
 * Returns { ok, mode } — mode reports which path was used so callers can log/telemetry.
 *   mode = "turn-by-turn"   → native OM Intent with registered API
 *   mode = "pin-fallback"   → native OM via geo: URI (pre-signup)
 *   mode = "osm-web"         → OpenStreetMap directions URL opened in new tab
 */
export async function navigateTo(
  lat: number,
  lng: number,
  label?: string
): Promise<{ ok: boolean; mode?: string; reason?: string }> {
  const p = getPlugin();
  if (p) {
    try {
      const res = await p.startNavigation({ lat, lng, label });
      return { ok: true, mode: res?.mode || 'pin-fallback' };
    } catch (e: any) {
      // Native launch failed (OM not installed, etc.) — fall through to web.
    }
  }
  try {
    const url = osmDirectionsUrl(lat, lng, label);
    window.open(url, '_blank', 'noopener,noreferrer');
    return { ok: true, mode: 'osm-web' };
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'launch-failed' };
  }
}

/** Back-compat alias kept for older call sites. */
export const navigateWithOrganicMaps = navigateTo;
