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

  // ══════════════════════════════════════════════════════════════════════
  // Token race — reported as "the pins ball into a line", reproduced live
  // 2026-07-31.
  //
  // The effect used to end with a BARE synchronous `initMap();` sitting
  // below the async token block:
  //
  //     (async () => { const t = await getMapboxAccessToken();
  //                    initMapbox(t); initMap(); })();
  //     initMap();          // <-- always won the race
  //
  // The bare call always ran first, constructing a mapboxgl.Map before
  // initMapbox() had set mapboxgl.accessToken. Its style/tile requests never
  // authenticated, so 'load' never fired and mapReady stayed false — the tab
  // sat on "Loading map…" (measured at ~25s on live). But it had already
  // assigned mapRef.current, so the token-aware call that followed took the
  // reuse branch and called updateMapMarkers() on that dead map, BYPASSING
  // the `if (mapReady)` gate. All 21 job markers were attached to a map whose
  // camera had never settled: they ignored the basemap while panning and,
  // with clustering never re-run for the real zoom, collapsed into a single
  // north-south line when zoomed out.
  //
  // Intermittent by construction: initMapbox is global and idempotent, so
  // only the FIRST map opened in a session lost the race.
  // ══════════════════════════════════════════════════════════════════════

  /** Body of the Map-tab init effect, from the effect head to its cleanup. */
  function initEffect(): string {
    const start = SRC.indexOf("if (activeTab !== 'Map') return;");
    expect(start, 'map init effect not found').toBeGreaterThan(-1);
    const end = SRC.indexOf('return () => {', start);
    expect(end).toBeGreaterThan(start);
    return SRC.slice(start, end);
  }

  it('never constructs the map outside the token-initialised path', () => {
    const body = initEffect();
    // A bare `initMap();` at statement level (not inside the async IIFE, where
    // it is indented well past column 4) is the regression.
    const bareCalls = body.match(/\n {4}initMap\(\);/g) ?? [];
    expect(
      bareCalls,
      'A synchronous initMap() outside the async token block races ahead of '
        + 'initMapbox() and builds a Map with no accessToken — it will never fire '
        + '"load", and markers get hung off a camera that never settles.',
    ).toEqual([]);
  });

  it('calls initMap only after initMapbox has set the access token', () => {
    const body = initEffect();
    const initMapboxIdx = body.indexOf('initMapbox(token);');
    const callIdx = body.indexOf('initMap();', initMapboxIdx);
    expect(initMapboxIdx, 'initMapbox(token) not found').toBeGreaterThan(-1);
    expect(callIdx, 'no initMap() after initMapbox(token)').toBeGreaterThan(initMapboxIdx);
    // And that ordered pair must be the ONLY invocation in the effect.
    expect((body.match(/initMap\(\);/g) ?? []).length).toBe(1);
  });

  it('the reuse path refuses to paint markers onto a map that has not loaded', () => {
    const guard = initGuard();
    // Without this, updateMapMarkers() on the reuse branch sidesteps the
    // `if (mapReady)` gate entirely — which is how markers reached an
    // unsettled camera in the first place.
    expect(guard).toMatch(/loaded\(\)/);
    const loadedIdx = guard.indexOf('loaded()');
    const updateIdx = guard.indexOf('updateMapMarkers();');
    expect(loadedIdx).toBeLessThan(updateIdx);
  });

  it('marker rendering is otherwise gated on mapReady', () => {
    // The effect that owns the settled-camera render path.
    expect(SRC).toMatch(/if \(mapReady\) updateMapMarkers\(\);/);
  });

  it('the container really is conditionally mounted — the reason this matters', () => {
    // If the Map panel ever becomes always-mounted, the attachment check
    // becomes redundant rather than load-bearing, and this guard should be
    // revisited rather than silently kept.
    expect(SRC).toMatch(/\{activeTab === 'Map' && \(/);
    expect(SRC).toMatch(/ref=\{mapContainerRef\}/);
  });
});
