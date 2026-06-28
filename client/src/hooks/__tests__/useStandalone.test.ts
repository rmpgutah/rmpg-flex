import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStandalone } from '../useStandalone';

describe('useStandalone', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 375 });
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    });
  });

  it('detects standalone iOS phone viewport', () => {
    const { result } = renderHook(() => useStandalone());
    expect(result.current.isStandalone).toBe(true);
    expect(result.current.isIOS).toBe(true);
    expect(result.current.isMobileViewport).toBe(true);
  });

  it('returns false flags on desktop chrome', () => {
    (window.matchMedia as any).mockImplementation((q: string) => ({
      matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 1440 });
    Object.defineProperty(navigator, 'userAgent', {
      writable: true, value: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
    });
    const { result } = renderHook(() => useStandalone());
    expect(result.current.isStandalone).toBe(false);
    expect(result.current.isIOS).toBe(false);
    expect(result.current.isMobileViewport).toBe(false);
  });
});
