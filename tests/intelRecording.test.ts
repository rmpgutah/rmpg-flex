import { describe, it, expect } from 'vitest';
import { chunkKey, parseSeq } from '../src/utils/intelRecording';

describe('chunkKey', () => {
  it('builds a stable R2 key per recording + sequence', () => {
    expect(chunkKey(42, 0)).toBe('interactions/42/0.webm');
    expect(chunkKey(42, 7)).toBe('interactions/42/7.webm');
  });
});

describe('parseSeq', () => {
  it('accepts non-negative integers', () => {
    expect(parseSeq('0')).toBe(0);
    expect(parseSeq('15')).toBe(15);
  });
  it('rejects junk and negatives', () => {
    expect(parseSeq('abc')).toBeNull();
    expect(parseSeq('-1')).toBeNull();
    expect(parseSeq('')).toBeNull();
    expect(parseSeq('1.5')).toBeNull();
  });
});
