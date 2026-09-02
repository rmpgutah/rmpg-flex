// ============================================================
// RMPG Flex — Mapbox GL JS Loader & Configuration
// Mapbox GL JS loader — loaded as an npm package,
// loaded directly via import (no script tag injection needed).
//
// Designed for vehicle/mobile use on intermittent WiFi/cellular:
// - Online/offline awareness
// - Tile load monitoring with recovery UI
// - Print-mode style switching
// ============================================================

import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken =
  (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string || '').trim();

// Prevent accidental use of a secret (sk.*) Mapbox token — only public
// (pk.*) tokens work with Mapbox GL JS. If the build env var holds an
// sk.* token, clear it so the client falls back to the server endpoint.
if (mapboxgl.accessToken.startsWith('sk.')) {
  console.warn('[mapbox] Build-time VITE_MAPBOX_ACCESS_TOKEN is an sk.* secret token. Clearing — client will fetch pk.* token from server.');
  mapboxgl.accessToken = '';
}

// Disable Mapbox SDK telemetry (turnstile / map.load / style.load /
// performance beacons to events.mapbox.com).
//
// Some operator networks block that host (DNS sinkhole / ad blocker /
// corporate proxy). The SDK re-queues the POST from its render loop, so a
// blocked beacon spams the console with `net::ERR_CONNECTION_REFUSED` stack
// traces on every frame — noise that buries real errors in a CAD console.
//
// Two earlier attempts are worth not repeating:
//  1. `mapboxgl.config.EVENTS_URL = '...'` — a plain assignment. In v3
//     EVENTS_URL is a *getter* derived from API_URL, so the write silently
//     no-ops (it does not throw in sloppy mode, which is why the surrounding
//     try/catch never revealed anything).
//  2. A 204 short-circuit in the service worker's fetch handler
//     (TELEMETRY_HOSTS in public/sw.js). Deployed, but still observed failing
//     on live 2026-07-27 — a service worker only intercepts what it actually
//     controls, so it is the wrong layer for a guarantee.
//
// Overriding the getter is the reliable fix: every telemetry path in the SDK
// begins `if (!config.EVENTS_URL) return;`, so a null makes the request never
// happen at all, rather than being cancelled after it is issued. Wrapped in
// try/catch only because a test mock may define a plain, non-configurable
// property — losing telemetry suppression must never break map init.
try {
  Object.defineProperty(mapboxgl.config, 'EVENTS_URL', {
    get: () => null,
    configurable: true,
  });
} catch (err) {
  console.warn('[mapbox] Could not disable telemetry endpoint:', err);
}

// NOTE: PMTiles is NOT read client-side via addProtocol — Mapbox GL JS (unlike
// MapLibre) has no addProtocol. The statewide overlays are served as native
// XYZ vector tiles by the Worker (/api/tiles/<name>/{z}/{x}/{y}.mvt), which
// extracts them from the PMTiles archives in R2. See useVectorTileLayers.

let _mapboxInitialized = !!mapboxgl.accessToken;

export function initMapbox(accessToken: string): void {
  if (_mapboxInitialized) return;
  mapboxgl.accessToken = accessToken;
  _mapboxInitialized = true;
}

export function isMapboxReady(): boolean {
  return _mapboxInitialized && !!mapboxgl.accessToken;
}

export function getMapboxInstance(): typeof mapboxgl {
  if (!isMapboxReady()) {
    throw new Error('Mapbox not initialized — call initMapbox() first');
  }
  return mapboxgl;
}

export { mapboxgl };

// ============================================================
// Map Styles (Mapbox style URLs / objects)
// ============================================================

export const MAPBOX_STYLE_DARK = 'mapbox://styles/mapbox/dark-v11';
export const MAPBOX_STYLE_NIGHT = 'mapbox://styles/mapbox/navigation-night-v1';
export const MAPBOX_STYLE_SATELLITE = 'mapbox://styles/mapbox/satellite-streets-v12';
export const MAPBOX_STYLE_STREETS = 'mapbox://styles/mapbox/streets-v12';
export const MAPBOX_STYLE_OUTDOORS = 'mapbox://styles/mapbox/outdoors-v12';
export const MAPBOX_STYLE_LIGHT = 'mapbox://styles/mapbox/light-v11';

export const MAP_STYLE_TRANSITION_DURATION = 300;

// ============================================================
// Tile Load Monitoring
// Mapbox GL JS fires 'load' and 'idle' events but tile failures
// on slow WiFi can leave the map blank. This utility detects
// stalled tile loading and provides hooks for recovery UI.
// ============================================================

export interface TileMonitorCallbacks {
  onStalled: () => void;
  onLoaded: () => void;
  onRecovering: () => void;
}

export function monitorTileLoading(
  map: mapboxgl.Map,
  callbacks: TileMonitorCallbacks,
  thresholdMs: number = 15000,
): () => void {
  let tilesLoaded = false;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;

  function startStallTimer() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      if (!tilesLoaded) callbacks.onStalled();
    }, thresholdMs);
  }

  const onIdle = () => {
    tilesLoaded = true;
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    callbacks.onLoaded();
  };
  const onRender = () => {
    if (!tilesLoaded) startStallTimer();
  };

  map.on('idle', onIdle);
  map.on('render', onRender);

  const RECOVERY_STYLE_ID = 'rmpg-tile-recovery-style';
  if (!document.getElementById(RECOVERY_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = RECOVERY_STYLE_ID;
    style.textContent = `
      @keyframes rmpg-recovery-pulse {
        0%, 100% { opacity: 0.6; }
        50% { opacity: 1.0; }
      }
      .rmpg-tile-recovery-indicator {
        position: absolute;
        top: 8px;
        right: 8px;
        background: rgba(212, 160, 23, 0.85);
        color: #0a0a0a;
        font-family: 'Arial, sans-serif';
        font-size: 10px;
        font-weight: 600;
        padding: 3px 10px;
        border-radius: 2px;
        z-index: 2;
        pointer-events: none;
        animation: rmpg-recovery-pulse 1.4s ease-in-out infinite;
      }
    `;
    document.head.appendChild(style);
  }

  const container = map.getContainer();
  const recoveryIndicator = document.createElement('div');
  recoveryIndicator.className = 'rmpg-tile-recovery-indicator';
  recoveryIndicator.textContent = 'RECONNECTING...';
  recoveryIndicator.style.display = 'none';
  container.style.position = container.style.position || 'relative';
  container.appendChild(recoveryIndicator);

  const onOnline = () => {
    if (tilesLoaded) return;
    callbacks.onRecovering();
    recoveryIndicator.style.display = 'block';
    tilesLoaded = false;
    startStallTimer();
    map.triggerRepaint();
  };
  window.addEventListener('online', onOnline);

  // Second idle handler — hides the recovery indicator once tiles finish
  // loading after a network blip. Captured in a const so cleanup can
  // remove it; without this, every call to monitorTileLoading leaked
  // one idle listener for the lifetime of the map.
  const onIdleHideRecovery = () => {
    recoveryIndicator.style.display = 'none';
  };
  map.on('idle', onIdleHideRecovery);

  const recoveryInterval = setInterval(() => {
    if (tilesLoaded) return;
    if (navigator.onLine) onOnline();
  }, 30000);

  startStallTimer();

  return () => {
    if (stallTimer) clearTimeout(stallTimer);
    clearInterval(recoveryInterval);
    map.off('idle', onIdle);
    map.off('idle', onIdleHideRecovery);
    map.off('render', onRender);
    window.removeEventListener('online', onOnline);
    recoveryIndicator.remove();
  };
}

// ============================================================
// Global Map Instance Registry
// Components register their map instances so the print utility
// can switch all maps to light style before printing.
// ============================================================

interface MapState {
  style: string;
}

const _activeMapInstances = new Map<mapboxgl.Map, MapState>();

export function registerMapInstance(map: mapboxgl.Map, style: string = MAPBOX_STYLE_DARK): void {
  _activeMapInstances.set(map, { style });
}

export function updateMapStyle(map: mapboxgl.Map, style: string): void {
  const entry = _activeMapInstances.get(map);
  if (entry) entry.style = style;
}

export function unregisterMapInstance(map: mapboxgl.Map): void {
  _activeMapInstances.delete(map);
}

let _isPrintMode = false;
let _savedStates: { map: mapboxgl.Map; style: string }[] = [];

function switchToLightForPrint(): void {
  if (_isPrintMode) return;
  _isPrintMode = true;
  _savedStates = [];
  for (const [map, state] of _activeMapInstances.entries()) {
    _savedStates.push({ map, style: state.style });
    map.setStyle(MAPBOX_STYLE_LIGHT);
  }
}

function restoreAfterPrint(): void {
  if (!_isPrintMode) return;
  _isPrintMode = false;
  for (const { map, style } of _savedStates) {
    map.setStyle(style);
  }
  _savedStates = [];
}

if (typeof window !== 'undefined') {
  window.removeEventListener('beforeprint', switchToLightForPrint);
  window.removeEventListener('afterprint', restoreAfterPrint);
  window.addEventListener('beforeprint', switchToLightForPrint);
  window.addEventListener('afterprint', restoreAfterPrint);
}

export function printWithLightMaps(): void {
  const entries = Array.from(_activeMapInstances.entries());
  if (entries.length === 0) {
    window.print();
    return;
  }
  switchToLightForPrint();
  const doPrint = () => window.print();
  let mapsReady = 0;
  const total = entries.length;
  const safetyTimer = setTimeout(doPrint, 3000);
  for (const [map] of entries) {
    map.once('idle', () => {
      mapsReady++;
      if (mapsReady >= total) {
        clearTimeout(safetyTimer);
        setTimeout(doPrint, 300);
      }
    });
  }
}

// ============================================================
// Server-managed Mapbox config
// Moved to mapboxToken.ts (2026-07-02) so REST-only callers (address
// autocomplete, etc.) can resolve a token without loading mapbox-gl.
// Re-exported here for existing map-surface callers of this module.
// ============================================================
export { fetchMapboxConfig, resolveMapboxAccessToken, clearMapboxConfigCache } from './mapboxToken';

// Re-export for pages that import map utilities from this module
export { injectMapStyles as injectMapboxStyles, createMapboxMap } from './mapboxMap';

// ============================================================
// Map lifecycle / style / trail / 3D-buildings / terrain helpers
// ============================================================
// These were previously hard no-op stubs ("unblock the build" placeholders)
// despite every caller (MapCore.ts, useMapboxInit.ts, MapboxMapPage.tsx,
// RouteBuilderPage.tsx) treating them as real — so map cleanup leaked WebGL
// contexts, the map-style selector never changed the live map, 3D
// terrain/buildings toggles did nothing, and RouteBuilderPage's planned-route
// polyline never rendered. Implemented for real below, using the safe-layer
// wrappers from mapboxSafeLayer.ts so a torn-down/mid-setStyle map never
// throws out of these calls.
import { resolveMapStyleUrl } from './mapboxClient';
import {
  hasLayer, hasSource, safeRemoveLayer, safeRemoveSource, upsertGeoJsonSource,
} from './mapboxSafeLayer';

/** Tear down a live Mapbox map instance (releases the WebGL context, DOM, listeners). */
export function destroyMapboxMap(map?: mapboxgl.Map | null): void {
  if (!map) return;
  try { map.remove(); } catch { /* already removed / torn down */ }
}

const TRAIL_SOURCE = 'rmpg-mapbox-trail';
const TRAIL_LAYER = 'rmpg-mapbox-trail-line';

/** Draw (or replace) a route trail polyline on the map. */
export function addMapboxTrail(
  map: mapboxgl.Map,
  coords: [number, number][],
  color: string = '#c3ccd6',
): void {
  if (!map || !map.style || !coords?.length) return;
  const data: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coords },
  };
  try {
    upsertGeoJsonSource(map, TRAIL_SOURCE, data);
    if (!hasLayer(map, TRAIL_LAYER)) {
      map.addLayer({
        id: TRAIL_LAYER,
        type: 'line',
        source: TRAIL_SOURCE,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': color, 'line-width': 4, 'line-opacity': 0.85 },
      });
    } else {
      map.setPaintProperty(TRAIL_LAYER, 'line-color', color);
    }
  } catch { /* style mid-swap — caller re-renders on the next route change */ }
}

/** Remove the route trail polyline, if present. */
export function removeMapboxTrail(map: mapboxgl.Map): void {
  if (!map) return;
  safeRemoveLayer(map, TRAIL_LAYER);
  safeRemoveSource(map, TRAIL_SOURCE);
}

/** Switch the live map to a new style (short id like 'dark', or a full mapbox://.../https:// URL). */
export function setMapboxStyle(map: mapboxgl.Map, style: string): void {
  if (!map || !style) return;
  const resolved = style.startsWith('mapbox://') || style.startsWith('http')
    ? style
    : resolveMapStyleUrl(style);
  try { map.setStyle(resolved); } catch { /* ignore — caller listens for style.load to re-apply overlays */ }
}

const BUILDINGS_3D_LAYER = 'rmpg-3d-buildings-loader';

/** Add extruded 3D building footprints from the style's vector `composite` source, if present. */
export function addMapbox3DBuildings(map: mapboxgl.Map): void {
  if (!map || !map.style) return;
  try {
    if (hasLayer(map, BUILDINGS_3D_LAYER) || !hasSource(map, 'composite')) return;
    map.addLayer({
      id: BUILDINGS_3D_LAYER,
      source: 'composite',
      'source-layer': 'building',
      filter: ['==', ['get', 'extrude'], 'true'],
      type: 'fill-extrusion',
      minzoom: 13,
      paint: {
        'fill-extrusion-color': '#343434',
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 15.05, ['get', 'height']],
        'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 13, 0, 15.05, ['get', 'min_height']],
        'fill-extrusion-opacity': 0.8,
      },
    });
  } catch { /* raster-only style lacks `composite` — nothing to extrude */ }
}

/** Remove the 3D building extrusion layer, if present. */
export function removeMapbox3DBuildings(map: mapboxgl.Map): void {
  if (!map) return;
  safeRemoveLayer(map, BUILDINGS_3D_LAYER);
}

const TERRAIN_DEM_SOURCE = 'rmpg-mapbox-terrain-dem';

/** Enable 3D terrain (raster-DEM elevation) on the current style. */
export function addMapboxTerrain(map: mapboxgl.Map): void {
  if (!map || !map.style) return;
  try {
    if (!hasSource(map, TERRAIN_DEM_SOURCE)) {
      map.addSource(TERRAIN_DEM_SOURCE, {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });
    }
    map.setTerrain({ source: TERRAIN_DEM_SOURCE, exaggeration: 1.15 });
  } catch { /* style mid-swap — style.load re-apply covers it */ }
}

/** Disable 3D terrain, restoring a flat basemap. */
export function removeMapboxTerrain(map: mapboxgl.Map): void {
  if (!map) return;
  try { map.setTerrain(null); } catch { /* ignore */ }
  safeRemoveSource(map, TERRAIN_DEM_SOURCE);
}

/**
 * Classify a Mapbox GL JS runtime `error` event (fired for a bad/expired
 * token, a network failure, a missing style, etc.) so a caller can decide
 * whether to surface it to the user. Mapbox's own async style/tile-load
 * failures do NOT throw a catchable exception — they only fire this event —
 * so a component that doesn't listen for it renders a blank/black map with
 * zero indication of what's wrong (confirmed live: a bad token produces a
 * silent 401 against api.mapbox.com, no CSP block, no thrown error).
 * Mirrors the classification MapCore.ts already does for the main map page.
 */
export interface MapboxErrorClassification {
  message: string;
  isAuthErr: boolean;
  isNetworkErr: boolean;
  isStyleErr: boolean;
}

export function classifyMapboxError(e: { error?: { message?: string; status?: number } }): MapboxErrorClassification {
  const message = e.error?.message || 'Mapbox map error';
  const status = e.error?.status;
  const msgLower = message.toLowerCase();

  const isNetworkErr =
    msgLower.includes('failed to fetch') ||
    msgLower.includes('networkerror') ||
    msgLower.includes('network request failed');

  const isAuthErr =
    status === 401 || status === 403 ||
    msgLower.includes('access token') ||
    msgLower.includes('not authorized') ||
    msgLower.includes('unauthorized') ||
    msgLower.includes('forbidden') ||
    msgLower.includes('invalid token') ||
    msgLower.includes('token is not authorized') ||
    msgLower.includes('not configured');

  const isStyleErr = msgLower.includes('style not found') || msgLower.includes('style is not found');

  return { message, isAuthErr, isNetworkErr, isStyleErr };
}
