import { describe, it, expect } from 'vitest';
import { formatAudioClock } from './formatAudioClock';

describe('formatAudioClock', () => {
  it('formats mm:ss', () => {
    expect(formatAudioClock(0)).toBe('0:00');
    expect(formatAudioClock(9)).toBe('0:09');
    expect(formatAudioClock(75)).toBe('1:15');
    expect(formatAudioClock(NaN)).toBe('0:00');
  });
});
