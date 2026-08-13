import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Helper to set screen dimensions and touch points
function mockScreen(width: number, height: number, touchPoints = 0, ua = 'Mozilla/5.0') {
  Object.defineProperty(window, 'screen', {
    value: { width, height },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    value: touchPoints,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(navigator, 'userAgent', {
    value: ua,
    writable: true,
    configurable: true,
  });
}

describe('useDeviceClass', () => {
  beforeEach(() => {
    document.documentElement.className = '';
  });

  afterEach(() => {
    document.documentElement.className = '';
    vi.restoreAllMocks();
  });

  it('stamps device-fz55 on html when all three conditions met (1920x1080 touch laptop)', async () => {
    mockScreen(1920, 1080, 5);
    const { useDeviceClass } = await import('../useDeviceClass');
    const { result } = renderHook(() => useDeviceClass());
    expect(result.current.isFz55).toBe(true);
    expect(document.documentElement.classList.contains('device-fz55')).toBe(true);
  });

  it('stamps device-fz55 for 1366x768 config', async () => {
    mockScreen(1366, 768, 5);
    const { useDeviceClass } = await import('../useDeviceClass');
    const { result } = renderHook(() => useDeviceClass());
    expect(result.current.isFz55).toBe(true);
  });

  it('stamps device-fz55 for 1536x864 scaled config', async () => {
    mockScreen(1536, 864, 5);
    const { useDeviceClass } = await import('../useDeviceClass');
    const { result } = renderHook(() => useDeviceClass());
    expect(result.current.isFz55).toBe(true);
  });

  it('does NOT stamp when no touch points', async () => {
    mockScreen(1920, 1080, 0);
    const { useDeviceClass } = await import('../useDeviceClass');
    const { result } = renderHook(() => useDeviceClass());
    expect(result.current.isFz55).toBe(false);
    expect(document.documentElement.classList.contains('device-fz55')).toBe(false);
  });

  it('does NOT stamp for phone viewport (too small)', async () => {
    mockScreen(390, 844, 5);
    const { useDeviceClass } = await import('../useDeviceClass');
    const { result } = renderHook(() => useDeviceClass());
    expect(result.current.isFz55).toBe(false);
  });

  it('does NOT stamp for 4K monitor (too wide)', async () => {
    mockScreen(3840, 2160, 5);
    const { useDeviceClass } = await import('../useDeviceClass');
    const { result } = renderHook(() => useDeviceClass());
    expect(result.current.isFz55).toBe(false);
  });

  it('does NOT stamp for mobile UA even if screen matches', async () => {
    mockScreen(1366, 768, 5, 'Mozilla/5.0 (Android; Mobile; rv:102.0)');
    const { useDeviceClass } = await import('../useDeviceClass');
    const { result } = renderHook(() => useDeviceClass());
    expect(result.current.isFz55).toBe(false);
  });

  it('removes device-fz55 class on resize to non-FZ55 dimensions', async () => {
    mockScreen(1920, 1080, 5);
    const { useDeviceClass } = await import('../useDeviceClass');
    renderHook(() => useDeviceClass());
    expect(document.documentElement.classList.contains('device-fz55')).toBe(true);

    // Simulate connect to 4K external monitor
    act(() => {
      mockScreen(3840, 2160, 5);
      window.dispatchEvent(new Event('resize'));
    });
    expect(document.documentElement.classList.contains('device-fz55')).toBe(false);
  });
});
