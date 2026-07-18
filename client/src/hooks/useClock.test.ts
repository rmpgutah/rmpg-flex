import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClock } from './useClock';

describe('useClock', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('returns a non-empty time and date string, and updates on tick', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T20:00:00Z'));
    const { result } = renderHook(() => useClock());
    expect(result.current.time.length).toBeGreaterThan(0);
    expect(result.current.date.length).toBeGreaterThan(0);
    const firstTime = result.current.time;
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(result.current.time).not.toBe(firstTime);
  });
});
