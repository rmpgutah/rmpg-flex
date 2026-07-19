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
  const opacityRef = useRef(opacity);
  useEffect(() => { opacityRef.current = opacity; }, [opacity]);
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
      paint: { 'raster-opacity': opacityRef.current, 'raster-fade-duration': 300 },
    });
    renderedFrameKeyRef.current = frame.path;
    devLog('[WeatherRadar] Rendering frame', frame.path);
  }, [map, removeLayer]);

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
