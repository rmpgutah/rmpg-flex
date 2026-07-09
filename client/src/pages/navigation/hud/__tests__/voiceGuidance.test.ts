import { describe, it, expect } from 'vitest';
import { nextAnnouncement } from '../voiceGuidance';

describe('nextAnnouncement', () => {
  const maneuver = { instruction: 'Turn right on Main Street', distanceMetersRemaining: 1600 };

  it('does not announce before the first threshold', () => {
    expect(nextAnnouncement({ ...maneuver, distanceMetersRemaining: 2000 }, new Set())).toBe(null);
  });

  it('announces the 1mi threshold once crossed', () => {
    const result = nextAnnouncement(maneuver, new Set());
    expect(result?.thresholdM).toBe(1609);
    expect(result?.text).toContain('one mile');
  });

  it('does not re-announce an already-announced threshold', () => {
    expect(nextAnnouncement(maneuver, new Set([1609]))).toBe(null);
  });

  it('announces the next threshold once distance closes further', () => {
    const result = nextAnnouncement(
      { ...maneuver, distanceMetersRemaining: 400 },
      new Set([1609, 805]),
    );
    expect(result?.thresholdM).toBe(402);
    expect(result?.text).toContain('quarter mile');
  });

  it('announces "now" at the final threshold', () => {
    const result = nextAnnouncement(
      { ...maneuver, distanceMetersRemaining: 20 },
      new Set([1609, 805, 402]),
    );
    expect(result?.thresholdM).toBe(30);
    expect(result?.text).toContain('now');
  });
});
