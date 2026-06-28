import { describe, it, expect } from 'vitest';
import { shouldRunSource, isSourceDue } from '../src/utils/screening/runScreeningScans';

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

describe('isSourceDue (per-source 6-month cadence)', () => {
  const now = Date.parse('2026-06-14T20:00:00Z');

  it('runs a brand-new source immediately (never scheduled)', () => {
    expect(isSourceDue(null, now)).toBe(true);
    expect(isSourceDue(undefined, now)).toBe(true);
    expect(isSourceDue('', now)).toBe(true);
  });
  it('skips a source whose next run is still in the future', () => {
    // scheduled ~6 months out
    expect(isSourceDue('2026-12-11 20:00:00', now)).toBe(false);
  });
  it('runs a source once its scheduled next run has passed', () => {
    expect(isSourceDue('2026-06-14 19:59:59', now)).toBe(true);
    expect(isSourceDue('2025-12-14 20:00:00', now)).toBe(true);
  });
  it('parses the D1 "YYYY-MM-DD HH:MM:SS" (UTC) datetime form', () => {
    // exactly now → due (<=)
    expect(isSourceDue('2026-06-14 20:00:00', now)).toBe(true);
  });
  it('force always runs regardless of schedule', () => {
    expect(isSourceDue('2099-01-01 00:00:00', now, true)).toBe(true);
  });
  it('fails open (runs) on an unparseable timestamp', () => {
    expect(isSourceDue('not-a-date', now)).toBe(true);
  });
});
