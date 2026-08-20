import { describe, it, expect } from 'vitest';
import { runNightlyBlotter } from '../src/utils/dailyReport/nightly';

function makeDb(datesWithData: Set<string>) {
  return {
    prepare(sql: string) {
      const ctx = { bindings: [] as unknown[] };
      const stmt = {
        bind(...args: unknown[]) { ctx.bindings = args; return stmt; },
        async all<T>(): Promise<{ results: T[] }> {
          // Bound start is 'YYYY-MM-DD HH:MM:SS'; the Denver day it belongs
          // to is the date part of the *local* day, so match on prefix of
          // either the bound start or the day before it (UTC offset).
          const start = String(ctx.bindings[0] ?? '');
          const hit = [...datesWithData].some((d) => start.startsWith(d));
          if (!hit || !/FROM calls_for_service/.test(sql)) return { results: [] };
          return { results: [{ call_number: 'C-1' }] as unknown as T[] };
        },
      };
      return stmt;
    },
  } as unknown as Parameters<typeof runNightlyBlotter>[0];
}

function makeBucket(existing: Set<string>) {
  const put: string[] = [];
  const bucket = {
    async head(key: string) { return existing.has(key) ? { key } : null; },
    async put(key: string) { put.push(key); existing.add(key); },
  } as unknown as Parameters<typeof runNightlyBlotter>[1];
  return { bucket, put };
}

// 2026-07-19 07:05 UTC === 2026-07-19 01:05 MDT, so "yesterday" is 07-18.
const NOW = Date.parse('2026-07-19T07:05:00Z');

describe('runNightlyBlotter', () => {
  it('generates yesterday when it has activity and is missing', async () => {
    const { bucket, put } = makeBucket(new Set());
    const res = await runNightlyBlotter(makeDb(new Set(['2026-07-18'])), bucket, NOW, 1);
    expect(res.generated).toEqual(['2026-07-18']);
    expect(put).toEqual(['daily-reports/2026/07/rmpg-daily-2026-07-18.pdf']);
  });

  it('skips a day that already has a report', async () => {
    const { bucket, put } = makeBucket(new Set(['daily-reports/2026/07/rmpg-daily-2026-07-18.pdf']));
    const res = await runNightlyBlotter(makeDb(new Set(['2026-07-18'])), bucket, NOW, 1);
    expect(res.generated).toEqual([]);
    expect(put).toEqual([]);
  });

  it('writes nothing for a day with no activity', async () => {
    const { bucket, put } = makeBucket(new Set());
    const res = await runNightlyBlotter(makeDb(new Set()), bucket, NOW, 1);
    expect(res.generated).toEqual([]);
    expect(put).toEqual([]);
    expect(res.skipped).toContain('2026-07-18');
  });

  it('backfills up to N missing days', async () => {
    const { bucket, put } = makeBucket(new Set());
    const res = await runNightlyBlotter(
      makeDb(new Set(['2026-07-18', '2026-07-16'])), bucket, NOW, 7,
    );
    expect(res.generated).toEqual(['2026-07-18', '2026-07-16']);
    expect(put).toHaveLength(2);
  });

  it('is bounded — never considers more than backfillDays', async () => {
    const { bucket } = makeBucket(new Set());
    const res = await runNightlyBlotter(makeDb(new Set()), bucket, NOW, 7);
    expect(res.skipped).toHaveLength(7);
  });
});
