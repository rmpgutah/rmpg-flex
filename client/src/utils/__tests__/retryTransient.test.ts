import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withOneRetry } from '../retryTransient';

describe('withOneRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn(async () => 'ok');
    const p = withOneRetry(fn);
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once after a transient failure and returns the second result', async () => {
    const fn = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('Request failed with status 404')) // transient edge blip
      .mockResolvedValueOnce('recovered');
    const p = withOneRetry(fn, 800);

    // Not resolved before the retry delay elapses.
    await vi.advanceTimersByTimeAsync(799);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('propagates the second failure (does NOT mask a genuine, persistent error)', async () => {
    const fn = vi.fn(async () => { throw new Error('Request failed with status 404'); });
    const p = withOneRetry(fn, 100);
    const assertion = expect(p).rejects.toThrow('Request failed with status 404');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(2); // tried twice, then gave up
  });
});
