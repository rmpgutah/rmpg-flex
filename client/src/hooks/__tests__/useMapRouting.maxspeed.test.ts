import { describe, it, expect } from 'vitest';
import { pickCurrentSegmentLimit } from '../useMapRouting';

describe('pickCurrentSegmentLimit', () => {
  it('returns null for a missing or empty annotation', () => {
    expect(pickCurrentSegmentLimit(undefined as unknown as unknown[])).toBeNull();
    expect(pickCurrentSegmentLimit([])).toBeNull();
  });

  it('takes the FIRST segment, which is the one being driven now', () => {
    // useMapRouting recomputes from the unit's live origin, so index 0 is the
    // segment under the vehicle -- not the start of the original route.
    expect(pickCurrentSegmentLimit([
      { speed: 35, unit: 'mph' },
      { speed: 65, unit: 'mph' },
    ])).toBe(35);
  });

  it('converts km/h', () => {
    expect(pickCurrentSegmentLimit([{ speed: 56, unit: 'km/h' }])).toBe(35);
  });

  it('falls through to the next known segment when the first is unknown', () => {
    // A short unmapped stub at the origin must not blank the readout for a
    // whole route that is otherwise posted.
    expect(pickCurrentSegmentLimit([
      { unknown: true }, { unknown: true }, { speed: 45, unit: 'mph' },
    ])).toBe(45);
  });

  it('returns null when no segment has a known limit', () => {
    expect(pickCurrentSegmentLimit([{ unknown: true }, { none: true }])).toBeNull();
  });

  it('does not scan indefinitely for a limit far down the route', () => {
    // Only the near-term segments describe the road the unit is on.
    const ann = Array.from({ length: 50 }, () => ({ unknown: true }));
    ann.push({ speed: 70, unit: 'mph' } as never);
    expect(pickCurrentSegmentLimit(ann)).toBeNull();
  });
});
