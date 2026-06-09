import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNavPrefs, DEFAULT_NAV_PREFS } from '../useNavPrefs';

const LS_KEY = 'rmpg-nav-prefs';

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('useNavPrefs', () => {
  it('falls back to DEFAULTS when the stored blob is corrupt', () => {
    localStorage.setItem(LS_KEY, '{not valid json');
    const { result } = renderHook(() => useNavPrefs());
    expect(result.current[0]).toEqual(DEFAULT_NAV_PREFS);
  });

  it('fills missing keys and ignores unknown keys', () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ v: 1, prefs: { units: 'metric', bogus: 'x', layers: { crime: false } } }),
    );
    const { result } = renderHook(() => useNavPrefs());
    const prefs = result.current[0] as any;
    expect(prefs.units).toBe('metric');
    expect(prefs.clock).toBe(DEFAULT_NAV_PREFS.clock); // filled
    expect(prefs.layers.crime).toBe(false); // honored
    expect(prefs.layers.crash).toBe(DEFAULT_NAV_PREFS.layers.crash); // filled
    expect(prefs.bogus).toBeUndefined(); // dropped
  });

  it('round-trips a set value to localStorage (debounced) and rehydrates', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNavPrefs());
    act(() => result.current[1]('volume', 0.25));
    expect(result.current[0].volume).toBe(0.25);
    act(() => vi.advanceTimersByTime(200));
    vi.useRealTimers();

    const stored = JSON.parse(localStorage.getItem(LS_KEY)!);
    expect(stored.prefs.volume).toBe(0.25);

    const { result: r2 } = renderHook(() => useNavPrefs());
    expect(r2.current[0].volume).toBe(0.25);
  });

  it('resetPrefs restores defaults', () => {
    const { result } = renderHook(() => useNavPrefs());
    act(() => result.current[1]('theme', 'night'));
    act(() => result.current[2]());
    expect(result.current[0]).toEqual(DEFAULT_NAV_PREFS);
  });
});
