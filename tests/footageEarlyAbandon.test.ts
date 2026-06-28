import { describe, it, expect } from 'vitest';
import { shouldEarlyAbandon } from '../src/utils/footage/earlyAbandon';

describe('shouldEarlyAbandon', () => {
  it('does not abandon when clips are returned (acquisition is still alive)', () => {
    expect(shouldEarlyAbandon({ clipCount: 1, maxChunkAttempts: 50, threshold: 10 })).toBe(false);
    expect(shouldEarlyAbandon({ clipCount: 5, maxChunkAttempts: 100, threshold: 10 })).toBe(false);
  });

  it('does not abandon when chunks are young, even with zero clips (give the camera a chance)', () => {
    expect(shouldEarlyAbandon({ clipCount: 0, maxChunkAttempts: 0, threshold: 10 })).toBe(false);
    expect(shouldEarlyAbandon({ clipCount: 0, maxChunkAttempts: 5, threshold: 10 })).toBe(false);
    expect(shouldEarlyAbandon({ clipCount: 0, maxChunkAttempts: 9, threshold: 10 })).toBe(false);
  });

  it('abandons when zero clips returned AND chunks have ≥threshold attempts', () => {
    expect(shouldEarlyAbandon({ clipCount: 0, maxChunkAttempts: 10, threshold: 10 })).toBe(true);
    expect(shouldEarlyAbandon({ clipCount: 0, maxChunkAttempts: 41, threshold: 10 })).toBe(true);
    expect(shouldEarlyAbandon({ clipCount: 0, maxChunkAttempts: 719, threshold: 10 })).toBe(true);
  });

  it('treats a negative or NaN attempts value as 0 (defensive)', () => {
    expect(shouldEarlyAbandon({ clipCount: 0, maxChunkAttempts: -1, threshold: 10 })).toBe(false);
    expect(shouldEarlyAbandon({ clipCount: 0, maxChunkAttempts: NaN, threshold: 10 })).toBe(false);
  });

  it('respects a custom threshold (different policy for different request types)', () => {
    expect(shouldEarlyAbandon({ clipCount: 0, maxChunkAttempts: 4, threshold: 5 })).toBe(false);
    expect(shouldEarlyAbandon({ clipCount: 0, maxChunkAttempts: 5, threshold: 5 })).toBe(true);
  });
});
