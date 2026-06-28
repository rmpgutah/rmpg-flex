import { renderHook, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useIntelOverview } from '../useIntelOverview';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ({
    stats: { active_warrants: 11, on_watchlist: 7, gang_flagged: 4 },
    watchlist_activity: [], alerts: [], escalation_leaderboard: [],
    jail_cross_hits: [], plate_sightings: [],
    queues: { link_suggestions: 8, resolution_pairs: 4 },
    bolos: { active: 3, high_priority: 2 },
  })),
}));

describe('useIntelOverview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the overview payload', async () => {
    const { result } = renderHook(() => useIntelOverview());
    await waitFor(() => expect(result.current.data?.stats.active_warrants).toBe(11));
    expect(result.current.data?.queues.link_suggestions).toBe(8);
  });
});
