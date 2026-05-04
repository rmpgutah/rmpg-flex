import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { loadGoogleMaps, DARK_MAP_STYLE, NIGHT_NAV_STYLE, TERRAIN_STYLE, registerMapInstance, unregisterMapInstance, updateMapStyles, onOnlineRetryMaps, monitorTileLoading, getFallbackMapImage } from '../../utils/googleMapsLoader';
import { getGoogleMapsApiKey, getGoogleMapsApiKeyErrorMessage } from '../../utils/googleMapsApiKey';
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
  Radar,
  FileSearch,
  Timer,
  Target,
  Scale,
  Car,
  AlertOctagon,
  Sun,
  TreePine,
  SlidersHorizontal,
  BarChart3,
  Clock,
  RefreshCw,
  CircleDot,
} from 'lucide-react';
import type { UnitStatus } from '../../types';
import RmpgLogo from '../../components/RmpgLogo';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';
import { usePersistedTab } from '../../hooks/usePersistedState';
import { useUserPreferences } from '../../context/UserPreferencesContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { useGpsTracking } from '../../hooks/useGpsTracking';
import { formatIncidentType } from '../../utils/caseNumbers';
import { generatePatrolTrackingPdf } from '../../utils/patrolTrackingPdfGenerator';
import { escapeHtml } from '../../utils/sanitize';
import { isAndroidNative, navigateTo } from '../../utils/organicMapsNav';
import { useToast } from '../../components/ToastProvider';
import { localToday, dateToLocalYMD } from '../../utils/dateUtils';
import { useGeoJsonLayers, GEO_LAYER_CONFIGS, getSectionColor, type BeatDistrictEntry } from '../../hooks/useGeoJsonLayers';
import { useEventPlanning, PLAN_COLORS, PLAN_TYPE_LABELS, type PlanItemType } from '../../hooks/useEventPlanning';
import { useShiftPlanning, SHIFT_TYPES, type ShiftType } from '../../hooks/useShiftPlanning';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useMultiUnitRouting } from '../../hooks/useMultiUnitRouting';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useAutoPanToP1 } from '../../hooks/useAutoPanToP1';
import { useP1AudioAlert } from '../../hooks/useP1AudioAlert';
import { useMapKeyboardShortcuts } from '../../hooks/useMapKeyboardShortcuts';
import MobileBottomSheet from '../../components/mobile/MobileBottomSheet';
import type { MapUnit as Unit, ActiveCall, MapProperty as Property, MapStyleId } from './utils/mapConstants';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS, MAP_STYLE_LABELS, MAP_STYLE_DESCRIPTIONS, getIncidentCategory, isLightMapStyle, isSatelliteStyle } from './utils/mapConstants';
import { buildUnitMarkerContent, buildIncidentMarkerContent, buildPropertyMarkerContent, buildSelfPositionMarker, getOverlayMarkerClass, injectKeyframes, type OverlayMarker } from './utils/mapMarkerBuilders';
import { useMapHeatmapTimelapse } from './hooks/useMapHeatmapTimelapse';
import { useMapHeatmapAdvanced, type HeatmapAdvancedMode, type HeatmapColorScheme, type HeatmapResolution, type HeatmapAdvancedOptions } from './hooks/useMapHeatmapAdvanced';
import { useMapPredictions } from './hooks/useMapPredictions';
import { useMapIntelLayers } from './hooks/useMapIntelLayers';
import { useMapSafetyZones } from './hooks/useMapSafetyZones';
import { useMapGeofences, type GeofenceAlert } from './hooks/useMapGeofences';
import { useMapClustering } from './hooks/useMapClustering';
import { useMapDragDispatch } from './hooks/useMapDragDispatch';
import { useMapTrafficLayer } from './hooks/useMapTrafficLayer';
import { useMapPatrolCheckpoints } from './hooks/useMapPatrolCheckpoints';
import { useMapFieldInterviews } from './hooks/useMapFieldInterviews';
import { useMapDwellTime } from './hooks/useMapDwellTime';
import { useMapResponseRadius } from './hooks/useMapResponseRadius';
import { useMapEnforcementClusters } from './hooks/useMapEnforcementClusters';
import { useMapCoverageGaps } from './hooks/useMapCoverageGaps';
import { useMapFleetVehicles } from './hooks/useMapFleetVehicles';
import { useMapRepeatAddresses } from './hooks/useMapRepeatAddresses';
import { useMapPanicZone } from './hooks/useMapPanicZone';
import { useMapDaylightOverlay } from './hooks/useMapDaylightOverlay';
import { useMapCallHistory } from './hooks/useMapCallHistory';
import { useMapIncidentReports } from './hooks/useMapIncidentReports';
import PredictionsPanel from './components/PredictionsPanel';
import GeofenceManager from './components/GeofenceManager';
import { useMapThreatAssessment } from './hooks/useMapThreatAssessment';
import { useMapUnitSafety } from './hooks/useMapUnitSafety';
import { useMapPerimeter } from './hooks/useMapPerimeter';
import { useMapCorridor } from './hooks/useMapCorridor';
import { useMapEnvironment } from './hooks/useMapEnvironment';
import { useMapTactical } from './hooks/useMapTactical';
import { useMapAlerts, type SafetyAlertType } from './hooks/useMapAlerts';
import SafetyDashboardPanel from './components/SafetyDashboardPanel';
import SafetyAlertModal from './components/SafetyAlertModal';
import ThreatAssessmentPanel from './components/ThreatAssessmentPanel';
import TacticalToolsPanel, { type QuickDeployPreset } from './components/TacticalToolsPanel';
import PerimeterToolsPanel from './components/PerimeterToolsPanel';
import CorridorAnalysisPanel from './components/CorridorAnalysisPanel';
import AlertSystemPanel from './components/AlertSystemPanel';
import CallHistoryPanel from './components/CallHistoryPanel';
import HeatmapLegend from './components/HeatmapLegend';
import HeatmapPresets, { type HeatmapPresetValue } from './components/HeatmapPresets';
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp';
import RouteComparePanel from './components/RouteComparePanel';
import { useMapHotspots } from './hooks/useMapHotspots';
import { useMapDimBase } from './hooks/useMapDimBase';
import { useMapIdleZones } from './hooks/useMapIdleZones';
import { computeTrailStats, formatTrailStats, downloadTrailAsGpx } from './utils/trailStats';
import IncidentReportsPanel from './components/IncidentReportsPanel';
import SafetyZonesPanel from './components/SafetyZonesPanel';
import TacticalSummaryPanel from './components/TacticalSummaryPanel';
import AdvancedHeatmapPanel from './components/AdvancedHeatmapPanel';
import WeatherPanel from './components/WeatherPanel';
import AnalysisDashboardPanel from './components/AnalysisDashboardPanel';
import { useAnalysisSummary } from './hooks/useAnalysisSummary';
import { useSpeedAnalytics } from './hooks/useSpeedAnalytics';
import SpeedGraphOverlay from './components/SpeedGraphOverlay';
import CoverageTimeline from './components/CoverageTimeline';
import { hashToHsl } from '../../utils/colorLookup';

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

// Module-level frozen constant used as a filter default that the UI never
// updates. Module-level (not inline) so identity stays stable across renders
// — passing inline `[]` to the useMap*History/IncidentReports hooks would
// retrigger their useEffect deps every render and cause infinite refetch.
// Typed as mutable `string[]` (not `readonly`) so it satisfies the hooks'
// arg types, but Object.freeze gives runtime mutation protection anyway.
const EMPTY_STRING_FILTER: string[] = Object.freeze([] as string[]) as string[];

export default function MapPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { prefs: userPrefs } = useUserPreferences();
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
  const [mobileSheetTab, setMobileSheetTab] = useState<'layers' | 'units' | 'calls'>('layers');
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]); // AdvancedMarkerElement or OverlayView
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const heatmapLayerRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);
  const trackingLinesRef = useRef<google.maps.Polyline[]>([]);
  const [trackingLineCount, setTrackingLineCount] = useState(0);
  const useAdvancedMarkersRef = useRef(false); // whether AdvancedMarkerElement is available
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapRetry, setMapRetry] = useState(0); // bump to re-trigger Google Maps init
  const [tilesStalled, setTilesStalled] = useState(false);

  // Google Maps is the sole map surface. Any map load failure surfaces the
  // configuration-required dialog instead of degrading to a Leaflet/CartoDB
  // fallback (the offline fallback was retired 2026-04-29 to make Google
  // failures visible rather than silently masked).
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
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastDataUpdate.getTime() > dataStaleThresholdMs) {
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

  // Heat map state — overlay toggles persist across sessions so officers
  // don't have to re-enable their usual layers every shift.
  const [showHeatmap, setShowHeatmap] = usePersistedState<boolean>('rmpg_map_showHeatmap', false);
  const [showTrackingLines, setShowTrackingLines] = usePersistedState<boolean>('rmpg_map_showTrackingLines', true);
  const [heatmapData, setHeatmapData] = useState<HeatmapPoint[]>([]);
  const [heatmapDays, setHeatmapDays] = useState(30);
  const [heatmapMode, setHeatmapMode] = useState<'all' | 'risk' | 'type'>('all');
  const [heatmapTypeFilter, setHeatmapTypeFilter] = useState('');
  const [heatmapTypes, setHeatmapTypes] = useState<{ incident_type: string; count: number }[]>([]);

  // Advanced heatmap state
  const [advancedHeatmapEnabled, setAdvancedHeatmapEnabled] = useState(false);
  const [advHeatmapMode, setAdvHeatmapMode] = useState<HeatmapAdvancedMode>('density');
  const [advHeatmapTypes, setAdvHeatmapTypes] = useState<string[]>([]);
  const [advHeatmapHourRange, setAdvHeatmapHourRange] = useState<[number, number]>([0, 23]);
  const [advHeatmapDayFilter, setAdvHeatmapDayFilter] = useState<number[]>([]);
  const [advHeatmapResolution, setAdvHeatmapResolution] = useState<HeatmapResolution>('medium');
  const [advHeatmapColorScheme, setAdvHeatmapColorScheme] = useState<HeatmapColorScheme>('heat');
  const [advHeatmapOpacity, setAdvHeatmapOpacity] = useState(70);
  const [advHeatmapRadius, setAdvHeatmapRadius] = useState(30);
  const [advHeatmapShowClusters, setAdvHeatmapShowClusters] = useState(true);
  const [advHeatmapComparisonDays, setAdvHeatmapComparisonDays] = useState(30);

  const advHeatmapOptions: HeatmapAdvancedOptions = useMemo(() => ({
    enabled: advancedHeatmapEnabled && showHeatmap,
    days: heatmapDays,
    mode: advHeatmapMode,
    types: advHeatmapTypes,
    hourRange: advHeatmapHourRange,
    dayFilter: advHeatmapDayFilter,
    resolution: advHeatmapResolution,
    colorScheme: advHeatmapColorScheme,
    opacity: advHeatmapOpacity,
    radius: advHeatmapRadius,
    showClusters: advHeatmapShowClusters,
    comparisonDays: advHeatmapComparisonDays,
  }), [advancedHeatmapEnabled, showHeatmap, heatmapDays, advHeatmapMode, advHeatmapTypes, advHeatmapHourRange, advHeatmapDayFilter, advHeatmapResolution, advHeatmapColorScheme, advHeatmapOpacity, advHeatmapRadius, advHeatmapShowClusters, advHeatmapComparisonDays]);

  // Breadcrumb trail state
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(true);
  const [breadcrumbHours, setBreadcrumbHours] = useState(24);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [breadcrumbColorMode, setBreadcrumbColorMode] = useState<'unit' | 'speed' | 'status' | 'accel'>('unit');
  const breadcrumbLinesRef = useRef<google.maps.Polyline[]>([]);
  const speedAlertMarkersRef = useRef<google.maps.Marker[]>([]);

  // Speed analytics integration
  const speedAnalytics = useSpeedAnalytics({ hours: breadcrumbHours, enabled: showBreadcrumbs });

  // Trail playback state
  const [playbackTrailsRaw, setPlaybackTrailsRaw] = useState<PlaybackTrail[]>([]);

  // Breadcrumb fetch-window presets. Labels are compact per operator request
  // (24h / 48h / 7d / 14d / 21d / 1mo / 3mo / 1y). Values are hours — the
  // server /dispatch/gps/trails endpoint still takes ?hours= so upstream
  // doesn't need to change. Month = 30d, year = 365d rounded in hours.
  const BREADCRUMB_HOUR_PRESETS: ReadonlyArray<{ hours: number; label: string }> = [
    { hours: 24,   label: '24h' },
    { hours: 48,   label: '48h' },
    { hours: 168,  label: '7d' },
    { hours: 336,  label: '14d' },
    { hours: 504,  label: '21d' },
    { hours: 720,  label: '1mo' },
    { hours: 2160, label: '3mo' },
    { hours: 8760, label: '1y' },
  ];

  // Trail scrubber — lets dispatchers narrow the rendered trails to a
  // time sub-window without a re-fetch. Values are "hours ago relative to
  // now": fromH is the older edge (larger), toH is the newer edge (smaller),
  // so [fromH=8, toH=0] means "last 8h through now". Default matches
  // breadcrumbHours so the scrubber starts showing everything and the
  // dispatcher narrows from there.
  const [trailWindowFromH, setTrailWindowFromH] = useState<number>(breadcrumbHours);
  const [trailWindowToH, setTrailWindowToH] = useState<number>(0);

  // Keep the scrubber's "from" handle aligned with the fetched window —
  // if the user bumps breadcrumbHours from 8 to 24, extend the scrubber
  // range too so they can actually see the newer data.
  useEffect(() => {
    setTrailWindowFromH((prev) => (prev > breadcrumbHours ? breadcrumbHours : prev));
  }, [breadcrumbHours]);

  // Derived, window-filtered view of the trails. Render effects read this;
  // the fetch effect writes the unfiltered Raw state. Filter is cheap for
  // typical point counts (≤2k per unit), so recomputing on every scrubber
  // drag is fine — no debounce needed.
  const playbackTrails = useMemo<PlaybackTrail[]>(() => {
    if (playbackTrailsRaw.length === 0) return playbackTrailsRaw;
    const now = Date.now();
    const windowStart = now - trailWindowFromH * 3600 * 1000;
    const windowEnd = now - trailWindowToH * 3600 * 1000;
    // Fast path: default window covers everything.
    if (trailWindowFromH >= breadcrumbHours && trailWindowToH <= 0) {
      return playbackTrailsRaw;
    }
    return playbackTrailsRaw
      .map((t) => {
        const filtered = t.points.filter((p) => {
          const ts = Date.parse(p.time);
          return Number.isFinite(ts) && ts >= windowStart && ts <= windowEnd;
        });
        return { ...t, points: filtered };
      })
      .filter((t) => t.points.length > 0);
  }, [playbackTrailsRaw, trailWindowFromH, trailWindowToH, breadcrumbHours]);
  const [playbackUnit, setPlaybackUnit] = useState<number | null>(null);
  const [playbackIdx, setPlaybackIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(2);
  const playbackMarkerRef = useRef<google.maps.Marker | null>(null);
  const playbackAnimRef = useRef<number | null>(null);
  const playbackSpeedLabelRef = useRef<google.maps.InfoWindow | null>(null);

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

  // Routing
  // Multi-unit routing: when multiple units are assigned to a call, show an
  // ETA-colored polyline for each simultaneously (green=fastest, amber=mid,
  // red=slowest) so the dispatcher can see who's closest at a glance.
  // Each Route click in the call info window adds to the current set rather
  // than replacing — clicking Route on unit B while unit A is already routed
  // shows both polylines.
  const { activeRoutes, routeLoading, showRoute, clearAllRoutes, updateOrigin } =
    useMultiUnitRouting({ map: mapInstanceRef.current });

  // Auto-pan the map to newly-dispatched P1 calls so dispatchers don't miss
  // high-priority events while looking at another part of the map. Existing
  // P1s at page-load do NOT trigger a pan — only calls that arrive after
  // this mount. No-op until the Map instance is ready.
  useAutoPanToP1(mapInstanceRef.current, calls);

  // Audible chirp when a new P1 dispatches — paired with the auto-pan above
  // so dispatchers who aren't looking at the map still get cued. Defaults on;
  // user can toggle via localStorage key `rmpg_map_p1AudioEnabled`.
  const [p1AudioEnabled] = usePersistedState<boolean>('rmpg_map_p1AudioEnabled', true);
  useP1AudioAlert(calls, { enabled: p1AudioEnabled });

  // Hotspot markers — numbered red pins at the top-5 heatmap peaks. Only
  // rendered when the basic heatmap layer is on (Advanced heatmap has its
  // own built-in cluster overlay). Reuses heatmapData — no extra fetch.
  useMapHotspots({
    mapInstanceRef,
    data: heatmapData,
    enabled: showHeatmap && !advancedHeatmapEnabled,
    mode: heatmapMode === 'risk' ? 'risk' : 'calls',
    topN: 5,
  });

  // Dim-base mode: slightly darken the base tiles when the heatmap is on
  // so hot peaks pop without muting our own marker colors. Toggle persists.
  const [dimBaseEnabled, setDimBaseEnabled] = usePersistedState<boolean>('rmpg_map_dimBaseEnabled', true);
  useMapDimBase({
    mapInstanceRef,
    enabled: dimBaseEnabled && showHeatmap,
    opacity: 0.35,
  });

  // Idle-zone detection: highlight stretches >=10min where a unit stayed
  // within ~50m as orange circles. Reuses playbackTrails — pure client-side.
  const [showIdleZones, setShowIdleZones] = usePersistedState<boolean>('rmpg_map_showIdleZones', false);

  // Route comparison — pick two units from the active breadcrumb set and see
  // side-by-side stats. Visibility is session-only; IDs are not persisted
  // because their meaning depends on who's on shift right now.
  const [showRouteCompare, setShowRouteCompare] = useState(false);
  const [compareUnitA, setCompareUnitA] = useState<string | number | null>(null);
  const [compareUnitB, setCompareUnitB] = useState<string | number | null>(null);
  useMapIdleZones({
    mapInstanceRef,
    trails: playbackTrails,
    enabled: showIdleZones && showBreadcrumbs,
    minIdleSec: 600,
    clusterRadiusM: 50,
  });

  // Keyboard shortcuts: H=heatmap, B=breadcrumbs, C=cluster, P=patrol,
  // F=field interviews, D=daylight, I=incidents, E=enforcement, ?=help.
  // No-op when an input is focused or a modifier key is held.
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  useMapKeyboardShortcuts(
    {
      toggleHeatmap: () => setShowHeatmap((v) => !v),
      toggleBreadcrumbs: () => setShowBreadcrumbs((v) => !v),
      toggleClustering: () => setClusteringEnabled((v) => !v),
      togglePatrolCheckpoints: () => setShowPatrolCheckpoints((v) => !v),
      toggleFieldInterviews: () => setShowFieldInterviews((v) => !v),
      toggleDaylight: () => setShowDaylight((v) => !v),
      toggleIncidentReports: () => setShowIncidentReports((v) => !v),
      toggleEnforcementClusters: () => setShowEnforcementClusters((v) => !v),
    },
    () => setShowShortcutsHelp(true),
  );

  // Search (sidebar)
  const [searchQuery, setSearchQuery] = useState('');

  // Address search (map geocoding)
  const [addressSearch, setAddressSearch] = useState('');
  const [addressResults, setAddressResults] = useState<{ description: string; place_id: string }[]>([]);
  const [showAddressResults, setShowAddressResults] = useState(false);
  const addressSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const addressDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up address search/dismiss timers on unmount
  useEffect(() => {
    return () => {
      if (addressSearchTimer.current) clearTimeout(addressSearchTimer.current);
      if (addressDismissTimer.current) clearTimeout(addressDismissTimer.current);
    };
  }, []);

  // GPS own-position
  const gps = useGpsTracking();
  const selfMarkerRef = useRef<any>(null);

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
  const [hierarchyColors, setHierarchyColors] = useState<{
    sectionColors: Map<string, string>;
    zoneColors: Map<string, string>;
    areaColors: Map<string | number, string>;
    beatToArea: Map<string, string | number>;
  } | null>(null);
  const [tierColorsOn, setTierColorsOn] = useState<boolean>(() => {
    return localStorage.getItem('rmpg.map.hierarchyColors') !== 'off'; // default ON
  });
  useEffect(() => {
    localStorage.setItem('rmpg.map.hierarchyColors', tierColorsOn ? 'on' : 'off');
  }, [tierColorsOn]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<any[]>('/dispatch/districts').then((districts) => {
      if (cancelled || !Array.isArray(districts) || districts.length === 0) return;
      // Map is keyed by city_code (e.g. "MUR") because GeoJSON beat
      // properties carry city_code, not the server's zone_id ("SL1-MUR").
      // Inner map is keyed by district_letter ("A").
      const map = new Map<string, Map<string, BeatDistrictEntry>>();
      const sectionSet = new Map<string, string>();
      const sectionColors = new Map<string, string>();
      const zoneColors = new Map<string, string>();
      const areaColors = new Map<string | number, string>();
      const beatToArea = new Map<string, string | number>();
      for (const d of districts) {
        if (!d.zone_id || !d.beat_id) continue;
        if (d.sector_id) sectionColors.set(d.sector_id, d.sector_color || hashToHsl(d.sector_id));
        if (d.zone_id) zoneColors.set(d.zone_id, d.zone_color || hashToHsl(d.zone_id));
        if (d.area_id != null) {
          areaColors.set(d.area_id, hashToHsl(`area-${d.area_id}`));
          beatToArea.set(d.beat_id, d.area_id);
        }
        // Derive GeoJSON-shaped keys from server chart codes:
        //   zone_id "SL1-MUR" → cityCode "MUR"
        //   beat_id "SL1-MUR/A" → distLetter "A"
        const cityCode = String(d.zone_id).split('-').slice(1).join('-') || d.zone_id;
        const distLetter = String(d.beat_id).split('/').pop() || d.beat_id;
        if (!map.has(cityCode)) map.set(cityCode, new Map());
        map.get(cityCode)!.set(distLetter, {
          sectionId: d.sector_id || '',
          sectionName: d.sector_name || '',
          zoneId: d.zone_id,
          zoneName: d.zone_name || '',
          beatId: d.beat_id,
          beatName: d.beat_name || '',
          beatDescriptor: d.beat_descriptor || '',
          // dispatch_code = beat_code is already chart format ("SL1-MUR/A").
          dispatchCode: d.dispatch_code || d.beat_id || '',
        });
        if (d.sector_id) sectionSet.set(d.sector_id, d.sector_name || '');
      }
      setBeatDistrictMap(map);
      setHierarchyColors({ sectionColors, zoneColors, areaColors, beatToArea });
      setDistrictSections(Array.from(sectionSet.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id)));
    }).catch((err) => { console.warn('[MapPage] fetch districts failed:', err); });
    return () => { cancelled = true; };
  }, []);

  // GeoJSON spatial layers (with shift planning selection integration)
  const { layerStates: geoLayerStates, toggleGeoLayer, ensureLayerLoaded, configs: geoConfigs } = useGeoJsonLayers({
    map: mapInstanceRef.current,
    infoWindow: infoWindowRef.current,
    selectionMode: shiftPlanning.selectionMode,
    onFeatureClick: shiftPlanning.handleFeatureClick,
    selectedFeatures: shiftPlanning.selectedAreas,
    assignedFeatures: shiftPlanning.assignedFeatures,
    beatDistrictMap,
    hierarchyColors: tierColorsOn ? hierarchyColors : null,
  });
  const [showGeoPanel, setShowGeoPanel] = useState(false);

  // Event planning overlays
  const eventPlanning = useEventPlanning({
    map: mapInstanceRef.current,
    infoWindow: infoWindowRef.current,
  });
  const [showEventPanel, setShowEventPanel] = useState(false);
  const [newPlanName, setNewPlanName] = useState('');

  // Tactical map feature toggles
  const [showTimelapse, setShowTimelapse] = useState(false);
  const [showPredictions, setShowPredictions] = useState(false);
  const [showSafetyZones, setShowSafetyZones] = useState(false);
  const [showGeofences, setShowGeofences] = useState(false);
  const [showAnalysisDashboard, setShowAnalysisDashboard] = useState(false);
  const [dragDispatchMode, setDragDispatchMode] = useState(false);
  const [clusteringEnabled, setClusteringEnabled] = usePersistedState<boolean>('rmpg_map_clusteringEnabled', false);

  // Separate marker tracking for clustering & drag dispatch
  const unitMarkersMapRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map());
  const callMarkersMapRef = useRef<Map<string, { marker: google.maps.marker.AdvancedMarkerElement; callId: string }>>(new Map());
  const callMarkersArrayRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);

  // Intel layers
  const [intelLayers, setIntelLayers] = useState({ warrants: false, trespass: false, offenders: false, bolos: false });
  const toggleIntelLayer = (layer: 'warrants' | 'trespass' | 'offenders' | 'bolos') => {
    setIntelLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  };

  // New tactical layer toggles — persist across reload so officers don't
  // have to re-enable their usual layers every shift.
  const [showPatrolCheckpoints, setShowPatrolCheckpoints] = usePersistedState<boolean>('rmpg_map_showPatrolCheckpoints', false);
  const [showFieldInterviews, setShowFieldInterviews] = usePersistedState<boolean>('rmpg_map_showFieldInterviews', false);
  const [fiDays, setFiDays] = useState(30);
  const [showDwellTime, setShowDwellTime] = usePersistedState<boolean>('rmpg_map_showDwellTime', false);
  const [showResponseRadius, setShowResponseRadius] = usePersistedState<boolean>('rmpg_map_showResponseRadius', false);
  const [showEnforcementClusters, setShowEnforcementClusters] = usePersistedState<boolean>('rmpg_map_showEnforcementClusters', false);
  const [enforcementType, setEnforcementType] = useState<'citations' | 'arrests'>('citations');
  const [enforcementDays, setEnforcementDays] = useState(90);
  const [showCoverage, setShowCoverage] = useState(false);
  const [coverageRadius, setCoverageRadius] = useState(3);
  const [showFleetVehicles, setShowFleetVehicles] = useState(false);
  const [showRepeatAddresses, setShowRepeatAddresses] = useState(false);
  const [repeatDays, setRepeatDays] = useState(30);
  const [repeatMinCount, setRepeatMinCount] = useState(3);
  const [showPanicZone, setShowPanicZone] = useState(true); // on by default for safety
  const [showDaylight, setShowDaylight] = usePersistedState<boolean>('rmpg_map_showDaylight', false);

  // Historical call & incident report layers
  const [showCallHistory, setShowCallHistory] = useState(false);
  const [callHistoryDays, setCallHistoryDays] = useState(7);
  const [callHistoryStatuses, setCallHistoryStatuses] = useState(['cleared', 'closed']);
  // callHistoryTypes / incidentStatuses / incidentTypes were useState<string[]>([])
  // declarations that never got a setter call anywhere — they're effectively
  // constant filter defaults. Pinned to the module-level frozen constant so
  // identity stays stable across renders (preventing useEffect dep churn in
  // the consuming hooks).
  const callHistoryTypes = EMPTY_STRING_FILTER;
  const [callHistoryPriorities, setCallHistoryPriorities] = useState<string[]>([]);
  const [showIncidentReports, setShowIncidentReports] = usePersistedState<boolean>('rmpg_map_showIncidentReports', false);
  const [incidentDays, setIncidentDays] = useState(30);
  const incidentStatuses = EMPTY_STRING_FILTER;
  const incidentTypes = EMPTY_STRING_FILTER;

  // Officer Safety System
  const [showSafetyDashboard, setShowSafetyDashboard] = useState(false);
  const [showSafetyAlertModal, setShowSafetyAlertModal] = useState(false);
  const [showThreatAssessment, setShowThreatAssessment] = useState(false);
  const [showUnitMonitoring, setShowUnitMonitoring] = useState(false);
  const [showPerimeterTools, setShowPerimeterTools] = useState(false);
  const [showCorridorAnalysis, setShowCorridorAnalysis] = useState(false);
  const [showEnvironmentInfo, setShowEnvironmentInfo] = useState(false);
  const [showTacticalTools, setShowTacticalTools] = useState(false);
  const [showAlertSystem, setShowAlertSystem] = useState(false);

  // Tactical map hooks
  const timelapse = useMapHeatmapTimelapse(mapInstanceRef.current, showTimelapse && showHeatmap && !advancedHeatmapEnabled, heatmapDays, heatmapMode as 'all' | 'risk');
  const advancedHeatmap = useMapHeatmapAdvanced(mapInstanceRef.current, advHeatmapOptions);
  const predictions = useMapPredictions(mapInstanceRef.current, showPredictions);
  const intelLayerData = useMapIntelLayers(mapInstanceRef.current, intelLayers);
  const safetyZones = useMapSafetyZones(mapInstanceRef.current, showSafetyZones);
  const handleGeofenceAlert = useCallback((alert: GeofenceAlert) => {
    const verb = alert.eventType === 'enter' ? 'entered' : 'exited';
    addToast(`${alert.unitCallSign} ${verb} ${alert.geofenceName}`, alert.eventType === 'enter' ? 'warning' : 'info');
  }, [addToast]);
  const geofences = useMapGeofences(mapInstanceRef.current, showGeofences, { onAlert: handleGeofenceAlert });
  const analysisSummary = useAnalysisSummary(showAnalysisDashboard);
  // Traffic layer
  const { showTraffic, toggleTraffic } = useMapTrafficLayer();

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
  const fieldInterviews = useMapFieldInterviews(mapInstanceRef.current, showFieldInterviews, fiDays);
  const dwellTime = useMapDwellTime(mapInstanceRef.current, units as Parameters<typeof useMapDwellTime>[1], showDwellTime);
  const responseRadius = useMapResponseRadius(mapInstanceRef.current, showResponseRadius);
  const enforcementClusters = useMapEnforcementClusters(mapInstanceRef.current, showEnforcementClusters, enforcementType, enforcementDays);
  const coverageGaps = useMapCoverageGaps(mapInstanceRef.current, units as Parameters<typeof useMapCoverageGaps>[1], showCoverage, coverageRadius);
  const fleetVehicles = useMapFleetVehicles(mapInstanceRef.current, showFleetVehicles);
  const repeatAddresses = useMapRepeatAddresses(mapInstanceRef.current, showRepeatAddresses, repeatDays, repeatMinCount);
  const panicZone = useMapPanicZone(mapInstanceRef.current, showPanicZone);
  const daylight = useMapDaylightOverlay(mapInstanceRef.current, showDaylight);

  // Historical call & incident report hooks
  const callHistory = useMapCallHistory({
    map: mapInstanceRef.current,
    enabled: showCallHistory,
    days: callHistoryDays,
    statuses: callHistoryStatuses,
    types: callHistoryTypes,
    priorities: callHistoryPriorities,
  });
  const incidentReports = useMapIncidentReports({
    map: mapInstanceRef.current,
    enabled: showIncidentReports,
    days: incidentDays,
    statuses: incidentStatuses,
    types: incidentTypes,
  });

  // Officer Safety hooks
  const threatAssessment = useMapThreatAssessment(mapInstanceRef.current, showThreatAssessment);
  const unitSafety = useMapUnitSafety(mapInstanceRef.current, showUnitMonitoring);
  const perimeter = useMapPerimeter(mapInstanceRef.current, showPerimeterTools);
  const corridor = useMapCorridor(mapInstanceRef.current, showCorridorAnalysis);
  const environment = useMapEnvironment(mapInstanceRef.current, showEnvironmentInfo);
  const tactical = useMapTactical(mapInstanceRef.current);
  const alerts = useMapAlerts(mapInstanceRef.current);

  // Geofence alerts — show toast when triggered
  useEffect(() => {
    if (!geofences.alerts?.length) return;
    const latest = geofences.alerts[geofences.alerts.length - 1];
    if (latest) {
      addToast(`Geofence: ${latest.unitCallSign} ${latest.eventType} ${latest.geofenceName}`, 'warning');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geofences.alerts.length, addToast]);

  // Shift risk data for safety dashboard
  const [shiftRisk, setShiftRisk] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    if (!showSafetyDashboard) return;
    let cancelled = false;
    const fetchShiftRisk = async () => {
      try {
        const data = await apiFetch('/map/safety/shift-risk-summary');
        if (!cancelled) setShiftRisk(data as Record<string, any> | null);
      } catch { /* non-critical */ }
    };
    fetchShiftRisk();
    const iv = setInterval(fetchShiftRisk, 60000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [showSafetyDashboard]);

  // Safety alert toasts
  useEffect(() => {
    if (alerts.activeAlerts && alerts.activeAlerts.length > 0) {
      const latest = alerts.activeAlerts[alerts.activeAlerts.length - 1];
      if (latest && !latest.acknowledged) {
        addToast(`SAFETY ALERT: ${latest.type.replace(/_/g, ' ').toUpperCase()} — ${latest.details || 'No details'}`, 'error', 15000);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts.activeAlerts?.length, addToast]);

  // ============================================================
  // Data Fetching
  // ============================================================

  const fetchUnits = useCallback(async () => {
    try {
      const data = await apiFetch<Unit[]>('/dispatch/units');
      setUnits(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching units:', err);
      setError('Failed to load units');
    }
  }, []);

  const fetchCalls = useCallback(async () => {
    try {
      const data = await apiFetch<ActiveCall[]>('/dispatch/queue');
      setCalls(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching calls:', err);
      setError('Failed to load active calls');
    }
  }, []);

  const fetchProperties = useCallback(async () => {
    try {
      const data = await apiFetch<Property[]>('/records/properties');
      setProperties(Array.isArray(data) ? data : []);
    } catch (err) {
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

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(() => { fetchAllData({ silent: true }); }, 30000);
    return () => clearInterval(interval);
  }, [fetchAllData]);

  // Live sync — auto-refresh map when dispatch data changes from any device (silent to avoid unmounting UI)
  const silentRefreshMap = useCallback(() => fetchAllData({ silent: true }), [fetchAllData]);
  useLiveSync('dispatch', silentRefreshMap);

  // ============================================================
  // WebSocket Subscriptions
  // ============================================================

  useEffect(() => {
    const unsubscribeUnit = subscribe('unit_update', (msg: any) => {
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
    const unsubscribeCall = subscribe('dispatch_update', (msg: any) => {
      const evtData = msg.data || msg;
      if (evtData && evtData.call) {
        setCalls((prev) => {
          const index = prev.findIndex((c) => c.id === evtData.call.id);
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = { ...updated[index], ...evtData.call };
            if (evtData.call.status === 'closed' || evtData.call.status === 'completed') {
              return updated.filter((c) => c.id !== evtData.call.id);
            }
            return updated;
          }
          if (evtData.call.status !== 'closed' && evtData.call.status !== 'completed') {
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
    if (!showHeatmap || advancedHeatmapEnabled) { setHeatmapData([]); return; }
    let cancelled = false;
    let url = `/dispatch/heatmap?days=${heatmapDays}&mode=${heatmapMode}`;
    if (heatmapMode === 'type' && heatmapTypeFilter) url += `&type=${encodeURIComponent(heatmapTypeFilter)}`;
    apiFetch<HeatmapPoint[]>(url)
      .then((data) => { if (!cancelled) setHeatmapData(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setHeatmapData([]); });
    return () => { cancelled = true; };
  }, [showHeatmap, heatmapDays, heatmapMode, heatmapTypeFilter, advancedHeatmapEnabled]);

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
  // Google Maps Initialization
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

    // Register Google's official auth-failure callback BEFORE loading the script.
    // Google calls window.gm_authFailure() when the API key is invalid, billing
    // is not enabled, or the Maps JavaScript API is not turned on.
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

    // Load Google Maps via direct script tag (more reliable than js-api-loader).
    // Auto-retry with exponential backoff if the script fails to load
    // (e.g. server restart, brief network blip, slow vehicle WiFi).
    const MAX_RETRIES = 8;
    const RETRY_DELAYS = [2000, 4000, 8000, 12000, 16000, 20000, 25000, 30000]; // ms
    let dismissObserver: MutationObserver | null = null;
    let dismissTimer: ReturnType<typeof setTimeout> | null = null;

    function initMap(apiKey: string) {
      if (!mapRef.current || authFailed || cancelled) return;
      if (mapInstanceRef.current) { setMapLoaded(true); return; }

      // Fix 31: restore map center/zoom from localStorage
      let savedCenter = DEFAULT_CENTER;
      let savedZoom = 12;
      try {
        const sc = localStorage.getItem('rmpg_map_center');
        const sz = localStorage.getItem('rmpg_map_zoom');
        if (sc) savedCenter = JSON.parse(sc);
        if (sz) savedZoom = parseInt(sz, 10) || 12;
      } catch { /* use defaults */ }

      const map = new google.maps.Map(mapRef.current, {
        center: savedCenter,
        zoom: savedZoom,
        disableDefaultUI: true,
        zoomControl: false,
        styles: DARK_MAP_STYLE,
        backgroundColor: '#171717',
        // 'greedy' allows single-finger pan on mobile/tablet — critical for
        // in-vehicle use where two-finger gestures are awkward while driving.
        gestureHandling: 'greedy',
      });

      // Auth/quota failure can hand back a stub Map with no div — route to the
      // existing error UI instead of crashing in monitorTileLoading.
      if (!map || typeof map.getDiv !== 'function' || !map.getDiv()) {
        setMapError('Google Maps failed to initialize — check API key / billing.');
        return;
      }

      mapInstanceRef.current = map;
      registerMapInstance(map);

      // Fix 30: save map center/zoom to localStorage on idle
      map.addListener('idle', () => {
        try {
          const c = map.getCenter();
          const z = map.getZoom();
          if (c && z != null) {
            localStorage.setItem('rmpg_map_center', JSON.stringify({ lat: c.lat(), lng: c.lng() }));
            localStorage.setItem('rmpg_map_zoom', String(z));
          }
        } catch { /* quota exceeded */ }
      });

      infoWindowRef.current = new google.maps.InfoWindow();

      // Hide Google's dismissible "can't load correctly" dialog instantly.
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

      // Google's native dark-styled basemap is the sole tile source
      // (no CartoDB raster overlay). AdvancedMarkerElement requires a
      // cloud mapId; without one, markers are created but never render,
      // so we keep the OverlayView-based fallback which works on any
      // map type until a mapId is provisioned.
      useAdvancedMarkersRef.current = false;
      devLog('[MapPage] Using Google base layer + OverlayView markers');

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

    function attemptLoad(apiKey: string, attempt: number) {
      if (cancelled) return;

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

      loadGoogleMaps(apiKey)
        .then(() => initMap(apiKey))
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

    (async () => {
      let apiKey = '';
      try {
        apiKey = await getGoogleMapsApiKey();
      } catch (err: any) {
        // No Google API key — surface the configuration-required dialog.
        if (!cancelled) {
          setMapError(err?.message || 'Google Maps API key is not configured. Set it in Admin → Integrations → Google Cloud Console.');
        }
        return;
      }

      if (cancelled) return;
      attemptLoad(apiKey, 0);

      // Auto-retry when device comes back online (covers the case where all retries
      // exhausted during a dead zone, then WiFi reconnects while the error screen is showing)
      unsubOnline = onOnlineRetryMaps(apiKey, () => {
        if (!cancelled && !mapInstanceRef.current) {
          devLog('[MapPage] Online auto-retry triggered — reinitializing map');
          setMapError(null);
          initMap(apiKey);
        }
      });
    })();

    return () => {
      cancelled = true; // Stop any pending retries
      unsubOnline();
      if (dismissTimer) clearTimeout(dismissTimer);
      if (dismissObserver) dismissObserver.disconnect();
      if (tileMonitorCleanupRef.current) { tileMonitorCleanupRef.current(); tileMonitorCleanupRef.current = null; }
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

  // ============================================================
  // Switch Map Style
  // ============================================================

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

  // ============================================================
  // Update Markers
  // ============================================================

  // Helper: create a marker using AdvancedMarkerElement or OverlayView fallback
  const createMarker = useCallback((opts: {
    map: google.maps.Map;
    position: google.maps.LatLngLiteral;
    content: HTMLElement;
    zIndex?: number;
    title?: string;
    onClick?: () => void;
  }): any => {
    if (useAdvancedMarkersRef.current) {
      try {
        const marker = new google.maps.marker.AdvancedMarkerElement({
          map: opts.map,
          position: opts.position,
          content: opts.content,
          zIndex: opts.zIndex,
          title: opts.title,
        });
        if (opts.onClick) marker.addListener('click', opts.onClick);
        return marker;
      } catch {
        // Fall through to overlay
      }
    }
    // Fallback: OverlayView-based marker
    const Cls = getOverlayMarkerClass();
    if (!Cls) return null as any;
    return new Cls(opts);
  }, []);

  // Helper: remove a marker (works for both types)
  const removeMarker = useCallback((m: any) => {
    if (m && typeof m.remove === 'function') m.remove();
    else if (m) m.map = null;
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    // Clear existing markers
    markersRef.current.forEach((m) => removeMarker(m));
    markersRef.current = [];
    unitMarkersMapRef.current.clear();
    callMarkersMapRef.current.clear();
    callMarkersArrayRef.current = [];
    infoWindowRef.current?.close();

    // Add unit markers
    if (layers.units) {
      units.forEach((unit) => {
        if (unit.latitude != null && unit.longitude != null) {
          const content = buildUnitMarkerContent(unit.call_sign, unit.status, unit.gps_source);
          const statusColor = UNIT_STATUS_COLORS[unit.status];
          const location = unit.current_call_location || 'No active assignment';

          const marker = createMarker({
            map,
            position: { lat: unit.latitude, lng: unit.longitude },
            content,
            zIndex: 1000,
            title: `${unit.call_sign} - ${unit.officer_name}`,
            onClick: () => {
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

              infoWindowRef.current?.setContent(`
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
              infoWindowRef.current?.setPosition({ lat: unit.latitude!, lng: unit.longitude! });
              infoWindowRef.current?.open(map);
            },
          });

          markersRef.current.push(marker);
          if (marker) unitMarkersMapRef.current.set(String(unit.id), marker);
        }
      });
    }

    // Add incident markers
    if (layers.incidents) {
      calls.forEach((call) => {
        if (call.latitude != null && call.longitude != null) {
          const content = buildIncidentMarkerContent(call.priority, call.incident_type, call.call_number);
          const pColor = PRIORITY_COLORS[call.priority] || '#666666';

          const marker = createMarker({
            map,
            position: { lat: call.latitude, lng: call.longitude },
            content,
            zIndex: call.priority === 'P1' ? 2000 : 500,
            title: `${call.call_number} - ${formatIncidentType(call.incident_type)}`,
            onClick: () => {
              const assignedUnits = units.filter(u => String(u.current_call_id) === String(call.id));
              // Compute the 3 nearest units with GPS that are NOT already
              // assigned to this call. Straight-line haversine — cheap enough
              // to recompute on every info-window open (unit count is small).
              // This intentionally ignores unit status: the dispatcher can see
              // the status dot and make their own call on whether an on-break
              // unit can roll. "Closest by road" would require Directions
              // calls per unit — too expensive for a tap-to-preview panel.
              const assignedIds = new Set(assignedUnits.map(u => String(u.id)));
              const nearestUnits = (call.latitude != null && call.longitude != null)
                ? units
                    .filter(u => !assignedIds.has(String(u.id)) && u.latitude != null && u.longitude != null)
                    .map(u => {
                      const dLat = ((u.latitude! - call.latitude!) * Math.PI) / 180;
                      const dLng = ((u.longitude! - call.longitude!) * Math.PI) / 180;
                      const a = Math.sin(dLat / 2) ** 2
                        + Math.cos((u.latitude! * Math.PI) / 180)
                        * Math.cos((call.latitude! * Math.PI) / 180)
                        * Math.sin(dLng / 2) ** 2;
                      const meters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                      return { unit: u, meters };
                    })
                    .sort((a, b) => a.meters - b.meters)
                    .slice(0, 3)
                : [];

              let nearestHtml = '';
              if (nearestUnits.length > 0) {
                nearestHtml = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #2b2b2b;">
                  <div style="font-size:9px;color:#5a6e80;margin-bottom:4px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">NEAREST UNITS</div>
                  ${nearestUnits.map(({ unit: u, meters }) => {
                    const uc = UNIT_STATUS_COLORS[u.status] || '#666666';
                    const miles = (meters / 1609.344).toFixed(1);
                    const routeBtn = (call.latitude != null && call.longitude != null)
                      ? `<button type="button" data-route-unit="${escapeHtml(u.call_sign)}" data-route-call="${escapeHtml(call.call_number)}"
                           data-route-ulat="${u.latitude}" data-route-ulng="${u.longitude}"
                           data-route-clat="${call.latitude}" data-route-clng="${call.longitude}"
                           style="margin-left:auto;padding:1px 5px;background:#88888820;border:1px solid #88888850;color:#a0a0a0;font-size:8px;font-weight:900;font-family:monospace;cursor:pointer;">
                           ▶ ROUTE
                         </button>`
                      : '';
                    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                      <div style="width:6px;height:6px;border-radius:50%;background:${uc};box-shadow:0 0 4px ${uc}80;"></div>
                      <span style="font-size:10px;color:${uc};font-weight:bold;font-family:monospace;">${escapeHtml(u.call_sign)}</span>
                      <span style="font-size:9px;color:#9ca3af;">${escapeHtml(u.officer_name || '')}</span>
                      <span style="font-size:9px;color:#6b7280;">${miles} mi</span>
                      ${routeBtn}
                    </div>`;
                  }).join('')}
                </div>`;
              }

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
                           title="${isAndroidNative() ? 'Open in Organic Maps' : 'Open Google Maps directions'}"
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

              // ── Time received ("5m ago" / "1h 12m ago" / "now") ──
              const receivedMs = call.created_at ? new Date(call.created_at).getTime() : NaN;
              const ageSec = !isNaN(receivedMs) ? Math.max(0, Math.floor((Date.now() - receivedMs) / 1000)) : null;
              const ageStr = ageSec == null ? '—'
                : ageSec < 60 ? `${ageSec}s ago`
                : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m ago`
                : ageSec < 86400 ? `${Math.floor(ageSec / 3600)}h ${Math.floor((ageSec % 3600) / 60)}m ago`
                : `${Math.floor(ageSec / 86400)}d ago`;
              const receivedTime = !isNaN(receivedMs)
                ? new Date(receivedMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                : '';

              // ── Hazard / officer-safety flags (aggregate into one red banner) ──
              const hazardFlags: string[] = [];
              if (call.officer_safety_caution) hazardFlags.push('OFFICER SAFETY');
              if (call.weapons_involved) hazardFlags.push(`WEAPONS: ${escapeHtml(String(call.weapons_involved))}`);
              if (call.felony_in_progress) hazardFlags.push('FELONY IN PROGRESS');
              if (call.domestic_violence) hazardFlags.push('DOMESTIC');
              if (call.hazmat) hazardFlags.push('HAZMAT');
              if (call.mental_health_crisis) hazardFlags.push('MENTAL HEALTH CRISIS');
              if (call.gang_related) hazardFlags.push('GANG');
              const hazardHtml = hazardFlags.length > 0
                ? `<div style="margin-top:8px;padding:6px 8px;background:#7f1d1d33;border-left:3px solid #ef4444;font-size:9px;font-weight:900;color:#fca5a5;letter-spacing:0.5px;">
                     ⚠ ${hazardFlags.join(' · ')}
                   </div>`
                : '';

              // ── Beat / Sector geography ──
              const geographyHtml = (call.beat_name || call.sector_name)
                ? `<div style="margin-top:6px;font-size:9px;color:#9ca3af;font-family:monospace;">
                     ${call.beat_name ? `BEAT <span style="color:#d4a017;font-weight:bold;">${escapeHtml(call.beat_name)}</span>` : ''}
                     ${call.beat_name && call.sector_name ? '<span style="color:#3a3a3a;margin:0 6px;">|</span>' : ''}
                     ${call.sector_name ? `SECTOR <span style="color:#d4a017;font-weight:bold;">${escapeHtml(call.sector_name)}</span>` : ''}
                   </div>`
                : '';

              // ── Cross-street / notes line ──
              const crossHtml = call.cross_street
                ? `<div style="font-size:9px;margin-top:3px;color:#9ca3af;font-family:monospace;">↳ Cross: ${escapeHtml(call.cross_street)}</div>`
                : '';

              // ── Status pill color ──
              const statusColors: Record<string, string> = {
                pending: '#facc15', dispatched: '#06b6d4', enroute: '#06b6d4',
                onscene: '#10b981', cleared: '#888888', closed: '#5a5a5a',
              };
              const statusKey = call.status.toLowerCase().replace(/_/g, '');
              const statusBg = statusColors[statusKey] || '#888888';

              infoWindowRef.current?.setContent(`
                <div style="min-width:280px;max-width:340px;font-family:'JetBrains Mono','Courier New',monospace;background:#0a0a0a;color:#e5e7eb;padding:0;border:1px solid ${pColor}60;border-radius:2px;overflow:hidden;">
                  <!-- Header row: priority + call number + status + age -->
                  <div style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:linear-gradient(180deg,#141414 0%,#0a0a0a 100%);border-bottom:1px solid ${pColor}33;">
                    <span style="background:${pColor};color:#000;padding:2px 7px;font-size:10px;font-weight:900;letter-spacing:0.5px;border-radius:2px;">${escapeHtml(call.priority)}</span>
                    <span style="font-size:11px;color:#d4a017;font-weight:bold;flex:1;">${escapeHtml(call.call_number)}</span>
                    <span style="background:${statusBg}22;border:1px solid ${statusBg}66;color:${statusBg};padding:1px 6px;font-size:8px;font-weight:900;letter-spacing:1px;border-radius:2px;text-transform:uppercase;">${escapeHtml(call.status.replace(/_/g, ' '))}</span>
                  </div>
                  <div style="padding:8px 10px 4px 10px;">
                    <!-- Incident type -->
                    <div style="font-size:12px;font-weight:bold;color:${pColor};margin-bottom:6px;letter-spacing:0.3px;">${escapeHtml(formatIncidentType(call.incident_type))}</div>
                    <!-- Address + cross-street -->
                    <div style="font-size:10px;color:#d1d5db;line-height:1.4;">\u{1F4CD} ${escapeHtml(call.location_address)}</div>
                    ${crossHtml}
                    ${call.property_name ? `<div style="font-size:9px;margin-top:3px;color:#9ca3af;">\u{1F3E2} ${escapeHtml(call.property_name)}</div>` : ''}
                    <!-- Beat / Sector -->
                    ${geographyHtml}
                    <!-- Time received -->
                    <div style="margin-top:6px;font-size:9px;color:#9ca3af;font-family:monospace;display:flex;align-items:center;gap:8px;">
                      <span>\u{23F1} <span style="color:#d4a017;font-weight:bold;">${ageStr}</span></span>
                      <span style="color:#3a3a3a;">|</span>
                      <span style="color:#5a6e80;">${receivedTime}</span>
                    </div>
                  </div>
                  ${hazardHtml}
                  <div style="padding:0 10px 10px 10px;">
                    ${unitsHtml}
                    ${nearestHtml}
                  </div>
                </div>
              `);
              infoWindowRef.current?.setPosition({ lat: call.latitude!, lng: call.longitude! });
              infoWindowRef.current?.open(map);
            },
          });

          markersRef.current.push(marker);
          if (marker) {
            callMarkersMapRef.current.set(String(call.id), { marker, callId: String(call.id) });
            callMarkersArrayRef.current.push(marker);
          }
        }
      });
    }

    // Add property markers (small dot with hover tooltip, click for details)
    if (layers.properties) {
      properties.forEach((prop) => {
        if (prop.latitude != null && prop.longitude != null) {
          const content = buildPropertyMarkerContent(prop.name, prop.address, prop.client_name || undefined);

          const marker = createMarker({
            map,
            position: { lat: prop.latitude, lng: prop.longitude },
            content,
            zIndex: 100,
            title: prop.name,
            onClick: async () => {
              // Show loading state immediately
              infoWindowRef.current?.setContent(`
                <div style="min-width:200px;font-family:'JetBrains Mono',monospace;background:#0c0c0c;color:#e5e7eb;padding:12px;border:1px solid #88888850;border-radius:4px;">
                  <div style="font-weight:900;font-size:13px;color:#a0a0a0;margin-bottom:4px;">${escapeHtml(prop.name)}</div>
                  <div style="font-size:10px;color:#9ca3af;">Loading details...</div>
                </div>
              `);
              infoWindowRef.current?.setPosition({ lat: prop.latitude!, lng: prop.longitude! });
              infoWindowRef.current?.open(map);

              // Fetch full property details (includes recent calls, contacts, schedules)
              try {
                const details = await apiFetch<any>(`/records/properties/${prop.id}`);
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
                  const date = c.created_at ? new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                  const time = c.created_at ? new Date(c.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
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

                infoWindowRef.current?.setContent(`
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
                console.error('[MapPage] Failed to fetch property details:', err);
                // If fetch fails, show basic info
                infoWindowRef.current?.setContent(`
                  <div style="min-width:160px;font-family:'JetBrains Mono',monospace;background:#0c0c0c;color:#e5e7eb;padding:10px;border:1px solid #88888850;border-radius:4px;">
                    <div style="font-weight:900;font-size:13px;color:#a0a0a0;margin-bottom:4px;">${escapeHtml(prop.name)}</div>
                    <div style="font-size:10px;color:#d1d5db;">${escapeHtml(prop.address)}</div>
                    ${prop.client_name ? `<div style="font-size:9px;margin-top:6px;color:#d4a017;font-weight:600;">Client: ${escapeHtml(prop.client_name)}</div>` : ''}
                  </div>
                `);
              }
            },
          });

          markersRef.current.push(marker);
        }
      });
    }
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
        infoWindowRef.current?.close();
      }
    }
    document.addEventListener('click', handleRouteClick);
    return () => document.removeEventListener('click', handleRouteClick);
  }, [showRoute]);

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
      infoWindowRef.current?.close();
    }
    document.addEventListener('click', handleOmClick);
    return () => document.removeEventListener('click', handleOmClick);
  }, []);

  // ============================================================
  // Update Routes When Routed Unit GPS Changes (multi-unit)
  // ============================================================

  useEffect(() => {
    if (activeRoutes.length === 0) return;
    for (const route of activeRoutes) {
      const routedUnit = units.find(u => u.call_sign === route.unitCallSign);
      if (routedUnit?.latitude != null && routedUnit?.longitude != null) {
        updateOrigin(route.unitCallSign, routedUnit.latitude, routedUnit.longitude);
      }
    }
  }, [activeRoutes, units, updateOrigin]);

  // ============================================================
  // Heat Map Circles
  // ============================================================

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    // Remove existing heatmap layer
    if (heatmapLayerRef.current) {
      heatmapLayerRef.current.setMap(null);
      heatmapLayerRef.current = null;
    }

    // Skip basic heatmap rendering when advanced heatmap is active (it manages its own layers)
    if (!showHeatmap || heatmapData.length === 0 || advancedHeatmapEnabled) return;

    // Fix 9: guard for missing visualization library
    if (!google.maps.visualization?.HeatmapLayer) {
      console.warn('[MapPage] google.maps.visualization.HeatmapLayer not available');
      return;
    }

    // Build weighted data points for HeatmapLayer
    const weightedData = heatmapData
      // Fix 11: validate heatmap data points have finite lat/lng
      .filter((p: any) => p.latitude != null && p.longitude != null && isFinite(p.latitude) && isFinite(p.longitude))
      // Fix 12: cap heatmap points at 10000
      .slice(0, 10000)
      .map((point: any) => ({
        location: new google.maps.LatLng(point.latitude, point.longitude),
        weight: heatmapMode === 'risk' ? (point.risk_weight || point.count || 1) : (point.count || 1),
      }));

    // Choose gradient based on mode (Fix 14: dark-theme compatible colors)
    const gradient = heatmapMode === 'risk'
      ? [
          'rgba(0,0,0,0)',        // transparent
          'rgba(255,165,0,0.3)',  // orange low
          'rgba(255,100,0,0.5)',  // deep orange
          'rgba(255,50,0,0.7)',   // red-orange
          'rgba(255,0,0,0.85)',   // red
          'rgba(200,0,0,1)',      // dark red
        ]
      : [
          'rgba(0,0,0,0)',
          'rgba(0,128,255,0.2)',  // blue low
          'rgba(0,200,100,0.4)', // green
          'rgba(200,200,0,0.6)', // yellow
          'rgba(255,140,0,0.8)', // orange
          'rgba(255,50,0,0.95)', // red high
        ];

    try { // Fix 10: try/catch around heatmap creation
      // ── Visual: heatmap as soft haze, not hard rings ──
      // Smaller radius + lower opacity + maxIntensity ceiling collapses the
      // per-point bright halos that read as "circles" at typical zoom. The
      // gradient still conveys density; it just doesn't bloom into discs.
      const heatmap = new google.maps.visualization.HeatmapLayer({
        data: weightedData,
        map,
        radius: 14,
        opacity: 0.28,
        gradient,
        dissipating: true,
        maxIntensity: 8,
      });

      heatmapLayerRef.current = heatmap;
    } catch (err) {
      console.warn('[MapPage] Error creating heatmap layer:', err);
    }

    return () => {
      if (heatmapLayerRef.current) {
        heatmapLayerRef.current.setMap(null);
        heatmapLayerRef.current = null;
      }
    };
  }, [showHeatmap, heatmapData, heatmapMode, mapLoaded, advancedHeatmapEnabled]);

  // ============================================================
  // Unit-to-Call Tracking Lines
  // ============================================================

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    // Clear existing lines
    trackingLinesRef.current.forEach((line) => line.setMap(null));
    trackingLinesRef.current = [];
    setTrackingLineCount(0);

    if (!showTrackingLines) return;

    // Draw lines from each dispatched/enroute/onscene unit to their assigned call
    units.forEach((unit) => {
      if (unit.latitude == null || unit.longitude == null) return;
      if (!unit.current_call_id) return;
      if (!CLEARABLE_STATUSES.includes(unit.status)) return;
      // Fix 19: validate unit has finite coordinates
      if (!isFinite(unit.latitude) || !isFinite(unit.longitude)) return;

      // Find the call this unit is assigned to
      const call = calls.find((c) => String(c.id) === String(unit.current_call_id));
      if (!call || call.latitude == null || call.longitude == null) return;
      // Fix 19: validate call has finite coordinates
      if (!isFinite(call.latitude) || !isFinite(call.longitude)) return;

      // Fix 21: skip zero-length lines
      if (unit.latitude === call.latitude && unit.longitude === call.longitude) return;

      const statusColor = UNIT_STATUS_COLORS[unit.status] || '#666666';
      const isDashed = unit.status === 'dispatched';

      try { // Fix 20: try/catch around Polyline creation
      const line = new google.maps.Polyline({
        path: [
          { lat: unit.latitude, lng: unit.longitude },
          { lat: call.latitude, lng: call.longitude },
        ],
        geodesic: true,
        strokeColor: statusColor,
        strokeOpacity: isDashed ? 0 : 0.6,
        strokeWeight: 2,
        icons: isDashed ? [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.6, strokeWeight: 2, scale: 3 },
          offset: '0',
          repeat: '15px',
        }] : undefined,
        map,
      });

      trackingLinesRef.current.push(line);
      } catch (err) {
        console.warn('[MapPage] Error creating tracking line:', err);
      }
    });
    setTrackingLineCount(trackingLinesRef.current.length);
  }, [units, calls, showTrackingLines, mapLoaded]);

  // ============================================================
  // GPS Breadcrumb Trails (enhanced: color modes, arrows, road names, playback)
  // ============================================================

  const breadcrumbMarkersRef = useRef<google.maps.Circle[]>([]);
  const breadcrumbArrowsRef = useRef<google.maps.Marker[]>([]);
  const breadcrumbInfoRef = useRef<google.maps.InfoWindow | null>(null);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    // Clear existing breadcrumb visuals
    breadcrumbLinesRef.current.forEach((line) => line.setMap(null));
    breadcrumbLinesRef.current = [];
    breadcrumbMarkersRef.current.forEach((m) => m.setMap(null));
    breadcrumbMarkersRef.current = [];
    breadcrumbArrowsRef.current.forEach((a) => a.setMap(null));
    breadcrumbArrowsRef.current = [];
    speedAlertMarkersRef.current.forEach((m) => m.setMap(null));
    speedAlertMarkersRef.current = [];

    if (!showBreadcrumbs) { setPlaybackTrailsRaw([]); return; }

    const token = localStorage.getItem('rmpg_token');
    if (!token) return;

    if (!breadcrumbInfoRef.current) {
      breadcrumbInfoRef.current = new google.maps.InfoWindow();
    }

    const formatSpeedMph = (mps: number | null) => mps == null ? '—' : `${(mps * 2.237).toFixed(0)} mph`;
    const formatHeadingDir = (deg: number | null) => {
      if (deg == null) return '—';
      const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      return dirs[Math.round(deg / 45) % 8] + ` (${Math.round(deg)}°)`;
    };
    const STATUS_LABELS: Record<string, string> = {
      available: 'AVAILABLE', dispatched: 'DISPATCHED', enroute: 'ENROUTE',
      onscene: 'ON SCENE', busy: 'BUSY', off_duty: 'OFF DUTY',
    };

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
      breadcrumbLinesRef.current.forEach((l) => l.setMap(null));
      breadcrumbLinesRef.current = [];
      breadcrumbMarkersRef.current.forEach((m) => m.setMap(null));
      breadcrumbMarkersRef.current = [];
      breadcrumbArrowsRef.current.forEach((a) => a.setMap(null));
      breadcrumbArrowsRef.current = [];
      speedAlertMarkersRef.current.forEach((m) => m.setMap(null));
      speedAlertMarkersRef.current = [];

      try {
        const trails = await apiFetch<Trail[]>(`/dispatch/gps/trails?hours=${breadcrumbHours}`);
        if (!trails) return;
        setPlaybackTrailsRaw(trails);

        trails.forEach((trail, idx) => {
          if (trail.points.length === 0) return;

          const unitColor = TRAIL_COLORS[idx % TRAIL_COLORS.length];

          // Draw segments with color mode
          for (let i = 0; i < trail.points.length - 1; i++) {
            const p1 = trail.points[i];
            const p2 = trail.points[i + 1];
            const freshness = (i + 1) / trail.points.length;
            const opacity = 0.25 + freshness * 0.6;

            let segColor: string;
            if (breadcrumbColorMode === 'speed') {
              segColor = speedToColor(p1.speed);
            } else if (breadcrumbColorMode === 'status') {
              segColor = statusToColor(p1.status);
            } else if (breadcrumbColorMode === 'accel') {
              // Compute inline acceleration between consecutive points
              const dt = (new Date(p2.time).getTime() - new Date(p1.time).getTime()) / 1000;
              if (dt > 0 && p1.speed != null && p2.speed != null) {
                const accel = (p2.speed - p1.speed) / dt;
                segColor = accelToColor(accel);
              } else {
                segColor = accelToColor(null);
              }
            } else {
              segColor = unitColor;
            }

            const seg = new google.maps.Polyline({
              path: [{ lat: p1.lat, lng: p1.lng }, { lat: p2.lat, lng: p2.lng }],
              geodesic: true,
              strokeColor: segColor,
              strokeOpacity: opacity,
              strokeWeight: 3,
              map,
            });
            breadcrumbLinesRef.current.push(seg);
          }

          // Directional arrows every 8th point
          trail.points.forEach((pt, ptIdx) => {
            if (ptIdx % 8 !== 4 || pt.heading == null) return;
            const freshness = (ptIdx + 1) / trail.points.length;
            const arrow = new google.maps.Marker({
              position: { lat: pt.lat, lng: pt.lng },
              map,
              icon: {
                path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                scale: 2.5,
                rotation: pt.heading,
                fillColor: breadcrumbColorMode === 'speed' ? speedToColor(pt.speed) : breadcrumbColorMode === 'status' ? statusToColor(pt.status) : breadcrumbColorMode === 'accel' ? accelToColor(null) : unitColor,
                fillOpacity: 0.3 + freshness * 0.5,
                strokeColor: '#fff',
                strokeWeight: 0.5,
                strokeOpacity: 0.6,
              },
              clickable: false,
              zIndex: 1,
            });
            breadcrumbArrowsRef.current.push(arrow);
          });

          // Dot markers at each breadcrumb point
          trail.points.forEach((pt, ptIdx) => {
            const isLast = ptIdx === trail.points.length - 1;
            let dotColor: string;
            if (breadcrumbColorMode === 'speed') dotColor = speedToColor(pt.speed);
            else if (breadcrumbColorMode === 'status') dotColor = statusToColor(pt.status);
            else if (breadcrumbColorMode === 'accel') {
              // Compute accel from prev point
              if (ptIdx > 0) {
                const prev = trail.points[ptIdx - 1];
                const dt = (new Date(pt.time).getTime() - new Date(prev.time).getTime()) / 1000;
                if (dt > 0 && pt.speed != null && prev.speed != null) {
                  dotColor = accelToColor((pt.speed - prev.speed) / dt);
                } else { dotColor = accelToColor(null); }
              } else { dotColor = accelToColor(null); }
            } else dotColor = unitColor;

            const dot = new google.maps.Circle({
              center: { lat: pt.lat, lng: pt.lng },
              radius: 4,
              fillColor: dotColor,
              fillOpacity: isLast ? 1 : 0.6,
              strokeColor: '#fff',
              strokeWeight: isLast ? 2 : 0.5,
              strokeOpacity: 0.8,
              map,
              clickable: true,
              zIndex: ptIdx,
            });

            dot.addListener('click', () => {
              const time = new Date(pt.time).toLocaleString();
              const locationRow = pt.road_name
                ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Road</td><td style="color:#e0e0e0">${pt.road_name}${pt.intersection ? ` @ ${pt.intersection}` : ''}</td></tr>`
                : '';

              // Compute acceleration and distance from previous point
              let accelHtml = '';
              let distHtml = '';
              if (ptIdx > 0) {
                const prev = trail.points[ptIdx - 1];
                const dtSec = (new Date(pt.time).getTime() - new Date(prev.time).getTime()) / 1000;
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
                  const arrow = accelVal >= 0 ? '\u2191' : '\u2193';
                  const sign = accelVal >= 0 ? '+' : '';
                  accelHtml = `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Accel</td><td style="color:${accelColor};font-weight:bold">${arrow} ${sign}${accelVal.toFixed(1)} m/s\u00B2</td></tr>`;
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
              const gpsRow = `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">GPS</td><td><span style="font-size:9px;font-weight:bold;color:${gpsColor};padding:0 4px;border:1px solid ${gpsColor}40;border-radius:2px">${gpsLabel}</span> ${acc != null ? `\u00B1${Math.round(acc)}m` : ''}</td></tr>`;

              // Heading compass
              const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
              const headingDir = pt.heading != null ? dirs[Math.round(pt.heading / 45) % 8] : '';
              const headingCompass = pt.heading != null
                ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Heading</td><td style="color:#e0e0e0"><span style="display:inline-block;transform:rotate(${Math.round(pt.heading)}deg);font-size:13px">\u2191</span> ${headingDir} (${Math.round(pt.heading)}\u00B0)</td></tr>`
                : `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Heading</td><td style="color:#e0e0e0">\u2014</td></tr>`;

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
                    ${escapeHtml(trail.call_sign)} \u2014 ${escapeHtml(trail.officer_name || 'Unknown')}
                  </div>
                  <div style="color:#8899aa;font-size:10px;margin-bottom:4px">${escapeHtml(trail.badge_number || '')}</div>
                  ${pt.road_name ? `<div style="color:#fbbf24;font-weight:bold;font-size:12px;margin-bottom:4px;padding:2px 0;border-bottom:1px solid #282828">${escapeHtml(pt.road_name)}</div>` : ''}
                  <div style="font-size:18px;font-weight:900;color:${speedToColor(pt.speed)};margin-bottom:4px">${formatSpeedMph(pt.speed)}</div>
                  ${sparkSvg}
                  <table style="width:100%;font-size:11px;border-collapse:collapse">
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Time</td><td style="font-weight:bold;color:#fff">${time}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Status</td><td style="font-weight:bold;color:${statusToColor(pt.status)}">${STATUS_LABELS[pt.status] || pt.status}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Speed</td><td style="color:${speedToColor(pt.speed)};font-weight:bold">${formatSpeedMph(pt.speed)}</td></tr>
                    ${accelHtml}
                    ${headingCompass}
                    ${locationRow}
                    ${distHtml}
                    ${gpsRow}
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Position</td><td style="font-size:10px;color:#e0e0e0">${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}</td></tr>
                    ${pt.call_number ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Call</td><td style="font-weight:bold;color:#4fc3f7">${escapeHtml(pt.call_number)} \u2014 ${escapeHtml(pt.call_type || '')}</td></tr>` : ''}
                  </table>
                </div>
              `;
              breadcrumbInfoRef.current?.setContent(html);
              breadcrumbInfoRef.current?.setPosition({ lat: pt.lat, lng: pt.lng });
              breadcrumbInfoRef.current?.open(map);
            });

            breadcrumbMarkersRef.current.push(dot);
          });
        });

        // Speed alert triangle markers (>= 80 mph)
        speedAlertMarkersRef.current.forEach((m) => m.setMap(null));
        speedAlertMarkersRef.current = [];
        trails.forEach((trail) => {
          trail.points.forEach((pt) => {
            const mph = pt.speed != null ? pt.speed * 2.237 : 0;
            if (mph >= 80) {
              const marker = new google.maps.Marker({
                position: { lat: pt.lat, lng: pt.lng },
                map,
                icon: {
                  path: 'M 0,-8 L 7,5 L -7,5 Z',
                  scale: 1.4,
                  fillColor: '#dc2626',
                  fillOpacity: 0.9,
                  strokeColor: '#fbbf24',
                  strokeWeight: 1.5,
                },
                label: { text: '!', color: '#fff', fontSize: '9px', fontWeight: 'bold' },
                title: `Speed alert: ${Math.round(mph)} mph — ${trail.call_sign}`,
                zIndex: 5000,
              });
              speedAlertMarkersRef.current.push(marker);
            }
          });
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
      // Clean up polylines, markers, and arrows on unmount to prevent memory leaks
      breadcrumbLinesRef.current.forEach((l) => l.setMap(null));
      breadcrumbLinesRef.current = [];
      breadcrumbMarkersRef.current.forEach((m) => m.setMap(null));
      breadcrumbMarkersRef.current = [];
      breadcrumbArrowsRef.current.forEach((a) => a.setMap(null));
      breadcrumbArrowsRef.current = [];
      speedAlertMarkersRef.current.forEach((m) => m.setMap(null));
      speedAlertMarkersRef.current = [];
    };
  }, [showBreadcrumbs, breadcrumbHours, breadcrumbColorMode, mapLoaded]);

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
      playbackMarkerRef.current = new google.maps.Marker({
        position: { lat: pt.lat, lng: pt.lng },
        map,
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 5,
          rotation: pt.heading || 0,
          fillColor: speedToColor(pt.speed),
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
        zIndex: 9999,
        title: `${trail.call_sign} \u2014 Playback`,
      });
    }

    // Create speed label InfoWindow
    if (!playbackSpeedLabelRef.current) {
      playbackSpeedLabelRef.current = new google.maps.InfoWindow({ disableAutoPan: true });
    }

    let currentIdx = playbackIdx;
    const step = () => {
      if (currentIdx >= trail.points.length) {
        setIsPlaying(false);
        setPlaybackIdx(trail.points.length - 1);
        if (playbackSpeedLabelRef.current) playbackSpeedLabelRef.current.close();
        return;
      }

      const pt = trail.points[currentIdx];
      if (playbackMarkerRef.current) {
        playbackMarkerRef.current.setPosition({ lat: pt.lat, lng: pt.lng });
        playbackMarkerRef.current.setIcon({
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 5,
          rotation: pt.heading || 0,
          fillColor: speedToColor(pt.speed),
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        });
      }

      // Floating speed readout above playback marker
      if (playbackSpeedLabelRef.current) {
        const mphStr = pt.speed != null ? `${(pt.speed * 2.237).toFixed(0)} mph` : '\u2014';
        playbackSpeedLabelRef.current.setContent(
          `<div style="font-family:monospace;font-size:12px;font-weight:900;color:${speedToColor(pt.speed)};background:#0d0d0d;padding:2px 6px;border-radius:3px;border:1px solid #282828;white-space:nowrap">${mphStr}</div>`
        );
        playbackSpeedLabelRef.current.setPosition({ lat: pt.lat, lng: pt.lng });
        playbackSpeedLabelRef.current.open(map);
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
    };
  }, [isPlaying, playbackUnit, playbackSpeed, mapLoaded]);

  // Cleanup playback marker and speed label when playback unit changes or stops
  useEffect(() => {
    if (playbackUnit == null) {
      if (playbackMarkerRef.current) {
        playbackMarkerRef.current.setMap(null);
        playbackMarkerRef.current = null;
      }
      if (playbackSpeedLabelRef.current) {
        playbackSpeedLabelRef.current.close();
        playbackSpeedLabelRef.current = null;
      }
    }
  }, [playbackUnit]);

  // ============================================================
  // Speed Heatmap Layer (grid rectangles)
  // ============================================================

  const heatmapRectsRef = useRef<google.maps.Rectangle[]>([]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) {
      heatmapRectsRef.current.forEach((r) => r.setMap(null));
      heatmapRectsRef.current = [];
      return;
    }

    // Clean previous
    heatmapRectsRef.current.forEach((r) => r.setMap(null));
    heatmapRectsRef.current = [];

    if (!speedAnalytics.showSpeedHeatmap || speedAnalytics.heatmapCells.length === 0) return;

    const GRID_SIZE = 0.002; // ~200m grid cells
    speedAnalytics.heatmapCells.forEach((cell) => {
      const rect = new google.maps.Rectangle({
        bounds: {
          north: cell.grid_lat + GRID_SIZE,
          south: cell.grid_lat,
          east: cell.grid_lng + GRID_SIZE,
          west: cell.grid_lng,
        },
        fillColor: speedToColor(cell.avg_speed / 2.237), // convert mph to m/s for speedToColor
        fillOpacity: Math.min(0.15 + (cell.point_count / 50) * 0.35, 0.5),
        strokeColor: speedToColor(cell.avg_speed / 2.237),
        strokeWeight: 0.5,
        strokeOpacity: 0.3,
        map,
        clickable: false,
        zIndex: 50,
      });
      heatmapRectsRef.current.push(rect);
    });

    return () => {
      heatmapRectsRef.current.forEach((r) => r.setMap(null));
      heatmapRectsRef.current = [];
    };
  }, [speedAnalytics.showSpeedHeatmap, speedAnalytics.heatmapCells, mapLoaded]);

  // ============================================================
  // Pursuit Corridor Polylines
  // ============================================================

  const pursuitLinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) {
      pursuitLinesRef.current.forEach((l) => l.setMap(null));
      pursuitLinesRef.current = [];
      return;
    }

    // Clean previous
    pursuitLinesRef.current.forEach((l) => l.setMap(null));
    pursuitLinesRef.current = [];

    if (speedAnalytics.pursuitSegments.length === 0) return;

    speedAnalytics.pursuitSegments.forEach((seg) => {
      if (seg.points.length < 2) return;
      const line = new google.maps.Polyline({
        path: seg.points.map((p) => ({ lat: p.lat, lng: p.lng })),
        geodesic: true,
        strokeColor: '#dc2626',
        strokeOpacity: 0.8,
        strokeWeight: 6,
        map,
        zIndex: 100,
      });
      pursuitLinesRef.current.push(line);
    });

    return () => {
      pursuitLinesRef.current.forEach((l) => l.setMap(null));
      pursuitLinesRef.current = [];
    };
  }, [speedAnalytics.pursuitSegments, mapLoaded]);

  // ============================================================
  // Speed Zone Polygons
  // ============================================================

  const speedZonePolysRef = useRef<google.maps.Polygon[]>([]);
  const speedZoneLabelsRef = useRef<google.maps.Marker[]>([]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) {
      speedZonePolysRef.current.forEach((p) => p.setMap(null));
      speedZonePolysRef.current = [];
      speedZoneLabelsRef.current.forEach((m) => m.setMap(null));
      speedZoneLabelsRef.current = [];
      return;
    }

    // Clean previous
    speedZonePolysRef.current.forEach((p) => p.setMap(null));
    speedZonePolysRef.current = [];
    speedZoneLabelsRef.current.forEach((m) => m.setMap(null));
    speedZoneLabelsRef.current = [];

    if (speedAnalytics.speedZones.length === 0) return;

    const ZONE_TYPE_COLORS: Record<string, string> = {
      school: '#eab308',
      residential: '#22c55e',
      highway: '#f97316',
      construction: '#ef4444',
      parking: '#6b7280',
    };

    speedAnalytics.speedZones.forEach((zone) => {
      if (!zone.is_active || !zone.polygon_coords) return;
      try {
        const coords: { lat: number; lng: number }[] = JSON.parse(zone.polygon_coords);
        if (coords.length < 3) return;

        const zoneColor = ZONE_TYPE_COLORS[zone.zone_type] || '#888888';
        const poly = new google.maps.Polygon({
          paths: coords,
          fillColor: zoneColor,
          fillOpacity: 0.15,
          strokeColor: zoneColor,
          strokeWeight: 2,
          strokeOpacity: 0.6,
          map,
          zIndex: 60,
          clickable: false,
        });
        speedZonePolysRef.current.push(poly);

        // Centroid label
        const cLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
        const cLng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
        const label = new google.maps.Marker({
          position: { lat: cLat, lng: cLng },
          map,
          icon: {
            path: 'M 0,0',
            scale: 0,
          },
          label: {
            text: `${zone.speed_limit_mph} mph`,
            color: zoneColor,
            fontSize: '9px',
            fontWeight: 'bold',
            className: 'speed-zone-label',
          },
          clickable: false,
          zIndex: 61,
        });
        speedZoneLabelsRef.current.push(label);
      } catch {
        // Invalid polygon_coords JSON
      }
    });

    return () => {
      speedZonePolysRef.current.forEach((p) => p.setMap(null));
      speedZonePolysRef.current = [];
      speedZoneLabelsRef.current.forEach((m) => m.setMap(null));
      speedZoneLabelsRef.current = [];
    };
  }, [speedAnalytics.speedZones, mapLoaded]);

  // ============================================================
  // GPS Self-Position Marker
  // ============================================================

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    if (gps.isTracking && gps.latitude != null && gps.longitude != null) {
      const pos = { lat: gps.latitude, lng: gps.longitude };
      if (selfMarkerRef.current) {
        // Update existing marker
        if (typeof selfMarkerRef.current.updatePosition === 'function') {
          // OverlayView fallback marker
          selfMarkerRef.current.updatePosition(gps.latitude, gps.longitude);
          selfMarkerRef.current.updateContent(buildSelfPositionMarker(gps.accuracy, gps.heading));
        } else {
          // AdvancedMarkerElement
          selfMarkerRef.current.position = pos;
          selfMarkerRef.current.content = buildSelfPositionMarker(gps.accuracy, gps.heading);
        }
      } else {
        // Create new self marker
        selfMarkerRef.current = createMarker({
          map,
          position: pos,
          content: buildSelfPositionMarker(gps.accuracy, gps.heading),
          zIndex: 9999,
          title: `Your Position${gps.unitCallSign ? ` (${gps.unitCallSign})` : ''}`,
        });
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

  // Memoized SafetyDashboardPanel props
  const safetyEnvironmentProp = useMemo(() => ({
    lighting: environment?.lighting || 'unknown',
    sunriseSunset: environment?.sunriseSunset ? {
      sunrise: environment.sunriseSunset.sunrise ?? '',
      sunset: environment.sunriseSunset.sunset ?? '',
      minutesToTransition: environment.sunriseSunset?.minutesToNextTransition ?? 0,
      nextTransition: environment.sunriseSunset?.nextTransition ?? '',
    } : null,
    lowVisibility: environment?.lowVisibility ?? false,
    weatherHazards: [
      environment?.weatherHazards?.freezing && 'Freezing',
      environment?.weatherHazards?.highWind && 'High Wind',
      environment?.weatherHazards?.rain && 'Rain',
      environment?.weatherHazards?.snow && 'Snow',
    ].filter(Boolean) as string[],
    icyRoad: environment?.icyRoad ?? false,
    windCondition: environment?.windCondition ? {
      speed: environment.windCondition.speed ?? 0,
      direction: environment.windCondition.cardinal ?? '',
    } : null,
    visibilityRange: environment?.visibilityRange ?? null,
    schoolZoneActive: environment?.schoolZoneActive ?? false,
  }), [environment]);

  const safetyUnitSafetyProp = useMemo(() => ({
    loneOfficers: unitSafety.loneOfficers ?? [],
    exposureWarnings: unitSafety.exposureWarnings ?? [],
    stationaryUnits: unitSafety.stationaryUnits ?? [],
    speedAnomalies: unitSafety.speedAnomalies ?? [],
    coveragePercent: unitSafety.coveragePercent ?? 0,
  }), [unitSafety]);

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

  // Address search with Google Places Autocomplete
  const handleAddressSearch = useCallback((query: string) => {
    setAddressSearch(query);
    if (addressSearchTimer.current) clearTimeout(addressSearchTimer.current);

    if (!query.trim()) {
      setAddressResults([]);
      setShowAddressResults(false);
      return;
    }

    addressSearchTimer.current = setTimeout(() => {
      if (typeof google === 'undefined' || !google.maps?.places) return;
      const service = new google.maps.places.AutocompleteService();
      service.getPlacePredictions(
        { input: query, types: ['geocode', 'establishment'], componentRestrictions: { country: 'us' } },
        (predictions, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
            setAddressResults(predictions.map(p => ({ description: p.description, place_id: p.place_id })));
            setShowAddressResults(true);
          } else {
            setAddressResults([]);
          }
        }
      );
    }, 300);
  }, []);

  const handleAddressSelect = useCallback((placeId: string, description: string) => {
    const map = mapInstanceRef.current;
    if (!map || typeof google === 'undefined') return;

    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ placeId }, (results, status) => {
      if (status === 'OK' && results && results[0]) {
        const loc = results[0].geometry.location;
        map.panTo(loc);
        map.setZoom(17);

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
        label.style.cssText = 'background:#888888;color:#fff;font-size:9px;font-weight:900;padding:3px 8px;border:2px solid #fff;white-space:nowrap;font-family:\'JetBrains Mono\',monospace;letter-spacing:0.05em;max-width:200px;overflow:hidden;text-overflow:ellipsis;border-radius:2px;';
        label.textContent = description.split(',')[0];

        const arrow = document.createElement('div');
        arrow.style.cssText = 'width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #888888;';

        el.appendChild(label);
        el.appendChild(arrow);

        addressMarkerRef.current = createMarker({
          map,
          position: { lat: loc.lat(), lng: loc.lng() },
          content: el,
          zIndex: 5000,
          title: description,
        });

        // Auto-dismiss after 30 seconds
        if (addressDismissTimer.current) clearTimeout(addressDismissTimer.current);
        addressDismissTimer.current = setTimeout(() => {
          if (addressMarkerRef.current) {
            removeMarker(addressMarkerRef.current);
            addressMarkerRef.current = null;
          }
          addressDismissTimer.current = null;
        }, 30000);
      }
    });

    setAddressSearch(description.split(',')[0]);
    setShowAddressResults(false);
  }, [createMarker, removeMarker]);

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
        case 't': // Toggle traffic
          if (typeof toggleTraffic === 'function') {
            e.preventDefault();
            toggleTraffic(mapInstanceRef.current);
          }
          break;
        case 'b': // Toggle breadcrumbs
          e.preventDefault();
          setShowBreadcrumbs(prev => !prev);
          break;
        case 'c': // Center on all units
          e.preventDefault();
          if (mapInstanceRef.current && units.length > 0) {
            const bounds = new google.maps.LatLngBounds();
            let hasCoords = false;
            units.forEach(u => {
              if (u.latitude != null && u.longitude != null) {
                bounds.extend({ lat: u.latitude, lng: u.longitude });
                hasCoords = true;
              }
            });
            if (hasCoords) mapInstanceRef.current.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: layersPanelOpen ? 220 : 60 });
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
          infoWindowRef.current?.close();
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
              background: 'rgba(6,12,20,0.95)',
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
                    map.panTo({ lat: center.lat() + 0.0001, lng: center.lng() });
                    setTimeout(() => map.panTo(center), 200);
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

        {/* Offline Leaflet/CartoDB fallback removed 2026-04-29; map errors
            now surface the configuration-required dialog below. */}

        {/* API key / auth error dialog — sole error surface */}
        {isAuthError && (
          <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-surface-overlay/95 border border-red-600 p-8 shadow-xl max-w-lg text-center" style={{ borderRadius: 2 }}>
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
              <h3 className="text-white text-sm font-bold mb-2">Map Configuration Required</h3>
              <pre className="text-rmpg-300 text-xs leading-relaxed mb-4 whitespace-pre-wrap text-left">{mapError}</pre>
              <div className="bg-surface-deep border border-rmpg-600 p-3 text-left mb-4" style={{ borderRadius: 2 }}>
                <p className="text-[10px] text-rmpg-400 font-mono leading-relaxed">
                  <span className="text-amber-400 font-bold">Checklist:</span><br/>
                  1. Go to <span className="text-gray-400">console.cloud.google.com/apis/library</span><br/>
                  2. Enable <span className="text-amber-400">Maps JavaScript API</span><br/>
                  3. Enable <span className="text-amber-400">Places API (New)</span><br/>
                  4. Go to <span className="text-gray-400">Billing</span> → ensure billing is active<br/>
                  5. Go to <span className="text-gray-400">Credentials</span> → check key restrictions<br/>
                  6. Add key to <span className="text-brand-400">client/.env</span>:<br/>
                  <span className="text-green-400 ml-2">GOOGLE_MAPS_API_KEY=your_key</span><br/>
                  7. Restart the dev server
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
                <input
                  type="text"
                  value={addressSearch}
                  onChange={(e) => handleAddressSearch(e.target.value)}
                  onFocus={() => addressResults.length > 0 && setShowAddressResults(true)}
                  onBlur={() => setTimeout(() => setShowAddressResults(false), 300)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setShowAddressResults(false); setAddressSearch(''); setAddressResults([]); }
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
                <div className="absolute top-full left-0 right-0 mt-1 bg-black/90 border border-white/15 shadow-md backdrop-blur-md overflow-hidden" style={{ borderRadius: 2 }} role="listbox">
                  {addressResults.map((r) => (
                    <button
                      key={r.place_id}
                      role="option"
                      onMouseDown={(e) => e.preventDefault()}
                      onTouchStart={(e) => e.preventDefault()}
                      onClick={() => handleAddressSelect(r.place_id, r.description)}
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
                <input
                  type="text"
                  value={addressSearch}
                  onChange={(e) => handleAddressSearch(e.target.value)}
                  onFocus={() => addressResults.length > 0 && setShowAddressResults(true)}
                  onBlur={() => setTimeout(() => setShowAddressResults(false), 300)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setShowAddressResults(false); setAddressSearch(''); setAddressResults([]); }
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
                <div className="absolute top-full left-0 right-0 mt-1 bg-black/80 border border-white/15 shadow-md backdrop-blur-md overflow-hidden" style={{ borderRadius: 2 }} role="listbox">
                  {addressResults.map((r) => (
                    <button
                      key={r.place_id}
                      role="option"
                      onMouseDown={(e) => e.preventDefault()}
                      onTouchStart={(e) => e.preventDefault()}
                      onClick={() => handleAddressSelect(r.place_id, r.description)}
                      className="w-full text-left px-3 py-2 text-[10px] text-rmpg-200 hover:bg-rmpg-700/50 hover:text-white transition-colors border-b border-rmpg-700 last:border-0 flex items-center gap-2"
                    >
                      <MapPin className="w-3 h-3 text-gray-400 shrink-0" />
                      <span className="truncate">{r.description}</span>
                    </button>
                  ))}
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
                className={`border border-b-0 backdrop-blur-md px-2 py-1.5 transition-colors ${
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
                className={`border backdrop-blur-md px-2 py-1.5 transition-colors ${
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
          <div className="bg-surface-deep border border-rmpg-600 shadow-md overflow-y-auto scrollbar-dark" style={{ width: 'clamp(160px, 14vw, 200px)', maxHeight: 'calc(100dvh - 160px)', borderRadius: 2, isolation: 'isolate', WebkitTransform: 'translateZ(0)', overscrollBehavior: 'contain' } as React.CSSProperties} role="region" aria-label="Map layer controls">
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
                    {advancedHeatmapEnabled ? `${advancedHeatmap?.pointCount ?? 0} pts` : `${heatmapData.length} pts`}
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

                  {/* Dim base map toggle — darkens base tiles so heat pops */}
                  <button
                    onClick={() => setDimBaseEnabled(!dimBaseEnabled)}
                    className={`flex items-center gap-1.5 w-full text-[9px] font-bold transition-colors ${
                      dimBaseEnabled ? 'text-red-400' : 'text-rmpg-500 hover:text-rmpg-300'
                    }`}
                  >
                    <span className="flex-1 text-left">Dim Base Map</span>
                    {dimBaseEnabled && <span className="led-dot led-red" style={{ width: 5, height: 5 }} />}
                  </button>

                  {/* Saved filter presets */}
                  <div className="border-t border-rmpg-700/50 pt-1 mt-1">
                    <HeatmapPresets
                      current={{ days: heatmapDays, mode: heatmapMode, typeFilter: heatmapTypeFilter }}
                      onApply={(p: HeatmapPresetValue) => {
                        setHeatmapDays(p.days);
                        setHeatmapMode(p.mode);
                        setHeatmapTypeFilter(p.typeFilter);
                      }}
                    />
                  </div>

                  {/* Advanced mode toggle */}
                  <div className="border-t border-rmpg-700/50 pt-1 mt-1">
                    <button
                      onClick={() => setAdvancedHeatmapEnabled(!advancedHeatmapEnabled)}
                      className={`flex items-center gap-1.5 w-full text-[9px] font-bold transition-colors ${
                        advancedHeatmapEnabled ? 'text-brand-400' : 'text-rmpg-500 hover:text-rmpg-300'
                      }`}
                    >
                      <SlidersHorizontal className="w-2.5 h-2.5" />
                      <span className="flex-1 text-left">Advanced Mode</span>
                      {advancedHeatmapEnabled && <span className="led-dot led-blue" style={{ width: 5, height: 5 }} />}
                    </button>
                  </div>

                  {/* ── Basic mode controls (when advanced is OFF) ── */}
                  {!advancedHeatmapEnabled && (
                    <>
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
                        <select
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

                      {/* Timelapse controls */}
                      <div className="border-t border-rmpg-700/50 pt-1 mt-1">
                        <button
                          onClick={() => setShowTimelapse(!showTimelapse)}
                          className={`flex items-center gap-1.5 w-full text-[9px] font-bold transition-colors ${
                            showTimelapse ? 'text-orange-400' : 'text-rmpg-500 hover:text-rmpg-300'
                          }`}
                        >
                          <SkipForward className="w-2.5 h-2.5" />
                          <span className="flex-1 text-left">Time-Lapse</span>
                          {showTimelapse && <span className="led-dot led-orange" style={{ width: 5, height: 5 }} />}
                        </button>
                        {showTimelapse && (
                          <div className="mt-1 space-y-1">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => timelapse.setIsPlaying(!timelapse.isPlaying)}
                                className="p-0.5 rounded-sm hover:bg-orange-900/40 transition-colors"
                              >
                                {timelapse.isPlaying ? <Pause className="w-3 h-3 text-amber-400" /> : <Play className="w-3 h-3 text-green-400" />}
                              </button>
                              <input
                                type="range"
                                min={0}
                                max={Math.max(timelapse.totalSlices - 1, 0)}
                                value={timelapse.currentIndex}
                                onChange={(e) => { timelapse.setCurrentIndex(Number(e.target.value)); timelapse.setIsPlaying(false); }}
                                className="flex-1 h-1 accent-orange-400"
                                aria-label="Timelapse position"
                              />
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[7px] font-mono text-orange-300">{timelapse.currentLabel}</span>
                              <div className="flex items-center gap-0.5">
                                {([1, 2, 4] as const).map((s) => (
                                  <button
                                    key={s}
                                    onClick={() => timelapse.setSpeed(s)}
                                    className={`px-1 py-0 text-[7px] font-mono font-bold rounded-sm transition-colors ${
                                      timelapse.speed === s ? 'bg-orange-900/50 text-orange-400 border border-orange-700/50' : 'text-rmpg-500 hover:text-rmpg-300'
                                    }`}
                                  >
                                    {s}x
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* ── Advanced mode controls ── */}
                  {advancedHeatmapEnabled && (
                    <div className="space-y-1.5">
                      {/* Mode selector: Density | Risk | Temporal | Comparison */}
                      <div className="flex items-center gap-0.5">
                        {([['density', 'Density'], ['risk', 'Risk'], ['temporal', 'Temporal'], ['comparison', 'Compare']] as [HeatmapAdvancedMode, string][]).map(([mode, label]) => (
                          <button
                            key={mode}
                            onClick={() => setAdvHeatmapMode(mode)}
                            className={`px-1 py-0.5 text-[7px] font-mono font-bold rounded-sm transition-colors ${
                              advHeatmapMode === mode
                                ? 'bg-brand-900/50 text-brand-400 border border-brand-700/50'
                                : 'text-rmpg-500 hover:text-rmpg-300'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      {/* Hour range filter */}
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[7px] text-rmpg-400 font-mono">HOURS</span>
                          <span className="text-[7px] text-rmpg-300 font-mono">
                            {advHeatmapHourRange[0] === 0 && advHeatmapHourRange[1] === 23
                              ? 'All day'
                              : `${advHeatmapHourRange[0].toString().padStart(2, '0')}:00 - ${advHeatmapHourRange[1].toString().padStart(2, '0')}:59`
                            }
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="range"
                            min={0} max={23}
                            value={advHeatmapHourRange[0]}
                            onChange={(e) => { const v = Number(e.target.value); setAdvHeatmapHourRange([Math.min(v, advHeatmapHourRange[1]), advHeatmapHourRange[1]]); }}
                            className="flex-1 h-1 accent-red-400"
                            aria-label="Start hour"
                          />
                          <input
                            type="range"
                            min={0} max={23}
                            value={advHeatmapHourRange[1]}
                            onChange={(e) => { const v = Number(e.target.value); setAdvHeatmapHourRange([advHeatmapHourRange[0], Math.max(v, advHeatmapHourRange[0])]); }}
                            className="flex-1 h-1 accent-red-400"
                            aria-label="End hour"
                          />
                        </div>
                      </div>

                      {/* Day-of-week filter */}
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[7px] text-rmpg-400 font-mono">DAYS</span>
                          <div className="flex gap-0.5">
                            <button
                              onClick={() => setAdvHeatmapDayFilter([1, 2, 3, 4, 5])}
                              className="text-[6px] text-rmpg-400 hover:text-rmpg-200 font-mono"
                            >Wkdays</button>
                            <button
                              onClick={() => setAdvHeatmapDayFilter([0, 6])}
                              className="text-[6px] text-rmpg-400 hover:text-rmpg-200 font-mono"
                            >Wkends</button>
                            <button
                              onClick={() => setAdvHeatmapDayFilter([])}
                              className="text-[6px] text-rmpg-400 hover:text-rmpg-200 font-mono"
                            >All</button>
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5">
                          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day, i) => (
                            <button
                              key={i}
                              onClick={() => {
                                setAdvHeatmapDayFilter(prev =>
                                  prev.includes(i) ? prev.filter(d => d !== i) : [...prev, i]
                                );
                              }}
                              aria-pressed={advHeatmapDayFilter.length === 0 || advHeatmapDayFilter.includes(i)}
                              className={`px-1 py-0.5 text-[7px] font-mono font-bold rounded-sm transition-colors ${
                                advHeatmapDayFilter.length === 0 || advHeatmapDayFilter.includes(i)
                                  ? 'bg-red-900/40 text-red-400 border border-red-800/50'
                                  : 'text-rmpg-600 border border-transparent'
                              }`}
                            >
                              {day}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Color scheme */}
                      <div>
                        <span className="text-[7px] text-rmpg-400 font-mono block mb-0.5">COLOR SCHEME</span>
                        <div className="flex items-center gap-0.5">
                          {([
                            ['heat', ['#888888', '#00c864', '#c8c800', '#ff8c00', '#ff3200']],
                            ['risk', ['#4caf50', '#ffeb3b', '#ff9800', '#f44336', '#b71c1c']],
                            ['gold', ['#fde047', '#facc15', '#d4a017', '#b48206', '#854d0e']],
                            ['green', ['#90ee90', '#3cb371', '#228b22', '#006400', '#003c00']],
                            ['purple', ['#d8bfd8', '#ba55d3', '#9467bd', '#6a0dad', '#4b0082']],
                          ] as [HeatmapColorScheme, string[]][]).map(([scheme, colors]) => (
                            <button
                              key={scheme}
                              onClick={() => setAdvHeatmapColorScheme(scheme)}
                              className={`p-0.5 rounded-sm transition-all ${
                                advHeatmapColorScheme === scheme ? 'ring-1 ring-white/50 scale-110' : 'opacity-60 hover:opacity-100'
                              }`}
                              title={scheme}
                            >
                              <div className="flex h-2" style={{ width: 20, borderRadius: 1, overflow: 'hidden' }}>
                                {colors.map((c, i) => (
                                  <div key={i} style={{ flex: 1, backgroundColor: c }} />
                                ))}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Opacity slider */}
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[7px] text-rmpg-400 font-mono">OPACITY</span>
                          <span className="text-[7px] text-rmpg-300 font-mono">{advHeatmapOpacity}%</span>
                        </div>
                        <input
                          type="range"
                          min={10} max={100} step={5}
                          value={advHeatmapOpacity}
                          onChange={(e) => setAdvHeatmapOpacity(Number(e.target.value))}
                          className="w-full h-1 accent-red-400"
                          aria-label="Heatmap opacity"
                        />
                      </div>

                      {/* Radius slider */}
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[7px] text-rmpg-400 font-mono">RADIUS</span>
                          <span className="text-[7px] text-rmpg-300 font-mono">{advHeatmapRadius}px</span>
                        </div>
                        <input
                          type="range"
                          min={10} max={50} step={2}
                          value={advHeatmapRadius}
                          onChange={(e) => setAdvHeatmapRadius(Number(e.target.value))}
                          className="w-full h-1 accent-red-400"
                          aria-label="Heatmap radius"
                        />
                      </div>

                      {/* Resolution */}
                      <div>
                        <span className="text-[7px] text-rmpg-400 font-mono block mb-0.5">RESOLUTION</span>
                        <div className="flex items-center gap-1">
                          {([['fine', 'Fine'], ['medium', 'Med'], ['coarse', 'Coarse']] as [HeatmapResolution, string][]).map(([res, label]) => (
                            <button
                              key={res}
                              onClick={() => setAdvHeatmapResolution(res)}
                              className={`px-1.5 py-0.5 text-[7px] font-mono font-bold rounded-sm transition-colors ${
                                advHeatmapResolution === res
                                  ? 'bg-red-900/50 text-red-400 border border-red-700/50'
                                  : 'text-rmpg-500 hover:text-rmpg-300'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Show clusters toggle */}
                      <button
                        onClick={() => setAdvHeatmapShowClusters(!advHeatmapShowClusters)}
                        className={`flex items-center gap-1.5 w-full text-[8px] font-bold transition-colors ${
                          advHeatmapShowClusters ? 'text-gray-400' : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        <CircleDot className="w-2.5 h-2.5" />
                        <span className="flex-1 text-left">Hotspot Clusters</span>
                        {advHeatmapShowClusters && (
                          <span className="text-[7px] font-mono text-gray-400">{advancedHeatmap.clusters?.length ?? 0}</span>
                        )}
                      </button>

                      {/* Incident type multi-select */}
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[7px] text-rmpg-400 font-mono">INCIDENT TYPES</span>
                          <div className="flex gap-1">
                            <button
                              onClick={() => setAdvHeatmapTypes(heatmapTypes.map(t => t.incident_type))}
                              className="text-[6px] text-rmpg-400 hover:text-rmpg-200 font-mono"
                            >All</button>
                            <button
                              onClick={() => setAdvHeatmapTypes([])}
                              className="text-[6px] text-rmpg-400 hover:text-rmpg-200 font-mono"
                            >Clear</button>
                          </div>
                        </div>
                        <div className="max-h-[60px] overflow-y-auto space-y-0" style={{ scrollbarWidth: 'thin' }}>
                          {heatmapTypes.slice(0, 15).map((t) => (
                            <label
                              key={t.incident_type}
                              className="flex items-center gap-1 px-0.5 py-0 cursor-pointer hover:bg-rmpg-800/30"
                            >
                              <input
                                type="checkbox"
                                checked={advHeatmapTypes.length === 0 || advHeatmapTypes.includes(t.incident_type)}
                                onChange={() => {
                                  setAdvHeatmapTypes(prev =>
                                    prev.includes(t.incident_type)
                                      ? prev.filter(x => x !== t.incident_type)
                                      : [...prev, t.incident_type]
                                  );
                                }}
                                className="w-2 h-2 accent-red-500"
                              />
                              <span className="text-[7px] text-rmpg-300 font-mono flex-1 truncate">{formatIncidentType(t.incident_type)}</span>
                              <span className="text-[6px] text-rmpg-500 font-mono">{t.count}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Comparison mode options */}
                      {advHeatmapMode === 'comparison' && (
                        <div className="border-t border-rmpg-700/50 pt-1">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[7px] text-rmpg-400 font-mono">COMPARE VS</span>
                            <span className="text-[7px] text-rmpg-300 font-mono">Previous {advHeatmapComparisonDays}d</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {[7, 14, 30, 90].map((d) => (
                              <button
                                key={d}
                                onClick={() => setAdvHeatmapComparisonDays(d)}
                                className={`px-1 py-0.5 text-[7px] font-mono font-bold rounded-sm transition-colors ${
                                  advHeatmapComparisonDays === d
                                    ? 'bg-gray-900/50 text-gray-400 border border-gray-700/50'
                                    : 'text-rmpg-500 hover:text-rmpg-300'
                                }`}
                              >
                                {d}d
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex items-center gap-1">
                              <div className="w-2 h-2 rounded-full bg-red-500" />
                              <span className="text-[6px] text-rmpg-400 font-mono">Current</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="w-2 h-2 rounded-full bg-gray-500" />
                              <span className="text-[6px] text-rmpg-400 font-mono">Previous</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Temporal animation controls */}
                      {advHeatmapMode === 'temporal' && (
                        <div className="border-t border-rmpg-700/50 pt-1">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => advancedHeatmap.setTemporalPlaying(!advancedHeatmap.temporalPlaying)}
                              className="p-0.5 rounded-sm hover:bg-orange-900/40 transition-colors"
                            >
                              {advancedHeatmap.temporalPlaying
                                ? <Pause className="w-3 h-3 text-amber-400" />
                                : <Play className="w-3 h-3 text-green-400" />
                              }
                            </button>
                            <input
                              type="range"
                              min={0} max={23}
                              value={advancedHeatmap.temporalHour}
                              onChange={(e) => { advancedHeatmap.setTemporalHour(Number(e.target.value)); advancedHeatmap.setTemporalPlaying(false); }}
                              className="flex-1 h-1 accent-orange-400"
                            />
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-[7px] font-mono text-orange-300">
                              <Clock className="w-2 h-2 inline mr-0.5" />
                              {advancedHeatmap.temporalHour.toString().padStart(2, '0')}:00 - {advancedHeatmap.temporalHour.toString().padStart(2, '0')}:59
                            </span>
                            <div className="flex items-center gap-0.5">
                              {([1, 2, 4] as const).map((s) => (
                                <button
                                  key={s}
                                  onClick={() => advancedHeatmap.setTemporalSpeed(s)}
                                  className={`px-1 py-0 text-[7px] font-mono font-bold rounded-sm transition-colors ${
                                    advancedHeatmap.temporalSpeed === s ? 'bg-orange-900/50 text-orange-400 border border-orange-700/50' : 'text-rmpg-500 hover:text-rmpg-300'
                                  }`}
                                >
                                  {s}x
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Refresh + loading */}
                      <div className="flex items-center justify-between pt-1 border-t border-rmpg-700/50">
                        <button
                          onClick={() => advancedHeatmap.refreshHeatmap()}
                          className="flex items-center gap-1 text-[7px] text-rmpg-400 hover:text-rmpg-200 font-mono"
                        >
                          <RefreshCw className={`w-2.5 h-2.5 ${advancedHeatmap.loading ? 'animate-spin' : ''}`} />
                          Refresh
                        </button>
                        {advancedHeatmap.loading && (
                          <Loader2 className="w-2.5 h-2.5 text-brand-400 animate-spin" />
                        )}
                      </div>

                      {/* Stats summary */}
                      {advancedHeatmap.stats && (
                        <div className="border-t border-rmpg-700/50 pt-1 space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[7px] text-rmpg-400 font-mono">TOTAL</span>
                            <span className="text-[8px] text-red-400 font-mono font-bold">{advancedHeatmap.stats.total.toLocaleString()}</span>
                          </div>
                          {advancedHeatmap.stats.topTypes.slice(0, 3).map((t, i) => (
                            <div key={i} className="flex items-center gap-1">
                              <div
                                className="h-1 rounded-full"
                                style={{
                                  width: `${Math.max(10, (t.count / (advancedHeatmap.stats?.topTypes[0]?.count || 1)) * 50)}%`,
                                  backgroundColor: i === 0 ? '#ef4444' : i === 1 ? '#f59e0b' : '#888888',
                                }}
                              />
                              <span className="text-[6px] text-rmpg-400 font-mono truncate flex-1">{formatIncidentType(t.type)}</span>
                              <span className="text-[6px] text-rmpg-500 font-mono">{t.count}</span>
                            </div>
                          ))}
                          <div className="flex items-center gap-2 mt-0.5">
                            {advancedHeatmap.stats.peakHour !== null && (
                              <span className="text-[6px] font-mono px-1 py-0.5 bg-orange-900/30 text-orange-400 rounded-sm">
                                Peak: {advancedHeatmap.stats.peakHour.toString().padStart(2, '0')}:00
                              </span>
                            )}
                            {advancedHeatmap.stats.peakDay && (
                              <span className="text-[6px] font-mono px-1 py-0.5 bg-purple-900/30 text-purple-400 rounded-sm">
                                {advancedHeatmap.stats.peakDay}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
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
                  {/* Hours selector — presets extend from 24h to 1y per
                      operator request. Label abbreviates days/months/years. */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {BREADCRUMB_HOUR_PRESETS.map(({ hours: h, label }) => (
                      <button
                        key={h}
                        onClick={() => setBreadcrumbHours(h)}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                          breadcrumbHours === h
                            ? 'bg-gray-900/50 text-gray-400 border border-gray-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {label}
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
                  {/* Speed color legend — interactive 8-band with toggles */}
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
                        <button key={band.key}
                          onClick={() => speedAnalytics.setSpeedBandToggles(prev => ({ ...prev, [band.key]: !(prev[band.key] ?? true) }))}
                          className="flex items-center gap-0.5 cursor-pointer"
                          style={{ opacity: (speedAnalytics.speedBandToggles[band.key] ?? true) ? 1 : 0.3 }}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ background: band.color }} />
                          <span className="text-[7px] text-rmpg-400 font-mono">{band.label}</span>
                        </button>
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
                        <select
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
                              <input
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
                                  if (pt && playbackMarkerRef.current) {
                                    playbackMarkerRef.current.setPosition({ lat: pt.lat, lng: pt.lng });
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

            {/* ── Speed Analytics ── */}
            {showBreadcrumbs && (
              <div className="border-t border-rmpg-700 p-1.5">
                <div className="map-sidebar-section text-[9px] text-[#d4a017] uppercase font-semibold mb-2 px-1 pb-1 border-b border-[#d4a017]/15">Speed Analytics</div>

                {/* Violations badge */}
                {speedAnalytics.unacknowledgedCount > 0 && (
                  <div className="flex items-center gap-2 px-2 py-1 mb-1 bg-red-900/20 border border-red-800/30 rounded-sm">
                    <AlertTriangle className="w-3 h-3 text-red-400" />
                    <span className="text-[9px] text-red-400 font-mono font-bold flex-1">
                      {speedAnalytics.unacknowledgedCount} speed violation{speedAnalytics.unacknowledgedCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}

                {/* Speed Heatmap toggle */}
                <button
                  onClick={() => speedAnalytics.setShowSpeedHeatmap(!speedAnalytics.showSpeedHeatmap)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                    speedAnalytics.showSpeedHeatmap ? 'panel-inset bg-orange-900/20 text-orange-400' : 'text-rmpg-400 hover:bg-surface-raised'
                  }`}
                >
                  {speedAnalytics.showSpeedHeatmap ? <Eye className="w-3 h-3 text-orange-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
                  <Gauge className="w-3 h-3" />
                  <span className="flex-1 text-left">Speed Heatmap</span>
                </button>

                {/* Zone Stats toggle */}
                <button
                  onClick={() => speedAnalytics.setShowZoneStats(!speedAnalytics.showZoneStats)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                    speedAnalytics.showZoneStats ? 'panel-inset bg-gray-900/20 text-gray-400' : 'text-rmpg-400 hover:bg-surface-raised'
                  }`}
                >
                  {speedAnalytics.showZoneStats ? <Eye className="w-3 h-3 text-gray-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
                  <BarChart3 className="w-3 h-3" />
                  <span className="flex-1 text-left">Zone Speed Stats</span>
                </button>

                {/* Zone Stats collapsible table */}
                {speedAnalytics.showZoneStats && speedAnalytics.zoneSpeedStats.length > 0 && (
                  <div className="ml-2 mt-1 max-h-32 overflow-y-auto">
                    <table className="w-full text-[8px] font-mono">
                      <thead>
                        <tr className="text-rmpg-500">
                          <th className="text-left px-1 py-0.5">Zone</th>
                          <th className="text-right px-1 py-0.5">Avg</th>
                          <th className="text-right px-1 py-0.5">Max</th>
                          <th className="text-right px-1 py-0.5">P95</th>
                        </tr>
                      </thead>
                      <tbody>
                        {speedAnalytics.zoneSpeedStats.slice(0, 15).map((z) => (
                          <tr key={z.beat_id} className="text-rmpg-300 hover:bg-surface-raised">
                            <td className="px-1 py-0.5 truncate max-w-[80px]" title={z.beat_name}>{z.beat_code}</td>
                            <td className="text-right px-1 py-0.5" style={{ color: speedToColor(z.avg_speed_mph / 2.237) }}>{z.avg_speed_mph.toFixed(0)}</td>
                            <td className="text-right px-1 py-0.5" style={{ color: speedToColor(z.max_speed_mph / 2.237) }}>{z.max_speed_mph.toFixed(0)}</td>
                            <td className="text-right px-1 py-0.5" style={{ color: speedToColor(z.p95_speed_mph / 2.237) }}>{z.p95_speed_mph.toFixed(0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Coverage Timeline toggle */}
                <button
                  onClick={() => speedAnalytics.setShowCoverageTimeline(!speedAnalytics.showCoverageTimeline)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                    speedAnalytics.showCoverageTimeline ? 'panel-inset bg-green-900/20 text-green-400' : 'text-rmpg-400 hover:bg-surface-raised'
                  }`}
                >
                  {speedAnalytics.showCoverageTimeline ? <Eye className="w-3 h-3 text-green-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
                  <Clock className="w-3 h-3" />
                  <span className="flex-1 text-left">Coverage Timeline</span>
                </button>
              </div>
            )}

            {/* ── Intelligence Layers ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              <div className="map-sidebar-section text-[9px] text-[#d4a017] uppercase font-semibold mb-2 px-1 pb-1 border-b border-[#d4a017]/15">Intelligence</div>
              {([
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

            {/* ── History Layers ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              <div className="map-sidebar-section text-[9px] text-[#d4a017] uppercase font-semibold mb-2 px-1 pb-1 border-b border-[#d4a017]/15">History</div>

              {/* Call History */}
              <button
                onClick={() => setShowCallHistory(!showCallHistory)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showCallHistory ? 'panel-inset bg-gray-900/20 text-gray-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Clock className="w-3 h-3" />
                <span className="flex-1 text-left">Call History</span>
                {showCallHistory && callHistory.count > 0 && (
                  <span className="text-[9px] font-mono">{callHistory.count}</span>
                )}
                {showCallHistory && callHistory.loading && (
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                )}
              </button>

              {/* Call History sub-controls */}
              {showCallHistory && (
                <div className="ml-5 mt-1 space-y-1.5 pb-1">
                  {/* Days slider */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[7px] text-rmpg-600 uppercase w-8">Days:</span>
                    {[1, 3, 7, 14, 30, 90].map((d) => (
                      <button
                        key={d}
                        onClick={() => setCallHistoryDays(d)}
                        className={`px-1.5 py-0 text-[7px] font-mono font-bold rounded-sm transition-colors ${
                          callHistoryDays === d
                            ? 'bg-gray-900/50 text-gray-400 border border-gray-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>

                  {/* Status checkboxes */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[7px] text-rmpg-600 uppercase w-8">Status:</span>
                    {['cleared', 'closed', 'archived'].map((s) => (
                      <button
                        key={s}
                        onClick={() => setCallHistoryStatuses(prev =>
                          prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
                        )}
                        className={`px-1.5 py-0 text-[7px] font-mono rounded-sm transition-colors ${
                          callHistoryStatuses.includes(s)
                            ? 'bg-gray-900/40 text-gray-300 border border-gray-700/40'
                            : 'text-rmpg-600 hover:text-rmpg-400'
                        }`}
                      >
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>

                  {/* Priority pills */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[7px] text-rmpg-600 uppercase w-8">Pri:</span>
                    {['P1', 'P2', 'P3', 'P4'].map((p) => {
                      const c = PRIORITY_TO_COLOR[p] || 'gray';
                      return (
                        <button
                          key={p}
                          onClick={() => setCallHistoryPriorities(prev =>
                            prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
                          )}
                          className={`px-1.5 py-0 text-[7px] font-mono font-bold rounded-sm transition-colors ${
                            callHistoryPriorities.includes(p)
                              ? (PRIORITY_PILL_CLASSES[c]?.active || 'bg-[#0c0c0c]/40 text-gray-400 border border-gray-700/40')
                              : 'text-rmpg-600 hover:text-rmpg-400'
                          }`}
                        >
                          {p}
                        </button>
                      );
                    })}
                    {callHistoryPriorities.length > 0 && (
                      <button
                        onClick={() => setCallHistoryPriorities([])}
                        className="text-[7px] text-rmpg-600 hover:text-rmpg-400 ml-0.5"
                        title="Clear priority filter"
                      >
                        All
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Incident Reports */}
              <button
                onClick={() => setShowIncidentReports(!showIncidentReports)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showIncidentReports ? 'panel-inset bg-emerald-900/20 text-emerald-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <FileText className="w-3 h-3" />
                <span className="flex-1 text-left">Incident Reports</span>
                {showIncidentReports && incidentReports.count > 0 && (
                  <span className="text-[9px] font-mono">{incidentReports.count}</span>
                )}
                {showIncidentReports && incidentReports.loading && (
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                )}
              </button>

              {/* Incident Reports sub-controls */}
              {showIncidentReports && (
                <div className="ml-5 mt-1 space-y-1.5 pb-1">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[7px] text-rmpg-600 uppercase w-8">Days:</span>
                    {[7, 14, 30, 60, 90].map((d) => (
                      <button
                        key={d}
                        onClick={() => setIncidentDays(d)}
                        className={`px-1.5 py-0 text-[7px] font-mono font-bold rounded-sm transition-colors ${
                          incidentDays === d
                            ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Analysis ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              <div className="map-sidebar-section text-[9px] text-[#d4a017] uppercase font-semibold mb-2 px-1 pb-1 border-b border-[#d4a017]/15">Analysis</div>

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

              {/* Safety Zones */}
              <button
                onClick={() => setShowSafetyZones(!showSafetyZones)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showSafetyZones ? 'panel-inset bg-red-900/20 text-red-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <ShieldAlert className="w-3 h-3" />
                <span className="flex-1 text-left">Safety Zones</span>
                {showSafetyZones && safetyZones.zones.length > 0 && (
                  <span className="text-[9px] font-mono">{safetyZones.zones.length}</span>
                )}
              </button>

              {/* Geofences */}
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => setShowGeofences(!showGeofences)}
                  className={`flex-1 flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                    showGeofences ? 'panel-inset bg-gray-900/20 text-gray-400' : 'text-rmpg-400 hover:bg-surface-raised'
                  }`}
                >
                  <Radar className="w-3 h-3" />
                  <span className="flex-1 text-left">Geofences</span>
                  {showGeofences && geofences.geofences.length > 0 && (
                    <span className="text-[9px] font-mono">{geofences.geofences.length}</span>
                  )}
                </button>
                {showGeofences && (
                  <button
                    onClick={() => geofences.setDrawingMode(!geofences.drawingMode)}
                    className={`px-1.5 py-1 text-[8px] font-bold rounded-sm transition-colors ${
                      geofences.drawingMode ? 'bg-gray-900/50 text-gray-300 border border-gray-700/50' : 'text-rmpg-500 hover:text-rmpg-300'
                    }`}
                  >
                    Draw
                  </button>
                )}
              </div>

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
            </div>

            {/* ── Tactical Layers ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              <div className="map-sidebar-section text-[9px] text-[#d4a017] uppercase font-semibold mb-2 px-1 pb-1 border-b border-[#d4a017]/15">Tactical</div>

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

              {/* Field Interviews */}
              <button
                onClick={() => setShowFieldInterviews(!showFieldInterviews)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showFieldInterviews ? 'panel-inset bg-gray-900/20 text-gray-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <FileSearch className="w-3 h-3" />
                <span className="flex-1 text-left">Field Interviews</span>
                {showFieldInterviews && fieldInterviews.count > 0 && (
                  <span className="text-[9px] font-mono">{fieldInterviews.count}</span>
                )}
              </button>
              {showFieldInterviews && (
                <div className="px-3 py-1 flex items-center gap-1">
                  {[7, 14, 30, 90].map((d) => (
                    <button
                      key={d}
                      onClick={() => setFiDays(d)}
                      className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                        fiDays === d
                          ? 'bg-gray-900/50 text-gray-400 border border-gray-700/50'
                          : 'text-rmpg-500 hover:text-rmpg-300'
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              )}

              {/* Dwell Time */}
              <button
                onClick={() => setShowDwellTime(!showDwellTime)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showDwellTime ? 'panel-inset bg-amber-900/20 text-amber-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Timer className="w-3 h-3" />
                <span className="flex-1 text-left">Dwell Time</span>
                {showDwellTime && dwellTime.dwellAlertCount > 0 && (
                  <span className="text-[9px] font-mono text-amber-400">{dwellTime.dwellAlertCount}</span>
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

              {/* Coverage Map */}
              <button
                onClick={() => setShowCoverage(!showCoverage)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showCoverage ? 'panel-inset bg-teal-900/20 text-teal-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Radar className="w-3 h-3" />
                <span className="flex-1 text-left">Coverage Map</span>
                {showCoverage && coverageGaps.coverageCount > 0 && (
                  <span className="text-[9px] font-mono">{coverageGaps.coverageCount}</span>
                )}
              </button>
              {showCoverage && (
                <div className="px-3 py-1 flex items-center gap-1">
                  {[1, 2, 3, 5].map((r) => (
                    <button
                      key={r}
                      onClick={() => setCoverageRadius(r)}
                      className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                        coverageRadius === r
                          ? 'bg-teal-900/50 text-teal-400 border border-teal-700/50'
                          : 'text-rmpg-500 hover:text-rmpg-300'
                      }`}
                    >
                      {r}mi
                    </button>
                  ))}
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

              {/* Repeat Addresses */}
              <button
                onClick={() => setShowRepeatAddresses(!showRepeatAddresses)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showRepeatAddresses ? 'panel-inset bg-orange-900/20 text-orange-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <AlertOctagon className="w-3 h-3" />
                <span className="flex-1 text-left">Repeat Addresses</span>
                {showRepeatAddresses && repeatAddresses.count > 0 && (
                  <span className="text-[9px] font-mono">{repeatAddresses.count}</span>
                )}
              </button>
              {showRepeatAddresses && (
                <div className="px-3 py-1 space-y-1">
                  <div className="flex items-center gap-1">
                    {[7, 14, 30, 90].map((d) => (
                      <button
                        key={d}
                        onClick={() => setRepeatDays(d)}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                          repeatDays === d
                            ? 'bg-orange-900/50 text-orange-400 border border-orange-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[7px] text-rmpg-500">Min:</span>
                    {[2, 3, 5, 10].map((c) => (
                      <button
                        key={c}
                        onClick={() => setRepeatMinCount(c)}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded-sm transition-colors ${
                          repeatMinCount === c
                            ? 'bg-orange-900/50 text-orange-400 border border-orange-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {c}x
                      </button>
                    ))}
                  </div>
                </div>
              )}

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

              {/* Traffic Layer */}
              <button
                onClick={() => toggleTraffic(mapInstanceRef.current)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${
                  showTraffic ? 'panel-inset bg-green-900/20 text-green-400' : 'text-rmpg-400 hover:bg-surface-raised'
                }`}
              >
                <Car className="w-3 h-3" />
                <span className="flex-1 text-left">Traffic</span>
                {showTraffic && <span className="led-dot led-green" style={{ width: 5, height: 5 }} />}
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

            {/* ── GeoJSON Spatial Layers Section ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              <button
                onClick={() => setShowGeoPanel(!showGeoPanel)}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors hover:bg-rmpg-800/50"
              >
                <Globe2 className="w-3 h-3 text-gray-400" />
                <span className="text-[10px] text-rmpg-300 flex-1">Spatial Layers</span>
                <span className="text-[9px] text-rmpg-500">
                  {Object.values(geoLayerStates).filter((s) => s.visible).length}/{geoConfigs.length}
                </span>
                {showGeoPanel ? <ChevronUp className="w-2.5 h-2.5 text-rmpg-500" /> : <ChevronDown className="w-2.5 h-2.5 text-rmpg-500" />}
              </button>
              {showGeoPanel && (
                <div className="mt-1 space-y-0.5">
                  {geoConfigs.map((cfg) => {
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
                        {state?.loaded && (state?.featureCount ?? 0) > 0 && (
                          <span className="text-[8px] font-mono" style={{ color: state.visible ? cfg.style.strokeColor : '#666666' }}>
                            {state.featureCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  <label className="flex items-center gap-2 px-2 py-1 text-[10px] cursor-pointer hover:bg-[#1a1a1a]">
                    <input
                      type="checkbox"
                      checked={tierColorsOn}
                      onChange={(e) => setTierColorsOn(e.target.checked)}
                      disabled={!hierarchyColors}
                      className="accent-[#d4a017]"
                    />
                    <span className={hierarchyColors ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>
                      Hierarchy Colors
                    </span>
                    {!hierarchyColors && (
                      <span className="text-[8px] text-[var(--text-muted)] ml-auto" title="Districts unavailable offline">⚠</span>
                    )}
                  </label>
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
                      <input
                        type="text"
                        value={newShiftPlanName}
                        onChange={(e) => setNewShiftPlanName(e.target.value)}
                        placeholder="Plan name..."
                        className="input-dark flex-1 px-1.5 py-0.5 text-[9px]"
                      />
                      <input
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
                                        <input
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
                                          <input
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
                                  <input
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
                    <input
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

            {/* ── Officer Safety ──────────────────────── */}
            <div className="mt-3 pt-3 border-t border-rmpg-700">
              <div className="text-[8px] text-rmpg-500 uppercase tracking-widest font-bold mb-2">Officer Safety</div>

              <button type="button" onClick={() => setShowSafetyDashboard(!showSafetyDashboard)} className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${showSafetyDashboard ? 'bg-red-900/20 text-red-400' : 'text-rmpg-400 hover:bg-surface-raised'}`}>
                <ShieldAlert className="w-3 h-3" /> Safety Dashboard
                {showSafetyDashboard && <span className="led-dot led-green ml-auto" />}
              </button>

              <button type="button" onClick={() => setShowThreatAssessment(!showThreatAssessment)} className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${showThreatAssessment ? 'bg-amber-900/20 text-amber-400' : 'text-rmpg-400 hover:bg-surface-raised'}`}>
                <Crosshair className="w-3 h-3" /> Threat Assessment
              </button>

              <button type="button" onClick={() => setShowUnitMonitoring(!showUnitMonitoring)} className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${showUnitMonitoring ? 'bg-gray-900/20 text-gray-400' : 'text-rmpg-400 hover:bg-surface-raised'}`}>
                <Target className="w-3 h-3" /> Unit Monitoring
                {unitSafety.loneOfficers?.length > 0 && <span className="led-dot led-amber ml-auto animate-led-pulse" />}
              </button>

              <button type="button" onClick={() => setShowPerimeterTools(!showPerimeterTools)} className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${showPerimeterTools ? 'bg-purple-900/20 text-purple-400' : 'text-rmpg-400 hover:bg-surface-raised'}`}>
                <Radar className="w-3 h-3" /> Perimeter Tools
              </button>

              <button type="button" onClick={() => setShowCorridorAnalysis(!showCorridorAnalysis)} className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${showCorridorAnalysis ? 'bg-gray-900/20 text-gray-400' : 'text-rmpg-400 hover:bg-surface-raised'}`}>
                <Route className="w-3 h-3" /> Corridor Analysis
              </button>

              <button type="button" onClick={() => setShowEnvironmentInfo(!showEnvironmentInfo)} className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${showEnvironmentInfo ? 'bg-green-900/20 text-green-400' : 'text-rmpg-400 hover:bg-surface-raised'}`}>
                <TreePine className="w-3 h-3" /> Environment
                {environment.lowVisibility && <span className="led-dot led-amber ml-auto" />}
              </button>

              <button type="button" onClick={() => setShowTacticalTools(!showTacticalTools)} className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${showTacticalTools ? 'bg-amber-900/20 text-amber-400' : 'text-rmpg-400 hover:bg-surface-raised'}`}>
                <Grab className="w-3 h-3" /> Tactical Tools
              </button>

              <button type="button" onClick={() => setShowAlertSystem(!showAlertSystem)} className={`w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-sm transition-colors ${showAlertSystem ? 'bg-red-900/20 text-red-400' : 'text-rmpg-400 hover:bg-surface-raised'}`}>
                <Siren className="w-3 h-3" /> Alert System
                {alerts.activeAlerts?.length > 0 && <span className="ml-auto text-[9px] font-mono text-red-400">{alerts.activeAlerts?.length}</span>}
              </button>

              {/* Safety Alert Broadcast Button */}
              <button type="button" onClick={() => setShowSafetyAlertModal(true)} className="w-full mt-2 toolbar-btn toolbar-btn-primary flex items-center justify-center gap-1.5 text-[10px] py-1.5" style={{ background: '#dc2626', border: '1px solid #ef4444' }}>
                <Siren className="w-3 h-3" /> BROADCAST ALERT
              </button>
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

        {/* ── Geofence Manager (floating, desktop only) ── */}
        {!isMobile && showGeofences && (
          <div className="absolute top-4 z-[1001]" style={{ left: layersPanelOpen ? 'calc(clamp(160px, 14vw, 200px) + 24px)' : 52, top: showPredictions ? 320 : 16 }}>
            <GeofenceManager
              geofences={geofences.geofences}
              loading={geofences.loading}
              onDraw={() => geofences.setDrawingMode(!geofences.drawingMode)}
              onDelete={async (id) => {
                try {
                  await apiFetch(`/map/geofences/${id}`, { method: 'DELETE' });
                  addToast('Geofence deleted', 'success');
                  // Refresh geofences by toggling
                  setShowGeofences(false);
                  setTimeout(() => setShowGeofences(true), 100);
                } catch { addToast('Failed to delete geofence', 'error'); }
              }}
              onToggle={async (id) => {
                const fence = geofences.geofences.find(g => g.id === id);
                if (!fence) return;
                try {
                  await apiFetch(`/map/geofences/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ is_active: fence.is_active ? 0 : 1 }),
                  });
                  addToast(`Geofence ${fence.is_active ? 'deactivated' : 'activated'}`, 'success');
                  setShowGeofences(false);
                  setTimeout(() => setShowGeofences(true), 100);
                } catch { addToast('Failed to toggle geofence', 'error'); }
              }}
              drawingMode={geofences.drawingMode}
              onClose={() => setShowGeofences(false)}
              alerts={geofences.alerts}
              onNavigate={(lat, lng) => panTo(lat, lng)}
            />
          </div>
        )}

        {/* ── Safety Dashboard Panel (floating, desktop only) ── */}
        {!isMobile && showSafetyDashboard && (
          <div className="absolute top-2 right-2 z-30" style={{ maxWidth: 320 }}>
            <SafetyDashboardPanel
              shiftRisk={shiftRisk as any}
              environment={safetyEnvironmentProp}
              unitSafety={safetyUnitSafetyProp}
              onClose={() => setShowSafetyDashboard(false)}
            />
          </div>
        )}

        {/* ── Safety Alert Modal ── */}
        {showSafetyAlertModal && (
          <SafetyAlertModal
            isOpen={showSafetyAlertModal}
            onClose={() => setShowSafetyAlertModal(false)}
            onBroadcast={(type, lat, lng, details, radius) => alerts.broadcastAlert(type as SafetyAlertType, lat, lng, details, radius)}
            defaultLat={mapInstanceRef.current?.getCenter()?.lat() ?? DEFAULT_CENTER.lat}
            defaultLng={mapInstanceRef.current?.getCenter()?.lng() ?? DEFAULT_CENTER.lng}
          />
        )}

        {/* Speed Graph Overlay */}
        {speedAnalytics.speedGraphUnit != null && (
          <SpeedGraphOverlay
            unitId={speedAnalytics.speedGraphUnit}
            callSign={playbackTrails.find(t => t.unit_id === speedAnalytics.speedGraphUnit)?.call_sign || ''}
            hours={breadcrumbHours}
            onClose={() => speedAnalytics.setSpeedGraphUnit(null)}
            playbackIdx={playbackUnit === speedAnalytics.speedGraphUnit ? playbackIdx : undefined}
          />
        )}

        {/* Coverage Timeline */}
        {speedAnalytics.showCoverageTimeline && (
          <CoverageTimeline
            data={speedAnalytics.coverageTimeline.length > 0 ? { intervals: speedAnalytics.coverageTimeline, total_beats: 719 } : null}
            expanded={speedAnalytics.showCoverageTimeline}
            onToggle={() => speedAnalytics.setShowCoverageTimeline(!speedAnalytics.showCoverageTimeline)}
          />
        )}

        {/* ── Weather / Environment Panel ── */}
        {!isMobile && showEnvironmentInfo && (
          <div className="absolute top-2 z-30" style={{ right: showThreatAssessment || showSafetyDashboard ? 320 : 8, maxWidth: 320, willChange: 'contents' }}>
            <WeatherPanel
              lighting={environment?.lighting || 'daylight'}
              sunriseSunset={environment?.sunriseSunset || null}
              lowVisibility={environment?.lowVisibility || false}
              weatherHazards={environment?.weatherHazards || { freezing: false, highWind: false, rain: false, snow: false, description: '' }}
              icyRoad={environment?.icyRoad || false}
              windCondition={environment?.windCondition || null}
              visibilityRange={environment?.visibilityRange || 10000}
              schoolZoneActive={environment?.schoolZoneActive || false}
              loading={environment?.loading || false}
              onRefresh={() => environment?.refresh?.()}
              onClose={() => setShowEnvironmentInfo(false)}
            />
          </div>
        )}

        {/* ── Advanced Heatmap Panel ── */}
        {!isMobile && advancedHeatmapEnabled && showHeatmap && (
          <div className="absolute top-2 z-30" style={{ left: layersPanelOpen ? 'calc(clamp(160px, 14vw, 200px) + 24px)' : 52, maxWidth: 400 }}>
            <AdvancedHeatmapPanel
              mode={advHeatmapMode}
              onModeChange={setAdvHeatmapMode}
              hourRange={advHeatmapHourRange}
              onHourRangeChange={setAdvHeatmapHourRange}
              dayFilter={advHeatmapDayFilter}
              onDayFilterChange={setAdvHeatmapDayFilter}
              colorScheme={advHeatmapColorScheme}
              onColorSchemeChange={setAdvHeatmapColorScheme}
              opacity={advHeatmapOpacity}
              onOpacityChange={setAdvHeatmapOpacity}
              radius={advHeatmapRadius}
              onRadiusChange={setAdvHeatmapRadius}
              resolution={advHeatmapResolution}
              onResolutionChange={setAdvHeatmapResolution}
              showClusters={advHeatmapShowClusters}
              onShowClustersChange={setAdvHeatmapShowClusters}
              clusterCount={advancedHeatmap.clusters?.length ?? 0}
              types={advHeatmapTypes}
              onTypesChange={setAdvHeatmapTypes}
              availableTypes={heatmapTypes}
              comparisonDays={advHeatmapComparisonDays}
              onComparisonDaysChange={setAdvHeatmapComparisonDays}
              temporalHour={advancedHeatmap.temporalHour}
              temporalPlaying={advancedHeatmap.temporalPlaying}
              temporalSpeed={advancedHeatmap.temporalSpeed}
              onTemporalHourChange={advancedHeatmap.setTemporalHour}
              onTemporalPlayingChange={advancedHeatmap.setTemporalPlaying}
              onTemporalSpeedChange={advancedHeatmap.setTemporalSpeed}
              stats={advancedHeatmap.stats}
              pointCount={advancedHeatmap.pointCount}
              comparisonPointCount={advancedHeatmap.comparisonPointCount}
              loading={advancedHeatmap.loading}
              onRefresh={() => advancedHeatmap.refreshHeatmap()}
              onClose={() => setAdvancedHeatmapEnabled(false)}
            />
          </div>
        )}

        {/* ── Threat Assessment Panel ── */}
        {!isMobile && showThreatAssessment && (
          <div className="absolute top-2 right-2 z-30" style={{ maxWidth: 300, top: showSafetyDashboard ? 340 : 8 }}>
            <ThreatAssessmentPanel
              assessment={threatAssessment.currentAssessment}
              approachRoutes={threatAssessment.approachRoutes}
              loading={threatAssessment.loading}
              onAssessCenter={() => {
                const c = mapInstanceRef.current?.getCenter();
                if (c) threatAssessment.assessLocation(c.lat(), c.lng());
              }}
              onGetApproachRoutes={() => {
                const c = mapInstanceRef.current?.getCenter();
                if (c) threatAssessment.getApproachRoutes(c.lat(), c.lng());
              }}
              onClear={() => threatAssessment.clearAssessment()}
              onClose={() => setShowThreatAssessment(false)}
            />
          </div>
        )}

        {/* ── Tactical Tools Panel ── */}
        {!isMobile && showTacticalTools && (
          <div className="absolute top-2 z-30" style={{ right: showThreatAssessment ? 320 : 8, maxWidth: 280 }}>
            <TacticalToolsPanel
              rallyPoint={tactical.rallyPoint}
              entryPoints={tactical.entryPoints}
              crowdDensity={(() => {
                const c = mapInstanceRef.current?.getCenter();
                return c ? tactical.estimateCrowdDensity(c.lat(), c.lng()) : 'Low (<50)';
              })()}
              onSetRallyPoint={() => {
                const c = mapInstanceRef.current?.getCenter();
                if (c) tactical.setRallyPoint(c.lat(), c.lng(), 'Rally Point');
              }}
              onClearRallyPoint={() => tactical.clearRallyPoint()}
              onShowCommandRings={() => {
                const c = mapInstanceRef.current?.getCenter();
                if (c) tactical.showCommandRings(c.lat(), c.lng());
              }}
              onClearCommandRings={() => tactical.clearCommandRings()}
              onShowK9Radius={() => {
                const c = mapInstanceRef.current?.getCenter();
                if (c) tactical.showK9Radius(c.lat(), c.lng());
              }}
              onClearK9Radius={() => tactical.clearK9Radius()}
              onShowHospitals={() => tactical.showHospitals()}
              onShowFireStations={() => tactical.showFireStations()}
              onHideEmergencyServices={() => tactical.hideEmergencyServices()}
              onAddEntryPoint={(label) => {
                const c = mapInstanceRef.current?.getCenter();
                if (c) tactical.addEntryPoint(c.lat(), c.lng(), label);
              }}
              onClearEntryPoints={() => tactical.clearEntryPoints()}
              onQuickDeploy={(preset: QuickDeployPreset) => {
                const c = mapInstanceRef.current?.getCenter();
                if (!c) return;
                const lat = c.lat();
                const lng = c.lng();
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
                addToast(`${preset.replace('_', ' ').toUpperCase()} deployed at map center`, 'success');
              }}
              onClose={() => setShowTacticalTools(false)}
            />
          </div>
        )}

        {/* ── Perimeter Tools Panel ── */}
        {!isMobile && showPerimeterTools && (
          <div className="absolute bottom-12 right-2 z-30" style={{ maxWidth: 280 }}>
            <PerimeterToolsPanel
              perimeterData={{
                quadrants: { NE: 0, NW: 0, SE: 0, SW: 0 },
                gaps: perimeter.coverageGaps.map((g, i) => `Gap ${i + 1}: ${g.lat.toFixed(4)}, ${g.lng.toFixed(4)}`),
                staging_suggestion: perimeter.stagingSuggestion ? { ...perimeter.stagingSuggestion, reason: 'Optimal staging based on unit positions' } : null,
              }}
              isDrawingContainment={false}
              containmentVertices={perimeter.containmentPolygon.length}
              hvtVisible={false}
              loading={perimeter.loading}
              onAnalyzeCoverage={() => {
                const c = mapInstanceRef.current?.getCenter();
                if (c) perimeter.showPerimeter(c.lat(), c.lng());
              }}
              onStartContainment={() => perimeter.startContainment()}
              onClearContainment={() => perimeter.endContainment()}
              onToggleHVTs={() => {
                const c = mapInstanceRef.current?.getCenter();
                if (c) perimeter.showPerimeter(c.lat(), c.lng());
              }}
              onClose={() => setShowPerimeterTools(false)}
            />
          </div>
        )}

        {/* ── Corridor Analysis Panel ── */}
        {!isMobile && showCorridorAnalysis && (
          <div className="absolute bottom-12 z-30" style={{ right: showPerimeterTools ? 300 : 8, maxWidth: 280 }}>
            <CorridorAnalysisPanel
              corridorData={corridor.corridorData}
              pursuitProjection={corridor.pursuitProjection}
              loading={corridor.loading}
              onAnalyzeCorridor={() => {
                const c = mapInstanceRef.current?.getCenter();
                if (c) corridor.analyzeCorridor(c.lat() - 0.01, c.lng() - 0.01, c.lat() + 0.01, c.lng() + 0.01);
              }}
              onShowPursuitProjection={(heading) => {
                const c = mapInstanceRef.current?.getCenter();
                if (c) corridor.showPursuitProjection(c.lat(), c.lng(), heading);
              }}
              onClearPursuit={() => corridor.clearPursuit()}
              onShowEscapeRoutes={() => {
                const c = mapInstanceRef.current?.getCenter();
                if (c) corridor.showEscapeRoutes(c.lat(), c.lng());
              }}
              onClearEscapeRoutes={() => corridor.clearEscapeRoutes()}
              onClearCorridor={() => corridor.clearCorridor()}
              onClose={() => setShowCorridorAnalysis(false)}
            />
          </div>
        )}

        {/* ── Alert System Panel ── */}
        {!isMobile && showAlertSystem && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30" style={{ maxWidth: 320, top: showEnvironmentInfo ? 48 : 8 }}>
            <AlertSystemPanel
              activeAlerts={alerts.activeAlerts}
              alertHistory={alerts.alertHistory}
              onAcknowledge={(id) => alerts.acknowledgeAlert(id)}
              onClear={(id) => alerts.clearAlert(id)}
              onClearAll={() => alerts.clearAllAlerts()}
              onClose={() => setShowAlertSystem(false)}
            />
          </div>
        )}

        {/* ── Call History Panel ── */}
        {!isMobile && showCallHistory && callHistory.calls.length > 0 && (
          <div className="absolute top-2 z-30" style={{ left: layersPanelOpen ? 'calc(clamp(160px, 14vw, 200px) + 24px)' : 52, top: showPredictions ? 340 : 8 }}>
            <CallHistoryPanel
              calls={callHistory.calls}
              loading={callHistory.loading}
              days={callHistoryDays}
              onClose={() => setShowCallHistory(false)}
            />
          </div>
        )}

        {/* ── Incident Reports Panel ── */}
        {!isMobile && showIncidentReports && (
          <div className="absolute top-2 z-30" style={{ left: layersPanelOpen ? 'calc(clamp(160px, 14vw, 200px) + 24px)' : 52, top: showCallHistory ? 200 : showPredictions ? 340 : 8 }}>
            <IncidentReportsPanel
              count={incidentReports.count}
              loading={incidentReports.loading}
              days={incidentDays}
              onClose={() => setShowIncidentReports(false)}
              reports={incidentReports.incidents}
              onDaysChange={setIncidentDays}
              onNavigate={(lat, lng) => panTo(lat, lng)}
            />
          </div>
        )}

        {/* ── Safety Zones Panel ── */}
        {!isMobile && showSafetyZones && (
          <div className="absolute bottom-12 z-30" style={{ left: layersPanelOpen ? 'calc(clamp(160px, 14vw, 200px) + 24px)' : 52 }}>
            <SafetyZonesPanel
              zones={safetyZones.zones}
              loading={safetyZones.loading}
              days={safetyZones.days}
              onDaysChange={safetyZones.setDays}
              onRefresh={safetyZones.refresh}
              onNavigate={(lat, lng) => panTo(lat, lng)}
              onClose={() => setShowSafetyZones(false)}
            />
          </div>
        )}

        {/* ── Analysis Intel Dashboard ── */}
        {!isMobile && showAnalysisDashboard && (
          <div className="absolute top-2 right-2 z-30" style={{ maxWidth: 320, top: showSafetyDashboard ? 340 : showThreatAssessment ? 340 : 8 }}>
            <AnalysisDashboardPanel
              data={analysisSummary.data}
              loading={analysisSummary.loading}
              onRefresh={analysisSummary.refresh}
              onNavigate={(lat, lng) => panTo(lat, lng)}
              onClose={() => setShowAnalysisDashboard(false)}
            />
          </div>
        )}

        {/* ── Tactical Summary Panel ── */}
        {!isMobile && (showPatrolCheckpoints || showFieldInterviews || showDwellTime || showResponseRadius || showEnforcementClusters || showCoverage || showFleetVehicles || showRepeatAddresses || showDaylight) && (
          <div className="absolute bottom-12 right-2 z-30" style={{ maxWidth: 260, bottom: showPerimeterTools || showCorridorAnalysis ? 280 : 48 }}>
            <TacticalSummaryPanel
              showCheckpoints={showPatrolCheckpoints}
              checkpointCount={patrolCheckpoints.checkpoints.length}
              overdueCount={patrolCheckpoints.overdueCount}
              completionPct={patrolCheckpoints.completionPct}
              showFieldInterviews={showFieldInterviews}
              fiCount={fieldInterviews.count}
              fiDays={fiDays}
              showDwellTime={showDwellTime}
              dwellAlertCount={dwellTime.dwellAlertCount}
              showResponseRadius={showResponseRadius}
              responseActive={!!responseRadius.activePoint}
              showEnforcement={showEnforcementClusters}
              enforcementTotal={enforcementClusters.totalRecords}
              enforcementType={enforcementType}
              enforcementDays={enforcementDays}
              showCoverage={showCoverage}
              coverageCount={coverageGaps.coverageCount}
              showFleet={showFleetVehicles}
              fleetCount={fleetVehicles.count}
              showRepeat={showRepeatAddresses}
              repeatCount={repeatAddresses.count}
              repeatDays={repeatDays}
              showDaylight={showDaylight}
              daylightPhase={daylight.phase}
              onClose={() => {
                // Close the summary panel — doesn't disable layers
              }}
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
              background: isLightMapStyle(mapStyle) ? 'rgba(255,255,255,0.85)' : isSatelliteStyle(mapStyle) ? 'rgba(6,12,20,0.88)' : 'rgba(6,12,20,0.92)',
              border: isLightMapStyle(mapStyle) ? '1px solid rgba(0,0,0,0.12)' : '1px solid rgba(30,48,72,0.5)',
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
              background: isLightMapStyle(mapStyle) ? 'rgba(255,255,255,0.88)' : isSatelliteStyle(mapStyle) ? 'rgba(6,12,20,0.92)' : 'rgba(6,12,20,0.95)',
              border: isLightMapStyle(mapStyle) ? '1px solid rgba(0,0,0,0.15)' : '1px solid rgba(30,48,72,0.6)',
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

        {/* ── Keyboard Shortcuts Help (triggered by `?` key) ── */}
        <KeyboardShortcutsHelp open={showShortcutsHelp} onClose={() => setShowShortcutsHelp(false)} />

        {/* ── Breadcrumb Status Chip + Trail Stats/Export (top-left) ── */}
        {/* Shows unit count + window + color mode; hovering reveals per-unit
            stats (miles/duration/max-mph). Clicking EXPORT downloads one
            .gpx file per trail into the browser downloads folder — good for
            shift reports or legal discovery. */}
        {showBreadcrumbs && playbackTrails.length > 0 && (
          <div
            className="absolute z-[999]"
            style={{
              top: 64,
              left: 16,
              background: 'rgba(6,12,20,0.92)',
              border: '1px solid #2b2b2b',
              padding: '4px 10px',
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontSize: 10,
              color: '#9ca3af',
              letterSpacing: '0.08em',
              borderRadius: 2,
            }}
            title={playbackTrails
              .map((t) => {
                const stats = computeTrailStats(t);
                return `${t.call_sign}: ${formatTrailStats(stats)}`;
              })
              .join('\n')}
          >
            <span style={{ color: '#d4a017', fontWeight: 900, marginRight: 6 }}>TRAILS</span>
            <span>{playbackTrails.length} unit{playbackTrails.length === 1 ? '' : 's'}</span>
            <span style={{ color: '#5a6e80', margin: '0 6px' }}>·</span>
            <span>last {BREADCRUMB_HOUR_PRESETS.find((p) => p.hours === breadcrumbHours)?.label || `${breadcrumbHours}h`}</span>
            <span style={{ color: '#5a6e80', margin: '0 6px' }}>·</span>
            <span style={{ color: '#6b7280', textTransform: 'uppercase' }}>{breadcrumbColorMode}</span>
            <button
              type="button"
              onClick={() => setShowIdleZones(!showIdleZones)}
              style={{
                marginLeft: 8,
                padding: '1px 6px',
                background: showIdleZones ? '#f59e0b30' : '#88888820',
                border: showIdleZones ? '1px solid #f59e0b80' : '1px solid #88888850',
                color: showIdleZones ? '#f59e0b' : '#a0a0a0',
                fontSize: 8,
                fontWeight: 900,
                fontFamily: 'inherit',
                cursor: 'pointer',
                letterSpacing: '0.08em',
                borderRadius: 2,
              }}
              title="Highlight stretches where a unit was stationary >10min"
            >
              IDLE
            </button>
            <button
              type="button"
              onClick={() => {
                for (const trail of playbackTrails) downloadTrailAsGpx(trail);
              }}
              style={{
                marginLeft: 4,
                padding: '1px 6px',
                background: '#88888820',
                border: '1px solid #88888850',
                color: '#a0a0a0',
                fontSize: 8,
                fontWeight: 900,
                fontFamily: 'inherit',
                cursor: 'pointer',
                letterSpacing: '0.08em',
                borderRadius: 2,
              }}
              title="Download each unit's trail as a GPX file"
            >
              ⇩ GPX
            </button>
            <button
              type="button"
              onClick={() => setShowRouteCompare((v) => !v)}
              style={{
                marginLeft: 4,
                padding: '1px 6px',
                background: showRouteCompare ? '#d4a01730' : '#88888820',
                border: showRouteCompare ? '1px solid #d4a01780' : '1px solid #88888850',
                color: showRouteCompare ? '#d4a017' : '#a0a0a0',
                fontSize: 8,
                fontWeight: 900,
                fontFamily: 'inherit',
                cursor: 'pointer',
                letterSpacing: '0.08em',
                borderRadius: 2,
              }}
              title="Compare two units' trail stats side-by-side"
            >
              ⇆ COMPARE
            </button>
          </div>
        )}

        {/* ── Route Comparison Panel (bottom-right, when toggled) ── */}
        {showBreadcrumbs && showRouteCompare && (
          <RouteComparePanel
            trails={playbackTrails}
            unitAId={compareUnitA}
            unitBId={compareUnitB}
            onChangeA={setCompareUnitA}
            onChangeB={setCompareUnitB}
            onClose={() => setShowRouteCompare(false)}
          />
        )}

        {/* ── Trail Time-Window Scrubber (top-left, below chip) ── */}
        {/* Two range inputs that narrow the rendered trail window without
            re-fetching. fromH is the older edge, toH the newer one. The
            filter runs in a useMemo, so drags feel live even on ≤2k points
            per unit. Rendered only when there's something to scrub. */}
        {showBreadcrumbs && playbackTrailsRaw.length > 0 && (
          <div
            className="absolute z-[999]"
            style={{
              top: 90,
              left: 16,
              background: 'rgba(6,12,20,0.92)',
              border: '1px solid #2b2b2b',
              padding: '4px 10px',
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontSize: 9,
              color: '#9ca3af',
              letterSpacing: '0.05em',
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 320,
            }}
          >
            <span style={{ color: '#d4a017', fontWeight: 900 }}>WINDOW</span>
            <span title="From (hours ago)" style={{ color: '#6b7280' }}>{trailWindowFromH.toFixed(1)}h</span>
            <input
              type="range"
              min={0}
              max={breadcrumbHours}
              step={0.25}
              value={trailWindowFromH}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setTrailWindowFromH(Math.max(v, trailWindowToH + 0.1));
              }}
              aria-label="Trail window start (hours ago)"
              style={{ flex: 1, accentColor: '#d4a017', cursor: 'ew-resize' }}
            />
            <span style={{ color: '#6b7280' }}>now</span>
            <input
              type="range"
              min={0}
              max={breadcrumbHours}
              step={0.25}
              value={trailWindowToH}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setTrailWindowToH(Math.min(v, trailWindowFromH - 0.1));
              }}
              aria-label="Trail window end (hours ago)"
              style={{ flex: 1, accentColor: '#d4a017', cursor: 'ew-resize' }}
            />
            <span title="To (hours ago)" style={{ color: '#6b7280' }}>{trailWindowToH.toFixed(1)}h</span>
            <button
              type="button"
              onClick={() => { setTrailWindowFromH(breadcrumbHours); setTrailWindowToH(0); }}
              style={{
                padding: '1px 5px',
                background: '#88888820',
                border: '1px solid #88888850',
                color: '#a0a0a0',
                fontSize: 8,
                fontWeight: 900,
                fontFamily: 'inherit',
                cursor: 'pointer',
                letterSpacing: '0.08em',
                borderRadius: 2,
              }}
              title="Reset window to full fetched range"
            >
              RESET
            </button>
          </div>
        )}

        {/* ── Heatmap Legend (bottom-right) ── */}
        {/* Visible whenever any heatmap variant is on; swaps gradient for
            the "risk" mode so the legend always matches what's on the map. */}
        {showHeatmap && (
          <HeatmapLegend
            mode={heatmapMode === 'risk' ? 'risk' : 'calls'}
            hint={`last ${heatmapDays} day${heatmapDays === 1 ? '' : 's'}`}
            position="bottom-right"
          />
        )}

        {/* ── Route Info Panel (bottom-left, top on mobile) ── */}
        {/* Lists one row per active unit route; colors match the polylines
            (green=fastest, amber=mid, red=slowest) for instant "who's closest"
            read. Single Clear All action collapses the whole set. */}
        {activeRoutes.length > 0 && (
          <div
            className="absolute z-[1000] backdrop-blur-md"
            style={{
              ...(isMobile
                ? { top: 56, left: 8, right: 8 }
                : { bottom: 48, left: 16, minWidth: 220 }),
              background: isLightMapStyle(mapStyle) ? 'rgba(255,255,255,0.92)' : 'rgba(6,12,20,0.95)',
              border: isLightMapStyle(mapStyle) ? '1px solid rgba(136, 136, 136,0.3)' : '1px solid #88888850',
              padding: '8px 14px',
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              borderRadius: 2,
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: '#888888', fontWeight: 900, letterSpacing: '0.05em' }}>
                ROUTES ({activeRoutes.length})
              </span>
              <button
                onClick={clearAllRoutes}
                style={{ background: 'none', border: 'none', color: '#666666', cursor: 'pointer', fontSize: 12, padding: '0 0 0 8px' }}
                title="Clear all routes"
              >
                ✕
              </button>
            </div>
            {activeRoutes
              .slice()
              .sort((a, b) => a.durationSec - b.durationSec)
              .map((r) => (
                <div
                  key={r.unitCallSign}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '3px 0',
                    borderTop: '1px solid ' + (isLightMapStyle(mapStyle) ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'),
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      background: r.color,
                      display: 'inline-block',
                      borderRadius: 2,
                      flexShrink: 0,
                      boxShadow: `0 0 6px ${r.color}80`,
                    }}
                    title="Route color"
                  />
                  <span style={{ fontSize: 10, color: '#888888', fontWeight: 900, letterSpacing: '0.05em', minWidth: 70 }}>
                    {r.unitCallSign}
                  </span>
                  <span style={{ fontSize: 13, color: isLightMapStyle(mapStyle) ? '#181818' : '#fff', fontWeight: 900 }}>{r.eta}</span>
                  <span style={{ fontSize: 10, color: isLightMapStyle(mapStyle) ? '#666666' : '#999999', marginLeft: 'auto' }}>{r.distance}</span>
                </div>
              ))}
            {routeLoading && (
              <div style={{ fontSize: 8, color: '#f59e0b', marginTop: 4 }}>Updating route…</div>
            )}
          </div>
        )}

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
                background: 'rgba(13, 21, 32, 0.9)',
                border: '1px solid #2b2b2b',
              }}
            >
              <button
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) map.setZoom((map.getZoom() ?? 12) + 1);
                }}
                className="flex items-center justify-center transition-colors hover:bg-white/10 active:bg-white/20"
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
                className="flex items-center justify-center transition-colors hover:bg-white/10 active:bg-white/20"
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
              background: 'rgba(20,30,43,0.80)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              borderTop: '1px solid rgba(30,48,72,0.5)',
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
              <div className="led-dot" style={{ backgroundColor: (unitSafety.coveragePercent ?? 0) >= 70 ? '#22c55e' : (unitSafety.coveragePercent ?? 0) >= 40 ? '#f59e0b' : '#ef4444', width: 5, height: 5 }} />
              <span className="text-[9px] font-mono text-rmpg-500 uppercase tracking-wider">Coverage</span>
              <span className="text-[9px] font-mono font-bold text-rmpg-200">{unitSafety.coveragePercent ?? 0}%</span>
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
                <input
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
              background: 'rgba(13, 21, 32, 0.9)',
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
                    <div className="flex gap-1 flex-wrap">
                      {BREADCRUMB_HOUR_PRESETS.map(({ hours: h, label }) => (
                        <button
                          key={h}
                          onClick={() => setBreadcrumbHours(h)}
                          className={`flex-1 min-w-[44px] py-2 text-xs font-bold rounded-sm ${
                            breadcrumbHours === h
                              ? 'bg-gray-600 text-white'
                              : 'bg-rmpg-800 text-rmpg-400 hover:bg-rmpg-700'
                          }`}
                        >
                          {label}
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
