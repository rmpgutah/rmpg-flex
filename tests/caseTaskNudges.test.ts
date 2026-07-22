import { describe, it, expect } from 'vitest';
import { classifyTaskDue } from '../src/utils/caseTaskNudges';

describe('classifyTaskDue', () => {
  it('returns null for a missing due date', () => {
    expect(classifyTaskDue(null, new Date())).toBeNull();
    expect(classifyTaskDue(undefined, new Date())).toBeNull();
  });

  it('does not flag a task overdue while it is still "today" in Denver (MDT / summer)', () => {
    // 2026-07-15T20:00 MDT (America/Denver, UTC-6) = 2026-07-16T02:00:00Z.
    // A task due 2026-07-15 is still due "tonight" in Denver at this moment —
    // the naive UTC parse of "2026-07-15T23:59:59" (no offset) treated this
    // as already 2h05m past the deadline and wrongly returned 'overdue'.
    const now = new Date('2026-07-16T02:00:00.000Z');
    expect(classifyTaskDue('2026-07-15', now)).toBe('due_soon');
  });

  it('does not flag a task overdue while it is still "today" in Denver (MST / winter)', () => {
    // 2026-01-15T20:00 MST (UTC-7) = 2026-01-16T03:00:00Z.
    const now = new Date('2026-01-16T03:00:00.000Z');
    expect(classifyTaskDue('2026-01-15', now)).toBe('due_soon');
  });

  it('flags a task overdue once its Denver-local end-of-day has actually passed', () => {
    // 2026-07-16T00:30 MDT = 2026-07-16T06:30:00Z, 30 min after the correct
    // 2026-07-15 05:59:59Z (23:59:59 MDT) Denver end-of-day deadline.
    const now = new Date('2026-07-16T06:30:00.000Z');
    expect(classifyTaskDue('2026-07-15', now)).toBe('overdue');
  });

  it('returns due_soon for a date within the next 24 hours', () => {
    const now = new Date('2026-07-15T12:00:00.000Z');
    expect(classifyTaskDue('2026-07-15', now)).toBe('due_soon');
  });

  it('returns null for a due date more than 24 hours out', () => {
    const now = new Date('2026-07-01T12:00:00.000Z');
    expect(classifyTaskDue('2026-07-15', now)).toBeNull();
  });

  it('returns null for an unparseable due date', () => {
    expect(classifyTaskDue('not-a-date', new Date())).toBeNull();
  });
});
