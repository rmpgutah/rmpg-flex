import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useDrivingScore } from '../useDrivingScore';

describe('useDrivingScore', () => {
  it('counts hard brakes and accels with debounce, tracks peaks', () => {
    const { result } = renderHook(() =>
      useDrivingScore({ hardBrakeG: 0.4, hardAccelG: 0.35, eventDebounceMs: 1000 }),
    );
    act(() => {
      result.current.addSample({ longG: -0.6, latG: 0.2, t: 0 });    // brake #1
      result.current.addSample({ longG: -0.5, latG: 0.1, t: 500 });  // debounced (same kind)
      result.current.addSample({ longG: -0.5, latG: 0.1, t: 1200 }); // brake #2
      result.current.addSample({ longG: 0.5, latG: 0.7, t: 2000 });  // accel #1, peak lat 0.7
    });
    expect(result.current.hardBrakes).toBe(2);
    expect(result.current.hardAccels).toBe(1);
    expect(result.current.peakLongG).toBeCloseTo(0.6, 5);
    expect(result.current.peakLatG).toBeCloseTo(0.7, 5);
    expect(result.current.score).toBeLessThan(100);
  });

  it('ignores sub-threshold samples', () => {
    const { result } = renderHook(() => useDrivingScore());
    act(() => {
      result.current.addSample({ longG: -0.1, t: 0 });
      result.current.addSample({ longG: 0.1, t: 100 });
    });
    expect(result.current.hardBrakes).toBe(0);
    expect(result.current.hardAccels).toBe(0);
    expect(result.current.score).toBe(100);
  });

  it('reset zeroes counts and restores score', () => {
    const { result } = renderHook(() => useDrivingScore());
    act(() => { result.current.addSample({ longG: -0.8, t: 0 }); });
    act(() => { result.current.reset(); });
    expect(result.current.hardBrakes).toBe(0);
    expect(result.current.score).toBe(100);
  });
});
