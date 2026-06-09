import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useAutoTheme } from '../useAutoTheme';

// Salt Lake City. In late June sunrise ~12:00Z, sunset ~03:00Z (next day).
const SLC = { lat: 40.7608, lng: -111.891 };

describe('useAutoTheme', () => {
  it('resolves day at local midday (20:00Z, June)', () => {
    const noon = new Date(Date.UTC(2026, 5, 21, 20, 0, 0)); // ~14:00 MDT
    const { result } = renderHook(() => useAutoTheme({ ...SLC, now: noon }));
    expect(result.current).toBe('day');
  });

  it('resolves night at local midnight (08:00Z, June)', () => {
    const midnight = new Date(Date.UTC(2026, 5, 21, 8, 0, 0)); // ~02:00 MDT
    const { result } = renderHook(() => useAutoTheme({ ...SLC, now: midnight }));
    expect(result.current).toBe('night');
  });

  it('falls back when coords are missing', () => {
    const { result } = renderHook(() =>
      useAutoTheme({ lat: null, lng: null, fallback: 'day' }),
    );
    expect(result.current).toBe('day');
  });
});
