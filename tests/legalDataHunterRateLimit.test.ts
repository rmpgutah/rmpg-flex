import { describe, it, expect } from 'vitest';
import { checkAndReserveLdhCall, getLdhUsageToday, LDH_DAILY_BUDGET, LDH_MINUTE_BUDGET } from '../src/utils/legalDataHunter/rateLimit';

function makeFakeKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    _store: store,
  };
}

describe('checkAndReserveLdhCall', () => {
  it('allows a call when under both budgets', async () => {
    const kv = makeFakeKv();
    const result = await checkAndReserveLdhCall(kv, Date.parse('2026-07-17T12:00:00Z'));
    expect(result).toEqual({ allowed: true });
  });

  it('blocks once the per-minute budget is exhausted', async () => {
    const kv = makeFakeKv();
    const now = Date.parse('2026-07-17T12:00:00Z');
    for (let i = 0; i < LDH_MINUTE_BUDGET; i++) {
      const r = await checkAndReserveLdhCall(kv, now + i);
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkAndReserveLdhCall(kv, now + LDH_MINUTE_BUDGET);
    expect(blocked).toEqual({ allowed: false, reason: 'minute_limit' });
  });

  it('blocks once the daily budget is exhausted even across different minutes', async () => {
    const kv = makeFakeKv();
    const dayStart = Date.parse('2026-07-17T00:00:00Z');
    let allowedCount = 0;
    for (let i = 0; i < LDH_DAILY_BUDGET + 5; i++) {
      // Spread calls one full minute apart so the per-minute budget never trips.
      const r = await checkAndReserveLdhCall(kv, dayStart + i * 60_000);
      if (r.allowed) allowedCount++;
      else expect(r.reason).toBe('daily_limit');
    }
    expect(allowedCount).toBe(LDH_DAILY_BUDGET);
  });

  it('resets the minute budget on the next minute window', async () => {
    const kv = makeFakeKv();
    const now = Date.parse('2026-07-17T12:00:00Z');
    for (let i = 0; i < LDH_MINUTE_BUDGET; i++) {
      await checkAndReserveLdhCall(kv, now);
    }
    const nextMinute = now + 60_000;
    const r = await checkAndReserveLdhCall(kv, nextMinute);
    expect(r).toEqual({ allowed: true });
  });
});

describe('getLdhUsageToday', () => {
  it('reads back the same counter checkAndReserveLdhCall writes', async () => {
    const kv = makeFakeKv();
    const now = Date.parse('2026-07-17T12:00:00Z');
    await checkAndReserveLdhCall(kv, now);
    await checkAndReserveLdhCall(kv, now + 61_000);
    const usage = await getLdhUsageToday(kv, now + 62_000);
    expect(usage).toEqual({
      day: '2026-07-17',
      calls_today: 2,
      daily_budget: LDH_DAILY_BUDGET,
      minute_budget: LDH_MINUTE_BUDGET,
    });
  });

  it('reports zero with no counters', async () => {
    const usage = await getLdhUsageToday(makeFakeKv(), Date.parse('2026-07-17T12:00:00Z'));
    expect(usage.calls_today).toBe(0);
  });
});
