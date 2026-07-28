import { describe, it, expect } from 'vitest';
import { urgencyTierForDeadline } from '../serveMapOverlays';

describe('urgencyTierForDeadline', () => {
  const now = new Date('2026-07-28T12:00:00Z').getTime();

  it('returns "none" when there is no deadline', () => {
    expect(urgencyTierForDeadline(null, now)).toBe('none');
  });

  it('returns "critical" when the deadline is within 24 hours', () => {
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
});
