import { describe, it, expect } from 'vitest';
import { getGpsStaleness } from '../gpsStaleness';

describe('getGpsStaleness', () => {
  it('returns "ok" when gps_updated_at is missing', () => {
    expect(getGpsStaleness({ gps_updated_at: undefined, status: 'available' })).toBe('ok');
  });

  it('returns "ok" for an off-duty unit regardless of age', () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(getGpsStaleness({ gps_updated_at: old, status: 'off_duty' })).toBe('ok');
  });

  it('returns "ok" for a fix under 2 minutes old', () => {
    const recent = new Date(Date.now() - 30 * 1000).toISOString();
    expect(getGpsStaleness({ gps_updated_at: recent, status: 'available' })).toBe('ok');
  });

  it('returns "stale" for a fix between 2 and 5 minutes old', () => {
    const midAge = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    expect(getGpsStaleness({ gps_updated_at: midAge, status: 'available' })).toBe('stale');
  });

  it('returns "lost" for a fix over 5 minutes old', () => {
    const oldAge = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    expect(getGpsStaleness({ gps_updated_at: oldAge, status: 'available' })).toBe('lost');
  });
});
