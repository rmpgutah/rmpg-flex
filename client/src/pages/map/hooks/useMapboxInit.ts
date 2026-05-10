// ============================================================
// RMPG Flex — useMapboxInit Hook
// ============================================================
// React hook for initializing a Mapbox GL JS map instance.
// Parallel to useMapInit (Google Maps) but uses Mapbox GL.
// Used when the map provider detection selects Mapbox as primary.
// ============================================================

import { useEffect, useRef, useState, useCallback, type MutableRefObject } from 'react';
import mapboxgl from 'mapbox-gl';
import {
  createMapboxMap,
  destroyMapboxMap,
  setMapboxStyle,
  injectMapboxStyles,
  addMapbox3DBuildings,
  type MapboxStyleId,
} from '../../../utils/mapboxLoader';
import { getMapboxToken } from '../../../utils/mapboxApiKey';
import { devLog, devWarn } from '../../../utils/devLog';

export interface UseMapboxInitResult {
  mapRef: MutableRefObject<HTMLDivElement | null>;
  mapInstanceRef: MutableRefObject<mapboxgl.Map | null>;
  markersRef: MutableRefObject<mapboxgl.Marker[]>;
  popupRef: MutableRefObject<mapboxgl.Popup | null>;
  mapLoaded: boolean;
  mapError: string | null;
  tilesStalled: boolean;
  retrying: boolean;
  isAuthError: boolean;
  showOfflineFallback: boolean;
  setMapStyle: (style: MapboxStyleId) => void;
  flyTo: (center: [number, number], zoom?: number) => void;
  fitBounds: (bounds: [[number, number], [number, number]], padding?: number) => void;
}

export function useMapboxInit(initialStyle: MapboxStyleId = 'dark'): UseMapboxInitResult {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [tilesStalled, setTilesStalled] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [currentStyle, setCurrentStyle] = useState<MapboxStyleId>(initialStyle);

  const isAuthError = mapError !== null && (
    mapError.includes('access token') ||
    mapError.includes('Access token') ||
    mapError.includes('not configured')
  );
  const showOfflineFallback = mapError !== null && !isAuthError;

  // Initialize the Mapbox map
  useEffect(() => {
    if (!mapRef.current) return;

    let cancelled = false;

    // Inject Spillman dark theme CSS
    injectMapboxStyles();

    const initMap = async () => {
      try {
        setMapError(null);
        setRetrying(false);

        // Fetch access token
        const token = await getMapboxToken();
        if (!token) {
          setMapError('Mapbox access token not configured. Set it in Admin → Integrations → Mapbox.');
          return;
        }

        if (cancelled) return;

        // Clean up existing instance
        if (mapInstanceRef.current) {
          destroyMapboxMap();
          mapInstanceRef.current = null;
        }

        devLog('[Mapbox] Initializing map with style:', currentStyle);

        // Create the map
        const map = createMapboxMap({
          container: mapRef.current!,
          accessToken: token,
          style: currentStyle,
          center: [-111.891, 40.7608], // SLC
          zoom: 12,
        });

        mapInstanceRef.current = map;

        // Handle load
        map.on('load', () => {
          if (cancelled) return;
          devLog('[Mapbox] Map loaded successfully');
          setMapLoaded(true);
          setTilesStalled(false);

          // Add 3D buildings on dark/night styles
          if (currentStyle === 'dark' || currentStyle === 'night_nav') {
            addMapbox3DBuildings(map);
          }
        });

        // Handle errors
        map.on('error', (e: mapboxgl.ErrorEvent) => {
          if (cancelled) return;
          const msg = e.error?.message || 'Unknown Mapbox error';
          devWarn('[Mapbox] Map error:', msg);

          // Check for auth errors
          if (msg.includes('access token') || msg.includes('401') || msg.includes('403')) {
            setMapError(`Mapbox authentication failed: ${msg}`);
          }
        });

        // Monitor tile loading for stall detection
        let tileTimer: ReturnType<typeof setTimeout> | null = null;
        const STALL_THRESHOLD = 15000; // 15 seconds

        map.on('dataloading', () => {
          if (tileTimer) clearTimeout(tileTimer);
          tileTimer = setTimeout(() => {
            if (!cancelled) setTilesStalled(true);
          }, STALL_THRESHOLD);
        });

        map.on('data', (e) => {
          if (e.dataType === 'source' && tileTimer) {
            clearTimeout(tileTimer);
            tileTimer = null;
            if (!cancelled) setTilesStalled(false);
          }
        });

        map.on('idle', () => {
          if (tileTimer) {
            clearTimeout(tileTimer);
            tileTimer = null;
          }
          if (!cancelled) setTilesStalled(false);
        });

      } catch (err: any) {
        if (cancelled) return;
        devWarn('[Mapbox] Init error:', err);
        setMapError(err?.message || 'Failed to initialize Mapbox map');
      }
    };

    initMap();

    return () => {
      cancelled = true;
      // Clean up all markers
      for (const marker of markersRef.current) {
        marker.remove();
      }
      markersRef.current = [];
      // Clean up popup
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
      // Clean up map
      destroyMapboxMap();
      mapInstanceRef.current = null;
      setMapLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStyle]);

  // Style setter
  const setMapStyle = useCallback((style: MapboxStyleId) => {
    setCurrentStyle(style);
    if (mapInstanceRef.current) {
      setMapboxStyle(mapInstanceRef.current, style);
    }
  }, []);

  // Camera controls
  const flyTo = useCallback((center: [number, number], zoom?: number) => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.flyTo({
      center,
      zoom: zoom || mapInstanceRef.current.getZoom(),
      duration: 1500,
      essential: true,
    });
  }, []);

  const fitBounds = useCallback((bounds: [[number, number], [number, number]], padding = 50) => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.fitBounds(bounds, {
      padding,
      duration: 1500,
    });
  }, []);

  return {
    mapRef,
    mapInstanceRef,
    markersRef,
    popupRef,
    mapLoaded,
    mapError,
    tilesStalled,
    retrying,
    isAuthError,
    showOfflineFallback,
    setMapStyle,
    flyTo,
    fitBounds,
  };
}
