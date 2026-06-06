// gpsBreadcrumbNormalize.test.ts
// Locks in the lat/lng ↔ latitude/longitude contract the POST /api/dispatch/gps
// route enforces. Pre-fix the client sent `{lat, lng, ...}` (matches the
// QueuedPoint type in useGpsTracking.ts and is what the localStorage failover
// queue persists) while the Hono route was typed `{latitude, longitude, ...}`.
// The mismatch caused every breadcrumb POST to 500 with "NOT NULL constraint
// failed: gps_breadcrumbs.latitude" because `pt.latitude` came back undefined.
// This test guards against a future re-introduction of the bug — the
// normalizePoint helper has to keep accepting both shapes so the rewrite stays
// a drop-in for the Toughbook Electron, mobile browser, and desktop WiFi
// client paths.
import { describe, it, expect } from 'vitest';
import { _normalizePointForTest as normalizePoint } from '../src/routes/dispatch/gps';

describe('POST /api/dispatch/gps normalizePoint', () => {
  it('(a) accepts {latitude, longitude} (original contract)', () => {
    const out = normalizePoint({ latitude: 40.7, longitude: -111.9, accuracy: 5, heading: 90, speed: 12 });
    expect(out).toEqual({ latitude: 40.7, longitude: -111.9, accuracy: 5, heading: 90, speed: 12 });
  });

  it('(b) accepts {lat, lng} (React client + failover queue shape)', () => {
    const out = normalizePoint({ lat: 40.7, lng: -111.9, accuracy: 5, heading: 90, speed: 12 });
    expect(out).toEqual({ latitude: 40.7, longitude: -111.9, accuracy: 5, heading: 90, speed: 12 });
  });

  it('(c) prefers {latitude, longitude} when both keys are present (legacy clients win)', () => {
    // A misbehaving client sending both is rare, but the precedence must be
    // defined so the contract is deterministic — picking the legacy shape
    // keeps any in-flight legacy client un-regressed.
    const out = normalizePoint({ latitude: 1, longitude: 2, lat: 99, lng: 99 });
    expect(out).toEqual({ latitude: 1, longitude: 2, accuracy: null, heading: null, speed: null });
  });

  it('(d) optional fields default to null when absent (NOT undefined — D1 binds null cleanly)', () => {
    const out = normalizePoint({ latitude: 0, longitude: 0 });
    expect(out).toEqual({ latitude: 0, longitude: 0, accuracy: null, heading: null, speed: null });
  });

  it('(e) NaN coordinates surface as NaN so the route returns 400 "Invalid coordinates"', () => {
    // Garbage payload (no lat or lng at all) must NOT silently insert a NULL
    // into gps_breadcrumbs.latitude (NOT NULL column) and 500. Instead the
    // route handler's findIndex check rejects the batch up front.
    const out = normalizePoint({});
    expect(Number.isFinite(out.latitude)).toBe(false);
    expect(Number.isFinite(out.longitude)).toBe(false);
  });
});
