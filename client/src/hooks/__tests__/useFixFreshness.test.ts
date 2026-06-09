import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useFixFreshness } from '../useFixFreshness';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(() => vi.useRealTimers());

describe('useFixFreshness', () => {
  it('transitions fresh → stale → offline as the fix ages', () => {
    const { result } = renderHook(() =>
      useFixFreshness({ lat: 40, lng: -111, time: 0 }),
    );
    expect(result.current.state).toBe('fresh');

    act(() => { vi.setSystemTime(11_000); vi.advanceTimersByTime(11_000); });
    expect(result.current.state).toBe('stale');

    act(() => { vi.setSystemTime(61_000); vi.advanceTimersByTime(50_000); });
    expect(result.current.state).toBe('offline');
  });

  it('reports offline when navigator.onLine is false', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const { result } = renderHook(() =>
      useFixFreshness({ lat: 40, lng: -111, time: 0 }),
    );
    expect(result.current.state).toBe('offline');
  });

  it('is offline before any fix arrives', () => {
    const { result } = renderHook(() =>
      useFixFreshness({ lat: null, lng: null }),
    );
    expect(result.current.ageMs).toBe(null);
    expect(result.current.state).toBe('offline');
  });
});
