/**
 * MapboxMapPage.tsx — Mapbox GL JS-based operational map for RMPG Flex CAD/RMS.
 *
 * Renders when useMapProvider() selects 'mapbox'. Provides real-time unit tracking,
 * active call visualization, beat overlays, address search, and GPS self-positioning.
 *
 * Tactical surface (always night/steel-blue via `.tactical-dark`, see
 * `utils/tacticalPalette.ts`): surface-base/surface-raised tokens, brand-gold-500
 * accent, 2px radius everywhere.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import mapboxgl from 'mapbox-gl';
import MapSearchBox from './components/MapSearchBox';
import {
  Shield, AlertTriangle, Layers, Layers3, MapPin, Navigation2,
  Eye, EyeOff, ChevronDown, ChevronUp, Loader2, RefreshCw,
  Map as MapIcon, PanelLeftClose, PanelLeftOpen, Crosshair, Mountain,
  Clock, Locate, Flame, Car, Ruler, PenTool, Hexagon,
  Circle, Trash2, Undo2, Grid3X3, Sun, Route, Users, Info,
  Radio, Volume2, Footprints, MapPinned,
  Search, Compass, CloudRain, Star, Camera, Download, Clipboard,
  Navigation, Globe, Zap, Hash, BarChart3, X,
} from 'lucide-react';

import {
  addMapbox3DBuildings, removeMapbox3DBuildings,
  addMapboxTerrain, removeMapboxTerrain,
} from '../../utils/mapboxLoader';
import {
  hasLayer, safeRemoveLayer, safeRemoveSource, upsertGeoJsonSource,
} from '../../utils/mapboxSafeLayer';
import { getCachedMapboxStyleUrl } from '../../utils/mapboxApiKey';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';
import { useWebSocket } from '../../context/WebSocketContext';
import { useAuth } from '../../context/AuthContext';
import { useGpsTracking } from '../../hooks/useGpsTracking';
import { useIsMobile } from '../../hooks/useIsMobile';
import { usePersistedState, usePersistedTab } from '../../hooks/usePersistedState';
import { useToast } from '../../components/ToastProvider';
import {
  MapUnit as Unit, ActiveCall, MapProperty as Property,
  UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, priorityHex,
  MAP_STYLE_LABELS,
  type MapStyleId,
} from './utils/mapConstants';
import { formatIncidentType } from '../../utils/caseNumbers';
import { formatEnumValue } from '../../utils/formatters';
import { escapeHtml } from '../../utils/sanitize';
import { mapboxIsochrone, findNearestUnits, mapboxForwardGeocode } from '../../services/mapboxApiService';
import RmpgLogo from '../../components/RmpgLogo';
import IconButton from '../../components/IconButton';
import { devLog, devWarn } from '../../utils/devLog';
import { useMapDrawing, type DrawingMode } from '../../hooks/useMapDrawing';
import { useMapClustering } from '../../hooks/useMapClustering';
import { useMapHeatmap } from '../../hooks/useMapHeatmap';
import { useIncidentHeatmap } from '../../hooks/useIncidentHeatmap';
import { useBeatCoverage } from '../../hooks/useBeatCoverage';
import { useMapboxIncidents } from '../../hooks/useMapboxIncidents';
import { useMapboxSpeedHeatmap } from '../../hooks/useMapboxSpeedHeatmap';
import { useMapboxSpeedViolations } from '../../hooks/useMapboxSpeedViolations';
import { useMapboxPursuitSegments } from '../../hooks/useMapboxPursuitSegments';
import { useSpeedZoneStats } from './hooks/useSpeedZoneStats';
import { useMapIsochrone } from './hooks/useMapIsochrone';
import { useMapGps } from './hooks/useMapGps';
import SpeedAnalyticsPanel from './components/SpeedAnalyticsPanel';
import SpeedGraphOverlay from './components/SpeedGraphOverlay';
import { useMapboxCoverageGaps } from '../../hooks/useMapboxCoverageGaps';
import { useMapboxResponseTime } from '../../hooks/useMapboxResponseTime';
import { useMapboxSafetyZones } from '../../hooks/useMapboxSafetyZones';
import { useMapboxHistoryCalls } from '../../hooks/useMapboxHistoryCalls';
import { useMapboxTilequery } from '../../hooks/useMapboxTilequery';
import { useMapboxRepeatAddresses } from '../../hooks/useMapboxRepeatAddresses';
import { useMapboxServeJobs } from '../../hooks/useMapboxServeJobs';
import { useMapboxOptimizationRoutes } from '../../hooks/useMapboxOptimizationRoutes';
import { useMapTraffic } from '../../hooks/useMapTraffic';
import { useMapMeasure, type MeasureMode } from '../../hooks/useMapMeasure';
import StreetViewLightbox from './components/StreetViewLightbox';
import type { StreetViewTarget } from './components/StreetViewLightbox';
import { useScaleControl, useFullscreenControl } from './components/ScaleFullscreenControls';
import MinimapControl from './components/MinimapControl';
import WeatherRadarControl from './components/WeatherRadarControl';
import Radar360Panel from '../../components/Radar360Panel';
import { useRadar360 } from '../../hooks/useRadar360';
import { useMapBreadcrumbs } from '../../hooks/useMapBreadcrumbs';
import { useMapGeofenceAlerts } from '../../hooks/useMapGeofenceAlerts';
import { useMapInfoPanel } from '../../hooks/useMapInfoPanel';
import { useAutoPanToP1 } from '../../hooks/useAutoPanToP1';
import { useP1AudioAlert } from '../../hooks/useP1AudioAlert';
import { useMapRouting } from '../../hooks/useMapRouting';
import { useMapKeyboardShortcuts } from '../../hooks/useMapKeyboardShortcuts';
import { useMapPlacesSearch, PLACE_CATEGORIES } from '../../hooks/useMapPlacesSearch';
import { useMapDirectionsPanel } from '../../hooks/useMapDirectionsPanel';
import { useMapCoordinateGrid } from '../../hooks/useMapCoordinateGrid';
import { useMapWeatherRadar } from '../../hooks/useMapWeatherRadar';
import { useMapWeatherAlerts } from '../../hooks/useMapWeatherAlerts';
import { useMapBookmarks } from '../../hooks/useMapBookmarks';
import { useMapPrintExport } from '../../hooks/useMapPrintExport';
import { useGeoJsonLayers, GEO_LAYER_CONFIGS } from '../../hooks/useGeoJsonLayers';
import { useDistrictHierarchyLayers } from '../../hooks/useDistrictHierarchyLayers';
import { useVectorTileLayers } from '../../hooks/useVectorTileLayers';
import { useActivityChoropleth } from '../../hooks/useActivityChoropleth';
import { useMapFeatureInspect } from '../../hooks/useMapFeatureInspect';
import type { InspectedFeature } from '../../hooks/useMapFeatureInspect';
import FeatureInspectorPanel from './components/FeatureInspectorPanel';
import { useMapMatchTrace } from '../../hooks/useMapMatchTrace';
import { useMapboxDraw } from '../../hooks/useMapboxDraw';
import { initMapboxDeckOverlay, updateMapboxDeckLayers, destroyMapboxDeckOverlay, createMapboxIncidentLayer, createMapboxUnitLayer, createMapboxArcLayer } from '../../integrations/deckMapboxLayers';
import type { IncidentPoint, UnitPosition } from '../../integrations/deckMapboxLayers';
import MapRosterDock, { type MapRosterDockProps, type RosterUnit, type RosterCall } from './components/MapRosterDock';
import MapLeftDock from './components/MapLeftDock';
import MapRightDock from './components/MapRightDock';
import { buildDockSections, findUnboundLayers, type LayerBindingMap } from './hooks/useLayerBindings';
import { useEnRouteEta } from './hooks/useEnRouteEta';
import { useMapWelfare } from './hooks/useMapWelfare';
import { useMapBeatOverlay } from './hooks/useMapBeatOverlay';
import { LEFT_DOCK_GROUPS, RIGHT_DOCK_GROUPS } from './config/layerRegistry';
import { MapDensityProvider } from './hooks/useMapDensity';
import { MapContext } from './MapContext';
import MapLayout from './MapLayout';
import MapTopToolbar from './components/MapTopToolbar';
import type { V2Route } from '../../utils/mapboxOptimizationV2';
import UnifiedMapLegend from './components/UnifiedMapLegend';
import OsmFeatureEditor from '../../components/OsmFeatureEditor';
import { useOsmOverrides } from '../../hooks/useOsmOverrides';
import MapBottomTray from './components/MapBottomTray';
import SafetyAlertTicker from './components/SafetyAlertTicker';
import BufferRingTool from './components/BufferRingTool';
import AnnotationTool from './components/AnnotationTool';
import DrawGeofenceTool from './components/DrawGeofenceTool';
import GpsReplayTool from './components/GpsReplayTool';
import NavOverlayTool from './components/NavOverlayTool';
import MultiStopRoutePanel from './components/MultiStopRoutePanel';
import type { QueuedStop } from './components/MultiStopRoutePanel';
import GpsHud from './components/GpsHud';
import MapDiagnosticsOverlay from './components/MapDiagnosticsOverlay';
import MapboxDispatchConnections from './components/MapboxDispatchConnections';
import { useSafetyAlertFeed } from '../../hooks/useSafetyAlertFeed';
import { useMapCore } from './modules/MapCore';
import { withAlpha } from '../../utils/withAlpha';
import { HAZARD_FLAGS, buildUnitMarkerEl, applyUnitMarkerState, buildUnitPopupHtml, buildCallMarkerEl, buildCallPopupHtml, shouldAnimateMarkerMove, formatEtaSeconds, formatDistanceMiles } from './utils/mapMarkers';
import {
  TACTICAL_SURFACE_BASE, TACTICAL_SURFACE_RAISED, TACTICAL_BORDER, TACTICAL_TEXT_MUTED, TACTICAL_BRAND_GOLD,
  TACTICAL_TEXT_PRIMARY, TACTICAL_TEXT_DIM, TACTICAL_INFO, TACTICAL_TEXT_NEAR_WHITE, TACTICAL_SILVER,
  TACTICAL_ERROR, ISOCHRONE_COLORS,
} from './utils/tacticalPalette';

// ── Constants ──────────────────────────────────────────────────────────────────
const SLC_CENTER: [number, number] = [-111.891, 40.7608];
const DEFAULT_ZOOM = 12;
const REFRESH_INTERVAL_MS = 30_000;
// Live unit positions specifically (not the queue/properties fetched by
// fetchData) refresh on a much tighter cadence to match the ~5s client GPS
// batch interval (useGpsTracking.ts DEFAULT_BATCH_INTERVAL) — the full
// fetchData() poll stays at 30s since /dispatch/queue and /records/properties
// are comparatively heavy and don't change every few seconds.
const UNITS_FAST_POLL_MS = 5_000;

// Inject GPS self-position pulse animation (module-scope, runs once)
if (typeof document !== 'undefined' && !document.getElementById('rmpg-pulse-css')) {
  const css = document.createElement('style');
  css.id = 'rmpg-pulse-css';
  css.textContent = `@keyframes rmpg-pulse{0%,100%{box-shadow:0 0 12px rgb(var(--sev-info-rgb)/0.5),0 0 24px rgb(var(--sev-info-rgb)/0.25)}50%{box-shadow:0 0 20px rgb(var(--sev-info-rgb)/0.69),0 0 40px rgb(var(--sev-info-rgb)/0.44)}}@keyframes rmpg-pulse-ring{0%,100%{opacity:0.6;transform:scale(1)}50%{opacity:1;transform:scale(1.05)}}`;
  document.head.appendChild(css);
}

/** Trigger a browser download of `content` as `filename` (GPS HUD track export). */
function downloadGpsHudTrack(filename: string, mime: string, content: string): void {
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }, 1000);
  } catch { /* download blocked — best-effort */ }
}

// ── Component ──────────────────────────────────────────────────────────────────

interface MapboxMapPageProps {
  preferredEngine?: 'mapbox' | 'maplibre';
}

export default function MapboxMapPage({ preferredEngine = 'mapbox' }: MapboxMapPageProps) {
  const { user: mapPageUser } = useAuth();
  const isSupervisorPlusMap = ['admin', 'manager', 'supervisor'].includes(mapPageUser?.role ?? '');
  const [showBeatPlanner, setShowBeatPlanner] = useState(false);
  const [beatRoutes, setBeatRoutes] = useState<V2Route[] | null>(null);

  // ── State ──────────────────────────────────────────────────────────────────
  const [units, setUnits]           = useState<Unit[]>([]);
  const [calls, setCalls]           = useState<ActiveCall[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);

  const [sidebarOpen, setSidebarOpen]   = usePersistedState('rmpg_mapbox_sidebar_open', true);
  const [activeTab, setActiveTab]       = usePersistedTab('rmpg_mapbox_sidebar', 'units', ['units', 'calls'] as const);
  const [mapStyle, setMapStyleId]       = usePersistedState<MapStyleId>('rmpg_mapbox_style', 'dark');
  const [selfPosVisible, setSelfPosVisible] = usePersistedState('rmpg_mapbox_self_pos', true);
  const [terrainEnabled, setTerrainEnabled] = usePersistedState('rmpg_mapbox_terrain', false);
  const [nearestUnitInfo, setNearestUnitInfo] = useState<string | null>(null);
  // showMeasureMenu / showDrawMenu drive the distance/area and polygon/polyline/circle
  // dropdown bodies — their launcher buttons now live in the Right Dock's Analysis
  // section (see mapRightDockSections), but the dropdown JSX still mounts at the map
  // canvas root, gated on these flags exactly as before.
  const [showDrawMenu, setShowDrawMenu] = useState(false);
  const [showMeasureMenu, setShowMeasureMenu] = useState(false);


  // ── Refs ───────────────────────────────────────────────────────────────────
  const unitMarkersRef   = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const callMarkersRef   = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const callsRef = useRef<ActiveCall[]>([]);
  // selfMarkerRef is now managed by useMapGps
  const refreshTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  // ── Map Core (init, token fetch, MapLibre fallback, style switching) ──────

  const onStyleFallback = useCallback((style: MapStyleId) => {
    setMapStyleId(style);
  }, [setMapStyleId]);

  const onRetryNonceRequest = useCallback(() => {
    setRetryNonce(n => n + 1);
  }, []);

  const {
    mapContainerRef, mapRef, mapLoaded, loading, mapError, mapLibreFallback,
    isContextLost, needsManualReload,
    changeStyle, token: mapboxToken,
    daylight, projection, atmosphere, cameraAnimation, snapshot,
  } = useMapCore({
    preferredEngine,
    mapStyle,
    retryNonce,
    onStyleFallback,
    onRetryNonceRequest,
    terrainEnabled,
  });

  // Deep-link support: other pages' "View on map" links (ViewOnMapLink.tsx)
  // navigate here as /map?lat=&lng=&label= (known coordinates) or
  // /map?address=&label= (text address only — most pages that link here
  // store an address string with no stored lat/lng, so it's forward-
  // geocoded on arrival), so a record's location (no dedicated call/unit
  // of its own) can still be shown. Flies to the point and drops a one-off
  // marker+popup once the map has finished loading; runs once per page
  // load (searchParams don't change after initial navigation here).
  // The Map module never claimed the document title, so the browser tab kept
  // whatever the previously-visited route set — landing on /map straight from
  // the Dashboard left the tab reading "Dashboard — RMPG Flex" (confirmed on
  // production 2026-07-31). Every other module sets this from its own effect;
  // this brings the Map module in line so tab titles, window/tab switchers,
  // and bookmarks name the right screen.
  useEffect(() => { document.title = 'Map — RMPG Flex'; }, []);

  const [searchParams] = useSearchParams();
  const lastDeepLinkKeyRef = useRef('');
  const deepLinkMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const deepLinkPopupRef = useRef<mapboxgl.Popup | null>(null);
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const deepLinkKey = searchParams.toString();
    if (!deepLinkKey || lastDeepLinkKeyRef.current === deepLinkKey) return;

    const dropDeepLinkPin = (lat: number, lng: number, label: string) => {
      const map = mapRef.current;
      if (!map) return;
      deepLinkMarkerRef.current?.remove();
      deepLinkPopupRef.current?.remove();
      map.flyTo({ center: [lng, lat], zoom: 16, duration: 800 });
      deepLinkPopupRef.current = new mapboxgl.Popup({ offset: 12, className: 'mapbox-popup-dark' })
        .setLngLat([lng, lat])
        .setHTML(
          `<div style="background:${TACTICAL_SURFACE_RAISED};color:${TACTICAL_TEXT_PRIMARY};padding:8px 12px;border:1px solid ${TACTICAL_BORDER};border-radius:2px;font-family:system-ui,sans-serif;font-size:11px;min-width:160px;">${escapeHtml(label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`)}</div>`
        )
        .addTo(map);
      deepLinkMarkerRef.current = new mapboxgl.Marker({ color: TACTICAL_BRAND_GOLD }).setLngLat([lng, lat]).addTo(map);
    };

    const lat = Number.parseFloat(searchParams.get('lat') || '');
    const lng = Number.parseFloat(searchParams.get('lng') || '');
    const label = searchParams.get('label') || '';

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      lastDeepLinkKeyRef.current = deepLinkKey;
      dropDeepLinkPin(lat, lng, label);
      return;
    }

    const address = searchParams.get('address');
    if (address) {
      lastDeepLinkKeyRef.current = deepLinkKey;
      mapboxForwardGeocode(address, { limit: 1, proximity: SLC_CENTER, country: 'us' })
        .then((results) => {
          const hit = results[0];
          if (hit) dropDeepLinkPin(hit.latitude, hit.longitude, label || hit.full_address);
          else addToast?.(`Could not locate "${address}" on the map`, 'warning');
        })
        .catch(() => addToast?.(`Could not locate "${address}" on the map`, 'warning'));
    }
  }, [mapLoaded, searchParams]);

  // Clean up unit/call/self markers and the geocoder control whenever the
  // underlying map instance is re-created (retry/fallback) or the component
  // unmounts — mirrors the cleanup that used to live inline in the map-init
  // effect's own return function. Keyed the same way useMapCore's internal
  // init effect is (mapLibreFallback/retryNonce), so it tears down in step
  // with the map instance itself.
  useEffect(() => {
    return () => {
      unitMarkersRef.current.forEach(m => m.remove());
      unitMarkersRef.current.clear();
      callMarkersRef.current.forEach(m => m.remove());
      callMarkersRef.current.clear();
    };
  }, [mapLibreFallback, retryNonce]);

  // ── Hooks ──────────────────────────────────────────────────────────────────
  const isMobile    = useIsMobile();
  // Separate, wider breakpoint (1024px) that decides docks-vs-tray for the new
  // docked-panes layout. Distinct from `isMobile` (768px) above, which other
  // parts of the page use for its own purposes and must NOT be reused here.
  const isDockNarrow = useIsMobile(1024);
  const { addToast } = useToast();
  const { isConnected, subscribe } = useWebSocket();

  // ── Advanced Map Feature Hooks ─────────────────────────────────────────────
  const drawing = useMapDrawing(mapRef.current, mapLoaded);
  const clustering = useMapClustering(mapRef.current, mapLoaded);
  const heatmap = useMapHeatmap(mapRef.current, mapLoaded);
  const [heatmapMode, setHeatmapMode] = useState<'live' | 'historical'>('live');
  const incidentHeatmap = useIncidentHeatmap(mapRef.current, mapLoaded);
  const beatCoverage = useBeatCoverage(mapRef.current, mapLoaded);

  const refreshHeatmapPoints = useCallback(async (mode: 'live' | 'historical') => {
    if (mode === 'historical') {
      try {
        const rows = await apiFetch<Array<{ latitude: number; longitude: number; count: number }>>('/dispatch/heatmap?mode=all&days=30');
        const maxCount = rows.reduce((m, r) => Math.max(m, r.count), 1);
        heatmap.updatePoints(rows.map((r) => ({
          longitude: r.longitude, latitude: r.latitude,
          weight: Math.min(1, r.count / maxCount),
        })));
      } catch (err) {
        console.warn('[Heatmap] historical fetch failed:', err);
      }
    } else {
      const heatPts = calls
        .filter((c) => c.latitude != null && c.longitude != null)
        .map((c) => ({ longitude: c.longitude!, latitude: c.latitude!, weight: c.priority === '1' ? 1 : c.priority === '2' ? 0.7 : 0.4 }));
      heatmap.updatePoints(heatPts);
    }
  }, [heatmap, calls]);

  const populateAndToggleHeatmap = useCallback(async () => {
    if (!heatmap.enabled) {
      await refreshHeatmapPoints(heatmapMode);
    }
    heatmap.toggle();
  }, [heatmap, heatmapMode, refreshHeatmapPoints]);

  const incidentsLayer = useMapboxIncidents(mapLoaded ? mapRef.current : null);
  const speedHeatmap = useMapboxSpeedHeatmap(mapLoaded ? mapRef.current : null);
  const speedViolationsLayer = useMapboxSpeedViolations(mapLoaded ? mapRef.current : null);
  const pursuitSegmentsLayer = useMapboxPursuitSegments(mapLoaded ? mapRef.current : null);
  const [speedHeatmapEnabled, setSpeedHeatmapEnabled] = useState(false);
  const [speedViolationsEnabled, setSpeedViolationsEnabled] = useState(false);
  const [pursuitSegmentsEnabled, setPursuitSegmentsEnabled] = useState(false);
  const [speedAnalyticsPanelOpen, setSpeedAnalyticsPanelOpen] = useState(false);
  const [speedGraphUnit, setSpeedGraphUnit] = useState<{ unitId: number; callSign: string } | null>(null);
  const speedZoneStats = useSpeedZoneStats(8, speedAnalyticsPanelOpen);
  speedViolationsLayer.setOnSelectUnit((unitId, callSign) => setSpeedGraphUnit({ unitId, callSign }));
  const coverageGaps = useMapboxCoverageGaps(mapLoaded ? mapRef.current : null);
  const responseTime = useMapboxResponseTime(mapLoaded ? mapRef.current : null);
  const safetyZones = useMapboxSafetyZones(mapLoaded ? mapRef.current : null);
  const historyCalls = useMapboxHistoryCalls(mapLoaded ? mapRef.current : null);
  const tilequery = useMapboxTilequery(mapLoaded ? mapRef.current : null);
  const [identifyEnabled, setIdentifyEnabled] = useState(false);
  const identifyPopupRef = useRef<mapboxgl.Popup | null>(null);
  // Persistent popup for OSM vector-tile feature clicks. Deliberately NOT
  // identifyPopupRef: that one is created and destroyed per click by the
  // Identify tool, so it is null whenever Identify is not mid-interaction.
  // useVectorTileLayers was previously passed `popup: null`, which made every
  // OSM click handler return before rendering anything.
  const osmPopupRef = useRef<mapboxgl.Popup | null>(null);
  if (osmPopupRef.current === null && typeof window !== 'undefined') {
    osmPopupRef.current = new mapboxgl.Popup({
      closeButton: true,
      closeOnClick: true,
      className: 'mapbox-popup-dark',
      maxWidth: '280px',
    });
  }
  // Buffer Ring — built, tested (BufferRingTool.test.tsx).
  const [activeFloatingTool, setActiveFloatingTool] = useState<'buffer-ring' | 'annotation' | 'draw-geofence' | 'gps-replay' | 'nav-overlay' | 'radar-360' | null>(null);
  // Radar 360 — scan center (defaults to GPS; user can right-click map to reposition)
  const [radar360Center, setRadar360Center] = useState<{ lat: number; lng: number; label?: string } | null>(null);
  const [multiStopQueue, setMultiStopQueue] = useState<QueuedStop[]>([]);
  const [multiStopUnit, setMultiStopUnit] = useState<string | null>(null);
  const [multiStopPanelOpen, setMultiStopPanelOpen] = useState(false);
  const addCallToRoute = useCallback((call: ActiveCall) => {
    if (call.latitude == null || call.longitude == null) return;
    setMultiStopQueue((q) => {
      if (q.some((s) => s.callNumber === call.call_number)) return q;
      return [...q, { callNumber: call.call_number, lat: call.latitude as number, lng: call.longitude as number, label: formatIncidentType(call.incident_type) || call.location_address }];
    });
    setMultiStopPanelOpen(true);
  }, []);
  const repeatAddresses = useMapboxRepeatAddresses(mapLoaded ? mapRef.current : null);
  const [repeatAddressesEnabled, setRepeatAddressesEnabled] = useState(false);
  const serveJobs = useMapboxServeJobs(mapLoaded ? mapRef.current : null);
  const [serveJobsEnabled, setServeJobsEnabled] = useState(false);
  const optimRoutes = useMapboxOptimizationRoutes(
    mapLoaded ? mapRef.current : null,
    calls.map((c) => ({ ...c, id: Number(c.id) })),
  );
  const [incidentsEnabled, setIncidentsEnabled] = useState(false);
  const [coverageGapsEnabled, setCoverageGapsEnabled] = useState(false);
  const [responseTimeEnabled, setResponseTimeEnabled] = useState(false);
  const [safetyZonesEnabled, setSafetyZonesEnabled] = useState(false);
  const [historyCallsEnabled, setHistoryCallsEnabled] = useState(false);

  useEffect(() => {
    if (incidentsEnabled) incidentsLayer.fetchIncidents();
    else incidentsLayer.clear();
  }, [incidentsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!speedHeatmapEnabled) { speedHeatmap.clear(); return; }
    speedHeatmap.fetchHeatmap(8);
    const t = setInterval(() => speedHeatmap.fetchHeatmap(8), 60_000);
    return () => clearInterval(t);
  }, [speedHeatmapEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!speedViolationsEnabled) { speedViolationsLayer.clear(); return; }
    speedViolationsLayer.fetchViolations(4);
    const t = setInterval(() => speedViolationsLayer.fetchViolations(4), 30_000);
    return () => clearInterval(t);
  }, [speedViolationsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pursuitSegmentsEnabled) { pursuitSegmentsLayer.clear(); return; }
    pursuitSegmentsLayer.fetchSegments(4);
    const t = setInterval(() => pursuitSegmentsLayer.fetchSegments(4), 30_000);
    return () => clearInterval(t);
  }, [pursuitSegmentsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!coverageGapsEnabled || !mapRef.current) { if (!coverageGapsEnabled) coverageGaps.clear(); return; }
    const bounds = mapRef.current.getBounds();
    if (!bounds) return;
    coverageGaps.computeCoverage({
      north: bounds.getNorth(), south: bounds.getSouth(),
      east: bounds.getEast(), west: bounds.getWest(),
    });
  }, [coverageGapsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recompute Coverage Gaps on pan/zoom while the layer is active — debounced
  // since each recompute is an O(cells × units) scan over the new viewport.
  useEffect(() => {
    if (!coverageGapsEnabled || !mapRef.current) return;
    const map = mapRef.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onMoveEnd = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const bounds = map.getBounds();
        if (!bounds) return;
        coverageGaps.computeCoverage({
          north: bounds.getNorth(), south: bounds.getSouth(),
          east: bounds.getEast(), west: bounds.getWest(),
        });
      }, 500);
    };
    map.on('moveend', onMoveEnd);
    return () => { map.off('moveend', onMoveEnd); if (timer) clearTimeout(timer); };
  }, [coverageGapsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Response Time — beat-level choropleth from 30 days of real historical
  // dispatch data (not a theoretical estimate — see useMapboxResponseTime).
  // Not viewport-scoped (unlike Coverage Gaps, which regenerates a grid per
  // pan/zoom), so no moveend recompute is needed — beat.geojson is citywide.
  useEffect(() => {
    if (!responseTimeEnabled || !mapRef.current) { if (!responseTimeEnabled) responseTime.clear(); return; }
    responseTime.fetchResponseTimes();
  }, [responseTimeEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (safetyZonesEnabled) safetyZones.fetchSafetyZones();
    else safetyZones.clear();
  }, [safetyZonesEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (historyCallsEnabled) historyCalls.fetchHistory();
    else historyCalls.clear();
  }, [historyCallsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (repeatAddressesEnabled) repeatAddresses.fetchRepeats();
    else repeatAddresses.clear();
  }, [repeatAddressesEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (serveJobsEnabled) serveJobs.fetchJobs();
    else serveJobs.clear();
  }, [serveJobsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!identifyEnabled || !map) return;

    const handler = async (e: mapboxgl.MapMouseEvent) => {
      const info = await tilequery.queryFromMapClick(e);
      if (identifyPopupRef.current) { identifyPopupRef.current.remove(); identifyPopupRef.current = null; }
      infoPanel.showLocationInfo(e.lngLat.lng, e.lngLat.lat);
      if (!info) {
        if (tilequery.errorRef.current) {
          identifyPopupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, className: 'mapbox-popup-dark' })
            .setLngLat(e.lngLat)
            .setHTML(`<div style="font:11px monospace;color:${TACTICAL_ERROR};background:${TACTICAL_SURFACE_BASE};padding:4px 6px;">${tilequery.errorRef.current}</div>`)
            .addTo(map);
        }
        return;
      }
      const { lng, lat } = e.lngLat;
      const label = info.sectorName || info.city || info.county || info.state || undefined;
      const lines = [
        info.city && `City: ${info.city}`,
        info.county && `County: ${info.county}`,
        info.state && `State: ${info.state}`,
        info.sectorName && `Area: ${info.sectorName}`,
      ].filter(Boolean);
      const html = `<div style="font:11px monospace;color:${TACTICAL_TEXT_DIM};background:${TACTICAL_SURFACE_BASE};padding:4px 6px;">${lines.length ? lines.join('<br/>') : 'No data at this point'}<br/><button data-action="streetview" style="margin-top:4px;font:11px monospace;color:${TACTICAL_INFO};background:transparent;border:1px solid ${TACTICAL_INFO};padding:2px 6px;cursor:pointer;">Street View</button></div>`;
      identifyPopupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, className: 'mapbox-popup-dark' })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(map);

      const popupEl = identifyPopupRef.current.getElement();
      const onPopupClick = (evt: MouseEvent) => {
        const target = evt.target as HTMLElement;
        if (target.closest('[data-action="streetview"]')) {
          setStreetViewTarget({ lng, lat, label });
        }
      };
      popupEl?.addEventListener('click', onPopupClick);
      identifyPopupRef.current.once('close', () => {
        popupEl?.removeEventListener('click', onPopupClick);
      });
    };

    map.on('click', handler);
    return () => {
      map.off('click', handler);
      if (identifyPopupRef.current) { identifyPopupRef.current.remove(); identifyPopupRef.current = null; }
    };
  }, [identifyEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Right-click → set Radar 360 scan center when the panel is open.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const onContextMenu = (e: mapboxgl.MapMouseEvent) => {
      if (activeFloatingTool !== 'radar-360') return;
      setRadar360Center({ lat: e.lngLat.lat, lng: e.lngLat.lng, label: `${e.lngLat.lat.toFixed(4)}, ${e.lngLat.lng.toFixed(4)}` });
    };
    map.on('contextmenu', onContextMenu);
    return () => { map.off('contextmenu', onContextMenu); };
  }, [mapLoaded, activeFloatingTool]); // eslint-disable-line react-hooks/exhaustive-deps

  const traffic = useMapTraffic(mapRef.current, mapLoaded);
  const measure = useMapMeasure(mapRef.current, mapLoaded);
  const [streetViewTarget, setStreetViewTarget] = useState<StreetViewTarget | null>(null);
  const [scaleEnabled, setScaleEnabled] = useState(false);
  const [fullscreenEnabled, setFullscreenEnabled] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [snapshotGalleryOpen, setSnapshotGalleryOpen] = useState(false);
  useScaleControl(mapLoaded ? mapRef.current : null, scaleEnabled);
  useFullscreenControl(mapLoaded ? mapRef.current : null, fullscreenEnabled);
  // Layout.tsx already mounts the single upload-enabled GPS tracker for every
  // authenticated route. Without `upload: false` here, this page ran a SECOND
  // independent tracker with its own queue/interval, double-POSTing breadcrumbs
  // to /dispatch/gps (same defect NavTripContext.tsx already guards against).
  // `capture: true` opts this read-only tracker into recording an exportable
  // session track (CSV/GeoJSON) for the GPS HUD's export/clear footer — off by
  // default on useGpsTracking so the always-on Layout tracker doesn't accumulate.
  const gps = useGpsTracking({ upload: false, capture: true });
  const { isochroneEnabled, toggleIsochrone } = useMapIsochrone({
    map: mapRef.current,
    mapLoaded,
    gpsLatitude: gps.latitude,
    gpsLongitude: gps.longitude,
    addToast,
  });
  const safetyAlertFeed = useSafetyAlertFeed();

  // ── Google Maps Parity Hooks ──────────────────────────────────────────────
  const unitColorMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of units) m[u.id] = UNIT_STATUS_COLORS[u.status] || TACTICAL_TEXT_MUTED;
    return m;
  }, [units]);
  const unitIds = useMemo(() => units.map(u => u.id), [units]);
  const breadcrumbs = useMapBreadcrumbs(mapRef.current, mapLoaded, unitIds, unitColorMap);
  const geofenceAlerts = useMapGeofenceAlerts(mapRef.current, mapLoaded);
  const infoPanel = useMapInfoPanel(mapRef.current, mapLoaded, units, calls);
  const routing = useMapRouting({ map: mapRef.current });
  const dispatchConnCall = useMemo(
    () => (multiStopQueue.length > 0 ? calls.find((c) => c.call_number === multiStopQueue[0].callNumber) : undefined),
    [multiStopQueue, calls],
  );
  const placesSearch = useMapPlacesSearch(mapRef.current, mapLoaded);
  const directionsPanel = useMapDirectionsPanel(mapRef.current, mapLoaded);
  const coordGrid = useMapCoordinateGrid(mapRef.current, mapLoaded);
  const weatherRadar = useMapWeatherRadar(mapRef.current, mapLoaded);
  const weatherAlerts = useMapWeatherAlerts(mapRef.current, mapLoaded);
  // Radar 360 — only active while the panel is open; center falls back to GPS.
  const radar360ScanLat = radar360Center?.lat ?? gps.latitude;
  const radar360ScanLng = radar360Center?.lng ?? gps.longitude;
  const radar360 = useRadar360({
    lat: activeFloatingTool === 'radar-360' ? (radar360ScanLat ?? null) : null,
    lng: activeFloatingTool === 'radar-360' ? (radar360ScanLng ?? null) : null,
    refreshMs: activeFloatingTool === 'radar-360' ? 30_000 : 0,
  });
  const mapBookmarks = useMapBookmarks(mapRef.current, mapLoaded);
  const printExport = useMapPrintExport(mapRef.current, mapLoaded);
  const geoJsonLayers = useGeoJsonLayers({ map: mapRef.current, popup: null });
  const districtHierarchy = useDistrictHierarchyLayers({ map: mapRef.current, popup: null });
  // ── OSM override layer ──
  // Overrides are fetched only for the groups actually switched on; there is no
  // point pulling corrections for layers that are not drawn.
  const [osmEditTarget, setOsmEditTarget] = useState<{
    osmId: string; group: string; cat: string | null;
    categoryLabel: string; featureName: string; osmTags: Record<string, unknown>;
  } | null>(null);
  const [visibleOsmGroups, setVisibleOsmGroups] = useState<string[]>([]);
  const osmOverrides = useOsmOverrides(visibleOsmGroups);
  const featureInspect = useMapFeatureInspect(mapRef.current, mapLoaded);

  const vectorTiles = useVectorTileLayers({
    map: mapRef.current,
    // MUST be a real popup instance. Every click handler in this hook opens
    // with `if (!pop) return;`, so `popup: null` silently disables ALL of them
    // — the OSM detail popup with its captured tags and EDIT/VERIFY button,
    // and the UGRC road/address popups including their "Use This Location"
    // action that feeds an address into dispatch. None of that is reachable
    // without this. A merge that reverts this line to null turns the whole
    // popup layer back off, with no test failure to show for it.
    popup: osmPopupRef.current,
    osmOverrides: osmOverrides.byOsmId,
    osmHiddenIds: osmOverrides.hiddenIds,
    onEditOsmFeature: setOsmEditTarget,
    suppressPopup: featureInspect.enabled,
  });

  // Derive the visible OSM groups from the layer states. Sorted+joined into a
  // string so a re-render with the same set in a different order does not
  // re-trigger the fetch.
  const visibleOsmGroupKey = vectorTiles.vectorConfigs
    .filter((c) => c.source === 'osm' && vectorTiles.vectorLayerStates[c.id]?.visible)
    .map((c) => c.archive?.replace(/^osm-/, '') ?? '')
    .filter(Boolean)
    .filter((g, i, a) => a.indexOf(g) === i)
    .sort()
    .join(',');
  useEffect(() => {
    setVisibleOsmGroups(visibleOsmGroupKey ? visibleOsmGroupKey.split(',') : []);
  }, [visibleOsmGroupKey]);
  const activityChoropleth = useActivityChoropleth({
    map: mapRef.current,
    calls,
    level: districtHierarchy.hierarchyStates['area']?.visible ? 'area'
      : districtHierarchy.hierarchyStates['sector']?.visible ? 'sector'
      : districtHierarchy.hierarchyStates['zone']?.visible ? 'zone'
      : null,
  });
  const [hoveredFeature, setHoveredFeature] = useState<InspectedFeature | null>(null);
  const inspectMarkerRef = useRef<mapboxgl.Marker | null>(null);

  const HIGHLIGHT_SOURCE = 'rmpg-inspect-highlight';

  // React never fires onMouseLeave on unmount (e.g. Identify toggled off from
  // the toolbar while the cursor is still over a hovered row) — clear the
  // highlight whenever the panel is going away so it can't outlive it.
  useEffect(() => {
    if (!featureInspect.enabled || !featureInspect.result) {
      setHoveredFeature(null);
    }
  }, [featureInspect.enabled, featureInspect.result]);

  // Highlight the hovered inspector row on the map, so the panel and the
  // geometry it describes stay visually tied.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const ensureHighlightLayers = () => {
      if (map.getSource(HIGHLIGHT_SOURCE)) return;
      // A hover can land in the window after map.setStyle() clears every
      // source/layer but before 'style.load' fires — addSource would throw
      // from inside this effect. Skip; the style.load listener below re-runs
      // this setup once the new style is ready, so guarding costs nothing.
      if (!map.isStyleLoaded()) return;
      map.addSource(HIGHLIGHT_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: `${HIGHLIGHT_SOURCE}-line`, type: 'line', source: HIGHLIGHT_SOURCE,
        paint: { 'line-color': TACTICAL_TEXT_NEAR_WHITE, 'line-width': 3, 'line-opacity': 0.9 },
      });
      map.addLayer({
        id: `${HIGHLIGHT_SOURCE}-point`, type: 'circle', source: HIGHLIGHT_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 9, 'circle-color': 'transparent',
          'circle-stroke-color': TACTICAL_TEXT_NEAR_WHITE, 'circle-stroke-width': 2,
        },
      });
    };

    const setHighlightData = () => {
      const src = map.getSource(HIGHLIGHT_SOURCE) as mapboxgl.GeoJSONSource | undefined;
      src?.setData(hoveredFeature
        ? { type: 'Feature', properties: {}, geometry: hoveredFeature.geometry as any }
        : { type: 'FeatureCollection', features: [] });
    };

    ensureHighlightLayers();
    setHighlightData();

    // changeStyle() (MapCore.ts) calls map.setStyle(), which wipes every
    // source/layer and fires 'style.load' again — re-add the highlight
    // source/layers then too, or a basemap switch during an active hover
    // silently loses the highlight until hoveredFeature happens to change.
    const onStyleLoad = () => {
      ensureHighlightLayers();
      setHighlightData();
    };
    map.on('style.load', onStyleLoad);
    return () => { map.off('style.load', onStyleLoad); };
  }, [mapLoaded, hoveredFeature]);

  // A panel puts the answer away from the point the officer clicked; the marker
  // is what keeps the two connected.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    inspectMarkerRef.current?.remove();
    inspectMarkerRef.current = null;
    if (!featureInspect.result) return;
    inspectMarkerRef.current = new mapboxgl.Marker({ color: TACTICAL_SILVER })
      .setLngLat(featureInspect.result.lngLat)
      .addTo(map);
    return () => { inspectMarkerRef.current?.remove(); inspectMarkerRef.current = null; };
  }, [featureInspect.result]);

  const mapMatchTrace = useMapMatchTrace(mapRef.current, mapLoaded);
  const glDraw = useMapboxDraw(mapRef.current, mapLoaded);
  const [deckEnabled, setDeckEnabled] = usePersistedState('rmpg_mapbox_deck', false);
  const [buildings3dEnabled, setBuildings3dEnabled] = usePersistedState('rmpg_mapbox_3d_buildings', true);
  const [showPlacesMenu, setShowPlacesMenu] = useState(false);
  const [showDirectionsPanel, setShowDirectionsPanel] = useState(false);
  const [showWeatherMenu, setShowWeatherMenu] = useState(false);
  const [showBookmarksPanel, setShowBookmarksPanel] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [gpsHudOpen, setGpsHudOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  interface ClosestUnitResult {
    unit: { id: string; call_sign: string; latitude: number | null; longitude: number | null; status: string };
    distance: number;
    duration: number;
  }
  const [dispatchConnectionsOpen, setDispatchConnectionsOpen] = useState(false);
  const [dispatchConnResults, setDispatchConnResults] = useState<ClosestUnitResult[]>([]);
  const [showGeoLayersMenu, setShowGeoLayersMenu] = useState(false);
  const [autoPanEnabled, setAutoPanEnabled] = usePersistedState('rmpg_mapbox_autopan_p1', true);
  const [p1AudioEnabled, setP1AudioEnabled] = usePersistedState('rmpg_mapbox_p1_audio', true);

  // Auto-pan to new P1 calls
  useAutoPanToP1(mapRef.current, calls, { enabled: autoPanEnabled });

  // P1 audio alert chirp
  useP1AudioAlert(calls, { enabled: p1AudioEnabled });

  // Keyboard shortcuts for map overlays
  useMapKeyboardShortcuts({
    toggleHeatmap: () => { void populateAndToggleHeatmap(); },
    toggleBreadcrumbs: () => breadcrumbs.toggle(),
    toggleClustering: () => {
      if (!clustering.enabled) {
        const clPts = calls
          .filter(c => c.latitude != null && c.longitude != null)
          .map(c => ({ id: c.id, longitude: c.longitude!, latitude: c.latitude!, priority: c.priority, label: c.call_number, color: priorityHex(c.priority) }));
        clustering.updatePoints(clPts);
      }
      clustering.toggle();
    },
    toggleDaylight: () => daylight.toggle(),
    toggleGrid: () => coordGrid.toggle(),
  });

  // ── Deck.gl GPU Overlay ────────────────────────────────────────────────────
  // Deck.gl's interleaved GPU-shared-context mode only supports Mapbox's
  // mercator/globe projections — enabling it under equalEarth/naturalEarth/etc.
  // previously threw an uncaught "Unsupported projection" error out of
  // map.addControl, which propagated to the route-level ErrorBoundary and
  // blanked the entire Map tab. Gate on the current projection here (in
  // addition to initMapboxDeckOverlay's own try/catch) so toggling GPU
  // Overlay under an unsupported projection is a no-op, not a crash.
  const deckSupportsProjection = projection.projection === 'mercator' || projection.projection === 'globe';

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (deckEnabled && deckSupportsProjection) {
      initMapboxDeckOverlay(map);

      const incidents = calls
        .filter(c => c.latitude != null && c.longitude != null)
        .map(c => ({
          id: c.id,
          position: [c.longitude!, c.latitude!] as [number, number],
          priority: c.priority,
          weight: c.priority === '1' ? 1 : c.priority === '2' ? 0.7 : 0.4,
          type: c.incident_type,
          timestamp: Date.now(),
        })) as unknown as IncidentPoint[];

      const unitPositions = units
        .filter(u => u.latitude != null && u.longitude != null)
        .map(u => ({
          id: u.id,
          position: [u.longitude!, u.latitude!] as [number, number],
          status: u.status,
          callsign: u.call_sign,
        })) as unknown as UnitPosition[];

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

    return () => { if (!deckEnabled || !deckSupportsProjection) destroyMapboxDeckOverlay(); };
  }, [deckEnabled, deckSupportsProjection, mapLoaded, calls, units]);

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

  // Toggle 3D buildings
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (buildings3dEnabled) {
      addMapbox3DBuildings(map);
    } else {
      removeMapbox3DBuildings(map);
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

  const refreshUnitsOnly = useCallback(async () => {
    try {
      const u = await apiFetch<Unit[]>('/dispatch/units');
      setUnits(u);
    } catch (err) {
      devWarn('[MapboxMap] fast units poll failed', err);
    }
  }, []);

  useEffect(() => {
    const t = setInterval(refreshUnitsOnly, UNITS_FAST_POLL_MS);
    return () => clearInterval(t);
  }, [refreshUnitsOnly]);

  // ── WebSocket Subscriptions ────────────────────────────────────────────────

  useEffect(() => {
    const unsub1 = subscribe('unit_update', () => { fetchData(); });
    const unsub2 = subscribe('dispatch_update', () => { fetchData(); });
    // gps.ts fans every breadcrumb batch out as a FLAT 'unit_position' frame
    // ({ unit_id, latitude, longitude, ... }) via AlertHubDO — distinct from
    // 'unit_update'/'dispatch_update' above, which only fire on status/roster
    // changes. Without this, unit dots on the map only moved on the
    // REFRESH_INTERVAL_MS poll instead of gliding live. Mirrors the handler
    // DispatchPage.tsx already has for the same frame.
    const unsub3 = subscribe('unit_position', (msg: any) => {
      const data = msg.data || msg;
      const uid = data.unit_id ?? data.unit?.id;
      if (uid == null) return;
      const lat = data.latitude ?? data.lat ?? data.unit?.latitude;
      const lng = data.longitude ?? data.lng ?? data.unit?.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setUnits((prev) => prev.map((u) => (String(u.id) === String(uid)
        ? { ...u, latitude: lat, longitude: lng }
        : u)));
    });
    // Geofence entry/exit alert — mirrors the panic_alert handler in DispatchPage.tsx.
    const unsub4 = subscribe('geofence_alert', (msg: any) => {
      const data = msg.data || msg;
      const verb = data.event_type === 'enter' ? 'entered' : 'exited';
      addToast(`${data.call_sign ?? `Unit ${data.unit_id}`} ${verb} ${data.zone_name ?? 'geofence zone'}`, 'info');
    });
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [subscribe, fetchData, addToast]);

  // ── PSO Job Pins ───────────────────────────────────────────────────────────
  // Active serve jobs shown as circle pins, color-coded by status/priority.
  // Source is a plain GeoJSON featureCollection updated in-place; no separate
  // marker elements so the layer survives basemap style changes via style.load.

  const PSO_SOURCE = 'pso-jobs';
  const psoMarkersRef = useRef<Map<number, mapboxgl.Marker>>(new Map());

  const refreshPsoJobs = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    try {
      const jobs = await apiFetch<any[]>('/process-server?status=pending,attempted,in_progress&limit=100');
      if (!Array.isArray(jobs)) return;

      const current = new Set<number>();
      for (const job of jobs) {
        const lat = job.recipient_lat ?? job.latitude;
        const lng = job.recipient_lng ?? job.longitude;
        if (lat == null || lng == null) continue;
        current.add(job.id);

        const color = job.priority === 'urgent' ? 'var(--sev-critical)'
          : job.priority === 'rush' ? 'var(--sev-warn)'
          : job.status === 'attempted' ? 'var(--sev-info)'
          : 'var(--text-muted)';

        const existing = psoMarkersRef.current.get(job.id);
        if (existing) {
          existing.setLngLat([lng, lat]);
          (existing.getElement().querySelector('.pso-dot') as HTMLElement | null)?.style.setProperty('background', color);
        } else {
          const el = document.createElement('div');
          el.style.cssText = 'cursor:pointer;';
          const dot = document.createElement('div');
          dot.className = 'pso-dot';
          dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.7);box-shadow:0 0 6px ${withAlpha(color, '55')};`;
          el.appendChild(dot);
          const popupBody = `<div style="font-size:11px;padding:4px 6px;"><strong>${escapeHtml(job.recipient_name ?? 'Unknown')}</strong><br/>${escapeHtml(job.status)} · ${escapeHtml(job.priority)}</div>`;
          const popup = new mapboxgl.Popup({ offset: 12, closeButton: false, className: 'mapbox-popup-dark' })
            .setHTML(popupBody);
          const marker = new mapboxgl.Marker({ element: el, occludedOpacity: 1 })
            .setLngLat([lng, lat])
            .setPopup(popup)
            .addTo(map);
          psoMarkersRef.current.set(job.id, marker);
        }
      }
      // Remove stale markers
      psoMarkersRef.current.forEach((marker, id) => {
        if (!current.has(id)) { marker.remove(); psoMarkersRef.current.delete(id); }
      });
    } catch { /* non-critical */ }
  }, [mapLoaded]);

  useEffect(() => { refreshPsoJobs(); }, [refreshPsoJobs]);
  useLiveSync('process-server', refreshPsoJobs);

  // Cleanup on unmount
  useEffect(() => () => {
    psoMarkersRef.current.forEach((m) => m.remove());
    psoMarkersRef.current.clear();
  }, []);

  // ── Unit Markers ───────────────────────────────────────────────────────────

  const enRouteEtas = useEnRouteEta(units, calls);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const currentIds = new Set<string>();

    for (const unit of units) {
      if (unit.latitude == null || unit.longitude == null) continue;
      currentIds.add(unit.id);

      const existing = unitMarkersRef.current.get(unit.id);
      if (existing) {
        const prevLngLat = existing.getLngLat();
        const el = existing.getElement();
        // The glide transition lives on the inner `[data-role="marker-inner"]`
        // wrapper, NOT the root `el` — `el` is the exact node mapboxgl.Marker
        // writes position transforms onto every frame (including during pan/
        // zoom), so it must never carry a transition on `transform` (see
        // buildUnitMarkerEl in mapMarkers.ts for the full rationale).
        const innerEl = el.querySelector<HTMLElement>('[data-role="marker-inner"]') || el;
        const animate = shouldAnimateMarkerMove(prevLngLat.lat, prevLngLat.lng, unit.latitude, unit.longitude);
        if (!animate) innerEl.style.transitionDuration = '0ms';
        existing.setLngLat([unit.longitude, unit.latitude]);
        if (!animate) {
          // NOTE: glide-on-position-update is currently a no-op — nothing
          // mutates innerEl's own transform on a normal setLngLat, so this
          // toggle has nothing to animate yet. Left in place as scaffolding
          // for a follow-up (manual requestAnimationFrame-driven translate
          // on innerEl) rather than removed, but do not assume a "normal"
          // move currently glides — it snaps, identically to a flagged jump.
          requestAnimationFrame(() => { innerEl.style.transitionDuration = ''; });
        }
        const popup = existing.getPopup();
        if (popup) popup.setHTML(buildUnitPopupHtml(unit));
        // BUG: this used to set `el.textContent = unit.call_sign` directly on
        // the marker's root element — textContent replaces ALL child nodes,
        // so it wiped out the photo-icon frame + label buildUnitMarkerEl()
        // creates, turning every marker into plain unstyled text on its very
        // first update after creation (which happens on nearly every poll/
        // WS push). Update the existing child nodes in place instead of
        // replacing the root element — mapboxgl.Marker tracks that exact
        // node internally (setLngLat writes a CSS transform onto it), so
        // swapping it out from under the library would break future moves.
        applyUnitMarkerState(existing.getElement(), unit, unit.call_number ? enRouteEtas[unit.call_number] : null);
      } else {
        const el = buildUnitMarkerEl(unit, unit.call_number ? enRouteEtas[unit.call_number] : null);
        const marker = new mapboxgl.Marker({ element: el, occludedOpacity: 1 })
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
  }, [units, mapLoaded, enRouteEtas]);

  // ── Call Markers ───────────────────────────────────────────────────────────

  useEffect(() => {
    callsRef.current = calls;
  }, [calls]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const currentIds = new Set<string>();

    // Resolves the CURRENT call data at click time (via callsRef, which the
    // effect above keeps in sync with every `calls` poll) rather than trusting
    // whatever `call` object was in scope when the marker/popup was first
    // created — a marker's popup is reused across polls (only its innerHTML
    // is refreshed via setHTML), so a closure captured at creation time would
    // go stale if the call's coordinates/fields changed on a later poll.
    const bindAddToRoutePopup = (popup: mapboxgl.Popup) => {
      const onOpen = () => {
        const popupEl = popup.getElement();
        const onPopupClick = (evt: MouseEvent) => {
          const target = evt.target as HTMLElement;
          const btn = target.closest('[data-action="add-to-route"]') as HTMLElement | null;
          if (!btn) return;
          const callNumber = btn.dataset.callNumber;
          const currentCall = callsRef.current.find((c) => c.call_number === callNumber);
          if (currentCall) addCallToRoute(currentCall);
        };
        popupEl?.addEventListener('click', onPopupClick);
        popup.once('close', () => popupEl?.removeEventListener('click', onPopupClick));
      };
      popup.on('open', onOpen);
    };

    for (const call of calls) {
      if (call.latitude == null || call.longitude == null) continue;
      currentIds.add(call.id);
      const isQueued = multiStopQueue.some((s) => s.callNumber === call.call_number);
      const assignedUnit = units.find((u) => u.call_number === call.call_number && u.status === 'enroute');
      const assignedUnitInfo = assignedUnit
        ? {
            callSign: assignedUnit.call_sign,
            etaLabel: enRouteEtas[call.call_number] ? formatEtaSeconds(enRouteEtas[call.call_number].etaSeconds) : undefined,
            distanceLabel: enRouteEtas[call.call_number] ? formatDistanceMiles(enRouteEtas[call.call_number].distanceMiles) : undefined,
          }
        : null;

      const existing = callMarkersRef.current.get(call.id);
      if (existing) {
        existing.setLngLat([call.longitude, call.latitude]);
        const popup = existing.getPopup();
        if (popup) popup.setHTML(buildCallPopupHtml(call, isQueued, Date.now(), assignedUnitInfo));
      } else {
        const el = buildCallMarkerEl(call);
        const popup = new mapboxgl.Popup({ offset: 16, closeButton: false, className: 'mapbox-popup-dark' })
          .setHTML(buildCallPopupHtml(call, isQueued, Date.now(), assignedUnitInfo));
        bindAddToRoutePopup(popup);
        const marker = new mapboxgl.Marker({ element: el, occludedOpacity: 1 })
          .setLngLat([call.longitude, call.latitude])
          .setPopup(popup)
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
  }, [calls, units, mapLoaded, multiStopQueue, addCallToRoute, enRouteEtas]);

  // ── Self-Position (GPS Marker with heading + accuracy) ──────────────────
  // Logic extracted to useMapGps hook (see hooks/useMapGps.ts)
  const { selfMarkerReady: _selfMarkerReady } = useMapGps({
    map: mapRef.current,
    mapLoaded,
    selfPosVisible,
    gps,
  });

  // ── Welfare-Check Overlays ─────────────────────────────────────────────────
  // Logic extracted to useMapWelfare hook (see hooks/useMapWelfare.ts)
  useMapWelfare({ map: mapRef.current, mapLoaded, units });

  // ── Beat Boundary Overlay ──────────────────────────────────────────────────
  // Logic extracted to useMapBeatOverlay hook (see hooks/useMapBeatOverlay.ts)
  useMapBeatOverlay({
    map: mapRef.current,
    mapLoaded,
    // Beat GeoJSON is managed by useGeoJsonLayers, not held as state here.
    // This seam accepts a beats array for future per-beat marker logic.
    beats: [],
    beatLayerVisible: geoJsonLayers.layerStates['beat']?.visible ?? false,
  });

  // ── Dispatch Connections Matrix Ranking (only while the diagnostics panel is open) ──
  // Depend on `findClosestUnit` itself, not the whole `routing` object -- useMapRouting
  // returns a plain object literal (not memoized), so `routing` is a new reference on
  // every render of this frequently-re-rendering CAD map. Depending on `routing` made
  // this effect (and its billed /mapbox/matrix call) re-fire on nearly every render
  // while the panel was open, instead of only when the bound call/units actually
  // change. findClosestUnit is a stable useCallback([], ...) reference.
  const findClosestUnit = routing.findClosestUnit;
  useEffect(() => {
    if (!dispatchConnectionsOpen || !dispatchConnCall || dispatchConnCall.latitude == null || dispatchConnCall.longitude == null) {
      setDispatchConnResults([]);
      return;
    }
    let cancelled = false;
    const unitsForMatrix = units
      .filter((u) => u.latitude != null && u.longitude != null)
      .map((u) => ({ callSign: u.call_sign, lat: u.latitude!, lng: u.longitude! }));
    if (!unitsForMatrix.length) {
      setDispatchConnResults([]);
      return;
    }
    findClosestUnit(unitsForMatrix, { lat: dispatchConnCall.latitude, lng: dispatchConnCall.longitude })
      .then((ranked) => {
        if (cancelled) return;
        const adapted: ClosestUnitResult[] = ranked
          .map((r): ClosestUnitResult | null => {
            const unit = units.find((u) => u.call_sign === r.callSign);
            if (!unit) return null;
            return {
              unit: { id: unit.id, call_sign: unit.call_sign, latitude: unit.latitude, longitude: unit.longitude, status: unit.status },
              distance: r.distanceMeters,
              duration: r.etaSec,
            };
          })
          .filter((r): r is ClosestUnitResult => r !== null);
        setDispatchConnResults(adapted);
      });
    return () => { cancelled = true; };
  }, [dispatchConnectionsOpen, dispatchConnCall, units, findClosestUnit]);

  // ── Map Style Switch ───────────────────────────────────────────────────────

  const handleStyleChange = useCallback((styleId: MapStyleId) => {
    changeStyle(styleId);
    setMapStyleId(styleId);
  }, [changeStyle, setMapStyleId]);

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

  // ── Isochrone Overlay ── extracted to useMapIsochrone hook ─────────────────

  // ── Dock Section Data (Layers left dock + Info & Tools right dock) ──────────
  // Re-bucketed from the former flat `layerGroups`/Advanced Toolbar into the new
  // docked-panes structure (Task 7 of the 2026-07 map-UI redesign). Every toggle
  // object below is copied verbatim from the old `layerGroups` array — same
  // id/label/active/onToggle/color/description/loading expressions, only
  // re-grouped. `scale`/`fullscreen`/`minimap`/`snapshot` moved out entirely to
  // `mapTopToolbarProps` (viewport chrome, not layers).

  // Behavior only. Presentation (label, icon, color, description, pinned,
  // grouping) now lives in config/layerRegistry.ts. Keys MUST match registry ids;
  // the source-scanning coverage test in useLayerBindings.test.ts
  // ('MapboxMapPage binding coverage') is the real guard against a typo'd key —
  // findUnboundLayers() itself is only exercised against synthetic maps in tests.
  const layerBindings = useMemo<LayerBindingMap>(() => ({
    // ── Live Conditions ──
    traffic: { active: traffic.enabled, onToggle: traffic.toggle },
    weather: { active: weatherRadar.enabled, onToggle: weatherRadar.toggle },
    'weather-alerts': {
      active: weatherAlerts.enabled,
      onToggle: weatherAlerts.toggle,
      loading: weatherAlerts.loading,
      error: weatherAlerts.error ?? undefined,
    },
    p1audio: { active: p1AudioEnabled, onToggle: () => setP1AudioEnabled((v: boolean) => !v) },
    autopan: { active: autoPanEnabled, onToggle: () => setAutoPanEnabled((v: boolean) => !v) },
    geofences: { active: geofenceAlerts.enabled, onToggle: geofenceAlerts.toggle },

    // ── Units & Calls ──
    breadcrumbs: { active: breadcrumbs.enabled, onToggle: breadcrumbs.toggle },
    clustering: { active: clustering.enabled, onToggle: clustering.toggle },
    incidents: { active: incidentsEnabled, onToggle: () => setIncidentsEnabled((v) => !v), loading: incidentsLayer.loading, error: incidentsLayer.error },
    'repeat-addresses': { active: repeatAddressesEnabled, onToggle: () => setRepeatAddressesEnabled((v) => !v), loading: repeatAddresses.loading, error: repeatAddresses.error },
    selfpos: { active: selfPosVisible, onToggle: () => setSelfPosVisible((v: boolean) => !v) },
    'serve-jobs': { active: serveJobsEnabled, onToggle: () => setServeJobsEnabled((v) => !v), loading: serveJobs.loading, error: serveJobs.error },
    'optim-routes': { active: optimRoutes.visible, onToggle: optimRoutes.toggle, loading: optimRoutes.loading, error: optimRoutes.error },

    // ── Historical Analysis ──
    'incident-heatmap': {
      active: incidentHeatmap.enabled,
      onToggle: incidentHeatmap.toggle,
      loading: incidentHeatmap.loading,
      error: incidentHeatmap.error ?? undefined,
    },
    heatmap: {
      active: heatmap.enabled,
      onToggle: () => { void populateAndToggleHeatmap(); },
      label: `Crime Heatmap (${heatmapMode === 'live' ? 'Live' : 'Historical'})`,
    },
    'call-history': { active: historyCallsEnabled, onToggle: () => setHistoryCallsEnabled((v) => !v), loading: historyCalls.loading, error: historyCalls.error },
    'speed-heatmap': { active: speedHeatmapEnabled, onToggle: () => setSpeedHeatmapEnabled((v) => !v), loading: speedHeatmap.loading, error: speedHeatmap.error },
    'speed-violations': { active: speedViolationsEnabled, onToggle: () => setSpeedViolationsEnabled((v) => !v), loading: speedViolationsLayer.loading, error: speedViolationsLayer.error },
    'pursuit-segments': { active: pursuitSegmentsEnabled, onToggle: () => setPursuitSegmentsEnabled((v) => !v), loading: pursuitSegmentsLayer.loading, error: pursuitSegmentsLayer.error },
    'response-time': { active: responseTimeEnabled, onToggle: () => setResponseTimeEnabled((v) => !v), loading: responseTime.loading, error: responseTime.error },

    // ── Administrative Boundaries (ids derived the same way the registry derives them) ──
    ...Object.fromEntries(districtHierarchy.hierarchyConfigs.map((cfg) => [
      `district-${cfg.id}`,
      {
        active: districtHierarchy.hierarchyStates[cfg.id]?.visible ?? false,
        onToggle: () => districtHierarchy.toggleHierarchyLayer(cfg.id),
      },
    ])),
    ...Object.fromEntries(geoJsonLayers.configs.map((cfg) => [
      `geo-${cfg.id}`,
      {
        active: geoJsonLayers.layerStates[cfg.id]?.visible ?? false,
        onToggle: () => geoJsonLayers.toggleGeoLayer(cfg.id),
      },
    ])),

    // ── UGRC + OSM vector tile layers (ids match VectorTileLayerConfig.id / the
    // layerRegistry.ts osm registry ids exactly) ──
    ...Object.fromEntries(vectorTiles.vectorConfigs.map((cfg) => [
      cfg.id,
      {
        active: vectorTiles.vectorLayerStates[cfg.id]?.visible ?? false,
        onToggle: () => vectorTiles.toggleVectorLayer(cfg.id),
      },
    ])),

    // ── Risk & Coverage ──
    'beat-coverage': {
      active: beatCoverage.enabled,
      onToggle: beatCoverage.toggle,
      loading: beatCoverage.loading,
      error: beatCoverage.error ?? undefined,
    },
    'coverage-gaps': { active: coverageGapsEnabled, onToggle: () => setCoverageGapsEnabled((v) => !v), loading: coverageGaps.loading, error: coverageGaps.error },
    'safety-zones': { active: safetyZonesEnabled, onToggle: () => setSafetyZonesEnabled((v) => !v), loading: safetyZones.loading, error: safetyZones.error },
    isochrone: { active: isochroneEnabled, onToggle: toggleIsochrone },

    // ── Terrain & 3D ──
    terrain: { active: terrainEnabled, onToggle: () => setTerrainEnabled((v: boolean) => !v) },
    buildings: { active: buildings3dEnabled, onToggle: () => setBuildings3dEnabled((v: boolean) => !v) },
    daylight: { active: daylight.enabled, onToggle: daylight.toggle },
    projection: { active: projection.projection !== 'mercator', onToggle: projection.cycle, label: `Projection: ${projection.projection}` },
    atmosphere: { active: atmosphere.enabled, onToggle: atmosphere.cycle, label: `Atmosphere: ${atmosphere.preset}` },
    grid: { active: coordGrid.enabled, onToggle: coordGrid.toggle },
    orbit: { active: cameraAnimation.animating, onToggle: () => cameraAnimation.animating ? cameraAnimation.stop() : cameraAnimation.orbit() },

    // ── Dispatch Tools ──
    directions: { active: directionsPanel.result !== null, onToggle: () => directionsPanel.result ? directionsPanel.clearDirections() : directionsPanel.setPickMode('origin') },
    'nav-overlay': { active: activeFloatingTool === 'nav-overlay', onToggle: () => setActiveFloatingTool((v) => v === 'nav-overlay' ? null : 'nav-overlay') },
    identify: { active: identifyEnabled, onToggle: () => setIdentifyEnabled((v) => !v), loading: tilequery.loading },
    places: { active: placesSearch.results.length > 0, onToggle: () => placesSearch.results.length > 0 ? placesSearch.clearResults() : placesSearch.searchCategory('restaurant') },
    bookmarks: { active: mapBookmarks.dropMode, onToggle: () => mapBookmarks.setDropMode(!mapBookmarks.dropMode) },
    'gps-hud': { active: gpsHudOpen, onToggle: () => setGpsHudOpen((v) => !v) },
    optimize: { active: multiStopPanelOpen, onToggle: () => setMultiStopPanelOpen((v) => !v) },

    // ── Measurement & Marking ──
    measure: { active: measure.mode !== 'none', onToggle: () => setShowMeasureMenu((v) => !v) },
    'buffer-ring': { active: activeFloatingTool === 'buffer-ring', onToggle: () => setActiveFloatingTool((v) => v === 'buffer-ring' ? null : 'buffer-ring') },
    annotation: { active: activeFloatingTool === 'annotation', onToggle: () => setActiveFloatingTool((v) => v === 'annotation' ? null : 'annotation') },
    'radar-360': { active: activeFloatingTool === 'radar-360', onToggle: () => { setActiveFloatingTool((v) => v === 'radar-360' ? null : 'radar-360'); setRadar360Center(null); } },

    // ── Drawing & Tracking ──
    draw: { active: drawing.mode !== 'none', onToggle: () => setShowDrawMenu((v) => !v) },
    'gl-draw': { active: glDraw.enabled, onToggle: () => glDraw.toggle() },
    'draw-geofence': { active: activeFloatingTool === 'draw-geofence', onToggle: () => setActiveFloatingTool((v) => v === 'draw-geofence' ? null : 'draw-geofence') },
    'gps-replay': { active: activeFloatingTool === 'gps-replay', onToggle: () => setActiveFloatingTool((v) => v === 'gps-replay' ? null : 'gps-replay') },
    'speed-analytics': { active: speedAnalyticsPanelOpen, onToggle: () => setSpeedAnalyticsPanelOpen((v) => !v), loading: speedZoneStats.loading },

    // ── Diagnostics ──
    inspect: { active: featureInspect.enabled, onToggle: featureInspect.toggle },
    mapmatch: { active: mapMatchTrace.collecting, onToggle: () => mapMatchTrace.collecting ? mapMatchTrace.clear() : mapMatchTrace.startCollecting() },
    deck: {
      active: deckEnabled,
      onToggle: () => setDeckEnabled((v: boolean) => !v),
      // Conditional helper text: under Equal Earth (or any non-Mercator/Globe
      // projection) the deck.gl overlay is inert, so say so rather than
      // leaving the operator with a toggle that silently does nothing.
      description: deckSupportsProjection
        ? 'Deck.gl accelerated rendering'
        : 'Deck.gl accelerated rendering (requires Mercator or Globe projection)',
    },
    'perf-hud': { active: diagnosticsOpen, onToggle: () => setDiagnosticsOpen((v) => !v) },
    'mapbox-status': { active: dispatchConnectionsOpen, onToggle: () => setDispatchConnectionsOpen((v) => !v) },
  }), [
    traffic, weatherRadar, p1AudioEnabled, setP1AudioEnabled, autoPanEnabled, setAutoPanEnabled,
    geofenceAlerts, breadcrumbs, clustering, incidentsEnabled, incidentsLayer.loading,
    incidentsLayer.error, repeatAddressesEnabled, repeatAddresses.loading, repeatAddresses.error,
    selfPosVisible, setSelfPosVisible, serveJobsEnabled, serveJobs.loading, serveJobs.error,
    optimRoutes.visible, optimRoutes.toggle, optimRoutes.loading, optimRoutes.error,
    incidentHeatmap, beatCoverage,
    heatmap, populateAndToggleHeatmap, heatmapMode,
    historyCallsEnabled, historyCalls.loading, historyCalls.error, speedHeatmapEnabled,
    speedHeatmap.loading, speedHeatmap.error, speedViolationsEnabled, speedViolationsLayer.loading,
    speedViolationsLayer.error, pursuitSegmentsEnabled, pursuitSegmentsLayer.loading,
    pursuitSegmentsLayer.error, responseTimeEnabled, responseTime.loading, responseTime.error,
    districtHierarchy, geoJsonLayers, vectorTiles, coverageGapsEnabled, coverageGaps.loading, coverageGaps.error,
    safetyZonesEnabled, safetyZones.loading, safetyZones.error, isochroneEnabled, toggleIsochrone,
    terrainEnabled, setTerrainEnabled, buildings3dEnabled, setBuildings3dEnabled, daylight,
    projection, atmosphere, coordGrid, cameraAnimation, directionsPanel, activeFloatingTool,
    setActiveFloatingTool, identifyEnabled, tilequery.loading, placesSearch, mapBookmarks,
    gpsHudOpen, setGpsHudOpen, multiStopPanelOpen, measure.mode, setShowMeasureMenu, drawing.mode,
    setShowDrawMenu, glDraw, speedAnalyticsPanelOpen, speedZoneStats.loading, featureInspect,
    mapMatchTrace, deckEnabled, deckSupportsProjection, setDeckEnabled, diagnosticsOpen,
    setDiagnosticsOpen, dispatchConnectionsOpen, setDispatchConnectionsOpen,
  ]);

  // Dev-only wiring guard. buildDockSections SILENTLY drops any registry layer
  // that has no binding, so a typo'd binding key makes a dispatch layer vanish
  // with no error at all. Warn (never throw) so a mis-wire is loud in dev and
  // can never break the map in production.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const { missingBinding, unknownBinding } = findUnboundLayers(layerBindings);
    if (missingBinding.length) {
      console.warn('[map] registry layers with no binding (will not render):', missingBinding.join(', '));
    }
    if (unknownBinding.length) {
      console.warn('[map] bindings with no registry layer (likely typo\'d id):', unknownBinding.join(', '));
    }
  }, [layerBindings]);

  const mapLeftDockSections = useMemo(
    () => buildDockSections(LEFT_DOCK_GROUPS, layerBindings),
    [layerBindings],
  );
  const mapRightDockSections = useMemo(
    () => buildDockSections(RIGHT_DOCK_GROUPS, layerBindings),
    [layerBindings],
  );

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

  // ── Docked-panes composition props ─────────────────────────────────────────

  // Props for the extracted Roster dock (Units/Calls). NOTE: MapRosterDock (Task 2)
  // declared its RosterUnit/RosterCall prop types with numeric id/priority, but the
  // live map data (MapUnit/ActiveCall) uses string id/priority. The component only
  // reads fields both shapes share and never does arithmetic on id/priority, so the
  // data is runtime-compatible; the casts below bridge the nominal type gap without
  // touching Task 2's committed component or its test. (Follow-up: align MapRosterDock's
  // prop types to the domain MapUnit/ActiveCall types to drop these casts.)
  const mapRosterDockProps: MapRosterDockProps = {
    open: sidebarOpen,
    onOpenChange: setSidebarOpen,
    units: units as unknown as RosterUnit[],
    calls: calls as unknown as RosterCall[],
    activeTab,
    onTabChange: setActiveTab,
    isMobile,
    onFlyToUnit: flyToUnit as unknown as (u: RosterUnit) => void,
    onFlyToCall: flyToCall as unknown as (c: RosterCall) => void,
    onShowNearestUnit: showNearestUnit as unknown as (c: RosterCall) => void,
    onRefresh: silentRefresh,
    onFlyToSelf: flyToSelf,
  };

  // Props for the slim top toolbar (map chrome + bookmarks + snapshot export).
  const mapTopToolbarProps = {
    scaleEnabled, onToggleScale: () => setScaleEnabled((v) => !v),
    fullscreenEnabled, onToggleFullscreen: () => setFullscreenEnabled((v) => !v),
    minimapOpen, onToggleMinimap: () => setMinimapOpen((v) => !v),
    mapStyle, onStyleChange: handleStyleChange,
    showBookmarksPanel, onToggleBookmarks: () => setShowBookmarksPanel((v) => !v),
    legendOpen, onToggleLegend: () => setLegendOpen((v) => !v),
    onSnapshot: () => {
      const c = mapRef.current?.getCenter();
      if (c) snapshot.captureSnapshot({ lng: c.lng, lat: c.lat, zoom: mapRef.current?.getZoom() ?? 14 });
      setSnapshotGalleryOpen(true);
    },
    onExportImage: () => { void printExport.exportImage(); },
  };

  // Mapbox GL does not auto-detect a container resize that isn't driven by a window
  // resize event. In the new docked-panes layout the map canvas is a flex sibling of
  // the docks, so crossing the 1024px breakpoint (docks ⇄ bottom tray) or toggling the
  // Roster dock open/closed changes the canvas width WITHOUT the window resizing — the
  // canvas would render stale-sized until something calls resize(). Re-measure on both.
  useEffect(() => {
    mapRef.current?.resize();
  }, [isDockNarrow, sidebarOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (mapError) {
    return (
      <div className="flex items-center justify-center bg-surface-base" style={{ position: 'absolute', inset: 0 }}>
        <div className="bg-surface-raised border border-border-default p-6 max-w-md text-center" style={{ borderRadius: 2 }}>
           <AlertTriangle className="w-10 h-10 text-brand-gold-500 mx-auto mb-3" />
           <h2 className="text-rmpg-200 text-sm font-semibold mb-2">MAP UNAVAILABLE</h2>
           <p className="text-rmpg-400 text-xs mb-4">{mapError}</p>
           <div className="text-left bg-surface-deep border border-border-subtle p-3 mb-4 text-[10px] text-rmpg-400" style={{ borderRadius: 2 }}>
             <p className="font-semibold text-rmpg-300 mb-1">To fix this issue:</p>
             <ol className="list-decimal list-inside space-y-1">
               <li>Go to <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noopener noreferrer" className="text-brand-gold-500 underline">account.mapbox.com/access-tokens</a> and verify your token is active.</li>
               <li>Ensure the token has the required scopes: <span className="font-mono text-rmpg-300">styles:read</span>, <span className="font-mono text-rmpg-300">styles:tiles</span>, <span className="font-mono text-rmpg-300">fonts:read</span>.</li>
               <li>If expired or revoked, create a new public token and copy it.</li>
               <li>Navigate to <a href="/admin?tab=integrations" className="text-brand-gold-500 underline">Admin → Integrations → Mapbox</a> and paste the new token.</li>
               <li>Alternatively, set the <span className="font-mono text-rmpg-300">MAPBOX_ACCESS_TOKEN</span> environment variable on the server.</li>
             </ol>
           </div>
           <div className="flex flex-col gap-2 items-center">
             <a
               href="/admin?tab=integrations"
               className="text-brand-gold-500 text-xs underline hover:text-brand-gold-400"
             >
               Configure in Admin → Integrations
             </a>
             <button
               onClick={() => setRetryNonce(n => n + 1)}
               className="text-brand-gold-500 text-xs hover:text-brand-gold-400 transition-colors"
             >
               ↻ Retry Mapbox
             </button>
           </div>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <MapContext.Provider value={{
      map: mapRef.current,
      units,
      calls,
      beats: [], // beat GeoJSON owned by useGeoJsonLayers; this param is for future per-beat UI
    }}>
    <MapDensityProvider>
    <div className="tactical-dark relative w-full overflow-hidden bg-surface-base flex flex-col" style={{ height: '100%', minHeight: '100%' }}>
      {/* ── Region 1: Top toolbar (desktop/tablet only) ── */}
      {!isDockNarrow && <MapTopToolbar {...mapTopToolbarProps} />}
      {/* Beat Planner — supervisor+ toolbar button */}
      {!isDockNarrow && isSupervisorPlusMap && (
        <div className="absolute top-9 right-2 z-30 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowBeatPlanner(true)}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-rmpg-700 hover:bg-rmpg-600 text-rmpg-100 transition-colors"
            style={{ borderRadius: 2 }}
            title="Optimize patrol beat assignments"
          >
            Beat Planner
          </button>
          {beatRoutes && (
            <span className="text-[10px] text-rmpg-400">
              {beatRoutes.length} route(s) planned
            </span>
          )}
        </div>
      )}

      {/* ── Middle row: Roster dock · Layers dock · Map canvas · Info & Tools dock ── */}
      <div className="relative flex-1 flex overflow-hidden">
        {!isDockNarrow && <MapRosterDock {...mapRosterDockProps} />}
        {!isDockNarrow && <MapLeftDock sections={mapLeftDockSections} />}

        {/* ── Region: Map canvas + all map-anchored overlays ── */}
        <div className="relative flex-1">
      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-base/90">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-brand-gold-500 animate-spin" />
            <span className="text-rmpg-300 text-xs font-mono">INITIALIZING MAP…</span>
          </div>
        </div>
      )}

      {/* WebGL context-lost: brief overlay while recovery rebuild is pending */}
      {isContextLost && !loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-base/80 pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
            <span className="text-rmpg-300 text-xs font-mono">MAP RECONNECTING…</span>
          </div>
        </div>
      )}

      {/* WebGL loop-guard tripped — GPU too unstable for auto-recovery */}
      {needsManualReload && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-base/90">
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <span className="text-rmpg-100 text-sm font-mono">MAP GPU CRASH</span>
            <span className="text-rmpg-400 text-xs">The map GPU context crashed repeatedly. Reload the page to restore the map.</span>
            <button
              onClick={() => window.location.reload()}
              className="mt-1 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-mono"
              style={{ borderRadius: 2 }}
            >
              RELOAD PAGE
            </button>
          </div>
        </div>
      )}

      {/* Map Container — explicit w/h ensures Mapbox GL gets a sized element */}
      <div ref={mapContainerRef} className="absolute inset-0" style={{ width: '100%', height: '100%' }} />
      {/* Role-adaptive overlay shell — renders controls appropriate for the user's role */}
      <MapLayout />


      {/* Search Box v6 — React component overlay replacing the imperative geocoder plugin */}
      {mapboxToken && !mapLibreFallback && <MapSearchBox accessToken={mapboxToken} />}

      {/* Measure / Draw dropdown bodies — their launcher buttons now live in the
          Right Dock's Analysis section (measure / draw items). The bodies mount here
          at the map canvas root, gated on showMeasureMenu / showDrawMenu exactly as
          before, just no longer nested inside the removed Advanced Toolbar. */}
      {showMeasureMenu && (
        <div className="absolute top-16 right-3 z-30 bg-surface-raised border border-border-default w-36 overflow-hidden" style={{ borderRadius: 2 }}>
          <button
            onClick={() => { measure.setMode('distance'); setShowMeasureMenu(false); }}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
              measure.mode === 'distance' ? 'text-brand-gold-500 bg-surface-overlay' : 'text-rmpg-300 hover:bg-surface-overlay'
            }`}
          >
            📏 Distance
          </button>
          <button
            onClick={() => { measure.setMode('area'); setShowMeasureMenu(false); }}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
              measure.mode === 'area' ? 'text-brand-gold-500 bg-surface-overlay' : 'text-rmpg-300 hover:bg-surface-overlay'
            }`}
          >
            📐 Area
          </button>
          {measure.mode !== 'none' && (
            <button
              onClick={() => { measure.clear(); setShowMeasureMenu(false); }}
              className="w-full text-left px-3 py-1.5 text-xs text-rmpg-400 hover:bg-surface-overlay"
            >
              ✕ Clear
            </button>
          )}
        </div>
      )}

      {showDrawMenu && (
        <div className="absolute top-16 right-3 z-30 bg-surface-raised border border-border-default w-40 overflow-hidden" style={{ borderRadius: 2 }}>
          <button
            onClick={() => { drawing.setMode('polygon'); setShowDrawMenu(false); }}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
              drawing.mode === 'polygon' ? 'text-brand-gold-500 bg-surface-overlay' : 'text-rmpg-300 hover:bg-surface-overlay'
            }`}
          >
            ▬ Polygon (geofence)
          </button>
          <button
            onClick={() => { drawing.setMode('polyline'); setShowDrawMenu(false); }}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
              drawing.mode === 'polyline' ? 'text-brand-gold-500 bg-surface-overlay' : 'text-rmpg-300 hover:bg-surface-overlay'
            }`}
          >
            ╱ Polyline (route)
          </button>
          <button
            onClick={() => { drawing.setMode('circle'); setShowDrawMenu(false); }}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
              drawing.mode === 'circle' ? 'text-brand-gold-500 bg-surface-overlay' : 'text-rmpg-300 hover:bg-surface-overlay'
            }`}
          >
            ◯ Circle (perimeter)
          </button>
          <div className="border-t border-border-default" />
          <button
            onClick={() => { drawing.undo(); }}
            className="w-full text-left px-3 py-1.5 text-xs text-rmpg-400 hover:bg-surface-overlay"
          >
            ↩ Undo last shape
          </button>
          <button
            onClick={() => { drawing.clearAll(); drawing.setMode('none'); setShowDrawMenu(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-surface-overlay"
          >
            ✕ Clear all shapes
          </button>
        </div>
      )}

      {/* Measurement Result Banner */}
      {measure.result && measure.mode === 'none' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-surface-raised/95 border border-border-default px-4 py-2 backdrop-blur-sm flex items-center gap-3" style={{ borderRadius: 2 }}>
          <Ruler className="w-3.5 h-3.5 text-brand-gold-500" />
          <span className="text-rmpg-200 text-xs font-mono">
            {measure.result.distanceFormatted}
            {measure.result.areaFormatted && ` · ${measure.result.areaFormatted}`}
          </span>
          <button onClick={() => measure.clear()} className="text-rmpg-400 hover:text-rmpg-200 text-xs">✕</button>
        </div>
      )}

      {/* Drawing Mode Indicator */}
      {drawing.mode !== 'none' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-surface-raised/95 border border-brand-gold-500/30 px-4 py-2 backdrop-blur-sm flex items-center gap-3" style={{ borderRadius: 2 }}>
          <PenTool className="w-3.5 h-3.5 text-brand-gold-500" />
          <span className="text-brand-gold-500 text-xs font-mono">
            DRAWING: {drawing.mode.toUpperCase()} — {drawing.mode === 'circle' ? 'Click center, then edge' : 'Click to add points, double-click to finish'}
          </span>
          <button onClick={() => drawing.setMode('none')} className="text-rmpg-400 hover:text-rmpg-200 text-xs">✕ Cancel</button>
        </div>
      )}

      {/* Drawing Shapes Count */}
      {drawing.shapes.length > 0 && drawing.mode === 'none' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-surface-raised/95 border border-border-default px-3 py-1.5 backdrop-blur-sm flex items-center gap-2" style={{ borderRadius: 2 }}>
          <span className="text-rmpg-300 text-[10px] font-mono">{drawing.shapes.length} shape(s) drawn</span>
          <button onClick={() => drawing.clearAll()} className="text-rmpg-400 hover:text-red-400 text-[10px]">Clear all</button>
        </div>
      )}

      {/* GL Draw Feature Count */}
      {glDraw.enabled && glDraw.featureCount > 0 && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 bg-surface-raised/95 border border-brand-gold-500/20 px-3 py-1.5 backdrop-blur-sm flex items-center gap-2" style={{ borderRadius: 2 }}>
          <Grid3X3 className="w-3 h-3 text-brand-gold-500" />
          <span className="text-rmpg-300 text-[10px] font-mono">{glDraw.featureCount} GL Draw feature(s)</span>
          <button onClick={() => glDraw.deleteAll()} className="text-rmpg-400 hover:text-red-400 text-[10px]">Clear</button>
        </div>
      )}

      {/* Active Route Panel */}
      {routing.activeRoute && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30 bg-surface-raised/95 border border-border-default px-4 py-2 backdrop-blur-sm flex items-center gap-4" style={{ borderRadius: 2 }}>
          <Route className="w-4 h-4 text-brand-gold-500" />
          <div className="text-xs font-mono">
            <span className="text-rmpg-200 font-semibold">{routing.activeRoute.unitCallSign}</span>
            <span className="text-rmpg-500 mx-1">→</span>
            <span className="text-rmpg-200 font-semibold">{routing.activeRoute.callNumber}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-brand-gold-500 font-semibold">{routing.activeRoute.eta}</span>
            <span className="text-rmpg-500">·</span>
            <span className="text-rmpg-300">{routing.activeRoute.distance}</span>
          </div>
          <button onClick={() => routing.clearRoute()} className="text-rmpg-400 hover:text-rmpg-200 text-xs">✕</button>
        </div>
      )}

      {/* Safety Alert Ticker — unified panic/welfare/premise-alert feed */}
      <SafetyAlertTicker
        items={safetyAlertFeed.items}
        count={safetyAlertFeed.count}
        loading={safetyAlertFeed.loading}
      />

      {/* Measurement & Analysis Tools — Buffer Ring */}
      {activeFloatingTool === 'buffer-ring' && mapRef.current && (
        <div className="absolute top-16 right-3 z-30">
          <BufferRingTool map={mapRef.current} onClose={() => setActiveFloatingTool(null)} />
        </div>
      )}
      {activeFloatingTool === 'annotation' && mapRef.current && (
        <div className="absolute top-16 right-3 z-30">
          <AnnotationTool map={mapRef.current} onClose={() => setActiveFloatingTool(null)} />
        </div>
      )}
      {activeFloatingTool === 'draw-geofence' && mapRef.current && (
        <div className="absolute top-16 right-3 z-30">
          <DrawGeofenceTool map={mapRef.current} onClose={() => setActiveFloatingTool(null)} />
        </div>
      )}
      {activeFloatingTool === 'gps-replay' && mapRef.current && (
        <div className="absolute top-16 right-3 z-30">
          <GpsReplayTool map={mapRef.current} onClose={() => setActiveFloatingTool(null)} />
        </div>
      )}
      {activeFloatingTool === 'nav-overlay' && mapRef.current && (
        <div className="absolute top-16 right-3 z-30">
          <NavOverlayTool map={mapRef.current} onClose={() => setActiveFloatingTool(null)} />
        </div>
      )}
      {multiStopPanelOpen && (
        <div className="absolute top-16 right-3 z-30">
          <MultiStopRoutePanel
            queue={multiStopQueue}
            units={units}
            selectedUnit={multiStopUnit}
            result={routing.multiStopRoute}
            loading={routing.multiStopLoading}
            isMobile={isDockNarrow}
            onSelectUnit={setMultiStopUnit}
            onRemoveStop={(callNumber) => setMultiStopQueue((q) => q.filter((s) => s.callNumber !== callNumber))}
            onClear={() => { setMultiStopQueue([]); routing.clearMultiStop(); }}
            onOptimize={() => {
              const unit = units.find((u) => u.call_sign === multiStopUnit);
              if (unit?.latitude != null && unit?.longitude != null && multiStopUnit) {
                routing.showMultiStopRoute(multiStopUnit, { lat: unit.latitude, lng: unit.longitude }, multiStopQueue);
              }
            }}
          />
        </div>
      )}

      {featureInspect.enabled && featureInspect.result && (
        <FeatureInspectorPanel
          result={featureInspect.result}
          selectedIndex={featureInspect.selectedIndex}
          onSelect={featureInspect.select}
          onClose={featureInspect.clear}
          onHoverFeature={setHoveredFeature}
          osmOverrides={osmOverrides.byOsmId}
          onEditOsmFeature={setOsmEditTarget}
        />
      )}

      {speedAnalyticsPanelOpen && (
        <SpeedAnalyticsPanel
          zoneStats={speedZoneStats.zoneStats}
          coverage={speedZoneStats.coverage}
          loading={speedZoneStats.loading}
          onClose={() => setSpeedAnalyticsPanelOpen(false)}
        />
      )}
      {speedGraphUnit && (
        <SpeedGraphOverlay
          unitId={speedGraphUnit.unitId}
          callSign={speedGraphUnit.callSign}
          hours={4}
          onClose={() => setSpeedGraphUnit(null)}
        />
      )}

      {gpsHudOpen && (
        <div className="absolute top-16 right-3 z-30">
          <GpsHud
            gps={gps}
            nav={{ activeRoute: routing.activeRoute, routeProgress: routing.routeProgress, offRoute: routing.offRoute }}
            onExport={(format) => {
              const { filename, mime, content } = gps.exportTrack(format);
              downloadGpsHudTrack(filename, mime, content);
            }}
            onClear={() => gps.clearCapturedTrack()}
            onClose={() => setGpsHudOpen(false)}
          />
        </div>
      )}

      {diagnosticsOpen && mapRef.current && (
        <MapDiagnosticsOverlay map={mapRef.current} />
      )}

      {dispatchConnectionsOpen && (
        <MapboxDispatchConnections
          call={dispatchConnCall}
          results={dispatchConnResults}
          matrixActive={dispatchConnResults.length > 0}
          directionsActive={directionsPanel.result !== null}
        />
      )}

      {streetViewTarget && (
        <StreetViewLightbox target={streetViewTarget} onClose={() => setStreetViewTarget(null)} />
      )}

      {minimapOpen && mapRef.current && (
        <MinimapControl parentMap={mapRef.current} onClose={() => setMinimapOpen(false)} />
      )}

      {/* Radar timeline / opacity / legend — only while the Weather layer is on.
          The layer toggle itself stays in the Live Conditions dock section. */}
      {weatherRadar.enabled && <WeatherRadarControl radar={weatherRadar} />}

      {/* Radar 360 — situational awareness panel. Right-click map to reposition scan center. */}
      {activeFloatingTool === 'radar-360' && (
        <div className="absolute top-16 left-3 z-30">
          <Radar360Panel
            radar={radar360}
            centerLabel={radar360Center?.label ?? (gps.latitude != null ? 'GPS' : undefined)}
            onClose={() => { setActiveFloatingTool(null); setRadar360Center(null); }}
          />
        </div>
      )}

      {snapshotGalleryOpen && (
        <div
          className="absolute top-11 right-3 z-30 bg-surface-raised/95 border border-border-default backdrop-blur-sm font-mono overflow-hidden"
          style={{ borderRadius: 2, width: 220, maxHeight: 340, boxShadow: '0 8px 28px rgb(0 0 0 / 0.55)' }}
        >
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border-subtle">
            <span className="text-[10px] font-black tracking-wider text-brand-gold-500 flex-1 uppercase">
              Snapshots
            </span>
            {snapshot.snapshots.length > 0 && (
              <button
                onClick={() => snapshot.clearSnapshots()}
                aria-label="Clear all snapshots"
                className="text-[8px] text-rmpg-500 hover:text-red-400 uppercase tracking-wider"
              >
                Clear
              </button>
            )}
            <button
              onClick={() => setSnapshotGalleryOpen(false)}
              aria-label="Close snapshot gallery"
              className="text-rmpg-500 hover:text-rmpg-300 flex"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="scrollbar-dark overflow-y-auto p-2 grid grid-cols-2 gap-2" style={{ maxHeight: 280 }}>
            {snapshot.snapshots.length === 0 ? (
              <div className="col-span-2 text-[10px] text-rmpg-500 py-2 text-center">
                No snapshots yet.
              </div>
            ) : (
              snapshot.snapshots.map((s) => {
                const snapshotTime = new Date(s.timestamp).toLocaleTimeString('en-US', { timeZone: 'America/Denver' }); // new-date-ok
                return (
                <div key={s.timestamp} className="relative group">
                  <img
                    src={s.url}
                    alt={`Snapshot at ${snapshotTime}`}
                    className="w-full h-auto border border-border-subtle"
                    style={{ borderRadius: 2 }}
                  />
                  <button
                    onClick={() => snapshot.removeSnapshot(s.timestamp)}
                    aria-label="Remove snapshot"
                    className="absolute top-0.5 right-0.5 bg-surface-base/90 text-rmpg-400 hover:text-red-400 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ borderRadius: 2 }}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              );})
            )}
          </div>
        </div>
      )}

      {infoPanel.panel && (
        <div
          className="absolute bottom-14 left-1/2 -translate-x-1/2 z-40 bg-surface-raised/95 border border-border-default backdrop-blur-sm font-mono text-[11px] text-rmpg-200"
          style={{ borderRadius: 2, width: 280, boxShadow: '0 8px 28px rgb(0 0 0 / 0.55)' }}
        >
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border-subtle">
            <div>
              <div className="text-brand-gold-500 font-bold text-[11px]">{infoPanel.panel.title}</div>
              {infoPanel.panel.subtitle && <div className="text-rmpg-500 text-[9px]">{infoPanel.panel.subtitle}</div>}
            </div>
            <button onClick={infoPanel.closePanel} aria-label="Close location info" className="text-rmpg-500 hover:text-rmpg-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-2.5 py-2 space-y-1.5">
            {infoPanel.loading && <div className="text-rmpg-500 text-[10px]">Loading nearby info…</div>}
            {infoPanel.panel.weather && (
              <div className="text-[10px]">
                {infoPanel.panel.weather.condition}, {infoPanel.panel.weather.temp} · Wind {infoPanel.panel.weather.wind}
              </div>
            )}
            {infoPanel.panel.nearby && infoPanel.panel.nearby.length > 0 && (
              <div className="space-y-0.5">
                <div className="text-[8px] text-rmpg-500 uppercase tracking-wider">Nearby</div>
                {infoPanel.panel.nearby.slice(0, 5).map((n) => (
                  <div key={`${n.type}-${n.id}`} className="flex justify-between text-[10px]">
                    <span style={{ color: n.color || undefined }}>{n.label}</span>
                    <span className="text-rmpg-500">{n.distance}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {legendOpen && (
        <UnifiedMapLegend
          hierarchy={{
            area: districtHierarchy.hierarchyStates['area']?.visible ?? false,
            sector: districtHierarchy.hierarchyStates['sector']?.visible ?? false,
            zone: districtHierarchy.hierarchyStates['zone']?.visible ?? false,
            beat: geoJsonLayers.layerStates['beat']?.visible ?? false,
          }}
          boundaries={{
            county: geoJsonLayers.layerStates['county']?.visible ?? false,
            municipality: geoJsonLayers.layerStates['municipality']?.visible ?? false,
          }}
          statewide={{
            roads: vectorTiles.vectorLayerStates['utah_roads']?.visible ?? false,
            addresses: vectorTiles.vectorLayerStates['utah_addresses']?.visible ?? false,
          }}
          choro={activityChoropleth.choroLegend}
          categorical={[]}
          isLight={false}
          visibleOsmConfigs={vectorTiles.vectorConfigs.filter(
            (cfg) => cfg.source === 'osm' && vectorTiles.vectorLayerStates[cfg.id]?.visible,
          )}
        />
      )}

      {showBookmarksPanel && (
        <div
          className="absolute top-11 right-3 z-30 bg-surface-raised/95 border border-border-default backdrop-blur-sm font-mono overflow-hidden"
          style={{ borderRadius: 2, width: 260, maxHeight: 320, boxShadow: '0 8px 28px rgb(0 0 0 / 0.55)' }}
        >
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border-subtle">
            <Star className="w-3.5 h-3.5 text-brand-gold-500" />
            <span className="text-[10px] font-black tracking-wider text-brand-gold-500 flex-1 uppercase">
              Bookmarks
            </span>
            <span className="text-[8px] font-black text-surface-base bg-brand-gold-500 px-1.5 py-px" style={{ borderRadius: 2 }}>
              {mapBookmarks.bookmarks.length}
            </span>
          </div>
          <div className="scrollbar-dark overflow-y-auto" style={{ maxHeight: 260 }}>
            {mapBookmarks.bookmarks.length === 0 ? (
              <div className="px-2.5 py-3 text-[10px] text-rmpg-500">
                No bookmarks yet — use "Drop Bookmark" to save a location.
              </div>
            ) : (
              mapBookmarks.bookmarks.map((bm) => {
                const bmDate = new Date(bm.createdAt).toLocaleDateString('en-US', { timeZone: 'America/Denver' }); // new-date-ok
                return (
                <div
                  key={bm.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border-subtle cursor-pointer hover:bg-surface-overlay"
                  onClick={() => mapBookmarks.flyToBookmark(bm.id)}
                >
                  <span
                    className="w-2 h-2 shrink-0"
                    style={{ borderRadius: '50%', background: bm.color, boxShadow: `0 0 4px ${withAlpha(bm.color, '80')}` }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold text-rmpg-200 truncate">{bm.name}</div>
                    <div className="text-[8px] text-rmpg-500">{bmDate}</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); mapBookmarks.removeBookmark(bm.id); }}
                    aria-label={`Remove bookmark ${bm.name}`}
                    className="text-rmpg-500 hover:text-red-400 shrink-0 p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );})
            )}
          </div>
        </div>
      )}

      {/* Status Bar */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20 bg-surface-raised/95 border-t border-border-default backdrop-blur-sm"
        style={{ height: 28 }}
      >
        <div className="flex items-center justify-between h-full px-3 text-[9px] font-mono">
          {/* Unit Counts */}
          <div className="flex items-center gap-3">
            {Object.entries(unitCounts).map(([status, count]) => {
              const color = UNIT_STATUS_COLORS[status as keyof typeof UNIT_STATUS_COLORS] || TACTICAL_TEXT_MUTED;
              const label = UNIT_STATUS_LABELS[status as keyof typeof UNIT_STATUS_LABELS] || status;
              return (
                <span key={status} className="flex items-center gap-1">
                  <span
                    className="w-1.5 h-1.5"
                    style={{ borderRadius: '50%', background: color, boxShadow: `0 0 3px ${withAlpha(color, '80')}` }}
                  />
                  <span style={{ color }} className="font-semibold">{count}</span>
                  <span className="text-rmpg-500">{label}</span>
                </span>
              );
            })}
            <span className="text-rmpg-500 border-l border-border-default pl-3">
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
                  background: isConnected ? 'var(--sev-ok)' : 'var(--sev-critical)',
                  boxShadow: `0 0 4px ${withAlpha(isConnected ? 'var(--sev-ok)' : 'var(--sev-critical)', '80')}`,
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
        {/* /Map canvas */}

        {/* ── Region: Info & Tools right dock (desktop/tablet only) ── */}
        {!isDockNarrow && <MapRightDock sections={mapRightDockSections} />}

        {/* OSM override editor. Anchored over the map rather than in a portal
            so it sits inside the map's stacking context alongside the docks. */}
        {osmEditTarget && (
          <div className="absolute top-16 right-4 z-40">
            <OsmFeatureEditor
              osmId={osmEditTarget.osmId}
              group={osmEditTarget.group}
              cat={osmEditTarget.cat}
              categoryLabel={osmEditTarget.categoryLabel}
              featureName={osmEditTarget.featureName}
              osmTags={osmEditTarget.osmTags}
              existing={osmOverrides.byOsmId.get(osmEditTarget.osmId) ?? null}
              onSave={(patch) => osmOverrides.saveOverride(osmEditTarget.osmId, patch)}
              onClear={() => osmOverrides.clearOverride(osmEditTarget.osmId)}
              onClose={() => setOsmEditTarget(null)}
            />
          </div>
        )}
      </div>
      {/* /Middle row */}

      {/* ── Region 6: Bottom tabbed tray (collapses the docks below 1024px) ── */}
      {isDockNarrow && (
        <MapBottomTray
          rosterProps={mapRosterDockProps}
          leftSections={mapLeftDockSections}
          rightSections={mapRightDockSections}
        />
      )}
    </div>
    </MapDensityProvider>
    </MapContext.Provider>
  );
}
