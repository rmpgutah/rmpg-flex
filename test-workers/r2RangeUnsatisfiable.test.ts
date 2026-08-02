// Miniflare/workerd test for getR2Range() against a REAL R2 binding.
//
// The unit tests in tests/byteRangeR2.test.ts assert the mapping using mocked
// errors. This file is the one that proves the premise those mocks are built
// on: that R2 actually throws for each of these ranges, and that the exact
// errors it throws are the ones isUnsatisfiableRangeError() recognises. If R2
// ever changed its behaviour (returning null instead of throwing, or a new
// error message), the mocked tests would keep passing while every route
// silently went back to 500 — this test is what catches that.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { getR2Range, isUnsatisfiableRangeError } from '../src/utils/byteRange';

const KEY = 'range-probe/object.bin';
const SIZE = 100;

describe('getR2Range against real R2', () => {
  let bucket: R2Bucket;

  beforeAll(async () => {
    bucket = (env as unknown as { UPLOADS: R2Bucket }).UPLOADS;
    await bucket.put(KEY, new Uint8Array(SIZE));
  });

  it('confirms R2 still THROWS on each unsatisfiable range (premise check)', async () => {
    const bad: [string, R2Range][] = [
      ['negative length', { offset: 10, length: -5 }],
      ['offset past EOF', { offset: 99999 }],
      ['offset past EOF with length', { offset: 99999, length: 10 }],
      ['offset exactly at EOF', { offset: SIZE }],
      ['zero length', { offset: 10, length: 0 }],
    ];
    for (const [label, range] of bad) {
      let thrown: unknown;
      try {
        await bucket.get(KEY, { range });
      } catch (err) {
        thrown = err;
      }
      expect(thrown, `${label} should throw`).toBeDefined();
      expect(isUnsatisfiableRangeError(thrown), `${label} should be classified`).toBe(true);
    }
  });

  it('converts every one of those into unsatisfiable with the real total', async () => {
    const ranges: R2Range[] = [
      { offset: 10, length: -5 },
      { offset: 99999 },
      { offset: 99999, length: 10 },
      { offset: SIZE },
      { offset: 10, length: 0 },
    ];
    for (const range of ranges) {
      const res = await getR2Range(bucket, KEY, range);
      expect(res).toEqual({ kind: 'unsatisfiable', total: SIZE });
    }
  });

  it('still serves satisfiable ranges normally', async () => {
    const ok = await getR2Range(bucket, KEY, { offset: 0, length: 10 });
    expect(ok.kind).toBe('ok');

    // Last readable byte — the off-by-one boundary against offset === SIZE above.
    const last = await getR2Range(bucket, KEY, { offset: SIZE - 1 });
    expect(last.kind).toBe('ok');

    // R2 clamps a length that runs past EOF rather than failing.
    const over = await getR2Range(bucket, KEY, { offset: 90, length: 1000 });
    expect(over.kind).toBe('ok');
  });

  it('returns missing for an absent object, with and without a range', async () => {
    expect((await getR2Range(bucket, 'no/such/key')).kind).toBe('missing');
    expect((await getR2Range(bucket, 'no/such/key', { offset: 0, length: 5 })).kind).toBe('missing');
    // Even a range that WOULD be unsatisfiable resolves to missing, because
    // 404 beats 416 when there is nothing to range over.
    expect((await getR2Range(bucket, 'no/such/key', { offset: 99999 })).kind).toBe('missing');
  });
});
