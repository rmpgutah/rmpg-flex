import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock at the apiFetch boundary, not global fetch — apiFetch wraps fetch with
// AbortController/setTimeout timers that interact badly with vi.useFakeTimers()
// (the 60s timeout timer becomes a fake timer that doesn't fire, but its mere
// presence delays the microtask chain unpredictably in vitest). Mocking
// apiFetch directly removes the entire fetch/timer/retry/auth stack from the
// test surface so we can test the hook's polling logic in isolation.
const apiFetchMock = vi.fn();
vi.mock('./useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import { useFlexCamManifest } from './useFlexCamManifest';

describe('useFlexCamManifest', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('fetches once and exposes the manifest', async () => {
    const manifest = { tripId: 1, channel: 'outside', clips: [], gaps: [], totalDurationMs: 0, stillDownloading: 0 };
    apiFetchMock.mockResolvedValue(manifest);
    const { result } = renderHook(() => useFlexCamManifest(1, 'outside'));
    await vi.waitFor(() => expect(result.current.manifest).not.toBeNull());
    expect(result.current.manifest?.tripId).toBe(1);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it('polls every 10s while stillDownloading > 0, stops at 0', async () => {
    let stillDownloading = 3;
    apiFetchMock.mockImplementation(async () => {
      const snapshot = stillDownloading;
      stillDownloading = Math.max(0, stillDownloading - 1);
      return { tripId: 1, channel: 'outside', clips: [], gaps: [], totalDurationMs: 0, stillDownloading: snapshot };
    });
    renderHook(() => useFlexCamManifest(1, 'outside'));
    await vi.waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(3));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(4));
    // 4th response had stillDownloading=0 — polling should stop
    await vi.advanceTimersByTimeAsync(15_000);
    expect(apiFetchMock).toHaveBeenCalledTimes(4);
  });
});
