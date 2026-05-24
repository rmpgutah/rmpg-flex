import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import mapboxgl from 'mapbox-gl';
import {
  DARK_STYLE,
  STREETS_STYLE,
  SATELLITE_STYLE,
  SATELLITE_STREETS_STYLE,
  OUTDOORS_STYLE,
  NAVIGATION_NIGHT_STYLE,
  LIGHT_STYLE,
  resolveMapStyleUrl,
  getMapboxToken,
} from '../../../utils/mapboxClient';
import {
  createMapboxMap,
  registerMapInstance,
  unregisterMapInstance,
  updateMapStyles,
  onOnlineRetryMaps,
  monitorMapTiles,
  injectMapStyles,
} from '../../../utils/mapboxMap';
import { devLog, devWarn } from '../../../utils/devLog';
import { injectKeyframes } from '../utils/mapMarkerBuilders';
import type { MapStyleId } from '../utils/mapConstants';

export interface UseMapInitResult {
  mapRef: MutableRefObject<HTMLDivElement | null>;
  mapInstanceRef: MutableRefObject<mapboxgl.Map | null>;
  infoWindowRef: MutableRefObject<mapboxgl.Popup | null>;
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
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<any[]>([]);
  const infoWindowRef = useRef<mapboxgl.Popup | null>(null);
  const useAdvancedMarkersRef = useRef(false);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapRetry, setMapRetry] = useState(0);
  const [tilesStalled, setTilesStalled] = useState(false);
  const [retryingGmaps, setRetryingGmaps] = useState(false);

  const isAuthError = mapError != null && (mapError.includes('token') || mapError.includes('authentication') || mapError.includes('not configured'));
  const showOfflineFallback = mapError != null && !isAuthError;

  const tileMonitorCleanupRef = useRef<(() => void) | null>(null);

  // Mapbox Initialization
  useEffect(() => {
    if (!mapRef.current) return;

    injectKeyframes();
    injectMapStyles();
    setMapError(null);

    if (mapInstanceRef.current) {
      setMapLoaded(true);
      return;
    }

    let cancelled = false;
    let pendingOnlineListener: (() => void) | null = null;
    const MAX_RETRIES = 8;
    const RETRY_DELAYS = [2000, 4000, 8000, 12000, 16000, 20000, 25000, 30000];

    function initMap(token: string) {
      if (!mapRef.current || cancelled) return;
      if (mapInstanceRef.current) { setMapLoaded(true); return; }

      mapboxgl.accessToken = token;

      try {
        const map = createMapboxMap(mapRef.current, token, resolveMapStyleUrl(mapStyle));
        mapInstanceRef.current = map;
        registerMapInstance(map);

        infoWindowRef.current = new mapboxgl.Popup({
          closeButton: true,
          closeOnClick: false,
          maxWidth: '360px',
          offset: 15,
        });

        useAdvancedMarkersRef.current = false;
        devLog('[MapPage] Using Mapbox GL JS markers');

        if (tileMonitorCleanupRef.current) tileMonitorCleanupRef.current();
        tileMonitorCleanupRef.current = monitorMapTiles(map, {
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

        setMapLoaded(true);
      } catch (err: any) {
        console.error('[MapPage] Mapbox initialization failed:', err);
        setMapError(
          'Failed to initialize map.\n\n' +
          (err?.message || String(err))
        );
      }
    }

    function attemptLoad(token: string, attempt: number) {
      if (cancelled) return;

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        devWarn('[MapPage] Device offline — pausing retries until connectivity returns');
        const onBack = () => {
          window.removeEventListener('online', onBack);
          pendingOnlineListener = null;
          if (!cancelled) {
            devLog('[MapPage] Back online — resuming map load');
            attemptLoad(token, attempt);
          }
        };
        pendingOnlineListener = onBack;
        window.addEventListener('online', onBack);
        return;
      }

      try {
        initMap(token);
      } catch (err: any) {
        if (cancelled) return;
        const errMsg = err?.message || String(err);
        devWarn(`[MapPage] Mapbox load attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`, errMsg);

        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS[attempt] || 30000;
          devLog(`[MapPage] Retrying in ${delay / 1000}s...`);
          setTimeout(() => attemptLoad(token, attempt + 1), delay);
        } else {
          console.error('[MapPage] Mapbox load failed after all retries');
          setMapError(
            'Failed to load map after multiple attempts.\n\n' +
            'If you are on a slow or intermittent connection (vehicle WiFi),\n' +
            'wait for a stronger signal and click Retry below.\n\n' +
            (errMsg ? `Technical details: ${errMsg}` : '')
          );
        }
      }
    }

    let unsubOnline = () => {};

    (async () => {
      try {
        const token = await getMapboxToken();
        if (cancelled) return;
        if (!token) {
          setMapError(
            'Mapbox token not configured.\n\n' +
            'Ask an admin to set the Mapbox API key in Admin Settings.'
          );
          return;
        }
        attemptLoad(token, 0);
        unsubOnline = onOnlineRetryMaps(token, () => {
          if (!cancelled && !mapInstanceRef.current) {
            devLog('[MapPage] Online auto-retry triggered — reinitializing map');
            setMapError(null);
            initMap(token);
          }
        });
      } catch (err: any) {
        if (!cancelled) {
          setMapError(err?.message || 'Failed to get Mapbox token');
          setMapLoaded(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (pendingOnlineListener) { window.removeEventListener('online', pendingOnlineListener); pendingOnlineListener = null; }
      unsubOnline();
      if (tileMonitorCleanupRef.current) { tileMonitorCleanupRef.current(); tileMonitorCleanupRef.current = null; }
      if (mapInstanceRef.current) {
        unregisterMapInstance(mapInstanceRef.current);
        mapInstanceRef.current.remove();
      }
      markersRef.current.forEach((m) => {
        if (m && typeof m.remove === 'function') m.remove();
      });
      markersRef.current = [];
      mapInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRetry, mapStyle]);

  // Switch Map Style
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    let styleUrl: string;
    if (mapStyle === 'dark') {
      styleUrl = DARK_STYLE;
    } else if (mapStyle === 'night_nav') {
      styleUrl = NAVIGATION_NIGHT_STYLE;
    } else if (mapStyle === 'satellite') {
      styleUrl = SATELLITE_STYLE;
    } else if (mapStyle === 'hybrid') {
      styleUrl = SATELLITE_STREETS_STYLE;
    } else if (mapStyle === 'terrain') {
      styleUrl = OUTDOORS_STYLE;
    } else {
      styleUrl = STREETS_STYLE;
    }

    map.setStyle(styleUrl);
    updateMapStyles(map, styleUrl);
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