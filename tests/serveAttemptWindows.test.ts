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
    const out = selectWindows({ addressClass: 'business', clientBands: [], locationNote: null });
    expect(out.every((w) => w.authority === 'business default')).toBe(true);
    expect(out.map((w) => w.window)).toEqual(['09:30-11:30', '13:30-15:30']);
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
