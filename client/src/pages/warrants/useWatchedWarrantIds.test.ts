import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import { useWatchedWarrantIds } from './useWatchedWarrantIds';

describe('useWatchedWarrantIds', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('fetches on mount and filters to entity_type=warrant', async () => {
    apiFetchMock.mockResolvedValue([
      { entity_type: 'warrant', entity_id: 10 },
      { entity_type: 'warrant', entity_id: 12 },
      { entity_type: 'person', entity_id: 900 },
    ]);
    const { result } = renderHook(() => useWatchedWarrantIds());
    await waitFor(() => expect(result.current.watchedIds.size).toBe(2));
    expect(result.current.watchedIds.has(10)).toBe(true);
    expect(result.current.watchedIds.has(12)).toBe(true);
    expect(result.current.watchedIds.has(900)).toBe(false);
    expect(apiFetchMock).toHaveBeenCalledWith('/intel/watchlist');
  });

  it('refresh() re-fetches and updates the set', async () => {
    apiFetchMock.mockResolvedValue([{ entity_type: 'warrant', entity_id: 10 }]);
    const { result } = renderHook(() => useWatchedWarrantIds());
    await waitFor(() => expect(result.current.watchedIds.size).toBe(1));

    apiFetchMock.mockResolvedValue([{ entity_type: 'warrant', entity_id: 10 }, { entity_type: 'warrant', entity_id: 11 }]);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.watchedIds.has(11)).toBe(true);
  });

  it('leaves watchedIds empty (not throwing) when the fetch fails', async () => {
    apiFetchMock.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useWatchedWarrantIds());
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(result.current.watchedIds.size).toBe(0);
  });
});
