import { describe, it, expect } from 'vitest';
import { describeServeScheduleError } from './serveScheduleErrors';

function apiError(status: number, payload: any): Error & { status: number; payload: any } {
  return Object.assign(new Error('overlap'), { status, payload });
}

describe('describeServeScheduleError', () => {
  it('translates a 409 overlap into an actionable message', () => {
    const err = apiError(409, { error: 'overlap', conflicts: [{ id: 1 }] });
    expect(describeServeScheduleError(err).message).toBe(
      'That time conflicts with another scheduled attempt for this officer — pick a different slot or officer.',
    );
  });

  it('translates a 409 stale into an actionable message', () => {
    const err = apiError(409, { error: 'stale', current: { id: 1 } });
    expect(describeServeScheduleError(err).message).toBe(
      'This item was changed by someone else — refresh the page and try again.',
    );
  });

  it('passes through an unrelated error unchanged', () => {
    const err = apiError(403, { error: 'Insufficient role' });
    expect(describeServeScheduleError(err)).toBe(err);
  });

  it('passes through a network error (no status/payload) unchanged', () => {
    const err = new Error('Failed to fetch');
    expect(describeServeScheduleError(err)).toBe(err);
  });

  it('wraps a non-Error thrown value', () => {
    const result = describeServeScheduleError('boom');
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('boom');
  });
});
