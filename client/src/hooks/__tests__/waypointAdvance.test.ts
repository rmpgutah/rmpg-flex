import { describe, it, expect } from 'vitest';
import { nextWaypointIndex, hasArrivedAtWaypoint, advanceWaypoint, type NavWaypoint } from '../waypointAdvance';

const waypoints: NavWaypoint[] = [
  { id: 1, lat: 40.76, lng: -111.89, label: 'Stop 1', completed: false },
  { id: 2, lat: 40.77, lng: -111.90, label: 'Stop 2', completed: false },
];
const RADIUS_M = 60;

describe('waypoint advance logic', () => {
  it('returns the first incomplete waypoint index', () => {
    expect(nextWaypointIndex(waypoints)).toBe(0);
  });
  it('returns null when all waypoints are completed', () => {
    const done = waypoints.map(w => ({ ...w, completed: true }));
    expect(nextWaypointIndex(done)).toBe(null);
  });
  it('detects arrival within the radius', () => {
    expect(hasArrivedAtWaypoint(waypoints, 40.76, -111.89, RADIUS_M)).toBe(true);
  });
  it('does not detect arrival when far away', () => {
    expect(hasArrivedAtWaypoint(waypoints, 41.0, -112.0, RADIUS_M)).toBe(false);
  });
  it('advances to the next waypoint immutably', () => {
    const advanced = advanceWaypoint(waypoints);
    expect(advanced[0].completed).toBe(true);
    expect(advanced[1].completed).toBe(false);
    expect(waypoints[0].completed).toBe(false);
  });
});
