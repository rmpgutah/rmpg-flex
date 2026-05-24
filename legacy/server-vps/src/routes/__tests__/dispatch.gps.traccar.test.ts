import { describe, it, expect } from 'vitest';
import { normalizeTraccarPayload } from '../dispatch/gps';

// Build a minimal Express-like Request stub for the parser.
function makeReq({ query, body }: { query?: any; body?: any } = {}): any {
  return { query: query ?? {}, body: body ?? null };
}

describe('normalizeTraccarPayload', () => {
  it('parses Traccar Client OsmAnd query string (knots → m/s)', () => {
    const r = makeReq({
      query: {
        id: 'iphone-7B', lat: '40.7608', lon: '-111.8910',
        speed: '20',  // 20 knots ≈ 10.288 m/s
        bearing: '90', accuracy: '5', timestamp: '1714400000',
      },
    });
    const p = normalizeTraccarPayload(r);
    expect(p).toBeTruthy();
    expect(p!.trackerId).toBe('iphone-7B');
    expect(p!.lat).toBeCloseTo(40.7608);
    expect(p!.lng).toBeCloseTo(-111.891);
    expect(p!.speedMs).toBeCloseTo(10.2889, 3);
    expect(p!.heading).toBe(90);
    expect(p!.accuracy).toBe(5);
    expect(p!.timestamp).toMatch(/^2024-/); // unix 1714400000 = 2024-04
  });

  it('parses Traccar Server forward-webhook JSON (device.uniqueId + position)', () => {
    const r = makeReq({
      body: {
        device: { id: 12, uniqueId: 'unit-A1', name: 'Officer 7' },
        position: {
          latitude: 40.76, longitude: -111.89,
          speed: 30, course: 180, accuracy: 8,
          fixTime: '2026-04-29T15:30:00Z',
        },
      },
    });
    const p = normalizeTraccarPayload(r);
    expect(p).toBeTruthy();
    expect(p!.trackerId).toBe('unit-A1');
    expect(p!.lat).toBeCloseTo(40.76);
    expect(p!.lng).toBeCloseTo(-111.89);
    expect(p!.speedMs).toBeCloseTo(30 * 0.514444, 3);
    expect(p!.heading).toBe(180);
    expect(p!.timestamp).toBe('2026-04-29T15:30:00Z');
  });

  it('parses generic flat JSON (Traccar REST /api/positions)', () => {
    const r = makeReq({
      body: {
        deviceId: 99, latitude: 40.5, longitude: -112.0,
        speed: 10, course: 45, accuracy: 4, fixTime: '2026-04-29T16:00:00Z',
      },
    });
    const p = normalizeTraccarPayload(r);
    expect(p!.trackerId).toBe('99');
    expect(p!.heading).toBe(45);
    expect(p!.speedMs).toBeCloseTo(10 * 0.514444, 3);
  });

  it('returns null on a non-location event (no lat/lon present)', () => {
    expect(normalizeTraccarPayload(makeReq({ body: { event: 'wakeup' } }))).toBeNull();
    expect(normalizeTraccarPayload(makeReq({ body: null }))).toBeNull();
    expect(normalizeTraccarPayload(makeReq({}))).toBeNull();
  });

  it('OsmAnd takes precedence over body when both are present', () => {
    const r = makeReq({
      query: { id: 'q-id', lat: '1', lon: '2' },
      body: { deviceId: 'b-id', latitude: 9, longitude: 9 },
    });
    const p = normalizeTraccarPayload(r);
    expect(p!.trackerId).toBe('q-id');
    expect(p!.lat).toBe(1);
    expect(p!.lng).toBe(2);
  });

  it('Traccar Server JSON without latitude returns null', () => {
    const r = makeReq({ body: { device: { id: 1, uniqueId: 'a' }, position: { speed: 0 } } });
    expect(normalizeTraccarPayload(r)).toBeNull();
  });
});
