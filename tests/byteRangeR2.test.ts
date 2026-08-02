// Unit tests for the R2 range helpers in src/utils/byteRange.ts.
//
// Context: R2's get() THROWS on every unsatisfiable range rather than
// returning null (verified empirically against Miniflare/workerd 2026-08-02),
// so any route forwarding a client Range straight to R2 turned a malformed
// request into an HTTP 500. getR2Range() maps that throw to a value the
// caller can answer with 416.
import { describe, it, expect, vi } from 'vitest';
import {
  getR2Range,
  isUnsatisfiableRangeError,
  rangeNotSatisfiableInit,
  sliceByteRange,
} from '../src/utils/byteRange';

// The exact errors R2/workerd raises, reproduced from the live probe.
const NEGATIVE_LENGTH = new RangeError('Invalid range. Length (-5) must be greater than or equal to 0.');
const PAST_EOF = new Error('get: The requested range is not satisfiable (10039)');

function bucket(opts: {
  size?: number | null;
  throwOnGet?: Error;
  headThrows?: boolean;
} = {}) {
  const { size = 100, throwOnGet, headThrows } = opts;
  return {
    get: vi.fn(async () => {
      if (throwOnGet) throw throwOnGet;
      return size === null ? null : { size, body: 'data' };
    }),
    head: vi.fn(async () => {
      if (headThrows) throw new Error('head exploded');
      return size === null ? null : { size };
    }),
  } as unknown as R2Bucket;
}

describe('isUnsatisfiableRangeError', () => {
  it('recognises the negative-length RangeError', () => {
    expect(isUnsatisfiableRangeError(NEGATIVE_LENGTH)).toBe(true);
  });

  it('recognises the past-EOF 10039 error', () => {
    expect(isUnsatisfiableRangeError(PAST_EOF)).toBe(true);
  });

  it('does NOT swallow unrelated errors', () => {
    // Critical: a real R2 outage or auth failure must stay a 500, not be
    // silently downgraded to a 416 that hides the incident.
    expect(isUnsatisfiableRangeError(new Error('network unreachable'))).toBe(false);
    expect(isUnsatisfiableRangeError(new Error('Internal Server Error'))).toBe(false);
    expect(isUnsatisfiableRangeError('not an error')).toBe(false);
    expect(isUnsatisfiableRangeError(null)).toBe(false);
  });
});

describe('getR2Range', () => {
  it('returns the object on a satisfiable read', async () => {
    const b = bucket();
    const res = await getR2Range(b, 'k', { offset: 0, length: 10 });
    expect(res.kind).toBe('ok');
    expect(b.head).not.toHaveBeenCalled(); // happy path costs ONE R2 op
  });

  it('returns missing when the object does not exist', async () => {
    const res = await getR2Range(bucket({ size: null }), 'k');
    expect(res).toEqual({ kind: 'missing' });
  });

  it('maps a negative-length throw to unsatisfiable with the real total', async () => {
    const res = await getR2Range(bucket({ throwOnGet: NEGATIVE_LENGTH }), 'k', { offset: 10, length: -5 });
    expect(res).toEqual({ kind: 'unsatisfiable', total: 100 });
  });

  it('maps a past-EOF throw to unsatisfiable with the real total', async () => {
    const res = await getR2Range(bucket({ throwOnGet: PAST_EOF }), 'k', { offset: 99999 });
    expect(res).toEqual({ kind: 'unsatisfiable', total: 100 });
  });

  it('reports missing — not unsatisfiable — when the object is gone', async () => {
    // A range against a nonexistent object is a 404. "Unsatisfiable" only
    // means something relative to a real length.
    const b = bucket({ size: null, throwOnGet: PAST_EOF });
    expect(await getR2Range(b, 'k', { offset: 5 })).toEqual({ kind: 'missing' });
  });

  it('degrades to total:null when the fallback head() also fails', async () => {
    const b = bucket({ throwOnGet: PAST_EOF, headThrows: true });
    expect(await getR2Range(b, 'k', { offset: 5 })).toEqual({ kind: 'unsatisfiable', total: null });
  });

  it('rethrows errors that are not range problems', async () => {
    const boom = new Error('R2 is down');
    await expect(getR2Range(bucket({ throwOnGet: boom }), 'k')).rejects.toThrow('R2 is down');
  });
});

describe('rangeNotSatisfiableInit', () => {
  it('emits Content-Range: bytes */<size> per RFC 9110', () => {
    const init = rangeNotSatisfiableInit(4096);
    expect(init.status).toBe(416);
    expect(init.body).toEqual({ error: 'range not satisfiable' });
    expect(init.headers['Content-Range']).toBe('bytes */4096');
    expect(init.headers['Accept-Ranges']).toBe('bytes');
  });

  it('omits Content-Range rather than emitting a wrong one when size is unknown', () => {
    const init = rangeNotSatisfiableInit(null);
    expect(init.status).toBe(416);
    expect(init.headers['Content-Range']).toBeUndefined();
  });
});

describe('sliceByteRange (existing behaviour must not regress)', () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);

  it('returns the whole buffer with no range', () => {
    const r = sliceByteRange(bytes, null);
    expect(r).toMatchObject({ start: 0, end: 4, total: 5 });
    expect(Array.from(r.data)).toEqual([1, 2, 3, 4, 5]);
  });

  it('slices an explicit range inclusively', () => {
    const r = sliceByteRange(bytes, { start: 1, end: 3 });
    expect(Array.from(r.data)).toEqual([2, 3, 4]);
    expect(r).toMatchObject({ start: 1, end: 3, total: 5 });
  });

  it('treats a negative end as "to EOF"', () => {
    const r = sliceByteRange(bytes, { start: 2, end: -1 });
    expect(Array.from(r.data)).toEqual([3, 4, 5]);
    expect(r.end).toBe(4);
  });

  it('clamps an end past EOF', () => {
    const r = sliceByteRange(bytes, { start: 0, end: 999 });
    expect(r.end).toBe(4);
  });
});
