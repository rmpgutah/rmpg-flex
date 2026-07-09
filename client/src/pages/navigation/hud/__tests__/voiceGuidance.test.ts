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

  it('announces "now" (not "in one mile") on a fresh start already close to the turn', () => {
    // Regression: a cold start (app mount mid-maneuver, or right after a
    // reroute) has an EMPTY alreadyAnnounced set even though distance is
    // already small. The smallest crossed threshold must win, not the
    // largest — otherwise a driver 20m from the turn hears "in one mile".
    const result = nextAnnouncement(
      { ...maneuver, distanceMetersRemaining: 20 },
      new Set(),
    );
    expect(result?.thresholdM).toBe(30);
    expect(result?.text).toContain('now');
    expect(result?.text).not.toContain('one mile');
  });
});
