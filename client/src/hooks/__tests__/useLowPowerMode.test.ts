import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useLowPowerMode } from '../useLowPowerMode';

function mockMatchMedia(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      matches: reduced,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  // @ts-expect-error cleanup
  delete window.matchMedia;
});

describe('useLowPowerMode', () => {
  it('is low-power when OS prefers reduced motion', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useLowPowerMode());
    expect(result.current.lowPower).toBe(true);
    expect(result.current.easeDurationMs).toBe(0);
    expect(result.current.animationsEnabled).toBe(false);
  });

  it('honors the persisted flag when reduced-motion is off', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useLowPowerMode({ normalEaseMs: 500 }));
    expect(result.current.lowPower).toBe(false);
    expect(result.current.easeDurationMs).toBe(500);
    act(() => result.current.setLowPower(true));
    expect(result.current.lowPower).toBe(true);
    expect(localStorage.getItem('rmpg-nav-lowpower')).toBe('1');
  });

  it('controlled preference wins', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useLowPowerMode({ preference: true }));
    expect(result.current.lowPower).toBe(true);
  });
});
