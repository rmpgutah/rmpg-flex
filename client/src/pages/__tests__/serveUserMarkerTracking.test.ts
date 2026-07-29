// ============================================================
// ServePage — the user-location marker must be tracked for cleanup
// ============================================================
// Observed on the live board (2026-07-29): 660 identical user-location
// markers stacked on a single coordinate, rendering as a growing dark
// blob on the Serve map.
//
// Cause: the marker was registered with
//
//     markersRef.current.push(userLocationMarker as any);
//
// placed AFTER the geolocation calls but running synchronously — at which
// point `userLocationMarker` was still null, because it is only assigned
// inside the async position callback. So markersRef received a null and
// the real marker was never tracked. updateMapMarkers() clears markersRef
// and rebuilds on every jobs/route change, so each pass stranded its user
// marker on the map and added another, unbounded.
//
// The `as any` cast is what allowed a null to pass as a Marker.
//
// Source-shape guard: reproducing this needs a live Mapbox GL context, a
// WebGL canvas and a geolocation permission, and the symptom only emerges
// after MULTIPLE effect passes — a single-render test shows one marker and
// looks perfectly healthy either way.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/pages/ServePage.tsx'), 'utf8');

/** The geolocation block that owns the user-location marker. */
function userMarkerBlock(): string {
  const start = SRC.indexOf('const updateUserMarker =');
  expect(start, 'updateUserMarker not found').toBeGreaterThan(-1);
  const end = SRC.indexOf('serveGeoWatchId.current = navigator.geolocation.watchPosition', start);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe('user-location marker tracking', () => {
  it('registers the marker inside the branch that creates it', () => {
    const block = userMarkerBlock();
    const created = block.indexOf('new mapboxgl.Marker');
    const pushed = block.indexOf('markersRef.current.push(userLocationMarker');
    expect(created, 'marker is not created in this block').toBeGreaterThan(-1);
    expect(pushed, 'marker is never registered with markersRef').toBeGreaterThan(-1);
    // Registration must FOLLOW creation, in the same block — not sit outside
    // it where it runs before the async callback has assigned anything.
    expect(pushed).toBeGreaterThan(created);
  });

  it('never pushes the marker variable through an `as any` cast', () => {
    // That cast is precisely what let `null` be stored as a Marker.
    expect(SRC).not.toMatch(/markersRef\.current\.push\(userLocationMarker as any\)/);
  });

  it('does not register the marker outside the position callback', () => {
    // Anything after the watchPosition call is synchronous relative to the
    // callback, so a push there is a push of null.
    const watchIdx = SRC.indexOf('serveGeoWatchId.current = navigator.geolocation.watchPosition');
    const after = SRC.slice(watchIdx, watchIdx + 400);
    expect(after).not.toContain('markersRef.current.push(userLocationMarker');
  });

  it('guards against the map being torn down before the callback fires', () => {
    // The position callback can land after a tab switch has disposed the map;
    // constructing a Marker against it throws and kills the handler.
    const block = userMarkerBlock();
    const created = block.indexOf('new mapboxgl.Marker');
    expect(block.slice(0, created)).toMatch(/const map = mapRef\.current;[\s\S]*if \(!map\) return;/);
  });

  it('still clears the geolocation watch on unmount', () => {
    // Tracking the marker does not help if the watch keeps firing forever.
    expect(SRC).toMatch(/clearWatch\(serveGeoWatchId\.current\)/);
  });
});
