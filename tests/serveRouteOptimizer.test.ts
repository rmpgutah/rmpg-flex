import { describe, it, expect, vi } from 'vitest';
import type { RouteStop, OptimizeResult, TrafficCheckResult } from '../src/utils/serveRouteOptimizer';
import { buildCostMatrix, haversineMatrix, haversineDurationSeconds, metresToDriveSeconds, deadlineCoefficient, applyTimeWindowPenalties, optimizeRoute, geocodeQualityScore, collectGeocodeWarnings, checkTrafficDegradation, denverWallClockToUtcMs, clampArrivalToServeWindow, resolveMapboxDirectionsToken, clampDepartAtForMapbox } from '../src/utils/serveRouteOptimizer';

const STOPS_3: RouteStop[] = [
  { jobId: 1, lat: 40.760, lng: -111.890, geocodeSource: 'point', deadlineAt: null, defendantType: 'individual', addressHash: 'a', defendant: 'A', address: '1 A St', locationNote: null },
  { jobId: 2, lat: 40.770, lng: -111.880, geocodeSource: 'point', deadlineAt: null, defendantType: 'individual', addressHash: 'b', defendant: 'B', address: '2 B St', locationNote: null },
  { jobId: 3, lat: 40.780, lng: -111.870, geocodeSource: 'point', deadlineAt: null, defendantType: 'business', addressHash: 'c', defendant: 'C Corp', address: '3 C Ave', locationNote: null },
];

describe('RouteStop type shape', () => {
  it('compiles with all required fields', () => {
    const stop: RouteStop = {
      jobId: 1,
      lat: 40.76,
      lng: -111.89,
      geocodeSource: 'point',
      deadlineAt: '2026-08-13T17:00:00Z',
      defendantType: 'individual',
      addressHash: 'abc123',
      defendant: 'Jane Smith',
      address: '123 Main St, Salt Lake City',
      locationNote: { serveStart: '08:00', serveEnd: '12:00' },
    };
    expect(stop.jobId).toBe(1);
  });
});

// Helper: build a fetch mock that returns a Directions API response for every call
function directionsOkMock(duration: number) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ routes: [{ duration }] }),
  } as unknown as Response);
}

describe('buildCostMatrix', () => {
  it('returns driving-traffic duration matrix when all calls succeed', async () => {
    // 3 stops → 3×2 = 6 ordered pairs
    global.fetch = directionsOkMock(120);

    const result = await buildCostMatrix(STOPS_3, '2026-08-12T07:00:00Z', 'sk.fake');
    expect(result.fallback).toBe(false);
    expect(result.matrix[0][0]).toBe(0);  // diagonal
    expect(result.matrix[0][1]).toBe(120);
    expect(result.matrix[1][0]).toBe(120);
    expect(result.matrix[1][2]).toBe(120);
  });

  it('calls the driving-traffic Directions API (not the Matrix API)', async () => {
    const fetchMock = directionsOkMock(100);
    global.fetch = fetchMock;

    await buildCostMatrix(STOPS_3, '2026-08-12T07:00:00Z', 'sk.fake');

    const firstUrl = (fetchMock.mock.calls[0][0] as string);
    expect(firstUrl).toContain('directions/v5/mapbox/driving-traffic');
    expect(firstUrl).toContain('depart_at=');
    expect(firstUrl).not.toContain('directions-matrix');
  });

  it('fires n×(n-1) parallel calls for n stops', async () => {
    const fetchMock = directionsOkMock(100);
    global.fetch = fetchMock;

    await buildCostMatrix(STOPS_3, '2026-08-12T07:00:00Z', 'sk.fake');
    // 3 stops → 3×2 = 6 pairs
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('falls back per-pair to haversine when a Directions call fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 } as unknown as Response)  // pair 0→1 fails
      .mockResolvedValue({ ok: true, json: async () => ({ routes: [{ duration: 120 }] }) } as unknown as Response);
    global.fetch = fetchMock;

    const result = await buildCostMatrix(STOPS_3, '2026-08-12T07:00:00Z', 'sk.fake');
    expect(result.fallback).toBe(true);    // at least one pair used haversine
    expect(result.matrix[0][1]).toBeGreaterThan(0);  // haversine fallback is non-zero
    expect(result.matrix[0][2]).toBe(120); // other pairs still got real durations
  });

  it('falls back to haversine with reason when token is empty string', async () => {
    global.fetch = vi.fn();
    const result = await buildCostMatrix(STOPS_3, '2026-08-12T07:00:00Z', '');
    expect(result.fallback).toBe(true);
    expect(result.reason).toBe('no token configured');
    expect((global.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('handles a single stop gracefully (no pairs needed)', async () => {
    global.fetch = vi.fn();
    const result = await buildCostMatrix([STOPS_3[0]], '2026-08-12T07:00:00Z', 'sk.fake');
    expect(result.matrix).toHaveLength(1);
    expect(result.matrix[0][0]).toBe(0);
    expect((global.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('scales to large stop counts without chunking', async () => {
    const bigStops: RouteStop[] = Array.from({ length: 10 }, (_, i) => ({
      jobId: i + 1,
      lat: 40.7 + i * 0.01,
      lng: -111.9 + i * 0.01,
      geocodeSource: 'point' as const,
      deadlineAt: null,
      defendantType: 'individual' as const,
      addressHash: String(i),
      defendant: `D${i}`,
      address: `${i} St`,
      locationNote: null,
    }));

    global.fetch = directionsOkMock(200);

    const result = await buildCostMatrix(bigStops, '2026-08-12T07:00:00Z', 'sk.fake');
    expect(result.matrix).toHaveLength(10);
    expect(result.matrix[0]).toHaveLength(10);
    expect(result.matrix[0][0]).toBe(0);
    expect(result.matrix[0][9]).toBe(200);
    expect(result.fallback).toBe(false);
    // 10×9 = 90 calls total, all in one batch (no chunking)
    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(90);
  });
});

describe('deadlineCoefficient', () => {
  const now = new Date('2026-08-12T08:00:00Z');

  it('returns 1.0 for deadline > 72 hours away', () => {
    const stop = { ...STOPS_3[0], deadlineAt: '2026-08-15T10:00:00Z' };
    expect(deadlineCoefficient(stop, now)).toBe(1.0);
  });

  it('returns 0.7 for deadline 24–72 hours away', () => {
    const stop = { ...STOPS_3[0], deadlineAt: '2026-08-13T10:00:00Z' };
    expect(deadlineCoefficient(stop, now)).toBe(0.7);
  });

  it('returns 0.4 for deadline < 24 hours away', () => {
    const stop = { ...STOPS_3[0], deadlineAt: '2026-08-12T20:00:00Z' };
    expect(deadlineCoefficient(stop, now)).toBe(0.4);
  });

  it('returns 0.1 for past-deadline stop', () => {
    const stop = { ...STOPS_3[0], deadlineAt: '2026-08-11T08:00:00Z' };
    expect(deadlineCoefficient(stop, now)).toBe(0.1);
  });

  it('returns 1.0 when deadlineAt is null', () => {
    const stop = { ...STOPS_3[0], deadlineAt: null };
    expect(deadlineCoefficient(stop, now)).toBe(1.0);
  });
});

describe('applyTimeWindowPenalties', () => {
  it('adds penalty when projected arrival falls outside serve window', () => {
    const stops: RouteStop[] = [
      { ...STOPS_3[0], locationNote: null },
      {
        ...STOPS_3[1],
        locationNote: { serveStart: '08:00', serveEnd: '08:05' }, // extremely tight window
      },
    ];
    const matrix = [[0, 300], [300, 0]]; // 5 min travel
    const departAt = '2026-08-12T09:00:00-06:00'; // 9 AM MDT — arrives at stop[1] at 9:05, outside 08:00–08:05
    const penalized = applyTimeWindowPenalties(matrix, stops, departAt, [0, 0]);
    expect(penalized[0][1]).toBeGreaterThan(matrix[0][1]);
  });

  it('does not penalize stops with no location note', () => {
    const stops = STOPS_3.map(s => ({ ...s, locationNote: null }));
    const matrix = [[0, 300, 600], [300, 0, 300], [600, 300, 0]];
    const penalized = applyTimeWindowPenalties(matrix, stops, '2026-08-12T08:00:00Z', [0, 0, 0]);
    expect(penalized).toEqual(matrix);
  });
});

describe('optimizeRoute', () => {
  it('returns an ordering of all stop indices', () => {
    const matrix = [[0, 100, 200], [100, 0, 100], [200, 100, 0]];
    const now = new Date('2026-08-12T08:00:00Z');
    const order = optimizeRoute(STOPS_3, matrix, '2026-08-12T08:00:00Z', now, [300, 300, 600]);
    expect(order).toHaveLength(3);
    expect(new Set(order).size).toBe(3);
  });

  it('places a critically overdue stop first regardless of geometry', () => {
    const stops: RouteStop[] = [
      { ...STOPS_3[0], deadlineAt: null },
      { ...STOPS_3[1], deadlineAt: null },
      { ...STOPS_3[2], deadlineAt: '2026-08-11T00:00:00Z' }, // past deadline
    ];
    // matrix is symmetric and uniform — geometry alone would give [0,1,2]
    const matrix = [[0, 100, 100], [100, 0, 100], [100, 100, 0]];
    const now = new Date('2026-08-12T08:00:00Z');
    const order = optimizeRoute(stops, matrix, '2026-08-12T08:00:00Z', now, [0, 0, 0]);
    expect(order[0]).toBe(2); // overdue stop must be first
  });
});

describe('haversineMatrix', () => {
  it('returns an n×n matrix of numbers', async () => {
    const { haversineMatrix } = await import('../src/utils/serveRouteOptimizer');
    const stops: RouteStop[] = [
      { jobId: 1, lat: 40.76, lng: -111.89, geocodeSource: 'point', deadlineAt: null, defendantType: 'individual', addressHash: 'a', defendant: 'A', address: '1 A St', locationNote: null },
      { jobId: 2, lat: 40.77, lng: -111.88, geocodeSource: 'point', deadlineAt: null, defendantType: 'individual', addressHash: 'b', defendant: 'B', address: '2 B St', locationNote: null },
      { jobId: 3, lat: 40.78, lng: -111.87, geocodeSource: 'point', deadlineAt: null, defendantType: 'business', addressHash: 'c', defendant: 'C Corp', address: '3 C Ave', locationNote: null },
    ];
    const matrix = haversineMatrix(stops);
    expect(matrix).toHaveLength(3);
    expect(matrix[0]).toHaveLength(3);
    expect(matrix[0][0]).toBe(0);
    expect(matrix[0][1]).toBeGreaterThan(0);
    expect(matrix[1][0]).toBeCloseTo(matrix[0][1], 0);
  });
});

describe('geocodeQualityScore', () => {
  it('returns high for point geocode', () => {
    expect(geocodeQualityScore({ ...STOPS_3[0], geocodeSource: 'point' })).toBe('high');
  });
  it('returns low for centroid geocode', () => {
    expect(geocodeQualityScore({ ...STOPS_3[0], geocodeSource: 'centroid' })).toBe('low');
  });
  it('returns low when geocodeSource is null (unverified pin)', () => {
    expect(geocodeQualityScore({ ...STOPS_3[0], geocodeSource: null })).toBe('low');
  });
});

describe('collectGeocodeWarnings', () => {
  it('includes centroid and null geocode sources', () => {
    const stops: RouteStop[] = [
      { ...STOPS_3[0], geocodeSource: 'point' },
      { ...STOPS_3[1], geocodeSource: 'centroid' },
      { ...STOPS_3[2], geocodeSource: null },
    ];
    const warnings = collectGeocodeWarnings(stops);
    expect(warnings.map((w) => w.jobId).sort()).toEqual([2, 3]);
  });

  it('returns empty array when all stops have high quality', () => {
    const stops = STOPS_3.map(s => ({ ...s, geocodeSource: 'point' as const }));
    expect(collectGeocodeWarnings(stops)).toHaveLength(0);
  });
});

describe('checkTrafficDegradation', () => {
  const origin = { lat: 40.755, lng: -111.895 };
  const originalEtas = [
    '2026-08-12T08:10:00Z',
    '2026-08-12T08:20:00Z',
    '2026-08-12T08:30:00Z',
  ];

  it('returns degraded:false when traffic is unchanged', async () => {
    // checkTrafficDegradation calls buildCostMatrix which now uses Directions API
    // (one call per ordered pair); return a modest duration so no >15min degradation
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ duration: 300 }] }),
    } as unknown as Response);

    const mockDb = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as D1Database;

    const result = await checkTrafficDegradation(
      STOPS_3,
      [0, 1, 2],
      origin,
      originalEtas,
      mockDb,
      'sk.fake'
    );
    expect(result.degraded).toBe(false);
    expect(result.addedMinutes).toBeLessThan(15);
  });

  it('returns degraded:true when total added time exceeds 15 minutes', async () => {
    // Return very high duration (35 min) so accumulated delay fires the degraded threshold
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ duration: 2100 }] }),
    } as unknown as Response);

    const mockDb = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as D1Database;

    const result = await checkTrafficDegradation(
      STOPS_3,
      [0, 1, 2],
      origin,
      originalEtas,
      mockDb,
      'sk.fake'
    );
    expect(result.degraded).toBe(true);
    expect(result.addedMinutes).toBeGreaterThanOrEqual(15);
  });

  it('returns matrixFallback:true when originalEtas is shorter than currentOrder', async () => {
    const mockDb = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as D1Database;

    const result = await checkTrafficDegradation(
      STOPS_3,
      [0, 1, 2],
      { lat: 40.755, lng: -111.895 },
      ['2026-08-12T08:10:00Z'], // only 1 ETA for 3 stops
      mockDb,
      'sk.fake'
    );
    expect(result.matrixFallback).toBe(true);
    expect(result.degraded).toBe(false);
  });

  it('returns matrixFallback:true and degraded:false when API calls all fail', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as unknown as Response);

    const mockDb = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as D1Database;

    const result = await checkTrafficDegradation(
      STOPS_3,
      [0, 1, 2],
      origin,
      originalEtas,
      mockDb,
      'sk.fake'
    );
    expect(result.matrixFallback).toBe(true);
    expect(result.degraded).toBe(false);
  });
});

describe('cost matrix units', () => {
  it('converts one road-mile of great-circle into ~3 minutes, not 1609 seconds', () => {
    const seconds = metresToDriveSeconds(1609.344);
    expect(seconds).toBeGreaterThan(180);
    expect(seconds).toBeLessThan(200);
  });

  it('does not treat a 30-mile haversine hop as half a day', () => {
    const a = { lat: 40.7608, lng: -111.8910 };
    const b = { lat: 40.333, lng: -111.8910 }; // ~30 mi due south
    const seconds = haversineDurationSeconds(a, b);
    expect(seconds).toBeGreaterThan(30 * 60);
    expect(seconds).toBeLessThan(3 * 3600);
  });
});

describe('Denver wall-clock conversion', () => {
  it('maps 14:30 MDT on 2026-08-28 to 20:30 UTC', () => {
    const ms = denverWallClockToUtcMs(2026, 7, 28, 14, 30);
    expect(new Date(ms).toISOString()).toBe('2026-08-28T20:30:00.000Z');
  });

  it('waits until the serve window opens', () => {
    const arriveEarly = Date.parse('2026-08-28T20:00:00.000Z'); // 14:00 MDT
    const clamped = clampArrivalToServeWindow(arriveEarly, '17:00', '21:00');
    expect(new Date(clamped).toISOString()).toBe('2026-08-28T23:00:00.000Z'); // 17:00 MDT
  });

  it('does not roll a missed morning window to +1d after a 6pm start', () => {
    const sixPmMdt = Date.parse('2026-08-29T00:00:00.000Z'); // 18:00 MDT Aug 28
    const clamped = clampArrivalToServeWindow(
      sixPmMdt + 15 * 60_000,
      '08:00',
      '12:00',
      '2026-08-29T00:00:00.000Z',
    );
    expect(clamped).toBe(sixPmMdt + 15 * 60_000);
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date(clamped)))
      .toBe('2026-08-28');
  });
});

describe('resolveMapboxDirectionsToken', () => {
  it('prefers MAPBOX_SECRET_TOKEN then MAPBOX_ACCESS_TOKEN', () => {
    expect(resolveMapboxDirectionsToken({ MAPBOX_SECRET_TOKEN: 'sk.a', MAPBOX_ACCESS_TOKEN: 'pk.b' })).toBe('sk.a');
    expect(resolveMapboxDirectionsToken({ MAPBOX_ACCESS_TOKEN: 'pk.b' })).toBe('pk.b');
    expect(resolveMapboxDirectionsToken({})).toBe('');
  });
});

describe('clampDepartAtForMapbox', () => {
  it('clamps a stale morning shift start to now', () => {
    const now = Date.parse('2026-08-28T23:18:00.000Z');
    expect(clampDepartAtForMapbox('2026-08-28T14:00:00.000Z', now)).toBe('2026-08-28T23:18:00.000Z');
  });
});

describe('applyTimeWindowPenalties Denver windows', () => {
  it('does not penalize an 08:00 MDT departure into an 08:00–17:00 window', () => {
    const stops: RouteStop[] = [
      { ...STOPS_3[0], locationNote: null },
      { ...STOPS_3[1], locationNote: { serveStart: '08:00', serveEnd: '17:00' } },
    ];
    const matrix = [[0, 300], [300, 0]];
    const penalized = applyTimeWindowPenalties(matrix, stops, '2026-08-12T14:00:00.000Z', [0, 0]);
    expect(penalized[0][1]).toBe(matrix[0][1]);
  });
});
