import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useWakeLock } from '../useWakeLock';

let requestSpy: ReturnType<typeof vi.fn>;
let releaseSpy: ReturnType<typeof vi.fn>;

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
}

beforeEach(() => {
  releaseSpy = vi.fn().mockResolvedValue(undefined);
  requestSpy = vi.fn().mockResolvedValue({
    release: releaseSpy,
    addEventListener: vi.fn(),
  });
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request: requestSpy },
    configurable: true,
  });
  setVisibility('visible');
});

afterEach(() => {
  // @ts-expect-error cleanup
  delete navigator.wakeLock;
});

describe('useWakeLock', () => {
  it('acquires the lock when enabled and active', async () => {
    const { result } = renderHook(() => useWakeLock(true));
    await waitFor(() => expect(result.current.active).toBe(true));
    expect(requestSpy).toHaveBeenCalledWith('screen');
  });

  it('re-acquires on returning to visible', async () => {
    const { result } = renderHook(() => useWakeLock(true));
    await waitFor(() => expect(result.current.active).toBe(true));
    expect(requestSpy).toHaveBeenCalledTimes(1);

    // Simulate browser auto-release while hidden.
    act(() => {
      result.current.release();
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => {
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(requestSpy).toHaveBeenCalledTimes(2));
  });

  it('is a clean no-op when wakeLock is unsupported', async () => {
    // @ts-expect-error remove support
    delete navigator.wakeLock;
    const { result } = renderHook(() => useWakeLock(true));
    await Promise.resolve();
    expect(result.current.active).toBe(false);
  });
});
