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

// Installs the Google-recommended Dynamic Library Import bootstrap once per
// page. After this, `google.maps.importLibrary('maps'|'places'|'marker'|
// 'visualization')` returns promises that reject on failure instead of
// injecting the "Oops! This page didn't load Google Maps correctly" dialog
// into the DOM. See https://developers.google.com/maps/documentation/javascript/load-maps-js-api
function installBootstrap(apiKey: string): void {
  if ((window as any).google?.maps?.importLibrary) return;
  // Verbatim Google bootstrap, adapted inline with a user-supplied key.
  (function (g: any) {
    let h: any, a: any, k: any;
    const p = 'The Google Maps JavaScript API';
    const c = 'google';
    const l = 'importLibrary';
    const q = '__ib__';
    const m: any = document;
    let b: any = window;
    b = b[c] || (b[c] = {});
    const d = b.maps || (b.maps = {});
    const r = new Set<string>();
    const e = new URLSearchParams();
    const u = () =>
      h ||
      (h = new Promise(async (f: any, n: any) => {
        a = m.createElement('script');
        e.set('libraries', [...r].join(''));
        for (k in g) e.set(k.replace(/[A-Z]/g, (t: string) => '_' + t[0].toLowerCase()), g[k]);
        e.set('callback', c + '.maps.' + q);
        a.src = 'https://maps.' + c + 'apis.com/maps/api/js?' + e;
        d[q] = f;
        a.onerror = () => (h = n(new Error(p + ' could not load.')));
        a.nonce = m.querySelector('script[nonce]')?.nonce || '';
        m.head.append(a);
      }));
    d[l]
      ? console.warn(p + ' only loads once. Ignoring:', g)
      : (d[l] = (f: any, ...n: any[]) => r.add(f) && u().then(() => d[l](f, ...n)));
  })({ key: apiKey, v: 'weekly' });
}

function doScriptLoad(
  apiKey: string,
  resolve: () => void,
  reject: (err: Error) => void,
): void {
  let settled = false;

  // Safety timeout — 45 seconds for slow mobile/cellular connections.
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    _loadInProgress = false;
    _gmapsLoadPromise = null;
    reject(new Error('Google Maps load timed out (45s)'));
  }, 45000);

  (async () => {
    try {
      installBootstrap(apiKey);
      const g = (window as any).google.maps;
      // `maps` is critical — everything else is optional. If a secondary
      // library fails (quota/restriction for just that API), we still
      // want the base map to render. Components that actually use
      // places/marker/visualization re-check availability at call sites.
      await g.importLibrary('maps');
      await Promise.allSettled([
        g.importLibrary('places'),
        g.importLibrary('marker'),
        g.importLibrary('visualization'),
      ]);
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      _loadInProgress = false;
      resolve();
    } catch (err: any) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      _loadInProgress = false;
      _gmapsLoadPromise = null;
      reject(err instanceof Error ? err : new Error(String(err?.message || err)));
    }
  })();
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
        color: #0d2847;
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
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#102a50' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#151515' }] },
  // POI — simplified with very dim labels so landmarks are findable but not distracting (#6)
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#102a50' }, { visibility: 'simplified' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#555555' }] },
  { featureType: 'poi', elementType: 'labels.text.stroke', stylers: [{ color: '#111111' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  // Parks — dark green tint instead of pure gray (#3)
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0f1a0f' }, { visibility: 'simplified' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#4a8a6a' }] },
  // Roads — improved label readability (#1) and highway/arterial distinction (#5)
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#262626' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#102a50' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#999999' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2a6098' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1e4878' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#cccccc' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#999999' }] },
  // Transit — slightly brighter station labels for navigation (#4)
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#1e4878' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#999999' }] },
  // Water — navy blue tint instead of pure gray (#2)
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d2847' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#666666' }] },
  // Building footprints — subtle outlines when zoomed in (#8)
  { featureType: 'landscape.man_made', elementType: 'geometry.stroke', stylers: [{ color: '#153562' }, { weight: 0.5 }] },
];

/** Night Navigation style — high-contrast roads on near-black, optimized for driving */
export const NIGHT_NAV_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#0d2847' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#061835' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#777777' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#999999' }] },
  { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#102a50' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#555555' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#0d2847' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#0b2240' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0a1a2a' }, { visibility: 'simplified' }] },
  // Night nav roads — brighter for safer driving (#9), improved label visibility (#10)
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#153562' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1e4878' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#888888' }] },
  { featureType: 'road', elementType: 'labels.text.stroke', stylers: [{ color: '#061835' }, { weight: 3 }] },
  // Highways — high visibility for navigation (#9, #13)
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#1e4878' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#2a6098' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#aaaaaa' }] },
  // Highway ramps — increased visibility for nav clarity (#12)
  { featureType: 'road.highway.controlled_access', elementType: 'geometry', stylers: [{ color: '#153562' }] },
  { featureType: 'road.highway.controlled_access', elementType: 'labels.text.fill', stylers: [{ color: '#bbbbbb' }] },
  // Arterials — distinct from local roads for intersection visibility (#11)
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#1e4878' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#888888' }] },
  // Local roads — cross-streets more distinct (#11)
  { featureType: 'road.local', elementType: 'geometry', stylers: [{ color: '#102a50' }] },
  { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#666666' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b2240' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#102a50' }] },
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
  { elementType: 'labels.text.fill', stylers: [{ color: '#1e4878' }] },
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

// ─── Server-managed Google Maps config ────────────────────
// Fetches Google Maps API key and Map ID from the server API.
// The server returns decrypted values from system_config (admin-managed)
// with fallback to env vars. Client-side caches the result.

let _serverConfigPromise: Promise<{ google_maps_api_key?: string; google_maps_map_id?: string }> | null = null;
let _fetchFailCount = 0;
const MAX_FETCH_RETRIES = 3;

/**
 * Fetch Google Maps configuration from the server.
 * Returns { google_maps_api_key, google_maps_map_id } or empty object on failure.
 * Caches successful results for the session lifetime.
 * On failure, allows up to MAX_FETCH_RETRIES retries before giving up.
 */
export async function fetchGoogleMapsConfig(): Promise<{ google_maps_api_key?: string; google_maps_map_id?: string }> {
  if (_serverConfigPromise) return _serverConfigPromise;

  // Stop retrying after max attempts — fall back to env vars permanently
  if (_fetchFailCount >= MAX_FETCH_RETRIES) return {};

  _serverConfigPromise = (async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        _serverConfigPromise = null; // reset so we retry after login
        return {};
      }

      const base = import.meta.env.VITE_API_BASE_URL || '';
      const res = await fetch(`${base}/api/admin/google-maps-config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        _fetchFailCount++;
        _serverConfigPromise = null; // reset on failure so we can retry
        return {};
      }
      _fetchFailCount = 0; // reset on success
      return await res.json();
    } catch {
      _fetchFailCount++;
      _serverConfigPromise = null; // reset on network error so we can retry
      return {};
    }
  })();

  return _serverConfigPromise;
}

/**
 * Resolve the Google Maps API key: tries server config first, falls back to Vite env var.
 */
export async function resolveGoogleMapsApiKey(): Promise<string> {
  const cfg = await fetchGoogleMapsConfig();
  return cfg.google_maps_api_key || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
}

/**
 * Resolve the Google Maps Map ID: tries server config first, falls back to Vite env var.
 */
export async function resolveGoogleMapsMapId(): Promise<string> {
  const cfg = await fetchGoogleMapsConfig();
  return cfg.google_maps_map_id || import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || '';
}

/** Clear the cached server config (e.g. after admin saves new keys). */
export function clearGoogleMapsConfigCache(): void {
  _serverConfigPromise = null;
  _fetchFailCount = 0;
}
