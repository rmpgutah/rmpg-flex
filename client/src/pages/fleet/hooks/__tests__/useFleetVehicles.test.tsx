import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFleetVehicles } from '../useFleetVehicles';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../../hooks/useLiveSync', () => ({ useLiveSync: vi.fn() }));
vi.mock('../../../../components/ToastProvider', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import { apiFetch } from '../../../../hooks/useApi';

const VEHICLES = [
  { id: 1, vehicle_number: 'PS-D19', status: 'in_service', make: 'Ford', model: 'Explorer', current_mileage: 1000 },
  { id: 2, vehicle_number: 'PS-D20', status: 'maintenance', make: 'Chevy', model: 'Tahoe', current_mileage: 3000 },
];

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue({ data: VEHICLES, pagination: { total: 7 } } as never);
});

describe('useFleetVehicles', () => {
  it('loads vehicles and reports the server total separately from the loaded count', async () => {
    const { result } = renderHook(() => useFleetVehicles());
    await waitFor(() => expect(result.current.vehicles).toHaveLength(2));
    expect(result.current.vehicleTotal).toBe(7);
  });

  it('filters by status', async () => {
    const { result } = renderHook(() => useFleetVehicles());
    await waitFor(() => expect(result.current.vehicles).toHaveLength(2));
    act(() => result.current.setFilterStatus('in_service'));
    await waitFor(() => expect(result.current.filtered).toHaveLength(1));
    expect(result.current.filtered[0].vehicle_number).toBe('PS-D19');
  });

  it('searches across number, make, and model', async () => {
    const { result } = renderHook(() => useFleetVehicles());
    await waitFor(() => expect(result.current.vehicles).toHaveLength(2));
    act(() => result.current.setSearchQuery('tahoe'));
    await waitFor(() => expect(result.current.filtered).toHaveLength(1));
    expect(result.current.filtered[0].vehicle_number).toBe('PS-D20');
  });

  it('derives status counts and average mileage from the full list, not the filtered one', async () => {
    const { result } = renderHook(() => useFleetVehicles());
    await waitFor(() => expect(result.current.vehicles).toHaveLength(2));
    act(() => result.current.setFilterStatus('in_service'));
    await waitFor(() => expect(result.current.filtered).toHaveLength(1));
    expect(result.current.statusCounts.in_service).toBe(1);
    expect(result.current.statusCounts.maintenance).toBe(1);
    expect(result.current.avgMileage).toBe(2000);
  });

  it('refetches when the archive toggle flips', async () => {
    const { result } = renderHook(() => useFleetVehicles());
    await waitFor(() => expect(result.current.vehicles).toHaveLength(2));
    vi.mocked(apiFetch).mockClear();
    act(() => result.current.setShowArchived(true));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toContain('archived=true');
  });
});
