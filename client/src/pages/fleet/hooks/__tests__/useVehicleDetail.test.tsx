import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useVehicleDetail } from '../useVehicleDetail';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../../components/ToastProvider', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import { apiFetch } from '../../../../hooks/useApi';

beforeEach(() => {
  localStorage.clear();
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue({ data: [], summary: null } as never);
});

const urls = () => vi.mocked(apiFetch).mock.calls.map((c) => String(c[0]));

describe('useVehicleDetail', () => {
  it('loads detail for the selected vehicle', async () => {
    const { result } = renderHook(({ id }) => useVehicleDetail(id, () => {}), {
      initialProps: { id: 1 as string | number | null },
    });
    await waitFor(() => expect(urls().some((u) => u === '/fleet/1')).toBe(true));
    expect(result.current.activeTab).toBe('overview');
  });

  it('does NOT fetch the previous tab against a newly selected vehicle', async () => {
    // The hazard: switching vehicles calls setActiveTab('overview'), but that is
    // not reflected until the next render. Without the skip flag the lazy-load
    // effect reads the STALE tab and fetches it for the NEW vehicle.
    const { result, rerender } = renderHook(({ id }) => useVehicleDetail(id, () => {}), {
      initialProps: { id: 1 as string | number | null },
    });
    await waitFor(() => expect(urls().some((u) => u === '/fleet/1')).toBe(true));

    act(() => result.current.setActiveTab('fuel'));
    await waitFor(() => expect(urls().some((u) => u.startsWith('/fleet/1/fuel'))).toBe(true));

    vi.mocked(apiFetch).mockClear();
    rerender({ id: 2 });

    await waitFor(() => expect(urls().some((u) => u === '/fleet/2')).toBe(true));
    // Vehicle 2's fuel must NOT have been requested — the tab reset to overview.
    expect(urls().some((u) => u.startsWith('/fleet/2/fuel'))).toBe(false);
    await waitFor(() => expect(result.current.activeTab).toBe('overview'));
  });

  it('clears per-tab data when the vehicle changes', async () => {
    const { result, rerender } = renderHook(({ id }) => useVehicleDetail(id, () => {}), {
      initialProps: { id: 1 as string | number | null },
    });
    await waitFor(() => expect(urls().some((u) => u === '/fleet/1')).toBe(true));
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.fuelLogs).toEqual([]));
    expect(result.current.inspections).toEqual([]);
    expect(result.current.analytics).toBeNull();
  });

  it('notifies the caller to reset cost state on vehicle change', async () => {
    const onCostsReset = vi.fn();
    const { rerender } = renderHook(({ id }) => useVehicleDetail(id, onCostsReset), {
      initialProps: { id: 1 as string | number | null },
    });
    await waitFor(() => expect(urls().some((u) => u === '/fleet/1')).toBe(true));
    onCostsReset.mockClear();
    rerender({ id: 2 });
    await waitFor(() => expect(onCostsReset).toHaveBeenCalled());
  });

  it('fetches fuel logs when the Costs tab becomes active (Task 3 gap, closed in Task 4)', async () => {
    // Costs tab renders a fuel-cost figure sourced from fuelLogs/fuelSummary,
    // which only useVehicleDetail owns. Assert on the literal `/fuel?` query
    // string fetchFuelLogs actually sends — `startsWith('/fleet/1/fuel')`
    // would ALSO match `/fleet/1/fuel-efficiency` and pass against a bug that
    // fetches the wrong endpoint, so pin the real request shape instead.
    const { result } = renderHook(({ id }) => useVehicleDetail(id, () => {}), {
      initialProps: { id: 1 as string | number | null },
    });
    await waitFor(() => expect(urls().some((u) => u === '/fleet/1')).toBe(true));
    vi.mocked(apiFetch).mockClear();
    act(() => result.current.setActiveTab('costs'));
    await waitFor(() => expect(urls().some((u) => u === '/fleet/1/fuel?per_page=10000')).toBe(true));
  });

  it('requests analytics scoped to the vehicle', async () => {
    const { result } = renderHook(({ id }) => useVehicleDetail(id, () => {}), {
      initialProps: { id: 5 as string | number | null },
    });
    await waitFor(() => expect(urls().some((u) => u === '/fleet/5')).toBe(true));
    act(() => result.current.setActiveTab('analytics'));
    await waitFor(() => expect(urls().some((u) => u.includes('vehicle_id=5'))).toBe(true));
  });
});
