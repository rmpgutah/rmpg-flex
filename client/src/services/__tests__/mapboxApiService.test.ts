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
