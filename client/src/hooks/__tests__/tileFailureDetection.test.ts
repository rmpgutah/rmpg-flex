import { describe, it, expect } from 'vitest';
import { TileFailureTracker } from '../tileFailureDetection';

describe('TileFailureTracker', () => {
  it('is not degraded before any error', () => {
    const t = new TileFailureTracker(5000);
    expect(t.isDegraded(0)).toBe(false);
  });
  it('is not degraded immediately after one error', () => {
    const t = new TileFailureTracker(5000);
    t.recordError(1000);
    expect(t.isDegraded(1500)).toBe(false);
  });
  it('becomes degraded after errors persist past the threshold', () => {
    const t = new TileFailureTracker(5000);
    t.recordError(1000);
    expect(t.isDegraded(6001)).toBe(true);
  });
  it('recovers on a recorded success', () => {
    const t = new TileFailureTracker(5000);
    t.recordError(1000);
    t.recordSuccess();
    expect(t.isDegraded(10000)).toBe(false);
  });
});
