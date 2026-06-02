import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { initMapbox, resolveMapboxAccessToken, mapboxgl, MAPBOX_STYLE_DARK, MAPBOX_STYLE_NIGHT, MAPBOX_STYLE_SATELLITE, MAPBOX_STYLE_STREETS, MAPBOX_STYLE_OUTDOORS, registerMapInstance, unregisterMapInstance, updateMapStyle, monitorTileLoading } from '../../utils/mapboxLoader';
import { devLog, devWarn } from '../../utils/devLog';
import {
  Layers,
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronUp,
  Shield,
  Eye,
  EyeOff,
  Thermometer,
  Siren,
  Search,
  Crosshair,
  Navigation2,
  Map as MapIcon,
  Globe2,
  Pencil,
  Square,
  Route,
  MapPin,
  Type,
  Trash2,
  Plus,
  Minus,
  X,
  Check,
  FileText,
  MousePointer2,
  CalendarDays,
  UserCheck,
  Copy,
  Save,
  Play,
  Pause,
  SkipForward,
  Gauge,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Loader2,
  Brain,
  ShieldAlert,
  Grab,
  Target,
  Scale,
  Car,
  Sun,
  Clock,
  RefreshCw,
  CircleDot,
  Activity,
  Ruler,
  SlidersHorizontal,
  Navigation,
} from 'lucide-react';
import type { UnitStatus } from '../../types';
import RmpgLogo from '../../components/RmpgLogo';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';
import { usePersistedTab } from '../../hooks/usePersistedState';
import { useUserPreferences } from '../../context/UserPreferencesContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { useGpsTracking } from '../../hooks/useGpsTracking';
import { useScreenWakeLock } from '../../hooks/useScreenWakeLock';
import { formatIncidentType } from '../../utils/caseNumbers';
import { generatePatrolTrackingPdf } from '../../utils/patrolTrackingPdfGenerator';
import { escapeHtml } from '../../utils/sanitize';
import { getMapPreferences } from '../../utils/mapPreferences';
import { subscribeSettings } from '../../utils/settingsBus';
import { isAndroidNative, navigateTo } from '../../utils/organicMapsNav';
import { useToast } from '../../components/ToastProvider';
import { localToday, dateToLocalYMD, safeDateTimeStr, parseTimestamp } from '../../utils/dateUtils';
import { useGeoJsonLayers, GEO_LAYER_CONFIGS, getSectionColor, type BeatDistrictEntry } from '../../hooks/useGeoJsonLayers';
import { useVectorTileLayers } from '../../hooks/useVectorTileLayers';
import { useDistrictHierarchyLayers } from '../../hooks/useDistrictHierarchyLayers';
import UnifiedMapLegend from './components/UnifiedMapLegend';
import { useWhatsHere } from '../../hooks/useWhatsHere';
import { useActivityChoropleth, type ChoroLevel } from '../../hooks/useActivityChoropleth';
import { useMapMeasureDraw, type MeasureMode } from '../../hooks/useMapMeasureDraw';
import { usePersistedState } from '../../hooks/usePersistedState';
import { getTaggedBeats } from './utils/districtGeoData';
import { useEventPlanning, PLAN_COLORS, PLAN_TYPE_LABELS, type PlanItemType } from '../../hooks/useEventPlanning';
import { useShiftPlanning, SHIFT_TYPES, type ShiftType } from '../../hooks/useShiftPlanning';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useMapRouting } from '../../hooks/useMapRouting';
import { useNavGuidance, type NavHazard } from '../../hooks/useNavGuidance';
import MobileBottomSheet from '../../components/mobile/MobileBottomSheet';
import type { MapUnit as Unit, ActiveCall, MapProperty as Property, MapStyleId } from './utils/mapConstants';
import { whenStyleReady } from './utils/safeAddSource';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS, MAP_STYLE_LABELS, MAP_STYLE_DESCRIPTIONS, getIncidentCategory, isLightMapStyle, isSatelliteStyle } from './utils/mapConstants';
import { buildUnitMarkerContent, buildIncidentMarkerContent, buildPropertyMarkerContent, buildSelfPositionMarker, injectKeyframes } from './utils/mapMarkerBuilders';
import { useMapPredictions } from './hooks/useMapPredictions';
import { useMapIntelLayers } from './hooks/useMapIntelLayers';
import { useMapClustering } from './hooks/useMapClustering';
import { useMapDragDispatch } from './hooks/useMapDragDispatch';
import { useMapPatrolCheckpoints } from './hooks/useMapPatrolCheckpoints';
import { useMapResponseRadius } from './hooks/useMapResponseRadius';
import { useMapEnforcementClusters } from './hooks/useMapEnforcementClusters';
import { useMapFleetVehicles } from './hooks/useMapFleetVehicles';
import { useMapPanicZone } from './hooks/useMapPanicZone';
import { useMapDaylightOverlay } from './hooks/useMapDaylightOverlay';
import { fetchMapConfig, type MapSettings } from './hooks/useMapConfig';
import PredictionsPanel from './components/PredictionsPanel';
import { useMapTactical } from './hooks/useMapTactical';
import TacticalToolsPanel, { type QuickDeployPreset } from './components/TacticalToolsPanel';
import AnalysisDashboardPanel from './components/AnalysisDashboardPanel';
import { useAnalysisSummary } from './hooks/useAnalysisSummary';
import MultiStopRoutePanel, { type QueuedStop } from './components/MultiStopRoutePanel';
import MapExportMenu from './components/MapExportMenu';
import { generateMapSituationReport } from '../../utils/mapSituationReportPdf';
import { useAuth } from '../../context/AuthContext';

// ============================================================
// Constants
// ============================================================

// Unit colors for breadcrumb trails — cycle through distinct colors per unit
const TRAIL_COLORS = ['#22c55e', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#f87171', '#aaaaaa', '#c084fc'];

// Static Tailwind class lookups — avoids dynamic class generation that Tailwind can't purge
const INTEL_LAYER_CLASSES: Record<string, { active: string; }> = {
  red: { active: 'bg-red-900/20 text-red-400' },
  amber: { active: 'bg-amber-900/20 text-amber-400' },
  orange: { active: 'bg-orange-900/20 text-orange-400' },
  purple: { active: 'bg-purple-900/20 text-purple-400' },
};

const PRIORITY_PILL_CLASSES: Record<string, { active: string; }> = {
  red: { active: 'bg-red-900/40 text-red-400 border border-red-700/40' },
  amber: { active: 'bg-amber-900/40 text-amber-400 border border-amber-700/40' },
  blue: { active: 'bg-gray-900/40 text-gray-400 border border-gray-700/40' },
  gray: { active: 'bg-[#0c0c0c]/40 text-gray-400 border border-gray-700/40' },
};

// Default map center (Salt Lake City)
const DEFAULT_CENTER = { lat: 40.7608, lng: -111.891 };

// Statuses that can be cleared from the call sidebar
const CLEARABLE_STATUSES = ['dispatched', 'enroute', 'onscene'];

// Priority to color name mapping for call history pills
const PRIORITY_TO_COLOR: Record<string, string> = { P1: 'red', P2: 'amber', P3: 'blue', P4: 'gray' };

// Status filter items for unit stats bar
const STATUS_FILTER_ITEMS = [
  { key: 'available', label: 'AVL', color: '#22c55e' },
  { key: 'dispatched', label: 'DSP', color: '#f59e0b' },
  { key: 'enroute', label: 'ENR', color: '#888888' },
  { key: 'onscene', label: 'ONS', color: '#a855f7' },
] as const;

// HeatmapPoint type for heatmap data
interface HeatmapPoint { latitude: number; longitude: number; count?: number; risk_weight?: number }

// Trail type for playback data
interface PlaybackTrail { unit_id: number; call_sign: string; officer_name: string; badge_number: string; points: { lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null; status: string; call_number: string | null; call_type: string | null; time: string; road_name: string | null; intersection: string | null }[] }

// Speed-to-color mapping for breadcrumb speed mode (m/s → mph thresholds)
const speedToColor = (mps: number | null): string => {
  if (mps == null || mps < 0.5) return '#666666';    // Stationary — gray
  const mph = mps * 2.237;
  if (mph < 15) return '#22c55e';   // Slow — green
  if (mph < 35) return '#eab308';   // City — yellow
  if (mph < 55) return '#f97316';   // Arterial — orange
  return '#ef4444';                 // Highway/pursuit — red
};

// Acceleration-to-color mapping for breadcrumb accel mode (m/s² → hex)
const accelToColor = (accelMps2: number | null): string => {
  if (accelMps2 == null) return '#666666';
  if (accelMps2 < -4) return '#dc2626';   // hard brake
  if (accelMps2 < -2) return '#f97316';   // decel
  if (accelMps2 < -0.5) return '#eab308'; // mild decel
  if (accelMps2 < 0.5) return '#22c55e';  // steady
  if (accelMps2 < 2) return '#84cc16';    // mild accel
  if (accelMps2 < 3) return '#f97316';    // accel
  return '#fbbf24';                         // rapid accel
};

// Unit status to color for breadcrumb status mode
const statusToColor = (status: string): string => {
  switch (status) {
    case 'dispatched': return '#f59e0b';  // amber
    case 'enroute':    return '#888888';  // blue
    case 'onscene':    return '#ef4444';  // red
    case 'available':  return '#22c55e';  // green
    case 'busy':       return '#8b5cf6';  // purple
    case 'off_duty':   return '#666666';  // gray
    default:           return '#666666';
  }
};

// ============================================================
// Main Component
// ============================================================

export default function MapPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { prefs: userPrefs } = useUserPreferences();
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
  const [mobileSheetTab, setMobileSheetTab] = useState<'layers' | 'units' | 'calls'>('layers');
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const infoWindowRef = useRef<mapboxgl.Popup | null>(null);
  const heatmapLayerRef = useRef<any | null>(null);
  const trackingLinesRef = useRef<any[]>([]);
  const mapConfigRef = useRef<MapSettings | null>(null);
  const [trackingLineCount, setTrackingLineCount] = useState(0);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapRetry, setMapRetry] = useState(0);
  const [tilesStalled, setTilesStalled] = useState(false);

  const isAuthError = mapError != null;
  const tileMonitorCleanupRef = useRef<(() => void) | null>(null);

  // Fix 28: restore layer toggle states from localStorage on mount
  const [layers, setLayers] = useState(() => {
    try {
      const saved = localStorage.getItem('rmpg_map_layers');
      if (saved) return JSON.parse(saved) as { units: boolean; incidents: boolean; properties: boolean };
    } catch { /* use defaults */ }
    return { units: true, incidents: true, properties: true };
  });

  // Fix 27+29: save layer toggle states to localStorage with debouncing
  const layerSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (layerSaveTimerRef.current) clearTimeout(layerSaveTimerRef.current);
    layerSaveTimerRef.current = setTimeout(() => {
      try { localStorage.setItem('rmpg_map_layers', JSON.stringify(layers)); } catch { /* quota exceeded */ }
    }, 300);
    return () => { if (layerSaveTimerRef.current) clearTimeout(layerSaveTimerRef.current); };
  }, [layers]);

  // Fix 40-42: data freshness tracking
  const [lastDataUpdate, setLastDataUpdate] = useState<Date>(new Date());
  const dataStaleThresholdMs = 5 * 60 * 1000; // 5 minutes
  const isDataStale = Date.now() - lastDataUpdate.getTime() > dataStaleThresholdMs;

  // Fix 42: auto-refresh stale overlay data when tab becomes visible
  const fetchAllDataRef = useRef<((options?: { silent?: boolean }) => Promise<void>) | null>(null);
  const lastVisibilityRefreshRef = useRef(0);
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastDataUpdate.getTime() > dataStaleThresholdMs) {
        if (Date.now() - lastVisibilityRefreshRef.current < 10000) return;
        lastVisibilityRefreshRef.current = Date.now();
        fetchAllDataRef.current?.({ silent: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [lastDataUpdate, dataStaleThresholdMs]);

  // Data state
  const [units, setUnits] = useState<Unit[]>([]);
  const [calls, setCalls] = useState<ActiveCall[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Heat map state — default seeded from per-user map preferences (Settings page)
  const [showHeatmap, setShowHeatmap] = useState(() => getMapPreferences().overlays.heatmap);
  const [showTrackingLines, setShowTrackingLines] = useState(true);
  const [heatmapData, setHeatmapData] = useState<HeatmapPoint[]>([]);
  const [heatmapDays, setHeatmapDays] = useState(30);
  const [heatmapMode, setHeatmapMode] = useState<'all' | 'risk' | 'type'>('all');
  const [heatmapTypeFilter, setHeatmapTypeFilter] = useState('');
  const [heatmapTypes, setHeatmapTypes] = useState<{ incident_type: string; count: number }[]>([]);
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(() => getMapPreferences().overlays.breadcrumbs);
  const [breadcrumbHours, setBreadcrumbHours] = useState(8);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [breadcrumbColorMode, setBreadcrumbColorMode] = usePersistedTab('rmpg_breadcrumb_color_mode', 'unit', ['unit', 'speed', 'status', 'accel'] as const);
  const breadcrumbLinesRef = useRef<any[]>([]);
  const speedAlertKeyedRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  // ───────────────────  Trails (speed alerts now via breadcrumb trails)  ──

  // Trail playback state
  const [playbackTrails, setPlaybackTrails] = useState<PlaybackTrail[]>([]);
  const [playbackUnit, setPlaybackUnit] = useState<number | null>(null);
  const [playbackIdx, setPlaybackIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(2);
  const playbackMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const playbackAnimRef = useRef<number | null>(null);
  const playbackSpeedLabelRef = useRef<mapboxgl.Popup | null>(null);

  // Layers panel (left) collapsed/expanded
  const [layersPanelOpen, setLayersPanelOpen] = useState(true);

  // Fix 32-33: Sidebar open/closed state and active tab persisted via usePersistedTab
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { const v = localStorage.getItem('rmpg_map_sidebar_open'); return v !== 'false'; } catch { return true; }
  });
  const [sidebarTab, setSidebarTab] = usePersistedTab('rmpg_map_sidebar', 'units', ['units', 'calls'] as const);

  // Fix 32: persist sidebar open/closed state
  useEffect(() => {
    try { localStorage.setItem('rmpg_map_sidebar_open', String(sidebarOpen)); } catch { /* noop */ }
  }, [sidebarOpen]);

  // Map style — seed from server preference if user hasn't picked one locally yet
  const serverDefaultStyle = (userPrefs?.default_map_style || 'dark') as MapStyleId;
  const [mapStyle, setMapStyle] = usePersistedTab('rmpg_map_style', serverDefaultStyle, ['dark', 'satellite', 'hybrid', 'streets', 'terrain', 'night_nav'] as const);
  const [showMapStyles, setShowMapStyles] = useState(false);

  // Live-apply: when map preferences change (Settings page, or another tab),
  // update style / base layers / overlay defaults in place — no reload.
  // Marker pulse / font / clustering / GPS flow through useMapConfig, which is
  // reactive on its own. (useGpsTracking reads gps prefs on its next tick.)
  useEffect(() => {
    return subscribeSettings((domain) => {
      if (domain !== 'map' && domain !== 'all') return;
      const p = getMapPreferences();
      setMapStyle(p.defaultStyle);
      setLayers(p.layers);
      setShowHeatmap(p.overlays.heatmap);
      setShowBreadcrumbs(p.overlays.breadcrumbs);
    });
  }, [setMapStyle]);

  // Routing
  const { activeRoute, routeLoading, routeProgress, routeGeom, offRoute, showRoute, clearRoute, updateOrigin,
          multiStopRoute, multiStopLoading, showMultiStopRoute, clearMultiStop } = useMapRouting({ map: mapInstanceRef.current });

  // Multi-stop patrol route queue (PSO client requests, welfare checks, etc.)
  const [routeQueue, setRouteQueue] = useState<QueuedStop[]>([]);
  const [routeUnit, setRouteUnit] = useState<string | null>(null);

  // Current operator — stamped onto exported situation reports.
  const { user } = useAuth();

  // Search (sidebar)
  const [searchQuery, setSearchQuery] = useState('');

  // Address search (map geocoding)
  const [addressSearch, setAddressSearch] = useState('');
  // center is captured on the initial forward-geocode and reused when
  // the user picks a result — re-fetching by place_id against Mapbox's
  // places endpoint is a search query, not a lookup, and would return
  // a less-specific feature (see AddressAutocomplete for the full
  // postmortem).
  const [addressResults, setAddressResults] = useState<{ description: string; place_id: string; center: [number, number] }[]>([]);
  const [showAddressResults, setShowAddressResults] = useState(false);
  const addressSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const addressDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Zoom-bound flags so the +/- buttons dim + disable at the map's min/max.
  const [zoomBounds, setZoomBounds] = useState<{ atMin: boolean; atMax: boolean }>({ atMin: false, atMax: false });

  // Drive-to-address navigation + dispatch-from-address. A selected search
  // result becomes a destination you can navigate to (device GPS → address,
  // turn-by-turn) or turn into a dispatch call.
  const [selectedAddr, setSelectedAddr] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [navActive, setNavActive] = useState(false);
  const [navMuted, setNavMuted] = useState(() => localStorage.getItem('rmpg-nav-voice') === 'muted');
  const [showDispatchHere, setShowDispatchHere] = useState(false);
  const [dispatchIncidentType, setDispatchIncidentType] = useState('');
  const [dispatchPriority, setDispatchPriority] = useState('P3');
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [autoAssignNearest, setAutoAssignNearest] = useState(false);

  // Clean up address search/dismiss timers on unmount
  useEffect(() => {
    return () => {
      if (addressSearchTimer.current) clearTimeout(addressSearchTimer.current);
      if (addressDismissTimer.current) clearTimeout(addressDismissTimer.current);
    };
  }, []);

  // GPS own-position
  const gps = useGpsTracking();
  // Keep the screen awake while the map is foregrounded — officers can't be
  // glancing down to wake the device mid-pursuit. Auto-released on unmount.
  useScreenWakeLock(true);
  const selfMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // WebSocket
  const { isConnected, subscribe } = useWebSocket();

  // Shift planning (area-based officer assignment)
  const shiftPlanning = useShiftPlanning();
  const [showShiftPanel, setShowShiftPanel] = useState(false);
  const [newShiftPlanName, setNewShiftPlanName] = useState('');
  const [newShiftPlanDate, setNewShiftPlanDate] = useState(() => localToday());
  const [newShiftPlanType, setNewShiftPlanType] = useState<ShiftType>('day');
  const [assignOfficerIds, setAssignOfficerIds] = useState<string[]>([]);
  const [assignUnitIds, setAssignUnitIds] = useState<string[]>([]);
  const [assignNotes, setAssignNotes] = useState('');

  // District enrichment data for beat map coloring
  const [beatDistrictMap, setBeatDistrictMap] = useState<Map<string, Map<string, BeatDistrictEntry>> | undefined>(undefined);
  const [districtSections, setDistrictSections] = useState<{ id: string; name: string }[]>([]);
  const [showDistrictLegend, setShowDistrictLegend] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<any[]>('/dispatch/geography/districts').then((districts) => {
      if (cancelled || !Array.isArray(districts) || districts.length === 0) return;
      const map = new Map<string, Map<string, BeatDistrictEntry>>();
      const sectionSet = new Map<string, string>();
      for (const d of districts) {
        if (!d.zone_id || !d.beat_id) continue;
        if (!map.has(d.zone_id)) map.set(d.zone_id, new Map());
        map.get(d.zone_id)!.set(d.beat_id, {
          sectionId: d.sector_id || '',
          sectionName: d.sector_name || '',
          zoneId: d.zone_id,
          zoneName: d.zone_name || '',
          beatId: d.beat_id,
          beatName: d.beat_name || '',
          beatDescriptor: d.beat_descriptor || '',
          dispatchCode: d.dispatch_code || '',
        });
        // sector_id arrives from the API as a number on live D1; coerce to a
        // string so the Map key, React key, getSectionColor() lookup, and the
        // localeCompare sort below all operate on strings. Without this the
        // sort threw ("e.id.localeCompare is not a function") and silently
        // killed the district sections list.
        if (d.sector_id != null && d.sector_id !== '') sectionSet.set(String(d.sector_id), d.sector_name || '');
      }
      setBeatDistrictMap(map);
      setDistrictSections(
        Array.from(sectionSet.entries())
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })),
      );
    }).catch((err) => { console.warn('[MapPage] fetch districts failed:', err); });
    return () => { cancelled = true; };
  }, []);

  // GeoJSON spatial layers (with shift planning selection integration)
  const { layerStates: geoLayerStates, toggleGeoLayer, ensureLayerLoaded, configs: geoConfigs } = useGeoJsonLayers({
    map: mapInstanceRef.current,
    popup: infoWindowRef.current,
    selectionMode: shiftPlanning.selectionMode,
    onFeatureClick: shiftPlanning.handleFeatureClick,
    selectedFeatures: shiftPlanning.selectedAreas,
    assignedFeatures: shiftPlanning.assignedFeatures,
    beatDistrictMap,
  });
  const [showGeoPanel, setShowGeoPanel] = useState(false);

  // Statewide vector-tile overlays (PMTiles: Utah roads + address points).
  // isLight keeps labels legible across basemaps; onUseLocation routes a clicked
  // address/road into the SAME pan+zoom+marker flow as the address search box,
  // so the statewide data feeds the existing dispatch location workflow.
  const { vectorLayerStates, toggleVectorLayer, vectorConfigs } = useVectorTileLayers({
    map: mapInstanceRef.current,
    popup: infoWindowRef.current,
    isLight: isLightMapStyle(mapStyle),
    onUseLocation: (info) => {
      handleAddressSelect([info.lng, info.lat], info.label);
      setAddressSearch(info.label);
    },
  });
  const [showVectorPanel, setShowVectorPanel] = useState(false);

  // District hierarchy layers (Area/Section/Zone) derived from beat geometry +
  // the dispatch_geography districts join. Beat itself stays in useGeoJsonLayers.
  const { hierarchyStates, toggleHierarchyLayer, hierarchyConfigs } = useDistrictHierarchyLayers({
    map: mapInstanceRef.current,
    popup: infoWindowRef.current,
  });

  // ── Advanced overlay tools ──────────────────────────────────
  const [showAdvTools, setShowAdvTools] = useState(false);

  // Collapsible LAYERS-panel groups (Intelligence / Analysis / Tactical) so
  // the panel stays compact — persisted across sessions.
  const [collapsedSections, setCollapsedSections] = usePersistedState<string[]>('rmpg_map_collapsed_sections', []);
  const isSecCollapsed = (id: string) => collapsedSections.includes(id);
  const toggleSec = useCallback((id: string) => {
    setCollapsedSections((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }, [setCollapsedSections]);
  const sectionHeader = (id: string, label: string) => (
    <button
      type="button"
      onClick={() => toggleSec(id)}
      aria-expanded={!isSecCollapsed(id)}
      className="w-full flex items-center justify-between px-1 mb-1.5 group"
    >
      <span className="text-[8px] text-rmpg-500 group-hover:text-rmpg-300 uppercase tracking-widest font-bold transition-colors">{label}</span>
      {isSecCollapsed(id) ? <ChevronDown className="w-2.5 h-2.5 text-rmpg-600" /> : <ChevronUp className="w-2.5 h-2.5 text-rmpg-600" />}
    </button>
  );

  const [whatsHereActive, setWhatsHereActive] = usePersistedState<boolean>('rmpg_whatshere', false);
  const [choroLevel, setChoroLevel] = usePersistedState<ChoroLevel | null>('rmpg_choro_level', null);
  const [choroSource, setChoroSource] = usePersistedState<'calls' | 'incidents'>('rmpg_choro_source', 'calls');
  const [incidentPoints, setIncidentPoints] = useState<{ latitude: number | null; longitude: number | null }[]>([]);
  const [measureMode, setMeasureMode] = useState<MeasureMode>(null);
  const [overlayOpacity, setOverlayOpacity] = usePersistedState<number>('rmpg_overlay_opacity', 1);
  const [hierLegend, setHierLegend] = useState<{ label: string; color: string }[]>([]);

  useWhatsHere({ map: mapInstanceRef.current, popup: infoWindowRef.current, active: whatsHereActive });
  const { choroLegend } = useActivityChoropleth({
    map: mapInstanceRef.current,
    calls: choroSource === 'incidents' ? incidentPoints : calls,
    level: choroLevel,
  });
  // RMS source fetch: load incident points (with coords) when the choropleth
  // is set to the Incidents source. Calls come from the live queue already.
  useEffect(() => {
    if (!choroLevel || choroSource !== 'incidents') return;
    let cancelled = false;
    apiFetch<{ latitude: number | null; longitude: number | null }[]>('/incidents?days=365&limit=1000')
      .then((rows) => { if (!cancelled) setIncidentPoints(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setIncidentPoints([]); });
    return () => { cancelled = true; };
  }, [choroLevel, choroSource]);
  const { measureResult, clearMeasure } = useMapMeasureDraw({ map: mapInstanceRef.current, mode: measureMode });

  // Layer-visibility memory: persist which Statewide / hierarchy layers are on
  // and restore them once the map is ready, so the operator's overlay setup
  // survives a reload. Wrappers keep the persisted set in sync on each toggle.
  const [savedStatewide, setSavedStatewide] = usePersistedState<string[]>('rmpg_statewide_on', []);
  const [savedHier, setSavedHier] = usePersistedState<string[]>('rmpg_hier_on', []);
  const restoredOverlaysRef = useRef(false);
  const handleToggleStatewide = useCallback((id: string) => {
    toggleVectorLayer(id);
    setSavedStatewide((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }, [toggleVectorLayer, setSavedStatewide]);
  const handleToggleHier = useCallback((id: string) => {
    toggleHierarchyLayer(id as any);
    setSavedHier((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }, [toggleHierarchyLayer, setSavedHier]);
  useEffect(() => {
    if (restoredOverlaysRef.current || !mapLoaded) return;
    restoredOverlaysRef.current = true;
    for (const id of savedStatewide) if (!vectorLayerStates[id]?.visible) toggleVectorLayer(id);
    for (const id of savedHier) if (!hierarchyStates[id]?.visible) toggleHierarchyLayer(id as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded]);

  // Categorical legend for the active Area/Section level (Zone has ~250
  // values — too many to list, so it's summarized instead).
  useEffect(() => {
    const lvl = hierarchyStates.area?.visible ? 'area' : hierarchyStates.section?.visible ? 'section' : null;
    if (!lvl) { setHierLegend([]); return; }
    let cancelled = false;
    getTaggedBeats().then((fc: any) => {
      if (cancelled) return;
      const nameKey = lvl === 'area' ? '_areaName' : '_sectionName';
      const colorKey = lvl === 'area' ? '_areaColor' : '_sectionColor';
      const seen = new Map<string, string>();
      for (const f of fc.features) {
        const n = f.properties[nameKey];
        if (n && !seen.has(n)) seen.set(n, f.properties[colorKey]);
      }
      setHierLegend(Array.from(seen.entries()).map(([label, color]) => ({ label, color })).slice(0, 40));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [hierarchyStates.area?.visible, hierarchyStates.section?.visible]);

  // Apply overlay opacity to all overlay fill layers (hierarchy + boundaries +
  // choropleth) whenever the slider or layer set changes.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    // Police-geography (Area/Section/Zone/Beat) = COLOR COVERAGE fills, blended
    // by alpha so one, several, or all can be on together. choro-fill is
    // excluded — it owns a count-driven opacity expression.
    for (const id of ['dh-area-fill', 'dh-section-fill', 'dh-zone-fill']) {
      try { if (map.getLayer(id)) map.setPaintProperty(id, 'fill-opacity', 0.22 * overlayOpacity); } catch { /* */ }
    }
    // Beat (lives in useGeoJsonLayers) joins the coverage system: keep its
    // city-colored fill, drop its outline so it reads as coverage too.
    try { if (map.getLayer('geojson-beat-fill')) map.setPaintProperty('geojson-beat-fill', 'fill-opacity', 0.22 * overlayOpacity); } catch { /* */ }
    try { if (map.getLayer('geojson-beat-line')) map.setPaintProperty('geojson-beat-line', 'line-opacity', 0); } catch { /* */ }
    // County + Municipality = OUTLINE ONLY. Kill their fills so the A/S/Z/B
    // color coverage shows through, and render their borders as neutral
    // reference lines on top (zero-blue theme).
    const boundaryLines: Record<string, [string, number, number]> = {
      'geojson-county': ['#9a9a9a', 1.5, 0.75],
      'geojson-municipality': ['#c9c9c9', 1.0, 0.6],
    };
    for (const base of Object.keys(boundaryLines)) {
      const [color, width, op] = boundaryLines[base];
      try { if (map.getLayer(`${base}-fill`)) map.setPaintProperty(`${base}-fill`, 'fill-opacity', 0); } catch { /* */ }
      try {
        if (map.getLayer(`${base}-line`)) {
          map.setPaintProperty(`${base}-line`, 'line-color', color);
          map.setPaintProperty(`${base}-line`, 'line-width', width);
          map.setPaintProperty(`${base}-line`, 'line-opacity', op * overlayOpacity);
        }
      } catch { /* */ }
    }
    // Statewide overlays (first-class): scale their line/circle opacity too.
    try { if (map.getLayer('vt-utah_roads-line')) map.setPaintProperty('vt-utah_roads-line', 'line-opacity', 0.85 * overlayOpacity); } catch { /* */ }
    try { if (map.getLayer('vt-utah_roads-label')) map.setPaintProperty('vt-utah_roads-label', 'text-opacity', overlayOpacity); } catch { /* */ }
    try { if (map.getLayer('vt-utah_addresses-circle')) map.setPaintProperty('vt-utah_addresses-circle', 'circle-opacity', 0.9 * overlayOpacity); } catch { /* */ }
    try { if (map.getLayer('vt-utah_addresses-label')) map.setPaintProperty('vt-utah_addresses-label', 'text-opacity', overlayOpacity); } catch { /* */ }

    // Z-order: lift the boundary outlines + level labels above the A/S/Z/B
    // coverage fills (which may be added later than the default-on county),
    // so the County/Municipality lines and the level labels stay visible on
    // top of the colored coverage. (Still below DOM unit/call markers.)
    for (const lid of ['geojson-county-line', 'geojson-municipality-line', 'dh-area-label', 'dh-section-label', 'dh-zone-label']) {
      try { if (map.getLayer(lid)) map.moveLayer(lid); } catch { /* */ }
    }
  }, [overlayOpacity, hierarchyStates, geoLayerStates, vectorLayerStates, choroLevel, mapLoaded]);

  // Event planning overlays
  const eventPlanning = useEventPlanning({
    map: mapInstanceRef.current,
    popup: infoWindowRef.current,
  });
  const [showEventPanel, setShowEventPanel] = useState(false);
  const [newPlanName, setNewPlanName] = useState('');

  // Tactical map feature toggles
  const [showPredictions, setShowPredictions] = useState(false);
  const [showAnalysisDashboard, setShowAnalysisDashboard] = useState(false);
  const [showTacticalTools, setShowTacticalTools] = useState(false);
  const [dragDispatchMode, setDragDispatchMode] = useState(false);
  const clusteringInitRef = useRef(false);
  const [clusteringEnabled, setClusteringEnabled] = useState(false);
  const [mapConfigVersion, setMapConfigVersion] = useState(0);

  // Apply admin cluster defaults once on mount
  useEffect(() => {
    if (!clusteringInitRef.current) {
      fetchMapConfig().then(cfg => {
        if (!clusteringInitRef.current) {
          clusteringInitRef.current = true;
          setClusteringEnabled(cfg.clustering_enabled);
        }
      });
    }
  }, []);

  // Admin layer style overrides — apply after map + GeoJSON layers are loaded
  // Uses mapConfigVersion to re-apply when admin config finishes loading
  const layerOverridesAppliedRef = useRef(false);
  useEffect(() => {
    const map = mapInstanceRef.current;
    const cfg = mapConfigRef.current;
    if (!map || !cfg || !map.loaded() || layerOverridesAppliedRef.current) return;
    layerOverridesAppliedRef.current = true;

    const LAYER_STYLE_MAP: Record<string, { fillId?: string; lineId?: string }> = {
      beat: { fillId: 'geojson-beat-fill', lineId: 'geojson-beat-line' },
      county: { fillId: 'geojson-county-fill', lineId: 'geojson-county-line' },
      municipality: { fillId: 'geojson-municipality-fill', lineId: 'geojson-municipality-line' },
      highway: { lineId: 'geojson-highway-line' },
      state_boundary: { lineId: 'geojson-state_boundary-line' },
      place: { fillId: 'geojson-place-fill', lineId: 'geojson-place-line' },
    };

    for (const [layerId, ids] of Object.entries(LAYER_STYLE_MAP)) {
      const visible = cfg.default_visible_layers.includes(layerId);

      if (ids.fillId && map.getLayer(ids.fillId)) {
        map.setLayoutProperty(ids.fillId, 'visibility', visible ? 'visible' : 'none');
        const fillColor = (cfg as any)[`layer_${layerId}_fill`];
        const fillOpacity = (cfg as any)[`layer_${layerId}_fill_opacity`];
        if (fillColor) map.setPaintProperty(ids.fillId, 'fill-color', fillColor);
        if (fillOpacity != null) map.setPaintProperty(ids.fillId, 'fill-opacity', fillOpacity);
      }
      if (ids.lineId && map.getLayer(ids.lineId)) {
        map.setLayoutProperty(ids.lineId, 'visibility', visible ? 'visible' : 'none');
        const strokeColor = (cfg as any)[`layer_${layerId}_stroke`];
        const strokeOpacity = (cfg as any)[`layer_${layerId}_stroke_opacity`];
        const strokeWeight = (cfg as any)[`layer_${layerId}_stroke_weight`];
        if (strokeColor) map.setPaintProperty(ids.lineId, 'line-color', strokeColor);
        if (strokeOpacity != null) map.setPaintProperty(ids.lineId, 'line-opacity', strokeOpacity);
        if (strokeWeight != null) map.setPaintProperty(ids.lineId, 'line-width', strokeWeight);
      }
    }
  }, [mapLoaded, mapConfigVersion]);

  // Marker CSS injection — pulse animations + font size
  const markerStyleRef = useRef<HTMLStyleElement | null>(null);
  useEffect(() => {
    const cfg = mapConfigRef.current;
    if (!cfg) return;

    let css = '';
    if (!cfg.unit_marker_pulse) {
      css += '.rmpg-unit-marker { animation: none !important; }';
    }
    if (!cfg.call_marker_pulse) {
      css += '.rmpg-call-marker-p1 { animation: none !important; }';
      css += '.rmpg-call-marker-p2 { animation: none !important; }';
    }
    if (cfg.marker_font_size !== 9) {
      css += `.rmpg-marker-label { font-size: ${cfg.marker_font_size}px !important; }`;
    }

    if (!markerStyleRef.current) {
      const style = document.createElement('style');
      style.id = '__rmpg-admin-marker-styles__';
      style.textContent = css;
      document.head.appendChild(style);
      markerStyleRef.current = style;
    } else {
      markerStyleRef.current.textContent = css;
    }
  }, [mapConfigVersion]);

  // Separate marker tracking for clustering & drag dispatch
  const unitMarkersMapRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const callMarkersMapRef = useRef<Map<string, { marker: mapboxgl.Marker; callId: string }>>(new Map());
  const callMarkersArrayRef = useRef<mapboxgl.Marker[]>([]);
  const propMarkersArrayRef = useRef<mapboxgl.Marker[]>([]);
  // Change-detection so call/property pins are only rebuilt when THEY change —
  // not on every unit GPS poll (which previously destroyed + recreated every
  // pin, making them flicker / "fly around").
  // Content signatures (NOT array references) — the calls/properties arrays get
  // a fresh reference on every poll even when nothing changed, so reference
  // equality would rebuild every pin each poll. Compare a stable signature.
  const prevCallsSigRef = useRef<string>('');
  const prevPropsSigRef = useRef<string>('');
  // Always-fresh units, so a call marker's popup (built once when calls change)
  // still shows current assigned units between rebuilds.
  const unitsRef = useRef(units);
  unitsRef.current = units;

  // Track previous unit state to skip marker updates for stationary units
  const prevUnitStateRef = useRef<Map<string, { lat: number; lng: number; status: string; heading: number | null; speed: number | null }>>(new Map());

  const lastClickedPropRef = useRef<string | null>(null);
  const abortedRef = useRef(false);
  const lastRouteUpdateRef = useRef<{ time: number; lat: number; lng: number } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // WebSocket-poll race prevention: increment on WS updates, check before applying poll results
  const dataVersionRef = useRef(0);

  // Intel layers
  const [intelLayers, setIntelLayers] = useState({ warrants: false, trespass: false, offenders: false, bolos: false });
  const toggleIntelLayer = (layer: 'warrants' | 'trespass' | 'offenders' | 'bolos') => {
    setIntelLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  };

  // New tactical layer toggles
  const [showPatrolCheckpoints, setShowPatrolCheckpoints] = useState(false);
  const [showResponseRadius, setShowResponseRadius] = useState(false);
  const [showEnforcementClusters, setShowEnforcementClusters] = useState(false);
  const [enforcementType, setEnforcementType] = useState<'citations' | 'arrests'>('citations');
  const [enforcementDays, setEnforcementDays] = useState(90);
  const [showFleetVehicles, setShowFleetVehicles] = useState(false);
  const [showPanicZone, setShowPanicZone] = useState(true); // on by default for safety
  const [showDaylight, setShowDaylight] = useState(false);

  // Tactical map hooks
  const predictions = useMapPredictions(mapInstanceRef.current, showPredictions);
  const intelLayerData = useMapIntelLayers(mapInstanceRef.current, intelLayers);
  const analysisSummary = useAnalysisSummary(showAnalysisDashboard);

  // Clustering — groups call markers at low zoom levels
  const clustering = useMapClustering(mapInstanceRef.current, clusteringEnabled, callMarkersArrayRef.current);

  // Drag dispatch — drag a unit marker onto a call marker to dispatch
  const dragDispatch = useMapDragDispatch(
    mapInstanceRef.current,
    dragDispatchMode,
    unitMarkersMapRef.current,
    callMarkersMapRef.current,
    useCallback(async (unitId: string, callId: string) => {
      try {
        await apiFetch(`/dispatch/calls/${callId}/assign-unit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unit_id: unitId }),
        });
        addToast(`Dispatched unit ${unitId} to call ${callId}`, 'success');
      } catch (err: any) {
        addToast(`Dispatch failed: ${err?.message || 'Unknown error'}`, 'error');
        throw err;
      }
    }, [addToast]),
  );

  // New tactical hooks
  const patrolCheckpoints = useMapPatrolCheckpoints(mapInstanceRef.current, showPatrolCheckpoints);
  const responseRadius = useMapResponseRadius(mapInstanceRef.current, showResponseRadius);
  const enforcementClusters = useMapEnforcementClusters(mapInstanceRef.current, showEnforcementClusters, enforcementType, enforcementDays);
  const fleetVehicles = useMapFleetVehicles(mapInstanceRef.current, showFleetVehicles);
  const panicZone = useMapPanicZone(mapInstanceRef.current, showPanicZone);
  const daylight = useMapDaylightOverlay(mapInstanceRef.current, showDaylight);

  // Tactical tools hook (pure client-side, always active)
  const tactical = useMapTactical(mapInstanceRef.current);

  // ============================================================
  // Data Fetching
  // ============================================================

  const fetchUnits = useCallback(async () => {
    const v = ++dataVersionRef.current;
    try {
      const data = await apiFetch<Unit[]>('/dispatch/units');
      if (abortedRef.current) return;
      if (dataVersionRef.current !== v) return;
      setUnits(Array.isArray(data) ? data : []);
      setError(null); // connectivity recovered — clear any stale "failed to load" banner
    } catch (err) {
      if (abortedRef.current) return;
      if (dataVersionRef.current !== v) return;
      console.error('Error fetching units:', err);
      setError('Failed to load units');
    }
  }, []);

  const fetchCalls = useCallback(async () => {
    const v = ++dataVersionRef.current;
    try {
      const data = await apiFetch<ActiveCall[]>('/dispatch/queue');
      if (abortedRef.current) return;
      if (dataVersionRef.current !== v) return;
      setCalls(Array.isArray(data) ? data : []);
    } catch (err) {
      if (abortedRef.current) return;
      if (dataVersionRef.current !== v) return;
      console.error('Error fetching calls:', err);
      setError('Failed to load active calls');
    }
  }, []);

  const fetchProperties = useCallback(async () => {
    try {
      const data = await apiFetch<Property[]>('/records/properties');
      if (abortedRef.current) return;
      setProperties(Array.isArray(data) ? data : []);
    } catch (err) {
      if (abortedRef.current) return;
      console.error('Error fetching properties:', err);
      setError('Failed to load properties');
    }
  }, []);

  const fetchAllData = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(null); }
    await Promise.all([fetchUnits(), fetchCalls(), fetchProperties()]);
    if (!options?.silent) setLoading(false);
    setLastDataUpdate(new Date()); // Fix 40: track last data update timestamp
  }, [fetchUnits, fetchCalls, fetchProperties]);
  useEffect(() => { fetchAllDataRef.current = fetchAllData; }, [fetchAllData]);

  // ============================================================
  // Initial Load & Auto-Refresh
  // ============================================================

  // Skip background polls when the tab is hidden or the device is offline —
  // otherwise a backgrounded/disconnected console silently spams failed
  // fetches (and MapPage's catch sets a sticky "Failed to load" banner).
  const pollEligible = () =>
    (typeof document === 'undefined' || document.visibilityState === 'visible') &&
    (typeof navigator === 'undefined' || navigator.onLine !== false);

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(() => { if (pollEligible()) fetchAllData({ silent: true }); }, 30000);
    return () => clearInterval(interval);
  }, [fetchAllData]);

  // Near-live unit positions without a WebSocket push.
  // True real-time GPS push would require a server broadcast, but the dispatch
  // socket (/api/ws) and the bare POST /api/dispatch/gps both live on the LEGACY
  // worker, while broadcastAll() is per-isolate — so a push emitted from the
  // rewrite worker can't reach these clients (see project-dispatch-ws memory).
  // Instead we tighten the *consumer*: units.latitude/longitude IS freshened by
  // the GPS POST (gps_source/gps_updated_at on the row), so a fast units-only
  // poll makes the dots move in near-real-time. Adaptive on purpose — it only
  // fetches when a unit is actually on duty (position can change); a fully
  // parked fleet falls back to the 30s full poll above with no extra load.
  useEffect(() => {
    const LIVE_UNIT_POLL_MS = 7000;
    const MOVING_STATUSES = new Set<string>(['available', 'dispatched', 'enroute', 'onscene', 'busy']);
    const tick = () => {
      if (!pollEligible()) return; // skip when tab hidden / offline
      const anyOnDuty = unitsRef.current.some((u) => MOVING_STATUSES.has(u.status));
      if (anyOnDuty) fetchUnits(); // light: /dispatch/units only, not the full fetch
    };
    const iv = setInterval(tick, LIVE_UNIT_POLL_MS);
    return () => clearInterval(iv);
  }, [fetchUnits]);

  // Live sync — auto-refresh map when dispatch data changes from any device (silent to avoid unmounting UI)
  const silentRefreshMap = useCallback(() => fetchAllData({ silent: true }), [fetchAllData]);
  useLiveSync('dispatch', silentRefreshMap);

  // ============================================================
  // WebSocket Subscriptions
  // ============================================================

  useEffect(() => {
    const unsubscribeUnit = subscribe('unit_update', (msg: any) => {
      dataVersionRef.current++;
      const data = msg.data || msg;
      if (data?.action === 'unit_deleted' && data.unit_id) {
        setUnits((prev) => prev.filter((u) => u.id !== data.unit_id));
        return;
      }
      if (data?.unit) {
        setUnits((prev) => {
          const index = prev.findIndex((u) => u.id === data.unit.id);
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = { ...updated[index], ...data.unit };
            return updated;
          }
          return [...prev, data.unit];
        });
      }
    });

    // Server broadcasts 'dispatch_update' type for call events
    // Unit state is now fully handled by 'unit_update' events (enriched with call details),
    // so no need to re-fetch all units on every dispatch event.
    // Statuses excluded from /dispatch/queue (the map's source-of-truth fetch) —
    // keep this in sync with aggregates.ts queue endpoint's WHERE clause.
    const INACTIVE_STATUSES = new Set(['closed', 'completed', 'cleared', 'cancelled']);
    const isInactive = (s: any) => typeof s === 'string' && INACTIVE_STATUSES.has(s.toLowerCase());

    const unsubscribeCall = subscribe('dispatch_update', (msg: any) => {
      dataVersionRef.current++;
      const evtData = msg.data || msg;

      // Handle deletions explicitly — call_deleted broadcasts carry call_id, not call
      if (evtData?.action === 'call_deleted') {
        const deletedId = evtData.call_id ?? evtData.call?.id;
        if (deletedId != null) {
          setCalls((prev) => prev.filter((c) => c.id !== deletedId));
        }
        return;
      }

      // Bulk operations don't carry per-call data — fall back to a silent refresh
      if (
        evtData?.action === 'calls_bulk_updated' ||
        evtData?.action === 'calls_bulk_archived' ||
        evtData?.action === 'calls_auto_closed'
      ) {
        fetchAllDataRef.current?.({ silent: true });
        return;
      }

      if (evtData && evtData.call) {
        setCalls((prev) => {
          const index = prev.findIndex((c) => c.id === evtData.call.id);
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = { ...updated[index], ...evtData.call };
            if (isInactive(evtData.call.status)) {
              return updated.filter((c) => c.id !== evtData.call.id);
            }
            return updated;
          }
          if (!isInactive(evtData.call.status)) {
            return [...prev, evtData.call];
          }
          return prev;
        });
      }
    });

    return () => { unsubscribeUnit(); unsubscribeCall(); };
  }, [subscribe]);

  // ============================================================
  // Heat Map Data
  // ============================================================

  useEffect(() => {
    if (!showHeatmap) { setHeatmapData([]); return; }
    let cancelled = false;
    let url = `/dispatch/heatmap?days=${heatmapDays}&mode=${heatmapMode}`;
    if (heatmapMode === 'type' && heatmapTypeFilter) url += `&type=${encodeURIComponent(heatmapTypeFilter)}`;
    apiFetch<HeatmapPoint[]>(url)
      .then((data) => { if (!cancelled) setHeatmapData(Array.isArray(data) ? data : []); })
      .catch((err) => { if (!cancelled) { console.warn('[MapPage] heatmap data fetch failed:', err); setHeatmapData([]); } });
    return () => { cancelled = true; };
  }, [showHeatmap, heatmapDays, heatmapMode, heatmapTypeFilter]);

  // Fetch available incident types for heatmap type filter
  useEffect(() => {
    if (!showHeatmap) return;
    let cancelled = false;
    apiFetch<{ incident_type: string; count: number }[]>('/dispatch/heatmap/types')
      .then((data) => { if (!cancelled) setHeatmapTypes(Array.isArray(data) ? data : []); })
      .catch((err) => { console.warn('[MapPage] fetch heatmap types failed:', err); });
    return () => { cancelled = true; };
  }, [showHeatmap]);

  // ============================================================
  // Mapbox Initialization
  // ============================================================

  useEffect(() => {
    if (!mapRef.current) return;

    injectKeyframes();

    // Clear any previous error when retrying
    setMapError(null);

    let cancelled = false;
    let unsubOnline = () => {};

    // If a map instance already exists (e.g. from a previous successful init
    // before React StrictMode's second mount), just flag it loaded and bail.
    if (mapInstanceRef.current) {
      setMapLoaded(true);
      return;
    }

    let authFailed = false;

    // Auto-retry with exponential backoff if the map fails to load
    // (e.g. server restart, brief network blip, slow vehicle WiFi).
    const MAX_RETRIES = 8;
    const RETRY_DELAYS = [2000, 4000, 8000, 12000, 16000, 20000, 25000, 30000]; // ms

    function initMap(apiKey: string, cfg: MapSettings) {
      if (!mapRef.current || authFailed || cancelled) return;
      if (mapInstanceRef.current) { setMapLoaded(true); return; }

      // Fix 31: restore map center/zoom from localStorage
      let savedCenter = { lat: cfg.default_center_lat, lng: cfg.default_center_lng };
      let savedZoom = cfg.default_zoom;
      try {
        const sc = localStorage.getItem('rmpg_map_center');
        const sz = localStorage.getItem('rmpg_map_zoom');
        if (sc) savedCenter = JSON.parse(sc);
        if (sz) savedZoom = parseInt(sz, 10) || cfg.default_zoom;
      } catch { /* use defaults */ }

      const mapOptions: mapboxgl.MapboxOptions = {
        container: mapRef.current!,
        style: cfg.custom_style_url || MAPBOX_STYLE_DARK,
        center: [savedCenter.lng, savedCenter.lat],
        zoom: savedZoom,
        pitch: cfg.default_pitch,
        bearing: cfg.default_bearing,
        minZoom: cfg.min_zoom,
        maxZoom: cfg.max_zoom,
        minPitch: cfg.min_pitch,
        maxPitch: cfg.max_pitch,
        attributionControl: cfg.show_attribution,
        scrollZoom: cfg.scroll_zoom,
        boxZoom: cfg.box_zoom,
        dragRotate: cfg.drag_rotate,
        dragPan: cfg.drag_pan,
        doubleClickZoom: cfg.double_click_zoom,
        touchZoomRotate: cfg.touch_zoom_rotate,
        cooperativeGestures: cfg.cooperative_gestures,
        keyboard: cfg.keyboard_enabled,
        renderWorldCopies: cfg.render_world_copies,
        fadeDuration: cfg.fade_duration,
        clickTolerance: cfg.click_tolerance,
        crossSourceCollisions: cfg.cross_source_collisions,
        // Required so the WebGL canvas can be read back into a PNG for the
        // map screenshot + situation-report PDF (canvas.toDataURL()).
        preserveDrawingBuffer: true,
      };

      if (cfg.language) {
        mapOptions.locale = { 'Map.Title': cfg.language };
      }

      if (cfg.local_ideograph_font_family) {
        mapOptions.localIdeographFontFamily = cfg.local_ideograph_font_family;
      }

      if (cfg.max_bounds_sw_lat != null && cfg.max_bounds_sw_lng != null && cfg.max_bounds_ne_lat != null && cfg.max_bounds_ne_lng != null) {
        mapOptions.maxBounds = [
          [cfg.max_bounds_sw_lng, cfg.max_bounds_sw_lat],
          [cfg.max_bounds_ne_lng, cfg.max_bounds_ne_lat],
        ] as [[number, number], [number, number]];
      }

      // Disable rotation if rotation_enabled is false
      if (!cfg.rotation_enabled) {
        mapOptions.dragRotate = false;
        mapOptions.touchZoomRotate = false;
      }

      const map = new mapboxgl.Map(mapOptions);

      mapInstanceRef.current = map;
      registerMapInstance(map);

      // Fix 30: save map center/zoom to localStorage on moveend (debounced to skip animation frames)
      const savePosition = () => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          try {
            const c = map.getCenter();
            const z = map.getZoom();
            if (c && z != null) {
              localStorage.setItem('rmpg_map_center', JSON.stringify({ lat: c.lat, lng: c.lng }));
              localStorage.setItem('rmpg_map_zoom', String(z));
            }
          } catch { /* quota exceeded */ }
        }, 1000);
      };
      map.on('moveend', savePosition);

      infoWindowRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false });

      // Mapbox does not have the Google Maps error overlay / dismissable
      // alertdialog that the old mutation observer was designed to handle.
      // Both the observer and the style injection were removed in #827.

      devLog('[MapPage] Map ready — using native mapbox-gl markers');

      // Monitor tile loading — detect blank map on slow WiFi
      if (tileMonitorCleanupRef.current) tileMonitorCleanupRef.current();
      tileMonitorCleanupRef.current = monitorTileLoading(map, {
        onStalled: () => {
          devWarn('[MapPage] Map tiles stalled — connection may be too slow');
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

    let mapConfig: MapSettings | null = null;

    function attemptLoad(apiKey: string, attempt: number) {
      if (cancelled || !mapConfig) return;

      // If device is offline, pause retries and wait for connectivity
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        devWarn('[MapPage] Device offline — pausing retries until connectivity returns');
        const onBack = () => {
          window.removeEventListener('online', onBack);
          if (!cancelled) {
            devLog('[MapPage] Back online — resuming map load');
            attemptLoad(apiKey, attempt); // resume at same attempt count (don't penalize for offline time)
          }
        };
        window.addEventListener('online', onBack);
        return;
      }

      try {
        initMapbox(apiKey);
        initMap(apiKey, mapConfig);
      } catch (err: any) {
        if (cancelled) return;
        const errMsg = err?.message || String(err);
        devWarn(`[MapPage] Mapbox init attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`, errMsg);

        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS[attempt] || 30000;
          devLog(`[MapPage] Retrying in ${delay / 1000}s...`);
          setTimeout(() => attemptLoad(apiKey, attempt + 1), delay);
        } else {
          console.error('[MapPage] Mapbox init failed after all retries');
          setMapError(
            'Failed to initialize Mapbox map after multiple attempts.\n\n' +
            'If you are on a slow or intermittent connection (vehicle WiFi),\n' +
            'wait for a stronger signal and click Retry below.\n\n' +
            (errMsg ? `Technical details: ${errMsg}` : '')
          );
        }
      }
    }

    (async () => {
      try {
        mapConfig = await fetchMapConfig();
      } catch {
        mapConfig = { default_center_lat: 40.7608, default_center_lng: -111.891, default_zoom: 12, min_zoom: 1, max_zoom: 22, default_style: 'dark', enabled_styles: ['dark', 'night_nav', 'satellite', 'streets', 'terrain', 'light'], show_attribution: false, rotation_enabled: false, max_bounds_sw_lat: null, max_bounds_sw_lng: null, max_bounds_ne_lat: null, max_bounds_ne_lng: null, custom_style_url: '', clustering_enabled: true, cluster_radius: 50, cluster_max_zoom: 14, default_pitch: 0, default_bearing: 0, min_pitch: 0, max_pitch: 85, scroll_zoom: true, box_zoom: true, drag_rotate: true, drag_pan: true, double_click_zoom: true, touch_zoom_rotate: true, cooperative_gestures: false, show_compass: true, show_zoom_controls: true, keyboard_enabled: true, language: '', render_world_copies: true, fade_duration: 300, click_tolerance: 3, local_ideograph_font_family: '', cross_source_collisions: true, default_visible_layers: ['county', 'beat'], layer_beat_fill: '#22c55e', layer_beat_fill_opacity: 0.2, layer_beat_stroke: '#22c55e', layer_beat_stroke_opacity: 0.6, layer_beat_stroke_weight: 1.2, layer_beat_min_zoom: 10, layer_county_fill: '#141414', layer_county_fill_opacity: 0.15, layer_county_stroke: '#444444', layer_county_stroke_opacity: 0.5, layer_county_stroke_weight: 1.5, layer_county_min_zoom: 8, layer_municipality_fill: '#a855f7', layer_municipality_fill_opacity: 0.06, layer_municipality_stroke: '#a855f7', layer_municipality_stroke_opacity: 0.35, layer_municipality_stroke_weight: 1, layer_municipality_min_zoom: 9, layer_highway_stroke: '#ef4444', layer_highway_stroke_opacity: 0.6, layer_highway_stroke_weight: 3, layer_state_boundary_stroke: '#ffffff', layer_state_boundary_stroke_opacity: 0.3, layer_state_boundary_stroke_weight: 2, layer_place_fill: '#22c55e', layer_place_fill_opacity: 0.7, layer_place_stroke: '#22c55e', layer_place_stroke_opacity: 0.9, layer_place_stroke_weight: 1, layer_place_min_zoom: 10, gps_batch_interval_ms: 5000, gps_max_accuracy_meters: 100, gps_max_speed_ms: 80, gps_high_accuracy: true, screenshot_width: 1280, screenshot_height: 720, screenshot_style: 'dark', unit_marker_pulse: true, call_marker_pulse: true, marker_font_size: 9 };
      }
      mapConfigRef.current = mapConfig;
      setMapConfigVersion(v => v + 1);

      let mapboxToken = '';
      try {
        mapboxToken = await resolveMapboxAccessToken();
      } catch {
        if (!cancelled) {
          setMapError('offline');
        }
      }

      if (cancelled) return;
      attemptLoad(mapboxToken, 0);

      // Auto-retry when device comes back online
      const onlineToken = mapboxToken;
      unsubOnline = (() => {
        if (!cancelled && !mapInstanceRef.current && mapConfig) {
          devLog('[MapPage] Online auto-retry triggered — reinitializing map');
          setMapError(null);
          initMapbox(onlineToken);
          initMap(onlineToken, mapConfig);
        }
      }) as any;
    })();

    return () => {
      cancelled = true;
      abortedRef.current = true;
      unsubOnline();
      if (tileMonitorCleanupRef.current) { tileMonitorCleanupRef.current(); tileMonitorCleanupRef.current = null; }
      if (mapInstanceRef.current) unregisterMapInstance(mapInstanceRef.current);
      markersRef.current.forEach((m) => {
        if (m && typeof m.remove === 'function') m.remove();
      });
      markersRef.current = [];
      speedAlertKeyedRef.current.forEach((m) => m.remove());
      speedAlertKeyedRef.current.clear();
      if (playbackMarkerRef.current) { playbackMarkerRef.current.remove(); playbackMarkerRef.current = null; }
      if (playbackSpeedLabelRef.current) { playbackSpeedLabelRef.current.remove(); playbackSpeedLabelRef.current = null; }
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      mapInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRetry]);

  // ============================================================
  // Switch Map Style
  // ============================================================

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const styleMap: Record<string, string> = {
      dark: MAPBOX_STYLE_DARK,
      night_nav: MAPBOX_STYLE_NIGHT,
      satellite: MAPBOX_STYLE_SATELLITE,
      hybrid: MAPBOX_STYLE_SATELLITE,
      terrain: MAPBOX_STYLE_OUTDOORS,
      streets: MAPBOX_STYLE_STREETS,
    };

    const url = styleMap[mapStyle];
    if (url) {
      map.setStyle(url);
      updateMapStyle(map, url);
    }
  }, [mapStyle, mapLoaded]);

  // ============================================================
  // Update Markers
  // ============================================================

  // Helper: create a marker using AdvancedMarkerElement or OverlayView fallback
  const createMarker = useCallback((opts: {
    map: mapboxgl.Map;
    position: [number, number];
    content: HTMLElement;
    zIndex?: number;
    title?: string;
    onClick?: () => void;
  }): mapboxgl.Marker | null => {
    // Always use native mapbox-gl Marker. The old OverlayView fallback was a
    // Google-Maps-port leftover (its "AdvancedMarkerElement needs a mapId"
    // comment is Google terminology that does not apply to Mapbox) and it
    // exposed an incompatible API surface (no setDraggable / .on() / two-arg
    // setLngLat), which crashed useMapDragDispatch and the self-marker updater.
    // Native markers render on any style — raster included — and support the
    // full method set the map relies on.
    try {
      if (opts.title) opts.content.title = opts.title;
      if (opts.zIndex != null) opts.content.style.zIndex = String(opts.zIndex);
      // Two-layer marker: Mapbox writes `transform: translate(...)` to the
      // element we hand it on EVERY position update. If that element also has
      // a CSS `transition` on transform (or its own transform), Mapbox's
      // translate gets animated → the pin "flies" across the map instead of
      // snapping, and our zoom-scale transform gets clobbered. So we give
      // Mapbox a bare outer shell (no transition, no transform of its own) and
      // keep all the content — scale(var(--mz)), hover, transitions — on the
      // inner element. getElement()/querySelector still reach the content.
      const shell = document.createElement('div');
      shell.appendChild(opts.content);
      const marker = new mapboxgl.Marker({ element: shell, anchor: 'center' })
        .setLngLat(opts.position)
        .addTo(opts.map);
      if (opts.onClick) opts.content.addEventListener('click', opts.onClick);
      return marker;
    } catch (err) {
      console.warn('[MapPage] createMarker failed:', err);
      return null;
    }
  }, []);

  // Helper: remove a marker (works for both types)
  const removeMarker = useCallback((m: any) => {
    if (m && typeof m.remove === 'function') m.remove();
  }, []);

  // ── Zoom-scale DOM markers (shrink on zoom-out) ──────────────
  // Native mapboxgl.Marker content is fixed-pixel HTML — Mapbox repositions
  // it but never resizes it, so pins stay huge when zoomed way out. Every
  // marker wrapper carries `transform:scale(var(--mz,1))`; we set `--mz` once
  // on the map's container element and CSS inheritance cascades it to all
  // current AND future `.rmpg-zoom-marker` wrappers — no per-marker iteration,
  // no coupling to the marker registries. Scale ramps linearly from full size
  // at/above zoom 12 down to a 0.45 floor at zoom 4, clamped both ends so pins
  // stay clickable when zoomed out and never balloon past 1× when zoomed in.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;
    const container = map.getContainer();
    const applyZoomScale = () => {
      const z = map.getZoom();
      // zoom 12+ → 1.0 ; zoom 4 → 0.45 ; linear between, clamped.
      const scale = Math.max(0.45, Math.min(1, 0.45 + ((z - 4) / (12 - 4)) * 0.55));
      container.style.setProperty('--mz', scale.toFixed(3));
      // Track min/max so the zoom buttons can disable at the bounds.
      const atMax = z >= map.getMaxZoom() - 0.01;
      const atMin = z <= map.getMinZoom() + 0.01;
      setZoomBounds((prev) => (prev.atMin === atMin && prev.atMax === atMax ? prev : { atMin, atMax }));
    };
    applyZoomScale();
    map.on('zoom', applyZoomScale);
    return () => { map.off('zoom', applyZoomScale); };
  }, [mapLoaded]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    // Incremental updates: move/keep markers that didn't change instead of
    // destroying + recreating every pin on each unit GPS poll (the cause of
    // the flicker / "flying" pins). Units move in place; calls & properties are
    // rebuilt only when they actually change.

    // ---- Unit markers: move in place, create new, remove stale ----
    const nextUnitIds = new Set<string>();
    if (layers.units) {
      units.forEach((unit) => {
        if (unit.latitude != null && unit.longitude != null) {
          const id = String(unit.id);
          nextUnitIds.add(id);
          const statusColor = UNIT_STATUS_COLORS[unit.status];
          const location = unit.current_call_location || 'No active assignment';
          // Rebuilt each run so the popup always reflects current unit + calls.
          const makeUnitClick = () => {
              // Find the assigned call (for route button)
              const assignedCall = unit.current_call_id
                ? calls.find(c => String(c.id) === String(unit.current_call_id))
                : null;
              const routeBtnHtml = (assignedCall && assignedCall.latitude != null && assignedCall.longitude != null && unit.latitude != null && unit.longitude != null)
                ? `<button type="button" data-route-unit="${escapeHtml(unit.call_sign)}" data-route-call="${escapeHtml(assignedCall.call_number)}"
                     data-route-ulat="${unit.latitude}" data-route-ulng="${unit.longitude}"
                     data-route-clat="${assignedCall.latitude}" data-route-clng="${assignedCall.longitude}"
                     style="margin-top:6px;width:100%;padding:3px 0;background:#88888820;border:1px solid #88888850;color:#a0a0a0;font-size:9px;font-weight:900;font-family:monospace;cursor:pointer;letter-spacing:0.5px;text-transform:uppercase;">
                     ▶ Route to ${escapeHtml(assignedCall.call_number)}
                   </button>`
                : '';
              const omBtnLabel = isAndroidNative() ? 'Navigate (Organic Maps)' : 'Open Directions';
              const omBtnHtml = (assignedCall && assignedCall.latitude != null && assignedCall.longitude != null)
                ? `<button type="button" data-om-lat="${assignedCall.latitude}" data-om-lng="${assignedCall.longitude}"
                     data-om-label="${escapeHtml(assignedCall.call_number)}"
                     style="margin-top:4px;width:100%;padding:3px 0;background:#1b5e2020;border:1px solid #1b5e2080;color:#4ade80;font-size:9px;font-weight:900;font-family:monospace;cursor:pointer;letter-spacing:0.5px;text-transform:uppercase;">
                     \u{1F9ED} ${omBtnLabel}
                   </button>`
                : '';

              infoWindowRef.current?.setHTML(`
                <div style="min-width:200px;font-family:'Courier New',monospace;background:#0c0c0c;color:#e5e7eb;padding:10px;border:1px solid ${statusColor}50;border-radius:4px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #2b2b2b;">
                    <div style="width:10px;height:10px;border-radius:50%;background:${statusColor};box-shadow:0 0 8px ${statusColor}80;"></div>
                    <span style="font-weight:900;font-size:15px;color:${statusColor};letter-spacing:-0.5px;">${escapeHtml(unit.call_sign)}</span>
                    <span style="margin-left:auto;font-size:9px;text-transform:uppercase;color:${statusColor};font-weight:800;letter-spacing:1px;padding:1px 6px;background:${statusColor}20;border:1px solid ${statusColor}30;border-radius:2px;">${escapeHtml(unit.status.replace(/_/g, ' '))}</span>
                  </div>
                  <div style="font-size:11px;color:#d1d5db;margin-bottom:2px;">${escapeHtml(unit.officer_name)}</div>
                  ${unit.vehicle ? `<div style="font-size:10px;color:#5a6e80;margin-bottom:6px;">Vehicle: ${escapeHtml(unit.vehicle)}</div>` : ''}
                  ${unit.call_number ? `
                    <div style="margin-top:6px;padding-top:6px;border-top:1px solid #2b2b2b;">
                      <div style="font-size:10px;color:#a0a0a0;font-weight:bold;">${escapeHtml(unit.call_number)}</div>
                      ${unit.current_call_type ? `<div style="font-size:10px;color:#d1d5db;">${escapeHtml(formatIncidentType(unit.current_call_type))}</div>` : ''}
                      <div style="font-size:9px;color:#5a6e80;margin-top:2px;">${escapeHtml(location)}</div>
                    </div>
                  ` : `<div style="font-size:9px;color:#5a6e80;margin-top:4px;">${escapeHtml(location)}</div>`}
                  ${routeBtnHtml}
                  ${omBtnHtml}
                </div>
              `);
              infoWindowRef.current?.setLngLat([unit.longitude!, unit.latitude!]);
              infoWindowRef.current?.addTo(map);
          };
          const existing = unitMarkersMapRef.current.get(id);

          // Skip marker updates for stationary units (Fix 4)
          const prev = prevUnitStateRef.current.get(id);
          const hasChanged = !prev || prev.lat !== unit.latitude || prev.lng !== unit.longitude || prev.status !== unit.status || prev.heading !== unit.gps_heading || prev.speed !== unit.gps_speed;
          if (!hasChanged && existing) {
            (existing as any)._rmpgClick = makeUnitClick;
            return;
          }

          prevUnitStateRef.current.set(id, { lat: unit.latitude!, lng: unit.longitude!, status: unit.status, heading: unit.gps_heading ?? null, speed: unit.gps_speed ?? null });

          if (existing) {
            existing.setLngLat([unit.longitude, unit.latitude]);
            const el = existing.getElement?.();
            if (el) {
              const label = el.querySelector('[data-unit-label]') as HTMLElement | null;
              if (label) {
                label.textContent = unit.call_sign;
                label.style.color = UNIT_STATUS_COLORS[unit.status] || '#666666';
              }
              const statusDot = el.querySelector('[data-unit-status]') as HTMLElement | null;
              if (statusDot) {
                const sc = UNIT_STATUS_COLORS[unit.status] || '#666666';
                statusDot.style.backgroundColor = sc;
              }
              const srcBadge = el.querySelector('[data-unit-source]') as HTMLElement | null;
              if (srcBadge) {
                srcBadge.style.display = unit.gps_source === 'clearpathgps' ? '' : 'none';
              }
              const arrow = el.querySelector('[data-unit-arrow]') as HTMLElement | null;
              if (arrow) {
                arrow.style.transform = `rotate(${unit.gps_heading ?? 0}deg)`;
              }
              const speedEl = el.querySelector('[data-unit-speed]') as HTMLElement | null;
              if (speedEl) {
                const mph = unit.gps_speed != null ? Math.round(unit.gps_speed * 2.237) : null;
                speedEl.textContent = mph != null ? `${mph}` : '';
              }
            }
            (existing as any)._rmpgClick = makeUnitClick;
          } else {
            const content = buildUnitMarkerContent(unit.call_sign, unit.status, unit.gps_source, unit.gps_heading, unit.gps_speed);
            const marker = createMarker({
              map,
              position: [unit.longitude, unit.latitude],
              content,
              zIndex: 1000,
              title: `${unit.call_sign} - ${unit.officer_name}`,
              onClick: () => (marker as any)?._rmpgClick?.(),
            });
            if (marker) {
              (marker as any)._rmpgClick = makeUnitClick;
              unitMarkersMapRef.current.set(id, marker);
            }
          }
        }
      });
    }
    // Remove unit markers for units that are gone / when the layer is off
    unitMarkersMapRef.current.forEach((m, id) => {
      if (!layers.units || !nextUnitIds.has(id)) { removeMarker(m); unitMarkersMapRef.current.delete(id); }
    });

    // ---- Call markers: rebuild only when calls / incidents-layer change ----
    const callsSig = layers.incidents
      ? calls.map(c => `${c.id}:${c.latitude}:${c.longitude}:${c.priority}:${c.status}:${c.incident_type}:${c.call_number}`).join('|')
      : '';
    const callsChanged = callsSig !== prevCallsSigRef.current;
    if (callsChanged) {
      callMarkersArrayRef.current.forEach((m) => removeMarker(m));
      callMarkersArrayRef.current = [];
      callMarkersMapRef.current.clear();
    }
    if (callsChanged && layers.incidents) {
      calls.forEach((call) => {
        if (call.latitude != null && call.longitude != null) {
          const content = buildIncidentMarkerContent(call.priority, call.incident_type, call.call_number);
          const pColor = PRIORITY_COLORS[call.priority] || '#666666';

          const marker = createMarker({
            map,
            position: [call.longitude, call.latitude],
            content,
            zIndex: call.priority === 'P1' ? 2000 : 500,
            title: `${call.call_number} - ${formatIncidentType(call.incident_type)}`,
            onClick: () => {
              const assignedUnits = unitsRef.current.filter(u => String(u.current_call_id) === String(call.id));
              let unitsHtml = '';
              if (assignedUnits.length > 0) {
                unitsHtml = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #2b2b2b;">
                  <div style="font-size:9px;color:#5a6e80;margin-bottom:4px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">ASSIGNED UNITS (${assignedUnits.length})</div>
                  ${assignedUnits.map(u => {
                    const uc = UNIT_STATUS_COLORS[u.status] || '#666666';
                    const routeBtn = (u.latitude != null && u.longitude != null && call.latitude != null && call.longitude != null)
                      ? `<button type="button" data-route-unit="${escapeHtml(u.call_sign)}" data-route-call="${escapeHtml(call.call_number)}"
                           data-route-ulat="${u.latitude}" data-route-ulng="${u.longitude}"
                           data-route-clat="${call.latitude}" data-route-clng="${call.longitude}"
                           style="margin-left:auto;padding:1px 5px;background:#88888820;border:1px solid #88888850;color:#a0a0a0;font-size:8px;font-weight:900;font-family:monospace;cursor:pointer;">
                           ▶ ROUTE
                         </button>`
                      : '';
                    const omBtn = (call.latitude != null && call.longitude != null)
                      ? `<button type="button" data-om-lat="${call.latitude}" data-om-lng="${call.longitude}"
                           data-om-label="${escapeHtml(call.call_number)}"
                           title="${isAndroidNative() ? 'Open in Organic Maps' : 'Open external navigation'}"
                           style="padding:1px 5px;background:#1b5e2020;border:1px solid #1b5e2080;color:#4ade80;font-size:8px;font-weight:900;font-family:monospace;cursor:pointer;">
                           \u{1F9ED} NAV
                         </button>`
                      : '';
                    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                      <div style="width:6px;height:6px;border-radius:50%;background:${uc};box-shadow:0 0 4px ${uc}80;"></div>
                      <span style="font-size:10px;color:${uc};font-weight:bold;font-family:monospace;">${escapeHtml(u.call_sign)}</span>
                      <span style="font-size:9px;color:#9ca3af;">${escapeHtml(u.officer_name)}</span>
                      ${routeBtn}
                      ${omBtn}
                    </div>`;
                  }).join('')}
                </div>`;
              } else {
                unitsHtml = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #2b2b2b;font-size:9px;color:#5a6e80;">No units assigned</div>`;
              }

              infoWindowRef.current?.setHTML(`
                <div style="min-width:200px;font-family:'Courier New',monospace;background:#0c0c0c;color:#e5e7eb;padding:10px;border:1px solid ${pColor}50;border-radius:4px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <span style="background:${pColor};color:white;padding:2px 8px;font-size:10px;font-weight:900;letter-spacing:0.5px;">${escapeHtml(call.priority)}</span>
                    <span style="font-weight:900;font-size:13px;color:${pColor};">${escapeHtml(formatIncidentType(call.incident_type))}</span>
                  </div>
                  <div style="font-size:12px;color:#a0a0a0;font-weight:bold;">${escapeHtml(call.call_number)}</div>
                  <div style="font-size:10px;margin-top:4px;color:#d1d5db;">${escapeHtml(call.location_address)}</div>
                  ${call.property_name ? `<div style="font-size:10px;margin-top:4px;color:#888888;">\u{1F3E2} ${escapeHtml(call.property_name)}</div>` : ''}
                  <div style="font-size:9px;margin-top:6px;text-transform:uppercase;color:#5a6e80;letter-spacing:1px;font-weight:800;">${escapeHtml(call.status.replace(/_/g, ' '))}</div>
                  ${unitsHtml}
                </div>
              `);
              infoWindowRef.current?.setLngLat([call.longitude!, call.latitude!]);
              infoWindowRef.current?.addTo(map);
            },
          });

          if (marker) {
            callMarkersMapRef.current.set(String(call.id), { marker, callId: String(call.id) });
            callMarkersArrayRef.current.push(marker);
          }
        }
      });
    }

    // ---- Property markers: rebuild only when properties / layer change ----
    const propsSig = layers.properties
      ? properties.map(p => `${p.id}:${p.latitude}:${p.longitude}:${p.name}:${p.client_name || ''}`).join('|')
      : '';
    const propsChanged = propsSig !== prevPropsSigRef.current;
    if (propsChanged) {
      propMarkersArrayRef.current.forEach((m) => removeMarker(m));
      propMarkersArrayRef.current = [];
    }
    if (propsChanged && layers.properties) {
      properties.forEach((prop) => {
        if (prop.latitude != null && prop.longitude != null) {
          const content = buildPropertyMarkerContent(prop.name, prop.address, prop.client_name || undefined);

          const marker = createMarker({
            map,
            position: [prop.longitude, prop.latitude],
            content,
            zIndex: 100,
            title: prop.name,
            onClick: async () => {
              const propId = String(prop.id);
              lastClickedPropRef.current = propId;

              // Show loading state immediately
              infoWindowRef.current?.setHTML(`
                <div style="min-width:200px;font-family:'JetBrains Mono',monospace;background:#0c0c0c;color:#e5e7eb;padding:12px;border:1px solid #88888850;border-radius:4px;">
                  <div style="font-weight:900;font-size:13px;color:#a0a0a0;margin-bottom:4px;">${escapeHtml(prop.name)}</div>
                  <div style="font-size:10px;color:#9ca3af;">Loading details...</div>
                </div>
              `);
              infoWindowRef.current?.setLngLat([prop.longitude!, prop.latitude!]);
              infoWindowRef.current?.addTo(map);

              // Fetch full property details (includes recent calls, contacts, schedules)
              try {
                const details = await apiFetch<any>(`/records/properties/${prop.id}`);
                if (lastClickedPropRef.current !== propId) return;
                const recentCalls = details.recentCalls || [];
                const schedules = details.todaySchedules || [];
                const linkedPersons: any[] = details.linkedPersons || [];

                // Build linked persons rows
                const RELATIONSHIP_COLORS: Record<string, string> = {
                  employee: '#22c55e', contact: '#aaaaaa', tenant: '#a78bfa', owner: '#4ade80',
                  manager: '#d4a017', subject: '#f59e0b', trespass_warning: '#ef4444',
                  banned: '#ef4444', frequent_visitor: '#999999', associated: '#666666',
                };
                const personRows = linkedPersons.slice(0, 8).map((p: any) => {
                  const relColor = RELATIONSHIP_COLORS[p.relationship] || '#666666';
                  const name = escapeHtml(`${p.first_name} ${p.last_name}`);
                  const rel = escapeHtml((p.relationship || '').replace(/_/g, ' '));
                  const flagsArr = (() => { try { return JSON.parse(p.flags || '[]'); } catch { return []; } })();
                  const hasWarning = flagsArr.includes('trespass') || flagsArr.includes('violent') || flagsArr.includes('armed') || p.relationship === 'trespass_warning' || p.relationship === 'banned';
                  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #2b2b2b20;">
                    <div style="display:flex;align-items:center;gap:4px;">
                      ${hasWarning ? '<span style="color:#ef4444;font-size:8px;">⚠</span>' : ''}
                      <span style="color:#e0e8f0;font-size:9px;font-weight:700;">${name}</span>
                      ${p.title ? `<span style="color:#6b7280;font-size:7px;">${escapeHtml(p.title)}</span>` : ''}
                    </div>
                    <span style="color:${relColor};font-size:7px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">${rel}</span>
                  </div>`;
                }).join('');

                // Build call history rows
                const callRows = recentCalls.slice(0, 5).map((c: any) => {
                  const date = c.created_at ? parseTimestamp(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                  const time = c.created_at ? parseTimestamp(c.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
                  const statusColor = c.status === 'cleared' || c.status === 'closed' ? '#4ade80' : c.status === 'pending' ? '#fbbf24' : '#aaaaaa';
                  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #2b2b2b20;">
                    <div>
                      <span style="color:#bfbfbf;font-size:9px;font-weight:700;">${escapeHtml(c.call_number || '')}</span>
                      <span style="color:#6b7280;font-size:8px;margin-left:4px;">${escapeHtml(c.incident_type?.replace(/_/g, ' ') || '')}</span>
                    </div>
                    <div style="text-align:right;">
                      <span style="color:${statusColor};font-size:8px;font-weight:600;">${escapeHtml(c.status || '')}</span>
                      <span style="color:#6b7280;font-size:7px;margin-left:4px;">${date} ${time}</span>
                    </div>
                  </div>`;
                }).join('');

                // Build schedule/officer rows
                const scheduleRows = schedules.map((s: any) =>
                  `<div style="font-size:8px;color:#d1d5db;padding:2px 0;">
                    <span style="color:#a8a8a8;">⦿</span> ${escapeHtml(s.officer_name || 'Unassigned')}
                    <span style="color:#6b7280;margin-left:4px;">${escapeHtml(s.shift_type || '')}</span>
                  </div>`
                ).join('');

                infoWindowRef.current?.setHTML(`
                  <div style="min-width:280px;max-width:360px;font-family:'JetBrains Mono',monospace;background:#0c0c0c;color:#e5e7eb;padding:12px;border:1px solid #88888850;border-radius:4px;">
                    <div style="font-weight:900;font-size:13px;color:#a0a0a0;margin-bottom:2px;">${escapeHtml(prop.name)}</div>
                    <div style="font-size:10px;color:#d1d5db;margin-bottom:2px;">${escapeHtml(prop.address)}</div>
                    ${prop.client_name ? `<div style="font-size:9px;color:#d4a017;font-weight:600;margin-bottom:6px;">Client: ${escapeHtml(prop.client_name)}</div>` : ''}

                    ${details.property_type ? `<div style="font-size:8px;color:#9ca3af;margin-bottom:2px;">Type: ${escapeHtml(details.property_type)}</div>` : ''}
                    ${details.emergency_contact ? `<div style="font-size:8px;color:#f87171;margin-bottom:2px;">Emergency: ${escapeHtml(details.emergency_contact)}</div>` : ''}
                    ${details.gate_code ? `<div style="font-size:8px;color:#9ca3af;margin-bottom:2px;">Gate: ${escapeHtml(details.gate_code)}</div>` : ''}
                    ${details.access_instructions ? `<div style="font-size:8px;color:#9ca3af;margin-bottom:6px;">Access: ${escapeHtml(details.access_instructions)}</div>` : ''}

                    ${schedules.length > 0 ? `
                      <div style="border-top:1px solid #2b2b2b;padding-top:6px;margin-top:4px;">
                        <div style="font-size:9px;color:#a8a8a8;font-weight:700;margin-bottom:3px;">TODAY'S OFFICERS</div>
                        ${scheduleRows}
                      </div>
                    ` : ''}

                    ${linkedPersons.length > 0 ? `
                      <div style="border-top:1px solid #2b2b2b;padding-top:6px;margin-top:6px;">
                        <div style="font-size:9px;color:#e879f9;font-weight:700;margin-bottom:3px;">LINKED PERSONS (${linkedPersons.length})</div>
                        ${personRows}
                        ${linkedPersons.length > 8 ? `<div style="font-size:8px;color:#6b7280;text-align:center;margin-top:4px;">+${linkedPersons.length - 8} more</div>` : ''}
                      </div>
                    ` : ''}

                    ${recentCalls.length > 0 ? `
                      <div style="border-top:1px solid #2b2b2b;padding-top:6px;margin-top:6px;">
                        <div style="font-size:9px;color:#f59e0b;font-weight:700;margin-bottom:3px;">CALL HISTORY (${recentCalls.length})</div>
                        ${callRows}
                        ${recentCalls.length > 5 ? `<div style="font-size:8px;color:#6b7280;text-align:center;margin-top:4px;">+${recentCalls.length - 5} more</div>` : ''}
                      </div>
                    ` : `
                      <div style="border-top:1px solid #2b2b2b;padding-top:6px;margin-top:6px;">
                        <div style="font-size:9px;color:#6b7280;">No recent calls</div>
                      </div>
                    `}

                    ${details.client_contact ? `
                      <div style="border-top:1px solid #2b2b2b;padding-top:6px;margin-top:6px;">
                        <div style="font-size:9px;color:#a78bfa;font-weight:700;margin-bottom:3px;">CLIENT CONTACT</div>
                        <div style="font-size:9px;color:#d1d5db;">${escapeHtml(details.client_contact)}</div>
                        ${details.client_phone ? `<div style="font-size:9px;color:#bfbfbf;">${escapeHtml(details.client_phone)}</div>` : ''}
                      </div>
                    ` : ''}

                    ${details.sla_response_minutes ? `<div style="font-size:8px;color:#4ade80;margin-top:4px;">SLA: ${details.sla_response_minutes} min response</div>` : ''}
                    ${details.hazard_notes ? `<div style="font-size:8px;color:#f87171;margin-top:4px;padding:3px 5px;background:#f8717110;border:1px solid #f8717130;border-radius:2px;">⚠ ${escapeHtml(details.hazard_notes)}</div>` : ''}
                    ${details.post_orders ? `<div style="font-size:8px;color:#9ca3af;margin-top:4px;">Post Orders: ${escapeHtml(details.post_orders.substring(0, 100))}${details.post_orders.length > 100 ? '…' : ''}</div>` : ''}
                  </div>
                `);
              } catch (err) {
                if (lastClickedPropRef.current !== propId) return;
                console.error('[MapPage] Failed to fetch property details:', err);
                // If fetch fails, show basic info
                infoWindowRef.current?.setHTML(`
                  <div style="min-width:160px;font-family:'JetBrains Mono',monospace;background:#0c0c0c;color:#e5e7eb;padding:10px;border:1px solid #88888850;border-radius:4px;">
                    <div style="font-weight:900;font-size:13px;color:#a0a0a0;margin-bottom:4px;">${escapeHtml(prop.name)}</div>
                    <div style="font-size:10px;color:#d1d5db;">${escapeHtml(prop.address)}</div>
                    ${prop.client_name ? `<div style="font-size:9px;margin-top:6px;color:#d4a017;font-weight:600;">Client: ${escapeHtml(prop.client_name)}</div>` : ''}
                  </div>
                `);
              }
            },
          });

          if (marker) propMarkersArrayRef.current.push(marker);
        }
      });
    }

    // Keep the flat markersRef (used by the map-teardown cleanup) in sync with
    // all live markers, and record this run's inputs for next-run change detection.
    markersRef.current = [
      ...Array.from(unitMarkersMapRef.current.values()),
      ...callMarkersArrayRef.current,
      ...propMarkersArrayRef.current,
    ] as any;
    prevCallsSigRef.current = callsSig;
    prevPropsSigRef.current = propsSig;
  }, [layers, units, calls, properties, mapLoaded, createMarker, removeMarker]);

  // ============================================================
  // Route Button Click Handler (delegated from info window HTML)
  // ============================================================

  useEffect(() => {
    function handleRouteClick(e: MouseEvent) {
      const btn = (e.target as HTMLElement).closest('[data-route-unit]') as HTMLElement | null;
      if (!btn) return;
      const unitCallSign = btn.getAttribute('data-route-unit') || '';
      const callNumber = btn.getAttribute('data-route-call') || '';
      const uLat = parseFloat(btn.getAttribute('data-route-ulat') || '');
      const uLng = parseFloat(btn.getAttribute('data-route-ulng') || '');
      const cLat = parseFloat(btn.getAttribute('data-route-clat') || '');
      const cLng = parseFloat(btn.getAttribute('data-route-clng') || '');
      if (!isNaN(uLat) && !isNaN(uLng) && !isNaN(cLat) && !isNaN(cLng)) {
        showRoute(unitCallSign, callNumber, uLat, uLng, cLat, cLng);
        infoWindowRef.current?.remove();
      }
    }
    document.addEventListener('click', handleRouteClick);
    return () => document.removeEventListener('click', handleRouteClick);
  }, [showRoute]);

  // Delegated handler for "ADD TO PATROL ROUTE" buttons in call popups —
  // queue the call as a stop in the optimized multi-call route.
  useEffect(() => {
    function handleQueueClick(e: MouseEvent) {
      const btn = (e.target as HTMLElement).closest('[data-queue-call]') as HTMLElement | null;
      if (!btn) return;
      const callNumber = btn.getAttribute('data-queue-call') || '';
      const lat = parseFloat(btn.getAttribute('data-queue-lat') || '');
      const lng = parseFloat(btn.getAttribute('data-queue-lng') || '');
      const label = btn.getAttribute('data-queue-label') || '';
      if (!callNumber || isNaN(lat) || isNaN(lng)) return;
      setRouteQueue((prev) => (prev.some((s) => s.callNumber === callNumber)
        ? prev
        : [...prev, { callNumber, lat, lng, label }]));
      infoWindowRef.current?.remove();
    }
    document.addEventListener('click', handleQueueClick);
    return () => document.removeEventListener('click', handleQueueClick);
  }, []);

  // Auto-pick a responding unit the first time stops are queued: prefer an
  // available unit, else any unit with GPS. Dispatcher can override.
  useEffect(() => {
    if (routeQueue.length === 0 || routeUnit) return;
    const withGps = units.filter((u) => u.latitude != null && u.longitude != null);
    if (!withGps.length) return;
    const pick = withGps.find((u) => u.status === 'available') || withGps[0];
    setRouteUnit(pick.call_sign);
  }, [routeQueue.length, routeUnit, units]);

  const handleOptimizeRoute = useCallback(() => {
    if (!routeUnit || routeQueue.length === 0) return;
    const unit = units.find((u) => u.call_sign === routeUnit);
    if (!unit || unit.latitude == null || unit.longitude == null) return;
    showMultiStopRoute(
      routeUnit,
      { lat: unit.latitude, lng: unit.longitude },
      routeQueue.map((s) => ({ callNumber: s.callNumber, lat: s.lat, lng: s.lng, label: s.label })),
    );
  }, [routeUnit, routeQueue, units, showMultiStopRoute]);

  const handleClearPatrol = useCallback(() => {
    setRouteQueue([]);
    setRouteUnit(null);
    clearMultiStop();
  }, [clearMultiStop]);

  // Low-priority, schedulable service calls a single unit can batch into one
  // optimized patrol loop (vs emergency calls that get their own responder).
  const ROUTABLE_SERVICE_TYPES = useMemo(
    () => new Set(['pso_client_request', 'civil_paper_service', 'process_service', 'welfare_check', 'civil_standby', 'paper_service']),
    [],
  );
  const routableServiceCalls = useMemo(
    () => calls.filter((c) => c.latitude != null && c.longitude != null && ROUTABLE_SERVICE_TYPES.has(c.incident_type)),
    [calls, ROUTABLE_SERVICE_TYPES],
  );
  const handleQueueAllService = useCallback(() => {
    setRouteQueue(routableServiceCalls.slice(0, 11).map((c) => ({
      callNumber: c.call_number,
      lat: c.latitude as number,
      lng: c.longitude as number,
      label: formatIncidentType(c.incident_type),
    })));
  }, [routableServiceCalls]);

  // ── Map export: PNG snapshot, print, and situation-report PDF ──
  // Read the live WebGL canvas (needs preserveDrawingBuffer:true on init).
  const captureMapPng = useCallback((): { dataUrl: string | null; aspect: number } => {
    const map = mapInstanceRef.current;
    if (!map) return { dataUrl: null, aspect: 1.6 };
    try {
      map.triggerRepaint();
      const canvas = map.getCanvas();
      return { dataUrl: canvas.toDataURL('image/png'), aspect: canvas.width / canvas.height };
    } catch (err) {
      devWarn('[Map] canvas capture failed:', err);
      return { dataUrl: null, aspect: 1.6 };
    }
  }, []);

  const handleScreenshot = useCallback(async (): Promise<boolean> => {
    const { dataUrl } = captureMapPng();
    if (!dataUrl) return false;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `RMPG_Map_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    a.click();
    return true;
  }, [captureMapPng]);

  const handlePrintMap = useCallback(() => {
    const { dataUrl } = captureMapPng();
    if (!dataUrl) { window.print(); return; }
    const w = window.open('', '_blank');
    if (!w) return;
    // Build the print page via DOM (no document.write — XSS-safe).
    w.document.title = 'RMPG Map';
    w.document.body.style.margin = '0';
    w.document.body.style.background = '#000';
    const img = w.document.createElement('img');
    img.src = dataUrl;
    img.style.cssText = 'width:100%;height:auto;display:block;';
    img.onload = () => { setTimeout(() => { w.print(); w.close(); }, 250); };
    w.document.body.appendChild(img);
  }, [captureMapPng]);

  const handleSituationReport = useCallback(async () => {
    const map = mapInstanceRef.current;
    const { dataUrl, aspect } = captureMapPng();
    const center = map?.getCenter();
    const zoom = map?.getZoom() ?? 12;
    await generateMapSituationReport({
      mapImageDataUrl: dataUrl,
      mapAspect: aspect,
      operator: user?.full_name || user?.username || '—',
      center: { lat: center?.lat ?? 40.76, lng: center?.lng ?? -111.89 },
      zoom,
      calls: calls.filter((c) => c.latitude != null && c.longitude != null).map((c) => ({
        call_number: c.call_number,
        incident_type: c.incident_type,
        priority: c.priority,
        status: c.status,
        location_address: c.location_address,
      })),
      units: units.filter((u) => u.latitude != null && u.longitude != null).map((u) => ({
        call_sign: u.call_sign,
        officer_name: u.officer_name,
        status: u.status,
        current_call_type: u.current_call_type,
        current_call_location: u.current_call_location,
      })),
      analysis: analysisSummary.data ? {
        safetyZones: analysisSummary.data.metrics?.totalSafetyZones,
        highRisk: analysisSummary.data.metrics?.highRiskZones,
        predictions: analysisSummary.data.metrics?.activePredictions,
        repeatAddrs: analysisSummary.data.metrics?.repeatAddressCount,
      } : null,
      patrol: multiStopRoute ? {
        unitCallSign: multiStopRoute.unitCallSign,
        totalEta: multiStopRoute.totalEta,
        totalDistance: multiStopRoute.totalDistance,
        stops: multiStopRoute.stops.map((s) => ({ order: s.order, callNumber: s.callNumber, label: s.label, legEta: s.legEta })),
      } : null,
    });
  }, [captureMapPng, user, calls, units, analysisSummary.data, multiStopRoute]);

  // Delegated handler for "Navigate with Organic Maps" buttons rendered inside
  // info-window HTML. Android-native only; TS wrapper no-ops on other platforms.
  useEffect(() => {
    function handleOmClick(e: MouseEvent) {
      const btn = (e.target as HTMLElement).closest('[data-om-lat]') as HTMLElement | null;
      if (!btn) return;
      const lat = parseFloat(btn.getAttribute('data-om-lat') || '');
      const lng = parseFloat(btn.getAttribute('data-om-lng') || '');
      const label = btn.getAttribute('data-om-label') || '';
      if (isNaN(lat) || isNaN(lng)) return;
      navigateTo(lat, lng, label).then((res) => {
        if (!res.ok) devWarn('[Nav] launch failed:', res.reason);
        else devLog('[Nav] launched via', res.mode);
      });
      infoWindowRef.current?.remove();
    }
    document.addEventListener('click', handleOmClick);
    return () => document.removeEventListener('click', handleOmClick);
  }, []);

  // ============================================================
  // Update Route When Routed Unit GPS Changes
  // ============================================================

  useEffect(() => {
    if (!activeRoute) return;
    const routedUnit = units.find(u => u.call_sign === activeRoute.unitCallSign);
    if (routedUnit?.latitude != null && routedUnit?.longitude != null) {
      const now = Date.now();
      const last = lastRouteUpdateRef.current;
      const dist = last
        ? Math.hypot(routedUnit.latitude - last.lat, routedUnit.longitude - last.lng) * 111000
        : Infinity;
      if (last && now - last.time < 10000 && dist < 50) return;
      lastRouteUpdateRef.current = { time: now, lat: routedUnit.latitude, lng: routedUnit.longitude };
      updateOrigin(routedUnit.latitude, routedUnit.longitude);
    }
  }, [activeRoute, units, updateOrigin]);

  // ============================================================
  // Heat Map Circles
  // ============================================================

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    // Clean up heatmap when toggled off
    if (!showHeatmap || heatmapData.length === 0) {
      if (map.getLayer('rmpg-heatmap-layer')) map.removeLayer('rmpg-heatmap-layer');
      if (map.getSource('rmpg-heatmap')) map.removeSource('rmpg-heatmap');
      heatmapLayerRef.current = null;
      return;
    }

    // Build weighted GeoJSON data points for heatmap
    const weightedFeatures = heatmapData
      .filter((p: any) => p.latitude != null && p.longitude != null && isFinite(p.latitude) && isFinite(p.longitude))
      .slice(0, 10000)
      .map((point: any) => ({
        type: 'Feature' as const,
        properties: {
          weight: heatmapMode === 'risk' ? (point.risk_weight || point.count || 1) : (point.count || 1),
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [point.longitude, point.latitude],
        },
      }));

    try {
      const existingSrc = map.getSource('rmpg-heatmap') as mapboxgl.GeoJSONSource | undefined;
      if (existingSrc) {
        existingSrc.setData({ type: 'FeatureCollection', features: weightedFeatures });
        return;
      }

      whenStyleReady(map, () => {
      if (map.getSource('rmpg-heatmap')) return;
      map.addSource('rmpg-heatmap', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: weightedFeatures,
        },
      });

      const heatmapColor = heatmapMode === 'risk'
        ? [
            'rgba(0,0,0,0)',
            'rgba(255,165,0,0.3)',
            'rgba(255,100,0,0.5)',
            'rgba(255,50,0,0.7)',
            'rgba(255,0,0,0.85)',
            'rgba(200,0,0,1)',
          ]
        : [
            // Spillman pure-black theme — ZERO blue. Ramp through brand gold
            // into amber/red (was rgba(0,128,255) cyan at the low end).
            'rgba(0,0,0,0)',
            'rgba(212,160,23,0.25)',
            'rgba(230,180,40,0.45)',
            'rgba(255,200,0,0.6)',
            'rgba(255,140,0,0.8)',
            'rgba(255,50,0,0.95)',
          ];

      const colorExpr = ['interpolate', ['linear'], ['heatmap-density'],
        0, heatmapColor[0],
        0.2, heatmapColor[1],
        0.4, heatmapColor[2],
        0.6, heatmapColor[3],
        0.8, heatmapColor[4],
        1, heatmapColor[5],
      ];

      map.addLayer({
        id: 'rmpg-heatmap-layer',
        type: 'heatmap',
        source: 'rmpg-heatmap',
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-radius': 30,
          'heatmap-opacity': 0.7,
          'heatmap-color': colorExpr as any,
        },
      });

      heatmapLayerRef.current = { setMap: null } as any;
      });
    } catch (err) {
      console.warn('[MapPage] Error creating heatmap layer:', err);
    }

    return () => {
      if (map.getLayer('rmpg-heatmap-layer')) map.removeLayer('rmpg-heatmap-layer');
      if (map.getSource('rmpg-heatmap')) map.removeSource('rmpg-heatmap');
      heatmapLayerRef.current = null;
    };
  }, [showHeatmap, heatmapData, heatmapMode, mapLoaded, mapStyle]);

  // ============================================================
  // Unit-to-Call Tracking Lines
  // ============================================================

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    if (!showTrackingLines) {
      if (map.getLayer('rmpg-tracking-lines')) map.removeLayer('rmpg-tracking-lines');
      if (map.getSource('rmpg-tracking-lines')) map.removeSource('rmpg-tracking-lines');
      trackingLinesRef.current = [];
      setTrackingLineCount(0);
      return;
    }

    const features: any[] = [];

    units.forEach((unit) => {
      if (unit.latitude == null || unit.longitude == null) return;
      if (!unit.current_call_id) return;
      if (!CLEARABLE_STATUSES.includes(unit.status)) return;
      if (!isFinite(unit.latitude) || !isFinite(unit.longitude)) return;

      const call = calls.find((c) => String(c.id) === String(unit.current_call_id));
      if (!call || call.latitude == null || call.longitude == null) return;
      if (!isFinite(call.latitude) || !isFinite(call.longitude)) return;
      if (unit.latitude === call.latitude && unit.longitude === call.longitude) return;

      const statusColor = UNIT_STATUS_COLORS[unit.status] || '#666666';
      const isDashed = unit.status === 'dispatched';

      features.push({
        type: 'Feature',
        properties: { color: statusColor, isDashed },
        geometry: {
          type: 'LineString',
          coordinates: [
            [unit.longitude, unit.latitude],
            [call.longitude, call.latitude],
          ],
        },
      });
    });

    if (features.length === 0) {
      const existingSrc = map.getSource('rmpg-tracking-lines') as mapboxgl.GeoJSONSource | undefined;
      if (existingSrc) {
        existingSrc.setData({ type: 'FeatureCollection', features: [] });
      } else {
        if (map.getLayer('rmpg-tracking-lines')) map.removeLayer('rmpg-tracking-lines');
        if (map.getSource('rmpg-tracking-lines')) map.removeSource('rmpg-tracking-lines');
      }
      trackingLinesRef.current = [];
      setTrackingLineCount(0);
      return;
    }

    try {
      const geojsonData: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };

      const existingSrc = map.getSource('rmpg-tracking-lines') as mapboxgl.GeoJSONSource | undefined;
      if (existingSrc) {
        existingSrc.setData(geojsonData);
        setTrackingLineCount(features.length);
      } else {
        whenStyleReady(map, () => {
          if (map.getSource('rmpg-tracking-lines')) return;
          map.addSource('rmpg-tracking-lines', {
            type: 'geojson',
            data: geojsonData,
          });

          const dashExpr = ['case',
            ['==', ['get', 'isDashed'], true],
            [1, 4],
            [1],
          ];

          map.addLayer({
            id: 'rmpg-tracking-lines',
            type: 'line',
            source: 'rmpg-tracking-lines',
            paint: {
              'line-color': ['get', 'color'],
              'line-opacity': ['case', ['==', ['get', 'isDashed'], true], 0, 0.6],
              'line-width': 2,
              'line-dasharray': dashExpr as any,
            },
          });

          setTrackingLineCount(features.length);
        });
      }
    } catch (err) {
      console.warn('[MapPage] Error updating tracking lines:', err);
    }
  }, [units, calls, showTrackingLines, mapLoaded, mapStyle]);

  // ============================================================
  // GPS Breadcrumb Trails (enhanced: color modes, arrows, road names, playback)
  // ============================================================

  const breadcrumbInfoRef = useRef<mapboxgl.Popup | null>(null);
  // Holds the latest fetched trails so the (singly-registered) dot click
  // handler can resolve a clicked feature back to its full point data
  // without closing over the loop iteration values it was created in.
  const breadcrumbTrailsRef = useRef<Array<{
    unit_id: number; call_sign: string; officer_name: string; badge_number: string;
    points: Array<{
      lat: number; lng: number; accuracy: number | null; heading: number | null;
      speed: number | null; status: string; call_number: string | null;
      call_type: string | null; time: string;
      road_name: string | null; intersection: string | null;
    }>;
  }>>([]);
  // Layer / source IDs for the dots GeoJSON layer. Kept here as constants
  // so the click-handler effect and fetchTrails agree on naming.
  const DOTS_SOURCE_ID = 'rmpg-breadcrumb-dots';
  const DOTS_LAYER_ID = 'rmpg-breadcrumb-dots';
  // Heading arrows render as a GPU-drawn symbol layer (not per-point DOM
  // markers). Hundreds of DOM markers forced Mapbox to rewrite a transform on
  // every element each frame during pan/zoom, so the pins visibly lagged and
  // "flew" across the map. A symbol layer draws them all in one WebGL pass.
  const ARROWS_SOURCE_ID = 'rmpg-breadcrumb-arrows';
  const ARROWS_LAYER_ID = 'rmpg-breadcrumb-arrows';
  const ARROW_IMAGE_ID = 'rmpg-breadcrumb-arrow-icon';

  // Single-bind dot click handler. Resolves the clicked circle feature
  // back to its trail+point via breadcrumbTrailsRef, then renders the
  // detail popup. Replaces N×M per-dot DOM listeners that were being
  // re-added every 15s refresh.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    if (!breadcrumbInfoRef.current) {
      breadcrumbInfoRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });
    }

    const formatSpeedMphLocal = (mps: number | null) => mps == null ? '—' : `${(mps * 2.237).toFixed(0)} mph`;
    const STATUS_LABELS_LOCAL: Record<string, string> = {
      available: 'AVAILABLE', dispatched: 'DISPATCHED', enroute: 'ENROUTE',
      onscene: 'ON SCENE', busy: 'BUSY', off_duty: 'OFF DUTY',
    };

    const onDotClick = (e: mapboxgl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [DOTS_LAYER_ID] });
      if (!features.length) return;
      const props = features[0].properties as { trailIdx?: number; ptIdx?: number; unitColor?: string } | null;
      if (!props || props.trailIdx == null || props.ptIdx == null) return;
      const trail = breadcrumbTrailsRef.current[props.trailIdx];
      const pt = trail?.points[props.ptIdx];
      if (!trail || !pt) return;

      const ptIdx = props.ptIdx;
      const unitColor = props.unitColor || '#22c55e';
      const time = safeDateTimeStr(pt.time, '');
      const locationRow = pt.road_name
        ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Road</td><td style="color:#e0e0e0">${pt.road_name}${pt.intersection ? ` @ ${pt.intersection}` : ''}</td></tr>`
        : '';

      // Compute acceleration and distance from previous point
      let accelHtml = '';
      let distHtml = '';
      if (ptIdx > 0) {
        const prev = trail.points[ptIdx - 1];
        const dtSec = (parseTimestamp(pt.time).getTime() - parseTimestamp(prev.time).getTime()) / 1000;
        // Distance (Haversine approx)
        const dLat = (pt.lat - prev.lat) * Math.PI / 180;
        const dLng = (pt.lng - prev.lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(prev.lat * Math.PI / 180) * Math.cos(pt.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        const distM = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        distHtml = `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Distance</td><td style="color:#e0e0e0">${Math.round(distM)}m from last ping (${dtSec.toFixed(1)}s)</td></tr>`;
        // Acceleration
        if (dtSec > 0 && pt.speed != null && prev.speed != null) {
          const accelVal = (pt.speed - prev.speed) / dtSec;
          const accelColor = accelToColor(accelVal);
          const arrow = accelVal >= 0 ? '↑' : '↓';
          const sign = accelVal >= 0 ? '+' : '';
          accelHtml = `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Accel</td><td style="color:${accelColor};font-weight:bold">${arrow} ${sign}${accelVal.toFixed(1)} m/s²</td></tr>`;
        }
      }

      // GPS quality badge
      const acc = pt.accuracy;
      let gpsLabel = 'N/A'; let gpsColor = '#666666';
      if (acc != null) {
        if (acc < 10) { gpsLabel = 'GPS'; gpsColor = '#22c55e'; }
        else if (acc < 30) { gpsLabel = 'GOOD'; gpsColor = '#84cc16'; }
        else if (acc < 100) { gpsLabel = 'FAIR'; gpsColor = '#eab308'; }
        else { gpsLabel = 'POOR'; gpsColor = '#ef4444'; }
      }
      const gpsRow = `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">GPS</td><td><span style="font-size:9px;font-weight:bold;color:${gpsColor};padding:0 4px;border:1px solid ${gpsColor}40;border-radius:2px">${gpsLabel}</span> ${acc != null ? `±${Math.round(acc)}m` : ''}</td></tr>`;

      // Heading compass
      const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      const headingDir = pt.heading != null ? dirs[Math.round(pt.heading / 45) % 8] : '';
      const headingCompass = pt.heading != null
        ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Heading</td><td style="color:#e0e0e0"><span style="display:inline-block;transform:rotate(${Math.round(pt.heading)}deg);font-size:13px">↑</span> ${headingDir} (${Math.round(pt.heading)}°)</td></tr>`
        : `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Heading</td><td style="color:#e0e0e0">—</td></tr>`;

      // Mini speed sparkline SVG (surrounding ~20 points)
      const sparkStart = Math.max(0, ptIdx - 10);
      const sparkEnd = Math.min(trail.points.length, ptIdx + 10);
      const sparkPoints = trail.points.slice(sparkStart, sparkEnd);
      let sparkSvg = '';
      if (sparkPoints.length > 2) {
        const maxSpd = Math.max(...sparkPoints.map(p => (p.speed ?? 0) * 2.237), 10);
        const svgW = 180; const svgH = 36;
        const coords = sparkPoints.map((p, i) => {
          const x = (i / (sparkPoints.length - 1)) * svgW;
          const y = svgH - ((p.speed ?? 0) * 2.237 / maxSpd) * (svgH - 4) - 2;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        const highlightIdx = ptIdx - sparkStart;
        const hx = sparkPoints.length > 1 ? (highlightIdx / (sparkPoints.length - 1)) * svgW : svgW / 2;
        const hy = svgH - (((sparkPoints[highlightIdx]?.speed ?? 0) * 2.237) / maxSpd) * (svgH - 4) - 2;
        sparkSvg = `<svg width="${svgW}" height="${svgH}" style="display:block;margin:4px 0">` +
          `<polyline points="${coords.join(' ')}" fill="none" stroke="#4fc3f7" stroke-width="1.5" opacity="0.7"/>` +
          `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="3" fill="#fbbf24" stroke="#fff" stroke-width="1"/>` +
          `</svg>`;
      }

      const html = `
        <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:240px;line-height:1.6;background:#0d0d0d;padding:10px 12px;border-radius:6px;border:1px solid #282828">
          <div style="font-weight:bold;font-size:13px;margin-bottom:4px;color:${unitColor}">
            ${escapeHtml(trail.call_sign)} — ${escapeHtml(trail.officer_name || 'Unknown')}
          </div>
          <div style="color:#8899aa;font-size:10px;margin-bottom:4px">${escapeHtml(trail.badge_number || '')}</div>
          ${pt.road_name ? `<div style="color:#fbbf24;font-weight:bold;font-size:12px;margin-bottom:4px;padding:2px 0;border-bottom:1px solid #282828">${escapeHtml(pt.road_name)}</div>` : ''}
          <div style="font-size:18px;font-weight:900;color:${speedToColor(pt.speed)};margin-bottom:4px">${formatSpeedMphLocal(pt.speed)}</div>
          ${sparkSvg}
          <table style="width:100%;font-size:11px;border-collapse:collapse">
            <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Time</td><td style="font-weight:bold;color:#fff">${time}</td></tr>
            <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Status</td><td style="font-weight:bold;color:${statusToColor(pt.status)}">${STATUS_LABELS_LOCAL[pt.status] || pt.status}</td></tr>
            <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Speed</td><td style="color:${speedToColor(pt.speed)};font-weight:bold">${formatSpeedMphLocal(pt.speed)}</td></tr>
            ${accelHtml}
            ${headingCompass}
            ${locationRow}
            ${distHtml}
            ${gpsRow}
            <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Position</td><td style="font-size:10px;color:#e0e0e0">${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}</td></tr>
            ${pt.call_number ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Call</td><td style="font-weight:bold;color:#4fc3f7">${escapeHtml(pt.call_number)} — ${escapeHtml(pt.call_type || '')}</td></tr>` : ''}
          </table>
        </div>
      `;
      breadcrumbInfoRef.current?.setHTML(html);
      if (isFinite(pt.lng) && isFinite(pt.lat)) {
        breadcrumbInfoRef.current?.setLngLat([pt.lng, pt.lat]);
        breadcrumbInfoRef.current?.addTo(map);
      }
    };

    map.on('click', DOTS_LAYER_ID, onDotClick);
    return () => {
      map.off('click', DOTS_LAYER_ID, onDotClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    // Clear existing breadcrumb visuals — dots & arrows use setData()
    // for efficient updates during interval refreshes.  Lines migrated to
    // setData as well (FIX 32) so we only tear them down on full cleanup.
    if (map.getLayer(DOTS_LAYER_ID)) map.removeLayer(DOTS_LAYER_ID);
    if (map.getSource(DOTS_SOURCE_ID)) map.removeSource(DOTS_SOURCE_ID);
    if (map.getLayer(ARROWS_LAYER_ID)) map.removeLayer(ARROWS_LAYER_ID);
    if (map.getSource(ARROWS_SOURCE_ID)) map.removeSource(ARROWS_SOURCE_ID);
    speedAlertKeyedRef.current.forEach((m) => m.remove());
    speedAlertKeyedRef.current.clear();
    breadcrumbTrailsRef.current = [];

    if (!showBreadcrumbs) { setPlaybackTrails([]); return; }

    const token = localStorage.getItem('rmpg_token');
    if (!token) return;

    if (!breadcrumbInfoRef.current) {
      breadcrumbInfoRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });
    }

    // formatSpeedMph / STATUS_LABELS / formatHeadingDir used to live here for
    // the per-dot popup HTML. The popup now lives in the singly-bound click
    // handler above, which owns its own local copies of those helpers.

    interface TrailPoint {
      lat: number; lng: number; accuracy: number | null; heading: number | null;
      speed: number | null; status: string; call_number: string | null;
      call_type: string | null; time: string;
      road_name: string | null; intersection: string | null;
    }
    interface Trail {
      unit_id: number; call_sign: string; officer_name: string;
      badge_number: string; points: TrailPoint[];
    }

    let retryTimeout: ReturnType<typeof setTimeout>;

    const fetchTrails = async () => {
      try {
        const rawTrails = await apiFetch<Trail[]>(`/dispatch/gps/trails?hours=${breadcrumbHours}`);
        const trails = (Array.isArray(rawTrails) ? rawTrails : []).filter(t => Array.isArray(t?.points));
        if (trails.length === 0) {
          // Clear the dots source if no trails so leftover points from
          // previous refresh don't linger after a unit goes off-duty.
          breadcrumbTrailsRef.current = [];
          const existingDotSrc = map.getSource(DOTS_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
          if (existingDotSrc) existingDotSrc.setData({ type: 'FeatureCollection', features: [] });
          const existingArrowSrc = map.getSource(ARROWS_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
          if (existingArrowSrc) existingArrowSrc.setData({ type: 'FeatureCollection', features: [] });
          return;
        }
        setPlaybackTrails(trails);
        breadcrumbTrailsRef.current = trails;

        const lineFeatures: any[] = [];
        const dotFeatures: any[] = [];
        const arrowFeatures: any[] = [];

        trails.forEach((trail, idx) => {
          if (trail.points.length === 0) return;

          const unitColor = TRAIL_COLORS[idx % TRAIL_COLORS.length];

          for (let i = 0; i < trail.points.length - 1; i++) {
            const p1 = trail.points[i];
            const p2 = trail.points[i + 1];
            if (!isFinite(p1.lng) || !isFinite(p1.lat) || !isFinite(p2.lng) || !isFinite(p2.lat)) continue;
            const freshness = (i + 1) / trail.points.length;
            const opacity = 0.25 + freshness * 0.6;

            let segColor: string;
            if (breadcrumbColorMode === 'speed') {
              segColor = speedToColor(p1.speed);
            } else if (breadcrumbColorMode === 'status') {
              segColor = statusToColor(p1.status);
            } else if (breadcrumbColorMode === 'accel') {
              const dt = (parseTimestamp(p2.time).getTime() - parseTimestamp(p1.time).getTime()) / 1000;
              if (dt > 0 && p1.speed != null && p2.speed != null) {
                const accel = (p2.speed - p1.speed) / dt;
                segColor = accelToColor(accel);
              } else {
                segColor = accelToColor(null);
              }
            } else {
              segColor = unitColor;
            }

            lineFeatures.push({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: [[p1.lng, p1.lat], [p2.lng, p2.lat]] },
              properties: { strokeColor: segColor, strokeOpacity: opacity },
            });
          }

          // Heading arrows → GeoJSON features (drawn by the symbol layer below).
          // Min opacity raised to 0.45 so older arrows still read as "solid".
          trail.points.forEach((pt, ptIdx) => {
            if (ptIdx % 8 !== 4 || pt.heading == null) return;
            if (!isFinite(pt.lng) || !isFinite(pt.lat) || !isFinite(pt.heading)) return;
            const freshness = (ptIdx + 1) / trail.points.length;
            const arrowColor = breadcrumbColorMode === 'speed' ? speedToColor(pt.speed) : breadcrumbColorMode === 'status' ? statusToColor(pt.status) : breadcrumbColorMode === 'accel' ? accelToColor(null) : unitColor;
            arrowFeatures.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] },
              properties: { heading: pt.heading, color: arrowColor, opacity: 0.45 + freshness * 0.45 },
            });
          });

          // Build dot features for the GeoJSON circle layer. Per-point click
          // popups are handled by the singly-bound handler above (which reads
          // breadcrumbTrailsRef + the feature's trailIdx/ptIdx). This replaces
          // ~150 LOC of per-dot DOM marker + per-dot addEventListener that
          // were being rebuilt on every 15s refresh.
          trail.points.forEach((pt, ptIdx) => {
            const isLast = ptIdx === trail.points.length - 1;
            let dotColor: string;
            if (breadcrumbColorMode === 'speed') dotColor = speedToColor(pt.speed);
            else if (breadcrumbColorMode === 'status') dotColor = statusToColor(pt.status);
            else if (breadcrumbColorMode === 'accel') {
              if (ptIdx > 0) {
                const prev = trail.points[ptIdx - 1];
                const dt = (parseTimestamp(pt.time).getTime() - parseTimestamp(prev.time).getTime()) / 1000;
                if (dt > 0 && pt.speed != null && prev.speed != null) {
                  dotColor = accelToColor((pt.speed - prev.speed) / dt);
                } else { dotColor = accelToColor(null); }
              } else { dotColor = accelToColor(null); }
            } else dotColor = unitColor;

            if (!isFinite(pt.lng) || !isFinite(pt.lat)) return;
            dotFeatures.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] },
              properties: { color: dotColor, isLast, trailIdx: idx, ptIdx, unitColor },
            });
          });
        });

        // Create or update breadcrumb line source & layer via setData()
        // (same pattern as dots/arrows — avoids source-teardown blink).
        const linesData: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: lineFeatures };
        const existingLineSrc = map.getSource('rmpg-breadcrumb-lines') as mapboxgl.GeoJSONSource | undefined;
        if (existingLineSrc) {
          existingLineSrc.setData(linesData);
        } else if (lineFeatures.length > 0) {
          whenStyleReady(map, () => {
            map.addSource('rmpg-breadcrumb-lines', {
              type: 'geojson',
              data: linesData,
            });
            map.addLayer({
              id: 'rmpg-breadcrumb-lines',
              type: 'line',
              source: 'rmpg-breadcrumb-lines',
              paint: {
                'line-color': ['get', 'strokeColor'],
                'line-opacity': ['get', 'strokeOpacity'],
                'line-width': 3,
              },
            });
          });
        }

        // Create or update breadcrumb dots source + circle layer.
        // setData() is much cheaper than recreating the source — most refreshes
        // hit the update branch. The first refresh creates the source+layer.
        const dotsData: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: dotFeatures };
        const existingDotSrc = map.getSource(DOTS_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        if (existingDotSrc) {
          existingDotSrc.setData(dotsData);
        } else {
          whenStyleReady(map, () => {
            map.addSource(DOTS_SOURCE_ID, { type: 'geojson', data: dotsData });
            map.addLayer({
              id: DOTS_LAYER_ID,
              type: 'circle',
              source: DOTS_SOURCE_ID,
              paint: {
                'circle-color': ['get', 'color'],
                // Last point of each trail renders slightly larger / brighter
                // outline (preserves the visual emphasis the old DOM marker had).
                'circle-radius': ['case', ['get', 'isLast'], 5, 4],
                'circle-stroke-color': ['case', ['get', 'isLast'], '#fbbf24', '#fff'],
                'circle-stroke-width': ['case', ['get', 'isLast'], 2, 0.5],
                'circle-opacity': ['case', ['get', 'isLast'], 1, 0.6],
              },
            });
          });
        }

        // Heading arrows symbol layer. setData on refresh; first run registers
        // the SDF arrow icon (so `icon-color` tints per feature) + the layer.
        const arrowsData: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: arrowFeatures };
        const existingArrowSrc = map.getSource(ARROWS_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        if (existingArrowSrc) {
          existingArrowSrc.setData(arrowsData);
        } else {
          whenStyleReady(map, () => {
            if (!map.hasImage(ARROW_IMAGE_ID)) {
              // A white triangle pointing up (north). Registered as SDF so the
              // layer can tint each arrow by speed/status/accel color.
              const S = 24;
              const cv = document.createElement('canvas');
              cv.width = S; cv.height = S;
              const ctx = cv.getContext('2d');
              if (ctx) {
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.moveTo(S / 2, 2);
                ctx.lineTo(S - 3, S - 4);
                ctx.lineTo(3, S - 4);
                ctx.closePath();
                ctx.fill();
                map.addImage(ARROW_IMAGE_ID, ctx.getImageData(0, 0, S, S), { sdf: true });
              }
            }
            if (!map.getSource(ARROWS_SOURCE_ID)) map.addSource(ARROWS_SOURCE_ID, { type: 'geojson', data: arrowsData });
            if (!map.getLayer(ARROWS_LAYER_ID)) {
              map.addLayer({
                id: ARROWS_LAYER_ID,
                type: 'symbol',
                source: ARROWS_SOURCE_ID,
                layout: {
                  'icon-image': ARROW_IMAGE_ID,
                  'icon-size': 0.55,
                  'icon-rotate': ['get', 'heading'],
                  'icon-rotation-alignment': 'map',
                  'icon-allow-overlap': true,
                  'icon-ignore-placement': true,
                },
                paint: {
                  'icon-color': ['get', 'color'],
                  'icon-opacity': ['get', 'opacity'],
                },
              });
            }
          });
        }

        // Speed alert triangle markers (>= 80 mph) — delta update to avoid blink
        const newKeys = new Set<string>();
        trails.forEach((trail) => {
          trail.points.forEach((pt, ptIdx) => {
            const mph = pt.speed != null ? pt.speed * 2.237 : 0;
            if (!isFinite(pt.lng) || !isFinite(pt.lat)) return;
            if (mph >= 80) {
              const key = `${trail.unit_id}:${ptIdx}`;
              newKeys.add(key);
              if (!speedAlertKeyedRef.current.has(key)) {
                const el = document.createElement('div');
                el.innerHTML = `<svg width="18" height="16" viewBox="0 0 18 16"><polygon points="9,0 18,14 0,14" fill="#dc2626" stroke="#fbbf24" stroke-width="1.5"/><text x="9" y="11" text-anchor="middle" fill="#fff" font-size="9" font-weight="bold">!</text></svg>`;
                el.title = `Speed alert: ${Math.round(mph)} mph \u2014 ${trail.call_sign}`;
                const marker = new mapboxgl.Marker({ element: el }).setLngLat([pt.lng, pt.lat]).addTo(map);
                speedAlertKeyedRef.current.set(key, marker);
              }
            }
          });
        });
        speedAlertKeyedRef.current.forEach((marker, key) => {
          if (!newKeys.has(key)) { marker.remove(); speedAlertKeyedRef.current.delete(key); }
        });
      } catch {
        retryTimeout = setTimeout(fetchTrails, 5000);
      }
    };

    fetchTrails();
    const interval = setInterval(fetchTrails, 15000);
    return () => {
      clearInterval(interval);
      clearTimeout(retryTimeout);
      if (map.getLayer('rmpg-breadcrumb-lines')) map.removeLayer('rmpg-breadcrumb-lines');
      if (map.getSource('rmpg-breadcrumb-lines')) map.removeSource('rmpg-breadcrumb-lines');
      if (map.getLayer(DOTS_LAYER_ID)) map.removeLayer(DOTS_LAYER_ID);
      if (map.getSource(DOTS_SOURCE_ID)) map.removeSource(DOTS_SOURCE_ID);
      if (map.getLayer(ARROWS_LAYER_ID)) map.removeLayer(ARROWS_LAYER_ID);
      if (map.getSource(ARROWS_SOURCE_ID)) map.removeSource(ARROWS_SOURCE_ID);
      breadcrumbTrailsRef.current = [];
      speedAlertKeyedRef.current.forEach((m) => m.remove());
      speedAlertKeyedRef.current.clear();
    };
  }, [showBreadcrumbs, breadcrumbHours, breadcrumbColorMode, mapLoaded, mapStyle]);

  // ============================================================
  // Trail Playback Animation
  // ============================================================

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded || !isPlaying || playbackUnit == null) return;

    const trail = playbackTrails.find((t: any) => t.unit_id === playbackUnit);
    if (!trail || trail.points.length === 0) { setIsPlaying(false); return; }

    // Create or update playback marker
    if (!playbackMarkerRef.current) {
      const pt = trail.points[playbackIdx] || trail.points[0];
      if (!isFinite(pt.lng) || !isFinite(pt.lat)) { setIsPlaying(false); return; }
      const arrowEl = document.createElement('div');
      arrowEl.textContent = '\u25B6';
      arrowEl.style.cssText = `color:${speedToColor(pt.speed)};font-size:20px;text-shadow:0 0 3px #fff;transform:rotate(${pt.heading || 0}deg);font-family:system-ui;`;
      playbackMarkerRef.current = new mapboxgl.Marker({ element: arrowEl })
        .setLngLat([pt.lng, pt.lat])
        .addTo(map);
    }

    // Create speed label InfoWindow
    if (!playbackSpeedLabelRef.current) {
      playbackSpeedLabelRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });
    }

    let currentIdx = playbackIdx;
    const step = () => {
      if (currentIdx >= trail.points.length) {
        setIsPlaying(false);
        setPlaybackIdx(trail.points.length - 1);
        if (playbackSpeedLabelRef.current) playbackSpeedLabelRef.current.remove();
        return;
      }

      const pt = trail.points[currentIdx];
      if (!isFinite(pt.lng) || !isFinite(pt.lat)) { currentIdx++; step(); return; }
      if (playbackMarkerRef.current) {
        playbackMarkerRef.current.setLngLat([pt.lng, pt.lat]);
        const el = playbackMarkerRef.current.getElement();
        el.style.color = speedToColor(pt.speed);
        el.style.transform = `rotate(${pt.heading || 0}deg)`;
      }

      // Floating speed readout above playback marker
      if (playbackSpeedLabelRef.current) {
        const mphStr = pt.speed != null ? `${(pt.speed * 2.237).toFixed(0)} mph` : '\u2014';
        playbackSpeedLabelRef.current.setHTML(
          `<div style="font-family:monospace;font-size:12px;font-weight:900;color:${speedToColor(pt.speed)};background:#0d0d0d;padding:2px 6px;border-radius:3px;border:1px solid #282828;white-space:nowrap">${mphStr}</div>`
        );
        playbackSpeedLabelRef.current.setLngLat([pt.lng, pt.lat]);
        playbackSpeedLabelRef.current.addTo(map);
      }

      setPlaybackIdx(currentIdx);
      currentIdx++;

      // Speed-proportional playback: faster vehicle = faster animation
      const ptSpeed = pt.speed != null ? pt.speed * 2.237 : 10;
      const speedFactor = Math.max(ptSpeed / 30, 0.2);
      const delay = (200 / playbackSpeed) / speedFactor;
      playbackAnimRef.current = window.setTimeout(step, delay) as unknown as number;
    };

    step();

    return () => {
      if (playbackAnimRef.current != null) {
        clearTimeout(playbackAnimRef.current);
        playbackAnimRef.current = null;
      }
      if (playbackMarkerRef.current) {
        playbackMarkerRef.current.remove();
        playbackMarkerRef.current = null;
      }
      if (playbackSpeedLabelRef.current) {
        playbackSpeedLabelRef.current.remove();
        playbackSpeedLabelRef.current = null;
      }
    };
  }, [isPlaying, playbackUnit, playbackSpeed, mapLoaded]);

  // Cleanup playback marker and speed label when playback unit changes or stops
  useEffect(() => {
    if (playbackUnit == null) {
      if (playbackMarkerRef.current) {
        playbackMarkerRef.current.remove();
        playbackMarkerRef.current = null;
      }
      if (playbackSpeedLabelRef.current) {
        playbackSpeedLabelRef.current.remove();
        playbackSpeedLabelRef.current = null;
      }
    }
  }, [playbackUnit]);

  // ============================================================
  // GPS Self-Position Marker
  // ============================================================

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    if (gps.isTracking && gps.latitude != null && gps.longitude != null) {
      const pos: [number, number] = [gps.longitude, gps.latitude];
      if (selfMarkerRef.current) {
        // Update existing native marker in place: glide it to the new fix and
        // swap the inner content (accuracy ring + heading arrow) so it reflects
        // the latest GPS reading without destroying/recreating the pin.
        selfMarkerRef.current.setLngLat(pos);
        const el = selfMarkerRef.current.getElement?.();
        if (el) {
          const ring = el.querySelector('[data-gps-ring]') as HTMLElement | null;
          if (ring) {
            const ringSize = gps.accuracy != null ? Math.max(20, Math.min(80, gps.accuracy * 2)) : 24;
            ring.style.width = `${ringSize}px`;
            ring.style.height = `${ringSize}px`;
          }
          const arrow = el.querySelector('[data-gps-arrow]') as HTMLElement | null;
          if (arrow) {
            arrow.style.transform = `rotate(${gps.heading ?? 0}deg)`;
          }
          const speedEl = el.querySelector('[data-gps-speed]') as HTMLElement | null;
          if (speedEl) {
            const mph = gps.speed != null ? Math.round(gps.speed * 2.237) : null;
            speedEl.textContent = mph != null ? `${mph}` : '';
          }
        }
      } else {
        // Create new self marker
        selfMarkerRef.current = createMarker({
          map,
          position: pos,
          content: buildSelfPositionMarker(gps.accuracy, gps.heading, gps.speed),
          zIndex: 9999,
          title: `Your Position${gps.unitCallSign ? ` (${gps.unitCallSign})` : ''}`,
        });
      }

      // Auto-center on my unit when the user has opted in (Settings page).
      // Read the pref live so toggling it takes effect without a remount.
      if (getMapPreferences().gps.autoCenterOnUnit) {
        map.easeTo({ center: pos, duration: 600 });
      }
    } else {
      // Remove self marker if GPS stopped
      if (selfMarkerRef.current) {
        removeMarker(selfMarkerRef.current);
        selfMarkerRef.current = null;
      }
    }
  }, [gps.isTracking, gps.latitude, gps.longitude, gps.accuracy, gps.heading, gps.unitCallSign, mapLoaded, createMarker, removeMarker]);

  // ============================================================
  // Layer Toggle
  // ============================================================

  const toggleLayer = (layer: keyof typeof layers) => {
    if (eventPlanning.isDrawing) eventPlanning.cancelDrawing();
    setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
  };

  const panTo = (lat: number, lng: number) => {
    mapInstanceRef.current?.panTo({ lat, lng });
    mapInstanceRef.current?.setZoom(16);
  };

  // ============================================================
  // Derived Counts
  // ============================================================

  const unitsWithCoords = useMemo(() => units.filter(u => u.latitude != null && u.longitude != null), [units]);
  const callsWithCoords = useMemo(() => calls.filter(c => c.latitude != null && c.longitude != null), [calls]);
  const propertiesWithCoords = useMemo(() => properties.filter(p => p.latitude != null && p.longitude != null), [properties]);

  const unitsByStatus = useMemo(() => units.reduce((acc, u) => {
    acc[u.status] = (acc[u.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>), [units]);

  const callsByPriority = useMemo(() => calls.reduce((acc, c) => {
    acc[c.priority] = (acc[c.priority] || 0) + 1;
    return acc;
  }, {} as Record<string, number>), [calls]);

  const filteredUnits = useMemo(() => units.filter(u => {
    if (u.status === 'off_duty') return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (u.call_sign || '').toLowerCase().includes(q) || (u.officer_name || '').toLowerCase().includes(q);
  }), [units, searchQuery]);

  const filteredCalls = useMemo(() => calls.filter(c => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (c.call_number || '').toLowerCase().includes(q) || (c.incident_type || '').toLowerCase().includes(q) || (c.location_address || '').toLowerCase().includes(q);
  }), [calls, searchQuery]);

  // Quick call status change from map sidebar
  const handleCallStatusChange = useCallback(async (callId: string, newStatus: string) => {
    if (!callId || !newStatus) return;
    try {
      await apiFetch(`/dispatch/calls/${callId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus }),
      });
      // Refresh calls and units
      await Promise.all([fetchCalls(), fetchUnits()]);
    } catch (err) {
      console.error('Failed to update call status from map:', err);
      addToast('Failed to update call status', 'error');
    }
  }, [fetchCalls, fetchUnits, addToast]);

  // Address search with Mapbox Geocoding API
  const handleAddressSearch = useCallback((query: string) => {
    setAddressSearch(query);
    if (addressSearchTimer.current) clearTimeout(addressSearchTimer.current);

    if (!query.trim()) {
      setAddressResults([]);
      setShowAddressResults(false);
      return;
    }

    addressSearchTimer.current = setTimeout(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        // 1) Authoritative statewide UGRC address points (rmpg-geo D1) first.
        const local = await apiFetch<{ results: { full_add: string; city: string; zip: string; lat: number; lng: number }[] }>(
          `/geo/address-search?q=${encodeURIComponent(query)}&limit=6`,
        ).catch(() => ({ results: [] as any[] }));
        const localResults = (local?.results || [])
          .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
          .map((r, i) => ({
            description: `${r.full_add}${r.city ? ', ' + r.city : ''}${r.zip ? ' ' + r.zip : ''}`,
            place_id: `geo-${i}`,
            center: [r.lng, r.lat] as [number, number],
          }));

        // 2) Mapbox geocoding to fill (POIs / places / out-of-DB), deduped.
        let mapboxResults: { description: string; place_id: string; center: [number, number] }[] = [];
        const token = mapboxgl.accessToken;
        if (token) {
          const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&country=US&autocomplete=true&types=address,place&limit=8&proximity=-111.89,40.76&bbox=-114.052,36.998,-109.041,42.001`;
          try {
            const resp = await fetch(geocodeUrl, { signal: controller.signal });
            const data = await resp.json();
            if (data.features) {
              mapboxResults = data.features
                .filter((f: any) => Array.isArray(f.center) && f.center.length === 2)
                .map((f: any) => ({ description: f.place_name, place_id: f.id, center: f.center as [number, number] }));
            }
          } catch { /* mapbox optional */ }
        }

        const seen = new Set(localResults.map((r) => r.description.toLowerCase()));
        const merged = [...localResults, ...mapboxResults.filter((m) => !seen.has(m.description.toLowerCase()))].slice(0, 10);
        setAddressResults(merged);
        setShowAddressResults(merged.length > 0);
      } catch {
        // Ignore network errors / aborts
      } finally {
        clearTimeout(timeoutId);
      }
    }, 300);
  }, []);

  const handleAddressSelect = useCallback((center: [number, number], description: string) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const [lng, lat] = center;
    if (!isFinite(lng) || !isFinite(lat)) return;

    // Single combined fly (pan + zoom together). The old panTo()+setZoom()
    // were two competing animations, so the map neither centered on nor
    // zoomed to the address — it stayed at the prior view and the pin landed
    // off-screen. flyTo animates center + zoom as one move. essential:true so
    // it still runs under prefers-reduced-motion.
    map.flyTo({ center: [lng, lat], zoom: 17, speed: 1.6, curve: 1.4, essential: true });

    // Remove previous address marker
    if (addressMarkerRef.current) {
      removeMarker(addressMarkerRef.current);
      addressMarkerRef.current = null;
    }

    // Create search result marker
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;';
    // Use safe DOM methods instead of innerHTML to prevent XSS
    const label = document.createElement('div');
    // Spillman gold search pin (was generic #888888 gray).
    label.style.cssText = 'background:#0c0c0c;color:#d4a017;font-size:9px;font-weight:900;padding:3px 8px;border:1.5px solid #d4a017;white-space:nowrap;font-family:\'JetBrains Mono\',monospace;letter-spacing:0.05em;max-width:200px;overflow:hidden;text-overflow:ellipsis;border-radius:2px;box-shadow:0 0 8px rgba(212,160,23,0.45),0 1px 4px rgba(0,0,0,0.6);';
    label.textContent = description.split(',')[0];

    const arrow = document.createElement('div');
    arrow.style.cssText = 'width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #d4a017;';

    el.appendChild(label);
    el.appendChild(arrow);

    addressMarkerRef.current = createMarker({
      map,
      position: [lng, lat],
      content: el,
      zIndex: 5000,
      title: description,
    });

    // Auto-dismiss after 30 seconds — also clear the search box so the user
    // isn't left with stale text after the pin silently disappears.
    if (addressDismissTimer.current) clearTimeout(addressDismissTimer.current);
    addressDismissTimer.current = setTimeout(() => {
      if (addressMarkerRef.current) {
        removeMarker(addressMarkerRef.current);
        addressMarkerRef.current = null;
      }
      setAddressSearch('');
      setSelectedAddr(null);
      setShowDispatchHere(false);
      addressDismissTimer.current = null;
    }, 30000);

    setAddressSearch(description.split(',')[0]);
    setShowAddressResults(false);
    // Make this a navigable / dispatchable destination.
    setSelectedAddr({ lat, lng, label: description });
    setShowDispatchHere(false);
  }, [createMarker, removeMarker]);

  // ── Drive-to-address navigation ─────────────────────────────
  // Routes from the device's live GPS (fallback: map center) to the selected
  // address using the existing routing engine, then keeps the origin updated
  // as the device moves so it behaves like a turn-by-turn GPS.
  const startAddressNav = useCallback(() => {
    if (!selectedAddr) return;
    // Keep the destination pin + route alive while navigating (don't let the
    // 30s search auto-dismiss wipe them).
    if (addressDismissTimer.current) { clearTimeout(addressDismissTimer.current); addressDismissTimer.current = null; }
    const map = mapInstanceRef.current;
    const hasGps = gps.latitude != null && gps.longitude != null;
    const origin = hasGps
      ? { lat: gps.latitude as number, lng: gps.longitude as number }
      : (() => { const c = map?.getCenter(); return c ? { lat: c.lat, lng: c.lng } : null; })();
    if (!origin) return;
    const destLabel = selectedAddr.label.split(',')[0];
    showRoute('YOU', destLabel, origin.lat, origin.lng, selectedAddr.lat, selectedAddr.lng);
    setNavActive(true);
    if (map) map.flyTo({ center: [selectedAddr.lng, selectedAddr.lat], zoom: 15, essential: true });
  }, [selectedAddr, gps.latitude, gps.longitude, showRoute]);

  // Live origin tracking while navigating to an address (unitCallSign 'YOU').
  // updateOrigin throttles its own re-queries; the unit→call origin updater
  // (keyed on units) ignores 'YOU' since no unit has that call sign.
  useEffect(() => {
    if (!navActive || activeRoute?.unitCallSign !== 'YOU') return;
    if (gps.latitude == null || gps.longitude == null) return;
    updateOrigin(gps.latitude, gps.longitude);
  }, [navActive, activeRoute?.unitCallSign, gps.latitude, gps.longitude, updateOrigin]);

  // When the route is cleared, exit nav mode.
  useEffect(() => { if (!activeRoute) setNavActive(false); }, [activeRoute]);

  // ── Advanced nav guidance (voice + hazard-ahead + arrival) ──
  const toggleNavMute = useCallback(() => {
    setNavMuted((m) => { const next = !m; localStorage.setItem('rmpg-nav-voice', next ? 'muted' : 'on'); return next; });
  }, []);

  // Active calls become route hazards: scanned against the path ahead so a
  // unit driving anywhere gets a heads-up about live calls on their route.
  const navHazards = useMemo<NavHazard[]>(() => {
    return calls
      .filter((c) => c.latitude != null && c.longitude != null
        && (!c.status || !['closed', 'cleared', 'cancelled'].includes(c.status.toLowerCase())))
      .map((c) => {
        const p = (c.priority || '').toUpperCase();
        const t = (c.incident_type || '').toLowerCase();
        const officerSafety = /weapon|gun|knife|domestic|assault|shots?\b|robbery|pursuit|fight|hostage|armed|burglary in progress|shooting|stabbing/.test(t);
        const severity: NavHazard['severity'] = (p === 'P1' || officerSafety) ? 'critical' : (p === 'P2' ? 'high' : 'normal');
        const typeWords = (c.incident_type || 'call').replace(/_/g, ' ').toLowerCase();
        const prio = p === 'P1' ? 'priority one ' : p === 'P2' ? 'priority two ' : '';
        return {
          id: String(c.id),
          lat: c.latitude as number,
          lng: c.longitude as number,
          label: `${c.call_number} · ${c.incident_type}`,
          kind: `${prio}${typeWords} call`,
          severity,
        };
      });
  }, [calls]);

  // Don't warn a unit about the very call it's driving to.
  const navDestExcludeId = useMemo(() => {
    if (!activeRoute || activeRoute.unitCallSign === 'YOU') return undefined;
    const match = calls.find((c) => c.call_number === activeRoute.callNumber);
    return match ? String(match.id) : undefined;
  }, [activeRoute, calls]);

  const navGuidance = useNavGuidance({
    active: navActive && !!activeRoute,
    route: activeRoute,
    progress: routeProgress,
    geom: routeGeom,
    position: (gps.latitude != null && gps.longitude != null)
      ? { lat: gps.latitude as number, lng: gps.longitude as number } : null,
    hazards: navHazards,
    destLabel: activeRoute
      ? (activeRoute.unitCallSign === 'YOU' ? activeRoute.callNumber : `call ${activeRoute.callNumber}`)
      : '',
    destExcludeId: navDestExcludeId,
    muted: navMuted,
    offRoute,
  });

  // ── Dispatch a call at the selected address ─────────────────
  const createCallHere = useCallback(async () => {
    if (!selectedAddr || dispatchBusy) return;
    const incident = dispatchIncidentType.trim();
    if (!incident) return;
    setDispatchBusy(true);
    try {
      const created = await apiFetch<{ id?: number }>('/dispatch/calls', {
        method: 'POST',
        body: JSON.stringify({
          incident_type: incident,
          priority: dispatchPriority,
          location_address: selectedAddr.label,
          latitude: selectedAddr.lat,
          longitude: selectedAddr.lng,
        }),
      });
      addToast(`Call created at ${selectedAddr.label.split(',')[0]}`, 'success');

      // Optionally assign the nearest available unit by drive distance.
      if (autoAssignNearest && created?.id) {
        try {
          await apiFetch(`/dispatch/calls/${created.id}/auto-assign`, { method: 'POST', body: '{}' });
          addToast('Nearest available unit assigned', 'success');
          await fetchUnits();
        } catch (assignErr: any) {
          // No units on duty / no GPS — informational, not a failure.
          addToast(assignErr?.message || 'No nearby unit available to assign', 'info');
        }
      }

      setShowDispatchHere(false);
      setDispatchIncidentType('');
      await fetchCalls();
    } catch (err: any) {
      addToast(err?.message || 'Failed to create call', 'error');
    } finally {
      setDispatchBusy(false);
    }
  }, [selectedAddr, dispatchIncidentType, dispatchPriority, dispatchBusy, autoAssignNearest, addToast, fetchCalls, fetchUnits]);

  // ============================================================
  // Keyboard Shortcuts for Map
  // ============================================================

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case 'l': // Toggle layers panel
          e.preventDefault();
          setLayersPanelOpen(prev => !prev);
          break;
        case 'h': // Toggle heatmap
          e.preventDefault();
          setShowHeatmap(prev => !prev);
          break;
        case 'b': // Toggle breadcrumbs
          e.preventDefault();
          setShowBreadcrumbs(prev => !prev);
          break;
        case 'c': // Center on all units
          e.preventDefault();
          if (mapInstanceRef.current && units.length > 0) {
            const bounds = new mapboxgl.LngLatBounds();
            let hasCoords = false;
            units.forEach(u => {
              if (u.latitude != null && u.longitude != null) {
                bounds.extend([u.longitude, u.latitude]);
                hasCoords = true;
              }
            });
            if (hasCoords) mapInstanceRef.current.fitBounds(bounds, { padding: { top: 50, right: 50, bottom: 50, left: layersPanelOpen ? 220 : 60 } });
          }
          break;
        case '+':
        case '=': // Zoom in
          e.preventDefault();
          if (mapInstanceRef.current) {
            const z = mapInstanceRef.current.getZoom();
            if (z != null) mapInstanceRef.current.setZoom(z + 1);
          }
          break;
        case '-': // Zoom out
          e.preventDefault();
          if (mapInstanceRef.current) {
            const z = mapInstanceRef.current.getZoom();
            if (z != null) mapInstanceRef.current.setZoom(z - 1);
          }
          break;
        case 'escape': // Close all panels
          e.preventDefault();
          infoWindowRef.current?.remove();
          setLayersPanelOpen(false);
          setSidebarOpen(false);
          break;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [units, layersPanelOpen]);

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className={`relative h-full flex ${isMobile ? 'overflow-hidden' : ''}`}>
      {/* Map Container — full-bleed on mobile, flex-1 on desktop */}
      <div className="flex-1 relative" style={isMobile ? { flex: 1, minHeight: 0, paddingBottom: 'env(safe-area-inset-bottom, 0px)' } : undefined}>
        <div
          ref={mapRef}
          className="absolute inset-0 bg-surface-deep"
          style={{ width: '100%', height: '100%', touchAction: 'pan-x pan-y' }}
          role="application"
          aria-label="Tactical Map"
        />

        {/* Tile stall badge — non-blocking indicator.
            Offline tiles now render through the map canvas (ImageMapType), so the
            map remains interactive with street-level detail even when Google tiles
            stall. This badge just indicates cached/offline status + a retry button.
            Positioned top-left to avoid conflicts with route info panel (bottom-left). */}
        {mapLoaded && tilesStalled && (
          <div
            className={`absolute left-3 z-[10] flex items-center gap-2 px-3 py-2 ${isMobile ? 'top-16' : 'top-12'}`}
            style={{
              background: 'rgba(10,10,10,0.95)',
              border: '1px solid #f59e0b40',
              WebkitBackdropFilter: 'blur(4px)',
              backdropFilter: 'blur(4px)',
              borderRadius: 2,
            }}
          >
            <Loader2 style={{ width: 14, height: 14, color: '#f59e0b' }} className="animate-spin" aria-hidden="true" />
            <div className="flex flex-col">
              <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider font-mono leading-none">
                CACHED MAP
              </span>
              <span className="text-[8px] text-rmpg-500 font-mono leading-none mt-0.5">
                Using offline tiles · Map fully interactive
              </span>
            </div>
            <button
              onClick={() => {
                const map = mapInstanceRef.current;
                if (map) {
                  const center = map.getCenter();
                  if (center) {
                    map.panTo([center.lng + 0.0001, center.lat]);
                    setTimeout(() => map.panTo([center.lng, center.lat]), 200);
                  }
                }
              }}
              className="ml-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-gray-400 hover:text-white hover:bg-brand-600 transition-colors"
              style={{ borderRadius: 2 }}
            >
              Retry
            </button>
          </div>
        )}

        {/* RMPG Brand Watermark — pushed down on mobile to avoid search bar */}
        <div className={`absolute left-2 z-10 pointer-events-none opacity-40 ${isMobile ? 'top-12' : 'top-2'}`}>
          <RmpgLogo height={20} iconOnly />
        </div>

        {/* API key / auth error dialog (only for configuration problems, not connectivity) */}
        {isAuthError && (
          <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-surface-overlay/95 border border-red-600 p-8 shadow-xl max-w-lg text-center" style={{ borderRadius: 2 }}>
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
              <h3 className="text-white text-sm font-bold mb-2">Map Configuration Required</h3>
              <pre className="text-rmpg-300 text-xs leading-relaxed mb-4 whitespace-pre-wrap text-left">{mapError}</pre>
              <div className="bg-surface-deep border border-rmpg-600 p-3 text-left mb-4" style={{ borderRadius: 2 }}>
                <p className="text-[10px] text-rmpg-400 font-mono leading-relaxed">
                   <span className="text-amber-400 font-bold">Checklist:</span><br/>
                  1. Go to <span className="text-gray-400">account.mapbox.com/access-tokens</span><br/>
                  2. Create a <span className="text-amber-400">Mapbox Access Token</span><br/>
                  3. Ensure the token has <span className="text-amber-400">tilesets:read</span> scope<br/>
                  4. Add token to <span className="text-brand-400">client/.env</span>:<br/>
                  <span className="text-green-400 ml-2">VITE_MAPBOX_ACCESS_TOKEN=your_token</span><br/>
                  5. Restart the dev server
                </p>
              </div>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setMapRetry((n) => n + 1)}
                  className="px-4 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold uppercase tracking-wider transition-colors"
                  style={{ borderRadius: 2 }}
                >
                  Retry
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-1.5 bg-surface-deep hover:bg-surface-overlay text-rmpg-300 text-xs font-bold uppercase tracking-wider border border-rmpg-600 transition-colors"
                  style={{ borderRadius: 2 }}
                >
                  Hard Reload
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {loading && !mapError && (
          <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-surface-overlay/95 border border-rmpg-600 p-6 shadow-xl" style={{ borderRadius: 2 }}>
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-white text-sm font-mono">Initializing tactical map...</span>
              </div>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {error && !loading && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000]">
            <div className="bg-red-900/95 border border-red-600 px-4 py-2 backdrop-blur-sm shadow-xl" style={{ borderRadius: 2 }}>
              <span className="text-white text-sm">{error}</span>
            </div>
          </div>
        )}

        {/* ── Mobile Address Search Bar - Top (full width, semi-transparent) ── */}
        {isMobile && (
          <div className="absolute top-1 left-1 right-1 z-[1001]">
            <div className="relative">
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 w-3.5 h-3.5 text-white/50 pointer-events-none" />
                <input id="ff-mappage-0"
                  type="text"
                  value={addressSearch}
                  onChange={(e) => handleAddressSearch(e.target.value)}
                  onFocus={() => addressResults.length > 0 && setShowAddressResults(true)}
                  onBlur={() => setTimeout(() => setShowAddressResults(false), 300)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setShowAddressResults(false); setAddressSearch(''); setAddressResults([]); setSelectedAddr(null); setShowDispatchHere(false); }
                  }}
                  placeholder="Search address..."
                  aria-label="Search address"
                  className="w-full text-[16px] pl-9 pr-9 bg-black/40 border border-white/10 text-white placeholder:text-white/35 focus:border-white/30 focus:bg-black/60 focus:outline-none backdrop-blur-md shadow-lg font-mono"
                  style={{ borderRadius: 2, height: 38 }}
                />
                {addressSearch && (
                  <button
                    onClick={() => {
                      setAddressSearch('');
                      setAddressResults([]);
                      setShowAddressResults(false);
                      setSelectedAddr(null);
                      setShowDispatchHere(false);
                      if (addressMarkerRef.current) {
                        removeMarker(addressMarkerRef.current);
                        addressMarkerRef.current = null;
                      }
                    }}
                    className="absolute right-3 text-white/40 hover:text-white/80 p-1"
                    aria-label="Clear search"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {showAddressResults && addressResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#0a0a0a]/95 border border-[#2e2e2e] shadow-md backdrop-blur-md overflow-y-auto scrollbar-dark" style={{ borderRadius: 2, maxHeight: 260 }} role="listbox">
                  {addressResults.map((r) => (
                    <button
                      key={r.place_id}
                      role="option"
                      onMouseDown={(e) => e.preventDefault()}
                      onTouchStart={(e) => e.preventDefault()}
                      onClick={() => handleAddressSelect(r.center, r.description)}
                      className="w-full text-left px-4 py-3 text-[12px] text-white/80 hover:bg-white/10 hover:text-white transition-colors border-b border-white/10 last:border-0 flex items-center gap-2"
                      style={{ minHeight: 44 }}
                    >
                      <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
                      <span className="truncate">{r.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Address Search Bar + Zoom Controls - Top Right (above sidebar) ── */}
        {!isMobile && (
          <div
            className="absolute top-2 z-[1001] flex items-start gap-1.5"
            style={{ right: sidebarOpen ? 'calc(clamp(220px, 20vw, 300px) + 12px)' : 52 }}
          >
            <div className="relative">
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 w-3.5 h-3.5 text-rmpg-500 pointer-events-none" />
                <input id="ff-mappage-1"
                  type="text"
                  value={addressSearch}
                  onChange={(e) => handleAddressSearch(e.target.value)}
                  onFocus={() => addressResults.length > 0 && setShowAddressResults(true)}
                  onBlur={() => setTimeout(() => setShowAddressResults(false), 300)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setShowAddressResults(false); setAddressSearch(''); setAddressResults([]); setSelectedAddr(null); setShowDispatchHere(false); }
                  }}
                  placeholder="Search address..."
                  aria-label="Search address"
                  className={`text-[11px] pl-8 pr-8 py-1.5 w-[240px] focus:outline-none backdrop-blur-md shadow-lg font-mono transition-colors ${
                    isLightMapStyle(mapStyle)
                      ? 'bg-white/80 border border-gray-300 text-gray-900 placeholder:text-rmpg-400 focus:border-gray-400 focus:bg-white/90'
                      : 'bg-black/30 border border-white/15 text-white placeholder:text-white/40 focus:border-white/40 focus:bg-black/50'
                  }`}
                  style={{ borderRadius: 2 }}
                />
                {addressSearch && (
                  <button
                    onClick={() => {
                      setAddressSearch('');
                      setAddressResults([]);
                      setShowAddressResults(false);
                      setSelectedAddr(null);
                      setShowDispatchHere(false);
                      if (addressMarkerRef.current) {
                        removeMarker(addressMarkerRef.current);
                        addressMarkerRef.current = null;
                      }
                    }}
                    className="absolute right-2 text-white/40 hover:text-white/80"
                    aria-label="Clear search"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              {showAddressResults && addressResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#0a0a0a]/95 border border-[#2e2e2e] shadow-md backdrop-blur-md overflow-y-auto scrollbar-dark" style={{ borderRadius: 2, maxHeight: 240 }} role="listbox">
                  {addressResults.map((r) => (
                    <button
                      key={r.place_id}
                      role="option"
                      onMouseDown={(e) => e.preventDefault()}
                      onTouchStart={(e) => e.preventDefault()}
                      onClick={() => handleAddressSelect(r.center, r.description)}
                      className="w-full text-left px-3 py-2 text-[10px] text-rmpg-200 hover:bg-rmpg-700/50 hover:text-white transition-colors border-b border-rmpg-700 last:border-0 flex items-center gap-2"
                    >
                      <MapPin className="w-3 h-3 text-gray-400 shrink-0" />
                      <span className="truncate">{r.description}</span>
                    </button>
                  ))}
                </div>
              )}
              {/* Navigate / Dispatch action panel for a selected address */}
              {selectedAddr && !showAddressResults && !navActive && (
                <div className="absolute top-full left-0 mt-1 bg-[#0a0a0a]/95 border border-[#2e2e2e] shadow-md backdrop-blur-md p-2 space-y-1.5" style={{ borderRadius: 2, width: 240 }}>
                  <div className="text-[9px] text-rmpg-300 truncate flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-brand-400 shrink-0" />
                    <span className="truncate">{selectedAddr.label}</span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={startAddressNav}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide bg-brand-600/30 text-brand-300 hover:bg-brand-600/50 transition-colors"
                      style={{ borderRadius: 2 }}
                    >
                      <Navigation className="w-3 h-3" /> Navigate
                    </button>
                    <button
                      onClick={() => setShowDispatchHere((v) => !v)}
                      className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${showDispatchHere ? 'bg-red-600/40 text-red-200' : 'bg-rmpg-700/40 text-rmpg-200 hover:bg-rmpg-700/70'}`}
                      style={{ borderRadius: 2 }}
                    >
                      <Siren className="w-3 h-3" /> Dispatch
                    </button>
                  </div>
                  {showDispatchHere && (
                    <div className="space-y-1 pt-1 border-t border-[#1a1a1a]">
                      <input id="ff-mappage-2"
                        value={dispatchIncidentType}
                        onChange={(e) => setDispatchIncidentType(e.target.value)}
                        placeholder="Incident type (e.g. Welfare Check)"
                        aria-label="Incident type"
                        className="w-full text-[10px] px-2 py-1 bg-black/40 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
                        style={{ borderRadius: 2 }}
                      />
                      <div className="flex gap-0.5">
                        {['P1', 'P2', 'P3', 'P4'].map((p) => (
                          <button
                            key={p}
                            onClick={() => setDispatchPriority(p)}
                            className={`flex-1 px-1 py-1 text-[9px] font-bold transition-colors ${dispatchPriority === p ? 'bg-brand-600/40 text-brand-200' : 'text-rmpg-500 hover:bg-rmpg-800/50'}`}
                            style={{ borderRadius: 2 }}
                          >{p}</button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setAutoAssignNearest((v) => !v)}
                        className="w-full flex items-center gap-1.5 px-1 py-0.5 text-[9px] text-rmpg-300 hover:text-white transition-colors"
                      >
                        <div className="w-3 h-3 shrink-0 flex items-center justify-center rounded-sm" style={{ border: '1px solid #d4a017', background: autoAssignNearest ? '#d4a017' : 'transparent' }}>
                          {autoAssignNearest && <span style={{ fontSize: 8, color: '#0a0a0a', lineHeight: 1 }}>✓</span>}
                        </div>
                        Assign nearest available unit
                      </button>
                      <button
                        onClick={createCallHere}
                        disabled={dispatchBusy || !dispatchIncidentType.trim()}
                        className="w-full px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide bg-red-600/40 text-red-100 hover:bg-red-600/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        style={{ borderRadius: 2 }}
                      >
                        {dispatchBusy ? 'Creating…' : 'Create Call'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Zoom +/- controls */}
            <div className="flex flex-col" style={{ borderRadius: 2, overflow: 'hidden' }}>
              <button
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) map.setZoom((map.getZoom() ?? 12) + 1);
                }}
                disabled={zoomBounds.atMax}
                className={`border border-b-0 backdrop-blur-md px-2 py-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                  isLightMapStyle(mapStyle) ? 'bg-white/80 border-gray-300 hover:bg-white/95' : 'bg-black/30 border-white/15 hover:bg-black/50'
                }`}
                style={{ borderRadius: '2px 2px 0 0' }}
                title="Zoom in"
                aria-label="Zoom in"
              >
                <Plus className={`w-3.5 h-3.5 ${isLightMapStyle(mapStyle) ? 'text-gray-600' : 'text-white/70'}`} />
              </button>
              <button
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) map.setZoom((map.getZoom() ?? 12) - 1);
                }}
                disabled={zoomBounds.atMin}
                className={`border backdrop-blur-md px-2 py-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                  isLightMapStyle(mapStyle) ? 'bg-white/80 border-gray-300 hover:bg-white/95' : 'bg-black/30 border-white/15 hover:bg-black/50'
                }`}
                style={{ borderRadius: '0 0 2px 2px' }}
                title="Zoom out"
                aria-label="Zoom out"
              >
                <Minus className={`w-3.5 h-3.5 ${isLightMapStyle(mapStyle) ? 'text-gray-600' : 'text-white/70'}`} />
              </button>
            </div>
          </div>
        )}

        {/* ── Layer Controls Panel - Top Left (Desktop only) ── */}
        {!isMobile && <div className="absolute top-4 left-4 z-[1000]">
          {!layersPanelOpen ? (
            <button
              onClick={() => setLayersPanelOpen(true)}
              className="bg-black/30 border border-white/15 backdrop-blur-md p-2 hover:bg-black/50 transition-colors shadow-lg"
              style={{ borderRadius: 2 }}
              title="Show layers"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          ) : (
          <div className="panel-beveled bg-surface-deep border border-rmpg-600 shadow-md overflow-y-auto scrollbar-dark" style={{ width: 'clamp(160px, 14vw, 200px)', maxHeight: 'calc(100dvh - 96px)', borderRadius: 2, isolation: 'isolate', WebkitTransform: 'translateZ(0)', overscrollBehavior: 'contain' } as React.CSSProperties} role="region" aria-label="Map layer controls">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-700">
              <Layers className="w-3.5 h-3.5 text-brand-400" />
              <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-widest flex-1">Layers</span>
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
              <button
                onClick={() => setLayersPanelOpen(false)}
                className="toolbar-btn"
                style={{ padding: '0 2px' }}
                title="Hide layers"
              >
                <PanelLeftClose style={{ width: 10, height: 10 }} />
              </button>
            </div>

            <div className="p-1.5 space-y-0.5">
              {[
                { key: 'units' as const, icon: <Shield className="w-3 h-3" />, label: 'Units', count: unitsWithCoords.length, color: '#22c55e' },
                { key: 'incidents' as const, icon: <AlertTriangle className="w-3 h-3" />, label: 'Active Calls', count: callsWithCoords.length, color: '#ef4444' },
                { key: 'properties' as const, icon: <Building2 className="w-3 h-3" />, label: 'Properties', count: propertiesWithCoords.length, color: '#888888' },
              ].map(({ key, icon, label, count, color }) => (
                <button
                  key={key}
                  onClick={() => toggleLayer(key)}
                  className={`flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors ${
                    layers[key] ? 'panel-inset bg-surface-deep' : 'opacity-40 hover:opacity-70 hover:bg-rmpg-800/50'
                  }`}
                >
                  {layers[key] ? <Eye className="w-3 h-3 text-green-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
                  <span style={{ color: layers[key] ? color : '#666666' }}>{icon}</span>
                  <span className="text-[10px] text-rmpg-200 flex-1">{label}</span>
                  <span className="text-[9px] font-mono font-bold" style={{ color: layers[key] ? color : '#666666' }}>{count}</span>
                </button>
              ))}

              {/* ── Heat Map ── */}
              <button
                onClick={() => setShowHeatmap(!showHeatmap)}
                className={`flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors ${
                  showHeatmap ? 'panel-inset bg-surface-deep' : 'opacity-40 hover:opacity-70 hover:bg-rmpg-800/50'
                }`}
              >
                {showHeatmap ? <Eye className="w-3 h-3 text-red-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
                <Thermometer className="w-3 h-3 text-red-400" />
                <span className="text-[10px] text-rmpg-200 flex-1">Heat Map</span>
                {showHeatmap && (
                  <span className="text-[8px] text-red-400 font-mono font-bold">
                    {heatmapData.length} pts
                  </span>
                )}
              </button>
              {showHeatmap && (
                <div className="px-3 py-1 space-y-1">
                  {/* Days selector */}
                  <div className="flex items-center gap-1">
                    {[7, 14, 30, 90, 180, 365].map((days) => (
                      <button
                        key={days}
                        onClick={() => setHeatmapDays(days)}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                          heatmapDays === days
                            ? 'bg-red-900/50 text-red-400 border border-red-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {days < 365 ? `${days}d` : '1y'}
                      </button>
                    ))}
                  </div>

                  {/* Mode selector */}
                  <div className="flex items-center gap-1">
                    {([['all', 'All'], ['risk', 'Risk'], ['type', 'Type']] as const).map(([mode, label]) => (
                      <button
                        key={mode}
                        onClick={() => { setHeatmapMode(mode); if (mode !== 'type') setHeatmapTypeFilter(''); }}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                          heatmapMode === mode
                            ? mode === 'risk' ? 'bg-orange-900/50 text-orange-400 border border-orange-700/50'
                            : 'bg-red-900/50 text-red-400 border border-red-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {/* Type filter dropdown */}
                  {heatmapMode === 'type' && (
                    <select id="ff-mappage-3"
                      value={heatmapTypeFilter}
                      onChange={(e) => setHeatmapTypeFilter(e.target.value)}
                      className="w-full bg-surface-deep border border-rmpg-600 text-[9px] text-rmpg-200 px-1.5 py-0.5 font-mono focus:outline-none focus:border-red-600"
                      style={{ borderRadius: 2 }}
                    >
                      <option value="">Select type...</option>
                      {heatmapTypes.map((t) => (
                        <option key={t.incident_type} value={t.incident_type}>
                          {formatIncidentType(t.incident_type)} ({t.count})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* ── Tracking Lines ── */}
              <button
                onClick={() => setShowTrackingLines(!showTrackingLines)}
                className={`flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors ${
                  showTrackingLines ? 'panel-inset bg-surface-deep' : 'opacity-40 hover:opacity-70 hover:bg-rmpg-800/50'
                }`}
              >
                {showTrackingLines ? <Eye className="w-3 h-3 text-green-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
                <Navigation2 className="w-3 h-3 text-green-400" />
                <span className="text-[10px] text-rmpg-200 flex-1">Tracking Lines</span>
              </button>

              {/* ── Breadcrumbs ── */}
              <button
                onClick={() => setShowBreadcrumbs(!showBreadcrumbs)}
                className={`flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors ${
                  showBreadcrumbs ? 'panel-inset bg-surface-deep' : 'opacity-40 hover:opacity-70 hover:bg-rmpg-800/50'
                }`}
              >
                {showBreadcrumbs ? <Eye className="w-3 h-3 text-gray-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
                <Route className="w-3 h-3 text-gray-400" />
                <span className="text-[10px] text-rmpg-200 flex-1">Breadcrumbs</span>
              </button>
              {showBreadcrumbs && (
                <div className="px-3 py-1 space-y-1">
                  {/* Hours selector */}
                  <div className="flex items-center gap-1">
                    {[2, 4, 8, 12, 24].map((h) => (
                      <button
                        key={h}
                        onClick={() => setBreadcrumbHours(h)}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                          breadcrumbHours === h
                            ? 'bg-gray-900/50 text-gray-400 border border-gray-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {h}h
                      </button>
                    ))}
                    <button
                      onClick={async () => {
                        setExportingPdf(true);
                        try {
                          const data = await apiFetch<any>(`/reports/patrol-tracking?hours=${breadcrumbHours}&geocode=true`);
                          if (!data?.trails?.length) { addToast('No tracking data for this period.', 'warning'); return; }
                          await generatePatrolTrackingPdf(data);
                        } catch (err: any) {
                          addToast(err?.message || 'Failed to export PDF', 'error');
                        } finally { setExportingPdf(false); }
                      }}
                      disabled={exportingPdf}
                      className="px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors text-brand-400 hover:bg-brand-900/30 ml-1 flex items-center gap-0.5"
                      title="Export patrol tracking PDF"
                    >
                      {exportingPdf ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <FileText className="w-2.5 h-2.5" />}
                      PDF
                    </button>
                  </div>
                  {/* Color mode selector */}
                  <div className="flex items-center gap-1">
                    <Palette className="w-2.5 h-2.5 text-rmpg-400" />
                    {([['unit', 'Unit'], ['speed', 'Speed'], ['status', 'Status'], ['accel', 'Accel']] as const).map(([mode, label]) => (
                      <button
                        key={mode}
                        onClick={() => setBreadcrumbColorMode(mode)}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                          breadcrumbColorMode === mode
                            ? 'bg-gray-900/50 text-gray-400 border border-gray-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {/* Speed color legend — static 8-band */}
                  {breadcrumbColorMode === 'speed' && (
                    <div className="flex flex-wrap items-center gap-1 pl-1">
                      {[
                        { color: '#666666', label: '0', key: 'stationary' },
                        { color: '#999999', label: '<3', key: 'walking' },
                        { color: '#22c55e', label: '3-25', key: 'residential' },
                        { color: '#84cc16', label: '25-35', key: 'city' },
                        { color: '#eab308', label: '35-45', key: 'arterial' },
                        { color: '#f97316', label: '45-55', key: 'highway' },
                        { color: '#ef4444', label: '55-75', key: 'freeway' },
                        { color: '#dc2626', label: '75+', key: 'pursuit' },
                      ].map((band) => (
                        <span key={band.key} className="flex items-center gap-0.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: band.color }} />
                          <span className="text-[7px] text-rmpg-400 font-mono">{band.label}</span>
                        </span>
                      ))}
                      <span className="text-[7px] text-rmpg-500 font-mono">mph</span>
                    </div>
                  )}
                  {/* Accel color legend */}
                  {breadcrumbColorMode === 'accel' && (
                    <div className="flex items-center gap-1.5 pl-1">
                      {[['#dc2626', 'Brake'], ['#eab308', 'Decel'], ['#22c55e', 'Steady'], ['#84cc16', 'Accel'], ['#fbbf24', 'Hard']].map(([color, label]) => (
                        <span key={label} className="flex items-center gap-0.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                          <span className="text-[7px] text-rmpg-400 font-mono">{label}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Playback controls */}
                  {playbackTrails.length > 0 && (
                    <div className="space-y-1 pt-0.5">
                      <div className="flex items-center gap-1">
                        <Play className="w-2.5 h-2.5 text-green-400" />
                        <select id="ff-mappage-4"
                          value={playbackUnit ?? ''}
                          onChange={(e) => {
                            const val = e.target.value ? Number(e.target.value) : null;
                            setPlaybackUnit(val);
                            setPlaybackIdx(0);
                            setIsPlaying(false);
                          }}
                          className="flex-1 bg-surface-deep border border-rmpg-600 text-[9px] text-rmpg-200 px-1 py-0.5 font-mono focus:outline-none focus:border-gray-600"
                          style={{ borderRadius: 2 }}
                        >
                          <option value="">Replay trail...</option>
                          {playbackTrails.map((t: any) => (
                            <option key={t.unit_id} value={t.unit_id}>
                              {t.call_sign} ({t.points.length} pts)
                            </option>
                          ))}
                        </select>
                      </div>
                      {playbackUnit != null && (() => {
                        const activeTrail = playbackTrails.find((t: any) => t.unit_id === playbackUnit);
                        const totalPts = activeTrail?.points?.length || 0;
                        const currentPt = activeTrail?.points?.[playbackIdx];
                        return (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  if (isPlaying) {
                                    setIsPlaying(false);
                                    if (playbackAnimRef.current) { clearTimeout(playbackAnimRef.current); playbackAnimRef.current = null; }
                                  } else {
                                    if (playbackIdx >= totalPts - 1) setPlaybackIdx(0);
                                    setIsPlaying(true);
                                  }
                                }}
                                className="p-0.5 rounded-sm hover:bg-gray-900/40 transition-colors"
                                title={isPlaying ? 'Pause' : 'Play'}
                              >
                                {isPlaying ? <Pause className="w-3 h-3 text-amber-400" /> : <Play className="w-3 h-3 text-green-400" />}
                              </button>
                              <input id="ff-mappage-5"
                                type="range"
                                min={0}
                                max={Math.max(totalPts - 1, 0)}
                                value={playbackIdx}
                                onChange={(e) => {
                                  const idx = Number(e.target.value);
                                  setPlaybackIdx(idx);
                                  setIsPlaying(false);
                                  if (playbackAnimRef.current) { clearTimeout(playbackAnimRef.current); playbackAnimRef.current = null; }
                                  const pt = activeTrail?.points?.[idx];
                                  if (pt && isFinite(pt.lng) && isFinite(pt.lat) && playbackMarkerRef.current) {
                                    playbackMarkerRef.current.setLngLat([pt.lng, pt.lat]);
                                  }
                                }}
                                className="flex-1 h-1 accent-gray-400"
                                aria-label="Playback position"
                              />
                              <span className="text-[8px] font-mono text-rmpg-400 w-12 text-right">
                                {playbackIdx + 1}/{totalPts}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Gauge className="w-2.5 h-2.5 text-rmpg-400" />
                              {[1, 2, 5, 10].map((spd) => (
                                <button
                                  key={spd}
                                  onClick={() => setPlaybackSpeed(spd)}
                                  className={`px-1 py-0 text-[7px] font-mono font-bold rounded-sm transition-colors ${
                                    playbackSpeed === spd
                                      ? 'bg-gray-900/50 text-gray-400 border border-gray-700/50'
                                      : 'text-rmpg-500 hover:text-rmpg-300'
                                  }`}
                                >
                                  {spd}x
                                </button>
                              ))}
                              {currentPt && (
                                <span className="text-[7px] font-mono text-rmpg-400 ml-auto">
                                  {currentPt.speed != null ? `${(currentPt.speed * 2.237).toFixed(0)} mph` : ''}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Intelligence Layers ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              {sectionHeader('intelligence', 'Intelligence')}
              {!isSecCollapsed('intelligence') && ([
                { key: 'warrants' as const, label: 'Active Warrants', color: 'red' },
                { key: 'trespass' as const, label: 'Trespass Orders', color: 'orange' },
                { key: 'offenders' as const, label: 'Sex Offenders', color: 'purple' },
                { key: 'bolos' as const, label: 'BOLOs', color: 'amber' },
              ] as const).map(({ key, label, color }) => (
                <button
                  key={key}
                  onClick={() => toggleIntelLayer(key)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                    intelLayers[key] ? (INTEL_LAYER_CLASSES[color]?.active || 'bg-[#0c0c0c]/20 text-slate-400') : 'text-rmpg-400 hover:bg-surface-raised'
                  }`}
                >
                  <Shield className="w-3 h-3" />
                  <span className="flex-1 text-left">{label}</span>
                  {intelLayers[key] && intelLayerData.counts[key] > 0 && (
                    <span className="text-[9px] font-mono">{intelLayerData.counts[key]}</span>
                  )}
                </button>
              ))}
            </div>

            {/* ── Analysis ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              {sectionHeader('analysis', 'Analysis')}
              {!isSecCollapsed('analysis') && (<>
              {/* Predictions */}
              <button
                onClick={() => setShowPredictions(!showPredictions)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showPredictions ? 'panel-inset bg-purple-900/20 text-purple-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Brain className="w-3 h-3" />
                <span className="flex-1 text-left">Predictions</span>
                {showPredictions && predictions.hotspots.length > 0 && (
                  <span className="text-[9px] font-mono">{predictions.hotspots.length}</span>
                )}
              </button>

              {/* Analysis Intel Dashboard */}
              <button
                onClick={() => setShowAnalysisDashboard(!showAnalysisDashboard)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showAnalysisDashboard ? 'panel-inset bg-purple-900/20 text-purple-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Brain className="w-3 h-3" />
                <span className="flex-1 text-left">Analysis Intel</span>
                {showAnalysisDashboard && analysisSummary.data && (
                  <span className="text-[9px] font-mono">{analysisSummary.data.overlapZones.count} overlaps</span>
                )}
                {showAnalysisDashboard && analysisSummary.loading && (
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                )}
              </button>
              </>)}
            </div>

            {/* ── Tactical Layers ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              {sectionHeader('tactical', 'Tactical')}
              {!isSecCollapsed('tactical') && (<>
              {/* Patrol Checkpoints */}
              <button
                onClick={() => setShowPatrolCheckpoints(!showPatrolCheckpoints)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showPatrolCheckpoints ? 'panel-inset bg-green-900/20 text-green-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Crosshair className="w-3 h-3" />
                <span className="flex-1 text-left">Patrol Checkpoints</span>
                {showPatrolCheckpoints && patrolCheckpoints.overdueCount > 0 && (
                  <span className="text-[9px] font-mono text-orange-400">{patrolCheckpoints.overdueCount} due</span>
                )}
                {showPatrolCheckpoints && !patrolCheckpoints.loading && patrolCheckpoints.overdueCount === 0 && (
                  <span className="text-[9px] font-mono">{patrolCheckpoints.checkpoints.length}</span>
                )}
              </button>

              {/* Response Radius */}
              <button
                onClick={() => setShowResponseRadius(!showResponseRadius)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showResponseRadius ? 'panel-inset bg-gray-900/20 text-gray-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Target className="w-3 h-3" />
                <span className="flex-1 text-left">Response Radius</span>
                {showResponseRadius && responseRadius.activePoint && (
                  <span className="led-dot led-indigo" style={{ width: 5, height: 5 }} />
                )}
              </button>

              {/* Enforcement Clusters */}
              <button
                onClick={() => setShowEnforcementClusters(!showEnforcementClusters)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showEnforcementClusters ? 'panel-inset bg-rose-900/20 text-rose-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Scale className="w-3 h-3" />
                <span className="flex-1 text-left">Enforcement</span>
                {showEnforcementClusters && enforcementClusters.totalRecords > 0 && (
                  <span className="text-[9px] font-mono">{enforcementClusters.totalRecords}</span>
                )}
              </button>
              {showEnforcementClusters && (
                <div className="px-3 py-1 space-y-1">
                  <div className="flex items-center gap-1">
                    {(['citations', 'arrests'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setEnforcementType(t)}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                          enforcementType === t
                            ? 'bg-rose-900/50 text-rose-400 border border-rose-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {t === 'citations' ? 'Citations' : 'Arrests'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    {[30, 60, 90, 180].map((d) => (
                      <button
                        key={d}
                        onClick={() => setEnforcementDays(d)}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                          enforcementDays === d
                            ? 'bg-rose-900/50 text-rose-400 border border-rose-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Fleet Vehicles */}
              <button
                onClick={() => setShowFleetVehicles(!showFleetVehicles)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showFleetVehicles ? 'panel-inset bg-gray-900/20 text-gray-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Car className="w-3 h-3" />
                <span className="flex-1 text-left">Fleet Vehicles</span>
                {showFleetVehicles && fleetVehicles.count > 0 && (
                  <span className="text-[9px] font-mono">{fleetVehicles.count}</span>
                )}
              </button>

              {/* Panic Zone */}
              <button
                onClick={() => setShowPanicZone(!showPanicZone)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showPanicZone ? 'panel-inset bg-red-900/20 text-red-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <ShieldAlert className="w-3 h-3" />
                <span className="flex-1 text-left">Panic Zone</span>
                {showPanicZone && panicZone.activePanic && (
                  <span className="text-[8px] font-bold bg-red-600 text-white px-1 py-0.5 rounded-sm animate-pulse">ACTIVE</span>
                )}
              </button>

              {/* Marker Clustering */}
              <button
                onClick={() => setClusteringEnabled(!clusteringEnabled)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  clusteringEnabled ? 'panel-inset bg-gray-900/20 text-gray-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <CircleDot className="w-3 h-3" />
                <span className="flex-1 text-left">Cluster Calls</span>
                {clusteringEnabled && clustering.clustered && <span className="led-dot led-blue" style={{ width: 5, height: 5 }} />}
              </button>

              {/* Daylight Overlay */}
              <button
                onClick={() => setShowDaylight(!showDaylight)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showDaylight ? 'panel-inset bg-yellow-900/20 text-yellow-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Sun className="w-3 h-3" />
                <span className="flex-1 text-left">Daylight</span>
                {showDaylight && daylight.phase && (
                  <span className="text-[8px] font-mono text-yellow-400">{daylight.phase}</span>
                )}
              </button>
              </>)}
            </div>

            {/* ── Dispatch Mode ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              <button
                onClick={() => setDragDispatchMode(!dragDispatchMode)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  dragDispatchMode ? 'panel-inset bg-amber-900/20 text-amber-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Grab className="w-3 h-3" />
                <span className="flex-1 text-left">Drag Dispatch</span>
                {dragDispatchMode && <span className="led-dot led-amber" style={{ width: 5, height: 5 }} />}
              </button>
            </div>

            {/* ── Tactical Tools ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              <button
                onClick={() => setShowTacticalTools(!showTacticalTools)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showTacticalTools ? 'panel-inset bg-amber-900/20 text-amber-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Grab className="w-3 h-3" />
                <span className="flex-1 text-left">Tactical Tools</span>
                {showTacticalTools && <span className="led-dot led-amber" style={{ width: 5, height: 5 }} />}
              </button>
            </div>

            <div className="border-t border-rmpg-700 p-1.5">
              <button
                onClick={() => setShowMapStyles(!showMapStyles)}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors hover:bg-rmpg-800/50"
              >
                <MapIcon className="w-3 h-3 text-rmpg-400" />
                <span className="text-[10px] text-rmpg-300 flex-1">Map Style</span>
                <span className="text-[9px] text-brand-400 font-bold">{MAP_STYLE_LABELS[mapStyle]}</span>
                {showMapStyles ? <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" />}
              </button>
              {showMapStyles && (
                <div className="mt-1 grid grid-cols-2 gap-1 px-1">
                  {(Object.entries(MAP_STYLE_LABELS) as [MapStyleId, string][]).map(([key, label]) => {
                    const isActive = mapStyle === key;
                    const desc = MAP_STYLE_DESCRIPTIONS[key];
                    return (
                      <button
                        key={key}
                        onClick={() => { setMapStyle(key); setShowMapStyles(false); }}
                        className={`text-left px-2 py-1.5 rounded-sm transition-all ${
                          isActive
                            ? 'bg-brand-900/30 border border-brand-500/50 ring-1 ring-brand-500/20'
                            : 'bg-rmpg-800/30 border border-rmpg-700/50 hover:bg-rmpg-700/40 hover:border-rmpg-600/50'
                        }`}
                      >
                        <div className={`text-[10px] font-bold ${isActive ? 'text-brand-400' : 'text-rmpg-200'}`}>
                          {label}
                        </div>
                        <div className="text-[7px] text-rmpg-500 leading-tight mt-0.5">{desc}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Spatial Layers Section (Police Geography + Boundaries) ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              <button
                onClick={() => setShowGeoPanel(!showGeoPanel)}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors hover:bg-rmpg-800/50"
              >
                <Globe2 className="w-3 h-3 text-gray-400" />
                <span className="text-[10px] text-rmpg-300 flex-1">Spatial Layers</span>
                <span className="text-[9px] text-rmpg-500">
                  {Object.values(hierarchyStates).filter((s) => s.visible).length
                    + geoConfigs.filter((c) => ['beat', 'municipality', 'county'].includes(c.id) && geoLayerStates[c.id]?.visible).length}
                  /{hierarchyConfigs.length + 3}
                </span>
                {showGeoPanel ? <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" />}
              </button>
              {showGeoPanel && (() => {
                const HSWATCH: Record<string, string> = { area: '#d4a017', section: '#f59e0b', zone: '#22c55e' };
                const geoRow = (cfg: typeof geoConfigs[number]) => {
                  const state = geoLayerStates[cfg.id];
                  return (
                    <button
                      key={cfg.id}
                      onClick={() => toggleGeoLayer(cfg.id)}
                      className={`flex items-center gap-2 w-full px-2 py-1 text-left transition-colors ${
                        state?.visible ? 'panel-inset bg-surface-deep' : 'opacity-40 hover:opacity-70 hover:bg-rmpg-800/50'
                      }`}
                    >
                      {state?.visible ? <Eye className="w-2.5 h-2.5 text-green-400" /> : <EyeOff className="w-2.5 h-2.5 text-rmpg-500" />}
                      <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: cfg.style.strokeColor, opacity: state?.visible ? 1 : 0.3 }} />
                      <span className="text-[9px] text-rmpg-200 flex-1">{cfg.label}</span>
                    </button>
                  );
                };
                const hierRow = (cfg: typeof hierarchyConfigs[number]) => {
                  const state = hierarchyStates[cfg.id];
                  return (
                    <button
                      key={cfg.id}
                      onClick={() => handleToggleHier(cfg.id)}
                      title={cfg.description}
                      className={`flex items-center gap-2 w-full px-2 py-1 text-left transition-colors ${
                        state?.visible ? 'panel-inset bg-surface-deep' : 'opacity-40 hover:opacity-70 hover:bg-rmpg-800/50'
                      }`}
                    >
                      {state?.visible ? <Eye className="w-2.5 h-2.5 text-green-400" /> : <EyeOff className="w-2.5 h-2.5 text-rmpg-500" />}
                      <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: HSWATCH[cfg.id], opacity: state?.visible ? 1 : 0.3 }} />
                      <span className="text-[9px] text-rmpg-200 flex-1">{cfg.label}</span>
                    </button>
                  );
                };
                const beatCfg = geoConfigs.find((c) => c.id === 'beat');
                const boundaryCfgs = geoConfigs.filter((c) => c.id === 'municipality' || c.id === 'county');
                return (
                  <div className="mt-1 space-y-1.5">
                    {/* Police Geography: Area › Section › Zone › Beat */}
                    <div>
                      <div className="px-2 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-[#d4a017]">Police Geography</div>
                      <div className="space-y-0.5">
                        {hierarchyConfigs.map(hierRow)}
                        {beatCfg && geoRow(beatCfg)}
                      </div>
                    </div>
                    {/* Boundaries: Municipality, County */}
                    <div>
                      <div className="px-2 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-[#888888]">Boundaries</div>
                      <div className="space-y-0.5">
                        {boundaryCfgs.map(geoRow)}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* ── Statewide Data (Vector Tiles) Section ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              <button
                onClick={() => setShowVectorPanel(!showVectorPanel)}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors hover:bg-rmpg-800/50"
              >
                <Globe2 className="w-3 h-3 text-gray-400" />
                <span className="text-[10px] text-rmpg-300 flex-1">Statewide Data</span>
                <span className="text-[9px] text-rmpg-500">
                  {Object.values(vectorLayerStates).filter((s) => s.visible).length}/{vectorConfigs.length}
                </span>
                {showVectorPanel ? <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" />}
              </button>
              {showVectorPanel && (
                <div className="mt-1 space-y-0.5">
                  {vectorConfigs.map((cfg) => {
                    const state = vectorLayerStates[cfg.id];
                    return (
                      <button
                        key={cfg.id}
                        onClick={() => handleToggleStatewide(cfg.id)}
                        className={`flex items-center gap-2 w-full px-2 py-1 text-left transition-colors ${
                          state?.visible ? 'panel-inset bg-surface-deep' : 'opacity-40 hover:opacity-70 hover:bg-rmpg-800/50'
                        }`}
                        title={cfg.description}
                      >
                        {state?.visible ? <Eye className="w-2.5 h-2.5 text-green-400" /> : <EyeOff className="w-2.5 h-2.5 text-rmpg-500" />}
                        <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: cfg.color, opacity: state?.visible ? 1 : 0.3 }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[9px] text-rmpg-200 truncate">{cfg.label}</div>
                          <div className="text-[8px] text-rmpg-500 truncate">{cfg.description}</div>
                        </div>
                        <span className="text-[8px] font-mono text-rmpg-600">z{cfg.minzoom}+</span>
                      </button>
                    );
                  })}
                  {/* Statewide legend (first-class overlay integration) */}
                  {(vectorLayerStates['utah_roads']?.visible || vectorLayerStates['utah_addresses']?.visible) && (
                    <div className="px-2 pt-1 mt-0.5 border-t border-[#1a1a1a] space-y-0.5">
                      {vectorLayerStates['utah_roads']?.visible && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {[['Interstate', '#ef4444'], ['US Hwy', '#f59e0b'], ['State', '#e8b84b'], ['Local', '#d4a017']].map(([lbl, c]) => (
                            <span key={lbl} className="flex items-center gap-1">
                              <span className="inline-block w-3 h-0.5" style={{ background: c }} />
                              <span className="text-[8px] text-rmpg-400">{lbl}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {vectorLayerStates['utah_addresses']?.visible && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {[['Residential', '#22c55e'], ['Commercial', '#f59e0b'], ['Industrial', '#ef4444'], ['Agric.', '#84cc16'], ['Mixed', '#14b8a6'], ['Other', '#e8b84b']].map(([l, c]) => (
                            <span key={l} className="flex items-center gap-1">
                              <span className="inline-block w-2 h-2 rounded-full" style={{ background: c, border: '1px solid #1a1a1a' }} />
                              <span className="text-[8px] text-rmpg-400">{l}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Advanced Tools Section ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              <button
                onClick={() => setShowAdvTools(!showAdvTools)}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors hover:bg-rmpg-800/50"
              >
                <SlidersHorizontal className="w-3 h-3 text-gray-400" />
                <span className="text-[10px] text-rmpg-300 flex-1">Advanced Tools</span>
                <span className="text-[9px] text-rmpg-500">
                  {[whatsHereActive, !!choroLevel, !!measureMode].filter(Boolean).length}/3
                </span>
                {showAdvTools ? <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" />}
              </button>
              {showAdvTools && (
                <div className="mt-1 space-y-2">
                  {/* What's Here identify */}
                  <button
                    onClick={() => setWhatsHereActive((v) => !v)}
                    className={`flex items-center gap-2 w-full px-2 py-1 text-left transition-colors ${
                      whatsHereActive ? 'panel-inset bg-surface-deep' : 'opacity-50 hover:opacity-80 hover:bg-rmpg-800/50'
                    }`}
                  >
                    <Crosshair className={`w-3 h-3 ${whatsHereActive ? 'text-green-400' : 'text-rmpg-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[9px] text-rmpg-200">What's Here</div>
                      <div className="text-[8px] text-rmpg-500">Click map to identify geography</div>
                    </div>
                  </button>

                  {/* Activity choropleth */}
                  <div>
                    <div className="px-2 text-[8px] font-semibold uppercase tracking-wider text-[#d4a017] flex items-center gap-1">
                      <Gauge className="w-2.5 h-2.5" /> Activity Choropleth
                    </div>
                    {/* Data source: live Calls (queue) or Incidents (RMS) */}
                    <div className="flex gap-0.5 px-2 mt-0.5">
                      {(['calls', 'incidents'] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => setChoroSource(s)}
                          className={`flex-1 px-1 py-0.5 text-[8px] uppercase rounded-sm transition-colors ${
                            choroSource === s ? 'bg-rmpg-700/60 text-brand-300' : 'text-rmpg-500 hover:bg-rmpg-800/50'
                          }`}
                        >{s}</button>
                      ))}
                    </div>
                    <div className="flex gap-0.5 px-2 mt-0.5">
                      {(['off', 'beat', 'zone', 'section', 'area'] as const).map((l) => {
                        const isOn = l === 'off' ? !choroLevel : choroLevel === l;
                        return (
                          <button
                            key={l}
                            onClick={() => setChoroLevel(l === 'off' ? null : (l as ChoroLevel))}
                            className={`flex-1 px-1 py-0.5 text-[8px] uppercase rounded-sm transition-colors ${
                              isOn ? 'bg-brand-600/30 text-brand-300' : 'text-rmpg-500 hover:bg-rmpg-800/50'
                            }`}
                          >
                            {l}
                          </button>
                        );
                      })}
                    </div>
                    {choroLegend && (
                      <div className="px-2 mt-1 flex items-center gap-1">
                        <span className="text-[8px] text-rmpg-500">low</span>
                        {choroLegend.colors.slice(1).map((c, i) => (
                          <div key={i} className="h-2 flex-1 rounded-sm" style={{ background: c }} />
                        ))}
                        <span className="text-[8px] text-rmpg-500">{choroLegend.max}+</span>
                      </div>
                    )}
                  </div>

                  {/* Measure */}
                  <div>
                    <div className="px-2 text-[8px] font-semibold uppercase tracking-wider text-[#d4a017] flex items-center gap-1">
                      <Ruler className="w-2.5 h-2.5" /> Measure
                    </div>
                    <div className="flex gap-0.5 px-2 mt-0.5">
                      <button
                        onClick={() => setMeasureMode(measureMode === 'distance' ? null : 'distance')}
                        className={`flex-1 px-1 py-0.5 text-[8px] uppercase rounded-sm transition-colors ${measureMode === 'distance' ? 'bg-brand-600/30 text-brand-300' : 'text-rmpg-500 hover:bg-rmpg-800/50'}`}
                      >Distance</button>
                      <button
                        onClick={() => setMeasureMode(measureMode === 'area' ? null : 'area')}
                        className={`flex-1 px-1 py-0.5 text-[8px] uppercase rounded-sm transition-colors ${measureMode === 'area' ? 'bg-brand-600/30 text-brand-300' : 'text-rmpg-500 hover:bg-rmpg-800/50'}`}
                      >Area</button>
                      <button
                        onClick={() => { setMeasureMode(null); clearMeasure(); }}
                        className="flex-1 px-1 py-0.5 text-[8px] uppercase rounded-sm text-rmpg-500 hover:bg-rmpg-800/50 transition-colors"
                      >Clear</button>
                    </div>
                    {measureMode && measureResult.points > 0 && (
                      <div className="px-2 mt-1 text-[9px] text-rmpg-200 font-mono">
                        {measureResult.distanceMeters > 0 && (
                          <span>{measureResult.distanceMeters >= 1609 ? `${(measureResult.distanceMeters / 1609.34).toFixed(2)} mi` : `${Math.round(measureResult.distanceMeters * 3.28084)} ft`}</span>
                        )}
                        {measureResult.areaSqMeters > 0 && (
                          <span> · {measureResult.areaSqMeters * 0.000247105 >= 1 ? `${(measureResult.areaSqMeters * 0.000247105).toFixed(2)} ac` : `${Math.round(measureResult.areaSqMeters * 10.7639)} ft²`}</span>
                        )}
                        <span className="text-rmpg-500"> ({measureResult.points} pts)</span>
                      </div>
                    )}
                    {measureMode && (
                      <div className="px-2 text-[8px] text-rmpg-500 mt-0.5">Click to add points · double-click to finish</div>
                    )}
                  </div>

                  {/* Overlay opacity */}
                  <div className="px-2">
                    <div className="text-[8px] font-semibold uppercase tracking-wider text-[#888888] mb-0.5">Overlay Opacity — {Math.round(overlayOpacity * 100)}%</div>
                    <input id="ff-mappage-6"
                      type="range" min={0} max={1} step={0.05} value={overlayOpacity}
                      onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
                      aria-label="Overlay opacity"
                      className="w-full accent-[#d4a017]"
                    />
                  </div>

                  {/* Categorical legend (Area / Section) */}
                  {hierLegend.length > 0 && (
                    <div className="px-2">
                      <div className="text-[8px] font-semibold uppercase tracking-wider text-[#888888] mb-0.5">Legend</div>
                      <div className="max-h-[120px] overflow-y-auto space-y-0.5">
                        {hierLegend.map((l) => (
                          <div key={l.label} className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: l.color }} />
                            <span className="text-[9px] text-rmpg-300 truncate">{l.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── District Legend Section ── */}
            {geoLayerStates.beat?.visible && districtSections.length > 0 && (
              <div className="border-t border-rmpg-700 p-1.5">
                <button
                  onClick={() => setShowDistrictLegend(!showDistrictLegend)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors rounded-sm hover:bg-rmpg-700/30"
                >
                  <Shield className="w-3 h-3 text-brand-400" />
                  <span className="text-[10px] text-rmpg-300 flex-1">District Legend</span>
                  <span className="text-[9px] text-rmpg-500">{districtSections.length} sections</span>
                  {showDistrictLegend ? <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" />}
                </button>
                {showDistrictLegend && (
                  <div className="mt-1 space-y-0.5 max-h-[200px] overflow-y-auto">
                    {districtSections.map((sec) => (
                      <div key={sec.id} className="flex items-center gap-2 px-2 py-0.5">
                        <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: getSectionColor(sec.id), opacity: 0.8 }} />
                        <span className="text-[9px] font-mono font-bold" style={{ color: getSectionColor(sec.id) }}>{sec.id}</span>
                        <span className="text-[8px] text-rmpg-300 truncate flex-1">{sec.name}</span>
                      </div>
                    ))}
                    <div className="px-2 pt-1 border-t border-rmpg-700/50">
                      <div className="text-[7px] text-rmpg-500 uppercase tracking-widest">Format: SEC-ZONE/BEAT</div>
                      <div className="text-[8px] text-rmpg-400 font-mono mt-0.5">e.g. SL1-SLC/A</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Shift Planning Section ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              <button
                onClick={() => setShowShiftPanel(!showShiftPanel)}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors hover:bg-rmpg-800/50"
              >
                <CalendarDays className="w-3 h-3 text-emerald-400" />
                <span className="text-[10px] text-rmpg-300 flex-1">Shift Planning</span>
                {shiftPlanning.selectionMode && (
                  <span className="text-[7px] px-1 py-0.5 bg-amber-900/40 text-amber-400 border border-amber-700/40 font-bold animate-pulse">SELECT</span>
                )}
                {shiftPlanning.activePlan && (
                  <span className="text-[8px] text-emerald-400 font-mono font-bold truncate max-w-[60px]">
                    {shiftPlanning.activePlan.name}
                  </span>
                )}
                {showShiftPanel ? <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" />}
              </button>
              {showShiftPanel && (
                <div className="mt-1 space-y-1">
                  {/* Existing plans */}
                  {shiftPlanning.plans.length > 0 && (
                    <div className="space-y-0.5 max-h-[100px] overflow-y-auto">
                      {shiftPlanning.plans.map((plan) => {
                        const shiftInfo = SHIFT_TYPES[plan.shiftType as ShiftType] || SHIFT_TYPES.custom;
                        return (
                          <div
                            key={plan.id}
                            className={`flex items-center gap-1.5 px-2 py-1 transition-colors cursor-pointer ${
                              shiftPlanning.activePlanId === plan.id
                                ? 'panel-inset bg-surface-deep'
                                : 'hover:bg-rmpg-800/50'
                            }`}
                            onClick={() => shiftPlanning.setActivePlanId(
                              shiftPlanning.activePlanId === plan.id ? null : plan.id
                            )}
                          >
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: shiftInfo.color }} />
                            <div className="flex-1 min-w-0">
                              <div className="text-[9px] text-rmpg-200 truncate">{plan.name}</div>
                              <div className="text-[7px] text-rmpg-500 font-mono">{plan.date} · {shiftInfo.label}</div>
                            </div>
                            <span className={`text-[7px] px-1 py-0.5 font-bold ${
                              plan.status === 'active' ? 'bg-green-900/30 text-green-400' :
                              plan.status === 'draft' ? 'bg-rmpg-700/30 text-rmpg-400' :
                              'bg-rmpg-800/30 text-rmpg-500'
                            }`}>
                              {plan.status.toUpperCase()}
                            </span>
                            <span className="text-[8px] text-rmpg-500 font-mono">{plan.assignments.length}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); if (window.confirm('Delete this shift plan?')) shiftPlanning.deletePlan(plan.id); }}
                              className="p-0.5 hover:text-red-400 text-rmpg-600 transition-colors"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* New plan form */}
                  <div className="space-y-1 px-1">
                    <div className="flex items-center gap-1">
                      <input id="ff-mappage-7"
                        type="text"
                        value={newShiftPlanName}
                        onChange={(e) => setNewShiftPlanName(e.target.value)}
                        placeholder="Plan name..."
                        className="input-dark flex-1 px-1.5 py-0.5 text-[9px]"
                      />
                      <input id="ff-mappage-8"
                        type="date"
                        value={newShiftPlanDate}
                        onChange={(e) => setNewShiftPlanDate(e.target.value)}
                        className="input-dark px-1 py-0.5 text-[9px] w-[90px]"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      {(Object.entries(SHIFT_TYPES) as [ShiftType, typeof SHIFT_TYPES.day][]).map(([key, info]) => (
                        <button
                          key={key}
                          onClick={() => setNewShiftPlanType(key)}
                          className={`flex-1 text-[8px] py-0.5 font-bold transition-colors ${
                            newShiftPlanType === key
                              ? 'panel-inset text-white'
                              : 'text-rmpg-500 hover:text-rmpg-300'
                          }`}
                          style={newShiftPlanType === key ? { borderColor: info.color, backgroundColor: `${info.color}20`, color: info.color } : undefined}
                        >
                          {info.label.split(' ')[0]}
                        </button>
                      ))}
                      <button
                        onClick={() => {
                          if (newShiftPlanName.trim()) {
                            try { shiftPlanning.createPlan(newShiftPlanName.trim(), newShiftPlanDate, newShiftPlanType); } catch (err) { console.error('Failed to create shift plan:', err); addToast('Failed to create shift plan', 'error'); }
                            setNewShiftPlanName('');
                          }
                        }}
                        className="p-0.5 text-emerald-400 hover:text-emerald-300"
                        title="Create Plan"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Active plan tools */}
                  {shiftPlanning.activePlan && (
                    <>
                      {/* Selection mode toggle */}
                      <div className="border-t border-rmpg-700 pt-1 mt-1 px-1">
                        <button
                          onClick={() => {
                            shiftPlanning.toggleSelectionMode();
                            // Auto-enable beat layer when entering selection mode
                            if (!shiftPlanning.selectionMode) {
                              const beatState = geoLayerStates['beat'];
                              if (!beatState?.visible) {
                                toggleGeoLayer('beat');
                              }
                              ensureLayerLoaded('beat');
                            }
                          }}
                          className={`flex items-center gap-2 w-full px-2 py-1.5 transition-colors ${
                            shiftPlanning.selectionMode
                              ? 'panel-inset bg-amber-900/30 text-amber-300'
                              : 'hover:bg-rmpg-800/50 text-rmpg-400'
                          }`}
                        >
                          <MousePointer2 className="w-3 h-3" />
                          <span className="text-[9px] font-bold flex-1">
                            {shiftPlanning.selectionMode ? 'SELECTING AREAS...' : 'Select Areas'}
                          </span>
                          {shiftPlanning.selectedAreas.size > 0 && (
                            <span className="text-[8px] font-mono font-bold text-amber-400">
                              {shiftPlanning.selectedAreas.size}
                            </span>
                          )}
                        </button>

                        {/* Selection mode instructions and actions */}
                        {shiftPlanning.selectionMode && (
                          <div className="mt-1 space-y-1">
                            <div className="text-[8px] text-amber-400/70 px-2">
                              Click beats, municipalities, or counties on the map to select areas
                            </div>

                            {shiftPlanning.pendingFeatures.length > 0 && (
                              <div className="space-y-0.5 max-h-[80px] overflow-y-auto">
                                {shiftPlanning.pendingFeatures.map((feat) => (
                                  <div
                                    key={`${feat.layerId}::${feat.featureKey}`}
                                    className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-900/20"
                                  >
                                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                    <span className="text-[8px] text-amber-300 flex-1 truncate">{feat.label}</span>
                                    <span className="text-[7px] text-rmpg-500 uppercase">{feat.layerId}</span>
                                    <button
                                      onClick={() => shiftPlanning.handleFeatureClick(feat)}
                                      className="text-rmpg-600 hover:text-red-400"
                                    >
                                      <X className="w-2 h-2" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Assignment form */}
                            {shiftPlanning.pendingFeatures.length > 0 && (
                              <div className="border-t border-amber-700/30 pt-1 mt-1 space-y-1">
                                <span className="text-[8px] text-emerald-400 font-bold px-1 uppercase">Assign Personnel</span>

                                {/* Officer multi-select */}
                                <div className="px-1">
                                  <div className="text-[7px] text-rmpg-500 uppercase mb-0.5">Officers</div>
                                  <div className="max-h-[60px] overflow-y-auto space-y-0.5">
                                    {shiftPlanning.officers.slice(0, 30).map((officer) => (
                                      <label
                                        key={officer.id}
                                        className={`flex items-center gap-1.5 px-1.5 py-0.5 cursor-pointer transition-colors ${
                                          assignOfficerIds.includes(officer.id)
                                            ? 'bg-emerald-900/30 text-emerald-300'
                                            : 'hover:bg-rmpg-800/50 text-rmpg-400'
                                        }`}
                                      >
                                        <input id="ff-mappage-9"
                                          type="checkbox"
                                          checked={assignOfficerIds.includes(officer.id)}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setAssignOfficerIds((prev) => [...prev, officer.id]);
                                            } else {
                                              setAssignOfficerIds((prev) => prev.filter((id) => id !== officer.id));
                                            }
                                          }}
                                          className="w-2.5 h-2.5 accent-emerald-500"
                                        />
                                        <span className="text-[8px] flex-1 truncate">{officer.full_name}</span>
                                        {officer.badge_number && (
                                          <span className="text-[7px] font-mono text-rmpg-500">#{officer.badge_number}</span>
                                        )}
                                      </label>
                                    ))}
                                  </div>
                                </div>

                                {/* Unit multi-select */}
                                {shiftPlanning.units.length > 0 && (
                                  <div className="px-1">
                                    <div className="text-[7px] text-rmpg-500 uppercase mb-0.5">Units</div>
                                    <div className="max-h-[50px] overflow-y-auto space-y-0.5">
                                      {shiftPlanning.units.map((unit) => (
                                        <label
                                          key={unit.id}
                                          className={`flex items-center gap-1.5 px-1.5 py-0.5 cursor-pointer transition-colors ${
                                            assignUnitIds.includes(unit.id)
                                              ? 'bg-gray-900/30 text-gray-300'
                                              : 'hover:bg-rmpg-800/50 text-rmpg-400'
                                          }`}
                                        >
                                          <input id="ff-mappage-10"
                                            type="checkbox"
                                            checked={assignUnitIds.includes(unit.id)}
                                            onChange={(e) => {
                                              if (e.target.checked) {
                                                setAssignUnitIds((prev) => [...prev, unit.id]);
                                              } else {
                                                setAssignUnitIds((prev) => prev.filter((id) => id !== unit.id));
                                              }
                                            }}
                                            className="w-2.5 h-2.5 accent-gray-500"
                                          />
                                          <span className="text-[8px] flex-1">{unit.call_sign}</span>
                                          {unit.officer_name && (
                                            <span className="text-[7px] text-rmpg-500 truncate max-w-[60px]">{unit.officer_name}</span>
                                          )}
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Notes */}
                                <div className="px-1">
                                  <input id="ff-mappage-11"
                                    type="text"
                                    value={assignNotes}
                                    onChange={(e) => setAssignNotes(e.target.value)}
                                    placeholder="Assignment notes..."
                                    className="input-dark w-full px-1.5 py-0.5 text-[8px]"
                                  />
                                </div>

                                {/* Assign / Clear buttons */}
                                <div className="flex items-center gap-1 px-1">
                                  <button
                                    onClick={() => {
                                      const shiftInfo = SHIFT_TYPES[shiftPlanning.activePlan?.shiftType as ShiftType] || SHIFT_TYPES.custom;
                                      shiftPlanning.assignAreasToOfficers(
                                        assignOfficerIds,
                                        assignUnitIds,
                                        shiftInfo.defaultStart,
                                        shiftInfo.defaultEnd,
                                        assignNotes || undefined,
                                      );
                                      setAssignOfficerIds([]);
                                      setAssignUnitIds([]);
                                      setAssignNotes('');
                                    }}
                                    disabled={assignOfficerIds.length === 0 && assignUnitIds.length === 0}
                                    className="toolbar-btn-success flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[8px] font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                  >
                                    <UserCheck className="w-2.5 h-2.5" />
                                    Assign
                                  </button>
                                  <button
                                    onClick={() => shiftPlanning.clearSelection()}
                                    className="toolbar-btn px-2 py-1 text-[8px] font-bold transition-colors"
                                  >
                                    Clear
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Current assignments list */}
                      {shiftPlanning.activePlan?.assignments?.length > 0 && (
                        <div className="border-t border-rmpg-700 pt-1 mt-1">
                          <div className="flex items-center justify-between px-2 mb-1">
                            <span className="text-[8px] text-rmpg-500 uppercase tracking-wider font-bold">
                              Assignments ({shiftPlanning.activePlan?.assignments?.length})
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={async () => {
                                  try { await shiftPlanning.savePlanToServer(shiftPlanning.activePlanId!); } catch { addToast('Failed to save shift plan', 'error'); }
                                }}
                                className="text-rmpg-500 hover:text-emerald-400 transition-colors" title="Save to server"
                              >
                                <Save className="w-2.5 h-2.5" />
                              </button>
                              <button
                                onClick={() => shiftPlanning.updatePlanStatus(shiftPlanning.activePlanId!, 'active')}
                                className="text-rmpg-500 hover:text-green-400 transition-colors" title="Activate plan"
                              >
                                <Play className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          </div>
                          <div className="space-y-0.5 max-h-[120px] overflow-y-auto">
                            {shiftPlanning.activePlan?.assignments.map((assignment) => (
                              <div
                                key={assignment.id}
                                className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-rmpg-800/50"
                              >
                                <div className="led-dot led-green" style={{ width: 6, height: 6 }} />
                                <div className="flex-1 min-w-0">
                                  <div className="text-[8px] text-rmpg-300 truncate">{assignment.label}</div>
                                  <div className="text-[7px] text-rmpg-500 truncate">
                                    {assignment.officerNames.length > 0 && assignment.officerNames.join(', ')}
                                    {assignment.unitCallSigns.length > 0 && ` [${assignment.unitCallSigns.join(', ')}]`}
                                  </div>
                                </div>
                                <span className="text-[7px] text-rmpg-600 uppercase">{assignment.layerId}</span>
                                <button
                                  onClick={() => shiftPlanning.removeAssignment(assignment.id)}
                                  className="p-0.5 text-rmpg-600 hover:text-red-400"
                                >
                                  <Trash2 className="w-2 h-2" />
                                </button>
                              </div>
                            ))}
                          </div>

                          {/* Coverage stats */}
                          {(() => {
                            const stats = shiftPlanning.getCoverageStats();
                            return (
                              <div className="flex items-center gap-3 px-2 pt-1 mt-1 border-t border-rmpg-800">
                                <span className="text-[7px] text-rmpg-500">
                                  <span className="text-emerald-400 font-bold">{stats.assigned}</span> areas
                                </span>
                                <span className="text-[7px] text-rmpg-500">
                                  <span className="text-gray-400 font-bold">{stats.officers}</span> officers
                                </span>
                                <span className="text-[7px] text-rmpg-500">
                                  <span className="text-amber-400 font-bold">{stats.units}</span> units
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* Quick actions */}
                      <div className="flex items-center gap-1 px-1 pt-1">
                        <button
                          onClick={() => {
                            const tomorrow = new Date();
                            tomorrow.setDate(tomorrow.getDate() + 1);
                            shiftPlanning.duplicatePlan(shiftPlanning.activePlanId!, dateToLocalYMD(tomorrow));
                          }}
                          className="toolbar-btn flex items-center gap-1 px-1.5 py-0.5 text-[8px] transition-colors"
                          title="Duplicate for next day"
                        >
                          <Copy className="w-2 h-2" /> Duplicate
                        </button>
                        {shiftPlanning.activePlan?.assignments?.length > 0 && (
                          <button
                            onClick={() => shiftPlanning.removeAllAssignments()}
                            className="toolbar-btn-danger flex items-center gap-1 px-1.5 py-0.5 text-[8px] transition-colors"
                          >
                            <Trash2 className="w-2 h-2" /> Clear All
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ── Event Planning Section ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              <button
                onClick={() => setShowEventPanel(!showEventPanel)}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors hover:bg-rmpg-800/50"
              >
                <Pencil className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] text-rmpg-300 flex-1">Event Planning</span>
                {eventPlanning.activePlan && (
                  <span className="text-[8px] text-amber-400 font-mono font-bold truncate max-w-[60px]">
                    {eventPlanning.activePlan.name}
                  </span>
                )}
                {showEventPanel ? <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" />}
              </button>
              {showEventPanel && (
                <div className="mt-1 space-y-1">
                  {/* Plan selector or create */}
                  {eventPlanning.plans.length > 0 && (
                    <div className="space-y-0.5">
                      {eventPlanning.plans.map((plan) => (
                        <div
                          key={plan.id}
                          className={`flex items-center gap-1.5 px-2 py-1 transition-colors cursor-pointer ${
                            eventPlanning.activePlanId === plan.id
                              ? 'panel-inset bg-surface-deep'
                              : 'hover:bg-rmpg-800/50'
                          }`}
                          onClick={() => eventPlanning.setActivePlanId(
                            eventPlanning.activePlanId === plan.id ? null : plan.id
                          )}
                        >
                          <FileText className="w-2.5 h-2.5 text-amber-400" />
                          <span className="text-[9px] text-rmpg-200 flex-1 truncate">{plan.name}</span>
                          <span className="text-[8px] text-rmpg-500 font-mono">{plan.items.length}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); if (window.confirm('Delete this event plan?')) eventPlanning.deletePlan(plan.id); }}
                            className="p-0.5 hover:text-red-400 text-rmpg-600 transition-colors"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* New plan input */}
                  <div className="flex items-center gap-1 px-1">
                    <input id="ff-mappage-12"
                      type="text"
                      value={newPlanName}
                      onChange={(e) => setNewPlanName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newPlanName.trim()) {
                          try { eventPlanning.createPlan(newPlanName.trim()); } catch (err) { console.error('Failed to create event plan:', err); addToast('Failed to create event plan', 'error'); }
                          setNewPlanName('');
                        }
                      }}
                      placeholder="New plan name..."
                      className="input-dark flex-1 px-1.5 py-0.5 text-[9px]"
                    />
                    <button
                      onClick={() => {
                        if (newPlanName.trim()) {
                          try { eventPlanning.createPlan(newPlanName.trim()); } catch (err) { console.error('Failed to create event plan:', err); addToast('Failed to create event plan', 'error'); }
                          setNewPlanName('');
                        }
                      }}
                      className="p-0.5 text-amber-400 hover:text-amber-300"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Drawing tools (when a plan is active) */}
                  {eventPlanning.activePlan && (
                    <>
                      <div className="border-t border-rmpg-700 pt-1 mt-1">
                        <span className="text-[8px] text-rmpg-500 uppercase tracking-wider font-bold px-2">Draw Tools</span>
                        <div className="grid grid-cols-2 gap-0.5 mt-1 px-1">
                          {([
                            { type: 'perimeter' as PlanItemType, icon: <Square className="w-2.5 h-2.5" />, label: 'Perimeter' },
                            { type: 'route' as PlanItemType, icon: <Route className="w-2.5 h-2.5" />, label: 'Route' },
                            { type: 'staging' as PlanItemType, icon: <MapPin className="w-2.5 h-2.5" />, label: 'Staging' },
                            { type: 'annotation' as PlanItemType, icon: <Type className="w-2.5 h-2.5" />, label: 'Note' },
                          ]).map(({ type, icon, label }) => (
                            <button
                              key={type}
                              onClick={() => {
                                if (eventPlanning.drawMode === type) {
                                  eventPlanning.cancelDrawing();
                                } else {
                                  eventPlanning.startDrawing(type);
                                }
                              }}
                              className={`flex items-center gap-1 px-1.5 py-1 text-[9px] transition-colors ${
                                eventPlanning.drawMode === type
                                  ? 'panel-inset bg-amber-900/30 text-amber-300'
                                  : 'text-rmpg-400 hover:text-rmpg-200 hover:bg-rmpg-800/50'
                              }`}
                              style={{ color: eventPlanning.drawMode === type ? PLAN_COLORS[type] : undefined }}
                            >
                              {icon}
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Drawing instructions */}
                      {eventPlanning.isDrawing && eventPlanning.drawMode && (
                        <div className="mx-1 px-2 py-1.5 bg-amber-900/20 border border-amber-700/30">
                          <div className="text-[9px] text-amber-300 font-bold mb-0.5">
                            Drawing: {PLAN_TYPE_LABELS[eventPlanning.drawMode]}
                          </div>
                          <div className="text-[8px] text-amber-400/70">
                            {eventPlanning.drawMode === 'staging' || eventPlanning.drawMode === 'annotation'
                              ? 'Click map to place'
                              : 'Click to add points, double-click to finish'}
                          </div>
                          <div className="flex items-center gap-1 mt-1">
                            {(eventPlanning.drawMode === 'perimeter' || eventPlanning.drawMode === 'route') && (
                              <button
                                onClick={() => eventPlanning.finishDrawing()}
                                className="toolbar-btn-success text-[8px] px-1.5 py-0.5"
                              >
                                <Check className="w-2.5 h-2.5 inline mr-0.5" />Finish
                              </button>
                            )}
                            <button
                              onClick={() => eventPlanning.cancelDrawing()}
                              className="toolbar-btn-danger text-[8px] px-1.5 py-0.5"
                            >
                              <X className="w-2.5 h-2.5 inline mr-0.5" />Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Plan items list */}
                      {eventPlanning.activePlan.items.length > 0 && (
                        <div className="border-t border-rmpg-700 pt-1 mt-1">
                          <div className="flex items-center justify-between px-2 mb-1">
                            <span className="text-[8px] text-rmpg-500 uppercase tracking-wider font-bold">Plan Items</span>
                            <button
                              onClick={() => eventPlanning.setPlanVisible(!eventPlanning.planVisible)}
                              className="text-rmpg-500 hover:text-rmpg-300"
                            >
                              {eventPlanning.planVisible
                                ? <Eye className="w-2.5 h-2.5" />
                                : <EyeOff className="w-2.5 h-2.5" />}
                            </button>
                          </div>
                          <div className="space-y-0.5 max-h-[120px] overflow-y-auto">
                            {eventPlanning.activePlan.items.map((item) => (
                              <div
                                key={item.id}
                                className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-rmpg-800/50"
                              >
                                <div className="w-1.5 h-1.5" style={{ backgroundColor: item.color }} />
                                <span className="text-[9px] text-rmpg-300 flex-1 truncate">{item.label}</span>
                                <span className="text-[7px] text-rmpg-600 uppercase">{item.type}</span>
                                <button
                                  onClick={() => eventPlanning.removeItemFromPlan(item.id)}
                                  className="p-0.5 text-rmpg-600 hover:text-red-400"
                                >
                                  <Trash2 className="w-2 h-2" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          )}
        </div>}

        {/* ── Predictions Panel (floating, desktop only) ── */}
        {!isMobile && showPredictions && (
          <div className="absolute top-4 z-[1001]" style={{ left: layersPanelOpen ? 'calc(clamp(160px, 14vw, 200px) + 24px)' : 52 }}>
            <PredictionsPanel
              hotspots={predictions.hotspots}
              loading={predictions.loading}
              onNavigate={(lat, lng) => panTo(lat, lng)}
              onClose={() => setShowPredictions(false)}
            />
          </div>
        )}

        {/* ── Tactical Tools Panel ── */}
        {!isMobile && showTacticalTools && (
          <div className="absolute top-2 z-30" style={{ right: 8, maxWidth: 280 }}>
            <TacticalToolsPanel
              rallyPoint={tactical.rallyPoint}
              entryPoints={tactical.entryPoints}
              crowdDensity={(() => {
                const c = mapInstanceRef.current?.getCenter();
                return c ? tactical.estimateCrowdDensity(c.lat, c.lng) : 'Low (<50)';
              })()}
              onSetRallyPoint={() => {
                const c = mapInstanceRef.current?.getCenter();
                if (c) tactical.setRallyPoint(c.lat, c.lng, 'Rally Point');
              }}
              onClearRallyPoint={() => tactical.clearRallyPoint()}
              onShowCommandRings={() => {
                const c = mapInstanceRef.current?.getCenter();
                if (c) tactical.showCommandRings(c.lat, c.lng);
              }}
              onClearCommandRings={() => tactical.clearCommandRings()}
              onShowK9Radius={() => {
                const c = mapInstanceRef.current?.getCenter();
                if (c) tactical.showK9Radius(c.lat, c.lng);
              }}
              onClearK9Radius={() => tactical.clearK9Radius()}
              onShowHospitals={() => tactical.showHospitals()}
              onShowFireStations={() => tactical.showFireStations()}
              onHideEmergencyServices={() => tactical.hideEmergencyServices()}
              onAddEntryPoint={(label) => {
                const c = mapInstanceRef.current?.getCenter();
                if (c) tactical.addEntryPoint(c.lat, c.lng, label);
              }}
              onClearEntryPoints={() => tactical.clearEntryPoints()}
              onQuickDeploy={(preset: QuickDeployPreset) => {
                const c = mapInstanceRef.current?.getCenter();
                if (!c) return;
                const lat = c.lat;
                const lng = c.lng;
                // Clear existing tactical markers first
                tactical.clearRallyPoint();
                tactical.clearEntryPoints();
                tactical.clearCommandRings();
                tactical.clearK9Radius();

                switch (preset) {
                  case 'traffic_stop':
                    tactical.setRallyPoint(lat, lng, 'Traffic Stop');
                    tactical.showCommandRings(lat, lng); // 100/300/500m rings
                    break;
                  case 'building_search':
                    // 4 entry points at N/S/E/W offsets (~50m)
                    tactical.addEntryPoint(lat + 0.00045, lng, 'North Entry');
                    tactical.addEntryPoint(lat - 0.00045, lng, 'South Entry');
                    tactical.addEntryPoint(lat, lng + 0.0006, 'East Entry');
                    tactical.addEntryPoint(lat, lng - 0.0006, 'West Entry');
                    tactical.showK9Radius(lat, lng); // K9 radius
                    break;
                  case 'active_threat':
                    tactical.setRallyPoint(lat + 0.003, lng, 'Command Post');
                    tactical.showCommandRings(lat, lng); // inner/outer perimeters
                    break;
                  case 'crowd_control':
                    // 4 rally points at corners (~250m offsets)
                    tactical.addEntryPoint(lat + 0.0023, lng + 0.003, 'NE Rally');
                    tactical.addEntryPoint(lat + 0.0023, lng - 0.003, 'NW Rally');
                    tactical.addEntryPoint(lat - 0.0023, lng + 0.003, 'SE Rally');
                    tactical.addEntryPoint(lat - 0.0023, lng - 0.003, 'SW Rally');
                    tactical.showCommandRings(lat, lng); // perimeter rings
                    break;
                }
                addToast(`${preset.replace(/_/g, ' ').toUpperCase()} deployed at map center`, 'success');
              }}
              onClose={() => setShowTacticalTools(false)}
            />
          </div>
        )}

        {/* ── Analysis Intel Dashboard ── */}
        {!isMobile && showAnalysisDashboard && (
          <div className="absolute top-2 right-2 z-30" style={{ maxWidth: 320, top: 8 }}>
            <AnalysisDashboardPanel
              data={analysisSummary.data}
              loading={analysisSummary.loading}
              onRefresh={analysisSummary.refresh}
              onNavigate={(lat, lng) => panTo(lat, lng)}
              onClose={() => setShowAnalysisDashboard(false)}
            />
          </div>
        )}

        {/* ── Status Legend - Bottom Left (desktop only) ── */}
        {!isMobile && <div className="absolute bottom-2 left-2 z-[1000]">
          <div
            className="backdrop-blur-md shadow-xl"
            role="region"
            aria-label="Map status legend"
            style={{
              borderRadius: 2,
              background: isLightMapStyle(mapStyle) ? 'rgba(255,255,255,0.85)' : isSatelliteStyle(mapStyle) ? 'rgba(10,10,10,0.88)' : 'rgba(10,10,10,0.92)',
              border: isLightMapStyle(mapStyle) ? '1px solid rgba(0,0,0,0.12)' : '1px solid rgba(43,43,43,0.5)',
              padding: '4px 8px',
            }}
          >
            <div className="flex items-center gap-2.5">
              {(Object.entries(UNIT_STATUS_COLORS) as [UnitStatus, string][])
                .filter(([k]) => k !== 'off_duty')
                .map(([status, color]) => (
                  <div key={status} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 5px ${color}80` }} />
                    <span className={`text-[8px] font-mono font-bold ${isLightMapStyle(mapStyle) ? 'text-gray-600' : 'text-rmpg-300'}`}>
                      {UNIT_STATUS_LABELS[status as UnitStatus]}
                    </span>
                  </div>
                ))}
              <div className={`w-px h-3 ${isLightMapStyle(mapStyle) ? 'bg-gray-300' : 'bg-rmpg-600'}`} />
              {(['P1', 'P2', 'P3', 'P4'] as const).map(p => (
                <div key={p} className="flex items-center gap-0.5">
                  <div className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: PRIORITY_COLORS[p] }} />
                  <span className={`text-[7px] font-mono font-bold ${isLightMapStyle(mapStyle) ? 'text-gray-500' : 'text-rmpg-400'}`}>{p}</span>
                </div>
              ))}
            </div>
          </div>
        </div>}

        {/* ── Stats Bar - Top Left (after layers panel, desktop only) ── */}
        {!isMobile && <div
          className="absolute top-2 z-[1000] transition-all"
          style={{ left: layersPanelOpen ? 'calc(clamp(160px, 14vw, 200px) + 24px)' : 52 }}
        >
          <div
            className="backdrop-blur-md shadow-md"
            style={{
              borderRadius: 2,
              background: isLightMapStyle(mapStyle) ? 'rgba(255,255,255,0.88)' : isSatelliteStyle(mapStyle) ? 'rgba(10,10,10,0.92)' : 'rgba(10,10,10,0.95)',
              border: isLightMapStyle(mapStyle) ? '1px solid rgba(0,0,0,0.15)' : '1px solid rgba(43,43,43,0.6)',
            }}
          >
            <div className="flex items-center gap-0.5 px-1.5 py-1">
              {/* Live indicator */}
              <div className="flex items-center gap-1 px-2 py-0.5" style={{ borderRight: isLightMapStyle(mapStyle) ? '1px solid rgba(0,0,0,0.1)' : '1px solid #2b2b2b' }}>
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                <span className={`text-[9px] font-mono font-black tracking-wider ${isConnected ? (isLightMapStyle(mapStyle) ? 'text-green-700' : 'text-green-400') : 'text-red-400'}`}>
                  {isConnected ? 'LIVE' : 'DISC'}
                </span>
              </div>

              {/* Calls */}
              <div className="flex items-center gap-1 px-2 py-0.5" style={{ borderRight: isLightMapStyle(mapStyle) ? '1px solid rgba(0,0,0,0.1)' : '1px solid #2b2b2b' }}>
                <Siren className={`w-3 h-3 shrink-0 ${isLightMapStyle(mapStyle) ? 'text-red-600' : 'text-red-400'}`} />
                <span className={`text-[13px] font-mono font-black ${isLightMapStyle(mapStyle) ? 'text-gray-900' : 'text-white'}`}>{callsWithCoords.length}</span>
                {callsByPriority['P1'] ? <span className="text-[8px] font-mono font-bold text-red-500 bg-red-500/15 px-1 rounded-sm">P1:{callsByPriority['P1']}</span> : null}
                {callsByPriority['P2'] ? <span className="text-[8px] font-mono font-bold text-amber-500 bg-amber-500/15 px-1 rounded-sm">P2:{callsByPriority['P2']}</span> : null}
              </div>

              {/* Units */}
              <div className="flex items-center gap-1 px-2 py-0.5">
                <Shield className={`w-3 h-3 shrink-0 ${isLightMapStyle(mapStyle) ? 'text-green-600' : 'text-green-400'}`} />
                <span className={`text-[13px] font-mono font-black ${isLightMapStyle(mapStyle) ? 'text-gray-900' : 'text-white'}`}>{unitsWithCoords.length}</span>
                <div className="flex items-center gap-1.5 ml-1">
                  {STATUS_FILTER_ITEMS.filter(s => (unitsByStatus[s.key] || 0) > 0).map(({ key, label, color }) => (
                    <span key={key} className="text-[8px] font-mono font-bold px-1 rounded-sm" style={{ color, background: color + '15' }}>
                      {label}:{unitsByStatus[key] || 0}
                    </span>
                  ))}
                </div>
              </div>

              {showTrackingLines && trackingLineCount > 0 && (
                <div className="flex items-center gap-1 px-1.5">
                  <Navigation2 className="w-2.5 h-2.5 text-gray-400" />
                  <span className="text-gray-400 text-[8px] font-mono font-bold">{trackingLineCount}</span>
                </div>
              )}

              {/* Fix 40-41: data freshness indicator */}
              <div className="flex items-center gap-1 px-1.5 ml-auto">
                {isDataStale && (
                  <span className="text-[8px] font-mono font-bold text-red-400 animate-pulse" title="Data may be stale">STALE</span>
                )}
                <Clock className="w-2.5 h-2.5 text-rmpg-500" />
                <span className="text-[8px] font-mono text-rmpg-400" title={`Last updated: ${lastDataUpdate.toLocaleTimeString()}`}>
                  {lastDataUpdate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            </div>
          </div>
        </div>}

        {/* ── Route Info Panel (bottom-left, top on mobile) ── */}
        {/* Unified always-visible legend for every active overlay */}
        {!isMobile && (
          <UnifiedMapLegend
            hierarchy={{
              area: !!hierarchyStates.area?.visible,
              section: !!hierarchyStates.section?.visible,
              zone: !!hierarchyStates.zone?.visible,
              beat: !!geoLayerStates.beat?.visible,
            }}
            boundaries={{
              county: !!geoLayerStates.county?.visible,
              municipality: !!geoLayerStates.municipality?.visible,
            }}
            statewide={{
              roads: !!vectorLayerStates['utah_roads']?.visible,
              addresses: !!vectorLayerStates['utah_addresses']?.visible,
            }}
            choro={choroLegend}
            categorical={hierLegend}
            isLight={isLightMapStyle(mapStyle)}
            bottomPx={activeRoute ? 132 : 28}
            leftCss={layersPanelOpen ? 'calc(clamp(160px, 14vw, 200px) + 24px)' : '12px'}
          />
        )}

        {activeRoute && (
          <div
            className="absolute z-[1000] backdrop-blur-md"
            style={{
              ...(isMobile
                ? { top: 56, left: 8, right: 8 }
                : { bottom: 48, left: layersPanelOpen ? 'calc(clamp(160px, 14vw, 200px) + 24px)' : 16, minWidth: 200 }),
              background: isLightMapStyle(mapStyle) ? 'rgba(255,255,255,0.92)' : 'rgba(10,10,10,0.95)',
              border: isLightMapStyle(mapStyle) ? '1px solid rgba(136, 136, 136,0.3)' : '1px solid #88888850',
              padding: '8px 14px',
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              borderRadius: 2,
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: '#888888', fontWeight: 900, letterSpacing: '0.05em' }}>
                {activeRoute.unitCallSign} → {activeRoute.callNumber}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={toggleNavMute}
                  style={{ background: 'none', border: 'none', color: navMuted ? '#666666' : '#d4a017', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1 }}
                  title={navMuted ? 'Voice guidance off — tap to enable' : 'Voice guidance on — tap to mute'}
                  aria-label={navMuted ? 'Enable voice guidance' : 'Mute voice guidance'}
                >
                  {navMuted ? '🔇' : '🔊'}
                </button>
                <button
                  onClick={clearRoute}
                  style={{ background: 'none', border: 'none', color: '#666666', cursor: 'pointer', fontSize: 12, padding: '0 0 0 6px' }}
                  title="Clear route"
                  aria-label="Clear route"
                >
                  ✕
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              {/* Live remaining ETA when the unit is en route; otherwise full-route ETA. */}
              <span style={{ fontSize: 16, color: isLightMapStyle(mapStyle) ? '#181818' : '#fff', fontWeight: 900 }}>
                {routeProgress ? routeProgress.remainingEta : activeRoute.eta}
              </span>
              <span style={{ fontSize: 11, color: isLightMapStyle(mapStyle) ? '#666666' : '#999999' }}>
                {routeProgress ? routeProgress.remainingDistance : activeRoute.distance}
              </span>
              {/* Traffic-aware congestion badge. */}
              {activeRoute.trafficAware && activeRoute.worstCongestion !== 'unknown' && (() => {
                const c = activeRoute.worstCongestion;
                const cc = c === 'severe' ? '#ef4444' : c === 'heavy' ? '#f97316' : c === 'moderate' ? '#eab308' : '#22c55e';
                return (
                  <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.06em', color: cc, border: `1px solid ${cc}66`, padding: '1px 5px', borderRadius: 2, textTransform: 'uppercase' }}>
                    {c} traffic
                  </span>
                );
              })()}
            </div>
            {/* Progress bar toward the call. */}
            {routeProgress && routeProgress.fraction > 0.01 && (
              <div style={{ marginTop: 5, height: 3, background: 'rgba(136,136,136,0.18)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${Math.round(routeProgress.fraction * 100)}%`, height: '100%', background: '#d4a017', transition: 'width 0.5s ease' }} />
              </div>
            )}
            {/* Arrival banner — supersedes the maneuver card at the destination. */}
            {navGuidance.arrived ? (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(136,136,136,0.18)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>⚑</span>
                <span style={{ fontSize: 11, fontWeight: 900, color: '#22c55e', letterSpacing: '0.04em' }}>ARRIVED AT DESTINATION</span>
              </div>
            ) : (
              /* Turn-by-turn: the upcoming maneuver (arrow + distance) plus a
                 "then …" preview of the maneuver after it. Driven by the
                 useNavGuidance brain so the banner matches the spoken cues. */
              navGuidance.next && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(136,136,136,0.18)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18, color: '#d4a017', minWidth: 22, textAlign: 'center', lineHeight: 1 }}>{navGuidance.next.arrow}</span>
                    <span style={{ fontSize: 9, fontWeight: 900, color: '#d4a017', minWidth: 44 }}>{navGuidance.next.distanceText}</span>
                    <span style={{ fontSize: 11, color: isLightMapStyle(mapStyle) ? '#222' : '#ddd', lineHeight: 1.25 }}>{navGuidance.next.instruction}</span>
                  </div>
                  {navGuidance.then && navGuidance.then.maneuverType !== 'arrive' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, opacity: 0.62 }}>
                      <span style={{ fontSize: 12, color: '#888888', minWidth: 22, textAlign: 'center' }}>{navGuidance.then.arrow}</span>
                      <span style={{ fontSize: 8, color: '#888888', minWidth: 44 }}>then</span>
                      <span style={{ fontSize: 9, color: isLightMapStyle(mapStyle) ? '#555' : '#aaa', lineHeight: 1.2 }}>{navGuidance.then.instruction}</span>
                    </div>
                  )}
                </div>
              )
            )}
            {/* Hazard-ahead: an active call on the path ahead (CAD-unique alert). */}
            {navGuidance.hazardAhead && (() => {
              const sev = navGuidance.hazardAhead.hazard.severity;
              const col = sev === 'critical' ? '#ef4444' : sev === 'high' ? '#f97316' : '#eab308';
              return (
                <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 2, background: `${col}1a`, border: `1px solid ${col}55` }}>
                  <span style={{ fontSize: 11 }}>{sev === 'critical' ? '⚠' : '◆'}</span>
                  <span style={{ fontSize: 8, fontWeight: 900, color: col, letterSpacing: '0.04em' }}>{navGuidance.hazardAhead.distanceText} AHEAD</span>
                  <span style={{ fontSize: 9, color: isLightMapStyle(mapStyle) ? '#444' : '#ccc', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{navGuidance.hazardAhead.hazard.label}</span>
                </div>
              );
            })()}
            {offRoute && (
              <div style={{ fontSize: 8, color: '#ef4444', marginTop: 4, fontWeight: 900, letterSpacing: '0.05em' }}>⚠ OFF ROUTE — RECALCULATING</div>
            )}
            {routeLoading && (
              <div style={{ fontSize: 8, color: '#f59e0b', marginTop: 4 }}>Updating route…</div>
            )}
          </div>
        )}

        {/* ── "Route all PSO/service calls" quick launcher (queue empty) ── */}
        {routeQueue.length === 0 && routableServiceCalls.length >= 2 && (
          <button
            onClick={handleQueueAllService}
            className="absolute z-[1001] backdrop-blur-md flex items-center gap-2 transition-colors"
            style={{
              ...(isMobile ? { top: 56, right: 8 } : { top: 64, right: 16 }),
              background: 'rgba(10,10,10,0.96)',
              border: '1px solid #d4a01755',
              borderRadius: 2,
              boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
              padding: '6px 10px',
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 9,
              fontWeight: 900,
              letterSpacing: '0.06em',
              color: '#d4a017',
              cursor: 'pointer',
              textTransform: 'uppercase',
            }}
            title="Queue all service calls into one optimized patrol route"
          >
            <Route className="w-3.5 h-3.5" />
            Route {routableServiceCalls.length} Service Calls
          </button>
        )}

        {/* ── Multi-Stop Patrol Route Panel (optimized one-unit-many-calls) ── */}
        <MultiStopRoutePanel
          queue={routeQueue}
          units={units}
          selectedUnit={routeUnit}
          result={multiStopRoute}
          loading={multiStopLoading}
          isMobile={isMobile}
          onSelectUnit={setRouteUnit}
          onRemoveStop={(callNumber) => setRouteQueue((prev) => prev.filter((s) => s.callNumber !== callNumber))}
          onClear={handleClearPatrol}
          onOptimize={handleOptimizeRoute}
        />

        {/* ── Bottom Right Buttons (Recenter + GPS Locate) ── */}
        <div
          className="absolute z-[1000] flex flex-col gap-2"
          style={isMobile
            ? { bottom: 'calc(88px + env(safe-area-inset-bottom))', right: 16 }
            : { bottom: 16, right: 16, marginRight: sidebarOpen ? 'clamp(200px, 20vw, 280px)' : 36 }
          }
        >
          {/* Zoom controls (mobile only — desktop has them top-right) */}
          {isMobile && (
            <div
              className="flex flex-col overflow-hidden"
              style={{
                borderRadius: 2,
                background: 'rgba(10, 10, 10, 0.9)',
                border: '1px solid #2b2b2b',
              }}
            >
              <button
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) map.setZoom((map.getZoom() ?? 12) + 1);
                }}
                disabled={zoomBounds.atMax}
                className="flex items-center justify-center transition-colors hover:bg-white/10 active:bg-white/20 disabled:opacity-30 disabled:pointer-events-none"
                style={{ width: 48, height: 48, borderBottom: '1px solid #2b2b2b' }}
                title="Zoom in"
                aria-label="Zoom in"
              >
                <Plus className="w-5 h-5 text-white/80" />
              </button>
              <button
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) map.setZoom((map.getZoom() ?? 12) - 1);
                }}
                disabled={zoomBounds.atMin}
                className="flex items-center justify-center transition-colors hover:bg-white/10 active:bg-white/20 disabled:opacity-30 disabled:pointer-events-none"
                style={{ width: 48, height: 48 }}
                title="Zoom out"
                aria-label="Zoom out"
              >
                <Minus className="w-5 h-5 text-white/80" />
              </button>
            </div>
          )}
          {/* Center on my GPS position */}
          {gps.isTracking && gps.latitude != null && gps.longitude != null && (
            <button
              onClick={() => {
                if (gps.latitude != null && gps.longitude != null) {
                  mapInstanceRef.current?.panTo({ lat: gps.latitude, lng: gps.longitude });
                  mapInstanceRef.current?.setZoom(16);
                }
              }}
              className={`backdrop-blur-md shadow-xl transition-colors ${
                isLightMapStyle(mapStyle)
                  ? 'bg-white/90 border border-gray-300 hover:bg-gray-50'
                  : 'bg-surface-deep/95 border border-gray-500/50 hover:bg-gray-900/30'
              }`}
              style={isMobile
                ? { borderRadius: 2, width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }
                : { borderRadius: 2, padding: 10 }
              }
              title={`Center on my position${gps.unitCallSign ? ` (${gps.unitCallSign})` : ''}`}
            >
              <Navigation2 className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} ${isLightMapStyle(mapStyle) ? 'text-gray-600' : 'text-gray-400'}`} />
            </button>
          )}
          {/* Export: screenshot PNG, print, situation-report PDF */}
          <MapExportMenu
            mapStyle={mapStyle}
            isMobile={isMobile}
            onScreenshot={handleScreenshot}
            onPrint={handlePrintMap}
            onReport={handleSituationReport}
          />
          {/* Reset to default view */}
          <button
            onClick={() => {
              mapInstanceRef.current?.panTo(DEFAULT_CENTER);
              mapInstanceRef.current?.setZoom(12);
            }}
            className={`backdrop-blur-md shadow-xl transition-colors ${
              isLightMapStyle(mapStyle)
                ? 'bg-white/90 border border-gray-300 hover:bg-[#181818]'
                : 'bg-surface-deep/95 border border-rmpg-600 hover:bg-rmpg-700/40'
            }`}
            style={isMobile
              ? { borderRadius: 2, width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }
              : { borderRadius: 2, padding: 10 }
            }
            title="Reset view"
          >
            <Crosshair className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} ${isLightMapStyle(mapStyle) ? 'text-gray-600' : 'text-rmpg-300'}`} />
          </button>
        </div>

        {/* ── Mini-Stats Bar — live operational counts above status bar ── */}
        {!isMobile && mapLoaded && (
          <div
            className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center gap-6 px-4 select-none pointer-events-none"
            style={{
              height: 22,
              background: 'rgba(10,10,10,0.85)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              borderTop: '1px solid rgba(43,43,43,0.5)',
            }}
          >
            {/* Active Calls */}
            <div className="flex items-center gap-1.5">
              <div className="led-dot" style={{ backgroundColor: calls.length > 0 ? '#ef4444' : '#22c55e', width: 5, height: 5 }} />
              <span className="text-[9px] font-mono text-rmpg-500 uppercase tracking-wider">Active Calls</span>
              <span className="text-[9px] font-mono font-bold text-rmpg-200">{calls.length}</span>
            </div>
            {/* Units On Duty */}
            <div className="flex items-center gap-1.5">
              <div className="led-dot" style={{ backgroundColor: '#888888', width: 5, height: 5 }} />
              <span className="text-[9px] font-mono text-rmpg-500 uppercase tracking-wider">Units On Duty</span>
              <span className="text-[9px] font-mono font-bold text-rmpg-200">{units.filter(u => u.status !== 'off_duty').length}</span>
            </div>
            {/* Avg Response Time — estimated from dispatched call ratio */}
            <div className="flex items-center gap-1.5">
              <div className="led-dot" style={{ backgroundColor: '#f59e0b', width: 5, height: 5 }} />
              <span className="text-[9px] font-mono text-rmpg-500 uppercase tracking-wider">Avg Response</span>
              <span className="text-[9px] font-mono font-bold text-rmpg-200">
                {(() => {
                  const dispatched = units.filter(u => u.status === 'dispatched' || u.status === 'enroute').length;
                  const available = units.filter(u => u.status === 'available').length;
                  // Estimate: more dispatched vs available = longer response times
                  const base = 4; // baseline 4 min
                  const load = available > 0 ? Math.min(dispatched / available, 3) : 3;
                  return `${(base + load * 3).toFixed(1)}m`;
                })()}
              </span>
            </div>
            {/* Coverage */}
            <div className="flex items-center gap-1.5">
              <div className="led-dot" style={{ backgroundColor: '#22c55e', width: 5, height: 5 }} />
              <span className="text-[9px] font-mono text-rmpg-500 uppercase tracking-wider">Coverage</span>
              <span className="text-[9px] font-mono font-bold text-rmpg-200">Active</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Right Sidebar - Unit/Call List (Desktop only, responsive width) ── */}
      {!isMobile && <div
        className="flex flex-col panel-beveled transition-all"
        style={{
          width: sidebarOpen ? 'clamp(220px, 20vw, 300px)' : 36,
          background: '#0b0b0b',
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="toolbar-btn flex items-center justify-center h-7"
          style={{ borderRadius: 0 }}
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-expanded={sidebarOpen}
        >
          {sidebarOpen ? <ChevronUp className="w-3.5 h-3.5 text-rmpg-400 rotate-90" /> : <ChevronDown className="w-3.5 h-3.5 text-rmpg-400 -rotate-90" />}
        </button>

        {sidebarOpen && (
          <>
            {/* Compact status counters */}
            <div className="flex items-center justify-center gap-2 px-2 py-1.5 panel-inset" style={{ background: '#050505' }}>
              {([
                { label: 'AVL', count: unitsByStatus['available'] || 0, color: '#22c55e' },
                { label: 'DSP', count: unitsByStatus['dispatched'] || 0, color: '#f59e0b' },
                { label: 'ENR', count: unitsByStatus['enroute'] || 0, color: '#888888' },
                { label: 'ONS', count: unitsByStatus['onscene'] || 0, color: '#a855f7' },
                { label: 'BSY', count: unitsByStatus['busy'] || 0, color: '#ef4444' },
              ]).map(({ label, count, color }) => (
                <div key={label} className="flex items-center gap-0.5" title={label}>
                  <div className="led-dot" style={{ backgroundColor: color, width: 6, height: 6 }} />
                  <span className="text-[8px] font-mono font-bold" style={{ color }}>{count}</span>
                </div>
              ))}
              <div className="w-px h-3 bg-rmpg-700" />
              {callsByPriority['P1'] ? <span className="text-[8px] font-mono font-bold text-red-400">P1:{callsByPriority['P1']}</span> : null}
              {callsByPriority['P2'] ? <span className="text-[8px] font-mono font-bold text-amber-400">P2:{callsByPriority['P2']}</span> : null}
              {callsByPriority['P3'] ? <span className="text-[8px] font-mono font-bold text-gray-400">P3:{callsByPriority['P3']}</span> : null}
            </div>

            <div className="tab-bar">
              <button
                onClick={() => setSidebarTab('units')}
                className={`tab-bar-item flex items-center justify-center gap-1.5 ${sidebarTab === 'units' ? 'active' : ''}`}
              >
                <Shield className="w-3 h-3" /> Units ({filteredUnits.length})
              </button>
              <button
                onClick={() => setSidebarTab('calls')}
                className={`tab-bar-item flex items-center justify-center gap-1.5 ${sidebarTab === 'calls' ? 'active' : ''}`}
              >
                <AlertTriangle className="w-3 h-3" /> Calls ({filteredCalls.length})
              </button>
            </div>

            <div className="px-2 py-1.5" style={{ borderBottom: '1px solid #303030' }}>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
                <input id="ff-mappage-13"
                  type="text"
                  className="input-dark w-full text-[10px] py-1 pl-6 pr-2"
                  placeholder={sidebarTab === 'units' ? 'SEARCH UNITS...' : 'SEARCH CALLS...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
              {sidebarTab === 'units' && (
                <div className="divide-y divide-rmpg-700/50">
                  {filteredUnits.map((unit) => {
                    const hasCoords = unit.latitude != null && unit.longitude != null;
                    const statusColor = UNIT_STATUS_COLORS[unit.status];
                    return (
                      <button
                        key={unit.id}
                        onClick={() => hasCoords && panTo(unit.latitude!, unit.longitude!)}
                        disabled={!hasCoords}
                        className={`w-full text-left px-3 py-2.5 hover:bg-rmpg-800/50 transition-colors ${
                          hasCoords ? 'cursor-pointer' : 'cursor-default opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="led-dot flex-shrink-0"
                            style={{ backgroundColor: statusColor, boxShadow: `0 0 6px ${statusColor}80`, width: 10, height: 10 }}
                          />
                          <span className="text-[11px] font-mono font-bold text-rmpg-100">{unit.call_sign}</span>
                          {unit.gps_source === 'clearpathgps' && (
                            <span className="text-[7px] font-bold px-1 py-0 bg-gray-900/40 text-gray-400 border border-gray-700/30" title="ClearPathGPS Hardware Tracker">CPG</span>
                          )}
                          <span className="text-[9px] font-mono ml-auto uppercase font-bold" style={{ color: statusColor }}>{UNIT_STATUS_LABELS[unit.status]}</span>
                        </div>
                        <div className="ml-5 mt-0.5">
                          <span className="text-[9px] text-rmpg-400">{unit.officer_name}</span>
                          {unit.call_number && (
                            <span className="text-[9px] text-gray-400 ml-2 font-mono">{unit.call_number}</span>
                          )}
                        </div>
                        {unit.current_call_type && (
                          <div className="ml-5 text-[8px] text-rmpg-500">{formatIncidentType(unit.current_call_type)}</div>
                        )}
                      </button>
                    );
                  })}
                  {filteredUnits.length === 0 && (
                    <div className="py-8 text-center text-[10px] text-rmpg-500 font-mono">No active units</div>
                  )}
                </div>
              )}

              {sidebarTab === 'calls' && (
                <div className="divide-y divide-rmpg-700/50">
                  {filteredCalls.map((call) => {
                    const hasCoords = call.latitude != null && call.longitude != null;
                    const pColor = PRIORITY_COLORS[call.priority] || '#666666';
                    const { category } = getIncidentCategory(call.incident_type);
                    return (
                      <div
                        role="button"
                        tabIndex={0}
                        key={call.id}
                        onClick={() => hasCoords && panTo(call.latitude!, call.longitude!)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hasCoords && panTo(call.latitude!, call.longitude!); } }}
                        className={`w-full text-left px-3 py-2.5 hover:bg-rmpg-800/50 transition-colors ${
                          hasCoords ? 'cursor-pointer' : 'cursor-default opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[8px] font-mono font-bold px-1.5 py-0.5"
                            style={{ background: pColor + '25', color: pColor, border: `1px solid ${pColor}40` }}
                          >{call.priority}</span>
                          <span className="text-[10px] font-mono font-bold text-rmpg-100 flex-1">{call.call_number}</span>
                          <span className="text-[8px] font-mono text-rmpg-400 uppercase font-bold">{call.status.replace(/_/g, ' ')}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 ml-8">
                          <span className="text-[9px] font-bold px-1 py-0.5" style={{ background: pColor + '15', color: pColor, fontSize: '8px' }}>{category}</span>
                          <span className="text-[9px]" style={{ color: pColor }}>{formatIncidentType(call.incident_type)}</span>
                        </div>
                        <div className="ml-8 text-[8px] text-rmpg-500 truncate mt-0.5">{call.location_address}</div>
                        {call.property_name && (
                          <div className="ml-8 text-[8px] text-gray-400 truncate mt-0.5">{call.property_name}</div>
                        )}
                        {/* Quick actions */}
                        <div className="ml-8 mt-1.5 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {call.status === 'pending' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCallStatusChange(call.id, 'dispatched'); }}
                              className="px-1.5 py-0.5 text-[8px] font-bold font-mono bg-amber-900/30 text-amber-400 border border-amber-700/40 hover:bg-amber-800/40 transition-colors"
                            >
                              DISPATCH
                            </button>
                          )}
                          {call.status === 'dispatched' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCallStatusChange(call.id, 'enroute'); }}
                              className="px-1.5 py-0.5 text-[8px] font-bold font-mono bg-gray-900/30 text-gray-400 border border-gray-700/40 hover:bg-gray-800/40 transition-colors"
                            >
                              EN ROUTE
                            </button>
                          )}
                          {call.status === 'enroute' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCallStatusChange(call.id, 'onscene'); }}
                              className="px-1.5 py-0.5 text-[8px] font-bold font-mono bg-purple-900/30 text-purple-400 border border-purple-700/40 hover:bg-purple-800/40 transition-colors"
                            >
                              ON SCENE
                            </button>
                          )}
                          {CLEARABLE_STATUSES.includes(call.status) && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCallStatusChange(call.id, 'cleared'); }}
                              className="px-1.5 py-0.5 text-[8px] font-bold font-mono bg-rmpg-700/30 text-rmpg-300 border border-rmpg-600/40 hover:bg-rmpg-600/40 transition-colors"
                            >
                              CLEAR
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {filteredCalls.length === 0 && (
                    <div className="py-8 text-center text-[10px] text-rmpg-500 font-mono">No active calls</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>}

      {/* ── Mobile: Floating layer button + bottom sheet ── */}
      {isMobile && (
        <>
          <button
            className="mobile-fab"
            style={{
              position: 'absolute',
              bottom: 'calc(88px + env(safe-area-inset-bottom))',
              left: 16,
              zIndex: 20,
              width: 48,
              height: 48,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(10, 10, 10, 0.9)',
              border: '1px solid #2b2b2b',
              borderRadius: 2,
            }}
            onClick={() => setMobileLayersOpen(!mobileLayersOpen)}
            aria-label="Toggle layers"
          >
            <Layers style={{ width: 22, height: 22, color: '#888888' }} />
          </button>

          <MobileBottomSheet
            open={mobileLayersOpen}
            onClose={() => setMobileLayersOpen(false)}
            initialSnap="half"
            collapsedHeight={0}
            header={
              <div className="flex items-center gap-1">
                {([
                  { id: 'layers' as const, icon: Layers, label: 'Layers', color: '#888888' },
                  { id: 'units' as const, icon: Shield, label: `Units (${filteredUnits.length})`, color: '#22c55e' },
                  { id: 'calls' as const, icon: AlertTriangle, label: `Calls (${filteredCalls.length})`, color: '#ef4444' },
                ] as const).map(({ id, icon: Icon, label, color }) => (
                  <button
                    key={id}
                    onClick={() => setMobileSheetTab(id)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                    style={{
                      color: mobileSheetTab === id ? color : '#666666',
                      background: mobileSheetTab === id ? `${color}10` : 'transparent',
                      borderBottom: mobileSheetTab === id ? `2px solid ${color}` : '2px solid transparent',
                    }}
                  >
                    <Icon style={{ width: 12, height: 12 }} />
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            {/* Layers Tab */}
            {mobileSheetTab === 'layers' && (
              <div className="p-3 space-y-2">
                {[
                  { key: 'units' as const, icon: Shield, label: 'Units', color: '#22c55e' },
                  { key: 'incidents' as const, icon: AlertTriangle, label: 'Active Calls', color: '#ef4444' },
                  { key: 'properties' as const, icon: Building2, label: 'Properties', color: '#888888' },
                ].map(({ key, icon: Icon, label, color }) => (
                  <button
                    key={key}
                    onClick={() => toggleLayer(key)}
                    className="flex items-center gap-3 w-full px-3 py-3 text-left transition-colors"
                    style={{
                      background: layers[key] ? 'rgba(34,197,94,0.08)' : '#0a0a0a',
                      border: '1px solid #2b2b2b',
                      minHeight: 44,
                    }}
                  >
                    {layers[key] ? <Eye className="w-4 h-4 text-green-400" /> : <EyeOff className="w-4 h-4 text-rmpg-500" />}
                    <Icon style={{ width: 16, height: 16, color: layers[key] ? color : '#666666' }} />
                    <span className="text-sm text-rmpg-200 flex-1">{label}</span>
                  </button>
                ))}

                <button
                  onClick={() => setShowHeatmap(!showHeatmap)}
                  className="flex items-center gap-3 w-full px-3 py-3 text-left transition-colors"
                  style={{
                    background: showHeatmap ? 'rgba(239,68,68,0.08)' : '#0a0a0a',
                    border: '1px solid #2b2b2b',
                    minHeight: 44,
                  }}
                >
                  {showHeatmap ? <Eye className="w-4 h-4 text-red-400" /> : <EyeOff className="w-4 h-4 text-rmpg-500" />}
                  <Thermometer style={{ width: 16, height: 16 }} className="text-red-400" />
                  <span className="text-sm text-rmpg-200 flex-1">Heat Map</span>
                </button>

                {/* Breadcrumbs toggle */}
                <button
                  onClick={() => setShowBreadcrumbs(!showBreadcrumbs)}
                  className="flex items-center gap-3 w-full px-3 py-3 text-left transition-colors"
                  style={{
                    background: showBreadcrumbs ? 'rgba(34,211,238,0.08)' : '#0a0a0a',
                    border: '1px solid #2b2b2b',
                    minHeight: 44,
                  }}
                >
                  {showBreadcrumbs ? <Eye className="w-4 h-4 text-gray-400" /> : <EyeOff className="w-4 h-4 text-rmpg-500" />}
                  <Route style={{ width: 16, height: 16 }} className="text-gray-400" />
                  <span className="text-sm text-rmpg-200 flex-1">Breadcrumbs</span>
                </button>

                {/* Breadcrumb time range + color mode */}
                {showBreadcrumbs && (
                  <div className="px-3 py-2 space-y-2" style={{ background: '#050505', border: '1px solid #2b2b2b' }}>
                    <div className="flex gap-1">
                      {[2, 4, 8, 12, 24].map((h) => (
                        <button
                          key={h}
                          onClick={() => setBreadcrumbHours(h)}
                          className={`flex-1 py-2 text-xs font-bold rounded-sm ${
                            breadcrumbHours === h
                              ? 'bg-gray-600 text-white'
                              : 'bg-rmpg-800 text-rmpg-400 hover:bg-rmpg-700'
                          }`}
                        >
                          {h}h
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      {([['unit', 'Unit'], ['speed', 'Speed'], ['status', 'Status'], ['accel', 'Accel']] as const).map(([mode, label]) => (
                        <button
                          key={mode}
                          onClick={() => setBreadcrumbColorMode(mode)}
                          className={`flex-1 py-1.5 text-[10px] font-bold rounded-sm ${
                            breadcrumbColorMode === mode
                              ? 'bg-gray-600 text-white'
                              : 'bg-rmpg-800 text-rmpg-400 hover:bg-rmpg-700'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Map Style Selector (mobile) */}
                <div className="px-3 py-2 space-y-1.5" style={{ background: '#050505', border: '1px solid #2b2b2b' }}>
                  <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-widest mb-1">Map Style</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(Object.entries(MAP_STYLE_LABELS) as [MapStyleId, string][]).map(([key, label]) => {
                      const isActive = mapStyle === key;
                      return (
                        <button
                          key={key}
                          onClick={() => setMapStyle(key)}
                          className={`py-2 text-[10px] font-bold rounded-sm transition-all ${
                            isActive
                              ? 'bg-brand-600 text-white'
                              : 'bg-rmpg-800 text-rmpg-400 hover:bg-rmpg-700'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  onClick={() => {
                    const map = mapInstanceRef.current;
                    if (map && gps.latitude != null && gps.longitude != null) {
                      map.panTo({ lat: gps.latitude, lng: gps.longitude });
                      map.setZoom(16);
                    }
                  }}
                  className="flex items-center gap-3 w-full px-3 py-3 text-left transition-colors"
                  style={{
                    background: '#0a0a0a',
                    border: '1px solid #2b2b2b',
                    minHeight: 44,
                  }}
                >
                  <Navigation2 style={{ width: 16, height: 16 }} className="text-green-400" />
                  <span className="text-sm text-rmpg-200 flex-1">Center on My Location</span>
                </button>
              </div>
            )}

            {/* Units Tab */}
            {mobileSheetTab === 'units' && (
              <div className="divide-y divide-rmpg-700/50">
                {filteredUnits.map((unit) => {
                  const hasCoords = unit.latitude != null && unit.longitude != null;
                  const statusColor = UNIT_STATUS_COLORS[unit.status];
                  return (
                    <button
                      key={unit.id}
                      onClick={() => { if (hasCoords) { panTo(unit.latitude!, unit.longitude!); setMobileLayersOpen(false); } }}
                      className={`w-full text-left px-3 py-3 transition-colors ${hasCoords ? 'active:bg-rmpg-700/30' : 'opacity-60'}`}
                      style={{ minHeight: 44 }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor, boxShadow: `0 0 6px ${statusColor}80` }} />
                        <span className="text-[12px] font-mono font-bold text-rmpg-100">{unit.call_sign}</span>
                        {unit.gps_source === 'clearpathgps' && (
                          <span className="text-[7px] font-bold px-1 py-0 bg-gray-900/40 text-gray-400 border border-gray-700/30" title="ClearPathGPS Hardware Tracker">CPG</span>
                        )}
                        <span className="text-[10px] font-mono ml-auto uppercase font-bold" style={{ color: statusColor }}>{UNIT_STATUS_LABELS[unit.status]}</span>
                      </div>
                      <div className="ml-5 mt-0.5 text-[10px] text-rmpg-400">{unit.officer_name}</div>
                      {unit.current_call_type && (
                        <div className="ml-5 text-[9px] text-rmpg-500">{formatIncidentType(unit.current_call_type)}</div>
                      )}
                    </button>
                  );
                })}
                {filteredUnits.length === 0 && (
                  <div className="py-8 text-center text-[11px] text-rmpg-500">No active units</div>
                )}
              </div>
            )}

            {/* Calls Tab */}
            {mobileSheetTab === 'calls' && (
              <div className="divide-y divide-rmpg-700/50">
                {filteredCalls.map((call) => {
                  const hasCoords = call.latitude != null && call.longitude != null;
                  const pColor = PRIORITY_COLORS[call.priority] || '#666666';
                  const { category } = getIncidentCategory(call.incident_type);
                  return (
                    <button
                      key={call.id}
                      onClick={() => { if (hasCoords) { panTo(call.latitude!, call.longitude!); setMobileLayersOpen(false); } }}
                      className={`w-full text-left px-3 py-3 transition-colors ${hasCoords ? 'active:bg-rmpg-700/30' : 'opacity-60'}`}
                      style={{ minHeight: 44 }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-sm" style={{ background: pColor + '25', color: pColor, border: `1px solid ${pColor}40` }}>{call.priority}</span>
                        <span className="text-[11px] font-mono font-bold text-rmpg-100 flex-1">{call.call_number}</span>
                        <span className="text-[9px] font-mono text-rmpg-400 uppercase font-bold">{call.status.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 ml-8">
                        <span className="text-[8px] font-bold px-1 py-0.5 rounded-sm" style={{ background: pColor + '15', color: pColor }}>{category}</span>
                        <span className="text-[10px]" style={{ color: pColor }}>{formatIncidentType(call.incident_type)}</span>
                      </div>
                      <div className="ml-8 text-[9px] text-rmpg-500 truncate mt-0.5">{call.location_address}</div>
                    </button>
                  );
                })}
                {filteredCalls.length === 0 && (
                  <div className="py-8 text-center text-[11px] text-rmpg-500">No active calls</div>
                )}
              </div>
            )}
          </MobileBottomSheet>
        </>
      )}
    </div>
  );
}
