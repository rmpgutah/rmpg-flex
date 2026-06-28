import { describe, it, expect } from 'vitest';
import { captureConflictClause } from '../src/routes/alpr';

// Regression guard for a live-only bug: SQLite throws
// "ON CONFLICT clause does not match any ... UNIQUE constraint" when the
// alpr_captures(capture_id) partial unique index is absent (pre-existing
// duplicate capture_id rows on live block its creation), and a PARTIAL index
// requires its predicate to be repeated in the conflict target. So the
// `/capture` INSERT may only emit the clause when the index exists, and it must
// include `WHERE capture_id IS NOT NULL`.
describe('captureConflictClause', () => {
  it('emits the predicate-matched ON CONFLICT clause when the unique index exists and capture_id is set', () => {
    expect(captureConflictClause(true, 'cap-123')).toBe(
      ' ON CONFLICT(capture_id) WHERE capture_id IS NOT NULL DO NOTHING',
    );
  });

  it('emits NO clause when the unique index is absent (legacy dupes on live) — avoids the throw', () => {
    expect(captureConflictClause(false, 'cap-123')).toBe('');
  });

  it('emits NO clause for a NULL capture_id even if the index exists (nothing to conflict on)', () => {
    expect(captureConflictClause(true, null)).toBe('');
  });

  it('emits NO clause when neither holds', () => {
    expect(captureConflictClause(false, null)).toBe('');
  });
});
