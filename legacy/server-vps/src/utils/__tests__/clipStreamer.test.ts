// ============================================================
// clipStreamer — HTTP Range-aware streaming from StorageAdapter
// ============================================================
// AAR replay scrubbing depends on byte-range fetches: with Range
// support the browser pulls just the bytes for the seek target;
// without it, every seek downloads the whole clip from the start.
// 30 lines of code that change how professional the feature feels.
//
// Tests:
//   1. No Range header → full content, 200, Content-Length
//   2. Valid Range header → 206 Partial Content, sliced bytes
//   3. Bytes=N- (open-ended) → from N to EOF, 206
//   4. Bytes=0-N (head) → 206 with first N+1 bytes
//   5. Range past end → 416 Range Not Satisfiable
//   6. Malformed Range header → 200 full content (graceful)
// ============================================================

import { describe, it, expect } from 'vitest';
import { parseRangeHeader, computeRangeSlice } from '../clipStreamer';

describe('parseRangeHeader', () => {
  it('parses bytes=0-99', () => {
    expect(parseRangeHeader('bytes=0-99')).toEqual({ start: 0, end: 99 });
  });

  it('parses bytes=100- as open-ended', () => {
    expect(parseRangeHeader('bytes=100-')).toEqual({ start: 100, end: null });
  });

  it('parses bytes=-500 as suffix (last 500 bytes)', () => {
    expect(parseRangeHeader('bytes=-500')).toEqual({ start: null, end: 500 });
  });

  it('returns null for missing header', () => {
    expect(parseRangeHeader(undefined)).toBeNull();
    expect(parseRangeHeader('')).toBeNull();
  });

  it('returns null for malformed range', () => {
    expect(parseRangeHeader('bits=0-99')).toBeNull();
    expect(parseRangeHeader('bytes=abc-def')).toBeNull();
    expect(parseRangeHeader('bytes=')).toBeNull();
  });

  it('returns null for multi-range (we serve only single ranges)', () => {
    // Multi-range responses use multipart/byteranges — we don't bother.
    expect(parseRangeHeader('bytes=0-99,200-299')).toBeNull();
  });
});

describe('computeRangeSlice', () => {
  it('returns full slice when Range is null', () => {
    const result = computeRangeSlice(null, 1000);
    expect(result.start).toBe(0);
    expect(result.end).toBe(999);
    expect(result.length).toBe(1000);
    expect(result.partial).toBe(false);
  });

  it('returns partial slice for explicit start+end', () => {
    const result = computeRangeSlice({ start: 100, end: 199 }, 1000);
    expect(result.start).toBe(100);
    expect(result.end).toBe(199);
    expect(result.length).toBe(100);
    expect(result.partial).toBe(true);
  });

  it('handles open-ended (start, no end) by going to EOF', () => {
    const result = computeRangeSlice({ start: 500, end: null }, 1000);
    expect(result.start).toBe(500);
    expect(result.end).toBe(999);
    expect(result.length).toBe(500);
    expect(result.partial).toBe(true);
  });

  it('handles suffix (no start, end is suffix length)', () => {
    const result = computeRangeSlice({ start: null, end: 200 }, 1000);
    expect(result.start).toBe(800);
    expect(result.end).toBe(999);
    expect(result.length).toBe(200);
    expect(result.partial).toBe(true);
  });

  it('clips end to fileSize-1 when range exceeds file', () => {
    const result = computeRangeSlice({ start: 900, end: 9999 }, 1000);
    expect(result.start).toBe(900);
    expect(result.end).toBe(999);
    expect(result.length).toBe(100);
    expect(result.partial).toBe(true);
  });

  it('returns notSatisfiable when start is beyond file', () => {
    const result = computeRangeSlice({ start: 5000, end: null }, 1000);
    expect(result.notSatisfiable).toBe(true);
  });

  it('returns notSatisfiable when start > end', () => {
    const result = computeRangeSlice({ start: 500, end: 100 }, 1000);
    expect(result.notSatisfiable).toBe(true);
  });
});
