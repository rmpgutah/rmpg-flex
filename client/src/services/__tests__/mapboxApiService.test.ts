import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../../hooks/useApi';
import { coordsToParam } from '../mapboxApiService';

describe('coordsToParam', () => {
  it('joins [lng, lat] pairs with commas and semicolons', () => {
    expect(coordsToParam([[-111.891, 40.7608], [-111.9, 40.75]])).toBe(
      '-111.891,40.7608;-111.9,40.75'
    );
  });

  it('handles a single coordinate pair with no trailing semicolon', () => {
    expect(coordsToParam([[-111.891, 40.7608]])).toBe('-111.891,40.7608');
  });
});

import { mapboxDirections } from '../mapboxApiService';

describe('mapboxDirections', () => {
  beforeEach(() => { vi.mocked(apiFetch).mockReset(); });

  it('issues a GET with a coordinate-string query param, not a POST body', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ routes: [], waypoints: [], code: 'Ok' });

    await mapboxDirections([[-111.891, 40.7608], [-111.9, 40.75]], { profile: 'driving', alternatives: true });

    expect(vi.mocked(apiFetch).mock.calls[0]).toHaveLength(1);
    const [url] = vi.mocked(apiFetch).mock.calls[0];
    expect(url).toContain('/mapbox/directions?');
    expect(url).toContain('coordinates=-111.891%2C40.7608%3B-111.9%2C40.75');
    expect(url).toContain('profile=driving');
    expect(url).toContain('alternatives=true');
  });
});

import { mapboxMatrix } from '../mapboxApiService';

describe('mapboxMatrix', () => {
  beforeEach(() => { vi.mocked(apiFetch).mockReset(); });

  it('issues a GET with comma-separated sources/destinations, not a POST body', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ durations: [[100]], distances: [[500]], sources: [], destinations: [] });

    await mapboxMatrix(
      [[-111.891, 40.7608], [-111.9, 40.75], [-111.95, 40.8]],
      { sources: [0], destinations: [1, 2] },
    );

    const [url] = vi.mocked(apiFetch).mock.calls[0];
    expect(url).toContain('/mapbox/matrix?');
    expect(url).toContain('sources=0');
    expect(url).toContain('destinations=1%2C2');
    expect(vi.mocked(apiFetch).mock.calls[0][1]).toBeUndefined();
  });
});

import { mapboxOptimization } from '../mapboxApiService';

describe('mapboxOptimization', () => {
  beforeEach(() => { vi.mocked(apiFetch).mockReset(); });

  it('issues a GET with source/destination/roundtrip as query params', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ trips: [], waypoints: [] });

    await mapboxOptimization(
      [[-111.891, 40.7608], [-111.9, 40.75]],
      { roundtrip: true, source: 'first', destination: 'last' },
    );

    const [url] = vi.mocked(apiFetch).mock.calls[0];
    expect(url).toContain('/mapbox/optimization?');
    expect(url).toContain('roundtrip=true');
    expect(url).toContain('source=first');
    expect(url).toContain('destination=last');
    expect(vi.mocked(apiFetch).mock.calls[0][1]).toBeUndefined();
  });
});

import { mapboxMapMatch } from '../mapboxApiService';

describe('mapboxMapMatch', () => {
  beforeEach(() => { vi.mocked(apiFetch).mockReset(); });

  it('POSTs to /mapbox/map-matching, not /mapbox/map-match', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ matchings: [], tracepoints: [] });

    await mapboxMapMatch([[-111.891, 40.7608], [-111.9, 40.75]]);

    const [url] = vi.mocked(apiFetch).mock.calls[0];
    expect(url).toBe('/mapbox/map-matching');
  });
});
