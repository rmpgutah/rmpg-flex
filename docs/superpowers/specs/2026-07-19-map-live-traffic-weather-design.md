# Live Traffic + Weather Radar on Map & Nav — Design

**Date:** 2026-07-19
**Status:** Approved, pending implementation

## Context

The user asked to "upgrade the full Map system" with a new capability: live external
data overlays (traffic + weather). Investigation before design turned up that this is
half-built already:

- **Traffic** ([`useMapTraffic.ts`](../../../client/src/hooks/useMapTraffic.ts)) is fully
  live today on the main Map page (`MapboxMapPage.tsx`) — it adds Mapbox's own
  `mapbox-traffic-v1` vector tileset as a source with congestion-colored line layers.
  Real production data, no separate key needed (covered by the existing Mapbox token).
  **No changes needed here.**
- **Weather radar** ([`useMapWeatherRadar.ts`](../../../client/src/hooks/useMapWeatherRadar.ts))
  is wired into the Map page's toolbar (toggle button, state, styling all present) but is
  silently non-functional in production: the tile URL points at OpenWeatherMap with
  `appid=demo`, a placeholder key OpenWeatherMap does not honor. The toggle exists;
  the data never did.
- **`NavMapView.tsx`** (the turn-by-turn nav mini-map) has neither hook wired in at all.

This spec covers: (1) fixing the weather radar hook with a real, keyless, live NOAA/NWS
source, and (2) bringing both traffic and weather onto the Nav view. Traffic on the Map
page is untouched — it already works.

## Non-goals

- No changes to `useMapTraffic.ts` or its integration in `MapboxMapPage.tsx` — already correct.
- No weather layers beyond precipitation radar (no temperature/wind/clouds/pressure). The
  hook currently declares those 4 extra `WeatherLayerType`s from OpenWeatherMap, but no UI
  ever exposed them (`showWeatherMenu` state in `MapboxMapPage.tsx` is set but never
  rendered into a menu) — they're dead surface. Removing them, not fixing them, since
  OpenWeatherMap's real tiles need a paid/managed API key, which is out of scope.
  `OPENWEATHERMAP_API_KEY` is not being added to this project as part of this work.
- No radar-timeline scrubber UI (play/pause through past frames). RainViewer's frame
  list gives us this for free later, and the hook will expose the fetched frame array,
  but building the scrubber control itself is a separate future feature.
- No changes to `DispatchMiniMap`, `SightingsMap`, or `ForensicTrackMap` — scoped to Map
  + Nav per explicit decision during brainstorming.

## Design

### 1. `useMapWeatherRadar.ts` rewrite

Replace the OpenWeatherMap-backed implementation with one backed by
[RainViewer's public API](https://www.rainviewer.com/api.html) (free, keyless, republishes
NOAA/global radar composites):

- **Frame discovery:** `fetch('https://api.rainviewer.com/public/weather-maps.json')`
  returns `{ host, radar: { past: [{ time, path }, ...] } }`. The last entry in `radar.past`
  is the newest available frame.
- **Tile URL:** `${host}${path}/256/{z}/{x}/{y}/2/1_1.png` (RainViewer's standard template —
  size 256, color scheme 2 = the common blue→green→red precip ramp, `1_1` = smooth +
  snow-color enabled).
- **Refresh:** on enable, fetch immediately; then poll every 5 minutes (RainViewer
  publishes a new frame roughly that often). When a newer frame appears, swap the raster
  source: Mapbox GL raster sources can't have their `tiles` array patched in place, so
  this is remove-old-source-and-layer → add-new-source-and-layer, using the existing
  `hasLayer`/`safeRemoveLayer`/`safeRemoveSource` helpers from `mapboxSafeLayer.ts` (same
  teardown-safe pattern the file already follows).
- **Type surface shrinks:** `WeatherLayerType` drops to just `'precipitation'`
  (effectively a single on/off layer, not a menu of 5). `WEATHER_LAYERS` config map goes
  from 5 entries to 1.
- **Returned shape stays compatible** with what `MapboxMapPage.tsx` actually consumes
  today — `enabled`, `toggle`, `opacity`, `setOpacity` keep their signatures, so
  **`MapboxMapPage.tsx` needs zero changes.** New field `frames: RainviewerFrame[]`
  (the fetched, unused-for-now list) is added to the return value for a future
  timeline feature to build on without redoing the fetch/poll plumbing.
- **Failure handling:** if the frame-list fetch fails (network error, RainViewer down),
  log via the existing `devLog` pattern and leave the layer off / keep showing the last
  good frame rather than throwing — matches this file's existing "never crash the map"
  posture (`mapboxSafeLayer.ts`'s whole reason for existing).
- **Cleanup:** clear the poll interval and abort any in-flight fetch on unmount / on
  toggle-off, same as the existing cleanup effect.

### 2. Wire both hooks into `NavMapView.tsx`

`NavMapView` already tracks `mapRef` (`useRef<mapboxgl.Map | null>`) and `mapReady`
(`useState<boolean>`) — the exact shape both hooks expect as `(map, mapLoaded)` args, so
this is a straight call:

```ts
const traffic = useMapTraffic(mapRef.current, mapReady);
const weatherRadar = useMapWeatherRadar(mapRef.current, mapReady);
```

**UI:** two new 8×8 icon toggle buttons in the currently-empty top-right corner of the
nav view, matching the existing button style used by recenter/zoom/style/pin
(`rgba(10,10,10,0.85)` background, `border-subtle`, gold `#d4a017` when active, `#888`
muted otherwise; `title` for tooltip, no visible label — consistent with the rest of
`NavMapView`'s minimal chrome). Icons: `Route` for traffic, `CloudRain` for weather
(both already available in `lucide-react`, need to be added to the existing import at
the top of the file alongside `Crosshair, Layers, ZoomIn, ZoomOut, ...`).

Both buttons render inside the existing `{showControls && !error && ( ... )}` block, so
they respect the same `showControls` prop gate every other Nav control already does —
callers that pass `showControls={false}` (e.g. an embedded read-only preview) get neither
button, consistent with how the rest of the chrome behaves.

Both default to **off** (same as the Map page), so this is purely additive — no change
to Nav's default appearance until an officer explicitly turns one on.

### 3. Verification

Production (`rmpgutah.us` / `api.rmpgutah.us`) sits behind a Cloudflare managed
challenge for everything except `/api/health`, so a plain `curl` can't confirm this
end-to-end post-deploy (documented gotcha in `CLAUDE.md`). Verification here instead
means, using the local Vite dev server + the browser preview tool:

1. Open the Map page, toggle Traffic on, confirm in the network panel that requests to
   `mapbox-traffic-v1` vector tiles return real data (unchanged behavior — regression
   check only, since this hook isn't being touched).
2. Toggle Weather Radar on, confirm a request to `api.rainviewer.com/public/weather-maps.json`
   succeeds and a subsequent tile request to `tilecache.rainviewer.com/...` returns a
   real PNG (not 404), and that the layer visibly renders over Salt Lake City (or
   wherever radar echoes exist at test time — precipitation is not guaranteed to be
   present, so "no visible echoes" is not itself a failure if the tile request succeeds).
3. Open the Nav view (rendered by `client/src/pages/NavPage.tsx`, the only consumer of
   `NavMapView`), toggle both new buttons, repeat the same network-panel checks.
4. Toggle everything back off and confirm sources/layers are actually removed (no
   lingering Mapbox console errors on unmount — the exact class of bug
   `mapboxSafeLayer.ts` exists to prevent).

This satisfies "use live production data as the source" (real external APIs, not mocked,
exercised in dev) even though full production verification is blocked by the WAF
challenge as usual for anything other than `/api/health`.

## Files touched

- `client/src/hooks/useMapWeatherRadar.ts` — rewritten (RainViewer instead of OWM).
- `client/src/components/NavMapView.tsx` — add two hook calls + two toggle buttons + two
  new lucide icon imports.
- No changes to `client/src/hooks/useMapTraffic.ts`, `client/src/pages/map/MapboxMapPage.tsx`,
  or any Worker route — this is a client-only, keyless-external-API change.

## Risks / open questions resolved during brainstorming

- **Why not OpenWeatherMap with a real key instead?** User explicitly chose the
  keyless NOAA/NWS-sourced option over "get an OWM key" during brainstorming — avoids a
  new secret, a paid tier, and matches the pattern of other free-government-data
  integrations already in this app (NSOPW, county assessor, Utah statutes).
- **Why RainViewer over IEM's static tile mirror?** User explicitly chose RainViewer
  (Option B) over the simpler always-current IEM tile URL (Option A) specifically to
  keep the door open for a future radar-timeline/animation feature, accepting the
  slightly higher complexity (frame-list fetch + poll) now.
