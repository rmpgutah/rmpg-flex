// ============================================================
// RMPG Flex — Google Maps Script Loader (shared utility)
// Extracted from MapPage.tsx for reuse in DispatchMiniMap + MapPage.
// Injects a <script> tag, handles HMR re-entrant loads, and
// exposes map styles + a global registry for print-mode switching.
//
// Designed for vehicle/mobile use on intermittent WiFi/cellular:
// - 45-second timeout (slow connections while driving)
// - Online/offline awareness (waits for connectivity before retry)
// - Prevents duplicate script injection race conditions
// - Callers can subscribe to connectivity-based auto-retry
// ============================================================

let _gmapsLoadPromise: Promise<void> | null = null;
let _loadInProgress = false; // prevents race conditions with concurrent callers

/**
 * Returns true if google.maps.Map is already available in the global scope.
 */
function gmapsReady(): boolean {
  return typeof google !== 'undefined' && !!google.maps && !!google.maps.Map;
}

/**
 * Loads the Google Maps JS API via a script tag.
 * Idempotent — returns a cached promise on subsequent calls.
 * On error or timeout (45 s), resets so the caller can retry.
 *
 * Vehicle/mobile resilience:
 * - If navigator.onLine is false, waits for the 'online' event before loading
 * - 45-second timeout to accommodate slow cellular/satellite connections
 * - Guards against duplicate script injection when multiple components call
 *   simultaneously (e.g. MapPage + DispatchMiniMap)
 */
export function loadGoogleMaps(apiKey: string): Promise<void> {
  // Return cached successful promise
  if (_gmapsLoadPromise) return _gmapsLoadPromise;

  // If google.maps already exists (HMR / page revisit), resolve immediately
  if (gmapsReady()) {
    _gmapsLoadPromise = Promise.resolve();
    return _gmapsLoadPromise;
  }

  // Guard: if another call is already building the promise, wait briefly then re-check
  if (_loadInProgress) {
    return new Promise<void>((resolve, reject) => {
      const check = setInterval(() => {
        if (_gmapsLoadPromise) { clearInterval(check); _gmapsLoadPromise.then(resolve, reject); }
        if (!_loadInProgress && !_gmapsLoadPromise) { clearInterval(check); loadGoogleMaps(apiKey).then(resolve, reject); }
      }, 200);
      setTimeout(() => { clearInterval(check); reject(new Error('Google Maps load contention timeout')); }, 50000);
    });
  }

  _loadInProgress = true;

  _gmapsLoadPromise = new Promise<void>((resolve, reject) => {
    // If offline, wait for connectivity first (don't waste a script injection)
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      console.warn('[GoogleMapsLoader] Device offline — waiting for connectivity...');
      const onOnline = () => {
        window.removeEventListener('online', onOnline);
        doScriptLoad(apiKey, resolve, reject);
      };
      window.addEventListener('online', onOnline);
      // Safety: don't wait forever if the event never fires
      setTimeout(() => {
        window.removeEventListener('online', onOnline);
        if (!gmapsReady()) {
          // Try anyway — navigator.onLine can be unreliable
          doScriptLoad(apiKey, resolve, reject);
        }
      }, 30000);
      return;
    }

    doScriptLoad(apiKey, resolve, reject);
  });

  _gmapsLoadPromise.catch(() => { /* reset on failure so next call can retry */ });

  return _gmapsLoadPromise;
}

function doScriptLoad(
  apiKey: string,
  resolve: () => void,
  reject: (err: Error) => void,
): void {
  // Remove any stale/failed script tags so we always get a fresh load.
  const existing = document.querySelector('script[src*="maps.googleapis.com"]');
  if (existing) {
    if (gmapsReady()) {
      _loadInProgress = false;
      resolve();
      return;
    }
    existing.remove();
    delete (window as any).__rmpg_gmaps_init__;
  }

  let settled = false;
  const callbackName = '__rmpg_gmaps_init__';

  const cleanup = () => {
    delete (window as any)[callbackName];
    _loadInProgress = false;
  };

  (window as any)[callbackName] = () => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve();
  };

  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,marker,visualization&callback=${callbackName}&v=weekly`;
  script.async = true;
  script.defer = true;
  script.onerror = () => {
    if (settled) return;
    settled = true;
    _gmapsLoadPromise = null;
    script.remove();
    cleanup();
    reject(new Error('Failed to load Google Maps script'));
  };
  document.head.appendChild(script);

  // Safety timeout — 45 seconds to accommodate slow mobile/vehicle connections.
  // This is intentionally long because officers driving on cellular/satellite
  // connections may experience very slow downloads.
  setTimeout(() => {
    if (settled) return;
    // Check one more time — script may have loaded just as timeout fires
    if (gmapsReady()) {
      settled = true;
      cleanup();
      resolve();
      return;
    }
    settled = true;
    _gmapsLoadPromise = null;
    script.remove();
    cleanup();
    reject(new Error('Google Maps script load timed out (45s)'));
  }, 45000);
}

/**
 * Subscribe to automatic retry when the device comes back online.
 * Returns a cleanup function to unsubscribe.
 * Use this in components that need maps to auto-recover (MapPage, PatrolPage).
 */
export function onOnlineRetryMaps(apiKey: string, callback: () => void): () => void {
  const handler = () => {
    // Only retry if maps aren't already loaded
    if (gmapsReady()) return;
    _gmapsLoadPromise = null; // reset so loadGoogleMaps will try again
    loadGoogleMaps(apiKey)
      .then(callback)
      .catch(() => { /* will be retried on next online event */ });
  };
  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}

// ============================================================
// Tile Load Monitoring
// Google Maps fires no error when tiles fail to download on
// slow/intermittent WiFi — the map just shows a blank dark area.
// This utility detects stalled tile loading and provides hooks
// for components to show recovery UI.
// ============================================================

export interface TileMonitorCallbacks {
  onStalled: () => void;   // Tiles haven't loaded after threshold
  onLoaded: () => void;    // Tiles finished loading
  onRecovering: () => void; // Attempting tile recovery
}

/**
 * Monitor tile loading on a Google Maps instance.
 * Detects stalled tiles (no `tilesloaded` event within threshold) and
 * auto-recovers when device comes back online.
 * Returns a cleanup function.
 */
export function monitorTileLoading(
  map: google.maps.Map,
  callbacks: TileMonitorCallbacks,
  thresholdMs: number = 15000,
): () => void {
  let tilesLoaded = false;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners: google.maps.MapsEventListener[] = [];

  // Start the stall timer
  function startStallTimer() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      if (!tilesLoaded) callbacks.onStalled();
    }, thresholdMs);
  }

  // Tiles loaded successfully
  const tilesListener = google.maps.event.addListener(map, 'tilesloaded', () => {
    tilesLoaded = true;
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    callbacks.onLoaded();
  });
  listeners.push(tilesListener);

  // Reset stall timer on map idle (user panned/zoomed — new tiles loading)
  const idleListener = google.maps.event.addListener(map, 'idle', () => {
    if (!tilesLoaded) startStallTimer();
  });
  listeners.push(idleListener);

  // Visual recovery indicator (#19) — small badge on map during tile reload
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
  const monitorMapDiv = map.getDiv();
  monitorMapDiv.style.position = monitorMapDiv.style.position || 'relative';
  monitorMapDiv.appendChild(recoveryIndicator);

  // Auto-recover on connectivity restore
  const onOnline = () => {
    if (tilesLoaded) return;
    callbacks.onRecovering();
    recoveryIndicator.style.display = 'block';
    // Force tile re-fetch by nudging the map
    tilesLoaded = false;
    startStallTimer();
    const center = map.getCenter();
    if (center) {
      map.panTo({ lat: center.lat() + 0.0001, lng: center.lng() });
      setTimeout(() => map.panTo(center), 200);
    }
  };
  window.addEventListener('online', onOnline);

  // Hide recovery indicator when tiles load successfully
  const recoveryTilesListener = google.maps.event.addListener(map, 'tilesloaded', () => {
    recoveryIndicator.style.display = 'none';
  });
  listeners.push(recoveryTilesListener);

  // Periodic recovery attempt every 30s if tiles are stalled
  const recoveryInterval = setInterval(() => {
    if (tilesLoaded) return;
    if (navigator.onLine) {
      onOnline(); // retry
    }
  }, 30000);

  // Start initial stall timer
  startStallTimer();

  return () => {
    if (stallTimer) clearTimeout(stallTimer);
    clearInterval(recoveryInterval);
    listeners.forEach(l => google.maps.event.removeListener(l));
    window.removeEventListener('online', onOnline);
    recoveryIndicator.remove();
  };
}

// ============================================================
// Static Fallback Map Images (legacy — kept for fast initial load)
// Pre-downloaded dark-styled Google Static Maps images of Utah
// at 3 zoom levels. Shown behind the map when tiles fail to
// load (vehicle WiFi resilience). ~370 KB total.
// ============================================================

/** Available offline fallback map images (zoom → path). */
const FALLBACK_MAPS: { maxZoom: number; path: string; center: { lat: number; lng: number }; zoom: number }[] = [
  { maxZoom: 9,  path: '/maps/utah-z7.png',       center: { lat: 39.32, lng: -111.09 }, zoom: 7 },
  { maxZoom: 12, path: '/maps/utah-slc-z11.png',   center: { lat: 40.7608, lng: -111.891 }, zoom: 11 },
  { maxZoom: 99, path: '/maps/utah-slc-z13.png',   center: { lat: 40.7608, lng: -111.891 }, zoom: 13 },
];

/**
 * Returns the best fallback map image path for a given map zoom level.
 * Used as the background when Google Maps tiles fail to load on poor WiFi.
 */
export function getFallbackMapImage(zoom: number): string {
  const match = FALLBACK_MAPS.find(f => zoom <= f.maxZoom) ?? FALLBACK_MAPS[FALLBACK_MAPS.length - 1];
  return match.path;
}

// ============================================================
// Offline Tile Layer (CartoDB dark_matter)
// Pre-downloaded raster tiles at Z7–15 covering the Utah
// operational area (~1,738 tiles, ~11 MB). Renders as a bottom
// overlay under Google Maps tiles — when Google tiles load they
// cover the offline layer; when they fail the offline tiles
// show through, preventing black-screen on vehicle WiFi.
//
// Coverage:
//   Z7–8   Full Utah state
//   Z9–11  Wasatch Front (Ogden → Provo)
//   Z12–14 SLC metro (Salt Lake Valley)
//   Z15    SLC core (downtown + neighborhoods)
// ============================================================

/** Zoom range covered by offline tiles */
export const OFFLINE_TILE_MIN_ZOOM = 7;
export const OFFLINE_TILE_MAX_ZOOM = 15;

/**
 * Creates and attaches an offline tile layer to a Google Maps instance.
 * The layer reads pre-downloaded tiles from /tiles/{z}/{x}/{y}.png
 * and renders them beneath Google's own tiles.
 *
 * Returns a cleanup function that removes the layer from the map.
 */
export function addOfflineTileLayer(map: google.maps.Map): () => void {
  // Inject tile-loading shimmer style if not already present (#18)
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

  // Create tile loading indicator element
  const loadingIndicator = document.createElement('div');
  loadingIndicator.className = 'rmpg-tile-loading-indicator';
  loadingIndicator.textContent = 'LOADING TILES...';
  loadingIndicator.style.display = 'none';

  const mapDiv = map.getDiv();
  mapDiv.style.position = mapDiv.style.position || 'relative';
  mapDiv.appendChild(loadingIndicator);

  // Show shimmer during tile loads, hide when done
  const tileLoadStart = google.maps.event.addListener(map, 'idle', () => {
    loadingIndicator.style.display = 'block';
  });
  const tileLoadEnd = google.maps.event.addListener(map, 'tilesloaded', () => {
    loadingIndicator.style.display = 'none';
  });

  const offlineLayer = new google.maps.ImageMapType({
    getTileUrl: (coord: google.maps.Point, zoom: number): string | null => {
      // Only serve tiles within our downloaded range
      if (zoom < OFFLINE_TILE_MIN_ZOOM || zoom > OFFLINE_TILE_MAX_ZOOM) return null;

      // Wrap X coordinate for world continuity
      const maxTile = 1 << zoom;
      const x = ((coord.x % maxTile) + maxTile) % maxTile;
      const y = coord.y;

      // Bounds check (Y can be negative or too large)
      if (y < 0 || y >= maxTile) return null;

      return `/tiles/${zoom}/${x}/${y}.png`;
    },
    tileSize: new google.maps.Size(256, 256),
    maxZoom: OFFLINE_TILE_MAX_ZOOM,
    minZoom: OFFLINE_TILE_MIN_ZOOM,
    name: 'Offline',
    opacity: 1.0,
  });

  // Insert at position 0 — renders UNDER Google's base tiles.
  // When Google tiles load, they cover the offline layer.
  // When they fail (no WiFi), offline tiles show through.
  map.overlayMapTypes.insertAt(0, offlineLayer);

  // Return cleanup function
  return () => {
    google.maps.event.removeListener(tileLoadStart);
    google.maps.event.removeListener(tileLoadEnd);
    loadingIndicator.remove();
    // Find and remove the offline layer
    for (let i = 0; i < map.overlayMapTypes.getLength(); i++) {
      if (map.overlayMapTypes.getAt(i) === offlineLayer) {
        map.overlayMapTypes.removeAt(i);
        break;
      }
    }
  };
}

/** Duration (ms) for smooth transitions when switching between map styles (#20) */
export const MAP_STYLE_TRANSITION_DURATION = 300;

/** Dark blue streets style — Google dark mode aesthetic with visible features */
export const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#171717' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#111111' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#aaaaaa' }] },
  // Administrative boundaries — slightly brighter with dash-like weight for visibility (#7)
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#444444' }, { weight: 1.2 }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#cccccc' }] },
  { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#444444' }, { weight: 1.5 }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#777777' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#171717' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#151515' }] },
  // POI — simplified with very dim labels so landmarks are findable but not distracting (#6)
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#1a1a1a' }, { visibility: 'simplified' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#555555' }] },
  { featureType: 'poi', elementType: 'labels.text.stroke', stylers: [{ color: '#111111' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  // Parks — dark green tint instead of pure gray (#3)
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0f1a0f' }, { visibility: 'simplified' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#4a8a6a' }] },
  // Roads — improved label readability (#1) and highway/arterial distinction (#5)
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#262626' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#999999' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#404040' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#222222' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#cccccc' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#999999' }] },
  // Transit — slightly brighter station labels for navigation (#4)
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#222222' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#999999' }] },
  // Water — navy blue tint instead of pure gray (#2)
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a0a0a' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#666666' }] },
  // Building footprints — subtle outlines when zoomed in (#8)
  { featureType: 'landscape.man_made', elementType: 'geometry.stroke', stylers: [{ color: '#242424' }, { weight: 0.5 }] },
];

/** Night Navigation style — high-contrast roads on near-black, optimized for driving */
export const NIGHT_NAV_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#0a0a0a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#000000' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#777777' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#999999' }] },
  { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#555555' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#0a0a0a' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#0e0e0e' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0a0f0a' }, { visibility: 'simplified' }] },
  // Night nav roads — brighter for safer driving (#9), improved label visibility (#10)
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#242424' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#303030' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#888888' }] },
  { featureType: 'road', elementType: 'labels.text.stroke', stylers: [{ color: '#000000' }, { weight: 3 }] },
  // Highways — high visibility for navigation (#9, #13)
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#222222' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#404040' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#aaaaaa' }] },
  // Highway ramps — increased visibility for nav clarity (#12)
  { featureType: 'road.highway.controlled_access', elementType: 'geometry', stylers: [{ color: '#282828' }] },
  { featureType: 'road.highway.controlled_access', elementType: 'labels.text.fill', stylers: [{ color: '#bbbbbb' }] },
  // Arterials — distinct from local roads for intersection visibility (#11)
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#222222' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#888888' }] },
  // Local roads — cross-streets more distinct (#11)
  { featureType: 'road.local', elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#666666' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#061020' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#1a1a1a' }] },
];

/** Terrain style — subtle elevation shading with visible contours */
export const TERRAIN_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#e8e4dc' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#444444' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#999999' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#333333' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#666666' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#ddd8cc' }] },
  // Contour lines — improved contrast for terrain readability (#14)
  { featureType: 'landscape.natural.terrain', elementType: 'geometry', stylers: [{ color: '#c0b8a4' }] },
  { featureType: 'landscape.natural.terrain', elementType: 'geometry.stroke', stylers: [{ color: '#a09880' }, { weight: 1.0 }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#e0dcd4' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#b8ccb0' }, { visibility: 'simplified' }] },
  // Road labels — improved readability on terrain background (#15)
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#bbbbbb' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#3a3a3a' }] },
  { featureType: 'road', elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }, { weight: 3 }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f0e8d8' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#ccbb99' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#bbbbbb' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#666666' }] },
];

/** Light map style for printed reports — clean, high-contrast B&W */
export const LIGHT_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  // High contrast text for B&W printing (#16)
  { elementType: 'labels.text.fill', stylers: [{ color: '#222222' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#aaaaaa' }, { weight: 1.5 }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#111111' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#444444' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f0f0f0' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#e8e8e8' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#f2f2f2' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#d8ecd8' }, { visibility: 'simplified' }] },
  // Road hierarchy — different stroke widths for highway vs local (#17)
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }, { weight: 1.0 }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#b0b0b0' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#333333' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#d0d0d0' }, { weight: 2.0 }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#999999' }, { weight: 2.5 }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#111111' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#e8e8e8' }, { weight: 1.5 }] },
  { featureType: 'road.arterial', elementType: 'geometry.stroke', stylers: [{ color: '#aaaaaa' }] },
  { featureType: 'road.local', elementType: 'geometry', stylers: [{ color: '#ffffff' }, { weight: 0.8 }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  // Water — slightly darker for print contrast (#16)
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cccccc' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#444444' }] },
];

// ============================================================
// Global Map Instance Registry
// Components register their map instances so the print utility
// can switch all maps to light style before printing.
// Stores current styles per-map so we can restore accurately
// (MapPage may be in satellite/hybrid/streets mode).
// ============================================================

interface MapState {
  styles: google.maps.MapTypeStyle[];
}

const _activeMapInstances = new Map<google.maps.Map, MapState>();

/** Register a Google Maps instance for print-mode style switching. */
export function registerMapInstance(map: google.maps.Map, styles: google.maps.MapTypeStyle[] = DARK_MAP_STYLE): void {
  _activeMapInstances.set(map, { styles });
}

/** Update the stored style for a registered map (call when switching map types). */
export function updateMapStyles(map: google.maps.Map, styles: google.maps.MapTypeStyle[]): void {
  const entry = _activeMapInstances.get(map);
  if (entry) entry.styles = styles;
}

/** Unregister a map instance (call on component unmount). */
export function unregisterMapInstance(map: google.maps.Map): void {
  _activeMapInstances.delete(map);
}

// Track whether we already switched to light mode (to avoid double-switching)
let _isPrintMode = false;
let _savedStates: { map: google.maps.Map; styles: google.maps.MapTypeStyle[]; mapTypeId: string }[] = [];

/** Switch all registered maps to light mode for printing. */
function switchToLightForPrint(): void {
  if (_isPrintMode) return;
  _isPrintMode = true;
  _savedStates = [];

  for (const [map, state] of _activeMapInstances.entries()) {
    _savedStates.push({
      map,
      styles: state.styles,
      mapTypeId: map.getMapTypeId() as string,
    });
    map.setMapTypeId('roadmap');
    map.setOptions({ styles: LIGHT_MAP_STYLE });
  }
}

/** Restore all maps to their previous styles after printing. */
function restoreAfterPrint(): void {
  if (!_isPrintMode) return;
  _isPrintMode = false;

  for (const { map, styles, mapTypeId } of _savedStates) {
    map.setMapTypeId(mapTypeId);
    map.setOptions({ styles });
  }
  _savedStates = [];
}

// Auto-register beforeprint/afterprint listeners so that even native
// Ctrl+P (or system print) switches maps to light on a best-effort basis.
// Guard prevents duplicate registration if module is re-evaluated (HMR).
// Remove-then-add ensures no duplicates accumulate across hot reloads.
if (typeof window !== 'undefined') {
  window.removeEventListener('beforeprint', switchToLightForPrint);
  window.removeEventListener('afterprint', restoreAfterPrint);
  window.addEventListener('beforeprint', switchToLightForPrint);
  window.addEventListener('afterprint', restoreAfterPrint);
}

/**
 * Switch all registered maps to light style, wait for tiles, then print.
 * Use this from buttons for the best result (tiles fully loaded).
 * Native Ctrl+P is handled by beforeprint/afterprint as a fallback.
 */
export function printWithLightMaps(): void {
  const entries = Array.from(_activeMapInstances.entries());

  if (entries.length === 0) {
    window.print();
    return;
  }

  // Switch to light mode
  switchToLightForPrint();

  const doPrint = () => {
    window.print();
    // afterprint listener will handle restoring styles
  };

  // Wait for tiles to load, with a safety timeout
  let tilesReady = 0;
  const total = entries.length;
  const safetyTimer = setTimeout(doPrint, 3000);

  for (const [map] of entries) {
    google.maps.event.addListenerOnce(map, 'tilesloaded', () => {
      tilesReady++;
      if (tilesReady >= total) {
        clearTimeout(safetyTimer);
        // Small extra delay for rendering to fully settle
        setTimeout(doPrint, 300);
      }
    });
  }
}

/** Switch a map to offline tile mode. Returns the previous mapTypeId for restoration. */
export function switchToOfflineMode(map: google.maps.Map): string | null {
  try {
    const prev = map.getMapTypeId() as string;
    // Force map to roadmap so offline CartoDB tiles show through
    map.setMapTypeId('roadmap');
    return prev;
  } catch {
    return null;
  }
}

/** Restore a map from offline mode to its previous map type and styles. */
export function restoreFromOfflineMode(map: google.maps.Map, prevMapType: string, styles: google.maps.MapTypeStyle[]): void {
  try {
    map.setMapTypeId(prevMapType || 'roadmap');
    map.setOptions({ styles });
  } catch { /* ignore */ }
}
