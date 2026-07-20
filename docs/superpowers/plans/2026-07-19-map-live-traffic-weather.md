# Live Traffic + Weather Radar on Map & Nav Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken weather-radar overlay (currently pointed at an invalid OpenWeatherMap demo key) with a real, keyless, live NOAA/NWS-backed source, and bring both live traffic and weather radar onto the Nav mini-map, which currently has neither.

**Architecture:** Two client-only hook/component changes, no server changes. `useMapWeatherRadar.ts` is rewritten to fetch RainViewer's public frame-list API and render the newest frame as a Mapbox raster layer, polling for new frames every 5 minutes. `NavMapView.tsx` gets two new hook calls (`useMapTraffic`, the rewritten `useMapWeatherRadar`) and two new toggle buttons, following the exact patterns already proven on `MapboxMapPage.tsx`.

**Tech Stack:** React 18 + TypeScript, Mapbox GL JS, Vitest + `@testing-library/react`.

## Global Constraints

- No new secrets, no new environment variables, no new Worker routes — this is a client-only change using two keyless external APIs (Mapbox's own traffic tileset, already covered by the existing Mapbox token; RainViewer's public JSON API).
- `useMapTraffic.ts` and `MapboxMapPage.tsx` are NOT modified — traffic is already correct there.
- Weather radar scope is precipitation only — no temperature/wind/clouds/pressure layers (those needed a paid OpenWeatherMap key and were never reachable from any UI).
- Every Mapbox layer/source add-or-remove must go through the existing teardown-safe helpers in `client/src/utils/mapboxSafeLayer.ts` (`hasLayer`, `safeRemoveLayer`, `safeRemoveSource`) — never call `map.getLayer`/`map.removeLayer`/etc. directly, per that file's documented crash history.
- Follow this repo's established button styling for `NavMapView.tsx`: `rgba(10,10,10,0.85)` background, `border-subtle`, `title` attribute (no `aria-label` — this file predates that convention and none of its existing buttons use it), 8×8px (`w-8 h-8`), `rounded-sm`.

---

### Task 1: Rewrite `useMapWeatherRadar.ts` to use RainViewer instead of the broken OpenWeatherMap demo key

**Files:**
- Modify: `client/src/hooks/useMapWeatherRadar.ts` (full rewrite)
- Create: `client/src/hooks/__tests__/useMapWeatherRadar.test.ts`

**Interfaces:**
- Consumes: `hasLayer`, `safeRemoveLayer`, `safeRemoveSource` from `client/src/utils/mapboxSafeLayer.ts` (existing, unmodified); `devLog`, `devWarn` from `client/src/utils/devLog.ts` (existing, unmodified).
- Produces: `useMapWeatherRadar(map: mapboxgl.Map | null, mapLoaded: boolean)` returning `{ enabled: boolean, toggle: () => void, setEnabled: (v: boolean) => void, opacity: number, setOpacity: (v: number) => void, frames: RainviewerFrame[] }`. `MapboxMapPage.tsx` (unmodified) consumes only `.enabled` and `.toggle` from this — both keep their exact names/types from the current implementation, so that file needs no changes. Task 2 consumes this same hook the same way.

- [ ] **Step 1: Write the failing test file**

Create `client/src/hooks/__tests__/useMapWeatherRadar.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMapWeatherRadar } from '../useMapWeatherRadar';

function makeMap() {
  return {
    style: {},
    getLayer: vi.fn().mockReturnValue(null),
    getSource: vi.fn().mockReturnValue(null),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
    setPaintProperty: vi.fn(),
  } as any;
}

const FRAMES_RESPONSE = {
  host: 'https://tilecache.rainviewer.com',
  radar: {
    past: [
      { time: 1700000000, path: '/v2/radar/1700000000' },
      { time: 1700000600, path: '/v2/radar/1700000600' },
    ],
  },
};

describe('useMapWeatherRadar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(FRAMES_RESPONSE),
    }) as any;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does nothing while disabled — no fetch, no map calls', () => {
    const map = makeMap();
    renderHook(() => useMapWeatherRadar(map, true));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it('fetches RainViewer frames and adds the latest frame as a raster layer when enabled', async () => {
    const map = makeMap();
    const { result } = renderHook(() => useMapWeatherRadar(map, true));

    await act(async () => {
      result.current.setEnabled(true);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.rainviewer.com/public/weather-maps.json',
      expect.anything(),
    );
    expect(map.addSource).toHaveBeenCalledWith('rmpg-weather-radar', expect.objectContaining({
      type: 'raster',
      tiles: ['https://tilecache.rainviewer.com/v2/radar/1700000600/256/{z}/{x}/{y}/2/1_1.png'],
    }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'rmpg-weather-radar-layer',
      source: 'rmpg-weather-radar',
    }));
  });

  it('polls again after 5 minutes and swaps in a newer frame', async () => {
    const map = makeMap();
    const { result } = renderHook(() => useMapWeatherRadar(map, true));
    await act(async () => {
      result.current.setEnabled(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(map.addSource).toHaveBeenCalledTimes(1);

    const nextFrames = {
      host: 'https://tilecache.rainviewer.com',
      radar: { past: [...FRAMES_RESPONSE.radar.past, { time: 1700001200, path: '/v2/radar/1700001200' }] },
    };
    (global.fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve(nextFrames) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(map.addSource).toHaveBeenCalledTimes(2);
    expect(map.addSource).toHaveBeenLastCalledWith('rmpg-weather-radar', expect.objectContaining({
      tiles: ['https://tilecache.rainviewer.com/v2/radar/1700001200/256/{z}/{x}/{y}/2/1_1.png'],
    }));
  });

  it('removes the layer and source when disabled again', async () => {
    const map = makeMap();
    const { result } = renderHook(() => useMapWeatherRadar(map, true));
    await act(async () => {
      result.current.setEnabled(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(map.addLayer).toHaveBeenCalled();

    // Simulate the layer/source now being registered on the map.
    map.getLayer.mockReturnValue({ id: 'rmpg-weather-radar-layer' });
    map.getSource.mockReturnValue({ id: 'rmpg-weather-radar' });

    act(() => result.current.setEnabled(false));

    expect(map.removeLayer).toHaveBeenCalledWith('rmpg-weather-radar-layer');
    expect(map.removeSource).toHaveBeenCalledWith('rmpg-weather-radar');
  });

  it('swallows a fetch failure without throwing and without adding a layer', async () => {
    const map = makeMap();
    (global.fetch as any).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useMapWeatherRadar(map, true));

    await act(async () => {
      result.current.setEnabled(true);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(map.addSource).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails against the current implementation**

Run: `cd client && npx vitest run src/hooks/__tests__/useMapWeatherRadar.test.ts`

Expected: FAIL. The current `useMapWeatherRadar.ts` doesn't call `fetch`, doesn't add a source named `rmpg-weather-radar`, and exposes `showLayer`/`activeLayer` instead of `setEnabled` — so `result.current.setEnabled` will be `undefined` and the test throws a `TypeError`.

- [ ] **Step 3: Rewrite the hook**

Replace the full contents of `client/src/hooks/useMapWeatherRadar.ts` with:

```ts
/**
 * useMapWeatherRadar — live NOAA/NWS precipitation radar overlay for Mapbox GL.
 *
 * Backed by RainViewer's public API (https://www.rainviewer.com/api.html),
 * which republishes NOAA/global radar composites — no API key required.
 * Replaces the earlier OpenWeatherMap-backed version, which pointed at an
 * `appid=demo` placeholder key that OpenWeatherMap does not honor.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { hasLayer, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';
import { devLog, devWarn } from '../utils/devLog';

// ── Types ─────────────────────────────────────────────────

export interface RainviewerFrame {
  time: number; // unix seconds
  path: string; // e.g. "/v2/radar/1700000000"
}

interface RainviewerApiResponse {
  host: string;
  radar: { past: RainviewerFrame[]; nowcast?: RainviewerFrame[] };
}

export interface UseMapWeatherRadarResult {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (v: boolean) => void;
  opacity: number;
  setOpacity: (v: number) => void;
  /** Frames fetched from RainViewer's last poll — unused today, exposed for a future radar-timeline scrubber. */
  frames: RainviewerFrame[];
}

// ── Constants ─────────────────────────────────────────────

const WEATHER_SOURCE = 'rmpg-weather-radar';
const WEATHER_LAYER = 'rmpg-weather-radar-layer';
const RAINVIEWER_FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // RainViewer publishes a new frame roughly every 5-10 min
const TILE_SIZE = 256;
const COLOR_SCHEME = 2; // "Universal Blue" — the common blue->green->red precip ramp
const TILE_OPTIONS = '1_1'; // smooth=1, snow-color=1

function buildTileUrl(host: string, frame: RainviewerFrame): string {
  return `${host}${frame.path}/${TILE_SIZE}/{z}/{x}/{y}/${COLOR_SCHEME}/${TILE_OPTIONS}.png`;
}

// ── Hook ──────────────────────────────────────────────────

export function useMapWeatherRadar(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
): UseMapWeatherRadarResult {
  const [enabled, setEnabled] = useState(false);
  const [opacity, setOpacity] = useState(0.6);
  const [frames, setFrames] = useState<RainviewerFrame[]>([]);
  const renderedFrameKeyRef = useRef<string | null>(null);

  const removeLayer = useCallback(() => {
    if (!map) return;
    safeRemoveLayer(map, WEATHER_LAYER);
    safeRemoveSource(map, WEATHER_SOURCE);
    renderedFrameKeyRef.current = null;
  }, [map]);

  const addOrReplaceLayer = useCallback((host: string, frame: RainviewerFrame) => {
    if (!map) return;
    if (renderedFrameKeyRef.current === frame.path) return; // already showing this frame
    removeLayer();
    map.addSource(WEATHER_SOURCE, {
      type: 'raster',
      tiles: [buildTileUrl(host, frame)],
      tileSize: TILE_SIZE,
      attribution: '&copy; <a href="https://www.rainviewer.com">RainViewer</a>',
    });
    map.addLayer({
      id: WEATHER_LAYER,
      type: 'raster',
      source: WEATHER_SOURCE,
      paint: { 'raster-opacity': opacity, 'raster-fade-duration': 300 },
    });
    renderedFrameKeyRef.current = frame.path;
    devLog('[WeatherRadar] Rendering frame', frame.path);
  }, [map, opacity, removeLayer]);

  const fetchFrames = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetch(RAINVIEWER_FRAMES_URL, { signal });
      if (!res.ok) throw new Error(`RainViewer responded ${res.status}`);
      const data: RainviewerApiResponse = await res.json();
      const past = data.radar?.past ?? [];
      setFrames(past);
      const latest = past[past.length - 1];
      if (latest) addOrReplaceLayer(data.host, latest);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      devWarn('[WeatherRadar] Failed to fetch RainViewer frames', err);
    }
  }, [addOrReplaceLayer]);

  // Fetch on enable + poll every 5 min while enabled; tear down when disabled.
  useEffect(() => {
    if (!map || !mapLoaded || !enabled) {
      removeLayer();
      return;
    }
    const controller = new AbortController();
    fetchFrames(controller.signal);
    const interval = setInterval(() => fetchFrames(controller.signal), POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [map, mapLoaded, enabled, fetchFrames, removeLayer]);

  // Live-update opacity on the rendered layer without refetching.
  useEffect(() => {
    if (!map || !hasLayer(map, WEATHER_LAYER)) return;
    map.setPaintProperty(WEATHER_LAYER, 'raster-opacity', opacity);
  }, [map, opacity]);

  // Cleanup on unmount.
  useEffect(() => () => removeLayer(), [removeLayer]);

  const toggle = useCallback(() => setEnabled((v) => !v), []);

  return { enabled, toggle, setEnabled, opacity, setOpacity, frames };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd client && npx vitest run src/hooks/__tests__/useMapWeatherRadar.test.ts`

Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck and full client test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`

Expected: no new TypeScript errors from this change (pre-existing unrelated errors, if any, are not this task's concern) and no new test failures.

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useMapWeatherRadar.ts client/src/hooks/__tests__/useMapWeatherRadar.test.ts
git commit -m "$(cat <<'EOF'
fix(map): replace broken OpenWeatherMap weather radar with live RainViewer/NOAA data

useMapWeatherRadar previously pointed at OpenWeatherMap with an appid=demo
placeholder key, which OpenWeatherMap does not honor — the toggle existed
but never rendered real tiles. Replaces it with RainViewer's public,
keyless API (republishes NOAA/global radar composites), polling every 5
minutes for the newest frame. Trims the hook to precipitation-only, since
no UI ever exposed the other 4 OpenWeatherMap layer types.
EOF
)"
```

---

### Task 2: Wire live traffic + weather radar onto `NavMapView.tsx`

**Files:**
- Modify: `client/src/components/NavMapView.tsx`
- Create: `client/src/components/__tests__/NavMapView.test.tsx`

**Interfaces:**
- Consumes: `useMapTraffic(map, mapLoaded)` from `client/src/hooks/useMapTraffic.ts` (existing, unmodified) returning `{ enabled, toggle, setEnabled }`; `useMapWeatherRadar(map, mapLoaded)` from Task 1 returning `{ enabled, toggle, setEnabled, opacity, setOpacity, frames }`. `NavMapView` uses only `.enabled` and `.toggle` from each.
- Produces: no new exports — this task only adds internal wiring + two buttons to the existing default-exported `NavMapView` component.

- [ ] **Step 1: Write the failing test file**

Create `client/src/components/__tests__/NavMapView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../utils/mapboxApiKey', () => ({
  getMapboxAccessToken: vi.fn().mockResolvedValue('pk.test-token'),
  getMapboxTokenErrorMessage: vi.fn().mockReturnValue('Mapbox token missing'),
}));

vi.mock('../../utils/mapboxLoader', () => ({
  initMapbox: vi.fn(),
  mapboxgl: {
    Map: vi.fn().mockImplementation(() => ({
      addControl: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      remove: vi.fn(),
    })),
    NavigationControl: vi.fn(),
    AttributionControl: vi.fn(),
  },
  MAPBOX_STYLE_DARK: 'mock://dark',
  MAPBOX_STYLE_SATELLITE: 'mock://satellite',
  MAPBOX_STYLE_STREETS: 'mock://streets',
  MAPBOX_STYLE_LIGHT: 'mock://light',
  classifyMapboxError: vi.fn().mockReturnValue({ message: '', isAuthErr: false }),
}));

vi.mock('../../utils/mapboxBasemap', () => ({ applyRmpgBasemap: vi.fn() }));

const trafficToggle = vi.fn();
const weatherToggle = vi.fn();
let trafficEnabled = false;
let weatherEnabled = false;

vi.mock('../../hooks/useMapTraffic', () => ({
  useMapTraffic: vi.fn(() => ({ enabled: trafficEnabled, toggle: trafficToggle, setEnabled: vi.fn() })),
}));
vi.mock('../../hooks/useMapWeatherRadar', () => ({
  useMapWeatherRadar: vi.fn(() => ({
    enabled: weatherEnabled, toggle: weatherToggle, setEnabled: vi.fn(),
    opacity: 0.6, setOpacity: vi.fn(), frames: [],
  })),
}));

import NavMapView from '../NavMapView';

describe('NavMapView — live traffic + weather radar controls', () => {
  beforeEach(() => {
    trafficEnabled = false;
    weatherEnabled = false;
    trafficToggle.mockClear();
    weatherToggle.mockClear();
  });

  it('renders traffic and weather toggle buttons when controls are shown', () => {
    render(<NavMapView position={null} showControls />);
    expect(screen.getByTitle('Show live traffic')).toBeInTheDocument();
    expect(screen.getByTitle('Show weather radar')).toBeInTheDocument();
  });

  it('calls the traffic hook toggle when the traffic button is clicked', () => {
    render(<NavMapView position={null} showControls />);
    fireEvent.click(screen.getByTitle('Show live traffic'));
    expect(trafficToggle).toHaveBeenCalledTimes(1);
  });

  it('calls the weather hook toggle when the weather button is clicked', () => {
    render(<NavMapView position={null} showControls />);
    fireEvent.click(screen.getByTitle('Show weather radar'));
    expect(weatherToggle).toHaveBeenCalledTimes(1);
  });

  it('reflects the active state in the button title', () => {
    trafficEnabled = true;
    weatherEnabled = true;
    render(<NavMapView position={null} showControls />);
    expect(screen.getByTitle('Hide live traffic')).toBeInTheDocument();
    expect(screen.getByTitle('Hide weather radar')).toBeInTheDocument();
  });

  it('hides both toggle buttons when showControls is false', () => {
    render(<NavMapView position={null} showControls={false} />);
    expect(screen.queryByTitle('Show live traffic')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Show weather radar')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd client && npx vitest run src/components/__tests__/NavMapView.test.tsx`

Expected: FAIL — `screen.getByTitle('Show live traffic')` throws (element not found), since `NavMapView` doesn't call either hook or render either button yet.

- [ ] **Step 3: Add the imports**

In `client/src/components/NavMapView.tsx`, update the top import block:

```tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Crosshair, Layers, ZoomIn, ZoomOut, Trash2, MapPin, AlertCircle, Route, CloudRain,
} from 'lucide-react';
import {
  initMapbox, mapboxgl, MAPBOX_STYLE_DARK, MAPBOX_STYLE_SATELLITE,
  MAPBOX_STYLE_STREETS, MAPBOX_STYLE_LIGHT, classifyMapboxError,
} from '../utils/mapboxLoader';
import { getMapboxAccessToken, getMapboxTokenErrorMessage } from '../utils/mapboxApiKey';
import { applyRmpgBasemap, type BasemapVariant } from '../utils/mapboxBasemap';
import { useMapTraffic } from '../hooks/useMapTraffic';
import { useMapWeatherRadar } from '../hooks/useMapWeatherRadar';
import type { NavRoutePoint } from '../types';
import {
  applyNavTheme, resolveNavTheme, navThemeStyleUrl, trailFilter, speedAdaptiveZoom,
  navOverlayPalette, applyNavOverlayPalette,
  type NavMapTheme, type NavMapOrientation, type TrailPoint,
} from './navMapHelpers';
```

(This only adds `Route, CloudRain` to the lucide-react import and two new hook imports — every other line is unchanged.)

- [ ] **Step 4: Add the two hook calls**

Find this block (currently ending the component's top-level state declarations):

```tsx
  const [userPanned, setUserPanned] = useState(false);
  const positionMarkerRef = useRef<mapboxgl.Marker | null>(null);
```

Change it to:

```tsx
  const [userPanned, setUserPanned] = useState(false);
  const positionMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const traffic = useMapTraffic(mapRef.current, mapReady);
  const weatherRadar = useMapWeatherRadar(mapRef.current, mapReady);
```

- [ ] **Step 5: Add the two toggle buttons**

Find this block (the zoom in/out control, immediately followed by the style-toggle comment):

```tsx
          {/* Zoom in/out (left side, below recenter) */}
          <div className="absolute top-12 left-2 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => handleZoom(1)}
              className="w-8 h-8 flex items-center justify-center rounded-sm border border-subtle"
              style={{ background: 'rgba(10,10,10,0.85)', color: 'var(--text-secondary)' }}
              title="Zoom in"
            >
              <ZoomIn size={14} />
            </button>
            <button
              type="button"
              onClick={() => handleZoom(-1)}
              className="w-8 h-8 flex items-center justify-center rounded-sm border border-subtle"
              style={{ background: 'rgba(10,10,10,0.85)', color: 'var(--text-secondary)' }}
              title="Zoom out"
            >
              <ZoomOut size={14} />
            </button>
          </div>

          {/* Style toggle (bottom-left) */}
```

Insert a new block between the closing `</div>` of the zoom stack and the "Style toggle" comment:

```tsx
          {/* Zoom in/out (left side, below recenter) */}
          <div className="absolute top-12 left-2 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => handleZoom(1)}
              className="w-8 h-8 flex items-center justify-center rounded-sm border border-subtle"
              style={{ background: 'rgba(10,10,10,0.85)', color: 'var(--text-secondary)' }}
              title="Zoom in"
            >
              <ZoomIn size={14} />
            </button>
            <button
              type="button"
              onClick={() => handleZoom(-1)}
              className="w-8 h-8 flex items-center justify-center rounded-sm border border-subtle"
              style={{ background: 'rgba(10,10,10,0.85)', color: 'var(--text-secondary)' }}
              title="Zoom out"
            >
              <ZoomOut size={14} />
            </button>
          </div>

          {/* Live traffic + weather radar (top-right, below Mapbox's own
              native zoom control which occupies the very top-right corner) */}
          <div className="absolute top-16 right-2 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => traffic.toggle()}
              className="w-8 h-8 flex items-center justify-center rounded-sm border border-subtle"
              style={{ background: 'rgba(10,10,10,0.85)', color: traffic.enabled ? '#22c55e' : '#888' }}
              title={traffic.enabled ? 'Hide live traffic' : 'Show live traffic'}
            >
              <Route size={14} />
            </button>
            <button
              type="button"
              onClick={() => weatherRadar.toggle()}
              className="w-8 h-8 flex items-center justify-center rounded-sm border border-subtle"
              style={{ background: 'rgba(10,10,10,0.85)', color: weatherRadar.enabled ? '#3b82f6' : '#888' }}
              title={weatherRadar.enabled ? 'Hide weather radar' : 'Show weather radar'}
            >
              <CloudRain size={14} />
            </button>
          </div>

          {/* Style toggle (bottom-left) */}
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `cd client && npx vitest run src/components/__tests__/NavMapView.test.tsx`

Expected: PASS (5 tests).

- [ ] **Step 7: Typecheck and full client test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`

Expected: no new TypeScript errors, no new test failures.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/NavMapView.tsx client/src/components/__tests__/NavMapView.test.tsx
git commit -m "$(cat <<'EOF'
feat(nav): add live traffic + weather radar toggles to NavMapView

Wires the existing useMapTraffic hook and the RainViewer-backed
useMapWeatherRadar hook (fixed in the prior commit) onto the Nav
mini-map, which previously had neither. Two new toggle buttons in the
top-right corner, both default off, matching the pattern already
shipped on MapboxMapPage.
EOF
)"
```

---

### Task 3: Manual live-data verification (Map page + Nav page)

Production (`rmpgutah.us` / `api.rmpgutah.us`) sits behind a Cloudflare managed
challenge for everything except `/api/health`, so this cannot be confirmed with
`curl` post-deploy — verify locally instead, using real network requests to the
real external APIs (no mocks), per this repo's documented WAF gotcha.

**Files:** none (verification only, no code changes).

- [ ] **Step 1: Start the client dev server**

Run: `cd client && npm run dev`

Expected: Vite dev server starts on `http://localhost:5173`.

- [ ] **Step 2: Verify traffic + weather on the Map page**

Using a browser (or the Browser preview tool), log in and navigate to `http://localhost:5173/map`. Open the browser's Network panel.

1. Click the "Live Traffic" toolbar toggle. Confirm requests to a URL containing `mapbox-traffic-v1` succeed (this is a regression check only — `useMapTraffic.ts` was not modified in this plan).
2. Click the "Weather Radar" toolbar toggle. Confirm:
   - A request to `https://api.rainviewer.com/public/weather-maps.json` returns HTTP 200 with a JSON body containing a `radar.past` array.
   - A subsequent tile request to `https://tilecache.rainviewer.com/v2/radar/...` returns HTTP 200 with `content-type: image/png` (not a 404).
   - The radar layer is visible on the map wherever precipitation echoes exist at test time (if no precipitation is present anywhere in view, that is not itself a failure — re-check the network responses instead of relying on visible echoes).
3. Toggle both off. Confirm no Mapbox console errors are logged (the exact failure class `mapboxSafeLayer.ts` exists to prevent).

- [ ] **Step 3: Verify traffic + weather on the Nav page**

Navigate to `http://localhost:5173/nav`. Click the new traffic (`Route` icon) and weather (`CloudRain` icon) buttons in the top-right corner of the nav mini-map. Repeat the same three checks from Step 2 (traffic tiles load, RainViewer JSON + tile requests succeed, clean toggle-off with no console errors).

- [ ] **Step 4: Confirm no regressions in the rest of the Map/Nav UI**

Toggle a few of the Map page's other existing layers (e.g. heatmap, breadcrumbs) on and off to confirm this change didn't disturb unrelated toolbar state. No code changes expected from this step — it's a smoke check only.
