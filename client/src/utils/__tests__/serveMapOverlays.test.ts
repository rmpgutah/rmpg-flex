import { describe, it, expect } from 'vitest';
import { urgencyTierForDeadline, isRiskFlagged, matchesDeadlineFilter } from '../serveMapOverlays';

describe('urgencyTierForDeadline', () => {
  const now = new Date('2026-07-28T12:00:00Z').getTime();

  it('returns "none" when there is no deadline', () => {
    expect(urgencyTierForDeadline(null, now)).toBe('none');
  });

  it('returns "critical" when the deadline is within 24 hours (ISO 8601)', () => {
    expect(urgencyTierForDeadline('2026-07-29T06:00:00Z', now)).toBe('critical');
  });

  it('returns "critical" when the deadline is already past', () => {
    expect(urgencyTierForDeadline('2026-07-27T00:00:00Z', now)).toBe('critical');
  });

  it('returns "warning" when the deadline is within 72 hours but past 24', () => {
    expect(urgencyTierForDeadline('2026-07-30T18:00:00Z', now)).toBe('warning');
  });

  it('returns "none" when the deadline is more than 72 hours out', () => {
    expect(urgencyTierForDeadline('2026-08-05T00:00:00Z', now)).toBe('none');
  });

  // Test timezone-naive format that parseTimestamp handles specially
  it('returns "critical" when the deadline is within 24 hours (timezone-naive space-separated format)', () => {
    // "2026-07-29 06:00:00" is treated as UTC by parseTimestamp (space-separated legacy format)
    expect(urgencyTierForDeadline('2026-07-29 06:00:00', now)).toBe('critical');
  });

  it('returns "warning" when the deadline is within 72 hours (timezone-naive space-separated format)', () => {
    // "2026-07-30 18:00:00" is treated as UTC by parseTimestamp
    expect(urgencyTierForDeadline('2026-07-30 18:00:00', now)).toBe('warning');
  });

  it('returns "critical" for unparseable deadline formats (fallback to current time)', () => {
    // parseTimestamp falls back to new Date() for invalid strings, making them urgent
    expect(urgencyTierForDeadline('not-a-date', now)).toBe('critical');
  });

  it('returns "none" when deadline is an empty string', () => {
    // Empty string is falsy, so it's treated like null/undefined
    expect(urgencyTierForDeadline('', now)).toBe('none');
  });
});

describe('isRiskFlagged', () => {
  it('flags urgent-priority items', () => {
    expect(isRiskFlagged({ priority: 'urgent', location_note_text: null })).toBe(true);
  });

  it('flags a location note containing a safety keyword', () => {
    expect(isRiskFlagged({ priority: 'normal', location_note_text: 'Officer safety: aggressive dog on premises' })).toBe(true);
  });

  it('does not flag a routine item with a benign note', () => {
    expect(isRiskFlagged({ priority: 'routine', location_note_text: 'Best served after 5pm' })).toBe(false);
  });

  it('does not flag when there is nothing notable', () => {
    expect(isRiskFlagged({ priority: 'normal', location_note_text: null })).toBe(false);
  });

  it('flags a safety keyword in service_instructions (ServeJob shape, no location_note_text)', () => {
    expect(isRiskFlagged({ priority: 'normal', service_instructions: 'Aggressive dog on property, use caution' })).toBe(true);
  });

  it('does not flag benign service_instructions', () => {
    expect(isRiskFlagged({ priority: 'routine', service_instructions: 'Gate code is 1234' })).toBe(false);
  });
});

describe('matchesDeadlineFilter', () => {
  const now = new Date('2026-07-28T12:00:00Z').getTime();

  it('"all" matches everything including no deadline', () => {
    expect(matchesDeadlineFilter(null, 'all', now)).toBe(true);
    expect(matchesDeadlineFilter('2026-09-01T00:00:00Z', 'all', now)).toBe(true);
  });

  it('"overdue" only matches past deadlines', () => {
    expect(matchesDeadlineFilter('2026-07-27T00:00:00Z', 'overdue', now)).toBe(true);
    expect(matchesDeadlineFilter('2026-07-29T00:00:00Z', 'overdue', now)).toBe(false);
  });

  it('"today" matches deadlines within 24 hours', () => {
    expect(matchesDeadlineFilter('2026-07-29T06:00:00Z', 'today', now)).toBe(true);
    expect(matchesDeadlineFilter('2026-07-30T06:00:00Z', 'today', now)).toBe(false);
  });

  it('"three_days" matches within 72 hours', () => {
    expect(matchesDeadlineFilter('2026-07-31T00:00:00Z', 'three_days', now)).toBe(true);
    expect(matchesDeadlineFilter('2026-08-02T00:00:00Z', 'three_days', now)).toBe(false);
  });

  it('"week" matches within 7 days', () => {
    expect(matchesDeadlineFilter('2026-08-03T00:00:00Z', 'week', now)).toBe(true);
    expect(matchesDeadlineFilter('2026-08-10T00:00:00Z', 'week', now)).toBe(false);
  });

  it('no-deadline items only match "all"', () => {
    expect(matchesDeadlineFilter(null, 'today', now)).toBe(false);
  });
});
