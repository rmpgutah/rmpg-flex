/**
 * MapboxMapPage.tsx — Mapbox GL JS-based operational map for RMPG Flex CAD/RMS.
 *
 * Renders when useMapProvider() selects 'mapbox'. Provides real-time unit tracking,
 * active call visualization, beat overlays, address search, and GPS self-positioning.
 *
 * Spillman Flex / Motorola Solutions pure black theme:
 *   #0a0a0a base · #141414 raised · #d4a017 gold accent · 2px radius everywhere
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css';
import type maplibregl from 'maplibre-gl';
import {
  Shield, AlertTriangle, Layers, MapPin, Navigation2,
  Eye, EyeOff, ChevronDown, ChevronUp, Loader2, RefreshCw,
  Map as MapIcon, PanelLeftClose, PanelLeftOpen, Crosshair, Mountain,
  Clock, Locate, Flame, Car, Ruler, Satellite, PenTool, Hexagon,
  Circle, Trash2, Undo2, Grid3X3, Sun, Route, Users, Info,
  Radio, Volume2, Footprints, MapPinned,
  Search, Compass, CloudRain, Star, Camera, Download, Clipboard,
  Navigation, Globe, Zap, Hash,
} from 'lucide-react';

import {
  createMapboxMap, destroyMapboxMap, setMapboxStyle,
  injectMapboxStyles, addMapbox3DBuildings,
  addMapboxTerrain, removeMapboxTerrain,
} from '../../utils/mapboxLoader';
import { getMapboxTokenStatus, getCachedMapboxStyleUrl } from '../../utils/mapboxApiKey';
import { createMap as createMapLibreMap } from '../../integrations/maplibreMap';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';
import { useWebSocket } from '../../context/WebSocketContext';
import { useGpsTracking } from '../../hooks/useGpsTracking';
import { useIsMobile } from '../../hooks/useIsMobile';
import { usePersistedState, usePersistedTab } from '../../hooks/usePersistedState';
import { useToast } from '../../components/ToastProvider';
import {
  MapUnit as Unit, ActiveCall, MapProperty as Property,
  UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS,
  MAP_STYLE_LABELS,
  type MapStyleId,
} from './utils/mapConstants';
import { formatIncidentType } from '../../utils/caseNumbers';
import { formatEnumValue } from '../../utils/formatters';
import { escapeHtml } from '../../utils/sanitize';
import { mapboxIsochrone, findNearestUnits } from '../../services/mapboxApiService';
import RmpgLogo from '../../components/RmpgLogo';
import IconButton from '../../components/IconButton';
import { devLog, devWarn } from '../../utils/devLog';
import { useMapDrawing, type DrawingMode } from '../../hooks/useMapDrawing';
import { useMapClustering } from '../../hooks/useMapClustering';
import { useMapHeatmap } from '../../hooks/useMapHeatmap';
import { useMapTraffic } from '../../hooks/useMapTraffic';
import { useMapMeasure, type MeasureMode } from '../../hooks/useMapMeasure';
import { useMapStreetView } from '../../hooks/useMapStreetView';
import { useMapBreadcrumbs } from '../../hooks/useMapBreadcrumbs';
import { useMapDaylight } from '../../hooks/useMapDaylight';
import { useMapGeofenceAlerts } from '../../hooks/useMapGeofenceAlerts';
import { useMapInfoPanel } from '../../hooks/useMapInfoPanel';
import { useAutoPanToP1 } from '../../hooks/useAutoPanToP1';
import { useP1AudioAlert } from '../../hooks/useP1AudioAlert';
import { useMapRouting } from '../../hooks/useMapRouting';
import { useMultiUnitRouting } from '../../hooks/useMultiUnitRouting';
import { useMapKeyboardShortcuts } from '../../hooks/useMapKeyboardShortcuts';
import { useMapPlacesSearch, PLACE_CATEGORIES } from '../../hooks/useMapPlacesSearch';
import { useMapDirectionsPanel } from '../../hooks/useMapDirectionsPanel';
import { useMapCoordinateGrid } from '../../hooks/useMapCoordinateGrid';
import { useMapWeatherRadar } from '../../hooks/useMapWeatherRadar';
import { useMapBookmarks } from '../../hooks/useMapBookmarks';
import { useMapPrintExport } from '../../hooks/useMapPrintExport';
import { useGeoJsonLayers, GEO_LAYER_CONFIGS } from '../../hooks/useGeoJsonLayers';
import { useMapFeatureInspect } from '../../hooks/useMapFeatureInspect';
import { useMapMatchTrace } from '../../hooks/useMapMatchTrace';
import { useMapProjection } from '../../hooks/useMapProjection';
import { useMapAtmosphere } from '../../hooks/useMapAtmosphere';
import { useMapCameraAnimation } from '../../hooks/useMapCameraAnimation';
import { useMapSnapshot } from '../../hooks/useMapSnapshot';
import { useMapOptimization } from '../../hooks/useMapOptimization';
import { initMapboxDeckOverlay, updateMapboxDeckLayers, destroyMapboxDeckOverlay, createMapboxIncidentLayer, createMapboxUnitLayer, createMapboxArcLayer } from '../../integrations/deckMapboxLayers';
import MapLayersPanel from './components/MapLayersPanel';
import type { LayerGroup } from './components/MapLayersPanel';

// ── Constants ──────────────────────────────────────────────────────────────────
const SLC_CENTER: [number, number] = [-111.891, 40.7608];
const DEFAULT_ZOOM = 12;
const REFRESH_INTERVAL_MS = 30_000;
const DARK_STYLES: MapStyleId[] = ['dark', 'night_nav'];

const HAZARD_FLAGS: { key: keyof ActiveCall; label: string; color: string }[] = [
  { key: 'officer_safety_caution', label: 'OFFICER SAFETY', color: '#ef4444' },
  { key: 'weapons_involved',       label: 'WEAPONS',        color: '#ef4444' },
  { key: 'felony_in_progress',     label: 'FELONY',         color: '#f97316' },
  { key: 'domestic_violence',      label: 'DV',             color: '#f59e0b' },
  { key: 'hazmat',                 label: 'HAZMAT',         color: '#f59e0b' },
  { key: 'mental_health_crisis',   label: 'MH CRISIS',     color: '#a855f7' },
  { key: 'gang_related',           label: 'GANG',           color: '#ef4444' },
];

// Inject GPS self-position pulse animation (module-scope, runs once)
if (typeof document !== 'undefined' && !document.getElementById('rmpg-pulse-css')) {
  const css = document.createElement('style');
  css.id = 'rmpg-pulse-css';
  css.textContent = `@keyframes rmpg-pulse{0%,100%{box-shadow:0 0 12px #3b82f680,0 0 24px #3b82f640}50%{box-shadow:0 0 20px #3b82f6b0,0 0 40px #3b82f670}}`;
  document.head.appendChild(css);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build HTML for a unit marker element. */
function buildUnitMarkerEl(unit: Unit): HTMLDivElement {
  const color = UNIT_STATUS_COLORS[unit.status] || '#888888';
  const el = document.createElement('div');
  el.className = 'rmpg-mbx-unit';
  el.style.cssText = `
    width:32px;height:32px;border-radius:2px;
    background:${color};border:2px solid #d4a017;
    display:flex;align-items:center;justify-content:center;
    font-size:9px;font-weight:700;color:#fff;
    font-family:ui-monospace,monospace;cursor:pointer;
    box-shadow:0 0 6px ${color}80;
    transition:box-shadow .2s;
  `;
  el.textContent = unit.call_sign.slice(0, 4);
  el.title = `${unit.call_sign} — ${UNIT_STATUS_LABELS[unit.status] || unit.status}`;
  return el;
}

/** Build HTML popup content for a unit. */
function buildUnitPopupHtml(unit: Unit): string {
  const color = UNIT_STATUS_COLORS[unit.status] || '#888888';
  const statusLabel = UNIT_STATUS_LABELS[unit.status] || unit.status;
  const callInfo = unit.current_call_type
    ? `<div style="margin-top:4px;border-top:1px solid #222;padding-top:4px;">
         <div style="color:#d4a017;font-size:9px;">ASSIGNED CALL</div>
         <div>${escapeHtml(unit.call_number)} — ${escapeHtml(formatIncidentType(unit.current_call_type))}</div>
         <div style="color:#888;">${escapeHtml(unit.current_call_location)}</div>
       </div>`
    : '';
  return `
    <div style="background:#141414;color:#e0e0e0;padding:8px 12px;border:1px solid #222;border-radius:2px;font-family:system-ui,sans-serif;font-size:11px;min-width:160px;">
      <div style="font-weight:700;color:#d4a017;margin-bottom:2px;font-size:12px;">${escapeHtml(unit.call_sign)}</div>
      <div>${escapeHtml(unit.officer_name)}</div>
      <div>Status: <span style="color:${color};font-weight:600;">${escapeHtml(statusLabel)}</span></div>
      ${unit.vehicle ? `<div style="color:#888;">Vehicle: ${escapeHtml(unit.vehicle)}</div>` : ''}
      ${callInfo}
    </div>`;
}

/** Build HTML for a call marker element. */
function buildCallMarkerEl(call: ActiveCall): HTMLDivElement {
  const color = PRIORITY_COLORS[call.priority] || '#888888';
  const el = document.createElement('div');
  el.className = 'rmpg-mbx-call';
  el.style.cssText = `
    width:22px;height:22px;
    background:${color};border:2px solid ${color};
    transform:rotate(45deg);border-radius:2px;
    display:flex;align-items:center;justify-content:center;
    cursor:pointer;box-shadow:0 0 8px ${color}99;
  `;
  const inner = document.createElement('span');
  inner.style.cssText = `transform:rotate(-45deg);font-size:8px;font-weight:700;color:#fff;font-family:ui-monospace,monospace;`;
  inner.textContent = `P${call.priority}`;
  el.appendChild(inner);
  el.title = `${call.call_number} — ${formatIncidentType(call.incident_type)}`;
  return el;
}

/** Build HTML popup for a call. */
function buildCallPopupHtml(call: ActiveCall): string {
  const color = PRIORITY_COLORS[call.priority] || '#888888';
  const flags = HAZARD_FLAGS
    .filter(f => call[f.key])
    .map(f => `<span style="background:${f.color}22;color:${f.color};padding:1px 4px;border-radius:2px;font-size:8px;font-weight:700;margin-right:3px;">${f.label}</span>`)
    .join('');
  return `
    <div style="background:#141414;color:#e0e0e0;padding:8px 12px;border:1px solid #222;border-radius:2px;font-family:system-ui,sans-serif;font-size:11px;min-width:180px;">
      <div style="font-weight:700;color:${color};margin-bottom:2px;font-size:12px;">${escapeHtml(call.call_number)}</div>
      <div style="font-weight:600;">${escapeHtml(formatIncidentType(call.incident_type))}</div>
      <div>Priority: <span style="color:${color};font-weight:700;">P${escapeHtml(call.priority)}</span></div>
      <div>Status: ${escapeHtml(formatEnumValue(call.status))}</div>
      <div style="color:#888;margin-top:2px;">${escapeHtml(call.location_address)}</div>
      ${call.cross_street ? `<div style="color:#666;font-size:10px;">X: ${escapeHtml(call.cross_street)}</div>` : ''}
      ${call.beat_name ? `<div style="color:#666;font-size:10px;">Beat: ${escapeHtml(call.beat_name)}</div>` : ''}
      ${flags ? `<div style="margin-top:4px;">${flags}</div>` : ''}
    </div>`;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface MapboxMapPageProps {
  preferredEngine?: 'mapbox' | 'maplibre';
}

export default function MapboxMapPage({ preferredEngine = 'mapbox' }: MapboxMapPageProps) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [units, setUnits]           = useState<Unit[]>([]);
  const [calls, setCalls]           = useState<ActiveCall[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading]       = useState(true);
  const [mapError, setMapError]     = useState<string | null>(null);
  const [mapLoaded, setMapLoaded]   = useState(false);
  const [mapLibreFallback, setMapLibreFallback] = useState(preferredEngine === 'maplibre');
  const [retryNonce, setRetryNonce] = useState(0);

  const [sidebarOpen, setSidebarOpen]   = usePersistedState('rmpg_mapbox_sidebar_open', true);
  const [activeTab, setActiveTab]       = usePersistedTab('rmpg_mapbox_sidebar', 'units', ['units', 'calls'] as const);
  const [mapStyle, setMapStyleId]       = usePersistedState<MapStyleId>('rmpg_mapbox_style', 'dark');
  const [beatsVisible, setBeatsVisible] = usePersistedState('rmpg_mapbox_beats', true);
  // searchQuery/searchResults state removed — MapboxGeocoder handles this internally
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  const [selfPosVisible, setSelfPosVisible] = usePersistedState('rmpg_mapbox_self_pos', true);
  const [terrainEnabled, setTerrainEnabled] = usePersistedState('rmpg_mapbox_terrain', false);
  const [isochroneEnabled, setIsochroneEnabled] = useState(false);
  const [nearestUnitInfo, setNearestUnitInfo] = useState<string | null>(null);
  const [showAdvancedToolbar, setShowAdvancedToolbar] = useState(false);
  const [showDrawMenu, setShowDrawMenu] = useState(false);
  const [showMeasureMenu, setShowMeasureMenu] = useState(false);
  const geocoderRef = useRef<MapboxGeocoder | null>(null);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const mapContainerRef  = useRef<HTMLDivElement>(null);
  const mapRef           = useRef<mapboxgl.Map | null>(null);
  const mapLibreRef      = useRef<maplibregl.Map | null>(null);
  const unitMarkersRef   = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const callMarkersRef   = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const selfMarkerRef    = useRef<mapboxgl.Marker | null>(null);
  const tokenRef         = useRef<string | null>(null);
  const refreshTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  // searchTimeoutRef removed — geocoder plugin handles debounce internally

  // ── Hooks ──────────────────────────────────────────────────────────────────
  const isMobile    = useIsMobile();
  const { addToast } = useToast();
  const { isConnected, subscribe } = useWebSocket();

  // ── Advanced Map Feature Hooks ─────────────────────────────────────────────
  const drawing = useMapDrawing(mapRef.current, mapLoaded);
  const clustering = useMapClustering(mapRef.current, mapLoaded);
  const heatmap = useMapHeatmap(mapRef.current, mapLoaded);
  const traffic = useMapTraffic(mapRef.current, mapLoaded);
  const measure = useMapMeasure(mapRef.current, mapLoaded);
  const streetView = useMapStreetView(mapRef.current, mapLoaded);
  const gps = useGpsTracking();

  // ── Google Maps Parity Hooks ──────────────────────────────────────────────
  const unitColorMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of units) m[u.id] = UNIT_STATUS_COLORS[u.status] || '#888';
    return m;
  }, [units]);
  const unitIds = useMemo(() => units.map(u => u.id), [units]);
  const breadcrumbs = useMapBreadcrumbs(mapRef.current, mapLoaded, unitIds, unitColorMap);
  const daylight = useMapDaylight(mapRef.current, mapLoaded);
  const geofenceAlerts = useMapGeofenceAlerts(mapRef.current, mapLoaded);
  const infoPanel = useMapInfoPanel(mapRef.current, mapLoaded, units, calls);
  const routing = useMapRouting({ map: mapRef.current });
  const multiRouting = useMultiUnitRouting({ map: mapRef.current });
  const placesSearch = useMapPlacesSearch(mapRef.current, mapLoaded);
  const directionsPanel = useMapDirectionsPanel(mapRef.current, mapLoaded);
  const coordGrid = useMapCoordinateGrid(mapRef.current, mapLoaded);
  const weatherRadar = useMapWeatherRadar(mapRef.current, mapLoaded);
  const mapBookmarks = useMapBookmarks(mapRef.current, mapLoaded);
  const printExport = useMapPrintExport(mapRef.current, mapLoaded);
  const geoJsonLayers = useGeoJsonLayers({ map: mapRef.current });
  const featureInspect = useMapFeatureInspect(mapRef.current, mapLoaded);
  const mapMatchTrace = useMapMatchTrace(mapRef.current, mapLoaded);
  const projection = useMapProjection(mapRef.current, mapLoaded);
  const atmosphere = useMapAtmosphere(mapRef.current, mapLoaded);
  const cameraAnimation = useMapCameraAnimation(mapRef.current, mapLoaded);
  const snapshot = useMapSnapshot();
  const optimization = useMapOptimization(mapRef.current, mapLoaded);
  const [deckEnabled, setDeckEnabled] = usePersistedState('rmpg_mapbox_deck', false);
  const [buildings3dEnabled, setBuildings3dEnabled] = usePersistedState('rmpg_mapbox_3d_buildings', true);
  const [showPlacesMenu, setShowPlacesMenu] = useState(false);
  const [showDirectionsPanel, setShowDirectionsPanel] = useState(false);
  const [showWeatherMenu, setShowWeatherMenu] = useState(false);
  const [showBookmarksPanel, setShowBookmarksPanel] = useState(false);
  const [showGeoLayersMenu, setShowGeoLayersMenu] = useState(false);
  const [autoPanEnabled, setAutoPanEnabled] = usePersistedState('rmpg_mapbox_autopan_p1', true);
  const [p1AudioEnabled, setP1AudioEnabled] = usePersistedState('rmpg_mapbox_p1_audio', true);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);

  // Auto-pan to new P1 calls
  useAutoPanToP1(mapRef.current, calls, { enabled: autoPanEnabled });

  // P1 audio alert chirp
  useP1AudioAlert(calls, { enabled: p1AudioEnabled });

  // Keyboard shortcuts for map overlays
  useMapKeyboardShortcuts({
    toggleHeatmap: () => {
      if (!heatmap.enabled) {
        const heatPts = calls
          .filter(c => c.latitude != null && c.longitude != null)
          .map(c => ({ longitude: c.longitude!, latitude: c.latitude!, weight: c.priority === '1' ? 1 : c.priority === '2' ? 0.7 : 0.4 }));
        heatmap.updatePoints(heatPts);
      }
      heatmap.toggle();
    },
    toggleBreadcrumbs: () => breadcrumbs.toggle(),
    toggleClustering: () => {
      if (!clustering.enabled) {
        const clPts = calls
          .filter(c => c.latitude != null && c.longitude != null)
          .map(c => ({ id: c.id, longitude: c.longitude!, latitude: c.latitude!, priority: c.priority, label: c.call_number, color: PRIORITY_COLORS[c.priority] || '#888' }));
        clustering.updatePoints(clPts);
      }
      clustering.toggle();
    },
    toggleDaylight: () => daylight.toggle(),
    toggleGrid: () => coordGrid.toggle(),
  });

  // ── Deck.gl GPU Overlay ────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (deckEnabled) {
      initMapboxDeckOverlay(map);

      const incidents = calls
        .filter(c => c.latitude != null && c.longitude != null)
        .map(c => ({
          id: c.id,
          position: [c.longitude!, c.latitude!] as [number, number],
          priority: c.priority,
          weight: c.priority === '1' ? 1 : c.priority === '2' ? 0.7 : 0.4,
        }));

      const unitPositions = units
        .filter(u => u.latitude != null && u.longitude != null)
        .map(u => ({
          id: u.id,
          position: [u.longitude!, u.latitude!] as [number, number],
          status: u.status,
          callSign: u.call_sign,
        }));

      const arcs = units
        .filter(u => u.latitude != null && u.longitude != null && u.current_call_type)
        .map(u => {
          const call = calls.find(c => c.call_number === u.call_number);
          if (!call || call.latitude == null || call.longitude == null) return null;
          return {
            source: [u.longitude!, u.latitude!] as [number, number],
            target: [call.longitude!, call.latitude!] as [number, number],
          };
        })
        .filter(Boolean) as any[];

      const layers = [
        createMapboxIncidentLayer(incidents),
        createMapboxUnitLayer(unitPositions),
        ...(arcs.length > 0 ? [createMapboxArcLayer(arcs)] : []),
      ];
      updateMapboxDeckLayers(layers);
    } else {
      destroyMapboxDeckOverlay();
    }

    return () => { if (!deckEnabled) destroyMapboxDeckOverlay(); };
  }, [deckEnabled, mapLoaded, calls, units]);

  // ── Data Fetching ──────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [u, c, p] = await Promise.all([
        apiFetch<Unit[]>('/dispatch/units'),
        apiFetch<ActiveCall[]>('/dispatch/queue'),
        apiFetch<Property[]>('/records/properties'),
      ]);
      setUnits(u);
      setCalls(c);
      setProperties(p);
    } catch (err) {
      devWarn('[MapboxMap] data fetch failed', err);
    }
  }, []);

  const silentRefresh = useCallback(() => { fetchData(); }, [fetchData]);

  useLiveSync('dispatch', silentRefresh);

  // ── Map Initialization ─────────────────────────────────────────────────────

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

     async function initMap() {
      try {
        // Timeout token fetch to avoid infinite hang if server is unreachable
        const tokenStatusPromise = getMapboxTokenStatus(retryNonce > 0);
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000));
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
          devLog('[MapboxMap] Mapbox token unavailable, activating MapLibre GL fallback', tokenStatus);
          setMapLibreFallback(true);
          setLoading(false);
          return;
        }
        tokenRef.current = tokenStatus.token;
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

        const map = createMapboxMap({
          container: mapContainerRef.current,
          accessToken: tokenStatus.token,
          style: mapStyle,
          customStyleUrl: getCachedMapboxStyleUrl() || undefined,
          center: SLC_CENTER,
          zoom: DEFAULT_ZOOM,
        });
        mapRef.current = map;

        // Track whether the map has successfully loaded at least once.
        // Individual tile/source errors after successful load should NOT
        // trigger full MapLibre fallback — only fatal init errors should.
        let mapDidLoad = false;

        // Timeout map load to prevent infinite "Initializing" state
        const loadTimeout = setTimeout(() => {
          if (!cancelled && !mapRef.current?.loaded()) {
            devWarn('[MapboxMap] map load timed out after 15s');
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
          loadBeatOverlay(map);
          setMapLoaded(true);
          setLoading(false);
          devLog('[MapboxMap] map loaded');
        });

        map.on('error', (e) => {
          devWarn('[MapboxMap] map error', e);
          if (cancelled) return;

          const msg = e.error?.message || 'Mapbox map error';
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
            msgLower.includes('style not found') ||
            msgLower.includes('error status 4');

          if (isNetworkErr && !mapDidLoad) {
            // Network error during init — don't fall back immediately;
            // Mapbox GL retries tile fetches internally. Only log it.
            devLog('[MapboxMap] Network error during init (will retry):', msg);
            return;
          }

          if (isAuthErr) {
            // Auth failure — defer destroy to next tick so Mapbox finishes
            // its error dispatch before we remove the map instance. Destroying
            // mid-callback leaves stale DOM in the container that blocks MapLibre.
            devLog('[MapboxMap] Mapbox auth error, activating MapLibre GL fallback');
            clearTimeout(loadTimeout);
            cancelled = true;
            setTimeout(() => { destroyMapboxMap(); mapRef.current = null; }, 0);
            setMapError(msg);
            setMapLibreFallback(true);
            setLoading(false);
            return;
          }

          // After successful load, ignore non-fatal errors (individual tile
          // fails, transient network blips) — Mapbox GL handles retries internally
          if (mapDidLoad) {
            devLog('[MapboxMap] Non-fatal post-load error (ignored):', msg);
            return;
          }

          // Fatal pre-load error (style fetch failed, GL context lost, etc.)
          // — fall back to MapLibre (defer destroy same as above)
          clearTimeout(loadTimeout);
          devLog('[MapboxMap] Mapbox init failed, activating MapLibre GL fallback');
          cancelled = true;
          setTimeout(() => { destroyMapboxMap(); mapRef.current = null; }, 0);
          setMapError(msg);
          setMapLibreFallback(true);
          setLoading(false);
        });
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to initialize Mapbox map';
          devLog('[MapboxMap] Mapbox init exception, activating MapLibre GL fallback');
          setMapError(msg);
          setMapLibreFallback(true);
          setLoading(false);
        }
      }
    }

    initMap();

    return () => {
      cancelled = true;
      destroyMapboxMap();
      mapRef.current = null;
      unitMarkersRef.current.forEach(m => m.remove());
      unitMarkersRef.current.clear();
      callMarkersRef.current.forEach(m => m.remove());
      callMarkersRef.current.clear();
      selfMarkerRef.current?.remove();
      geocoderRef.current = null;
    };
   // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [mapLibreFallback, retryNonce]); // rerun on retry or when fallback cleared

  // ── MapLibre GL Fallback ──────────────────────────────────────────────────

  useEffect(() => {
    if (!mapLibreFallback || !mapContainerRef.current) return;

    // Clean stale Mapbox DOM from the container before MapLibre init.
    // mapboxgl.Map.remove() can leave residual child nodes/classes that
    // prevent MapLibre from properly attaching its canvas.
    const container = mapContainerRef.current;
    while (container.firstChild) container.removeChild(container.firstChild);
    container.className = container.className
      .replace(/mapboxgl-[\w-]+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    // Re-apply the required positioning class stripped above
    if (!container.classList.contains('absolute')) container.classList.add('absolute');

    // Small delay to let any deferred Mapbox cleanup settle
    const initDelay = setTimeout(() => {
      if (!mapContainerRef.current) return;

      devLog('[MapLibreFallback] Initializing MapLibre GL fallback map');
      const map = createMapLibreMap({ container: mapContainerRef.current });
      mapLibreRef.current = map;

      let tilesLoaded = false;

      // Tile load timeout — if CartoDB tiles don't load in 12s,
      // the user likely has no internet. Show a meaningful message.
      const tileTimeout = setTimeout(() => {
        if (!tilesLoaded) {
          devWarn('[MapLibreFallback] Tile load timed out (12s)');
          // Still set mapLoaded so the sidebar/controls are usable
          setMapLoaded(true);
        }
      }, 12_000);

      map.on('load', () => {
        tilesLoaded = true;
        clearTimeout(tileTimeout);
        devLog('[MapLibreFallback] MapLibre map loaded');
        setMapLoaded(true);

        // Load beat overlay on MapLibre map
        fetch('/beats.geojson')
          .then(r => r.ok ? r.json() : null)
          .then(geojson => {
            if (!geojson || !map.getStyle()) return;
            try {
              map.addSource('beats', { type: 'geojson', data: geojson });
              map.addLayer({
                id: 'beats-fill', type: 'fill', source: 'beats',
                paint: { 'fill-color': '#d4a017', 'fill-opacity': 0.05 },
              });
              map.addLayer({
                id: 'beats-border', type: 'line', source: 'beats',
                paint: { 'line-color': '#d4a017', 'line-width': 1, 'line-opacity': 0.4 },
              });
            } catch { /* beats layer optional */ }
          })
          .catch(() => { /* beats layer optional */ });
      });

      // Detect CartoDB tile failures
      map.on('error', (e) => {
        devWarn('[MapLibreFallback] MapLibre error:', e.error?.message || e);
      });
    }, 50);

    return () => {
      clearTimeout(initDelay);
      if (mapLibreRef.current) {
        try { mapLibreRef.current.remove(); } catch { /* safe */ }
        mapLibreRef.current = null;
      }
    };
  }, [mapLibreFallback]);

  // ── MapLibre Fallback: Unit & Call Markers ─────────────────────────────────

  const mapLibreMarkersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!mapLibreFallback || !mapLibreRef.current) return;
    // Dynamic import for MapLibre marker support
    import('maplibre-gl').then(({ Marker, Popup }) => {
      // Clear old markers
      mapLibreMarkersRef.current.forEach(m => m.remove());
      mapLibreMarkersRef.current = [];

      const map = mapLibreRef.current;
      if (!map) return;

      // Unit markers
      for (const u of units) {
        if (u.latitude == null || u.longitude == null) continue;
        const statusColor = UNIT_STATUS_COLORS[u.status] || '#888';
        const marker = new Marker({ color: statusColor })
          .setLngLat([u.longitude, u.latitude])
          .setPopup(new Popup({ offset: 12 }).setHTML(
            `<div style="color:#000;font-size:12px;"><strong>${escapeHtml(u.call_sign)}</strong><br>${escapeHtml(u.status)}</div>`
          ))
          .addTo(map);
        mapLibreMarkersRef.current.push(marker);
      }

      // Call markers
      for (const c of calls) {
        if (c.latitude == null || c.longitude == null) continue;
        const prioColor = PRIORITY_COLORS[c.priority] || '#888';
        const marker = new Marker({ color: prioColor, scale: 0.7 })
          .setLngLat([c.longitude, c.latitude])
          .setPopup(new Popup({ offset: 12 }).setHTML(
            `<div style="color:#000;font-size:12px;"><strong>${escapeHtml(c.incident_type || 'Unknown')}</strong><br>P${escapeHtml(String(c.priority))}</div>`
          ))
          .addTo(map);
        mapLibreMarkersRef.current.push(marker);
      }
    }).catch(() => { /* MapLibre markers are optional */ });

    return () => {
      mapLibreMarkersRef.current.forEach(m => m.remove());
      mapLibreMarkersRef.current = [];
    };
  }, [mapLibreFallback, units, calls]);

  // ── Retry Mapbox handler ──────────────────────────────────────────────────

  const retryMapbox = useCallback(() => {
    // Clean up MapLibre fallback
    if (mapLibreRef.current) {
      try { mapLibreRef.current.remove(); } catch { /* map may not have fully initialized */ }
      mapLibreRef.current = null;
    }
    mapLibreMarkersRef.current.forEach(m => m.remove());
    mapLibreMarkersRef.current = [];

    // Reset state to trigger Mapbox re-init
    setMapLibreFallback(false);
    setMapError(null);
    setMapLoaded(false);
    setLoading(true);

    // Trigger in-component re-init without full page reload
    setRetryNonce((n) => n + 1);
  }, []);

  // ── Beat GeoJSON Overlay ───────────────────────────────────────────────────

  const loadBeatOverlay = useCallback(async (map: mapboxgl.Map) => {
    try {
      const resp = await fetch('/beats.geojson');
      if (!resp.ok) { devWarn('[MapboxMap] beats.geojson not found'); return; }
      const geojson = await resp.json();

      // Remove existing beat layers/source if present (e.g. after style change)
      ['beats-label', 'beats-border', 'beats-fill'].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource('beats')) map.removeSource('beats');

      map.addSource('beats', { type: 'geojson', data: geojson });

      map.addLayer({
        id: 'beats-fill',
        type: 'fill',
        source: 'beats',
        paint: {
          'fill-color': '#d4a017',
          'fill-opacity': 0.04,
        },
      });

      map.addLayer({
        id: 'beats-border',
        type: 'line',
        source: 'beats',
        paint: {
          'line-color': '#d4a017',
          'line-opacity': 0.35,
          'line-width': 1,
        },
      });

      map.addLayer({
        id: 'beats-label',
        type: 'symbol',
        source: 'beats',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 10,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#d4a017',
          'text-opacity': 0.5,
          'text-halo-color': '#000',
          'text-halo-width': 1,
        },
        minzoom: 13,
      });

      devLog('[MapboxMap] beat overlay added');
    } catch (err) {
      devWarn('[MapboxMap] beat overlay failed', err);
    }
  }, []);

  // Toggle beat visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const vis = beatsVisible ? 'visible' : 'none';
    ['beats-fill', 'beats-border', 'beats-label'].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    });
  }, [beatsVisible, mapLoaded]);

  // Toggle 3D buildings
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (buildings3dEnabled) {
      addMapbox3DBuildings(map);
    } else {
      if (map.getLayer('3d-buildings')) map.removeLayer('3d-buildings');
    }
  }, [buildings3dEnabled, mapLoaded]);

  // Toggle 3D terrain
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (terrainEnabled) {
      addMapboxTerrain(map);
    } else {
      removeMapboxTerrain(map);
    }
  }, [terrainEnabled, mapLoaded]);

  // ── Data Fetch + Auto-Refresh ──────────────────────────────────────────────

  useEffect(() => {
    fetchData();
    refreshTimerRef.current = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); };
  }, [fetchData]);

  // ── WebSocket Subscriptions ────────────────────────────────────────────────

  useEffect(() => {
    const unsub1 = subscribe('unit_update', () => { fetchData(); });
    const unsub2 = subscribe('dispatch_update', () => { fetchData(); });
    return () => { unsub1(); unsub2(); };
  }, [subscribe, fetchData]);

  // ── Unit Markers ───────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const currentIds = new Set<string>();

    for (const unit of units) {
      if (unit.latitude == null || unit.longitude == null) continue;
      currentIds.add(unit.id);

      const existing = unitMarkersRef.current.get(unit.id);
      if (existing) {
        existing.setLngLat([unit.longitude, unit.latitude]);
        const popup = existing.getPopup();
        if (popup) popup.setHTML(buildUnitPopupHtml(unit));
        // Update marker color
        const el = existing.getElement();
        const color = UNIT_STATUS_COLORS[unit.status] || '#888888';
        el.style.background = color;
        el.style.boxShadow = `0 0 6px ${color}80`;
        el.textContent = unit.call_sign.slice(0, 4);
      } else {
        const el = buildUnitMarkerEl(unit);
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([unit.longitude, unit.latitude])
          .setPopup(
            new mapboxgl.Popup({ offset: 18, closeButton: false, className: 'mapbox-popup-dark' })
              .setHTML(buildUnitPopupHtml(unit))
          )
          .addTo(map);
        unitMarkersRef.current.set(unit.id, marker);
      }
    }

    // Remove stale markers
    unitMarkersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        unitMarkersRef.current.delete(id);
      }
    });
  }, [units, mapLoaded]);

  // ── Call Markers ───────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const currentIds = new Set<string>();

    for (const call of calls) {
      if (call.latitude == null || call.longitude == null) continue;
      currentIds.add(call.id);

      const existing = callMarkersRef.current.get(call.id);
      if (existing) {
        existing.setLngLat([call.longitude, call.latitude]);
        const popup = existing.getPopup();
        if (popup) popup.setHTML(buildCallPopupHtml(call));
      } else {
        const el = buildCallMarkerEl(call);
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([call.longitude, call.latitude])
          .setPopup(
            new mapboxgl.Popup({ offset: 16, closeButton: false, className: 'mapbox-popup-dark' })
              .setHTML(buildCallPopupHtml(call))
          )
          .addTo(map);
        callMarkersRef.current.set(call.id, marker);
      }
    }

    callMarkersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        callMarkersRef.current.delete(id);
      }
    });
  }, [calls, mapLoaded]);

  // ── Self-Position (GPS Blue Dot) ───────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (!selfPosVisible || gps.latitude == null || gps.longitude == null) {
      selfMarkerRef.current?.remove();
      selfMarkerRef.current = null;
      return;
    }

    if (selfMarkerRef.current) {
      selfMarkerRef.current.setLngLat([gps.longitude, gps.latitude]);
    } else {
      const el = document.createElement('div');
      el.className = 'rmpg-mbx-self';
      el.style.cssText = `
        width:16px;height:16px;border-radius:50%;
        background:#3b82f6;border:3px solid #fff;
        box-shadow:0 0 12px #3b82f680, 0 0 24px #3b82f640;
        animation:rmpg-pulse 2s ease-in-out infinite;
      `;

      selfMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([gps.longitude, gps.latitude])
        .addTo(map);
    }
  }, [gps.latitude, gps.longitude, selfPosVisible, mapLoaded]);

  // ── Map Style Switch ───────────────────────────────────────────────────────

  const handleStyleChange = useCallback((styleId: MapStyleId) => {
    const map = mapRef.current;
    if (!map) return;
    setMapboxStyle(map, styleId);
    setMapStyleId(styleId);
    setShowStyleMenu(false);

    // Re-add 3D buildings for dark styles after style loads
    map.once('style.load', () => {
      if (DARK_STYLES.includes(styleId)) addMapbox3DBuildings(map);
      // Re-add beat overlay (GeoJSON is local, doesn't need token)
      loadBeatOverlay(map);
      // Re-apply 3D terrain if it was enabled before the style switch
      if (terrainEnabled) addMapboxTerrain(map);
    });
  }, [setMapStyleId, loadBeatOverlay, terrainEnabled]);

  // ── Mapbox GL Geocoder Control (replaces custom address search) ─────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || mapLibreFallback) return;
    const token = tokenRef.current;
    if (!token) return;

    // Don't double-add
    if (geocoderRef.current) return;

    const geocoder = new MapboxGeocoder({
      accessToken: token,
      mapboxgl: mapboxgl as any,
      marker: true,
      placeholder: 'Search address…',
      proximity: { longitude: SLC_CENTER[0], latitude: SLC_CENTER[1] },
      countries: 'US',
      limit: 5,
      collapsed: false,
      clearOnBlur: false,
      flyTo: { speed: 1.4, zoom: 16 },
    });

    map.addControl(geocoder, 'top-left');
    geocoderRef.current = geocoder;

    return () => {
      try { map.removeControl(geocoder); } catch { /* map may already be destroyed */ }
      geocoderRef.current = null;
    };
  }, [mapLoaded, mapLibreFallback]);

  // ── Sidebar Interactions ───────────────────────────────────────────────────

  const flyToUnit = useCallback((unit: Unit) => {
    const map = mapRef.current;
    if (!map || unit.latitude == null || unit.longitude == null) return;
    map.flyTo({ center: [unit.longitude, unit.latitude], zoom: 16, duration: 800 });
    // Open popup
    const marker = unitMarkersRef.current.get(unit.id);
    if (marker) marker.togglePopup();
  }, []);

  const flyToCall = useCallback((call: ActiveCall) => {
    const map = mapRef.current;
    if (!map || call.latitude == null || call.longitude == null) return;
    map.flyTo({ center: [call.longitude, call.latitude], zoom: 16, duration: 800 });
    const marker = callMarkersRef.current.get(call.id);
    if (marker) marker.togglePopup();
  }, []);

  const flyToSelf = useCallback(() => {
    const map = mapRef.current;
    if (!map || gps.latitude == null || gps.longitude == null) {
      addToast('GPS position not available', 'warning');
      return;
    }
    map.flyTo({ center: [gps.longitude, gps.latitude], zoom: 16, duration: 800 });
  }, [gps.latitude, gps.longitude, addToast]);

  // ── Isochrone Overlay ──────────────────────────────────────────────────────

  const toggleIsochrone = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (isochroneEnabled) {
      // Remove existing isochrone layers
      ['isochrone-fill-0', 'isochrone-fill-1', 'isochrone-fill-2',
       'isochrone-border-0', 'isochrone-border-1', 'isochrone-border-2'].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource('isochrone')) map.removeSource('isochrone');
      setIsochroneEnabled(false);
      return;
    }

    // Use GPS position or map center as origin
    const lng = gps.longitude ?? map.getCenter().lng;
    const lat = gps.latitude ?? map.getCenter().lat;

    try {
      const data = await mapboxIsochrone(lng, lat, {
        profile: 'driving',
        minutes: [5, 10, 15],
      });

      if (map.getSource('isochrone')) {
        (map.getSource('isochrone') as mapboxgl.GeoJSONSource).setData(data as any);
      } else {
        map.addSource('isochrone', { type: 'geojson', data: data as any });
      }

      const colors = ['#22c55e', '#f59e0b', '#ef4444']; // 5min=green, 10min=yellow, 15min=red
      data.features.forEach((_, idx) => {
        const fillId = `isochrone-fill-${idx}`;
        const borderId = `isochrone-border-${idx}`;
        if (!map.getLayer(fillId)) {
          map.addLayer({
            id: fillId,
            type: 'fill',
            source: 'isochrone',
            paint: { 'fill-color': colors[idx] || '#888', 'fill-opacity': 0.1 },
            filter: ['==', ['get', 'contour'], (idx + 1) * 5],
          });
        }
        if (!map.getLayer(borderId)) {
          map.addLayer({
            id: borderId,
            type: 'line',
            source: 'isochrone',
            paint: { 'line-color': colors[idx] || '#888', 'line-width': 1.5, 'line-opacity': 0.6 },
            filter: ['==', ['get', 'contour'], (idx + 1) * 5],
          });
        }
      });

      setIsochroneEnabled(true);
      addToast('Response time zones: 5/10/15 min driving', 'info');
    } catch (err) {
      addToast('Failed to load isochrone data', 'error');
    }
  }, [mapLoaded, isochroneEnabled, gps.longitude, gps.latitude, addToast]);

  // ── Layers Panel Groups ────────────────────────────────────────────────────

  const layerGroups = useMemo<LayerGroup[]>(() => [
    {
      id: 'operational',
      label: 'Operational Overlays',
      layers: [
        { id: 'heatmap', label: 'Crime Heatmap', enabled: heatmap.enabled, onToggle: heatmap.toggle, color: '#ef4444', description: 'Incident density (H)' },
        { id: 'traffic', label: 'Live Traffic', enabled: traffic.enabled, onToggle: traffic.toggle, color: '#22c55e', description: 'Real-time congestion' },
        { id: 'breadcrumbs', label: 'Unit Trails', enabled: breadcrumbs.enabled, onToggle: breadcrumbs.toggle, color: '#3b82f6', description: 'GPS history (B)' },
        { id: 'clustering', label: 'Call Clusters', enabled: clustering.enabled, onToggle: clustering.toggle, color: '#d4a017', description: 'Group markers (C)' },
        { id: 'daylight', label: 'Day/Night', enabled: daylight.enabled, onToggle: daylight.toggle, color: '#f59e0b', description: 'Solar terminator (D)' },
        { id: 'geofences', label: 'Geofence Zones', enabled: geofenceAlerts.enabled, onToggle: geofenceAlerts.toggle, color: '#ef4444', description: 'Premise alerts on click' },
        { id: 'isochrone', label: 'Response Zones', enabled: isochroneEnabled, onToggle: toggleIsochrone, color: '#22c55e', description: '5/10/15 min driving' },
        { id: 'weather', label: 'Weather Radar', enabled: weatherRadar.enabled, onToggle: weatherRadar.toggle, color: '#3b82f6', description: 'Precipitation overlay' },
        { id: 'grid', label: 'Coordinate Grid', enabled: coordGrid.enabled, onToggle: coordGrid.toggle, color: '#d4a017', description: 'Lat/Lng graticule (G)' },
        { id: 'deck', label: 'GPU Overlay', enabled: deckEnabled, onToggle: () => setDeckEnabled((v: boolean) => !v), color: '#a855f7', description: 'Deck.gl accelerated' },
        { id: 'streetview', label: 'Street View', enabled: streetView.enabled, onToggle: streetView.toggle, color: '#14b8a6', description: 'Click to open street view' },
        { id: 'inspect', label: 'Feature Inspector', enabled: featureInspect.enabled, onToggle: featureInspect.toggle, color: '#8b5cf6', description: 'Click features for details' },
        { id: 'mapmatch', label: 'Map Match Trace', enabled: mapMatchTrace.collecting, onToggle: () => mapMatchTrace.collecting ? mapMatchTrace.clear() : mapMatchTrace.startCollecting(), color: '#fb923c', description: 'Snap GPS to roads' },
      ],
    },
    {
      id: 'geojson',
      label: 'GeoJSON Overlays',
      layers: geoJsonLayers.configs.map(cfg => ({
        id: `geo-${cfg.id}`,
        label: cfg.label,
        enabled: geoJsonLayers.layerStates[cfg.id]?.visible ?? false,
        onToggle: () => geoJsonLayers.toggleGeoLayer(cfg.id),
        color: cfg.style.strokeColor || cfg.style.fillColor,
        description: cfg.file.replace('.geojson', ''),
      })),
    },
    {
      id: 'base',
      label: 'Base Layers',
      layers: [
        { id: 'beats', label: 'Beat Boundaries', enabled: beatsVisible, onToggle: () => setBeatsVisible((v: boolean) => !v), color: '#d4a017' },
        { id: 'terrain', label: '3D Terrain', enabled: terrainEnabled, onToggle: () => setTerrainEnabled((v: boolean) => !v), color: '#a855f7' },
        { id: 'buildings', label: '3D Buildings', enabled: buildings3dEnabled, onToggle: () => setBuildings3dEnabled((v: boolean) => !v), color: '#666666', description: 'Extruded building footprints' },
        { id: 'selfpos', label: 'My Position', enabled: selfPosVisible, onToggle: () => setSelfPosVisible((v: boolean) => !v), color: '#3b82f6' },
        { id: 'projection', label: `Projection: ${projection.projection}`, enabled: projection.projection !== 'mercator', onToggle: projection.cycle, color: '#14b8a6', description: 'Globe / Mercator / Equal Earth' },
        { id: 'atmosphere', label: `Atmosphere: ${atmosphere.preset}`, enabled: atmosphere.enabled, onToggle: atmosphere.cycle, color: '#a855f7', description: 'Fog, sky & star effects' },
      ],
    },
    {
      id: 'dispatch',
      label: 'Dispatch Automation',
      layers: [
        { id: 'autopan', label: 'Auto-Pan P1', enabled: autoPanEnabled, onToggle: () => setAutoPanEnabled((v: boolean) => !v), color: '#ef4444', description: 'Pan to new Priority 1 calls' },
        { id: 'p1audio', label: 'P1 Audio Alert', enabled: p1AudioEnabled, onToggle: () => setP1AudioEnabled((v: boolean) => !v), color: '#ef4444', description: 'Chirp on new P1 calls' },
      ],
    },
    {
      id: 'camera',
      label: 'Camera & Export',
      layers: [
        { id: 'orbit', label: 'Orbit Animation', enabled: cameraAnimation.animating, onToggle: () => cameraAnimation.animating ? cameraAnimation.stop() : cameraAnimation.orbit(), color: '#f59e0b', description: 'Cinematic map rotation' },
      ],
    },
  ], [heatmap, traffic, breadcrumbs, clustering, daylight, geofenceAlerts, isochroneEnabled, toggleIsochrone, beatsVisible, terrainEnabled, selfPosVisible, autoPanEnabled, p1AudioEnabled, setBeatsVisible, setTerrainEnabled, setSelfPosVisible, setAutoPanEnabled, setP1AudioEnabled, weatherRadar, coordGrid, deckEnabled, setDeckEnabled, streetView, featureInspect, mapMatchTrace, geoJsonLayers, buildings3dEnabled, setBuildings3dEnabled, projection, atmosphere, cameraAnimation]);

  // ── Nearest Unit Dispatch ──────────────────────────────────────────────────

  const showNearestUnit = useCallback(async (call: ActiveCall) => {
    if (call.latitude == null || call.longitude == null) {
      addToast('Call has no GPS coordinates', 'warning');
      return;
    }

    const gpsUnits = units.filter(u => u.latitude != null && u.longitude != null);
    if (gpsUnits.length === 0) {
      addToast('No units with GPS available', 'warning');
      return;
    }

    try {
      const callCoord: [number, number] = [call.longitude, call.latitude];
      const unitCoords: [number, number][] = gpsUnits.map(u => [u.longitude!, u.latitude!]);
      const results = await findNearestUnits(callCoord, unitCoords);

      if (results.length > 0) {
        const nearest = gpsUnits[results[0].unitIndex];
        const mins = Math.round(results[0].durationSec / 60);
        setNearestUnitInfo(`${nearest.call_sign} — ${mins} min`);
        addToast(`Nearest unit: ${nearest.call_sign} (${mins} min ETA)`, 'info');

        // Fly to the nearest unit
        const map = mapRef.current;
        if (map && nearest.latitude && nearest.longitude) {
          map.flyTo({ center: [nearest.longitude, nearest.latitude], zoom: 14, duration: 800 });
          const marker = unitMarkersRef.current.get(nearest.id);
          if (marker) marker.togglePopup();
        }
      }
    } catch (err) {
      addToast('Failed to calculate nearest unit', 'error');
    }
  }, [units, addToast]);

  // ── Computed Counts ────────────────────────────────────────────────────────

  const unitCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const u of units) {
      counts[u.status] = (counts[u.status] || 0) + 1;
    }
    return counts;
  }, [units]);

  const gpsUnitCount = useMemo(() => units.filter(u => u.latitude != null && u.longitude != null).length, [units]);

  // ── Error State ────────────────────────────────────────────────────────────

  if (mapError && !mapLibreFallback) {
    return (
      <div className="flex items-center justify-center bg-surface-base" style={{ position: 'absolute', inset: 0 }}>
        <div className="bg-surface-raised border border-[#222222] p-6 max-w-md text-center" style={{ borderRadius: 2 }}>
           <AlertTriangle className="w-10 h-10 text-[#d4a017] mx-auto mb-3" />
           <h2 className="text-rmpg-200 text-sm font-semibold mb-2">MAP UNAVAILABLE</h2>
           <p className="text-rmpg-400 text-xs mb-4">{mapError}</p>
           <div className="text-left bg-[#111] border border-[#1a1a1a] p-3 mb-4 text-[10px] text-rmpg-400" style={{ borderRadius: 2 }}>
             <p className="font-semibold text-rmpg-300 mb-1">To fix this issue:</p>
             <ol className="list-decimal list-inside space-y-1">
               <li>Go to <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noopener noreferrer" className="text-[#d4a017] underline">account.mapbox.com/access-tokens</a> and verify your token is active.</li>
               <li>Ensure the token has the required scopes: <span className="font-mono text-rmpg-300">styles:read</span>, <span className="font-mono text-rmpg-300">styles:tiles</span>, <span className="font-mono text-rmpg-300">fonts:read</span>.</li>
               <li>If expired or revoked, create a new public token and copy it.</li>
               <li>Navigate to <a href="/admin?tab=integrations" className="text-[#d4a017] underline">Admin → Integrations → Mapbox</a> and paste the new token.</li>
               <li>Alternatively, set the <span className="font-mono text-rmpg-300">MAPBOX_ACCESS_TOKEN</span> environment variable on the server.</li>
             </ol>
           </div>
           <div className="flex flex-col gap-2 items-center">
             <a
               href="/admin?tab=integrations"
               className="text-[#d4a017] text-xs underline hover:text-[#e8b84a]"
             >
               Configure in Admin → Integrations
             </a>
             <button
               onClick={() => { setRetryNonce(n => n + 1); setMapError(null); setLoading(true); }}
               className="text-[#d4a017] text-xs hover:text-[#e8b84a] transition-colors"
             >
               ↻ Retry Mapbox
             </button>
             <button
               onClick={() => { setMapLibreFallback(true); }}
               className="text-rmpg-400 text-xs hover:text-rmpg-200 transition-colors"
             >
               Use MapLibre fallback →
             </button>
           </div>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full overflow-hidden bg-surface-base" style={{ height: '100%', minHeight: '100%' }}>
      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-base/90">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-[#d4a017] animate-spin" />
            <span className="text-rmpg-300 text-xs font-mono">INITIALIZING MAP…</span>
          </div>
        </div>
      )}

      {/* Map Container — explicit w/h ensures Mapbox GL gets a sized element */}
      <div ref={mapContainerRef} className="absolute inset-0" style={{ width: '100%', height: '100%' }} />

      {/* MapLibre Fallback Banner */}
      {mapLibreFallback && (
        <div
          className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-3 py-1.5 bg-[#1a1a00]/90 border-b border-[#d4a017]/30 backdrop-blur-sm"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-[#d4a017] shrink-0" />
            <span className="text-[#d4a017] text-[11px] font-mono">
              MAPBOX UNAVAILABLE — Using MapLibre GL fallback (CartoDB tiles)
            </span>
          </div>
          <button
            onClick={retryMapbox}
            className="flex items-center gap-1 text-[10px] text-rmpg-300 hover:text-[#d4a017] font-mono transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            RETRY
          </button>
        </div>
      )}

      {/* Geocoder styling override for RMPG dark theme */}
      <style>{`
        .mapboxgl-ctrl-geocoder {
          background: #141414 !important;
          border: 1px solid #222222 !important;
          border-radius: 2px !important;
          color: #e0e0e0 !important;
          font-family: ui-monospace, monospace !important;
          font-size: 12px !important;
          box-shadow: none !important;
          min-width: 260px !important;
        }
        .mapboxgl-ctrl-geocoder .mapboxgl-ctrl-geocoder--input {
          color: #e0e0e0 !important;
          font-size: 12px !important;
        }
        .mapboxgl-ctrl-geocoder .mapboxgl-ctrl-geocoder--input::placeholder {
          color: #555 !important;
        }
        .mapboxgl-ctrl-geocoder .suggestions {
          background: #141414 !important;
          border: 1px solid #222222 !important;
          border-radius: 2px !important;
        }
        .mapboxgl-ctrl-geocoder .suggestions > li > a {
          color: #ccc !important;
          font-size: 11px !important;
        }
        .mapboxgl-ctrl-geocoder .suggestions > .active > a,
        .mapboxgl-ctrl-geocoder .suggestions > li > a:hover {
          background: #1a1a1a !important;
          color: #d4a017 !important;
        }
        .mapboxgl-ctrl-geocoder .mapboxgl-ctrl-geocoder--icon-search {
          fill: #d4a017 !important;
        }
        .mapboxgl-ctrl-geocoder .mapboxgl-ctrl-geocoder--button {
          background: transparent !important;
        }
        .mapboxgl-ctrl-geocoder .mapboxgl-ctrl-geocoder--icon-close {
          fill: #888 !important;
        }
      `}</style>

      {/* Sidebar Toggle (when closed) */}
      {!sidebarOpen && (
        <IconButton
          aria-label="Open sidebar"
          onClick={() => setSidebarOpen(true)}
          className="absolute top-3 left-3 z-30 bg-surface-raised/95 border border-[#222222] p-2 text-rmpg-300 hover:text-[#d4a017] backdrop-blur-sm"
          style={{ borderRadius: 2 }}
        >
          <PanelLeftOpen className="w-4 h-4" />
        </IconButton>
      )}

      {/* Sidebar */}
      {sidebarOpen && (
        <div
          className={`absolute top-0 left-0 z-20 h-full bg-surface-raised/95 border-r border-[#222222] backdrop-blur-sm flex flex-col ${isMobile ? 'w-full' : 'w-[280px]'}`}
        >
          {/* Sidebar Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#222222]">
            <div className="flex items-center gap-2">
              <RmpgLogo height={20} iconOnly />
              <span className="text-[#d4a017] text-xs font-semibold tracking-wider">FLEX MAP</span>
            </div>
            <IconButton
              aria-label="Close sidebar"
              onClick={() => setSidebarOpen(false)}
              className="text-rmpg-400 hover:text-rmpg-200 p-1"
            >
              <PanelLeftClose className="w-4 h-4" />
            </IconButton>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-[#222222]">
            <button
              onClick={() => setActiveTab('units')}
              className={`flex-1 py-2 text-xs font-semibold tracking-wider transition-colors ${
                activeTab === 'units'
                  ? 'text-[#d4a017] border-b-2 border-[#d4a017]'
                  : 'text-rmpg-400 hover:text-rmpg-300'
              }`}
            >
              <Shield className="w-3 h-3 inline mr-1" />
              UNITS ({units.length})
            </button>
            <button
              onClick={() => setActiveTab('calls')}
              className={`flex-1 py-2 text-xs font-semibold tracking-wider transition-colors ${
                activeTab === 'calls'
                  ? 'text-[#d4a017] border-b-2 border-[#d4a017]'
                  : 'text-rmpg-400 hover:text-rmpg-300'
              }`}
            >
              <AlertTriangle className="w-3 h-3 inline mr-1" />
              CALLS ({calls.length})
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'units' && (
              <div className="divide-y divide-[#1a1a1a]">
                {units.length === 0 && (
                  <div className="px-3 py-6 text-center text-rmpg-500 text-xs">No units available</div>
                )}
                {units.map(unit => {
                  const color = UNIT_STATUS_COLORS[unit.status] || '#888888';
                  const hasGps = unit.latitude != null && unit.longitude != null;
                  return (
                    <button
                      key={unit.id}
                      onClick={() => flyToUnit(unit)}
                      disabled={!hasGps}
                      className={`w-full text-left px-3 py-1.5 transition-colors ${
                        hasGps ? 'hover:bg-[#1a1a1a] cursor-pointer' : 'opacity-50 cursor-default'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 shrink-0"
                          style={{ borderRadius: '50%', background: color, boxShadow: `0 0 4px ${color}80` }}
                        />
                        <span className="text-rmpg-200 text-[11px] font-mono font-semibold">{unit.call_sign}</span>
                        <span className="text-rmpg-400 text-[10px] truncate flex-1">{unit.officer_name}</span>
                        {!hasGps && <span className="text-rmpg-500 text-[9px]">NO GPS</span>}
                      </div>
                      {unit.current_call_type && (
                        <div className="ml-4 text-[10px] text-rmpg-500 truncate">
                          {unit.call_number} — {formatIncidentType(unit.current_call_type)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {activeTab === 'calls' && (
              <div className="divide-y divide-[#1a1a1a]">
                {calls.length === 0 && (
                  <div className="px-3 py-6 text-center text-rmpg-500 text-xs">No active calls</div>
                )}
                {calls.map(call => {
                  const color = PRIORITY_COLORS[call.priority] || '#888888';
                  const hasGps = call.latitude != null && call.longitude != null;
                  const hasFlags = HAZARD_FLAGS.some(f => call[f.key]);
                  return (
                    <button
                      key={call.id}
                      onClick={() => flyToCall(call)}
                      disabled={!hasGps}
                      className={`w-full text-left px-3 py-1.5 transition-colors ${
                        hasGps ? 'hover:bg-[#1a1a1a] cursor-pointer' : 'opacity-50 cursor-default'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="shrink-0 text-[8px] font-bold px-1 py-px"
                          style={{ background: `${color}22`, color, borderRadius: 2 }}
                        >
                          P{call.priority}
                        </span>
                        <span className="text-rmpg-200 text-[11px] font-mono font-semibold">{call.call_number}</span>
                        <span className="text-rmpg-400 text-[10px] truncate flex-1">
                          {formatIncidentType(call.incident_type)}
                        </span>
                      </div>
                      <div className="ml-4 text-[10px] text-rmpg-500 truncate">{call.location_address}</div>
                      {hasFlags && (
                        <div className="ml-4 mt-0.5 flex flex-wrap gap-0.5">
                          {HAZARD_FLAGS.filter(f => call[f.key]).map(f => (
                            <span
                              key={f.key}
                              className="text-[7px] font-bold px-1 py-px"
                              style={{ background: `${f.color}22`, color: f.color, borderRadius: 2 }}
                            >
                              {f.label}
                            </span>
                          ))}
                        </div>
                      )}
                      {hasGps && (
                        <div className="ml-4 mt-0.5">
                          <span
                            className="text-[8px] text-rmpg-400 hover:text-[#d4a017] cursor-pointer inline-flex items-center gap-0.5"
                            onClick={(e) => { e.stopPropagation(); showNearestUnit(call); }}
                          >
                            <Locate className="w-2.5 h-2.5" /> NEAREST UNIT
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sidebar Footer — quick actions */}
          <div className="border-t border-[#222222] px-3 py-2">
            <div className="flex items-center gap-1 flex-wrap">
              <IconButton
                aria-label="Refresh data"
                onClick={silentRefresh}
                className="text-rmpg-400 hover:text-[#d4a017] p-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                aria-label={beatsVisible ? 'Hide beat boundaries' : 'Show beat boundaries'}
                onClick={() => setBeatsVisible(v => !v)}
                className={`p-1.5 ${beatsVisible ? 'text-[#d4a017]' : 'text-rmpg-400 hover:text-rmpg-200'}`}
              >
                {beatsVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </IconButton>
              <IconButton
                aria-label="Fly to my position"
                onClick={flyToSelf}
                className="text-rmpg-400 hover:text-[#d4a017] p-1.5"
              >
                <Crosshair className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                aria-label={terrainEnabled ? 'Disable 3D terrain' : 'Enable 3D terrain'}
                onClick={() => setTerrainEnabled(v => !v)}
                className={`p-1.5 ${terrainEnabled ? 'text-[#d4a017]' : 'text-rmpg-400 hover:text-rmpg-200'}`}
              >
                <Mountain className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                aria-label={isochroneEnabled ? 'Hide response zones' : 'Show response time zones'}
                onClick={toggleIsochrone}
                className={`p-1.5 ${isochroneEnabled ? 'text-[#22c55e]' : 'text-rmpg-400 hover:text-rmpg-200'}`}
              >
                <Clock className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                aria-label={selfPosVisible ? 'Hide my position' : 'Show my position'}
                onClick={() => setSelfPosVisible(v => !v)}
                className={`p-1.5 ${selfPosVisible ? 'text-blue-400' : 'text-rmpg-400 hover:text-rmpg-200'}`}
              >
                <Navigation2 className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                aria-label="Layers panel"
                onClick={() => setLayersPanelOpen(v => !v)}
                className={`p-1.5 ${layersPanelOpen ? 'text-[#d4a017]' : 'text-rmpg-400 hover:text-rmpg-200'}`}
              >
                <Layers className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                aria-label={breadcrumbs.enabled ? 'Hide unit trails' : 'Show unit trails'}
                onClick={() => breadcrumbs.toggle()}
                className={`p-1.5 ${breadcrumbs.enabled ? 'text-[#3b82f6]' : 'text-rmpg-400 hover:text-rmpg-200'}`}
                title="GPS Breadcrumb Trails (B)"
              >
                <Footprints className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                aria-label={daylight.enabled ? 'Hide day/night overlay' : 'Show day/night overlay'}
                onClick={() => daylight.toggle()}
                className={`p-1.5 ${daylight.enabled ? 'text-[#f59e0b]' : 'text-rmpg-400 hover:text-rmpg-200'}`}
                title="Day/Night Terminator (D)"
              >
                <Sun className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                aria-label={geofenceAlerts.enabled ? 'Disable premise alerts' : 'Enable premise alerts'}
                onClick={() => geofenceAlerts.toggle()}
                className={`p-1.5 ${geofenceAlerts.enabled ? 'text-[#ef4444]' : 'text-rmpg-400 hover:text-rmpg-200'}`}
                title="Premise / Geofence Alerts"
              >
                <MapPinned className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                aria-label={autoPanEnabled ? 'Disable auto-pan P1' : 'Enable auto-pan P1'}
                onClick={() => setAutoPanEnabled(v => !v)}
                className={`p-1.5 ${autoPanEnabled ? 'text-[#ef4444]' : 'text-rmpg-400 hover:text-rmpg-200'}`}
                title="Auto-Pan to P1 Calls"
              >
                <Radio className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                aria-label={p1AudioEnabled ? 'Disable P1 audio alert' : 'Enable P1 audio alert'}
                onClick={() => setP1AudioEnabled(v => !v)}
                className={`p-1.5 ${p1AudioEnabled ? 'text-[#ef4444]' : 'text-rmpg-400 hover:text-rmpg-200'}`}
                title="P1 Audio Alert Chirp"
              >
                <Volume2 className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                aria-label={coordGrid.enabled ? 'Hide coordinate grid' : 'Show coordinate grid'}
                onClick={() => coordGrid.toggle()}
                className={`p-1.5 ${coordGrid.enabled ? 'text-[#d4a017]' : 'text-rmpg-400 hover:text-rmpg-200'}`}
                title="Coordinate Grid (G)"
              >
                <Hash className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                aria-label={weatherRadar.enabled ? 'Hide weather radar' : 'Show weather radar'}
                onClick={() => weatherRadar.toggle()}
                className={`p-1.5 ${weatherRadar.enabled ? 'text-[#3b82f6]' : 'text-rmpg-400 hover:text-rmpg-200'}`}
                title="Weather Radar"
              >
                <CloudRain className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                aria-label="Bookmarks"
                onClick={() => setShowBookmarksPanel(v => !v)}
                className={`p-1.5 ${showBookmarksPanel ? 'text-[#f59e0b]' : 'text-rmpg-400 hover:text-rmpg-200'}`}
                title="Saved Bookmarks"
              >
                <Star className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                aria-label="Export map image"
                onClick={() => printExport.exportImage()}
                className="p-1.5 text-rmpg-400 hover:text-rmpg-200"
                title="Export Map as Image"
              >
                <Download className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                aria-label={deckEnabled ? 'Disable GPU overlay' : 'Enable GPU overlay'}
                onClick={() => setDeckEnabled(v => !v)}
                className={`p-1.5 ${deckEnabled ? 'text-[#a855f7]' : 'text-rmpg-400 hover:text-rmpg-200'}`}
                title="Deck.gl GPU Overlay"
              >
                <Zap className="w-3.5 h-3.5" />
              </IconButton>
            </div>
          </div>
        </div>
      )}

      {/* Advanced Map Tools Toolbar */}
      {mapLoaded && !mapLibreFallback && (
        <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
          {/* Toggle advanced toolbar */}
          <IconButton
            aria-label="Advanced map tools"
            onClick={() => setShowAdvancedToolbar(v => !v)}
            className={`bg-surface-raised/95 border border-[#222222] p-2 backdrop-blur-sm ${
              showAdvancedToolbar ? 'text-[#d4a017]' : 'text-rmpg-300 hover:text-[#d4a017]'
            }`}
            style={{ borderRadius: 2 }}
          >
            <Grid3X3 className="w-4 h-4" />
          </IconButton>

          {showAdvancedToolbar && (
            <>
              {/* Heatmap */}
              <IconButton
                aria-label={heatmap.enabled ? 'Hide heatmap' : 'Show heatmap'}
                onClick={() => {
                  if (!heatmap.enabled) {
                    const heatPts = calls
                      .filter(c => c.latitude != null && c.longitude != null)
                      .map(c => ({
                        longitude: c.longitude!,
                        latitude: c.latitude!,
                        weight: c.priority === '1' ? 1 : c.priority === '2' ? 0.7 : 0.4,
                      }));
                    heatmap.updatePoints(heatPts);
                  }
                  heatmap.toggle();
                }}
                className={`bg-surface-raised/95 border border-[#222222] p-2 backdrop-blur-sm ${
                  heatmap.enabled ? 'text-[#ef4444]' : 'text-rmpg-300 hover:text-[#d4a017]'
                }`}
                style={{ borderRadius: 2 }}
                title="Crime Heatmap"
              >
                <Flame className="w-4 h-4" />
              </IconButton>

              {/* Traffic */}
              <IconButton
                aria-label={traffic.enabled ? 'Hide traffic' : 'Show traffic'}
                onClick={() => traffic.toggle()}
                className={`bg-surface-raised/95 border border-[#222222] p-2 backdrop-blur-sm ${
                  traffic.enabled ? 'text-[#22c55e]' : 'text-rmpg-300 hover:text-[#d4a017]'
                }`}
                style={{ borderRadius: 2 }}
                title="Live Traffic"
              >
                <Car className="w-4 h-4" />
              </IconButton>

              {/* Clustering */}
              <IconButton
                aria-label={clustering.enabled ? 'Disable clustering' : 'Enable clustering'}
                onClick={() => {
                  if (!clustering.enabled) {
                    const clPts = calls
                      .filter(c => c.latitude != null && c.longitude != null)
                      .map(c => ({
                        id: c.id,
                        longitude: c.longitude!,
                        latitude: c.latitude!,
                        priority: c.priority,
                        label: c.call_number,
                        color: PRIORITY_COLORS[c.priority] || '#888',
                      }));
                    clustering.updatePoints(clPts);
                  }
                  clustering.toggle();
                }}
                className={`bg-surface-raised/95 border border-[#222222] p-2 backdrop-blur-sm ${
                  clustering.enabled ? 'text-[#d4a017]' : 'text-rmpg-300 hover:text-[#d4a017]'
                }`}
                style={{ borderRadius: 2 }}
                title="Cluster Markers"
              >
                <Hexagon className="w-4 h-4" />
              </IconButton>

              {/* Satellite Peek (Street View equivalent) */}
              <IconButton
                aria-label={streetView.enabled ? 'Disable satellite peek' : 'Enable satellite peek'}
                onClick={() => streetView.toggle()}
                className={`bg-surface-raised/95 border border-[#222222] p-2 backdrop-blur-sm ${
                  streetView.enabled ? 'text-[#3b82f6]' : 'text-rmpg-300 hover:text-[#d4a017]'
                }`}
                style={{ borderRadius: 2 }}
                title="Satellite Peek"
              >
                <Satellite className="w-4 h-4" />
              </IconButton>

              {/* Measure — dropdown for distance vs area */}
              <div className="relative">
                <IconButton
                  aria-label="Measure tool"
                  onClick={() => setShowMeasureMenu(v => !v)}
                  className={`bg-surface-raised/95 border border-[#222222] p-2 backdrop-blur-sm ${
                    measure.mode !== 'none' ? 'text-[#3b82f6]' : 'text-rmpg-300 hover:text-[#d4a017]'
                  }`}
                  style={{ borderRadius: 2 }}
                  title="Measure Distance / Area"
                >
                  <Ruler className="w-4 h-4" />
                </IconButton>
                {showMeasureMenu && (
                  <div className="absolute right-full top-0 mr-1 bg-surface-raised border border-[#222222] w-36 overflow-hidden" style={{ borderRadius: 2 }}>
                    <button
                      onClick={() => { measure.setMode('distance'); setShowMeasureMenu(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                        measure.mode === 'distance' ? 'text-[#3b82f6] bg-[#1a1a1a]' : 'text-rmpg-300 hover:bg-[#1a1a1a]'
                      }`}
                    >
                      📏 Distance
                    </button>
                    <button
                      onClick={() => { measure.setMode('area'); setShowMeasureMenu(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                        measure.mode === 'area' ? 'text-[#3b82f6] bg-[#1a1a1a]' : 'text-rmpg-300 hover:bg-[#1a1a1a]'
                      }`}
                    >
                      📐 Area
                    </button>
                    {measure.mode !== 'none' && (
                      <button
                        onClick={() => { measure.clear(); setShowMeasureMenu(false); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-rmpg-400 hover:bg-[#1a1a1a]"
                      >
                        ✕ Clear
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Drawing — dropdown for polygon/polyline/circle */}
              <div className="relative">
                <IconButton
                  aria-label="Drawing tools"
                  onClick={() => setShowDrawMenu(v => !v)}
                  className={`bg-surface-raised/95 border border-[#222222] p-2 backdrop-blur-sm ${
                    drawing.mode !== 'none' ? 'text-[#d4a017]' : 'text-rmpg-300 hover:text-[#d4a017]'
                  }`}
                  style={{ borderRadius: 2 }}
                  title="Draw Shapes"
                >
                  <PenTool className="w-4 h-4" />
                </IconButton>
                {showDrawMenu && (
                  <div className="absolute right-full top-0 mr-1 bg-surface-raised border border-[#222222] w-40 overflow-hidden" style={{ borderRadius: 2 }}>
                    <button
                      onClick={() => { drawing.setMode('polygon'); setShowDrawMenu(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                        drawing.mode === 'polygon' ? 'text-[#d4a017] bg-[#1a1a1a]' : 'text-rmpg-300 hover:bg-[#1a1a1a]'
                      }`}
                    >
                      ▬ Polygon (geofence)
                    </button>
                    <button
                      onClick={() => { drawing.setMode('polyline'); setShowDrawMenu(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                        drawing.mode === 'polyline' ? 'text-[#d4a017] bg-[#1a1a1a]' : 'text-rmpg-300 hover:bg-[#1a1a1a]'
                      }`}
                    >
                      ╱ Polyline (route)
                    </button>
                    <button
                      onClick={() => { drawing.setMode('circle'); setShowDrawMenu(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                        drawing.mode === 'circle' ? 'text-[#d4a017] bg-[#1a1a1a]' : 'text-rmpg-300 hover:bg-[#1a1a1a]'
                      }`}
                    >
                      ◯ Circle (perimeter)
                    </button>
                    <div className="border-t border-[#222]" />
                    <button
                      onClick={() => { drawing.undo(); }}
                      className="w-full text-left px-3 py-1.5 text-xs text-rmpg-400 hover:bg-[#1a1a1a]"
                    >
                      ↩ Undo last shape
                    </button>
                    <button
                      onClick={() => { drawing.clearAll(); drawing.setMode('none'); setShowDrawMenu(false); }}
                      className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-[#1a1a1a]"
                    >
                      ✕ Clear all shapes
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Measurement Result Banner */}
      {measure.result && measure.mode === 'none' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-surface-raised/95 border border-[#222222] px-4 py-2 backdrop-blur-sm flex items-center gap-3" style={{ borderRadius: 2 }}>
          <Ruler className="w-3.5 h-3.5 text-[#3b82f6]" />
          <span className="text-rmpg-200 text-xs font-mono">
            {measure.result.distanceFormatted}
            {measure.result.areaFormatted && ` · ${measure.result.areaFormatted}`}
          </span>
          <button onClick={() => measure.clear()} className="text-rmpg-400 hover:text-rmpg-200 text-xs">✕</button>
        </div>
      )}

      {/* Drawing Mode Indicator */}
      {drawing.mode !== 'none' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-surface-raised/95 border border-[#d4a017]/30 px-4 py-2 backdrop-blur-sm flex items-center gap-3" style={{ borderRadius: 2 }}>
          <PenTool className="w-3.5 h-3.5 text-[#d4a017]" />
          <span className="text-[#d4a017] text-xs font-mono">
            DRAWING: {drawing.mode.toUpperCase()} — {drawing.mode === 'circle' ? 'Click center, then edge' : 'Click to add points, double-click to finish'}
          </span>
          <button onClick={() => drawing.setMode('none')} className="text-rmpg-400 hover:text-rmpg-200 text-xs">✕ Cancel</button>
        </div>
      )}

      {/* Drawing Shapes Count */}
      {drawing.shapes.length > 0 && drawing.mode === 'none' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-surface-raised/95 border border-[#222222] px-3 py-1.5 backdrop-blur-sm flex items-center gap-2" style={{ borderRadius: 2 }}>
          <span className="text-rmpg-300 text-[10px] font-mono">{drawing.shapes.length} shape(s) drawn</span>
          <button onClick={() => drawing.clearAll()} className="text-rmpg-400 hover:text-red-400 text-[10px]">Clear all</button>
        </div>
      )}

      {/* Active Route Panel */}
      {routing.activeRoute && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30 bg-surface-raised/95 border border-[#222222] px-4 py-2 backdrop-blur-sm flex items-center gap-4" style={{ borderRadius: 2 }}>
          <Route className="w-4 h-4 text-[#d4a017]" />
          <div className="text-xs font-mono">
            <span className="text-rmpg-200 font-semibold">{routing.activeRoute.unitCallSign}</span>
            <span className="text-rmpg-500 mx-1">→</span>
            <span className="text-rmpg-200 font-semibold">{routing.activeRoute.callNumber}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-[#22c55e] font-semibold">{routing.activeRoute.eta}</span>
            <span className="text-rmpg-500">·</span>
            <span className="text-rmpg-300">{routing.activeRoute.distance}</span>
          </div>
          <button onClick={() => routing.clearRoute()} className="text-rmpg-400 hover:text-rmpg-200 text-xs">✕</button>
        </div>
      )}

      {/* Layers Panel */}
      <MapLayersPanel
        open={layersPanelOpen}
        onClose={() => setLayersPanelOpen(false)}
        groups={layerGroups}
      />

      {/* Map Style Selector */}
      <div className="absolute bottom-14 left-3 z-20">
        <div className="relative">
          <IconButton
            aria-label="Map style"
            onClick={() => setShowStyleMenu(v => !v)}
            className="bg-surface-raised/95 border border-[#222222] p-2 text-rmpg-300 hover:text-[#d4a017] backdrop-blur-sm"
            style={{ borderRadius: 2 }}
          >
            <Layers className="w-4 h-4" />
          </IconButton>

          {showStyleMenu && (
            <div
              className="absolute bottom-full left-0 mb-1 bg-surface-raised border border-[#222222] w-48 overflow-hidden"
              style={{ borderRadius: 2 }}
            >
              {(Object.keys(MAP_STYLE_LABELS) as MapStyleId[]).map(id => (
                <button
                  key={id}
                  onClick={() => handleStyleChange(id)}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between ${
                    mapStyle === id
                      ? 'bg-[#1a1a1a] text-[#d4a017]'
                      : 'text-rmpg-300 hover:bg-[#1a1a1a] hover:text-rmpg-200'
                  }`}
                >
                  <span>{MAP_STYLE_LABELS[id]}</span>
                  {mapStyle === id && <span className="text-[8px]">●</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20 bg-surface-raised/95 border-t border-[#222222] backdrop-blur-sm"
        style={{ height: 28 }}
      >
        <div className="flex items-center justify-between h-full px-3 text-[9px] font-mono">
          {/* Unit Counts */}
          <div className="flex items-center gap-3">
            {Object.entries(unitCounts).map(([status, count]) => {
              const color = UNIT_STATUS_COLORS[status as keyof typeof UNIT_STATUS_COLORS] || '#888';
              const label = UNIT_STATUS_LABELS[status as keyof typeof UNIT_STATUS_LABELS] || status;
              return (
                <span key={status} className="flex items-center gap-1">
                  <span
                    className="w-1.5 h-1.5"
                    style={{ borderRadius: '50%', background: color, boxShadow: `0 0 3px ${color}80` }}
                  />
                  <span style={{ color }} className="font-semibold">{count}</span>
                  <span className="text-rmpg-500">{label}</span>
                </span>
              );
            })}
            <span className="text-rmpg-500 border-l border-[#222222] pl-3">
              GPS: <span className="text-rmpg-300">{gpsUnitCount}/{units.length}</span>
            </span>
          </div>

          {/* Right side: connection + calls */}
          <div className="flex items-center gap-3">
            <span className="text-rmpg-500">
              CALLS: <span className="text-rmpg-300">{calls.length}</span>
            </span>
            <span className="flex items-center gap-1">
              <span
                className="w-1.5 h-1.5"
                style={{
                  borderRadius: '50%',
                  background: isConnected ? '#22c55e' : '#ef4444',
                  boxShadow: `0 0 4px ${isConnected ? '#22c55e' : '#ef4444'}80`,
                }}
              />
              <span className={isConnected ? 'text-green-500' : 'text-red-400'}>
                {isConnected ? 'LIVE' : 'OFFLINE'}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
