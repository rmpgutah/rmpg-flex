import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isMultiMonitorSupported,
  isMultiMonitorEnabled,
  requestMultiMonitorAccess,
  getSecondaryScreenBounds,
} from './multiMonitor';

const PRIMARY = { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080, isPrimary: true };
const SECONDARY = { availLeft: 1920, availTop: 0, availWidth: 1280, availHeight: 1024, isPrimary: false };

describe('multiMonitor', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as any).getScreenDetails;
  });
  afterEach(() => {
    delete (window as any).getScreenDetails;
  });

  it('reports unsupported when the Window Management API is absent', () => {
    expect(isMultiMonitorSupported()).toBe(false);
    expect(getSecondaryScreenBounds()).toBeNull();
  });

  it('reports supported when the API is present', () => {
    (window as any).getScreenDetails = vi.fn();
    expect(isMultiMonitorSupported()).toBe(true);
  });

  it('is disabled until requestMultiMonitorAccess succeeds', () => {
    (window as any).getScreenDetails = vi.fn().mockResolvedValue({ screens: [PRIMARY, SECONDARY], currentScreen: PRIMARY });
    expect(isMultiMonitorEnabled()).toBe(false);
    expect(getSecondaryScreenBounds()).toBeNull();
  });

  it('requestMultiMonitorAccess grants access and persists the enabled flag', async () => {
    (window as any).getScreenDetails = vi.fn().mockResolvedValue({ screens: [PRIMARY, SECONDARY], currentScreen: PRIMARY });
    const granted = await requestMultiMonitorAccess();
    expect(granted).toBe(true);
    expect(isMultiMonitorEnabled()).toBe(true);
    expect(localStorage.getItem('rmpg_desktop_multi_monitor')).toBe('1');
  });

  it('getSecondaryScreenBounds returns the non-primary screen bounds once granted', async () => {
    (window as any).getScreenDetails = vi.fn().mockResolvedValue({ screens: [PRIMARY, SECONDARY], currentScreen: PRIMARY });
    await requestMultiMonitorAccess();
    expect(getSecondaryScreenBounds()).toEqual({ left: 1920, top: 0, width: 1280, height: 1024 });
  });

  it('returns null when the user denies the permission prompt', async () => {
    (window as any).getScreenDetails = vi.fn().mockRejectedValue(new Error('denied'));
    const granted = await requestMultiMonitorAccess();
    expect(granted).toBe(false);
    expect(isMultiMonitorEnabled()).toBe(false);
    expect(getSecondaryScreenBounds()).toBeNull();
  });

  it('returns null on a single-screen setup even when enabled', async () => {
    (window as any).getScreenDetails = vi.fn().mockResolvedValue({ screens: [PRIMARY], currentScreen: PRIMARY });
    await requestMultiMonitorAccess();
    expect(getSecondaryScreenBounds()).toBeNull();
  });

  it('clears the stale enabled flag if a background re-fetch fails (permission revoked out-of-band)', async () => {
    (window as any).getScreenDetails = vi.fn().mockResolvedValue({ screens: [PRIMARY, SECONDARY], currentScreen: PRIMARY });
    await requestMultiMonitorAccess();
    expect(isMultiMonitorEnabled()).toBe(true);

    // Simulate a fresh page load: in-memory cache is gone, but localStorage
    // still says enabled — then simulate the permission having been revoked
    // out-of-band, so the background re-fetch this triggers fails.
    (window as any).getScreenDetails = vi.fn().mockRejectedValue(new Error('revoked'));
    // Re-import isn't possible mid-test, so instead directly exercise the
    // documented behavior: calling getSecondaryScreenBounds() with no cache
    // triggers a background requestMultiMonitorAccess() that will fail and
    // clear the flag. Since the module's cachedDetails is private state that
    // persists across calls within this test file's module instance, and a
    // prior test may have already populated it, this test must run in
    // isolation from cache pollution — vi.resetModules() before re-importing
    // guarantees a fresh module instance with no cached details.
    vi.resetModules();
    const fresh = await import('./multiMonitor');
    expect(fresh.getSecondaryScreenBounds()).toBeNull();
    // Allow the fire-and-forget .then() continuation to run.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(localStorage.getItem('rmpg_desktop_multi_monitor')).toBeNull();
  });
});
