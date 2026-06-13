import { describe, it, expect } from 'vitest';
import { shouldRunSource } from '../src/utils/screening/runScreeningScans';

describe('shouldRunSource', () => {
  it('runs when no state row exists yet', () => {
    expect(shouldRunSource(null)).toBe(true);
  });
  it('never runs a deliberately disabled source', () => {
    expect(shouldRunSource({ enabled: 0, circuit_broken: 0, hours_since_run: 0 })).toBe(false);
  });
  it('runs a healthy enabled source', () => {
    expect(shouldRunSource({ enabled: 1, circuit_broken: 0, hours_since_run: 100 })).toBe(true);
  });
  it('skips a tripped source during the cooldown window', () => {
    expect(shouldRunSource({ enabled: 1, circuit_broken: 1, hours_since_run: 1 }, 3)).toBe(false);
  });
  it('allows a half-open retry after the cooldown elapses', () => {
    expect(shouldRunSource({ enabled: 1, circuit_broken: 1, hours_since_run: 5 }, 3)).toBe(true);
  });
  it('allows a half-open retry when last_run is unknown', () => {
    expect(shouldRunSource({ enabled: 1, circuit_broken: 1, hours_since_run: null }, 3)).toBe(true);
  });
});
