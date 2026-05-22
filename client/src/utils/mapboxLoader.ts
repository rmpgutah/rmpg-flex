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

mapboxgl.accessToken = '';

let _mapboxInitialized = false;

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

  map.on('idle', onIdle);
  map.on('render', () => {
    if (!tilesLoaded) startStallTimer();
  });

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
        animation: rmpg-recovery-pulse 1s ease-in-out infinite;
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

  map.on('idle', () => {
    recoveryIndicator.style.display = 'none';
  });

  const recoveryInterval = setInterval(() => {
    if (tilesLoaded) return;
    if (navigator.onLine) onOnline();
  }, 30000);

  startStallTimer();

  return () => {
    if (stallTimer) clearTimeout(stallTimer);
    clearInterval(recoveryInterval);
    map.off('idle', onIdle);
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

let _serverConfigPromise: Promise<{ mapbox_access_token?: string }> | null = null;
let _fetchFailCount = 0;
const MAX_FETCH_RETRIES = 3;

export async function fetchMapboxConfig(): Promise<{ mapbox_access_token?: string }> {
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
      const res = await fetch(`${base}/api/admin/mapbox-config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        _fetchFailCount++;
        _serverConfigPromise = null;
        return {};
      }
      _fetchFailCount = 0;
      return await res.json();
    } catch (e) {
      console.warn('[mapboxLoader] Failed to fetch Mapbox config:', e);
      _fetchFailCount++;
      _serverConfigPromise = null;
      return {};
    }
  })();

  return _serverConfigPromise;
}

export async function resolveMapboxAccessToken(): Promise<string> {
  const cfg = await fetchMapboxConfig();
  return cfg.mapbox_access_token || import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';
}

export function clearMapboxConfigCache(): void {
  _serverConfigPromise = null;
  _fetchFailCount = 0;
}
