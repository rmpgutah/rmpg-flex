// tests/serveAttemptWindows.test.ts
// ============================================================
// Attempt-window precedence (spec §3.2)
// ============================================================
// Precedence, descending:
//   1. client_attempt_schedule bands
//   2. location-note constraints
//   3. address_class defaults
//   4. generic doctrine (the residential default set)
// ============================================================

import { describe, it, expect } from 'vitest';
import { selectWindows, scheduleFitsDeadline } from '../src/utils/serveAttemptWindows';

describe('selectWindows precedence', () => {
  it('client bands win over everything', () => {
    const out = selectWindows({
      addressClass: 'business',
      clientBands: [{ start: '06:00', end: '09:00' }, { start: '18:00', end: '21:00' }],
      locationNote: { hours_start: '08:00', hours_end: '17:00' },
    });
    expect(out.map((w) => w.window)).toEqual(['06:00-09:00', '18:00-21:00']);
    expect(out.every((w) => w.authority === 'client-specified')).toBe(true);
  });

  it('falls to the location note when the client said nothing', () => {
    const out = selectWindows({
      addressClass: 'business',
      clientBands: [],
      locationNote: { hours_start: '08:00', hours_end: '17:00' },
    });
    expect(out.every((w) => w.authority === 'site note')).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it('uses business defaults for a confirmed business location', () => {
    // R4: `confirmed` is now an explicit input. The test's name always said
    // CONFIRMED; it just never had a way to say so. Same assertions.
    const out = selectWindows({
      addressClass: 'business', addressClassConfirmed: true,
      clientBands: [], locationNote: null,
    });
    expect(out.every((w) => w.authority === 'business default')).toBe(true);
    expect(out.map((w) => w.window)).toEqual(['09:30-11:30', '13:30-15:30']);
  });

  it('D-2 (R4): an UNCONFIRMED business class does NOT get business timing', () => {
    // The failure this pins: the model emits address_class "business" at 0.55
    // confidence for a duplex whose instructions mention a suite. Before this
    // fix that produced weekday 09:30-11:30 + 13:30-15:30 at a RESIDENCE — no
    // evening, no weekend, two attempts burned. Unconfirmed must fall to the
    // wider residential set.
    const unconfirmed = selectWindows({
      addressClass: 'business', addressClassConfirmed: false,
      clientBands: [], locationNote: null,
    });
    expect(unconfirmed.every((w) => w.authority === 'residential default')).toBe(true);
    expect(unconfirmed.some((w) => w.window === '17:00-20:30')).toBe(true);
    expect(unconfirmed.map((w) => w.window)).not.toContain('09:30-11:30');

    // Omitting the flag entirely must behave identically — a caller that
    // forgets it degrades in the SAFE direction, never the unsafe one.
    const omitted = selectWindows({ addressClass: 'business', clientBands: [], locationNote: null });
    expect(omitted).toEqual(unconfirmed);
  });

  it('R8: a location note with a start but no usable end never yields an inverted window', () => {
    // `end` defaulted to '17:00', so { hours_start: '18:00' } produced the
    // string '18:00-17:00'. That reached the officer AND appendAttemptSlot,
    // which wrote window_start='18:00', window_end='17:00' onto the schedule
    // row. Fall through to the address-class defaults instead.
    const out = selectWindows({
      addressClass: 'residential', addressClassConfirmed: false,
      clientBands: [], locationNote: { hours_start: '18:00' },
    });
    expect(out.every((w) => w.authority === 'residential default')).toBe(true);
    for (const w of out) {
      const [start, end] = w.window.split('-');
      expect(start < end).toBe(true);
    }
    expect(out.map((w) => w.window)).not.toContain('18:00-17:00');
  });

  it('R8: an equal start and end is rejected too (zero-length window)', () => {
    const out = selectWindows({
      addressClass: 'residential', clientBands: [],
      locationNote: { hours_start: '09:00', hours_end: '09:00' },
    });
    expect(out.every((w) => w.authority === 'residential default')).toBe(true);
  });

  it('R8: a malformed note time falls through rather than emitting garbage', () => {
    const out = selectWindows({
      addressClass: 'residential', clientBands: [],
      locationNote: { hours_start: 'morning', hours_end: 'evening' },
    });
    expect(out.every((w) => w.authority === 'residential default')).toBe(true);
  });

  it('R8: a WELL-FORMED note window is still honored (the guard is not over-broad)', () => {
    const out = selectWindows({
      addressClass: 'residential', clientBands: [],
      locationNote: { hours_start: '08:00', cutoff_time: '15:00' },
    });
    expect(out.map((w) => w.window)).toEqual(['08:00-15:00']);
    expect(out.every((w) => w.authority === 'site note')).toBe(true);
  });

  it('uses corporate office hours for an unconfirmed corporate location (suite + LLC)', () => {
    const out = selectWindows({
      addressClass: 'corporate', addressClassConfirmed: false,
      clientBands: [], locationNote: null,
    });
    expect(out.every((w) => w.authority === 'corporate default')).toBe(true);
    expect(out.map((w) => w.window)).toEqual(['09:30-11:30', '13:30-16:00']);
    expect(out.some((w) => w.window === '17:00-20:30')).toBe(false);
  });

  it('uses government counter hours, not residential evenings', () => {
    const out = selectWindows({
      addressClass: 'government', addressClassConfirmed: false,
      clientBands: [], locationNote: null,
    });
    expect(out.every((w) => w.authority === 'government default')).toBe(true);
    expect(out.map((w) => w.window)).toEqual(['08:30-11:30', '13:00-15:30']);
  });

  it('uses residential defaults for a residence', () => {
    const out = selectWindows({ addressClass: 'residential', clientBands: [], locationNote: null });
    expect(out.every((w) => w.authority === 'residential default')).toBe(true);
    expect(out.map((w) => w.window)).toEqual(['07:00-09:00', '11:00-13:00', '17:00-20:30']);
  });

  it('treats UNKNOWN as residential — the wider, safer set (D-2)', () => {
    const unknown = selectWindows({ addressClass: 'unknown', clientBands: [], locationNote: null });
    const residential = selectWindows({ addressClass: 'residential', clientBands: [], locationNote: null });
    // Compare full objects, not just time strings — authority attribution matters
    expect(unknown).toEqual(residential);
    // Explicit assertion so intent survives future refactors
    expect(unknown.every((w) => w.authority === 'residential default')).toBe(true);
  });

  it('every window carries an authority string so the report can say why', () => {
    const out = selectWindows({ addressClass: 'residential', clientBands: [], locationNote: null });
    expect(out.every((w) => typeof w.authority === 'string' && w.authority.length > 0)).toBe(true);
  });
});

describe('scheduleFitsDeadline', () => {
  it('is true when there are at least as many days as required bands', () => {
    expect(scheduleFitsDeadline(3, 5)).toBe(true);
    expect(scheduleFitsDeadline(3, 3)).toBe(true);
  });

  it('is false when the client demands more distinct days than remain', () => {
    expect(scheduleFitsDeadline(3, 2)).toBe(false);
  });

  it('is true when there is no deadline to violate', () => {
    expect(scheduleFitsDeadline(3, null)).toBe(true);
  });

  it('is false when the deadline has already passed', () => {
    expect(scheduleFitsDeadline(1, -1)).toBe(false);
  });
});
