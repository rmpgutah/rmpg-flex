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

// Redirect Mapbox SDK telemetry POSTs (turnstile/map.load/style.load/etc.) away
// from events.mapbox.com to a same-origin sink that returns 204. Some operator
// networks block events.mapbox.com (DNS sinkhole / ad blocker / corporate
// proxy), and the SDK's retry-on-frame logic then spammed the dispatch console
// with massive `net::ERR_CONNECTION_REFUSED` stack traces. Pages proxies
// /api/* to the Worker, so a relative URL works for both web SPAs and the
// Electron desktop wrapper.
// Wrapped in try/catch because some unit-test mocks expose `config` as a
// getter-only descriptor; the redirect is a cosmetic console-noise fix, not
// load-bearing, so failing silently in tests is safe.
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mapboxgl as any).config.EVENTS_URL = '/api/mapbox/events/v2';
} catch { /* mock object without writable config — ignore */ }

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
        font-family: 'JetBrains Mono', monospace;
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
// Fetches Mapbox access token from the server API.
// ============================================================

let _serverConfigPromise: Promise<{ accessToken?: string }> | null = null;
let _fetchFailCount = 0;
const MAX_FETCH_RETRIES = 3;

export async function fetchMapboxConfig(): Promise<{ accessToken?: string }> {
  if (_serverConfigPromise) return _serverConfigPromise;
  if (_fetchFailCount >= MAX_FETCH_RETRIES) return {};

  _serverConfigPromise = (async () => {
    try {
      const token = localStorage.getItem('rmpg_token');
      if (!token) {
        _serverConfigPromise = null;
        return {};
      }
      const base = import.meta.env.VITE_API_BASE_URL || '';
      const res = await fetch(`${base}/api/integrations/mapbox/client-token`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        _fetchFailCount++;
        _serverConfigPromise = null;
        return {};
      }
      _fetchFailCount = 0;
      return await res.json();
    } catch {
      _fetchFailCount++;
      _serverConfigPromise = null;
      return {};
    }
  })();

  return _serverConfigPromise;
}

export async function resolveMapboxAccessToken(): Promise<string> {
  const buildTimeToken = (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string || '').trim();
  if (buildTimeToken) return buildTimeToken;
  const cfg = await fetchMapboxConfig();
  return cfg.accessToken || '';
}

export function clearMapboxConfigCache(): void {
  _serverConfigPromise = null;
  _fetchFailCount = 0;
}

// Re-export for pages that import map utilities from this module
export { injectMapStyles as injectMapboxStyles, createMapboxMap } from './mapboxMap';

// Stub re-exports for missing symbols referenced by existing pages.
// These are no-op implementations to unblock the build.
export function destroyMapboxMap(_map: any): void { /* stub */ }
export function addMapboxTrail(_map: any, _coords: any, _color?: string): void { /* stub */ }
export function removeMapboxTrail(_map: any): void { /* stub */ }
export function addMapbox3DBuildings(_map: any): void { /* stub */ }
export function setMapboxStyle(_map: any, _style: string): void { /* stub */ }
export function addMapboxTerrain(_map: any): void { /* stub */ }
export function removeMapboxTerrain(_map: any): void { /* stub */ }
