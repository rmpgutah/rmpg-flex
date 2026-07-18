import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('./useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import { useNavBadges } from './useNavBadges';

describe('useNavBadges', () => {
  beforeEach(() => { apiFetchMock.mockReset(); vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('aggregates counts from all five badge endpoints', async () => {
    apiFetchMock.mockImplementation((endpoint: string) => {
      if (endpoint === '/dispatch') return Promise.resolve({ calls: { active: 3 } });
      if (endpoint === '/comms/bolos/active') return Promise.resolve([{}, {}]);
      if (endpoint === '/email/unread-count') return Promise.resolve({ count: 7 });
      if (endpoint === '/dispatch/stats') return Promise.resolve({ active_warrants: 5 });
      if (endpoint === '/stats/dashboard') return Promise.resolve({ open_cases: 12, pending_serve: 4 });
      return Promise.reject(new Error('unexpected endpoint'));
    });
    const { result } = renderHook(() => useNavBadges(30000));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.badges).toEqual({
      activeCalls: 3, activeBOLOs: 2, unreadEmail: 7, activeWarrants: 5, openCases: 12, pendingServe: 4,
    });
  });

  it('silently omits a badge whose endpoint rejects, without failing the others', async () => {
    apiFetchMock.mockImplementation((endpoint: string) => {
      if (endpoint === '/dispatch') return Promise.reject(new Error('down'));
      if (endpoint === '/stats/dashboard') return Promise.resolve({ open_cases: 1, pending_serve: 0 });
      return Promise.resolve({});
    });
    const { result } = renderHook(() => useNavBadges(30000));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.badges.activeCalls).toBeUndefined();
    expect(result.current.badges.openCases).toBe(1);
  });
});
