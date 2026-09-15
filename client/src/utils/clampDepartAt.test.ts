import { describe, it, expect, vi, afterEach } from 'vitest';
import { clampDepartAtForMapbox, fetchMapboxDrivingRoute } from './mapboxDepartAt';

describe('clampDepartAtForMapbox', () => {
  it('rewrites a morning shift start when the request is hours later', () => {
    const now = Date.parse('2026-08-28T23:18:00.000Z');
    const clamped = clampDepartAtForMapbox('2026-08-28T14:00:00.000Z', now);
    expect(clamped).toBe('2026-08-28T23:18:00.000Z');
  });

  it('keeps a depart_at within 25 minutes', () => {
    const now = Date.parse('2026-08-28T14:10:00.000Z');
    const clamped = clampDepartAtForMapbox('2026-08-28T14:00:00.000Z', now);
    expect(clamped).toBe('2026-08-28T14:00:00.000Z');
  });
});

// apiFetch's GET coalescing always calls res.clone() on the raw fetch response so
// concurrent callers each get an independent body stream. Mock responses must
// include clone() or the coalescing path throws and the request is silently swallowed.
function mockResponse(opts: { ok: boolean; status?: number; body?: object }) {
  const make = (): object => ({
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    json: async () => opts.body ?? {},
    clone: () => make(),
  });
  return make();
}

describe('fetchMapboxDrivingRoute', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries without depart_at after a 422', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 422 }))
      .mockResolvedValueOnce(mockResponse({
        ok: true,
        body: { routes: [{ duration: 600, distance: 1000, legs: [] }] },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const route = await fetchMapboxDrivingRoute(
      'pk.test',
      '-111.88,40.69;-111.94,40.66',
      '2026-08-28T14:00:00.000Z',
    );
    expect(route?.duration).toBe(600);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = String(fetchMock.mock.calls[0][0]);
    const secondUrl = String(fetchMock.mock.calls[1][0]);
    expect(firstUrl).toContain('depart_at=');
    expect(secondUrl).not.toContain('depart_at=');
  });
});
