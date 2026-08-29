import { describe, it, expect } from 'vitest';
import {
  clampDwellSeconds,
  parseHhMmRange,
  nextBandAfterAttempt,
  resolveServeWindow,
} from '../src/utils/serveStopTiming';

describe('clampDwellSeconds', () => {
  it('uses 18 min for a house and 22 min for a business (includes attempt-log time)', () => {
    expect(clampDwellSeconds('individual')).toBe(18 * 60);
    expect(clampDwellSeconds('business')).toBe(22 * 60);
  });

  it('clamps learned dwell into the type range without squeezing real 35-min visits', () => {
    expect(clampDwellSeconds('individual', 4 * 60)).toBe(8 * 60);
    expect(clampDwellSeconds('business', 90 * 60)).toBe(45 * 60);
    expect(clampDwellSeconds('business', 35 * 60)).toBe(35 * 60);
  });
});

describe('parseHhMmRange', () => {
  it('accepts hyphen and en-dash', () => {
    expect(parseHhMmRange('18:00-21:00')).toEqual({ start: '18:00', end: '21:00' });
    expect(parseHhMmRange('18:00–21:00')).toEqual({ start: '18:00', end: '21:00' });
  });
});

describe('nextBandAfterAttempt', () => {
  it('rotates a same-day afternoon no-answer to 18:00–21:00', () => {
    // 2026-08-28 20:30Z = 14:30 MDT
    expect(nextBandAfterAttempt('2026-08-28T20:30:00.000Z', '2026-08-28')).toEqual({
      start: '18:00',
      end: '21:00',
    });
  });
});

describe('resolveServeWindow', () => {
  it('prefers the logged next-attempt slot over anytime', () => {
    const win = resolveServeWindow({
      routeDate: '2026-08-28',
      nextAttemptDate: '2026-08-28',
      nextAttemptWindow: '18:00-21:00',
      timeWindow: 'anytime',
    });
    expect(win).toMatchObject({ start: '18:00', end: '21:00', source: 'schedule' });
  });

  it('infers evening from a prior afternoon attempt when no slot is stored', () => {
    const win = resolveServeWindow({
      routeDate: '2026-08-28',
      timeWindow: 'anytime',
      lastAttemptAt: '2026-08-28T20:30:00.000Z',
    });
    expect(win).toMatchObject({ start: '18:00', end: '21:00', source: 'last_attempt' });
  });

  it('does not import tomorrow morning onto tonight’s run', () => {
    const win = resolveServeWindow({
      routeDate: '2026-08-28',
      nextAttemptDate: '2026-08-29',
      nextAttemptWindow: '08:00-12:00',
      timeWindow: 'anytime',
    });
    expect(win).toBeNull();
  });
});
