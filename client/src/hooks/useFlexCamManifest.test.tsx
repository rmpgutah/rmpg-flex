import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFlexCamManifest } from './useFlexCamManifest';

describe('useFlexCamManifest', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('fetches once and exposes the manifest', async () => {
    const manifest = { tripId: 1, channel: 'outside', clips: [], gaps: [], totalDurationMs: 0, stillDownloading: 0 };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(manifest))));
    const { result } = renderHook(() => useFlexCamManifest(1, 'outside'));
    await vi.waitFor(() => expect(result.current.manifest).toBeDefined());
    expect(result.current.manifest?.tripId).toBe(1);
  });

  it('polls every 10s while stillDownloading > 0, stops at 0', async () => {
    const calls = vi.fn();
    let stillDownloading = 3;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls();
      stillDownloading = Math.max(0, stillDownloading - 1);
      return new Response(JSON.stringify({ tripId: 1, channel: 'outside', clips: [], gaps: [], totalDurationMs: 0, stillDownloading }));
    }));
    renderHook(() => useFlexCamManifest(1, 'outside'));
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(3));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(4));
    // stillDownloading reached 0 — polling should stop
    await vi.advanceTimersByTimeAsync(15_000);
    expect(calls).toHaveBeenCalledTimes(4);
  });
});
