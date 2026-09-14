import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Mapbox server token cold start', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', '');
    localStorage.clear();
    localStorage.setItem('rmpg_token', 'session-token');
    vi.restoreAllMocks();
  });

  it('writes the authenticated server token through for synchronous previews and availability', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ configured: true, accessToken: 'pk.server-public-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          routes: [{ duration: 600, distance: 1609.344, geometry: { coordinates: [[-111.9, 40.7], [-111.89, 40.76]] } }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const token = await import('../mapboxToken');
    const routing = await import('../mapboxRouting');

    expect(routing.hasMapboxDirections()).toBe(false);
    expect(routing.buildMapboxStaticImageUrl({ lat: 40.76, lng: -111.89 })).toBeNull();

    await expect(routing.ensureMapboxDirections()).resolves.toBe(true);
    expect(routing.hasMapboxDirections()).toBe(true);

    const preview = routing.buildMapboxStaticImageUrl({ lat: 40.76, lng: -111.89 });
    expect(preview).toContain('access_token=pk.server-public-token');
    expect(token.getSyncCachedToken()).toBe('pk.server-public-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/integrations/mapbox/client-token'),
      expect.objectContaining({ headers: { Authorization: 'Bearer session-token' } }),
    );

    await expect(routing.fetchMapboxRoute(
      { lat: 40.7, lng: -111.9 },
      { lat: 40.76, lng: -111.89 },
    )).resolves.toMatchObject({ eta: '10 min', distance: '1.0 mi' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('access_token=pk.server-public-token');
  });

  it('does not cache or expose a missing server token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ configured: false }),
    }));
    const token = await import('../mapboxToken');
    const routing = await import('../mapboxRouting');

    await expect(routing.ensureMapboxDirections()).resolves.toBe(false);
    expect(token.getSyncCachedToken()).toBe('');
    expect(routing.buildMapboxStaticImageUrl({ lat: 40.76, lng: -111.89 })).toBeNull();
  });
});
