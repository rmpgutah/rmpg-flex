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
    ]);

    // Second step (arrive) has no intersections/lanes in the fixture — must be undefined, not [].
    expect(steps![1].lanes).toBeUndefined();
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
