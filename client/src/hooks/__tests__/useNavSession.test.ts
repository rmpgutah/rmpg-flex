import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useNavSession } from '../useNavSession';

beforeEach(() => localStorage.clear());

describe('useNavSession', () => {
  it('accumulates distance and tracks max speed across bumps', () => {
    const { result } = renderHook(() => useNavSession());
    act(() => result.current.bump(100, 35));
    act(() => result.current.bump(50, 60));
    act(() => result.current.bump(25, 20));
    expect(result.current.distanceMeters).toBe(175);
    expect(result.current.maxMph).toBe(60);
  });

  it('ignores negative / non-finite deltas', () => {
    const { result } = renderHook(() => useNavSession());
    act(() => result.current.bump(-10, 0));
    act(() => result.current.bump(NaN as unknown as number, 0));
    act(() => result.current.bump(40, 10));
    expect(result.current.distanceMeters).toBe(40);
  });

  it('reset zeroes the odometer', () => {
    const { result } = renderHook(() => useNavSession());
    act(() => result.current.bump(500, 45));
    act(() => result.current.reset());
    expect(result.current.distanceMeters).toBe(0);
    expect(result.current.maxMph).toBe(0);
  });
});
