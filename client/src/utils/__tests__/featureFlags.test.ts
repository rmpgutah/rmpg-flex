import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../hooks/useApi', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../../hooks/useApi';
import type * as FeatureFlagsModule from '../featureFlags';

let loadFeatureFlags: typeof FeatureFlagsModule.loadFeatureFlags;
let isFeatureEnabled: typeof FeatureFlagsModule.isFeatureEnabled;
let useFeatureFlags: typeof FeatureFlagsModule.useFeatureFlags;

describe('featureFlags', () => {
  beforeEach(async () => {
    vi.mocked(apiFetch).mockReset();
    // Module holds its cache at module scope; reset it fresh per test so
    // one test's loaded flags can't leak into the next (this mirrors the
    // isolation systemSettings-style caches otherwise lack test coverage for).
    vi.resetModules();
    const mod = await import('../featureFlags');
    loadFeatureFlags = mod.loadFeatureFlags;
    isFeatureEnabled = mod.isFeatureEnabled;
    useFeatureFlags = mod.useFeatureFlags;
  });

  it('isFeatureEnabled defaults to true before any load (fail-open)', () => {
    expect(isFeatureEnabled('/warrants')).toBe(true);
    expect(isFeatureEnabled('/some-unmapped-path')).toBe(true);
  });

  it('loadFeatureFlags populates the cache from GET /feature-flags', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      feature_warrants: true,
      feature_fleet: false,
      feature_evidence: true,
      feature_patrol_checkpoints: true,
    });
    await loadFeatureFlags();
    expect(isFeatureEnabled('/fleet')).toBe(false);
    expect(isFeatureEnabled('/warrants')).toBe(true);
  });

  it('soft-fails on a fetch error, leaving the previous (or default) state intact', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('network error'));
    await loadFeatureFlags();
    // Still fail-open — a fetch error must never hide a nav item.
    expect(isFeatureEnabled('/fleet')).toBe(true);
  });

  it('useFeatureFlags re-renders a consumer once the load completes', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      feature_warrants: true,
      feature_fleet: false,
      feature_evidence: true,
      feature_patrol_checkpoints: true,
    });
    const { result } = renderHook(() => {
      useFeatureFlags();
      return isFeatureEnabled('/fleet');
    });
    await act(async () => { await loadFeatureFlags(); });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('useFeatureFlags returns an incrementing tick each time flags reload', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ feature_warrants: true, feature_fleet: true, feature_evidence: true, feature_patrol_checkpoints: true });
    const { result } = renderHook(() => useFeatureFlags());
    const before = result.current;
    await act(async () => { await loadFeatureFlags(); });
    expect(result.current).toBeGreaterThan(before);
  });
});
