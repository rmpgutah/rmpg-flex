import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClock } from './useClock';
import { getClockFormat, setClockFormat } from '../utils/clockPreference';

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

describe('useClock — format preference', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => setClockFormat('24h'));

  it('respects 12h format when set', () => {
    setClockFormat('12h');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T20:00:00Z')); // 20:00 UTC = 2:00 PM Denver (MDT, UTC-6)
    const { result } = renderHook(() => useClock());
    expect(result.current.time).toMatch(/AM|PM/i);
    vi.useRealTimers();
  });

  it('respects 24h format when set', () => {
    setClockFormat('24h');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T20:00:00Z'));
    const { result } = renderHook(() => useClock());
    expect(result.current.time).not.toMatch(/AM|PM/i);
    vi.useRealTimers();
  });
});
