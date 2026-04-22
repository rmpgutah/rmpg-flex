import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  loadGoogleMaps,
  DARK_MAP_STYLE,
  NIGHT_NAV_STYLE,
  TERRAIN_STYLE,
  registerMapInstance,
  unregisterMapInstance,
  updateMapStyles,
  onOnlineRetryMaps,
  monitorTileLoading,
} from '../../../utils/googleMapsLoader';
import { getGoogleMapsApiKey, getGoogleMapsApiKeyErrorMessage } from '../../../utils/googleMapsApiKey';
import { devLog, devWarn } from '../../../utils/devLog';
import { injectKeyframes, getOverlayMarkerClass } from '../utils/mapMarkerBuilders';
import type { MapStyleId } from '../utils/mapConstants';

export interface UseMapInitResult {
  mapRef: MutableRefObject<HTMLDivElement | null>;
  mapInstanceRef: MutableRefObject<google.maps.Map | null>;
  infoWindowRef: MutableRefObject<google.maps.InfoWindow | null>;
  markersRef: MutableRefObject<any[]>;
  useAdvancedMarkersRef: MutableRefObject<boolean>;
  mapLoaded: boolean;
  mapError: string | null;
  tilesStalled: boolean;
  retryingGmaps: boolean;
  isAuthError: boolean;
  showOfflineFallback: boolean;
  setMapRetry: React.Dispatch<React.SetStateAction<number>>;
  setRetryingGmaps: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useMapInit(mapStyle: MapStyleId): UseMapInitResult {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  // NOTE: typed as any[] because markers can be AdvancedMarkerElement or OverlayView instances
  const markersRef = useRef<any[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const useAdvancedMarkersRef = useRef(false);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapRetry, setMapRetry] = useState(0);
  const [tilesStalled, setTilesStalled] = useState(false);
  const [retryingGmaps, setRetryingGmaps] = useState(false);

  const isAuthError = mapError != null && (mapError.includes('API key') || mapError.includes('authentication') || mapError.includes('not configured'));
  const showOfflineFallback = mapError != null && !isAuthError;

  const tileMonitorCleanupRef = useRef<(() => void) | null>(null);

  // Google Maps Initialization
  useEffect(() => {
    if (!mapRef.current) return;

    injectKeyframes();
    setMapError(null);

    if (mapInstanceRef.current) {
      setMapLoaded(true);
      return;
    }

    let authFailed = false;
    (window as any).gm_authFailure = () => {
      authFailed = true;
      console.error('[MapPage] Google Maps authentication failure — API key rejected');
      setMapError(
        'Google Maps API key was rejected.\n\n' +
        'Fix these in Google Cloud Console (console.cloud.google.com):\n\n' +
        '1. BILLING: Link a billing account to the project\n' +
        '   (Google Maps requires billing — free tier covers most usage)\n\n' +
        '2. ENABLE APIs: Go to APIs & Services → Library → enable:\n' +
        '   • Maps JavaScript API\n' +
        '   • Places API (New)\n\n' +
        '3. KEY RESTRICTIONS: Go to Credentials → click your key:\n' +
        '   • API restrictions: "Don\'t restrict key" (or add Maps JS + Places APIs)\n' +
        '   • Website restrictions: set to "None" for dev, or add:\n' +
        '     http://localhost:3001/*\n' +
        '     http://localhost:5173/*\n' +
        '     http://localhost:4173/*'
      );
    };

    let cancelled = false;
    let pendingOnlineListener: (() => void) | null = null;
    const MAX_RETRIES = 8;
    const RETRY_DELAYS = [2000, 4000, 8000, 12000, 16000, 20000, 25000, 30000];
    let dismissObserver: MutationObserver | null = null;
    let dismissTimer: ReturnType<typeof setTimeout> | null = null;

    function initMap() {
      if (!mapRef.current || authFailed || cancelled) return;
      if (mapInstanceRef.current) { setMapLoaded(true); return; }

      const map = new google.maps.Map(mapRef.current, {
        center: { lat: 40.7608, lng: -111.8910 },
        zoom: 12,
        disableDefaultUI: true,
        zoomControl: false,
        styles: DARK_MAP_STYLE,
        backgroundColor: '#171717',
        renderingType: 'RASTER' as any,
        isFractionalZoomEnabled: false,
        gestureHandling: 'greedy',
      });

      mapInstanceRef.current = map;
      registerMapInstance(map);

      infoWindowRef.current = new google.maps.InfoWindow();

      const hideStyleId = '__rmpg_hide_gm_dialog__';
      if (!document.getElementById(hideStyleId)) {
        const s = document.createElement('style');
        s.id = hideStyleId;
        s.textContent = '[role="alertdialog"] { display: none !important; }';
        document.head.appendChild(s);
      }

      dismissObserver = new MutationObserver(() => {
        if (authFailed) return;
        const hardErr = mapRef.current?.querySelector('.gm-err-container');
        if (hardErr) {
          console.error('[MapPage] Google Maps hard error overlay detected');
          authFailed = true;
          dismissObserver?.disconnect();
          setMapError(
            'Google Maps failed to load.\n\n' +
            'Check Google Cloud Console:\n' +
            '1. Billing account linked to the project\n' +
            '2. Maps JavaScript API enabled\n' +
            '3. API key restrictions allow this domain'
          );
          return;
        }
        const dialog = document.querySelector('[role="alertdialog"]');
        if (dialog) {
          const btn = dialog.querySelector('button');
          if (btn) btn.click();
          dialog.remove();
        }
      });
      dismissObserver.observe(document.body, { childList: true, subtree: true });
      dismissTimer = setTimeout(() => dismissObserver?.disconnect(), 10000);

      useAdvancedMarkersRef.current = false;
      devLog('[MapPage] Using OverlayView markers (no mapId configured)');

      if (tileMonitorCleanupRef.current) tileMonitorCleanupRef.current();
      tileMonitorCleanupRef.current = monitorTileLoading(map, {
        onStalled: () => {
          devWarn('[MapPage] Map tiles stalled');
          setTilesStalled(true);
        },
        onLoaded: () => {
          devLog('[MapPage] Map tiles loaded successfully');
          setTilesStalled(false);
        },
        onRecovering: () => {
          devLog('[MapPage] Attempting tile recovery...');
        },
      });

      if (!authFailed) setMapLoaded(true);
    }

    function attemptLoad(apiKey: string, attempt: number) {
      if (cancelled) return;

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        devWarn('[MapPage] Device offline — pausing retries until connectivity returns');
        const onBack = () => {
          window.removeEventListener('online', onBack);
          pendingOnlineListener = null;
          if (!cancelled) {
            devLog('[MapPage] Back online — resuming map load');
            attemptLoad(apiKey, attempt);
          }
        };
        pendingOnlineListener = onBack;
        window.addEventListener('online', onBack);
        return;
      }

      loadGoogleMaps(apiKey)
        .then(() => initMap())
        .catch((err: any) => {
          if (cancelled) return;
          const errMsg = err?.message || String(err);
          devWarn(`[MapPage] Google Maps load attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`, errMsg);

          if (attempt < MAX_RETRIES) {
            const delay = RETRY_DELAYS[attempt] || 30000;
            devLog(`[MapPage] Retrying in ${delay / 1000}s...`);
            setTimeout(() => attemptLoad(apiKey, attempt + 1), delay);
          } else {
            console.error('[MapPage] Google Maps load failed after all retries');
            setMapError(
              'Failed to load Google Maps after multiple attempts.\n\n' +
              'If you are on a slow or intermittent connection (vehicle WiFi),\n' +
              'wait for a stronger signal and click Retry below.\n\n' +
              (errMsg ? `Technical details: ${errMsg}` : '')
            );
          }
        });
    }

    let unsubOnline = () => {};

    (async () => {
      try {
        const apiKey = await getGoogleMapsApiKey();
        if (cancelled) return;
        attemptLoad(apiKey, 0);
        unsubOnline = onOnlineRetryMaps(apiKey, () => {
          if (!cancelled && !mapInstanceRef.current) {
            devLog('[MapPage] Online auto-retry triggered — reinitializing map');
            setMapError(null);
            initMap();
          }
        });
      } catch (err: any) {
        if (!cancelled) {
          setMapError(err?.message || getGoogleMapsApiKeyErrorMessage());
          setMapLoaded(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (pendingOnlineListener) { window.removeEventListener('online', pendingOnlineListener); pendingOnlineListener = null; }
      unsubOnline();
      if (dismissTimer) clearTimeout(dismissTimer);
      if (dismissObserver) dismissObserver.disconnect();
      if (tileMonitorCleanupRef.current) { tileMonitorCleanupRef.current(); tileMonitorCleanupRef.current = null; }
      // Remove injected style element to prevent DOM leaks across re-mounts
      const hideStyle = document.getElementById('__rmpg_hide_gm_dialog__');
      if (hideStyle) hideStyle.remove();
      if (mapInstanceRef.current) unregisterMapInstance(mapInstanceRef.current);
      markersRef.current.forEach((m) => {
        if (m && typeof m.remove === 'function') m.remove();
        else if (m) m.map = null;
      });
      markersRef.current = [];
      mapInstanceRef.current = null;
      delete (window as any).gm_authFailure;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRetry, mapStyle]);

  // Switch Map Style
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (mapStyle === 'dark') {
      map.setMapTypeId('roadmap');
      map.setOptions({ styles: DARK_MAP_STYLE });
      updateMapStyles(map, DARK_MAP_STYLE);
    } else if (mapStyle === 'night_nav') {
      map.setMapTypeId('roadmap');
      map.setOptions({ styles: NIGHT_NAV_STYLE });
      updateMapStyles(map, NIGHT_NAV_STYLE);
    } else if (mapStyle === 'satellite') {
      map.setMapTypeId('satellite');
      map.setOptions({ styles: [] });
      updateMapStyles(map, []);
    } else if (mapStyle === 'hybrid') {
      map.setMapTypeId('hybrid');
      map.setOptions({ styles: [] });
      updateMapStyles(map, []);
    } else if (mapStyle === 'terrain') {
      map.setMapTypeId('terrain');
      map.setOptions({ styles: TERRAIN_STYLE });
      updateMapStyles(map, TERRAIN_STYLE);
    } else if (mapStyle === 'streets') {
      map.setMapTypeId('roadmap');
      map.setOptions({ styles: [] });
      updateMapStyles(map, []);
    }
  }, [mapStyle, mapLoaded]);

  return {
    mapRef,
    mapInstanceRef,
    infoWindowRef,
    markersRef,
    useAdvancedMarkersRef,
    mapLoaded,
    mapError,
    tilesStalled,
    retryingGmaps,
    isAuthError,
    showOfflineFallback,
    setMapRetry,
    setRetryingGmaps,
  };
}
