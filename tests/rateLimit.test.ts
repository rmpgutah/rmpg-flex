import { describe, it, expect, vi } from 'vitest';
import { rateLimitAllow, rateLimitCount } from '../src/utils/rateLimit';

function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(key: string) { return store.get(key) ?? null; },
    async put(key: string, value: string) { store.set(key, value); },
    store,
  } as unknown as { get: (k: string) => Promise<string | null>; put: (k: string, v: string) => Promise<void>; store: Map<string, string> };
}

describe('rateLimitCount', () => {
  it('returns 0 for a bucket/window with no prior entries', async () => {
    const kv = fakeKv();
    expect(await rateLimitCount(kv as never, 'test-bucket', 60)).toBe(0);
  });

  it('returns the count rateLimitAllow already wrote to the same bucket/window', async () => {
    const kv = fakeKv();
    await rateLimitAllow(kv as never, 'test-bucket', 100, 60);
    await rateLimitAllow(kv as never, 'test-bucket', 100, 60);
    await rateLimitAllow(kv as never, 'test-bucket', 100, 60);
    expect(await rateLimitCount(kv as never, 'test-bucket', 60)).toBe(3);
  });

  it('does not itself increment the counter (read-only)', async () => {
    const kv = fakeKv();
    await rateLimitAllow(kv as never, 'test-bucket', 100, 60);
    await rateLimitCount(kv as never, 'test-bucket', 60);
    await rateLimitCount(kv as never, 'test-bucket', 60);
    expect(await rateLimitCount(kv as never, 'test-bucket', 60)).toBe(1);
  });

  it('fails open (returns 0) on a KV read error, matching rateLimitAllow\'s fail-open contract', async () => {
    const kv = { get: vi.fn().mockRejectedValue(new Error('KV down')) };
    expect(await rateLimitCount(kv as never, 'test-bucket', 60)).toBe(0);
  });

  it('reads the same window-bucketed key shape rateLimitAllow writes, so counts from different windows do not mix', async () => {
    const kv = fakeKv();
    // Directly seed a key for a DIFFERENT (much older) window than "now" —
    // rateLimitCount must compute the CURRENT window's key the same way
    // rateLimitAllow does, so a stale window's count is invisible.
    const staleWindowStart = Math.floor(Date.now() / 1000) - 10_000;
    kv.store.set(`rl:test-bucket:${staleWindowStart}`, '999');
    expect(await rateLimitCount(kv as never, 'test-bucket', 60)).toBe(0);
  });
});
