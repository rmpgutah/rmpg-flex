// ============================================================
// RMPG Flex — Google Maps Script Loader (shared utility)
// Extracted from MapPage.tsx for reuse in DispatchMiniMap + MapPage.
// Injects a <script> tag, handles HMR re-entrant loads, and
// exposes map styles + a global registry for print-mode switching.
//
// Designed for vehicle/mobile use on intermittent WiFi/cellular:
// - Adaptive timeout: 60s normal, 90s on slow cellular (2g)
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
 * On error or timeout (60–90 s), resets so the caller can retry.
 *
 * Vehicle/mobile resilience:
 * - If navigator.onLine is false, waits for the 'online' event before loading
 * - Adaptive timeout (60s / 90s on slow networks) for cellular/satellite connections
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
        console.log('[GoogleMapsLoader] Back online — loading Google Maps');
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
  script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,marker&callback=${callbackName}&v=weekly`;
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

  // Adaptive timeout — use Network Information API when available.
  // On slow cellular (2g/slow-2g), allow 90s; otherwise 60s.
  // Officers on moving vehicle hotspots can have very slow downloads.
  const conn = (navigator as any).connection;
  const isSlowNetwork = conn && (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g');
  const loadTimeout = isSlowNetwork ? 90000 : 60000;

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
    reject(new Error(`Google Maps script load timed out (${loadTimeout / 1000}s)`));
  }, loadTimeout);
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
    console.log('[GoogleMapsLoader] Device back online — auto-retrying maps load');
    _gmapsLoadPromise = null; // reset so loadGoogleMaps will try again
    loadGoogleMaps(apiKey)
      .then(callback)
      .catch(() => { /* will be retried on next online event */ });
  };
  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}

/** Dark map style matching RMPG Flex theme */
export const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#060c14' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#000000' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#555555' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#707070' }] },
  { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#0e0e0e' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#0a1018' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#0c0c0c' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0d120d' }, { visibility: 'simplified' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#141e2b' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#162236' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#444444' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#242424' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#060c14' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#1a2a3a' }] },
];

/** Light map style for printed reports — clean, high-contrast B&W */
export const LIGHT_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#333333' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#c0c0c0' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#162236' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#555555' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#eeeeee' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#e8e8e8' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#f0f0f0' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#d8ecd8' }, { visibility: 'simplified' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#cccccc' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#555555' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#dadada' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#bbbbbb' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#333333' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c8dff0' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#666666' }] },
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
if (typeof window !== 'undefined') {
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

// --- Offline Tile Layer Constants & Helpers ---

export const OFFLINE_TILE_MIN_ZOOM = 7;
export const OFFLINE_TILE_MAX_ZOOM = 15;

/** Monitor tile loading status (returns cleanup function) */
export function monitorTileLoading(map: google.maps.Map, onStatusChange: (loading: boolean) => void): () => void {
  let pendingTiles = 0;
  const listener1 = map.addListener('tilesloading', () => {
    pendingTiles++;
    onStatusChange(true);
  });
  const listener2 = map.addListener('idle', () => {
    pendingTiles = 0;
    onStatusChange(false);
  });
  return () => {
    google.maps.event.removeListener(listener1);
    google.maps.event.removeListener(listener2);
  };
}

/** Add an offline tile overlay layer to the map */
export function addOfflineTileLayer(map: google.maps.Map): google.maps.ImageMapType {
  const offlineTiles = new google.maps.ImageMapType({
    getTileUrl: (coord: google.maps.Point, zoom: number) => {
      if (zoom < OFFLINE_TILE_MIN_ZOOM || zoom > OFFLINE_TILE_MAX_ZOOM) return '';
      return `/tiles/${zoom}/${coord.x}/${coord.y}.png`;
    },
    tileSize: new google.maps.Size(256, 256),
    name: 'Offline',
    maxZoom: OFFLINE_TILE_MAX_ZOOM,
    minZoom: OFFLINE_TILE_MIN_ZOOM,
  });
  map.overlayMapTypes.push(offlineTiles);
  return offlineTiles;
}
