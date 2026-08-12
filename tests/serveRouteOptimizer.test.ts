import { describe, it, expect, vi } from 'vitest';
import type { RouteStop, OptimizeResult, TrafficCheckResult } from '../src/utils/serveRouteOptimizer';
import { buildCostMatrix, haversineMatrix } from '../src/utils/serveRouteOptimizer';

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

  it('falls back to haversine when API returns non-ok status', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 422,
    } as unknown as Response);

    const result = await buildCostMatrix(STOPS_3, '2026-08-12T07:00:00Z', 'sk.fake');
    expect(result.fallback).toBe(true);
    expect(result.matrix[0][0]).toBe(0);
    expect(result.matrix[0][1]).toBeGreaterThan(0);
  });

  it('falls back to haversine when token is empty string', async () => {
    global.fetch = vi.fn();
    const result = await buildCostMatrix(STOPS_3, '2026-08-12T07:00:00Z', '');
    expect(result.fallback).toBe(true);
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
