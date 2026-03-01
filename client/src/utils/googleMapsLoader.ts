// ============================================================
// RMPG Flex — Google Maps Script Loader (shared utility)
// Extracted from MapPage.tsx for reuse in DispatchMiniMap + MapPage.
// Injects a <script> tag, handles HMR re-entrant loads, and
// exposes map styles + a global registry for print-mode switching.
// ============================================================

let _gmapsLoadPromise: Promise<void> | null = null;

/**
 * Loads the Google Maps JS API via a script tag.
 * Idempotent — returns a cached promise on subsequent calls.
 * On error or timeout (15 s), resets so the caller can retry.
 */
export function loadGoogleMaps(apiKey: string): Promise<void> {
  if (_gmapsLoadPromise) return _gmapsLoadPromise;

  // If google.maps already exists (HMR / page revisit), resolve immediately
  if (typeof google !== 'undefined' && google.maps && google.maps.Map) {
    _gmapsLoadPromise = Promise.resolve();
    return _gmapsLoadPromise;
  }

  _gmapsLoadPromise = new Promise<void>((resolve, reject) => {
    // Remove any stale/failed script tags so we always get a fresh load.
    const existing = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existing) {
      if (typeof google !== 'undefined' && google.maps && google.maps.Map) {
        resolve();
        return;
      }
      existing.remove();
      delete (window as any).__rmpg_gmaps_init__;
    }

    const callbackName = '__rmpg_gmaps_init__';
    (window as any)[callbackName] = () => {
      delete (window as any)[callbackName];
      resolve();
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,marker&callback=${callbackName}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      _gmapsLoadPromise = null;
      script.remove();
      delete (window as any)[callbackName];
      reject(new Error('Failed to load Google Maps script'));
    };
    document.head.appendChild(script);

    // Safety timeout
    setTimeout(() => {
      if (typeof google === 'undefined' || !google.maps || !google.maps.Map) {
        _gmapsLoadPromise = null;
        script.remove();
        delete (window as any)[callbackName];
        reject(new Error('Google Maps script load timed out'));
      }
    }, 15000);
  });

  return _gmapsLoadPromise;
}

/** Dark map style matching RMPG Flex theme */
export const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#0a0a0a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#000000' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#555555' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#707070' }] },
  { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#0e0e0e' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#111111' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#0c0c0c' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0d120d' }, { visibility: 'simplified' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#222222' }] },
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
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#222222' }] },
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
