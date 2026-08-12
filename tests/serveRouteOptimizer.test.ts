import { describe, it, expect } from 'vitest';
import type { RouteStop, OptimizeResult, TrafficCheckResult } from '../src/utils/serveRouteOptimizer';

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
