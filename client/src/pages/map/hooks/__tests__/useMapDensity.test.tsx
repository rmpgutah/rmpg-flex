import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MapDensityProvider, useMapDensity, DENSITY_TOKENS } from '../useMapDensity';

function setPointer(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('coarse') ? coarse : !coarse,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <MapDensityProvider>{children}</MapDensityProvider>
);

describe('useMapDensity', () => {
  beforeEach(() => {
    localStorage.clear();
    setPointer(false);
  });

  it('defaults to compact on a fine pointer', () => {
    const { result } = renderHook(() => useMapDensity(), { wrapper });
    expect(result.current.density).toBe('compact');
    expect(result.current.override).toBeNull();
  });

  it('defaults to touch on a coarse pointer', () => {
    setPointer(true);
    const { result } = renderHook(() => useMapDensity(), { wrapper });
    expect(result.current.density).toBe('touch');
  });

  it('lets an explicit override win over the coarse-pointer default', () => {
    setPointer(true);
    const { result } = renderHook(() => useMapDensity(), { wrapper });
    act(() => result.current.setOverride('compact'));
    expect(result.current.density).toBe('compact');
    expect(result.current.override).toBe('compact');
  });

  it('persists the override to rmpg_map_density and restores it on remount', () => {
    const { result } = renderHook(() => useMapDensity(), { wrapper });
    act(() => result.current.setOverride('touch'));
    expect(JSON.parse(localStorage.getItem('rmpg_map_density')!)).toBe('touch');

    const remounted = renderHook(() => useMapDensity(), { wrapper });
    expect(remounted.result.current.density).toBe('touch');
  });

  it('clearing the override falls back to the pointer default', () => {
    setPointer(true);
    const { result } = renderHook(() => useMapDensity(), { wrapper });
    act(() => result.current.setOverride('compact'));
    act(() => result.current.setOverride(null));
    expect(result.current.density).toBe('touch');
  });

  it('exposes a 44px minimum row height in touch mode', () => {
    expect(DENSITY_TOKENS.touch.rowMinHeight).toBe('44px');
    expect(DENSITY_TOKENS.compact.rowMinHeight).toBe('24px');
  });

  it('ignores a corrupt persisted value', () => {
    localStorage.setItem('rmpg_map_density', '"enormous"');
    const { result } = renderHook(() => useMapDensity(), { wrapper });
    expect(result.current.density).toBe('compact');
  });
});
