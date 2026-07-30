import { describe, it, expect } from 'vitest';
import { checkAndReserveCarxeCall, CARXE_MINUTE_BUDGET, type CarxeKvLike } from '../src/utils/carxe/rateLimit';

function makeMemoryKv(): CarxeKvLike {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe('carxe/rateLimit', () => {
  it('allows calls under the per-minute budget', async () => {
    const kv = makeMemoryKv();
    const now = 1_000_000;
    for (let i = 0; i < CARXE_MINUTE_BUDGET; i++) {
      const result = await checkAndReserveCarxeCall(kv, now);
      expect(result.allowed).toBe(true);
    }
  });

  it('rejects the call once the per-minute budget is exhausted', async () => {
    const kv = makeMemoryKv();
    const now = 2_000_000;
    for (let i = 0; i < CARXE_MINUTE_BUDGET; i++) {
      await checkAndReserveCarxeCall(kv, now);
    }
    const result = await checkAndReserveCarxeCall(kv, now);
    expect(result).toEqual({ allowed: false, reason: 'minute_limit' });
  });

  it('resets the budget in a new minute window', async () => {
    const kv = makeMemoryKv();
    const minuteOne = 3_000_000;
    for (let i = 0; i < CARXE_MINUTE_BUDGET; i++) {
      await checkAndReserveCarxeCall(kv, minuteOne);
    }
    const minuteTwo = minuteOne + 60_000;
    const result = await checkAndReserveCarxeCall(kv, minuteTwo);
    expect(result.allowed).toBe(true);
  });
});
