import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseAlerts,
  zoneKeyFromUrl,
  zoneIdFromUrl,
  zoneUrlFromKey,
  fetchZonesBounded,
  fetchActiveAlerts,
  quantizeGeometry,
} from '../src/utils/nwsAlerts';

afterEach(() => vi.restoreAllMocks());

const ALERT = (over: Record<string, unknown> = {}) => ({
  properties: {
    id: 'urn:oid:2.49.0.1.840.0.abc',
    event: 'Red Flag Warning',
    severity: 'Severe',
    urgency: 'Expected',
    certainty: 'Likely',
    headline: 'Red Flag Warning issued August 2',
    description: 'Gusty winds and low humidity.',
    instruction: 'Outdoor burning is not recommended.',
    areaDesc: 'Wasatch Mountains',
    senderName: 'NWS Salt Lake City UT',
    effective: '2026-08-02T03:21:00-06:00',
    expires: '2026-08-02T22:00:00-06:00',
    affectedZones: [
      'https://api.weather.gov/zones/fire/UTZ479',
      'https://api.weather.gov/zones/fire/UTZ488',
    ],
    ...over,
  },
  geometry: null,
});

describe('zone key helpers', () => {
  // The bare UGC id is NOT unique across zone types. Keying geometry by id
  // alone silently merges two different polygons — the map then draws the
  // wrong shape with no error anywhere.
  it('keeps the type segment so fire/ and forecast/ zones stay distinct', () => {
    expect(zoneKeyFromUrl('https://api.weather.gov/zones/fire/UTZ479')).toBe('fire/UTZ479');
    expect(zoneKeyFromUrl('https://api.weather.gov/zones/forecast/UTZ479')).toBe('forecast/UTZ479');
    expect(zoneKeyFromUrl('https://api.weather.gov/zones/county/UTC035')).toBe('county/UTC035');
  });

  it('exposes the bare id separately for display', () => {
    expect(zoneIdFromUrl('https://api.weather.gov/zones/fire/UTZ479')).toBe('UTZ479');
  });

  it('round-trips a key back to its URL', () => {
    expect(zoneUrlFromKey('fire/UTZ479')).toBe('https://api.weather.gov/zones/fire/UTZ479');
  });

  it('returns null for a non-zone URL rather than guessing', () => {
    expect(zoneKeyFromUrl('https://api.weather.gov/alerts/active')).toBeNull();
    expect(zoneKeyFromUrl('')).toBeNull();
  });
});

describe('parseAlerts', () => {
  it('maps the NWS envelope onto our alert shape', () => {
    const [a] = parseAlerts({ features: [ALERT()] });
    expect(a.event).toBe('Red Flag Warning');
    expect(a.severity).toBe('Severe');
    expect(a.area_desc).toBe('Wasatch Mountains');
    expect(a.sender).toBe('NWS Salt Lake City UT');
    expect(a.zone_ids).toEqual(['fire/UTZ479', 'fire/UTZ488']);
  });

  it('skips alerts missing an id or event instead of emitting a blank row', () => {
    const out = parseAlerts({ features: [ALERT({ id: null }), ALERT({ event: '' }), ALERT()] });
    expect(out).toHaveLength(1);
  });

  it('degrades an unrecognized severity to Unknown', () => {
    expect(parseAlerts({ features: [ALERT({ severity: 'Catastrophic' })] })[0].severity).toBe('Unknown');
    expect(parseAlerts({ features: [ALERT({ severity: undefined })] })[0].severity).toBe('Unknown');
  });

  it('preserves an inline polygon when NWS supplies one', () => {
    const geom = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const [a] = parseAlerts({ features: [{ ...ALERT(), geometry: geom }] });
    expect(a.geometry).toEqual(geom);
  });

  it('tolerates a malformed payload without throwing', () => {
    expect(parseAlerts(null)).toEqual([]);
    expect(parseAlerts({})).toEqual([]);
    expect(parseAlerts({ features: 'nope' })).toEqual([]);
    expect(parseAlerts({ features: [{}] })).toEqual([]);
  });

  it('drops non-string entries in affectedZones', () => {
    const [a] = parseAlerts({
      features: [ALERT({ affectedZones: ['https://api.weather.gov/zones/fire/UTZ479', null, 42] })],
    });
    expect(a.zone_ids).toEqual(['fire/UTZ479']);
  });
});

describe('quantizeGeometry', () => {
  it('rounds coordinates to ~11 m at any nesting depth', () => {
    const g = {
      type: 'MultiPolygon',
      coordinates: [[[[-111.04933333, 42.00161111], [-111.5, 42.5]]]],
    };
    const out = quantizeGeometry(g) as typeof g;
    expect(out.coordinates[0][0][0]).toEqual([-111.0493, 42.0016]);
    // An already-short coordinate must not gain spurious digits.
    expect(out.coordinates[0][0][1]).toEqual([-111.5, 42.5]);
  });

  it('preserves the geometry type and leaves non-geometry input alone', () => {
    expect((quantizeGeometry({ type: 'Polygon', coordinates: [] }) as { type: string }).type).toBe('Polygon');
    expect(quantizeGeometry(null)).toBeNull();
    expect(quantizeGeometry({ type: 'Point' })).toEqual({ type: 'Point' });
  });
});

describe('fetchActiveAlerts', () => {
  it('sends the User-Agent NWS requires — without it the API 403s', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [ALERT()] }) });
    global.fetch = fetchMock as never;

    await fetchActiveAlerts('UT');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.weather.gov/alerts/active?area=UT');
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/RMPG-Flex/);
  });

  it('throws on a non-2xx so the route can degrade deliberately', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as never;
    await expect(fetchActiveAlerts('UT')).rejects.toThrow(/503/);
  });
});

describe('fetchZonesBounded', () => {
  const zoneBody = (name: string) => ({
    ok: true,
    json: async () => ({
      properties: { name },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    }),
  });

  it('resolves every zone and tags each with its type-qualified key', async () => {
    global.fetch = vi.fn().mockResolvedValue(zoneBody('Wasatch Mountains')) as never;
    const out = await fetchZonesBounded([
      'https://api.weather.gov/zones/fire/UTZ479',
      'https://api.weather.gov/zones/forecast/UTZ105',
    ]);
    expect(out.map((z) => z.key).sort()).toEqual(['fire/UTZ479', 'forecast/UTZ105']);
    expect(out[0].name).toBe('Wasatch Mountains');
  });

  it('caps total fetches so a heavy alert day cannot stall the endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(zoneBody('z'));
    global.fetch = fetchMock as never;
    const urls = Array.from({ length: 25 }, (_, i) => `https://api.weather.gov/zones/fire/UTZ${400 + i}`);

    const out = await fetchZonesBounded(urls, { limit: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(out).toHaveLength(10);
  });

  it('never exceeds the concurrency ceiling', async () => {
    let inFlight = 0;
    let peak = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return zoneBody('z');
    }) as never;

    const urls = Array.from({ length: 12 }, (_, i) => `https://api.weather.gov/zones/fire/UTZ${400 + i}`);
    await fetchZonesBounded(urls, { concurrency: 3 });

    expect(peak).toBeLessThanOrEqual(3);
  });

  // One unreachable zone must not sink the whole alert list — the alert still
  // renders in the list panel, just without a polygon.
  it('drops a failing zone and keeps the rest', async () => {
    global.fetch = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(zoneBody('ok'));
    const out = await fetchZonesBounded([
      'https://api.weather.gov/zones/fire/UTZ479',
      'https://api.weather.gov/zones/fire/UTZ488',
    ], { concurrency: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('fire/UTZ488');
  });

  it('skips a zone whose payload has no geometry', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ properties: { name: 'x' }, geometry: null }),
    }) as never;
    expect(await fetchZonesBounded(['https://api.weather.gov/zones/fire/UTZ479'])).toEqual([]);
  });
});
