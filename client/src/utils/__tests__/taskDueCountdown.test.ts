import { describe, it, expect } from 'vitest';
import { describeDueDate, dueToneTextClass } from '../taskDueCountdown';

describe('describeDueDate', () => {
  // Pin "now" to noon Mountain Time on 2026-06-22 (a Monday) so the test
  // is timezone-independent. 12:00 MDT = 18:00 UTC.
  const NOW = new Date('2026-06-22T18:00:00Z');

  it('returns the em-dash sentinel for missing input', () => {
    expect(describeDueDate(null, NOW).label).toBe('—');
    expect(describeDueDate(undefined, NOW).label).toBe('—');
    expect(describeDueDate('', NOW).label).toBe('—');
    expect(describeDueDate('   ', NOW).label).toBe('—');
  });

  it('marks unknown when the input is not parseable as YYYY-MM-DD', () => {
    const r = describeDueDate('not a date', NOW);
    expect(r.tone).toBe('unknown');
    expect(r.daysDelta).toBeNull();
  });

  it('flags overdue dates with a day count', () => {
    const r = describeDueDate('2026-06-19', NOW);
    expect(r.tone).toBe('overdue');
    expect(r.daysDelta).toBe(-3);
    expect(r.label).toBe('OVERDUE 3d');
  });

  it('flags the current day as "Due today"', () => {
    const r = describeDueDate('2026-06-22', NOW);
    expect(r.tone).toBe('today');
    expect(r.daysDelta).toBe(0);
    expect(r.label).toBe('Due today');
  });

  it('flags tomorrow as "Due tomorrow"', () => {
    const r = describeDueDate('2026-06-23', NOW);
    expect(r.tone).toBe('tomorrow');
    expect(r.label).toBe('Due tomorrow');
  });

  it('uses a "Due in Nd" label for dates within the next week', () => {
    const r = describeDueDate('2026-06-27', NOW);
    expect(r.tone).toBe('soon');
    expect(r.daysDelta).toBe(5);
    expect(r.label).toBe('Due in 5d');
  });

  it('uses the absolute date for far-future tasks', () => {
    const r = describeDueDate('2026-07-15', NOW);
    expect(r.tone).toBe('later');
    expect(r.label).toBe('Due 2026-07-15');
  });

  it('tolerates a full ISO timestamp (date portion only)', () => {
    const r = describeDueDate('2026-06-22T08:00:00Z', NOW);
    expect(r.tone).toBe('today');
  });

  it('treats local-calendar day boundaries correctly in Mountain Time', () => {
    // 04:00 UTC on 2026-06-23 = 22:00 MDT 2026-06-22 (still "today" locally).
    const lateNight = new Date('2026-06-23T04:00:00Z');
    const r = describeDueDate('2026-06-22', lateNight);
    expect(r.tone).toBe('today');
  });
});

describe('dueToneTextClass', () => {
  it('returns a non-empty Tailwind token for every defined tone', () => {
    for (const tone of ['overdue', 'today', 'tomorrow', 'soon', 'later', 'unknown'] as const) {
      expect(dueToneTextClass(tone)).toMatch(/^text-/);
    }
  });
  it('falls back to a muted token for an unrecognised tone string', () => {
    // @ts-expect-error — exercise the runtime default branch.
    expect(dueToneTextClass('mystery')).toMatch(/^text-/);
  });
});
