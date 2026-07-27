// ============================================================
// Serve Intake — client schedule parsing
// ============================================================
// The extractor emits client_attempt_schedule in a canonical
// 'HH:MM-HH:MM;HH:MM-HH:MM' form. This module turns that into bands the
// window planner can schedule against. Fails CLOSED: anything it cannot
// parse yields [] so the caller falls back to address-class defaults
// rather than inventing an attempt window.
// ============================================================

import { describe, it, expect } from 'vitest';
import { parseClientBands, parseAllowedDays } from '../src/utils/serveScheduleParse';

describe('parseClientBands', () => {
  it('parses the canonical three-band form', () => {
    expect(parseClientBands('06:00-09:00;09:00-18:00;18:00-21:00')).toEqual([
      { start: '06:00', end: '09:00' },
      { start: '09:00', end: '18:00' },
      { start: '18:00', end: '21:00' },
    ]);
  });

  it('parses a single band', () => {
    expect(parseClientBands('09:00-15:30')).toEqual([{ start: '09:00', end: '15:30' }]);
  });

  it('tolerates whitespace and an en-dash separator', () => {
    expect(parseClientBands(' 07:00 – 09:00 ; 17:00-20:30 ')).toEqual([
      { start: '07:00', end: '09:00' },
      { start: '17:00', end: '20:30' },
    ]);
  });

  it('drops a band whose end is not after its start', () => {
    expect(parseClientBands('09:00-09:00;10:00-08:00;11:00-13:00')).toEqual([
      { start: '11:00', end: '13:00' },
    ]);
  });

  it('drops an out-of-range clock value rather than clamping it', () => {
    expect(parseClientBands('25:00-26:00;11:00-13:00')).toEqual([
      { start: '11:00', end: '13:00' },
    ]);
  });

  it('returns empty for unparseable free text — fail closed', () => {
    expect(parseClientBands('mornings are best')).toEqual([]);
    expect(parseClientBands('')).toEqual([]);
  });
});

describe('parseAllowedDays', () => {
  // 0=Sun .. 6=Sat, matching Date#getDay and the planner's existing convention.
  it('maps "all" to every day', () => {
    expect(parseAllowedDays('all')).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('maps "no_sunday" to every day except Sunday', () => {
    expect(parseAllowedDays('no_sunday')).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('maps "weekdays" to Monday through Friday', () => {
    expect(parseAllowedDays('weekdays')).toEqual([1, 2, 3, 4, 5]);
  });

  it('maps a single named day', () => {
    expect(parseAllowedDays('friday')).toEqual([5]);
    expect(parseAllowedDays('SATURDAY')).toEqual([6]);
  });

  it('returns null when it cannot tell — caller keeps its own default', () => {
    expect(parseAllowedDays('')).toBeNull();
    expect(parseAllowedDays('whenever')).toBeNull();
  });
});
