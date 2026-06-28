import { describe, it, expect } from 'vitest';
import { darNumber, nextDarSeq, parseArr, summarizeDar } from '../src/utils/dar';

describe('dar utils', () => {
  it('darNumber zero-pads to 5', () => {
    expect(darNumber('26', 7)).toBe('26-DAR-00007');
    expect(darNumber('26', 12345)).toBe('26-DAR-12345');
  });

  it('nextDarSeq', () => {
    expect(nextDarSeq(null)).toBe(1);
    expect(nextDarSeq(undefined)).toBe(1);
    expect(nextDarSeq('26-DAR-00042')).toBe(43);
    expect(nextDarSeq('garbage')).toBe(1);
  });

  it('parseArr tolerates strings, arrays, junk', () => {
    expect(parseArr('[1,2]')).toEqual([1, 2]);
    expect(parseArr('nope')).toEqual([]);
    expect(parseArr([3])).toEqual([3]);
    expect(parseArr(null)).toEqual([]);
    expect(parseArr('{"a":1}')).toEqual([]); // object, not array
  });

  it('summarizeDar pluralizes and joins', () => {
    expect(summarizeDar({ calls: [1], incidents: [], citations: [1, 2], patrols: [] }))
      .toBe('1 call · 2 citations');
    expect(summarizeDar({ calls: [1, 2], incidents: [1], citations: [], patrols: [1, 2, 3] }))
      .toBe('2 calls · 1 incident · 3 patrol scans');
    expect(summarizeDar({ calls: [], incidents: [], citations: [], patrols: [] }))
      .toBe('No logged activity');
  });
});
