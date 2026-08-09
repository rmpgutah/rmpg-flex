/**
 * useMapWeatherRadar — live NOAA/NWS precipitation radar overlay for Mapbox GL.
 *
 * Backed by RainViewer's public API (https://www.rainviewer.com/api.html),
 * which republishes NOAA/global radar composites — no API key required.
 * Replaces the earlier OpenWeatherMap-backed version, which pointed at an
 * `appid=demo` placeholder key that OpenWeatherMap does not honor.
 *
 * Beyond the single latest frame, this hook exposes the full past + nowcast
 * frame list with playback controls so the map can render a radar timeline
 * (see pages/map/components/WeatherRadarControl.tsx). Playback is opt-in —
 * nothing animates until `play()` is called.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';
import { devLog, devWarn } from '../utils/devLog';

// ── Types ─────────────────────────────────────────────────

export interface RainviewerFrame {
  time: number; // unix seconds
  path: string; // e.g. "/v2/radar/1700000000"
  /** 'past' = observed radar, 'nowcast' = RainViewer's short-range forecast. */
  kind?: 'past' | 'nowcast';
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
  /** Past frames followed by nowcast frames, oldest → newest. */
  frames: RainviewerFrame[];
  /** Index into `frames` currently rendered on the map. -1 when none. */
  frameIndex: number;
  /** Scrub to a specific frame. Pins playback there until `resumeLive()`. */
  setFrameIndex: (i: number) => void;
  /** True while the overlay is auto-advancing through the loop. */
  playing: boolean;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  /** Drop the manual pin and follow the newest observed frame again. */
  resumeLive: () => void;
  /** False once the operator scrubs off the newest observed frame. */
  live: boolean;
  /** Frame currently on the map, or null before the first fetch resolves. */
  activeFrame: RainviewerFrame | null;
  /** Wall-clock time of the last successful RainViewer poll. */
  lastPolledAt: Date | null;
  /** True when the last poll failed — surfaced so the UI can say so. */
  error: boolean;
  loading: boolean;
}

// ── Constants ─────────────────────────────────────────────

const WEATHER_SOURCE = 'rmpg-weather-radar';
const WEATHER_LAYER = 'rmpg-weather-radar-layer';
const RAINVIEWER_FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // RainViewer publishes a new frame roughly every 5-10 min
const TILE_SIZE = 256;
const COLOR_SCHEME = 2; // "Universal Blue" — the common blue->green->red precip ramp
const TILE_OPTIONS = '1_1'; // smooth=1, snow-color=1
// RainViewer's tile API tops out at z7 ("Maximum zoom level is 7" —
// https://www.rainviewer.com/api/weather-maps-api.html). Without declaring
// that on the Mapbox source, GL requests tiles at whatever zoom the user is
// actually viewing (city-level zooms are 11+), and RainViewer's own server
// answers those with an error-placeholder image reading "Zoom Level Not
// Supported" baked into the tile — which Mapbox then renders as if it were
// real radar data. Declaring maxzoom makes GL stop at z7 and overzoom
// (upscale) that tile for anything deeper, which is the correct fallback
// for a low-resolution composite like weather radar anyway.
const RAINVIEWER_MAX_ZOOM = 7;
/** Per-frame dwell during playback. ~1.7 fps reads as motion without smearing. */
const PLAYBACK_FRAME_MS = 600;
/** Extra dwell on the newest frame so the loop has a readable "now" beat. */
const PLAYBACK_LOOP_PAUSE_MS = 1200;

function buildTileUrl(host: string, path: string): string {
  return `${host}${path}/${TILE_SIZE}/{z}/{x}/{y}/${COLOR_SCHEME}/${TILE_OPTIONS}.png`;
}

/**
 * Radar reflectivity legend for RainViewer colour scheme 2 ("Universal Blue").
 * Literal hex is correct here: these swatches must match the tile imagery,
 * which does not re-theme with the app palette.
 */
export const RADAR_LEGEND: Array<{ label: string; color: string }> = [
  { label: 'Light', color: '#67a9cf' },
  { label: 'Moderate', color: '#3690c0' },
  { label: 'Heavy', color: '#02818a' },
  { label: 'Intense', color: '#fdae61' },
  { label: 'Extreme', color: '#d7301f' },
];

// ── Hook ──────────────────────────────────────────────────

export function useMapWeatherRadar(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
): UseMapWeatherRadarResult {
  const [enabled, setEnabled] = useState(false);
  const [opacity, setOpacity] = useState(0.6);
  const [frames, setFrames] = useState<RainviewerFrame[]>([]);
  const [host, setHost] = useState<string | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<Date | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  /** null = "follow the newest observed frame"; a number pins that index. */
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);

  const opacityRef = useRef(opacity);
  useEffect(() => { opacityRef.current = opacity; }, [opacity]);
  const renderedFrameKeyRef = useRef<string | null>(null);
  const hostRef = useRef<string | null>(null);
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Index of the newest *observed* frame — the default "live" view. Nowcast
  // frames sit after it in the array and are only reached by scrubbing or
  // playback, so the map never silently shows a forecast as if it were an
  // observation.
  const liveIndex = useMemo(() => {
    let last = -1;
    frames.forEach((f, i) => { if (f.kind !== 'nowcast') last = i; });
    return last === -1 ? frames.length - 1 : last;
  }, [frames]);

  const frameIndex = pinnedIndex ?? liveIndex;
  const activeFrame = frames[frameIndex] ?? null;

  const removeLayer = useCallback(() => {
    if (!map) return;
    safeRemoveLayer(map, WEATHER_LAYER);
    safeRemoveSource(map, WEATHER_SOURCE);
    renderedFrameKeyRef.current = null;
  }, [map]);

  const addOrReplaceLayer = useCallback((tileHost: string, path: string) => {
    if (!map) return;
    if (renderedFrameKeyRef.current === path) return; // already showing this frame

    // Frame-to-frame playback swaps the tile URL on the EXISTING source via
    // setTiles() instead of remove+re-add. Tearing down and rebuilding the
    // source/layer every ~600ms (the old behavior) blanked the map between
    // frames and defeated `raster-fade-duration` below — GL can only
    // cross-fade tiles on a source it already has a previous frame loaded
    // on, not across a source it just destroyed and recreated. Only the
    // first render (or a re-add after the overlay was fully disabled) needs
    // a real addSource/addLayer.
    if (hasSource(map, WEATHER_SOURCE) && hasLayer(map, WEATHER_LAYER)) {
      (map.getSource(WEATHER_SOURCE) as mapboxgl.RasterTileSource).setTiles([buildTileUrl(tileHost, path)]);
    } else {
      removeLayer();
      map.addSource(WEATHER_SOURCE, {
        type: 'raster',
        tiles: [buildTileUrl(tileHost, path)],
        tileSize: TILE_SIZE,
        maxzoom: RAINVIEWER_MAX_ZOOM,
        attribution: '&copy; <a href="https://www.rainviewer.com">RainViewer</a>',
      });
      map.addLayer({
        id: WEATHER_LAYER,
        type: 'raster',
        source: WEATHER_SOURCE,
        paint: { 'raster-opacity': opacityRef.current, 'raster-fade-duration': 300 },
      });
    }
    renderedFrameKeyRef.current = path;
    hostRef.current = tileHost;
    devLog('[WeatherRadar] Rendering frame', path);
  }, [map, removeLayer]);

  const fetchFrames = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch(RAINVIEWER_FRAMES_URL, { signal });
      if (!res.ok) throw new Error(`RainViewer responded ${res.status}`);
      const data: RainviewerApiResponse = await res.json();
      const past = (data.radar?.past ?? []).map((f) => ({ ...f, kind: 'past' as const }));
      const nowcast = (data.radar?.nowcast ?? []).map((f) => ({ ...f, kind: 'nowcast' as const }));
      const all = [...past, ...nowcast];
      setHost(data.host);
      setFrames(all);
      setLastPolledAt(new Date());
      setError(false);
      // A poll that lands while the operator is scrubbing must not yank the
      // view back to live — only clamp a pin that now points past the array.
      setPinnedIndex((prev) => (prev == null ? null : Math.min(prev, all.length - 1)));
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setError(true);
      devWarn('[WeatherRadar] Failed to fetch RainViewer frames', err);
    } finally {
      setLoading(false);
    }
  }, []);

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

  // Render whichever frame is selected. Split out from fetching so scrubbing
  // and playback re-render without touching the network.
  useEffect(() => {
    if (!map || !mapLoaded || !enabled) return;
    if (!host || !activeFrame) return;
    addOrReplaceLayer(host, activeFrame.path);
  }, [map, mapLoaded, enabled, host, activeFrame, addOrReplaceLayer]);

  // Playback loop. Advances the pin one frame per tick and wraps to the oldest
  // frame at the end, dwelling a beat longer on the final frame.
  useEffect(() => {
    if (!playing || !enabled || frames.length < 2) return;
    const atEnd = frameIndex >= frames.length - 1;
    const delay = atEnd ? PLAYBACK_LOOP_PAUSE_MS : PLAYBACK_FRAME_MS;
    const timer = setTimeout(() => {
      setPinnedIndex(atEnd ? 0 : frameIndex + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [playing, enabled, frames.length, frameIndex]);

  // Switching the overlay off resets playback so re-enabling starts live.
  useEffect(() => {
    if (!enabled) { setPlaying(false); setPinnedIndex(null); }
  }, [enabled]);

  // Live-update opacity on the rendered layer without refetching.
  useEffect(() => {
    if (!map || !hasLayer(map, WEATHER_LAYER)) return;
    map.setPaintProperty(WEATHER_LAYER, 'raster-opacity', opacity);
  }, [map, opacity]);

  // A basemap style swap (e.g. NavMapView's manual `map.setStyle()` path)
  // wipes all custom sources/layers but does NOT reset `mapLoaded` the way
  // a full map recreation does (that's how the main Map page picks up style
  // swaps for free). Re-add the already-known frame from the cached
  // host/path instead of re-fetching RainViewer — the frame we had was
  // still valid, only the map's rendering of it was wiped.
  useEffect(() => {
    if (!map) return;
    const onStyleLoad = () => {
      if (!enabledRef.current) return;
      const tileHost = hostRef.current;
      const path = renderedFrameKeyRef.current;
      if (!tileHost || !path) return;
      renderedFrameKeyRef.current = null; // clear so addOrReplaceLayer's dedup guard doesn't skip the re-add
      addOrReplaceLayer(tileHost, path);
    };
    map.on('style.load', onStyleLoad);
    return () => {
      map.off('style.load', onStyleLoad);
    };
  }, [map, addOrReplaceLayer]);

  // Cleanup on unmount.
  useEffect(() => () => removeLayer(), [removeLayer]);

  const toggle = useCallback(() => setEnabled((v) => !v), []);
  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const togglePlay = useCallback(() => setPlaying((v) => !v), []);
  const resumeLive = useCallback(() => { setPlaying(false); setPinnedIndex(null); }, []);
  const scrubTo = useCallback((i: number) => {
    setPlaying(false);
    setPinnedIndex(i);
  }, []);

  return {
    enabled,
    toggle,
    setEnabled,
    opacity,
    setOpacity,
    frames,
    frameIndex,
    setFrameIndex: scrubTo,
    playing,
    play,
    pause,
    togglePlay,
    resumeLive,
    live: pinnedIndex == null,
    activeFrame,
    lastPolledAt,
    error,
    loading,
  };
}
