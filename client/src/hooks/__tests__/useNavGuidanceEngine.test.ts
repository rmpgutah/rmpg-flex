// useNavGuidanceEngine — the app-wide (NavTripContext-hosted) turn-by-turn
// engine. These tests lock the contract that lets navigation survive page
// switches: route state lives in the hook (provider), progress updates come
// from plain updateOrigin() calls (no map needed), and stopGuidance clears.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNavGuidanceEngine, buildCongestionGradient } from '../useNavGuidanceEngine';

vi.mock('../../utils/mapboxApiKey', () => ({
  getMapboxAccessToken: vi.fn().mockResolvedValue('test-token'),
}));

// A straight ~2.2km north-south route in SLC (4 coords, 3 segments).
const COORDS: [number, number][] = [
  [-111.891, 40.760],
  [-111.891, 40.767],
  [-111.891, 40.774],
  [-111.891, 40.780],
];

function directionsResponse() {
  return {
    routes: [{
      duration: 300,
      distance: 2224,
      geometry: { type: 'LineString', coordinates: COORDS },
      legs: [{
        annotation: { congestion: ['low', 'moderate', 'heavy'] },
        steps: [
          { maneuver: { instruction: 'Head north', type: 'depart' }, distance: 1112 },
          { maneuver: { instruction: 'Arrive', type: 'arrive' }, distance: 1112 },
        ],
      }],
    }],
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => directionsResponse(),
  }) as any;
});

describe('useNavGuidanceEngine', () => {
  it('startGuidance fetches a route and exposes destination + route + render data', async () => {
    const { result } = renderHook(() => useNavGuidanceEngine());

    await act(async () => {
      await result.current.startGuidance('NAV', '450 S Main', 40.760, -111.891, 40.780, -111.891, '450 S Main');
    });

    expect(result.current.destination).toMatchObject({ label: '450 S Main', callNumber: '450 S Main' });
    expect(result.current.activeRoute?.steps).toHaveLength(2);
    expect(result.current.activeRoute?.trafficAware).toBe(true);
    expect(result.current.routeGeom?.coords).toHaveLength(4);
    expect(result.current.routeRender?.congestion).toEqual(['low', 'moderate', 'heavy']);
    expect(result.current.routeProgress?.fraction).toBe(0);
  });

  it('updateOrigin advances progress with no map attached (works from any page)', async () => {
    const { result } = renderHook(() => useNavGuidanceEngine());
    await act(async () => {
      await result.current.startGuidance('NAV', 'dest', 40.760, -111.891, 40.780, -111.891);
    });

    // Move roughly halfway up the route.
    act(() => { result.current.updateOrigin(40.770, -111.891); });

    await waitFor(() => {
      const p = result.current.routeProgress;
      expect(p).not.toBeNull();
      expect(p!.fraction).toBeGreaterThan(0.3);
      expect(p!.fraction).toBeLessThan(0.7);
      expect(p!.remainingMeters).toBeLessThan(2224);
    });
    expect(result.current.offRoute).toBe(false);
  });

  it('updateOrigin is a no-op before a destination is set', () => {
    const { result } = renderHook(() => useNavGuidanceEngine());
    act(() => { result.current.updateOrigin(40.770, -111.891); });
    expect(result.current.routeProgress).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('stopGuidance clears destination and all derived route state', async () => {
    const { result } = renderHook(() => useNavGuidanceEngine());
    await act(async () => {
      await result.current.startGuidance('NAV', 'dest', 40.760, -111.891, 40.780, -111.891);
    });
    act(() => { result.current.stopGuidance(); });

    expect(result.current.destination).toBeNull();
    expect(result.current.activeRoute).toBeNull();
    expect(result.current.routeProgress).toBeNull();
    expect(result.current.routeGeom).toBeNull();
    expect(result.current.routeRender).toBeNull();
    expect(result.current.getDestination()).toBeNull();
  });

  it('rejects invalid coordinates without touching state', async () => {
    const { result } = renderHook(() => useNavGuidanceEngine());
    await act(async () => {
      const r = await result.current.startGuidance('NAV', 'bad', 200, -111.891, 40.780, -111.891);
      expect(r).toBeNull();
    });
    expect(result.current.activeRoute).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('parses lane guidance from intersections[0].lanes when present, and leaves it undefined when absent', async () => {
    function directionsResponseWithLanes() {
      return {
        routes: [{
          duration: 300,
          distance: 2224,
          geometry: { type: 'LineString', coordinates: COORDS },
          legs: [{
            annotation: { congestion: ['low', 'moderate', 'heavy'] },
            steps: [
              {
                maneuver: { instruction: 'Turn left onto S Main St', type: 'turn', modifier: 'left' },
                distance: 1112,
                intersections: [{
                  lanes: [
                    { valid: true, active: false, indications: ['left'] },
                    { valid: true, active: true, indications: ['straight'] },
                    { valid: false, active: false, indications: ['right'] },
                    { active: false, indications: ['right'] } as any, // valid omitted entirely — must coerce to false, not undefined
                  ],
                }],
              },
              { maneuver: { instruction: 'Arrive', type: 'arrive' }, distance: 1112 },
            ],
          }],
        }],
      };
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => directionsResponseWithLanes(),
    }) as any;

    const { result } = renderHook(() => useNavGuidanceEngine());
    await act(async () => {
      await result.current.startGuidance('NAV', 'dest', 40.760, -111.891, 40.780, -111.891);
    });

    const steps = result.current.activeRoute?.steps;
    expect(steps).toHaveLength(2);

    // First step has lane data.
    expect(steps![0].lanes).toEqual([
      { valid: true, active: false, indications: ['left'] },
      { valid: true, active: true, indications: ['straight'] },
      { valid: false, active: false, indications: ['right'] },
      { valid: false, active: false, indications: ['right'] }, // coerced: missing valid -> false
    ]);

    // Second step (arrive) has no intersections/lanes in the fixture — must be undefined, not [].
    expect(steps![1].lanes).toBeUndefined();
  });
});

describe('useNavGuidanceEngine — multi-stop (startMultiStop / waypoint advance)', () => {
  // A 2-stop route: stop 1 sits at the midpoint of COORDS (~40.767,-111.891,
  // matching the single-destination test's "roughly halfway" fix), stop 2 at
  // the route's far end (40.780,-111.891). Both are within the module's
  // WAYPOINT_ARRIVAL_METERS (241m) of those exact coordinates when the GPS
  // fix lands exactly on them, so arrival is deterministic without needing
  // to know the constant's exact value from the test file.
  const waypoints = [
    { id: 'stop-1', lat: 40.767, lng: -111.891, label: 'Stop 1', completed: false },
    { id: 'stop-2', lat: 40.780, lng: -111.891, label: 'Stop 2', completed: false },
  ];

  it('startMultiStop routes to the first incomplete stop, exactly like startGuidance', async () => {
    const { result } = renderHook(() => useNavGuidanceEngine());

    await act(async () => {
      await result.current.startMultiStop('NAV', 40.760, -111.891, waypoints);
    });

    expect(result.current.waypoints).toHaveLength(2);
    expect(result.current.waypoints[0].completed).toBe(false);
    expect(result.current.destination).toMatchObject({ callNumber: 'stop-1', label: 'Stop 1' });
    expect(result.current.activeRoute).not.toBeNull();
  });

  it('advances to the next leg on arrival at an intermediate waypoint, then reaches final arrival like the single-destination path', async () => {
    const { result } = renderHook(() => useNavGuidanceEngine());

    await act(async () => {
      await result.current.startMultiStop('NAV', 40.760, -111.891, waypoints);
    });
    expect(result.current.destination?.callNumber).toBe('stop-1');

    // Simulate a GPS fix landing exactly on stop 1 — inside the arrival
    // radius. updateOrigin should mark stop 1 completed and re-invoke
    // routing toward stop 2 (the SAME startGuidance path a single-destination
    // reroute uses — no separate arrival codepath for intermediate stops).
    await act(async () => {
      result.current.updateOrigin(40.767, -111.891);
    });

    await waitFor(() => {
      expect(result.current.destination?.callNumber).toBe('stop-2');
    });
    expect(result.current.waypoints[0].completed).toBe(true);
    expect(result.current.waypoints[1].completed).toBe(false);
    // A fresh route was queried toward stop 2 — activeRoute/routeGeom exist
    // and progress resets, mirroring what startGuidance does on every call.
    expect(result.current.activeRoute).not.toBeNull();
    expect(result.current.routeProgress?.fraction).toBe(0);

    // Now simulate arrival at the FINAL waypoint (stop 2). Once all
    // waypoints are complete, updateOrigin must fall through to the exact
    // same code path a single-destination "arrived" fix takes: no further
    // startGuidance call, destination/routeGeom stay pointed at the last
    // leg, and routeProgress keeps updating via snapToRoute (this is what
    // lets NavigationPage's existing crow-flight "Arrived" banner fire
    // unmodified — see NavigationPage.tsx destCrowMi).
    const fetchCallsBeforeFinalArrival = (global.fetch as any).mock.calls.length;
    await act(async () => {
      result.current.updateOrigin(40.780, -111.891);
    });

    await waitFor(() => {
      const p = result.current.routeProgress;
      expect(p).not.toBeNull();
      expect(p!.fraction).toBeGreaterThan(0.9);
    });
    expect(result.current.waypoints.every((w) => w.completed)).toBe(true);
    // No new Directions fetch — arrival at the final stop is detected via
    // the ordinary snapToRoute progress math the single-destination path
    // already uses, not a fresh startGuidance() call.
    expect((global.fetch as any).mock.calls.length).toBe(fetchCallsBeforeFinalArrival);
    expect(result.current.destination?.callNumber).toBe('stop-2');
  });

  it('startMultiStop with an all-completed waypoint list clears any prior destination, mirroring stopGuidance', async () => {
    const { result } = renderHook(() => useNavGuidanceEngine());

    // Establish a prior single-destination route first.
    await act(async () => {
      await result.current.startGuidance('NAV', 'dest', 40.760, -111.891, 40.780, -111.891);
    });
    expect(result.current.destination).not.toBeNull();

    const allDone = waypoints.map((w) => ({ ...w, completed: true }));
    await act(async () => {
      await result.current.startMultiStop('NAV', 40.760, -111.891, allDone);
    });

    // Matches stopGuidance()'s full clear list — no stale destination from
    // the earlier session lingers.
    expect(result.current.destination).toBeNull();
    expect(result.current.activeRoute).toBeNull();
    expect(result.current.routeProgress).toBeNull();
    expect(result.current.routeGeom).toBeNull();
    expect(result.current.routeRender).toBeNull();
    expect(result.current.waypoints).toEqual([]);
    expect(result.current.getDestination()).toBeNull();
  });
});

describe('buildCongestionGradient', () => {
  it('builds a step expression with strictly increasing stops', () => {
    const expr = buildCongestionGradient([0, 100, 200, 300], 300, ['low', 'moderate', 'heavy']);
    expect(expr?.[0]).toBe('step');
    expect(expr!.length).toBeGreaterThanOrEqual(5);
  });

  it('returns null when a valid step expr cannot be formed', () => {
    expect(buildCongestionGradient([0], 100, ['low'])).toBeNull();
    expect(buildCongestionGradient([], 0, [])).toBeNull();
  });
});
