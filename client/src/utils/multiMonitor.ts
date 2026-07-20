// client/src/utils/multiMonitor.ts
// Wraps the browser's Window Management API (getScreenDetails), which lets a
// page enumerate physical screens and open a *new* window.open() window
// targeting a specific one. It cannot make an in-page floating panel span a
// second monitor — see docs/superpowers/specs/2026-07-20-desktop-window-management-polish-design.md
// Section B for the full reasoning. Chromium-only; Safari/Firefox always
// report unsupported.

const STORAGE_KEY = 'rmpg_desktop_multi_monitor';

interface ScreenBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Minimal shape of the experimental Window Management API's ScreenDetails —
// not yet in lib.dom.d.ts, so declared locally.
interface ScreenDetailedShape {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isPrimary: boolean;
}
interface ScreenDetailsShape {
  screens: ScreenDetailedShape[];
  currentScreen: ScreenDetailedShape;
}

declare global {
  interface Window {
    getScreenDetails?: () => Promise<ScreenDetailsShape>;
  }
}

let cachedDetails: ScreenDetailsShape | null = null;

export function isMultiMonitorSupported(): boolean {
  return typeof window !== 'undefined' && 'getScreenDetails' in window;
}

export function isMultiMonitorEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export async function requestMultiMonitorAccess(): Promise<boolean> {
  if (!isMultiMonitorSupported()) return false;
  try {
    cachedDetails = await window.getScreenDetails!();
    localStorage.setItem(STORAGE_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Synchronous by design so it can slot into openDetachedWindow's existing
 * synchronous call site without restructuring it into async. If the
 * in-memory cache hasn't been populated yet this page load (e.g. right after
 * a fresh reload, before any pop-out has happened), this returns null for
 * that first call and kicks off a background re-fetch — already-granted
 * permission doesn't require a fresh user gesture, so this is safe to fire
 * here. Subsequent calls in the same page session then succeed.
 */
export function getSecondaryScreenBounds(): ScreenBounds | null {
  if (!isMultiMonitorEnabled()) return null;
  if (!cachedDetails) {
    // If this background re-fetch fails, the permission was likely revoked
    // out-of-band since the flag was set — clear the stale flag so we don't
    // keep re-attempting (and potentially re-prompting) on every future
    // pop-out for the rest of the session.
    void requestMultiMonitorAccess().then(ok => {
      if (!ok) {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* silent */ }
      }
    });
    return null;
  }
  const secondary = cachedDetails.screens.find(s => !s.isPrimary);
  if (!secondary) return null;
  return { left: secondary.availLeft, top: secondary.availTop, width: secondary.availWidth, height: secondary.availHeight };
}
