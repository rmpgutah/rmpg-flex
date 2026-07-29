// ============================================================
// ServePage — the map must re-attach after a tab switch
// ============================================================
// Reported as "map glitch", reproduced on live 2026-07-29:
//
//   • Open the Map tab — map renders.
//   • Switch to any other tab, switch back.
//   • The tab is permanently blank. Not "Loading map…", not an empty
//     basemap — NO canvas and no .mapboxgl-map in the document at all,
//     for the rest of the session.
//
// Measured at that point: the container div IS rendered (1 found) and is
// completely empty (`containerHasMap: false`).
//
// Cause: the Map tab's JSX is conditionally mounted
// (`{activeTab === 'Map' && …}`), so leaving the tab destroys the
// container React owns. `mapRef.current` keeps pointing at a Mapbox Map
// bound to that now-detached node. On return a NEW empty container is
// rendered, and the init effect's guard
//
//     if (mapRef.current) { updateMapMarkers(); return; }
//
// skipped creation because the ref was non-null. Nothing re-attached.
//
// The guard has to test ATTACHMENT, not mere existence.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/pages/ServePage.tsx'), 'utf8');

/** The reuse-or-rebuild guard at the top of the map init routine. */
function initGuard(): string {
  const start = SRC.indexOf('const initMap = async () => {');
  expect(start, 'initMap not found').toBeGreaterThan(-1);
  const end = SRC.indexOf('new mapboxgl.Map({', start);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe('serve map re-initialisation', () => {
  it('reuses the map only when it is attached to the CURRENT container', () => {
    const guard = initGuard();
    // Existence alone is not sufficient — that was the bug.
    expect(guard).toMatch(/getContainer\(\)|getContainer\?\.\(\)/);
    expect(guard).toContain('isConnected');
    expect(guard).toContain('mapContainerRef.current');
  });

  it('disposes the stale map instead of returning early', () => {
    const guard = initGuard();
    const reuseIdx = guard.indexOf('updateMapMarkers();');
    const disposeIdx = guard.indexOf('mapRef.current = null;');
    expect(reuseIdx, 'no reuse path').toBeGreaterThan(-1);
    expect(disposeIdx, 'stale map is never disposed').toBeGreaterThan(-1);
    // The dispose path must come AFTER the reuse path — i.e. it is the
    // fall-through when the attachment check fails, not an unconditional reset.
    expect(disposeIdx).toBeGreaterThan(reuseIdx);
    expect(guard).toMatch(/mapRef\.current\.remove\(\)/);
  });

  it('drops marker and popup handles that belonged to the dead map', () => {
    // They reference the detached node; "removing" them from a map that no
    // longer exists is a no-op that leaves stale handles behind.
    const guard = initGuard();
    expect(guard).toContain('markersRef.current = []');
    expect(guard).toMatch(/popupRef\.current = null/);
  });

  it('the container really is conditionally mounted — the reason this matters', () => {
    // If the Map panel ever becomes always-mounted, the attachment check
    // becomes redundant rather than load-bearing, and this guard should be
    // revisited rather than silently kept.
    expect(SRC).toMatch(/\{activeTab === 'Map' && \(/);
    expect(SRC).toMatch(/ref=\{mapContainerRef\}/);
  });
});
