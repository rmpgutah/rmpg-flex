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
});
