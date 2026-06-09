import { describe, it, expect } from 'vitest';
import { formatClock, formatArrival } from '../navTime';

// Build a Date with explicit LOCAL components so getHours() is deterministic.
function localAt(h: number, m: number, s = 0): Date {
  const d = new Date(2026, 5, 9, h, m, s);
  return d;
}

describe('navTime — formatClock', () => {
  it('24h vs 12h afternoon', () => {
    const d = localAt(14, 5, 9);
    expect(formatClock(d, '24h')).toBe('14:05');
    expect(formatClock(d, '12h')).toBe('2:05 PM');
  });
  it('seconds toggle', () => {
    const d = localAt(14, 5, 9);
    expect(formatClock(d, '24h', true)).toBe('14:05:09');
    expect(formatClock(d, '12h', true)).toBe('2:05:09 PM');
  });
  it('midnight + noon edge cases in 12h', () => {
    expect(formatClock(localAt(0, 0), '12h')).toBe('12:00 AM');
    expect(formatClock(localAt(12, 0), '12h')).toBe('12:00 PM');
  });
  it('invalid date', () => {
    expect(formatClock(new Date(NaN), '24h')).toBe('--:--');
  });
});

describe('navTime — formatArrival', () => {
  it('mirrors formatClock without seconds', () => {
    const d = localAt(9, 7);
    expect(formatArrival(d, '24h')).toBe('09:07');
    expect(formatArrival(d, '12h')).toBe('9:07 AM');
  });
});
