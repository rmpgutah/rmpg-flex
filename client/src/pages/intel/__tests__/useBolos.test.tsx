import { renderHook, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useBolos } from '../useBolos';

const apiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...a: any[]) => apiFetch(...a) }));

describe('useBolos', () => {
  beforeEach(() => { apiFetch.mockReset(); });

  it('loads bolos from /comms/bolos', async () => {
    apiFetch.mockResolvedValueOnce([
      { id: 1, bolo_number: '26-BOLO-00001', type: 'person', status: 'active', title: 'Wanted', description: null,
        subject_description: 'Tall', vehicle_description: null, photo_url: null, priority: 'P1', issued_by: 5,
        issued_by_name: 'CZ', expires_at: null, created_at: '2026-06-13' },
    ]);
    const { result } = renderHook(() => useBolos());
    await waitFor(() => expect(result.current.bolos.length).toBe(1));
    expect(result.current.bolos[0].title).toBe('Wanted');
  });

  it('create POSTs to /comms/bolos then reloads', async () => {
    apiFetch.mockResolvedValueOnce([]);
    apiFetch.mockResolvedValueOnce({ id: 9 });
    apiFetch.mockResolvedValueOnce([{ id: 9, bolo_number: '26-BOLO-00009', type: 'vehicle', status: 'active',
      title: 'Red truck', description: null, subject_description: null, vehicle_description: 'Red F150',
      photo_url: null, priority: 'P2', issued_by: 5, issued_by_name: 'CZ', expires_at: null, created_at: 'x' }]);
    const { result } = renderHook(() => useBolos());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.create({ type: 'vehicle', title: 'Red truck', priority: 'P2' }); });
    expect(apiFetch).toHaveBeenCalledWith('/comms/bolos', expect.objectContaining({ method: 'POST' }));
    await waitFor(() => expect(result.current.bolos.some((b) => b.title === 'Red truck')).toBe(true));
  });
});
