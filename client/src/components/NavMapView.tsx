// ============================================================
// RMPG Flex — Nav Map View
// Lightweight Mapbox mini-map for the NavPage. Shows the officer's
// current GPS position, breadcrumb trail, and recenter / style
// controls. No dispatch data, no routing — just "where am I, where
// have I been".
// ============================================================

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
import { useWebglMapRecovery } from '../hooks/useWebglMapRecovery';
import type { NavRoutePoint } from '../types';
import {
  applyNavTheme, resolveNavTheme, navThemeStyleUrl, trailFilter, speedAdaptiveZoom,
  navOverlayPalette, applyNavOverlayPalette,
  type NavMapTheme, type NavMapOrientation, type TrailPoint,
} from './navMapHelpers';

const DEFAULT_CENTER: [number, number] = [-111.891, 40.7608]; // Salt Lake City [lng, lat]
const DEFAULT_ZOOM = 15;
const TRAIL_SOURCE_ID = 'nav-trail-src';
const TRAIL_LAYER_ID = 'nav-trail-line';
const POSITION_SOURCE_ID = 'nav-pos-src';
const POSITION_LAYER_ID = 'nav-pos-dot';
const POSITION_HALO_LAYER_ID = 'nav-pos-halo';
const PIN_SOURCE_ID = 'nav-pin-src';
const PIN_LAYER_ID = 'nav-pin-dot';
const PIN_HALO_LAYER_ID = 'nav-pin-halo';

const STYLE_OPTIONS: { value: 'dark' | 'satellite' | 'streets'; label: string; url: string }[] = [
  { value: 'dark', label: 'Dark', url: MAPBOX_STYLE_DARK },
  { value: 'satellite', label: 'Satellite', url: MAPBOX_STYLE_SATELLITE },
  { value: 'streets', label: 'Streets', url: MAPBOX_STYLE_STREETS },
];

// Map the user's style selection (same signal that picks initialUrl/insetUrl)
// to the RMPG basemap re-skin variant. 'streets' = stock light style → 'light',
// which now correctly receives the fixed dark Blue/Silver/Gold restyle (this is
// an on-screen nav surface, not a print/export path — a bright map at night is
// a driving hazard).
function basemapVariantFor(s: 'dark' | 'satellite' | 'streets'): BasemapVariant {
  if (s === 'satellite') return 'satellite';
  if (s === 'streets') return 'light';
  return 'dark';
}

export interface DroppedPin {
  lat: number;
  lng: number;
  label: string;
  color: string;
  created_at: string;
}

export interface NavMapViewProps {
  /** Current GPS position (live from useGpsTracking) */
  position: { latitude: number; longitude: number; accuracy?: number | null } | null;
  /** Breadcrumb points from the active trip (optional) */
  routePoints?: NavRoutePoint[];
  /** Fixed height in pixels (default 240) */
  height?: number;
  /** Show style toggle / recenter / drop-pin controls (default true) */
  showControls?: boolean;
  /** Initial map style (default 'dark') */
  initialStyle?: 'dark' | 'satellite' | 'streets';
  /** Called when a quick pin is dropped at the current position */
  onDropPin?: (pin: DroppedPin) => void;
  /** Pinned dropped during this session (for visualization) */
  pins?: DroppedPin[];
  /** Optional: a polyline to show beyond breadcrumbs (e.g. recent trip end → start) */
  extraPath?: Array<{ lat: number; lng: number }>;
  // ── Nav map UPDATES (#96–#100) ───────────────────────────
  /** #96 Day/Night/Auto map theme. 'night' (default) = black recolor;
   *  'day' = lighter style, no recolor; 'auto' = pick by solar position. */
  theme?: NavMapTheme;
  /** #97 Camera orientation. 'heading-up' = bearing follows course (default);
   *  'north-up' = bearing locked to 0 (heading wedge still rotates). */
  mapOrientation?: NavMapOrientation;
  /** #97 Live course/heading in degrees (0–360) used for heading-up follow. */
  heading?: number | null;
  /** #98 Trim breadcrumb trail to the last N minutes (default = keep all). */
  maxTrailMinutes?: number | null;
  /** #99 Low-power mode: skip the 3D inset map + snap (0ms) the main camera. */
  lowPower?: boolean;
  /**
   * Allow callers to suppress the 3D look-ahead inset map even outside
   * low-power (e.g. Forensic Playback views where multiple NavMapView
   * instances render concurrently and the 16-WebGL-context browser cap
   * matters). Default true preserves existing behavior.
   */
  showInset?: boolean;
  /** #100 Speed-aware adaptive zoom for the follow-me camera (default off). */
  adaptiveZoom?: boolean;
  /** #100 Current speed in m/s (drives adaptiveZoom). */
  speed?: number | null;
}

export default function NavMapView({
  position, routePoints, height = 240, showControls = true,
  initialStyle = 'dark', onDropPin, pins = [], extraPath,
  theme = 'night', mapOrientation = 'heading-up', heading = null,
  maxTrailMinutes = null, lowPower = false, adaptiveZoom = false, speed = null,
  showInset = true,
}: NavMapViewProps) {
  // Combined gate: either signal disables the inset map and its WebGL context.
  const insetEnabled = !lowPower && showInset;
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const webglRecoveryCleanupRef = useRef<(() => void) | null>(null);
  const { rebuildNonce, attach, onMapLoaded } = useWebglMapRecovery();
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [style, setStyle] = useState<'dark' | 'satellite' | 'streets'>(initialStyle);
  const styleRef = useRef(style);
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [userPanned, setUserPanned] = useState(false);
  const positionMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const traffic = useMapTraffic(mapRef.current, mapReady);
  const weatherRadar = useMapWeatherRadar(mapRef.current, mapReady);

  // #99 inset (3D look-ahead) map — only mounted when not low-power.
  const insetContainerRef = useRef<HTMLDivElement>(null);
  const insetMapRef = useRef<mapboxgl.Map | null>(null);
  const [insetReady, setInsetReady] = useState(false);

  // Resolve the requested theme ('auto' → 'night' | 'day' by solar pos).
  const resolvedTheme = resolveNavTheme(
    theme,
    position?.latitude ?? null,
    position?.longitude ?? null,
  );

  // Mapbox style URLs for the theme recolor (#96). Satellite/streets keep
  // their own URLs; only the 'dark' selection participates in day/night.
  const themeStyleUrls = { dark: MAPBOX_STYLE_DARK, light: MAPBOX_STYLE_LIGHT };

  // Keep styleRef current so once-registered 'style.load' listeners (which
  // close over `style` by value) re-skin with the live variant after a
  // runtime setStyle() swap instead of the stale initial style.
  useEffect(() => { styleRef.current = style; }, [style]);

  // ── Initialize mapbox + create map ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const token = await getMapboxAccessToken();
        if (cancelled) return;
        if (!token) {
          setError(getMapboxTokenErrorMessage());
          return;
        }
        initMapbox(token);
        if (!mapContainerRef.current) return;

        // #96 Theme-aware initial style: the 'dark' selection becomes the
        // day or night basemap; satellite/streets keep their own URL.
        const baseStyleUrl = STYLE_OPTIONS.find((s) => s.value === style)?.url ?? MAPBOX_STYLE_DARK;
        const initialUrl = style === 'dark'
          ? navThemeStyleUrl(resolvedTheme, themeStyleUrls)
          : baseStyleUrl;
        const initialCenter: [number, number] = position
          ? [position.longitude, position.latitude]
          : DEFAULT_CENTER;

        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: initialUrl,
          center: initialCenter,
          zoom: DEFAULT_ZOOM,
          projection: 'mercator',
          attributionControl: false,
          // 2D-only — no pitch, no rotation, no 3D. The NavPage mini-map is for
          // glanceable position + breadcrumb, not a chase cam.
          pitch: 0,
          bearing: 0,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });

        map.addControl(new mapboxgl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right');
        map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

        // Brand the basemap on every style (re-applies after setStyle swaps).
        map.on('style.load', () => applyRmpgBasemap(map, { variant: basemapVariantFor(styleRef.current) }));

        // Track when user pans so we know to stop auto-recentering
        map.on('dragstart', () => setUserPanned(true));

        map.on('load', () => {
          if (cancelled) return;
          onMapLoaded(map);
          // Breadcrumb trail
          map.addSource(TRAIL_SOURCE_ID, {
            type: 'geojson',
            lineMetrics: true,
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
          });
          map.addLayer({
            id: TRAIL_LAYER_ID,
            type: 'line',
            source: TRAIL_SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': '#d4a017',
              'line-width': 3,
              'line-opacity': 0.85,
            },
          });
          // Position dot (gold pulse halo)
          map.addSource(POSITION_SOURCE_ID, {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: initialCenter } },
          });
          map.addLayer({
            id: POSITION_HALO_LAYER_ID,
            type: 'circle',
            source: POSITION_SOURCE_ID,
            paint: {
              'circle-radius': 16,
              'circle-color': '#d4a017',
              'circle-opacity': 0.18,
              'circle-stroke-color': '#d4a017',
              'circle-stroke-width': 1,
              'circle-stroke-opacity': 0.4,
            },
          });
          map.addLayer({
            id: POSITION_LAYER_ID,
            type: 'circle',
            source: POSITION_SOURCE_ID,
            paint: {
              'circle-radius': 6,
              'circle-color': '#d4a017',
              'circle-stroke-color': '#000',
              'circle-stroke-width': 2,
            },
          });
          // Dropped pins
          map.addSource(PIN_SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
          map.addLayer({
            id: PIN_HALO_LAYER_ID,
            type: 'circle',
            source: PIN_SOURCE_ID,
            paint: {
              'circle-radius': 14,
              'circle-color': ['get', 'color'],
              'circle-opacity': 0.2,
            },
          });
          map.addLayer({
            id: PIN_LAYER_ID,
            type: 'circle',
            source: PIN_SOURCE_ID,
            paint: {
              'circle-radius': 7,
              'circle-color': ['get', 'color'],
              'circle-stroke-color': '#000',
              'circle-stroke-width': 2,
            },
          });

          // #96 Apply theme recolor once basemap layers exist. 'night' pushes
          // toward pure-black (HUD-safe); 'day' is a no-op (lighter style as-is).
          if (style === 'dark') {
            try { applyNavTheme(map as any, resolvedTheme); } catch { /* ignore */ }
          }
          // Overlay palette swap — gold reads on dark, deeper amber on day.
          // The layer paint values created above use the night gold by default;
          // this re-skins them when the resolved theme is 'day'.
          try {
            applyNavOverlayPalette(map as any, navOverlayPalette(resolvedTheme), {
              route: TRAIL_LAYER_ID,
              positionHalo: POSITION_HALO_LAYER_ID,
              position: POSITION_LAYER_ID,
            });
          } catch { /* ignore */ }

          if (cancelled) {
            map.remove();
            return;
          }
          mapRef.current = map;
          webglRecoveryCleanupRef.current = attach(map, 'NavMapView');
          setMapReady(true);
        });

        map.on('error', (e) => {
          console.warn('[NavMapView] mapbox error:', e?.error?.message || e);
          // Mapbox's async style/tile-load failures (bad/expired token, etc.)
          // only fire this event — they never throw a catchable exception —
          // so without this the map silently rendered blank/black with zero
          // indication of what's wrong. Only surface auth errors; network
          // blips are retried internally by Mapbox GL and shouldn't interrupt
          // the view (this component is used while driving).
          if (cancelled) return;
          const { message, isAuthErr } = classifyMapboxError(e);
          if (isAuthErr) setError(message);
        });
      } catch (err) {
        if (cancelled) return;
        console.error('[NavMapView] init failed:', err);
        setError(err instanceof Error ? err.message : 'Map failed to load');
      }
    })();

    return () => {
      cancelled = true;
      webglRecoveryCleanupRef.current?.();
      webglRecoveryCleanupRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuildNonce]);

  // ── Style change ───────────────────────────────────────────
  const handleStyleChange = useCallback((next: 'dark' | 'satellite' | 'streets') => {
    const baseTarget = STYLE_OPTIONS.find((s) => s.value === next)?.url;
    if (!baseTarget || !mapRef.current) return;
    // #96 'dark' selection honors the active day/night theme.
    const target = next === 'dark'
      ? navThemeStyleUrl(resolvedTheme, themeStyleUrls)
      : baseTarget;
    setStyle(next);
    setStyleMenuOpen(false);
    try {
      mapRef.current.setStyle(target);
      // Layers need to be re-added after setStyle; the load handler won't fire
      // for the same map instance. We add them on the next 'styledata' event.
      const onStyledata = () => {
        if (!mapRef.current) return;
        const m = mapRef.current;
        if (!m.getSource(TRAIL_SOURCE_ID)) {
          m.addSource(TRAIL_SOURCE_ID, {
            type: 'geojson',
            lineMetrics: true,
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
          });
          m.addLayer({
            id: TRAIL_LAYER_ID, type: 'line', source: TRAIL_SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#d4a017', 'line-width': 3, 'line-opacity': 0.85 },
          });
        }
        if (!m.getSource(POSITION_SOURCE_ID)) {
          m.addSource(POSITION_SOURCE_ID, {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: m.getCenter().toArray() } },
          });
          m.addLayer({ id: POSITION_HALO_LAYER_ID, type: 'circle', source: POSITION_SOURCE_ID, paint: { 'circle-radius': 16, 'circle-color': '#d4a017', 'circle-opacity': 0.18, 'circle-stroke-color': '#d4a017', 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.4 } });
          m.addLayer({ id: POSITION_LAYER_ID, type: 'circle', source: POSITION_SOURCE_ID, paint: { 'circle-radius': 6, 'circle-color': '#d4a017', 'circle-stroke-color': '#000', 'circle-stroke-width': 2 } });
        }
        if (!m.getSource(PIN_SOURCE_ID)) {
          m.addSource(PIN_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          m.addLayer({ id: PIN_HALO_LAYER_ID, type: 'circle', source: PIN_SOURCE_ID, paint: { 'circle-radius': 14, 'circle-color': ['get', 'color'], 'circle-opacity': 0.2 } });
          m.addLayer({ id: PIN_LAYER_ID, type: 'circle', source: PIN_SOURCE_ID, paint: { 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#000', 'circle-stroke-width': 2 } });
        }
        // #96 Re-apply recolor after a style swap (only for the dark/theme basemap).
        if (next === 'dark') {
          try { applyNavTheme(m as any, resolvedTheme); } catch { /* ignore */ }
        }
        // Re-apply overlay palette after the style swap (overlay layers were
        // dropped + re-added with default gold paint; day mode needs amber).
        try {
          applyNavOverlayPalette(m as any, navOverlayPalette(resolvedTheme), {
            route: TRAIL_LAYER_ID,
            positionHalo: POSITION_HALO_LAYER_ID,
            position: POSITION_LAYER_ID,
          });
        } catch { /* ignore */ }
        m.off('styledata', onStyledata);
      };
      mapRef.current.on('styledata', onStyledata);
    } catch (err) {
      console.warn('[NavMapView] setStyle failed:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme]);

  // #96 React to live theme changes (prop flip or 'auto' crossing sunrise/sunset)
  // while the 'dark' basemap is active: swap to the matching style + recolor.
  const lastResolvedThemeRef = useRef<'night' | 'day'>(resolvedTheme);
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (style !== 'dark') return; // satellite/streets don't theme
    if (lastResolvedThemeRef.current === resolvedTheme) return;
    lastResolvedThemeRef.current = resolvedTheme;
    const m = mapRef.current;
    try {
      m.setStyle(navThemeStyleUrl(resolvedTheme, themeStyleUrls));
      const onStyledata = () => {
        if (!mapRef.current) return;
        const mm = mapRef.current;
        // Re-add overlay layers if the style swap dropped them.
        if (!mm.getSource(TRAIL_SOURCE_ID)) {
          mm.addSource(TRAIL_SOURCE_ID, {
            type: 'geojson', lineMetrics: true,
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
          });
          mm.addLayer({
            id: TRAIL_LAYER_ID, type: 'line', source: TRAIL_SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#d4a017', 'line-width': 3, 'line-opacity': 0.85 },
          });
        }
        if (!mm.getSource(POSITION_SOURCE_ID)) {
          mm.addSource(POSITION_SOURCE_ID, {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: mm.getCenter().toArray() } },
          });
          mm.addLayer({ id: POSITION_HALO_LAYER_ID, type: 'circle', source: POSITION_SOURCE_ID, paint: { 'circle-radius': 16, 'circle-color': '#d4a017', 'circle-opacity': 0.18, 'circle-stroke-color': '#d4a017', 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.4 } });
          mm.addLayer({ id: POSITION_LAYER_ID, type: 'circle', source: POSITION_SOURCE_ID, paint: { 'circle-radius': 6, 'circle-color': '#d4a017', 'circle-stroke-color': '#000', 'circle-stroke-width': 2 } });
        }
        if (!mm.getSource(PIN_SOURCE_ID)) {
          mm.addSource(PIN_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          mm.addLayer({ id: PIN_HALO_LAYER_ID, type: 'circle', source: PIN_SOURCE_ID, paint: { 'circle-radius': 14, 'circle-color': ['get', 'color'], 'circle-opacity': 0.2 } });
          mm.addLayer({ id: PIN_LAYER_ID, type: 'circle', source: PIN_SOURCE_ID, paint: { 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#000', 'circle-stroke-width': 2 } });
        }
        try { applyNavTheme(mm as any, resolvedTheme); } catch { /* ignore */ }
        // Re-apply overlay palette after the theme-change style swap.
        try {
          applyNavOverlayPalette(mm as any, navOverlayPalette(resolvedTheme), {
            route: TRAIL_LAYER_ID,
            positionHalo: POSITION_HALO_LAYER_ID,
            position: POSITION_LAYER_ID,
          });
        } catch { /* ignore */ }
        mm.off('styledata', onStyledata);
      };
      m.on('styledata', onStyledata);
    } catch (err) {
      console.warn('[NavMapView] theme swap failed:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, resolvedTheme, style]);

  // ── #99 Inset 3D look-ahead map ────────────────────────────
  // A small pitched chase-cam in the corner. Skipped entirely when the inset
  // is disabled (low-power OR showInset=false) so weak GPUs aren't asked to
  // render a second WebGL context — browsers cap at ~16 concurrent contexts
  // and stacking multiple NavMapView instances in a list previously hit it.
  useEffect(() => {
    if (!insetEnabled) {
      // Tear down any existing inset when toggled off.
      if (insetMapRef.current) {
        try { insetMapRef.current.remove(); } catch { /* ignore */ }
        insetMapRef.current = null;
      }
      setInsetReady(false);
      return;
    }
    if (!mapReady || !insetContainerRef.current || insetMapRef.current) return;

    let cancelled = false;
    try {
      const center: [number, number] = position
        ? [position.longitude, position.latitude]
        : DEFAULT_CENTER;
      const insetUrl = style === 'dark'
        ? navThemeStyleUrl(resolvedTheme, themeStyleUrls)
        : (STYLE_OPTIONS.find((s) => s.value === style)?.url ?? MAPBOX_STYLE_DARK);
      const inset = new mapboxgl.Map({
        container: insetContainerRef.current,
        style: insetUrl,
        center,
        zoom: 16,
        projection: 'mercator',
        pitch: 60, // 3D look-ahead
        bearing: 0,
        attributionControl: false,
        interactive: false,
      });
      inset.on('style.load', () => applyRmpgBasemap(inset, { variant: basemapVariantFor(styleRef.current) }));
      inset.on('load', () => {
        if (cancelled) { try { inset.remove(); } catch { /* ignore */ } return; }
        if (style === 'dark') {
          try { applyNavTheme(inset as any, resolvedTheme); } catch { /* ignore */ }
        }
        insetMapRef.current = inset;
        setInsetReady(true);
      });
      inset.on('error', () => { /* swallow inset errors — it's decorative */ });
    } catch (err) {
      console.warn('[NavMapView] inset init failed:', err);
    }

    return () => {
      cancelled = true;
      if (insetMapRef.current) {
        try { insetMapRef.current.remove(); } catch { /* ignore */ }
        insetMapRef.current = null;
      }
      setInsetReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, insetEnabled]);

  // #99 Drive the inset camera from live position/heading (follows the main).
  useEffect(() => {
    if (!insetEnabled || !insetReady || !insetMapRef.current || !position) return;
    const inset = insetMapRef.current;
    const bearing = (mapOrientation === 'heading-up' && typeof heading === 'number' && Number.isFinite(heading))
      ? heading
      : 0;
    try {
      inset.easeTo({
        center: [position.longitude, position.latitude],
        bearing,
        duration: lowPower ? 0 : 500,
      } as any);
    } catch { /* ignore */ }
  }, [insetReady, position, heading, mapOrientation, lowPower]);

  // ── Update position dot + follow-me camera ─────────────────
  // #97 orientation (heading-up vs north-up), #99 low-power snap,
  // #100 speed-aware adaptive zoom.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !position) return;
    const map = mapRef.current;
    const src = map.getSource(POSITION_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [position.longitude, position.latitude] },
    });
    if (userPanned) return;

    // #99 Low-power: snap (0ms) so weak GPUs don't animate every fix.
    const duration = lowPower ? 0 : 600;

    const cam: Record<string, any> = {
      center: [position.longitude, position.latitude],
      duration,
    };

    // #100 Adaptive zoom — nudge out at speed, in when slow. Clamped in helper.
    if (adaptiveZoom) {
      cam.zoom = speedAdaptiveZoom(speed, { baseZoom: 16.5, minZoom: 13.5 });
    }

    // #97 Orientation. heading-up: rotate the map to follow course.
    // north-up: lock bearing to 0 (the heading wedge marker still rotates).
    if (mapOrientation === 'north-up') {
      cam.bearing = 0;
    } else if (typeof heading === 'number' && Number.isFinite(heading)) {
      cam.bearing = heading;
    }

    try {
      map.easeTo(cam as any);
    } catch {
      map.easeTo({ center: [position.longitude, position.latitude], duration } as any);
    }
  }, [mapReady, position, userPanned, lowPower, adaptiveZoom, speed, mapOrientation, heading]);

  // #97 Heading wedge marker — a rotating gold arrow that always reflects
  // the live course, independent of map bearing (so north-up users still
  // see which way they're pointing). Rendered as an HTML Marker overlay.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !position) {
      if (positionMarkerRef.current) {
        try { positionMarkerRef.current.remove(); } catch { /* ignore */ }
        positionMarkerRef.current = null;
      }
      return;
    }
    const map = mapRef.current;
    const hasHeading = typeof heading === 'number' && Number.isFinite(heading);
    if (!hasHeading) {
      // No course → no wedge; keep the plain GPS dot only.
      if (positionMarkerRef.current) {
        try { positionMarkerRef.current.remove(); } catch { /* ignore */ }
        positionMarkerRef.current = null;
      }
      return;
    }
    if (!positionMarkerRef.current) {
      const el = document.createElement('div');
      el.setAttribute('aria-hidden', 'true');
      el.style.width = '0';
      el.style.height = '0';
      el.style.borderLeft = '6px solid transparent';
      el.style.borderRight = '6px solid transparent';
      el.style.borderBottom = '14px solid #d4a017';
      el.style.transformOrigin = '50% 70%';
      el.style.filter = 'drop-shadow(0 0 2px #000)';
      el.style.pointerEvents = 'none';
      try {
        positionMarkerRef.current = new mapboxgl.Marker({ element: el, rotationAlignment: 'map' })
          .setLngLat([position.longitude, position.latitude])
          .addTo(map);
      } catch { /* ignore */ }
    }
    const marker = positionMarkerRef.current;
    if (marker) {
      try {
        marker.setLngLat([position.longitude, position.latitude]);
        // In north-up the map doesn't rotate, so the wedge must carry the
        // full heading. In heading-up the map already rotates to course, so
        // the wedge points "up" (0) relative to the rotated map.
        marker.setRotation(mapOrientation === 'north-up' ? (heading as number) : 0);
      } catch { /* ignore */ }
    }
  }, [mapReady, position, heading, mapOrientation]);

  // ── Update breadcrumb trail ────────────────────────────────
  // #98 Age-fade window + density control: trim points older than
  // maxTrailMinutes (via ts), then decimate to ~500 vertices before
  // building the LineString. The existing gold gradient is preserved.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const src = mapRef.current.getSource(TRAIL_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;

    // Collect timestamped breadcrumb points first (these can age out).
    const tsPoints: TrailPoint[] = [];
    if (routePoints && routePoints.length) {
      for (const p of routePoints) {
        if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
          tsPoints.push({ lat: p.lat, lng: p.lng, ts: p.ts });
        }
      }
    }
    // #98 trim by age, then decimate to a sane vertex budget.
    const trimmed = trailFilter.trimByAge(tsPoints, maxTrailMinutes);
    const decimated = trailFilter.decimate(trimmed, 500);

    const coords: Array<[number, number]> = [];
    for (const p of decimated) coords.push([p.lng, p.lat]);

    // extraPath has no timestamps — never aged, appended as-is.
    if (extraPath && extraPath.length) {
      for (const p of extraPath) {
        if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
          coords.push([p.lng, p.lat]);
        }
      }
    }
    if (position && coords.length) {
      coords.push([position.longitude, position.latitude]);
    }
    src.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    });
  }, [mapReady, routePoints, extraPath, position, maxTrailMinutes]);

  // ── Update dropped pins ────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const src = mapRef.current.getSource(PIN_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: pins.map((p) => ({
        type: 'Feature',
        properties: { color: p.color, label: p.label },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    });
  }, [mapReady, pins]);

  // ── Recenter ───────────────────────────────────────────────
  const handleRecenter = useCallback(() => {
    if (!mapRef.current || !position) return;
    mapRef.current.flyTo({
      center: [position.longitude, position.latitude],
      zoom: 16,
      essential: true,
    });
    setUserPanned(false);
  }, [position]);

  // ── Zoom in / out ──────────────────────────────────────────
  const handleZoom = useCallback((delta: number) => {
    if (!mapRef.current) return;
    mapRef.current.zoomTo(mapRef.current.getZoom() + delta, { duration: 200 });
  }, []);

  // ── Drop pin at current position ───────────────────────────
  const handleDropPin = useCallback(() => {
    if (!position || !onDropPin) return;
    const palette = ['#22c55e', '#ef4444', '#3b82f6', '#a855f7', '#f59e0b'];
    const pin: DroppedPin = {
      lat: position.latitude,
      lng: position.longitude,
      label: `Pin ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' })}`,
      color: palette[Math.floor(Math.random() * palette.length)],
      created_at: new Date().toISOString(),
    };
    onDropPin(pin);
  }, [position, onDropPin]);

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="relative rounded-sm border border-subtle overflow-hidden" style={{ height, background:"var(--surface-sunken)" }}>
      <div ref={mapContainerRef} className="absolute inset-0" />

      {/* #99 3D look-ahead inset (hidden in low-power mode). */}
      {insetEnabled && !error && (
        <div
          className="absolute rounded-sm border overflow-hidden"
          style={{
            bottom: 8, right: 8, width: 96, height: 72,
            borderColor: '#2e2e2e', background: 'var(--surface-overlay)',
            opacity: insetReady ? 1 : 0.4, transition: 'opacity 200ms',
            pointerEvents: 'none', zIndex: 2,
          }}
        >
          <div ref={insetContainerRef} className="absolute inset-0" />
          <span
            className="absolute top-0 left-0 px-1 text-[7px] font-mono uppercase tracking-wider"
            style={{ background: 'rgba(0 0 0 / 0.7)', color: 'var(--field-label-color)' }}
          >
            3D
          </span>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-3 text-center" style={{ background: 'rgba(10,10,10,0.85)' }}>
          <div>
            <AlertCircle size={20} className="mx-auto mb-1" style={{ color: 'var(--sev-critical)' }} />
            <p className="text-[10px]" style={{ color: '#888' }}>{error}</p>
          </div>
        </div>
      )}

      {!position && !error && mapReady && (
        <div className="absolute top-2 left-2 right-2 px-2 py-1 text-center rounded-sm text-[10px] font-mono" style={{ background: 'rgba(0 0 0 / 0.65)', color: '#888' }}>
          Waiting for GPS fix…
        </div>
      )}

      {showControls && !error && (
        <>
          {/* Recenter (top-left) */}
          {position && (
            <button
              type="button"
              onClick={handleRecenter}
              className={`absolute top-2 left-2 w-8 h-8 flex items-center justify-center rounded-sm border transition-colors ${userPanned ? 'border-rmpg-400' : 'border-subtle opacity-50'}`}
              style={{ background: 'rgba(10,10,10,0.85)', color: userPanned ? '#d4a017' : '#888' }}
              title={userPanned ? 'Recenter on me' : 'Following'}
            >
              <Crosshair size={14} />
            </button>
          )}

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

          {/* Live traffic + weather radar (top-right). Positioned with a
              generous buffer below Mapbox's native zoom control (added via
              addControl(NavigationControl, 'top-right') above), which
              occupies roughly the top ~70px of this corner — not
              precisely measured, so the buffer is intentionally generous
              rather than tight. */}
          <div className="absolute top-24 right-2 flex flex-col gap-1">
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
          <div className="absolute bottom-2 left-2">
            <button
              type="button"
              onClick={() => setStyleMenuOpen((v) => !v)}
              className="w-8 h-8 flex items-center justify-center rounded-sm border border-subtle"
              style={{ background: 'rgba(10,10,10,0.85)', color: 'var(--field-label-color)' }}
              title="Map style"
            >
              <Layers size={14} />
            </button>
            {styleMenuOpen && (
              <div className="absolute bottom-10 left-0 rounded-sm border border-subtle overflow-hidden" style={{ background:"var(--surface-sunken)", minWidth: 110 }}>
                {STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleStyleChange(opt.value)}
                    className="block w-full text-left px-2 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors hover:bg-rmpg-800"
                    style={{ color: style === opt.value ? '#d4a017' : 'var(--text-secondary)', borderBottom: '1px solid #1a1a1a' }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Drop pin (bottom-left, next to style) */}
          {onDropPin && position && (
            <button
              type="button"
              onClick={handleDropPin}
              className="absolute bottom-2 left-12 w-8 h-8 flex items-center justify-center rounded-sm border border-subtle"
              style={{ background: 'rgba(10,10,10,0.85)', color: 'var(--sev-ok)' }}
              title="Drop a pin at your current position"
            >
              <MapPin size={14} />
            </button>
          )}

          {/* Legend (bottom-right, above attribution). Lifted above the #99
              inset map when it's mounted so the two don't overlap. */}
          <div
            className="absolute right-12 px-1.5 py-0.5 rounded-sm text-[8px] font-mono uppercase tracking-wider"
            style={{ background: 'rgba(10,10,10,0.85)', color: '#888', bottom: lowPower ? 8 : 84, zIndex: 3 }}
          >
            <span style={{ color: 'var(--field-label-color)' }}>●</span> You
            {pins.length > 0 && <span className="ml-1.5"><span style={{ color: 'var(--sev-ok)' }}>●</span> Pin</span>}
          </div>
        </>
      )}
    </div>
  );
}
