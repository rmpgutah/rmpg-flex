import { describe, it, expect } from 'vitest';
import { capChunkCount, batchLimit } from '../src/utils/footage/pacing';

describe('capChunkCount', () => {
  it('passes through when the configured max is 0 (unlimited)', () => {
    expect(capChunkCount(5000, 0)).toBe(5000);
  });
  it('caps to the configured max when positive', () => {
    expect(capChunkCount(5000, 1100)).toBe(1100);
  });
  it('treats negative/NaN max as unlimited', () => {
    expect(capChunkCount(42, -1)).toBe(42);
    expect(capChunkCount(42, NaN)).toBe(42);
  });
});

describe('batchLimit', () => {
  it('clamps a configured value into [1, hardMax]', () => {
    expect(batchLimit(30, 50)).toBe(30);
    expect(batchLimit(999, 50)).toBe(50);
    expect(batchLimit(0, 50)).toBe(1);
  });
  it('falls back to the default when unset/NaN', () => {
    expect(batchLimit(undefined, 50, 30)).toBe(30);
    expect(batchLimit(NaN, 50, 30)).toBe(30);
  });
});
