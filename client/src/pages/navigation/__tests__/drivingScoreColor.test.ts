import { describe, it, expect } from 'vitest';
import { harshEventColor } from '../drivingScoreColor';

describe('harshEventColor', () => {
  it('is green for 0-1 events', () => {
    expect(harshEventColor(0)).toBe('#22c55e');
    expect(harshEventColor(1)).toBe('#22c55e');
  });
  it('is amber for 2-5 events', () => {
    expect(harshEventColor(2)).toBe('#f59e0b');
    expect(harshEventColor(5)).toBe('#f59e0b');
  });
  it('is red for 6+ events', () => {
    expect(harshEventColor(6)).toBe('#ef4444');
    expect(harshEventColor(20)).toBe('#ef4444');
  });
});
