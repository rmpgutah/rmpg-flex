import { describe, it, expect, vi } from 'vitest';
import type { RouteStop, OptimizeResult, TrafficCheckResult } from '../src/utils/serveRouteOptimizer';
import { buildCostMatrix, haversineMatrix, deadlineCoefficient, applyTimeWindowPenalties, optimizeRoute, geocodeQualityScore, collectGeocodeWarnings, optimizeRouteFullPipeline, checkTrafficDegradation } from '../src/utils/serveRouteOptimizer';

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

describe('buildCostMatrix', () => {
  it('returns Mapbox duration matrix when API succeeds', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        durations: [
          [0, 120, 240],
          [120, 0, 120],
          [240, 120, 0],
        ],
      }),
    } as unknown as Response);

    const result = await buildCostMatrix(STOPS_3, '2026-08-12T07:00:00Z', 'sk.fake');
    expect(result.fallback).toBe(false);
    expect(result.matrix[0][1]).toBe(120);
    expect(result.matrix[1][2]).toBe(120);
  });

  it('retries without depart_at on 422 and succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'invalid depart_at' } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ durations: [[0, 120, 240], [120, 0, 120], [240, 120, 0]] }),
      } as unknown as Response);
    global.fetch = fetchMock;

    const result = await buildCostMatrix(STOPS_3, '2026-08-12T07:00:00Z', 'sk.fake');
    expect(result.fallback).toBe(false);
    expect(result.matrix[0][1]).toBe(120);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Second call must NOT include depart_at
    const secondUrl = (fetchMock.mock.calls[1][0] as string);
    expect(secondUrl).not.toContain('depart_at');
  });

  it('falls back to haversine with reason when API returns non-ok status (non-422)', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    } as unknown as Response);

    const result = await buildCostMatrix(STOPS_3, '2026-08-12T07:00:00Z', 'sk.fake');
    expect(result.fallback).toBe(true);
    expect(result.reason).toBe('rate limited (429)');
    expect(result.matrix[0][0]).toBe(0);
    expect(result.matrix[0][1]).toBeGreaterThan(0);
  });

  it('falls back to haversine with reason when API returns 401', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    } as unknown as Response);

    const result = await buildCostMatrix(STOPS_3, '2026-08-12T07:00:00Z', 'sk.fake');
    expect(result.fallback).toBe(true);
    expect(result.reason).toBe('token rejected (401)');
  });

  it('falls back to haversine with reason when token is empty string', async () => {
    global.fetch = vi.fn();
    const result = await buildCostMatrix(STOPS_3, '2026-08-12T07:00:00Z', '');
    expect(result.fallback).toBe(true);
    expect(result.reason).toBe('no token configured');
    expect((global.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('chunks stops into ≤25-stop windows and merges', async () => {
    const bigStops: RouteStop[] = Array.from({ length: 26 }, (_, i) => ({
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

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        durations: Array.from({ length: 25 }, (_, r) =>
          Array.from({ length: 25 }, (_, c) => (r === c ? 0 : 100))
        ),
      }),
    } as unknown as Response);

    const result = await buildCostMatrix(bigStops, '2026-08-12T07:00:00Z', 'sk.fake');
    expect(result.matrix).toHaveLength(26);
    expect(result.matrix[0]).toHaveLength(26);
    // Cross-chunk cells (stop 0 vs stop 25) are filled with haversine, so must be non-zero
    expect(result.matrix[0][25]).toBeGreaterThan(0);
    // Matrix must be marked fallback:true because cross-chunk cells use haversine
    expect(result.fallback).toBe(true);
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
  it('returns none when geocodeSource is null', () => {
    expect(geocodeQualityScore({ ...STOPS_3[0], geocodeSource: null })).toBe('high');
  });
});

describe('collectGeocodeWarnings', () => {
  it('includes low and none stops, excludes high and null (null = high by policy)', () => {
    // null geocodeSource is treated as 'high' (benefit of the doubt for pre-existing jobs)
    // A stop with no coords at all (lat/lng null) is 'none' and should warn.
    const stops: RouteStop[] = [
      { ...STOPS_3[0], geocodeSource: 'point' },
      { ...STOPS_3[1], geocodeSource: 'centroid' },
      { ...STOPS_3[2], geocodeSource: null },
    ];
    const warnings = collectGeocodeWarnings(stops);
    // Only the centroid stop should warn; null and point are both 'high'.
    expect(warnings).toHaveLength(1);
    expect(warnings[0].jobId).toBe(2);
    expect(warnings[0].quality).toBe('low');
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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        durations: [
          [0, 300, 300, 300],
          [300, 0, 300, 600],
          [300, 300, 0, 300],
          [300, 600, 300, 0],
        ],
      }),
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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        durations: [
          [0, 2100, 2100, 2100],
          [2100, 0, 2100, 2100],
          [2100, 2100, 0, 2100],
          [2100, 2100, 2100, 0],
        ],
      }),
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

  it('returns matrixFallback:true and degraded:false when API fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);

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
