import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNavFavorites } from '../useNavFavorites';

const mockApiFetch = vi.fn();
vi.mock('../useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const SEED = [{ id: 1, user_id: 7, label: 'HQ', lat: 40.76, lng: -111.89, address: null, created_at: '' }];

describe('useNavFavorites', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation((path: string, opts?: any) => {
      if (path === '/nav/favorites' && !opts) return Promise.resolve(SEED);
      return Promise.resolve({ success: true });
    });
  });

  it('fetches favorites on mount', async () => {
    const { result } = renderHook(() => useNavFavorites());
    await waitFor(() => expect(result.current.favorites).toHaveLength(1));
    expect(mockApiFetch).toHaveBeenCalledWith('/nav/favorites');
    expect(result.current.loading).toBe(false);
  });

  it('removes a favorite from local state immediately on delete', async () => {
    const { result } = renderHook(() => useNavFavorites());
    await waitFor(() => expect(result.current.favorites).toHaveLength(1));

    await act(async () => { await result.current.remove(1); });

    expect(result.current.favorites).toHaveLength(0);
    expect(mockApiFetch).toHaveBeenCalledWith('/nav/favorites/1', { method: 'DELETE' });
  });

  it('save() POSTs the new favorite and reloads the list', async () => {
    const { result } = renderHook(() => useNavFavorites());
    await waitFor(() => expect(result.current.favorites).toHaveLength(1));

    await act(async () => { await result.current.save('New Spot', 40.7, -111.9, '123 Main St'); });

    expect(mockApiFetch).toHaveBeenCalledWith('/nav/favorites', {
      method: 'POST',
      body: JSON.stringify({ label: 'New Spot', lat: 40.7, lng: -111.9, address: '123 Main St' }),
    });
    // reload() re-fetches — GET called at least twice (mount + after save)
    expect(mockApiFetch.mock.calls.filter((c) => c[0] === '/nav/favorites' && c.length === 1).length).toBeGreaterThanOrEqual(2);
  });
});
