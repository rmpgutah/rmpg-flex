import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOptimizationV2 } from '../useOptimizationV2';

const FAKE_JOB_ID = 'test-job-id-1234';
const SOLUTION = { dropped: { services: [], shipments: [] }, routes: [] };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let pollCount = 0;

function makeFetchMock() {
  pollCount = 0;
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.includes('/optimization-v2/submit')) {
      return jsonResponse({ job_id: FAKE_JOB_ID, status: 'pending' }, 202);
    }
    if (url.includes(`/optimization-v2/${FAKE_JOB_ID}`)) {
      pollCount += 1;
      if (pollCount < 3) {
        return jsonResponse({ job_id: FAKE_JOB_ID, status: 'processing' });
      }
      return jsonResponse({ job_id: FAKE_JOB_ID, status: 'complete', solution: SOLUTION });
    }
    return jsonResponse({ error: 'not found' }, 404);
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', makeFetchMock());
  // shouldAdvanceTime lets waitFor / real promises still resolve while
  // setInterval stays under our control for poll cycle assertions.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useOptimizationV2', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useOptimizationV2());
    expect(result.current.status).toBe('idle');
    expect(result.current.solution).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('transitions: idle → pending → processing → complete', async () => {
    const { result } = renderHook(() => useOptimizationV2());

    await act(async () => {
      await result.current.submit({
        job_type: 'multi_unit_dispatch',
        call_ids: [1],
        unit_ids: [1],
      });
    });

    // After submit returns, polling has started; status should be processing
    expect(['pending', 'processing']).toContain(result.current.status);

    // Advance fake clock: 3 poll cycles at 3s each → 3rd poll returns complete
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(result.current.status).toBe('complete');
    expect(result.current.solution).toEqual(SOLUTION);
    expect(result.current.error).toBeNull();
  });

  it('surfaces error when poll returns error status', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/optimization-v2/submit')) {
        return jsonResponse({ job_id: FAKE_JOB_ID, status: 'pending' }, 202);
      }
      return jsonResponse({ job_id: FAKE_JOB_ID, status: 'error', error: 'timed_out' });
    }));

    const { result } = renderHook(() => useOptimizationV2());
    await act(async () => { await result.current.submit({ job_type: 'multi_unit_dispatch', call_ids: [1], unit_ids: [1] }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('timed_out');
  });

  it('reset() returns to idle and clears solution', async () => {
    const { result } = renderHook(() => useOptimizationV2());
    await act(async () => { await result.current.submit({ job_type: 'multi_unit_dispatch', call_ids: [1], unit_ids: [1] }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(result.current.status).toBe('complete');

    act(() => { result.current.reset(); });
    expect(result.current.status).toBe('idle');
    expect(result.current.solution).toBeNull();
  });

  it('elapsedMs increments while polling', async () => {
    const { result } = renderHook(() => useOptimizationV2());
    await act(async () => { await result.current.submit({ job_type: 'multi_unit_dispatch', call_ids: [1], unit_ids: [1] }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(result.current.elapsedMs).toBeGreaterThan(0);
  });
});
