import { describe, it, expect } from 'vitest';
import { urgencyTierForDeadline, isRiskFlagged, successRateColor, centroidForGroup } from '../serveMapOverlays';

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
});

describe('successRateColor', () => {
  it('returns green for a high success rate', () => {
    expect(successRateColor({ zip: '84101', served: 9, failed: 1 })).toBe('#22c55e');
  });

  it('returns red for a low success rate', () => {
    expect(successRateColor({ zip: '84101', served: 1, failed: 9 })).toBe('#ef4444');
  });

  it('returns amber for a middling success rate', () => {
    expect(successRateColor({ zip: '84101', served: 5, failed: 5 })).toBe('#f59e0b');
  });

  it('returns gray when there is no data', () => {
    expect(successRateColor({ zip: '84101', served: 0, failed: 0 })).toBe('#6b7280');
  });
});

describe('centroidForGroup', () => {
  const items = [
    { recipient_city: 'Salt Lake City', recipient_lat: 40.7, recipient_lng: -111.9 },
    { recipient_city: 'Salt Lake City', recipient_lat: 40.8, recipient_lng: -111.8 },
    { recipient_city: 'Sandy', recipient_lat: 40.5, recipient_lng: -111.85 },
    { recipient_city: null, recipient_lat: 40.6, recipient_lng: -111.95 },
  ];

  it('averages lat/lng of matching items (case-insensitive)', () => {
    expect(centroidForGroup('salt lake city', items)).toEqual({ lat: 40.75, lng: -111.85 });
  });

  it('returns null when no items match the group key', () => {
    expect(centroidForGroup('Provo', items)).toBeNull();
  });

  it('returns null for an empty group key', () => {
    expect(centroidForGroup('', items)).toBeNull();
  });

  it('excludes items missing coordinates even if the city matches', () => {
    expect(centroidForGroup('Sandy', items)).toEqual({ lat: 40.5, lng: -111.85 });
  });
});
