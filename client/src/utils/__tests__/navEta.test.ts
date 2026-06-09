import { describe, it, expect } from 'vitest';
import { etaCountdown, etaColor, arrivalDate } from '../navEta';

describe('navEta — etaCountdown MM:SS padding', () => {
  it('pads minutes and seconds', () => {
    expect(etaCountdown(65)).toBe('01:05');
    expect(etaCountdown(5)).toBe('00:05');
    expect(etaCountdown(600)).toBe('10:00');
    expect(etaCountdown(3725)).toBe('62:05');
  });
  it('clamps negative / invalid to 00:00', () => {
    expect(etaCountdown(-10)).toBe('00:00');
    expect(etaCountdown(NaN)).toBe('00:00');
  });
});

describe('navEta — etaColor threshold bands', () => {
  const GOLD = '#d4a017';
  const AMBER = '#c47f17';
  const RED = '#b3261e';
  it('defaults (red<=60, amber<=300)', () => {
    expect(etaColor(30)).toBe(RED);
    expect(etaColor(60)).toBe(RED);
    expect(etaColor(120)).toBe(AMBER);
    expect(etaColor(300)).toBe(AMBER);
    expect(etaColor(600)).toBe(GOLD);
  });
  it('custom thresholds', () => {
    expect(etaColor(15, { red: 10, amber: 30 })).toBe(AMBER);
    expect(etaColor(5, { red: 10, amber: 30 })).toBe(RED);
    expect(etaColor(45, { red: 10, amber: 30 })).toBe(GOLD);
  });
});

describe('navEta — arrivalDate', () => {
  it('adds remaining seconds to now', () => {
    const now = new Date(0);
    expect(arrivalDate(now, 90).getTime()).toBe(90_000);
  });
  it('ignores negative remaining', () => {
    const now = new Date(1000);
    expect(arrivalDate(now, -50).getTime()).toBe(1000);
  });
});
