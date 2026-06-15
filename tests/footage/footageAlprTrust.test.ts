import { describe, it, expect } from 'vitest';
import { deriveFootageTrust } from '../../src/utils/footage/footageAlpr';

describe('deriveFootageTrust', () => {
  it('hard-caps a single read below the 0.85 accept gate even at model 0.99', () => {
    const t = deriveFootageTrust('A12BC', 0.99); // valid UT format, lone read
    expect(t.trustScore).toBeLessThanOrEqual(0.84);
    expect(t.accepted).toBe(false);
  });

  it('treats a malformed lone read as low trust', () => {
    const t = deriveFootageTrust('??', 0.95);
    expect(t.trustScore).toBeLessThan(0.6);
    expect(t.accepted).toBe(false);
  });

  it('passes the raw model pct through to trustScore as a tiebreaker only', () => {
    const hi = deriveFootageTrust('A12BC', 1.0);
    const lo = deriveFootageTrust('A12BC', 0.0);
    expect(hi.trustScore).toBeGreaterThanOrEqual(lo.trustScore);
    expect(hi.trustScore - lo.trustScore).toBeLessThanOrEqual(0.06);
  });
});
