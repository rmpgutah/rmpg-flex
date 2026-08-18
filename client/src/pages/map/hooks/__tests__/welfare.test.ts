import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMapWelfare } from '../useMapWelfare';

describe('useMapWelfare', () => {
  it('does not throw with null map and empty units', () => {
    expect(() =>
      renderHook(() => useMapWelfare({ map: null, mapLoaded: false, units: [] }))
    ).not.toThrow();
  });
});
