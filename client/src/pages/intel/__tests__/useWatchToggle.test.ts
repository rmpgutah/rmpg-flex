import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { useWatchToggle } from '../useWatchToggle';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../../hooks/useApi', () => ({ apiFetch }));

describe('useWatchToggle', () => {
  it('optimistically toggles on, calls POST', async () => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({});
    const { result } = renderHook(() => useWatchToggle('person', 7, false));
    await act(async () => { await result.current.toggle(); });
    expect(result.current.watched).toBe(true);
    expect(apiFetch).toHaveBeenCalledWith('/intel/watchlist', expect.objectContaining({ method: 'POST' }));
  });

  it('toggles off, calls DELETE', async () => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({});
    const { result } = renderHook(() => useWatchToggle('person', 7, true));
    await act(async () => { await result.current.toggle(); });
    expect(result.current.watched).toBe(false);
    expect(apiFetch).toHaveBeenCalledWith('/intel/watchlist/person/7', expect.objectContaining({ method: 'DELETE' }));
  });

  it('rolls back on error and never rejects', async () => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async () => { throw new Error('nope'); });
    const { result } = renderHook(() => useWatchToggle('person', 7, false));
    let escaped = false;
    try { await result.current.toggle(); } catch { escaped = true; }
    expect(escaped).toBe(false);                  // toggle swallows the error
    expect(result.current.watched).toBe(false);   // …and rolls back the optimistic flip
  });
});
