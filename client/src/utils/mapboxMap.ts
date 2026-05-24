import mapboxgl from 'mapbox-gl';
import { DARK_STYLE, LIGHT_STYLE, resolveMapStyleUrl } from './mapboxClient';

export const MAP_STYLE_TRANSITION_DURATION = 300;

export function createMapboxMap(
  container: HTMLElement,
  token: string,
  style?: string,
): mapboxgl.Map {
  try {
    const map = new mapboxgl.Map({
      container,
      style: style || DARK_STYLE,
      center: [-111.8910, 40.7608],
      zoom: 12,
      attributionControl: false,
      failIfMajorPerformanceCaveat: false,
    });

    return map;
  } catch (err) {
    console.error('[MapboxMap] Failed to create map:', err);
    throw err;
  }
}

interface MapState {
  style: string;
}

const _activeMapInstances = new Map<mapboxgl.Map, MapState>();

export function registerMapInstance(map: mapboxgl.Map): void {
  _activeMapInstances.set(map, {
    style: (map.getStyle() as any)?.name
      ? resolveMapStyleUrl((map.getStyle() as any).name)
      : (map as any)._style?.url || DARK_STYLE,
  });
}

export function updateMapStyles(map: mapboxgl.Map, style: string): void {
  const entry = _activeMapInstances.get(map);
  if (entry) entry.style = style;
}

export function unregisterMapInstance(map: mapboxgl.Map): void {
  _activeMapInstances.delete(map);
}

let _isPrintMode = false;
interface SavedState {
  map: mapboxgl.Map;
  style: string;
}
let _savedStates: SavedState[] = [];

function switchToLightForPrint(): void {
  if (_isPrintMode) return;
  _isPrintMode = true;
  _savedStates = [];

  for (const [map, state] of _activeMapInstances.entries()) {
    _savedStates.push({ map, style: state.style });
    map.setStyle(LIGHT_STYLE);
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

  const doPrint = () => {
    window.print();
  };

  let readyCount = 0;
  const total = entries.length;
  const safetyTimer = setTimeout(doPrint, 3000);

  for (const [map] of entries) {
    map.once('idle', () => {
      readyCount++;
      if (readyCount >= total) {
        clearTimeout(safetyTimer);
        setTimeout(doPrint, 300);
      }
    });
  }
}

export function monitorMapTiles(
  map: mapboxgl.Map,
  callbacks: { onStalled: () => void; onLoaded: () => void; onRecovering: () => void },
  thresholdMs?: number,
): () => void {
  const threshold = thresholdMs ?? 15000;
  let tilesLoaded = false;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const cleanupFns: (() => void)[] = [];

  function startStallTimer(): void {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      if (!tilesLoaded) callbacks.onStalled();
    }, threshold);
  }

  function resetStallTimer(): void {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  }

  const onIdle = () => {
    tilesLoaded = true;
    resetStallTimer();
    callbacks.onLoaded();
  };

  const onDataLoading = () => {
    tilesLoaded = false;
    startStallTimer();
  };

  map.on('idle', onIdle);
  map.on('dataloading', onDataLoading);

  cleanupFns.push(() => {
    map.off('idle', onIdle);
    map.off('dataloading', onDataLoading);
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

  const recoveryIndicator = document.createElement('div');
  recoveryIndicator.className = 'rmpg-tile-recovery-indicator';
  recoveryIndicator.textContent = 'RECONNECTING...';
  recoveryIndicator.style.display = 'none';
  const mapContainer = map.getContainer();
  mapContainer.style.position = mapContainer.style.position || 'relative';
  mapContainer.appendChild(recoveryIndicator);

  const onOnline = () => {
    if (tilesLoaded) return;
    callbacks.onRecovering();
    recoveryIndicator.style.display = 'block';
    tilesLoaded = false;
    startStallTimer();
    const center = map.getCenter();
    map.setCenter([center.lng + 0.0001, center.lat]);
    setTimeout(() => map.setCenter([center.lng, center.lat]), 200);
  };
  window.addEventListener('online', onOnline);

  const hideRecovery = () => {
    recoveryIndicator.style.display = 'none';
  };
  map.on('idle', hideRecovery);

  cleanupFns.push(() => {
    map.off('idle', hideRecovery);
  });

  const recoveryInterval = setInterval(() => {
    if (tilesLoaded) return;
    if (navigator.onLine) {
      onOnline();
    }
  }, 30000);

  startStallTimer();

  return () => {
    if (stallTimer) clearTimeout(stallTimer);
    clearInterval(recoveryInterval);
    cleanupFns.forEach((fn) => fn());
    window.removeEventListener('online', onOnline);
    recoveryIndicator.remove();
  };
}

export function onOnlineRetryMaps(token: string, callback: () => void): () => void {
  const handler = () => {
    if (!navigator.onLine) return;
    callback();
  };
  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}

export function injectMapStyles(): void {
  if (!document.getElementById('rmpg-mapbox-css')) {
    const link = document.createElement('link');
    link.id = 'rmpg-mapbox-css';
    link.rel = 'stylesheet';
    link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css';
    document.head.appendChild(link);
  }

  const SHIMMER_STYLE_ID = 'rmpg-tile-shimmer-style';
  if (!document.getElementById(SHIMMER_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = SHIMMER_STYLE_ID;
    style.textContent = `
      @keyframes rmpg-tile-shimmer {
        0% { opacity: 0.3; }
        50% { opacity: 0.6; }
        100% { opacity: 0.3; }
      }
      .rmpg-tile-loading-indicator {
        position: absolute;
        bottom: 8px;
        left: 8px;
        background: rgba(136, 136, 136, 0.7);
        color: #a8d0ff;
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        padding: 2px 8px;
        border-radius: 2px;
        z-index: 1;
        pointer-events: none;
        animation: rmpg-tile-shimmer 1.5s ease-in-out infinite;
      }
    `;
    document.head.appendChild(style);
  }
}
