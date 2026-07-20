import { describe, it, expect, beforeEach } from 'vitest';
import { getClockFormat, setClockFormat } from './clockPreference';

describe('clockPreference', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to 24h', () => {
    expect(getClockFormat()).toBe('24h');
  });

  it('setClockFormat(12h) persists and getClockFormat reflects it', () => {
    setClockFormat('12h');
    expect(getClockFormat()).toBe('12h');
    expect(localStorage.getItem('rmpg_desktop_clock_format')).toBe('12h');
  });

  it('setClockFormat(24h) persists and getClockFormat reflects it', () => {
    setClockFormat('12h');
    setClockFormat('24h');
    expect(getClockFormat()).toBe('24h');
  });
});
