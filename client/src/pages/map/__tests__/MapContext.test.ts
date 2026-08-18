import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { MapContext, useMapContext } from '../MapContext';

describe('useMapContext', () => {
  it('returns null map when no provider', () => {
    const { result } = renderHook(() => useMapContext());
    expect(result.current.map).toBeNull();
    expect(result.current.units).toEqual([]);
    expect(result.current.calls).toEqual([]);
  });
});
