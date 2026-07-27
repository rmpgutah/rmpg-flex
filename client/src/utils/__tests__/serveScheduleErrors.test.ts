import { describe, it, expect } from 'vitest';
import {
  describeConflicts,
  describeServeScheduleError,
  extractOverlapConflicts,
  type ScheduleConflict,
} from '../serveScheduleErrors';

// Mirrors what apiFetch throws: a plain Error with `.status` and `.payload`
// pinned on (client/src/hooks/useApi.ts).
function apiError(status: number, payload: unknown): Error {
  const e = new Error('boom') as Error & { status?: number; payload?: unknown };
  e.status = status;
  e.payload = payload;
  return e;
}

const conflict = (over: Partial<ScheduleConflict> = {}): ScheduleConflict => ({
  id: 7,
  scheduled_date: '2026-06-21',
  window_start: '08:00',
  window_end: '10:00',
  recipient_name: 'Jane Rodriguez',
  case_number: '240-1',
  ...over,
});

describe('extractOverlapConflicts', () => {
  it('returns the conflicts array on an overlap 409', () => {
    const err = apiError(409, { error: 'overlap', conflicts: [conflict()] });
    expect(extractOverlapConflicts(err)?.map((c) => c.id)).toEqual([7]);
  });

  it('returns an empty array when the 409 names no rows', () => {
    // Distinct from null: still an overlap, just nothing to display.
    expect(extractOverlapConflicts(apiError(409, { error: 'overlap' }))).toEqual([]);
  });

  it('returns null for the stale 409 so it is not mistaken for a double-book', () => {
    expect(extractOverlapConflicts(apiError(409, { error: 'stale' }))).toBeNull();
  });

  it.each([403, 404, 500])('returns null for a %d so it falls through to normal handling', (status) => {
    expect(extractOverlapConflicts(apiError(status, { error: 'nope' }))).toBeNull();
  });

  it('returns null for a network throw with no status', () => {
    expect(extractOverlapConflicts(new TypeError('Failed to fetch'))).toBeNull();
  });
});

describe('describeConflicts', () => {
  it('names the recipient and window', () => {
    expect(describeConflicts([conflict()]))
      .toBe('Already booked: Jane Rodriguez (08:00–10:00).');
  });

  it('falls back to the case number when there is no recipient', () => {
    expect(describeConflicts([conflict({ recipient_name: null })]))
      .toContain('240-1');
  });

  it('falls back to the slot id when neither is present', () => {
    expect(describeConflicts([conflict({ recipient_name: null, case_number: null })]))
      .toContain('slot #7');
  });

  it('caps the list at three and counts the remainder', () => {
    const many = [1, 2, 3, 4, 5].map((id) => conflict({ id, recipient_name: `P${id}` }));
    const msg = describeConflicts(many);
    expect(msg).toContain('P1');
    expect(msg).toContain('P3');
    expect(msg).not.toContain('P4');
    expect(msg).toContain('+2 more');
  });

  it('still says something useful for an unnamed conflict', () => {
    expect(describeConflicts([])).toMatch(/already has an attempt/i);
  });
});

describe('describeServeScheduleError', () => {
  it('rewrites the overlap code', () => {
    expect(describeServeScheduleError(apiError(409, { error: 'overlap' })).message)
      .toMatch(/conflicts with another scheduled attempt/i);
  });

  it('passes non-schedule errors through untouched', () => {
    const err = apiError(500, { error: 'Internal' });
    expect(describeServeScheduleError(err)).toBe(err);
  });
});
