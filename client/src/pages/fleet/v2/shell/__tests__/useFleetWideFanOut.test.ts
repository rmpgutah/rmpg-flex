import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useFleetWideFanOut } from '../useFleetWideFanOut';

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResp(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('useFleetWideFanOut', () => {
  it('exposes the fetched vehicle list', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/fleet?limit=500')) {
        return Promise.resolve(jsonResp({ data: [{ id: 1, vehicle_number: 'PS-1', vehicle_name: null }] }));
      }
      return Promise.resolve(jsonResp([]));
    });
    const { result } = renderHook(() => useFleetWideFanOut<{ id: number }>((id) => `/fleet/${id}/fuel`));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.vehicles).toEqual([{ id: 1, vehicle_number: 'PS-1', vehicle_name: null }]);
  });

  it('refetch() re-runs the fan-out fetch', async () => {
    let callCount = 0;
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/fleet?limit=500')) {
        return Promise.resolve(jsonResp({ data: [{ id: 1, vehicle_number: 'PS-1', vehicle_name: null }] }));
      }
      callCount += 1;
      return Promise.resolve(jsonResp([{ id: callCount }]));
    });
    const { result } = renderHook(() => useFleetWideFanOut<{ id: number }>((id) => `/fleet/${id}/fuel`));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([{ vehicle: { id: 1, vehicle_number: 'PS-1', vehicle_name: null }, row: { id: 1 } }]);

    act(() => { result.current.refetch(); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.rows).toEqual([{ vehicle: { id: 1, vehicle_number: 'PS-1', vehicle_name: null }, row: { id: 2 } }]));
  });

  it('refetch() does not flip loading back to true (no full-panel loading flash)', async () => {
    let resolveVehicleFetch: ((r: Response) => void) | null = null;
    let vehicleFetchCount = 0;
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/fleet?limit=500')) {
        vehicleFetchCount += 1;
        if (vehicleFetchCount === 1) {
          // First (mount) fetch resolves immediately.
          return Promise.resolve(jsonResp({ data: [{ id: 1, vehicle_number: 'PS-1', vehicle_name: null }] }));
        }
        // Second (refetch) fetch is held open so we can observe `loading`
        // mid-flight without a race.
        return new Promise<Response>((resolve) => { resolveVehicleFetch = resolve; });
      }
      return Promise.resolve(jsonResp([]));
    });

    const { result } = renderHook(() => useFleetWideFanOut<{ id: number }>((id) => `/fleet/${id}/fuel`));

    // Initial mount fetch: loading starts true, then settles to false.
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.refetch(); });
    // While the refetch's vehicle fetch is still pending, loading must stay false.
    expect(result.current.loading).toBe(false);

    // Let the held-open fetch resolve so the effect/test can clean up.
    act(() => { resolveVehicleFetch?.(jsonResp({ data: [{ id: 1, vehicle_number: 'PS-1', vehicle_name: null }] })); });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
