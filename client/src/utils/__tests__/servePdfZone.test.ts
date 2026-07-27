// ============================================================
// withZone — zone labelling on printed attempt times
// ============================================================
// Notices are recipient- and court-facing, and serve jobs routinely cross
// jurisdictions (the Clough notice is a Utah address served for a Queens
// County, NY case). A bare "07:35" does not say Mountain or Eastern, and the
// reader cannot resolve it -- the same ambiguity that produced the 6-hour
// regression this very column suffered.
// ============================================================

import { describe, it, expect } from 'vitest';
import { withZone, attemptWindow } from '../servePdfGenerator';

describe('withZone', () => {
  it('stamps the display zone onto a bare 24h time', () => {
    expect(withZone('07:35')).toBe('07:35 MT');
    expect(withZone('19:52')).toBe('19:52 MT');
  });

  it('leaves empty empty so the caller EMPTY placeholder still applies', () => {
    expect(withZone('')).toBe('');
    expect(withZone('   ')).toBe('');
    expect(withZone(undefined as unknown as string)).toBe('');
  });

  it('never double-stamps a value that already carries a zone', () => {
    expect(withZone('07:35 MT')).toBe('07:35 MT');
    expect(withZone('07:35 MDT')).toBe('07:35 MDT');
    expect(withZone('07:35 MST')).toBe('07:35 MST');
  });

  it('still stamps a 12-hour time — AM/PM fixes the hour, not the zone', () => {
    // "07:35 AM" does not say Mountain or Eastern. On a Utah address served
    // for a Queens County case that is precisely the open question, so the
    // meridiem is not a substitute for the zone.
    expect(withZone('7:35 AM')).toBe('7:35 AM MT');
    expect(withZone('7:35 PM')).toBe('7:35 PM MT');
  });

  it('trims incidental whitespace', () => {
    expect(withZone('  07:35  ')).toBe('07:35 MT');
  });
});

// ── Diligence windows ─────────────────────────────────────────
// Diligence on a serve job is written as time windows -- "1 attempt between
// 7AM and 9AM, 1 between 9AM and 7PM, 1 between 7PM and 9PM" is a live
// instruction on these jobs. The WINDOW column exists so a reader can see
// whether the hours were actually varied, instead of doing the arithmetic
// across a column of raw clock times.
describe('attemptWindow', () => {
  it('buckets 24-hour times', () => {
    expect(attemptWindow('07:35')).toBe('EARLY');
    expect(attemptWindow('13:10')).toBe('DAY');
    expect(attemptWindow('19:52')).toBe('EVENING');
  });

  it('is unaffected by the zone suffix the same column carries', () => {
    expect(attemptWindow('07:35 MT')).toBe('EARLY');
    expect(attemptWindow('19:52 MT')).toBe('EVENING');
  });

  it('honours a 12-hour value if one was supplied', () => {
    expect(attemptWindow('7:35 PM')).toBe('EVENING');   // 19:35, not 07:35
    expect(attemptWindow('7:35 AM')).toBe('EARLY');
    expect(attemptWindow('12:15 AM')).toBe('EARLY');    // midnight hour, not noon
    expect(attemptWindow('12:15 PM')).toBe('DAY');
  });

  it('holds at the boundaries', () => {
    expect(attemptWindow('08:59')).toBe('EARLY');
    expect(attemptWindow('09:00')).toBe('DAY');
    expect(attemptWindow('18:59')).toBe('DAY');
    expect(attemptWindow('19:00')).toBe('EVENING');
  });

  it('asserts nothing when no time was recorded', () => {
    // Falls back to the table's empty-cell convention rather than claiming a
    // window the record does not support.
    expect(attemptWindow('')).toBe('');
    expect(attemptWindow('   ')).toBe('');
    expect(attemptWindow('unknown')).toBe('');
    expect(attemptWindow(undefined as unknown as string)).toBe('');
  });
});
