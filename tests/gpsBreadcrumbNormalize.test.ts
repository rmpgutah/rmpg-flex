// gpsBreadcrumbNormalize.test.ts
// Locks in the lat/lng ↔ latitude/longitude contract the POST /api/dispatch/gps
// route enforces. Pre-fix the client sent `{lat, lng, ...}` (matches the
// QueuedPoint type in useGpsTracking.ts and is what the localStorage failover
// queue persists) while the Hono route was typed `{latitude, longitude, ...}`.
// The mismatch caused every breadcrumb POST to 500 with "NOT NULL constraint
// failed: gps_breadcrumbs.latitude" because `pt.latitude` came back undefined.
// This test guards against a future re-introduction of the bug — the `norm`
// helper has to keep accepting both shapes so the rewrite stays a drop-in for
// the Toughbook Electron, mobile browser, and desktop WiFi client paths.
//
// Uses `toMatchObject` (not `toEqual`) so unrelated extra fields added to
// `norm`'s return type over time (timestamp, source, …) don't break the
// contract lock — the assertion is about the lat/lng mapping, not the full
// shape.
import { describe, it, expect } from 'vitest';
import { _normalizePointForTest as normalizePoint } from '../src/routes/dispatch/gps';

describe('POST /api/dispatch/gps — norm() lat/lng contract', () => {
  it('(a) accepts {latitude, longitude} (legacy Hono contract)', () => {
    expect(normalizePoint({ latitude: 40.7, longitude: -111.9, accuracy: 5, heading: 90, speed: 12 }))
      .toMatchObject({ latitude: 40.7, longitude: -111.9, accuracy: 5, heading: 90, speed: 12 });
  });

  it('(b) accepts {lat, lng} (React useGpsTracking QueuedPoint + localStorage failover shape)', () => {
    expect(normalizePoint({ lat: 40.7, lng: -111.9, accuracy: 5, heading: 90, speed: 12 }))
      .toMatchObject({ latitude: 40.7, longitude: -111.9, accuracy: 5, heading: 90, speed: 12 });
  });

  it('(c) preserves timestamp + source strings (consumed by the trip engine via applyTripEvent)', () => {
    expect(normalizePoint({ lat: 40.7, lng: -111.9, timestamp: '2026-06-05 12:00:00', source: 'mobile' }))
      .toMatchObject({ latitude: 40.7, longitude: -111.9, timestamp: '2026-06-05 12:00:00', source: 'mobile' });
  });

  it('(d) missing lat/lng → NaN (not 0,0 — garbage payload must not silently insert Gulf of Guinea coords)', () => {
    // Pre-fix this case hit the D1 NOT NULL constraint on latitude → 500.
    // The route still has to write *something* finite to the DB, but the
    // normalization layer should surface "no coordinates present" as NaN
    // so the handler can reject the batch with a 400 before INSERT.
    const out = normalizePoint({});
    expect(Number.isFinite(out.latitude)).toBe(false);
    expect(Number.isFinite(out.longitude)).toBe(false);
  });

  it('passes through CoreMotion activity fields', () => {
    const n = normalizePoint({ lat: 40.7, lng: -111.9, activity: 'walking', activity_confidence: 'high' });
    expect(n.activity).toBe('walking');
    expect(n.activity_confidence).toBe('high');
  });

  it('omits activity fields when absent (web clients)', () => {
    const n = normalizePoint({ lat: 40.7, lng: -111.9 });
    expect(n.activity).toBeUndefined();
    expect(n.activity_confidence).toBeUndefined();
  });
});
