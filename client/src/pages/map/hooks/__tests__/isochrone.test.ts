import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMapIsochrone } from '../useMapIsochrone';

describe('useMapIsochrone', () => {
  it('returns false and a function when map is null', () => {
    const { result } = renderHook(() =>
      useMapIsochrone({ map: null, mapLoaded: false, gpsLatitude: null, gpsLongitude: null, addToast: vi.fn() })
    );
    expect(result.current.isochroneEnabled).toBe(false);
    expect(typeof result.current.toggleIsochrone).toBe('function');
  });

  it('toggleIsochrone is a no-op when map is null', async () => {
    const { result } = renderHook(() =>
      useMapIsochrone({ map: null, mapLoaded: false, gpsLatitude: null, gpsLongitude: null, addToast: vi.fn() })
    );
    // Should not throw
    await result.current.toggleIsochrone();
  });
});
