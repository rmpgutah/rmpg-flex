import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGeolocation } from '../useGeolocation';

describe('useGeolocation', () => {
  let watchCb: PositionCallback | null = null;
  let errCb: PositionErrorCallback | null = null;

  beforeEach(() => {
    watchCb = null; errCb = null;
    Object.defineProperty(navigator, 'geolocation', {
      writable: true,
      value: {
        watchPosition: vi.fn((ok, err) => { watchCb = ok; errCb = err; return 1; }),
        clearWatch: vi.fn(),
      },
    });
  });

  it('starts in idle state', () => {
    const { result } = renderHook(() => useGeolocation({ enabled: false }));
    expect(result.current.status).toBe('idle');
    expect(result.current.position).toBeNull();
  });

  it('reports position when watch fires', () => {
    const { result } = renderHook(() => useGeolocation({ enabled: true }));
    act(() => {
      watchCb!({ coords: { latitude: 40.76, longitude: -111.89, accuracy: 10 } } as any);
    });
    expect(result.current.position?.lat).toBe(40.76);
    expect(result.current.status).toBe('granted');
  });

  it('reports denied error', () => {
    const { result } = renderHook(() => useGeolocation({ enabled: true }));
    act(() => {
      errCb!({ code: 1, message: 'denied' } as GeolocationPositionError);
    });
    expect(result.current.status).toBe('denied');
  });
});
