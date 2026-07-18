import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useFleetWideFanOut, vehicleLabel } from '../useFleetWideFanOut';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

describe('useFleetWideFanOut', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('fetches vehicles, fans out per-vehicle requests, and flattens tagged rows', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url === '/fleet?limit=500') {
        return Promise.resolve([
          { id: 1, vehicle_number: 'U-1' },
          { id: 2, vehicle_number: 'U-2' },
        ]);
      }
      if (url === '/fleet/1/maintenance') return Promise.resolve([{ id: 10, cost: 5 }]);
      if (url === '/fleet/2/maintenance') return Promise.resolve([{ id: 11, cost: 7 }, { id: 12, cost: 9 }]);
      return Promise.reject(new Error('unexpected url ' + url));
    });

    const { result } = renderHook(() =>
      useFleetWideFanOut<{ id: number; cost: number }>((id) => `/fleet/${id}/maintenance`)
    );

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.totalVehicles).toBe(2);
    expect(result.current.loadedVehicles).toBe(2);
    expect(result.current.rows).toHaveLength(3);
    expect(result.current.rows.map((r) => r.row.id).sort()).toEqual([10, 11, 12]);
    expect(vehicleLabel(result.current.rows[0].vehicle)).toBe('U-1');
  });

  it('refetch() re-runs the fan-out without dropping loadedVehicles to 0 mid-flight', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url === '/fleet?limit=500') return Promise.resolve([{ id: 1, vehicle_number: 'U-1' }]);
      if (url === '/fleet/1/maintenance') return Promise.resolve([{ id: 10, cost: 5 }]);
      return Promise.reject(new Error('unexpected url ' + url));
    });

    const { result } = renderHook(() =>
      useFleetWideFanOut<{ id: number; cost: number }>((id) => `/fleet/${id}/maintenance`)
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockedApiFetch.mockClear();

    act(() => result.current.refetch());
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledWith('/fleet?limit=500'));
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledWith('/fleet/1/maintenance'));
  });
});
