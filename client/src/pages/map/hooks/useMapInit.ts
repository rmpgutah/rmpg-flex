import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import mapboxgl from 'mapbox-gl';
import { devLog, devWarn } from '../../../utils/devLog';
import { injectKeyframes } from '../utils/mapMarkerBuilders';
import type { MapStyleId } from '../utils/mapConstants';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';

const STYLE_MAP: Record<MapStyleId, string> = {
  dark: 'mapbox://styles/mapbox/dark-v11',
  night_nav: 'mapbox://styles/mapbox/dark-v11',
  satellite: 'mapbox://styles/mapbox/satellite-v9',
  hybrid: 'mapbox://styles/mapbox/satellite-streets-v12',
  terrain: 'mapbox://styles/mapbox/outdoors-v12',
  streets: 'mapbox://styles/mapbox/streets-v12',
};

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

  useEffect(() => {
    if (!mapRef.current) return;

    injectKeyframes();
    setMapError(null);

    if (mapInstanceRef.current) {
      setMapLoaded(true);
      return;
    }

    let authFailed = false;
    let cancelled = false;
    const MAX_RETRIES = 8;
    const RETRY_DELAYS = [2000, 4000, 8000, 12000, 16000, 20000, 25000, 30000];

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

      // Auth/quota failure can return a stub Map with no div — bail early
      // so the existing setMapError path takes over instead of crashing in monitorTileLoading.
      if (!map || typeof map.getDiv !== 'function' || !map.getDiv()) {
        setMapError('Google Maps failed to initialize — check API key / billing.');
        return;
      }

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

      mapboxgl.accessToken = MAPBOX_TOKEN;

      const map = new mapboxgl.Map({
        container: mapRef.current,
        style: STYLE_MAP[mapStyle] || STYLE_MAP.dark,
        center: [-111.8910, 40.7608],
        zoom: 12,
        attributionControl: false,
        interactive: true,
        failIfMajorPerformanceCaveat: false,
      });

      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();

      mapInstanceRef.current = map;

      infoWindowRef.current = new mapboxgl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: '320px',
        className: 'rmpg-map-popup',
      });

      useAdvancedMarkersRef.current = false;
      devLog('[MapPage] Using Mapbox markers');

      map.on('load', () => {
        if (!authFailed) setMapLoaded(true);
      });

      map.on('error', (e) => {
        if (e.error?.message?.includes('token') || e.error?.message?.includes('401')) {
          authFailed = true;
          setMapError('Mapbox authentication failed — check your access token.');
        }
      });

      map.on('idle', () => {
        setTilesStalled(false);
      });
    }

    function attemptLoad(attempt: number) {
      if (cancelled) return;

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        devWarn('[MapPage] Device offline — pausing retries until connectivity returns');
        const onBack = () => {
          window.removeEventListener('online', onBack);
          if (!cancelled) {
            devLog('[MapPage] Back online — resuming map load');
            attemptLoad(attempt);
          }
        };
        window.addEventListener('online', onBack);
        return;
      }

      if (!MAPBOX_TOKEN) {
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS[attempt] || 30000;
          setTimeout(() => attemptLoad(attempt + 1), delay);
        } else {
          setMapError('Failed to load map — no Mapbox access token configured.');
        }
        return;
      }

      try {
        initMap();
      } catch (err: any) {
        if (cancelled) return;
        const errMsg = err?.message || String(err);
        devWarn(`[MapPage] Map load attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`, errMsg);

        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS[attempt] || 30000;
          setTimeout(() => attemptLoad(attempt + 1), delay);
        } else {
          setMapError('Failed to load map after multiple attempts.\n\n' + (errMsg ? `Technical details: ${errMsg}` : ''));
        }
      }
    }

    attemptLoad(0);

    return () => {
      cancelled = true;
      if (tileMonitorCleanupRef.current) { tileMonitorCleanupRef.current(); tileMonitorCleanupRef.current = null; }
      markersRef.current.forEach((m) => {
        if (m && typeof m.remove === 'function') m.remove();
      });
      markersRef.current = [];
      if (infoWindowRef.current) {
        infoWindowRef.current.remove();
        infoWindowRef.current = null;
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRetry, mapStyle]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    const styleUrl = STYLE_MAP[mapStyle] || STYLE_MAP.dark;
    if (map.getStyle().sprite !== styleUrl) {
      map.setStyle(styleUrl);
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
