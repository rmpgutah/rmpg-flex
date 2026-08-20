import { describe, it, expect } from 'vitest';
import { sliceByteRange } from '../src/utils/byteRange';

describe('sliceByteRange', () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // 10 bytes, total=10

  it('returns the full buffer when range is null', () => {
    const r = sliceByteRange(bytes, null);
    expect(Array.from(r.data)).toEqual(Array.from(bytes));
    expect(r.start).toBe(0);
    expect(r.end).toBe(9);
    expect(r.total).toBe(10);
  });

  it('slices a bounded range (bytes=2-4)', () => {
    const r = sliceByteRange(bytes, { start: 2, end: 4 });
    expect(Array.from(r.data)).toEqual([2, 3, 4]);
    expect(r.start).toBe(2);
    expect(r.end).toBe(4);
    expect(r.total).toBe(10);
  });

  it('slices an open-ended range (bytes=7-, end=-1 sentinel)', () => {
    const r = sliceByteRange(bytes, { start: 7, end: -1 });
    expect(Array.from(r.data)).toEqual([7, 8, 9]);
    expect(r.start).toBe(7);
    expect(r.end).toBe(9);
    expect(r.total).toBe(10);
  });

  it('clamps an end past the buffer length to the last valid byte', () => {
    const r = sliceByteRange(bytes, { start: 5, end: 999 });
    expect(Array.from(r.data)).toEqual([5, 6, 7, 8, 9]);
    expect(r.end).toBe(9);
  });
});
