import { useCallback, useEffect, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import {
  createMapboxMap, destroyMapboxMap, injectMapboxStyles, addMapbox3DBuildings,
  setMapboxStyle, addMapboxTerrain,
} from '../../../utils/mapboxLoader';
import { getMapboxTokenStatus } from '../../../utils/mapboxApiKey';
import { applyRmpgBasemap, type BasemapVariant } from '../../../utils/mapboxBasemap';
import { devLog, devWarn } from '../../../utils/devLog';
import { installWebglContextRecovery, type MapCamera } from '../../../utils/webglRecovery';
import type { MapStyleId } from '../utils/mapConstants';
import { isLightMapStyle, isSatelliteStyle } from '../utils/mapConstants';

function basemapVariantFor(styleId: MapStyleId): BasemapVariant {
  if (isSatelliteStyle(styleId)) return 'satellite';
  if (isLightMapStyle(styleId)) return 'light';
  return 'dark';
}
import { useMapDaylight, type UseMapDaylightResult } from '../../../hooks/useMapDaylight';
import { useMapProjection } from '../../../hooks/useMapProjection';
import { useMapAtmosphere } from '../../../hooks/useMapAtmosphere';
import { useMapCameraAnimation } from '../../../hooks/useMapCameraAnimation';
import { useMapSnapshot } from '../../../hooks/useMapSnapshot';

const DARK_STYLES: MapStyleId[] = ['dark', 'night_nav'];

export interface UseMapCoreOptions {
  preferredEngine: 'mapbox' | 'maplibre';
  mapStyle: MapStyleId;
  retryNonce: number;
  /**
   * `onStyleFallback` and `onRetryNonceRequest` must be stable references across
   * renders (e.g. wrapped in `useCallback`) — the internal init effect closes over
   * them without listing them as dependencies, so a new inline function on every
   * render will be captured as a stale closure.
   */
  /** Called to switch the persisted map style (used on style-not-found retry). */
  onStyleFallback: (style: MapStyleId) => void;
  /** Called to bump the caller-owned retryNonce (used on style-not-found retry). */
  onRetryNonceRequest: () => void;
  /** Whether 3D terrain is currently enabled — replicated onto the map after a style switch. */
  terrainEnabled: boolean;
}

export interface UseMapCoreResult {
  mapContainerRef: React.RefObject<HTMLDivElement | null>;
  mapRef: React.MutableRefObject<mapboxgl.Map | null>;
  mapLoaded: boolean;
  loading: boolean;
  mapError: string | null;
  mapLibreFallback: boolean;
  /** True while the WebGL context is lost and a rebuild is pending (grace window). */
  isContextLost: boolean;
  /** True when the rebuild loop-guard tripped — manual page reload is the only fix. */
  needsManualReload: boolean;
  /**
   * Switches the live map instance to a new style and re-applies dark-style 3D
   * buildings and terrain (if enabled) once the new style loads. Callers must
   * also update their own persisted `mapStyle` state after calling this (e.g.
   * `setMapStyleId(styleId)`) — `changeStyle` only mutates the live map instance,
   * it does not update the `mapStyle` option this hook was called with.
   */
  changeStyle: (styleId: MapStyleId) => void;
  /** The server-fetched runtime Mapbox token (not the build-time `mapboxgl.accessToken` global). */
  token: string | null;
  daylight: UseMapDaylightResult;
  projection: ReturnType<typeof useMapProjection>;
  atmosphere: ReturnType<typeof useMapAtmosphere>;
  cameraAnimation: ReturnType<typeof useMapCameraAnimation>;
  snapshot: ReturnType<typeof useMapSnapshot>;
}

export function useMapCore({
  preferredEngine, mapStyle, retryNonce, onStyleFallback, onRetryNonceRequest,
  terrainEnabled,
}: UseMapCoreOptions): UseMapCoreResult {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const tokenRef = useRef<string | null>(null);
  // Tracks the CURRENTLY active style id so the persistent basemap re-skin
  // listener (registered once, fires on every style.load — including
  // subsequent changeStyle() swaps) re-skins for whichever style is live at
  // the time, not whichever style was active when the listener was attached.
  const activeStyleRef = useRef<MapStyleId>(mapStyle);
  const [token, setToken] = useState<string | null>(null);
  // Camera to restore once the post-context-loss rebuild's new map finishes
  // loading — set by the webglRecovery onRebuild callback below.
  const pendingRestoreCameraRef = useRef<MapCamera | null>(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapLibreFallback, setMapLibreFallback] = useState(false);
  const [isContextLost, setIsContextLost] = useState(false);
  const [needsManualReload, setNeedsManualReload] = useState(false);

  useEffect(() => {
    if (preferredEngine === 'maplibre' && !mapLibreFallback) {
      setMapError(null);
      setMapLibreFallback(true);
      setLoading(false);
    }
  }, [preferredEngine, mapLibreFallback]);

  useEffect(() => {
    if (mapLibreFallback) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let webglRecoveryCleanup: (() => void) | null = null;

    async function initMap() {
      // Reset error/loading state at the top of every (re-)run so the
      // "Retry Mapbox" button (and any other retryNonce bump) clears a
      // previous error and shows the loading overlay again, instead of
      // requiring the caller to manage that state itself.
      setMapError(null);
      setLoading(true);
      try {
        // Timeout token fetch to avoid infinite hang if server is unreachable
        const tokenStatusPromise = getMapboxTokenStatus(retryNonce > 0);
        const timeoutPromise = new Promise<null>((_resolve) => setTimeout(() => _resolve(null), 10_000));
        const tokenStatus = await Promise.race([tokenStatusPromise, timeoutPromise]);
        if (cancelled) return;
        if (!tokenStatus?.token) {
          if (tokenStatus?.errorKind === 'auth') {
            setMapError('Unable to access Mapbox token due to authentication/session failure. Please sign in again, then retry.');
          } else if (tokenStatus?.errorKind === 'network') {
            setMapError('Unable to fetch Mapbox token due to a network/connectivity error. Check connectivity, then retry.');
          } else if (tokenStatus?.errorKind === 'server') {
            setMapError(`Failed to fetch Mapbox token from server: ${tokenStatus.errorMessage || 'unknown error'}`);
          } else if (tokenStatus?.errorKind === 'client') {
            setMapError(`Mapbox token fetch failed on client side: ${tokenStatus.errorMessage || 'unknown client error'}`);
          } else if (tokenStatus?.errorKind === 'none' || tokenStatus?.errorKind === 'unconfigured') {
            setMapError('Mapbox access token not configured. Go to Admin → Integrations to add your Mapbox token.');
          } else {
            setMapError('Mapbox token is unavailable. Using MapLibre fallback.');
          }
          devLog('[MapCore] Mapbox token unavailable, activating MapLibre GL fallback', tokenStatus);
          setMapLibreFallback(true);
          setLoading(false);
          return;
        }
        tokenRef.current = tokenStatus.token;
        setToken(tokenStatus.token);
        injectMapboxStyles();

        if (!mapContainerRef.current) {
          // Container not yet mounted — wait a tick and retry
          await new Promise((r) => setTimeout(r, 100));
          if (cancelled || !mapContainerRef.current) {
            setMapError('Map container failed to mount');
            setLoading(false);
            return;
          }
        }

        const map = createMapboxMap(
          mapContainerRef.current!,
          tokenRef.current!,
          mapStyle,
        );
        mapRef.current = map;
        activeStyleRef.current = mapStyle;
        // Brand the basemap on every style (re-applies after changeStyle()
        // swaps too, since 'style.load' fires again on setStyle) — makes the
        // main /map page follow the same theme-reactive re-skin as every
        // other Mapbox surface in the app (SightingsMap, ForensicTrackMap,
        // DispatchMiniMap, etc.) instead of rendering a raw stock style.
        map.on('style.load', () => applyRmpgBasemap(map, { variant: basemapVariantFor(activeStyleRef.current) }));

        // Track whether the map has successfully loaded at least once.
        // Individual tile/source errors after successful load should NOT
        // trigger full MapLibre fallback — only fatal init errors should.
        let mapDidLoad = false;

        // Timeout map load to prevent infinite "Initializing" state
        const loadTimeout = setTimeout(() => {
          if (!cancelled && !mapRef.current?.loaded()) {
            devWarn('[MapCore] map load timed out after 15s');
            setLoading(false);
            // Map may still be loading — don't set error, just remove overlay
          }
        }, 15_000);

        map.on('load', () => {
          clearTimeout(loadTimeout);
          if (cancelled) return;
          mapDidLoad = true;
          // NavigationControl, ScaleControl, GeolocateControl, and AttributionControl
          // are already added by createMapboxMap() — don't duplicate them here.
          if (DARK_STYLES.includes(mapStyle)) addMapbox3DBuildings(map);
          if (pendingRestoreCameraRef.current) {
            const cam = pendingRestoreCameraRef.current;
            pendingRestoreCameraRef.current = null;
            map.jumpTo({ center: cam.center, zoom: cam.zoom, bearing: cam.bearing, pitch: cam.pitch });
          }
          setMapLoaded(true);
          setLoading(false);
          devLog('[MapCore] map loaded');
        });

        // Mapbox's 'error' event never fires on WebGL context loss — that's a
        // separate 'webglcontextlost' event Mapbox surfaces directly on the
        // map. Without this, a lost GPU context (long shift, device sleep/
        // wake, driver reset) leaves this page's canvas permanently blank and
        // frozen with no error and no recovery path.
        webglRecoveryCleanup = installWebglContextRecovery(map, {
          label: 'MapPage',
          onRebuild: (camera) => {
            pendingRestoreCameraRef.current = camera;
            setIsContextLost(false);
            cancelled = true;
            webglRecoveryCleanup?.();
            webglRecoveryCleanup = null;
            destroyMapboxMap(mapRef.current);
            mapRef.current = null;
            onRetryNonceRequest();
          },
          onContextLost: () => setIsContextLost(true),
          onContextRestored: () => setIsContextLost(false),
          onGiveUp: () => {
            setIsContextLost(false);
            setNeedsManualReload(true);
          },
        });

        map.on('error', (e) => {
          devWarn('[MapCore] map error', e);
          if (cancelled) return;

          const msg = e.error instanceof Error ? e.error.message : 'Mapbox map error';
          const status = (e.error as any)?.status;
          const msgLower = msg.toLowerCase();

          // Broad auth-error detection: catch 401, 403, style-fetch
          // failures, and common auth messages from Mapbox API.
          // NOTE: 'failed to fetch' is a network/CORS error, NOT an auth error —
          // triggering full fallback for transient network blips is wrong.
          const isNetworkErr =
            msgLower.includes('failed to fetch') ||
            msgLower.includes('networkerror') ||
            msgLower.includes('network request failed');

          const isAuthErr =
            status === 401 || status === 403 ||
            msgLower.includes('access token') ||
            msgLower.includes('not authorized') ||
            msgLower.includes('unauthorized') ||
            msgLower.includes('forbidden') ||
            msgLower.includes('invalid token') ||
            msgLower.includes('token is not authorized') ||
            msgLower.includes('not configured') ||
            msgLower.includes('error status 4');

          const isStyleErr = msgLower.includes('style not found') || msgLower.includes('style is not found');

          // A style/sprite/glyph fetch that returns HTML instead of JSON —
          // Mapbox's API itself always answers style requests with JSON (even
          // its error bodies), so this specific SyntaxError almost always
          // means the request to api.mapbox.com never reached Mapbox at all:
          // either the configured token is invalid/expired/domain-restricted
          // (Mapbox's CDN edge serves an HTML error page for some rejected
          // requests instead of the usual JSON 401), or something on this
          // network path (VPN, corporate proxy, ad-blocker) is intercepting
          // requests to api.mapbox.com. Neither classifies as isAuthErr
          // (no 401/403 status, no "unauthorized" keyword) or isNetworkErr
          // (no "failed to fetch") — without this it fell through to the
          // generic fatal-error branch and showed a raw, unhelpful
          // "Unexpected token '<'" SyntaxError to the officer.
          const isHtmlResponseErr =
            msgLower.includes('unexpected token') && msgLower.includes('doctype');

          if (isNetworkErr && !mapDidLoad) {
            // Network error during init — don't fall back immediately;
            // Mapbox GL retries tile fetches internally. Only log it.
            devLog('[MapCore] Network error during init (will retry):', msg);
            return;
          }

          // Style not found — retry with built-in dark style instead of
          // falling all the way back to MapLibre. Custom style may have
          // been deleted from the Mapbox account.
          if (isStyleErr && !mapDidLoad) {
            devLog('[MapCore] Custom style not found, retrying with default dark style');
            clearTimeout(loadTimeout);
            cancelled = true;
            setTimeout(() => {
              destroyMapboxMap(mapRef.current); mapRef.current = null;
              onStyleFallback('dark' as MapStyleId);
              onRetryNonceRequest();
            }, 0);
            return;
          }

          if (isAuthErr) {
            // Auth failure — defer destroy to next tick so Mapbox finishes
            // its error dispatch before we remove the map instance. Destroying
            // mid-callback leaves stale DOM in the container that blocks MapLibre.
            devLog('[MapCore] Mapbox auth error, activating MapLibre GL fallback');
            clearTimeout(loadTimeout);
            cancelled = true;
            setTimeout(() => { destroyMapboxMap(mapRef.current); mapRef.current = null; }, 0);
            setMapError(msg);
            setMapLibreFallback(true);
            setLoading(false);
            return;
          }

          // After successful load, ignore non-fatal errors (individual tile
          // fails, transient network blips) — Mapbox GL handles retries internally
          if (mapDidLoad) {
            devLog('[MapCore] Non-fatal post-load error (ignored):', msg);
            return;
          }

          // Fatal pre-load error (style fetch failed, GL context lost, etc.)
          // — fall back to MapLibre (defer destroy same as above)
          clearTimeout(loadTimeout);
          devLog('[MapCore] Mapbox init failed, activating MapLibre GL fallback');
          cancelled = true;
          setTimeout(() => { destroyMapboxMap(mapRef.current); mapRef.current = null; }, 0);
          setMapError(isHtmlResponseErr
            ? 'Mapbox returned an unexpected (non-JSON) response while loading the map style. This usually means the configured Mapbox token is invalid, expired, or domain-restricted — or a network filter (VPN, corporate proxy, ad-blocker) is blocking api.mapbox.com. Verify the token at account.mapbox.com/access-tokens and re-check Admin → Integrations → Mapbox.'
            : msg);
          setMapLibreFallback(true);
          setLoading(false);
        });
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to initialize Mapbox map';
          devLog('[MapCore] Mapbox init exception, activating MapLibre GL fallback');
          setMapError(msg);
          setMapLibreFallback(true);
          setLoading(false);
        }
      }
    }

    initMap();

    return () => {
      cancelled = true;
      webglRecoveryCleanup?.();
      webglRecoveryCleanup = null;
      destroyMapboxMap(mapRef.current);
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLibreFallback, retryNonce]); // rerun on retry or when fallback cleared

  const changeStyle = useCallback((styleId: MapStyleId) => {
    const map = mapRef.current;
    if (!map) return;
    activeStyleRef.current = styleId;
    // Pause all source/layer hooks while the new style loads — they guard on
    // mapLoaded, so setting it false prevents "Style is not done loading" throws.
    setMapLoaded(false);
    setMapboxStyle(map, styleId);
    map.once('style.load', () => {
      if (DARK_STYLES.includes(styleId)) addMapbox3DBuildings(map);
      if (terrainEnabled) addMapboxTerrain(map);
      setMapLoaded(true);
    });
  }, [terrainEnabled]);

  const daylight = useMapDaylight(mapRef.current, mapLoaded);
  const projection = useMapProjection(mapRef.current, mapLoaded);
  const atmosphere = useMapAtmosphere(mapRef.current, mapLoaded);
  const cameraAnimation = useMapCameraAnimation(mapRef.current, mapLoaded);
  const snapshot = useMapSnapshot();

  return {
    mapContainerRef, mapRef, mapLoaded, loading, mapError, mapLibreFallback,
    isContextLost, needsManualReload,
    changeStyle, token,
    daylight, projection, atmosphere, cameraAnimation, snapshot,
  };
}
