import React, { useEffect, useRef, useState, useCallback } from 'react';
import { loadGoogleMaps, DARK_MAP_STYLE, NIGHT_NAV_STYLE, TERRAIN_STYLE, registerMapInstance, unregisterMapInstance, updateMapStyles, onOnlineRetryMaps, monitorTileLoading, getFallbackMapImage, addOfflineTileLayer } from '../../utils/googleMapsLoader';
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
import { useToast } from '../../components/ToastProvider';
import { localToday, dateToLocalYMD } from '../../utils/dateUtils';
import { useGeoJsonLayers, GEO_LAYER_CONFIGS, getSectionColor, type BeatDistrictEntry } from '../../hooks/useGeoJsonLayers';
import { useEventPlanning, PLAN_COLORS, PLAN_TYPE_LABELS, type PlanItemType } from '../../hooks/useEventPlanning';
import { useShiftPlanning, SHIFT_TYPES, type ShiftType } from '../../hooks/useShiftPlanning';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useMapRouting } from '../../hooks/useMapRouting';
import MobileBottomSheet from '../../components/mobile/MobileBottomSheet';
import OfflineMapFallback from '../../components/OfflineMapFallback';
import type { MapUnit as Unit, ActiveCall, MapProperty as Property, MapStyleId } from './utils/mapConstants';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS, MAP_STYLE_LABELS, MAP_STYLE_DESCRIPTIONS, getIncidentCategory, isLightMapStyle, isSatelliteStyle } from './utils/mapConstants';
import { buildUnitMarkerContent, buildIncidentMarkerContent, buildPropertyMarkerContent, buildSelfPositionMarker, getOverlayMarkerClass, injectKeyframes, type OverlayMarker } from './utils/mapMarkerBuilders';

// ============================================================
// Constants
// ============================================================

// Unit colors for breadcrumb trails — cycle through distinct colors per unit
const TRAIL_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#c084fc'];

// Speed-to-color mapping for breadcrumb speed mode (m/s → mph thresholds)
const speedToColor = (mps: number | null): string => {
  if (mps == null || mps < 0.5) return '#6b7280';    // Stationary — gray
  const mph = mps * 2.237;
  if (mph < 15) return '#22c55e';   // Slow — green
  if (mph < 35) return '#eab308';   // City — yellow
  if (mph < 55) return '#f97316';   // Arterial — orange
  return '#ef4444';                 // Highway/pursuit — red
};

// Unit status to color for breadcrumb status mode
const statusToColor = (status: string): string => {
  switch (status) {
    case 'dispatched': return '#f59e0b';  // amber
    case 'enroute':    return '#3b82f6';  // blue
    case 'onscene':    return '#ef4444';  // red
    case 'available':  return '#22c55e';  // green
    case 'busy':       return '#8b5cf6';  // purple
    case 'off_duty':   return '#6b7280';  // gray
    default:           return '#5a6e80';
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
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<any[]>([]); // AdvancedMarkerElement or OverlayView
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const heatmapLayerRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);
  const trackingLinesRef = useRef<google.maps.Polyline[]>([]);
  const useAdvancedMarkersRef = useRef(false); // whether AdvancedMarkerElement is available
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapRetry, setMapRetry] = useState(0); // bump to re-trigger Google Maps init
  const [tilesStalled, setTilesStalled] = useState(false);
  const [retryingGmaps, setRetryingGmaps] = useState(false);

  // Determine if the error is an API key/auth issue vs a connectivity issue.
  // Auth errors → show config dialog.  Connectivity errors → show Leaflet fallback.
  const isAuthError = mapError != null && (mapError.includes('API key') || mapError.includes('authentication') || mapError.includes('not configured'));
  const showOfflineFallback = mapError != null && !isAuthError;
  const tileMonitorCleanupRef = useRef<(() => void) | null>(null);
  const offlineTileCleanupRef = useRef<(() => void) | null>(null);

  const [layers, setLayers] = useState({ units: true, incidents: true, properties: true });

  // Data state
  const [units, setUnits] = useState<Unit[]>([]);
  const [calls, setCalls] = useState<ActiveCall[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Heat map state
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showTrackingLines, setShowTrackingLines] = useState(true);
  const [heatmapData, setHeatmapData] = useState<any[]>([]);
  const [heatmapDays, setHeatmapDays] = useState(30);
  const [heatmapMode, setHeatmapMode] = useState<'all' | 'risk' | 'type'>('all');
  const [heatmapTypeFilter, setHeatmapTypeFilter] = useState('');
  const [heatmapTypes, setHeatmapTypes] = useState<{ incident_type: string; count: number }[]>([]);

  // Breadcrumb trail state
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(true);
  const [breadcrumbHours, setBreadcrumbHours] = useState(8);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [breadcrumbColorMode, setBreadcrumbColorMode] = useState<'unit' | 'speed' | 'status'>('unit');
  const breadcrumbLinesRef = useRef<google.maps.Polyline[]>([]);

  // Trail playback state
  const [playbackTrails, setPlaybackTrails] = useState<any[]>([]);
  const [playbackUnit, setPlaybackUnit] = useState<number | null>(null);
  const [playbackIdx, setPlaybackIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(2);
  const playbackMarkerRef = useRef<any>(null);
  const playbackAnimRef = useRef<number | null>(null);

  // Layers panel (left) collapsed/expanded
  const [layersPanelOpen, setLayersPanelOpen] = useState(true);

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = usePersistedTab('rmpg_map_sidebar', 'units', ['units', 'calls'] as const);

  // Map style — seed from server preference if user hasn't picked one locally yet
  const serverDefaultStyle = (userPrefs?.default_map_style || 'dark') as MapStyleId;
  const [mapStyle, setMapStyle] = usePersistedTab('rmpg_map_style', serverDefaultStyle, ['dark', 'satellite', 'hybrid', 'streets', 'terrain', 'night_nav'] as const);
  const [showMapStyles, setShowMapStyles] = useState(false);

  // Routing
  const { activeRoute, routeLoading, showRoute, clearRoute, updateOrigin } = useMapRouting({ map: mapInstanceRef.current });

  // Search (sidebar)
  const [searchQuery, setSearchQuery] = useState('');

  // Address search (map geocoding)
  const [addressSearch, setAddressSearch] = useState('');
  const [addressResults, setAddressResults] = useState<{ description: string; place_id: string }[]>([]);
  const [showAddressResults, setShowAddressResults] = useState(false);
  const addressSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressMarkerRef = useRef<any>(null);
  const addressDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    apiFetch<any[]>('/dispatch/districts').then((districts) => {
      if (cancelled || !districts) return;
      const map = new Map<string, Map<string, BeatDistrictEntry>>();
      const sectionSet = new Map<string, string>();
      for (const d of districts) {
        if (!map.has(d.zone_id)) map.set(d.zone_id, new Map());
        map.get(d.zone_id)!.set(d.beat_id, {
          sectionId: d.section_id,
          sectionName: d.section_name,
          zoneId: d.zone_id,
          zoneName: d.zone_name,
          beatId: d.beat_id,
          beatName: d.beat_name,
          beatDescriptor: d.beat_descriptor || '',
          dispatchCode: d.dispatch_code,
        });
        sectionSet.set(d.section_id, d.section_name);
      }
      setBeatDistrictMap(map);
      setDistrictSections(Array.from(sectionSet.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id)));
    }).catch(() => {});
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
  });
  const [showGeoPanel, setShowGeoPanel] = useState(false);

  // Event planning overlays
  const eventPlanning = useEventPlanning({
    map: mapInstanceRef.current,
    infoWindow: infoWindowRef.current,
  });
  const [showEventPanel, setShowEventPanel] = useState(false);
  const [newPlanName, setNewPlanName] = useState('');

  // ============================================================
  // Data Fetching
  // ============================================================

  const fetchUnits = useCallback(async () => {
    try {
      const data = await apiFetch<Unit[]>('/dispatch/units');
      setUnits(data || []);
    } catch (err) {
      console.error('Error fetching units:', err);
      setError('Failed to load units');
    }
  }, []);

  const fetchCalls = useCallback(async () => {
    try {
      const data = await apiFetch<ActiveCall[]>('/dispatch/queue');
      setCalls(data || []);
    } catch (err) {
      console.error('Error fetching calls:', err);
      setError('Failed to load active calls');
    }
  }, []);

  const fetchProperties = useCallback(async () => {
    try {
      const data = await apiFetch<Property[]>('/records/properties');
      setProperties(data || []);
    } catch (err) {
      console.error('Error fetching properties:', err);
      setError('Failed to load properties');
    }
  }, []);

  const fetchAllData = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(null); }
    await Promise.all([fetchUnits(), fetchCalls(), fetchProperties()]);
    if (!options?.silent) setLoading(false);
  }, [fetchUnits, fetchCalls, fetchProperties]);

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
    if (!showHeatmap) { setHeatmapData([]); return; }
    let cancelled = false;
    let url = `/dispatch/heatmap?days=${heatmapDays}&mode=${heatmapMode}`;
    if (heatmapMode === 'type' && heatmapTypeFilter) url += `&type=${encodeURIComponent(heatmapTypeFilter)}`;
    apiFetch<any[]>(url)
      .then((data) => { if (!cancelled) setHeatmapData(data || []); })
      .catch(() => { if (!cancelled) setHeatmapData([]); });
    return () => { cancelled = true; };
  }, [showHeatmap, heatmapDays, heatmapMode, heatmapTypeFilter]);

  // Fetch available incident types for heatmap type filter
  useEffect(() => {
    if (!showHeatmap) return;
    let cancelled = false;
    apiFetch<{ incident_type: string; count: number }[]>('/dispatch/heatmap/types')
      .then((data) => { if (!cancelled) setHeatmapTypes(data || []); })
      .catch(() => {});
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

    // If a map instance already exists (e.g. from a previous successful init
    // before React StrictMode's second mount), just flag it loaded and bail.
    if (mapInstanceRef.current) {
      setMapLoaded(true);
      return;
    }

    const apiKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string;
    if (!apiKey) {
      setMapError('Google Maps API key not configured. Add VITE_GOOGLE_MAPS_API_KEY to client/.env');
      setMapLoaded(false);
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
    let cancelled = false;
    const MAX_RETRIES = 8;
    const RETRY_DELAYS = [2000, 4000, 8000, 12000, 16000, 20000, 25000, 30000]; // ms
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
        backgroundColor: '#060c14',
        // 'greedy' allows single-finger pan on mobile/tablet — critical for
        // in-vehicle use where two-finger gestures are awkward while driving.
        gestureHandling: 'greedy',
      });

      mapInstanceRef.current = map;
      registerMapInstance(map);

      // Attach offline tile layer — renders pre-downloaded CartoDB dark_matter
      // tiles beneath Google tiles. When online, Google tiles cover them.
      // When offline/stalled, the offline tiles show through instead of black.
      if (offlineTileCleanupRef.current) offlineTileCleanupRef.current();
      offlineTileCleanupRef.current = addOfflineTileLayer(map);

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

      // AdvancedMarkerElement requires a cloud mapId on the Map constructor.
      // Without mapId, markers are created but silently never render.
      // Since we use a raster styled map (no mapId), always use the
      // OverlayView-based fallback which works reliably on all map types.
      useAdvancedMarkersRef.current = false;
      devLog('[MapPage] Using OverlayView markers (no mapId configured)');

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

    function attemptLoad(attempt: number) {
      if (cancelled) return;

      // If device is offline, pause retries and wait for connectivity
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        devWarn('[MapPage] Device offline — pausing retries until connectivity returns');
        const onBack = () => {
          window.removeEventListener('online', onBack);
          if (!cancelled) {
            devLog('[MapPage] Back online — resuming map load');
            attemptLoad(attempt); // resume at same attempt count (don't penalize for offline time)
          }
        };
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
            setTimeout(() => attemptLoad(attempt + 1), delay);
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

    attemptLoad(0);

    // Auto-retry when device comes back online (covers the case where all retries
    // exhausted during a dead zone, then WiFi reconnects while the error screen is showing)
    const unsubOnline = onOnlineRetryMaps(apiKey, () => {
      if (!cancelled && !mapInstanceRef.current) {
        devLog('[MapPage] Online auto-retry triggered — reinitializing map');
        setMapError(null);
        initMap();
      }
    });

    return () => {
      cancelled = true; // Stop any pending retries
      unsubOnline();
      if (dismissTimer) clearTimeout(dismissTimer);
      if (dismissObserver) dismissObserver.disconnect();
      if (tileMonitorCleanupRef.current) { tileMonitorCleanupRef.current(); tileMonitorCleanupRef.current = null; }
      if (offlineTileCleanupRef.current) { offlineTileCleanupRef.current(); offlineTileCleanupRef.current = null; }
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
              const routeBtnHtml = (assignedCall && assignedCall.latitude && assignedCall.longitude && unit.latitude && unit.longitude)
                ? `<button data-route-unit="${escapeHtml(unit.call_sign)}" data-route-call="${escapeHtml(assignedCall.call_number)}"
                     data-route-ulat="${unit.latitude}" data-route-ulng="${unit.longitude}"
                     data-route-clat="${assignedCall.latitude}" data-route-clng="${assignedCall.longitude}"
                     style="margin-top:6px;width:100%;padding:3px 0;background:#3b82f620;border:1px solid #3b82f650;color:#60a5fa;font-size:9px;font-weight:900;font-family:monospace;cursor:pointer;letter-spacing:0.5px;text-transform:uppercase;">
                     ▶ Route to ${escapeHtml(assignedCall.call_number)}
                   </button>`
                : '';

              infoWindowRef.current?.setContent(`
                <div style="min-width:200px;font-family:'Courier New',monospace;background:#0d1520;color:#e5e7eb;padding:10px;border:1px solid ${statusColor}50;border-radius:4px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #1e3048;">
                    <div style="width:10px;height:10px;border-radius:50%;background:${statusColor};box-shadow:0 0 8px ${statusColor}80;"></div>
                    <span style="font-weight:900;font-size:15px;color:${statusColor};letter-spacing:-0.5px;">${escapeHtml(unit.call_sign)}</span>
                    <span style="margin-left:auto;font-size:9px;text-transform:uppercase;color:${statusColor};font-weight:800;letter-spacing:1px;padding:1px 6px;background:${statusColor}20;border:1px solid ${statusColor}30;border-radius:2px;">${escapeHtml(unit.status.replace(/_/g, ' '))}</span>
                  </div>
                  <div style="font-size:11px;color:#d1d5db;margin-bottom:2px;">${escapeHtml(unit.officer_name)}</div>
                  ${unit.vehicle ? `<div style="font-size:10px;color:#5a6e80;margin-bottom:6px;">Vehicle: ${escapeHtml(unit.vehicle)}</div>` : ''}
                  ${unit.call_number ? `
                    <div style="margin-top:6px;padding-top:6px;border-top:1px solid #1e3048;">
                      <div style="font-size:10px;color:#60a5fa;font-weight:bold;">${escapeHtml(unit.call_number)}</div>
                      ${unit.current_call_type ? `<div style="font-size:10px;color:#d1d5db;">${escapeHtml(formatIncidentType(unit.current_call_type))}</div>` : ''}
                      <div style="font-size:9px;color:#5a6e80;margin-top:2px;">${escapeHtml(location)}</div>
                    </div>
                  ` : `<div style="font-size:9px;color:#5a6e80;margin-top:4px;">${escapeHtml(location)}</div>`}
                  ${routeBtnHtml}
                </div>
              `);
              infoWindowRef.current?.setPosition({ lat: unit.latitude!, lng: unit.longitude! });
              infoWindowRef.current?.open(map);
            },
          });

          markersRef.current.push(marker);
        }
      });
    }

    // Add incident markers
    if (layers.incidents) {
      calls.forEach((call) => {
        if (call.latitude != null && call.longitude != null) {
          const content = buildIncidentMarkerContent(call.priority, call.incident_type, call.call_number);
          const pColor = PRIORITY_COLORS[call.priority] || '#5a6e80';

          const marker = createMarker({
            map,
            position: { lat: call.latitude, lng: call.longitude },
            content,
            zIndex: call.priority === 'P1' ? 2000 : 500,
            title: `${call.call_number} - ${formatIncidentType(call.incident_type)}`,
            onClick: () => {
              const assignedUnits = units.filter(u => String(u.current_call_id) === String(call.id));
              let unitsHtml = '';
              if (assignedUnits.length > 0) {
                unitsHtml = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #1e3048;">
                  <div style="font-size:9px;color:#5a6e80;margin-bottom:4px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">ASSIGNED UNITS (${assignedUnits.length})</div>
                  ${assignedUnits.map(u => {
                    const uc = UNIT_STATUS_COLORS[u.status] || '#5a6e80';
                    const routeBtn = (u.latitude != null && u.longitude != null && call.latitude != null && call.longitude != null)
                      ? `<button data-route-unit="${escapeHtml(u.call_sign)}" data-route-call="${escapeHtml(call.call_number)}"
                           data-route-ulat="${u.latitude}" data-route-ulng="${u.longitude}"
                           data-route-clat="${call.latitude}" data-route-clng="${call.longitude}"
                           style="margin-left:auto;padding:1px 5px;background:#3b82f620;border:1px solid #3b82f650;color:#60a5fa;font-size:8px;font-weight:900;font-family:monospace;cursor:pointer;">
                           ▶ ROUTE
                         </button>`
                      : '';
                    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                      <div style="width:6px;height:6px;border-radius:50%;background:${uc};box-shadow:0 0 4px ${uc}80;"></div>
                      <span style="font-size:10px;color:${uc};font-weight:bold;font-family:monospace;">${escapeHtml(u.call_sign)}</span>
                      <span style="font-size:9px;color:#9ca3af;">${escapeHtml(u.officer_name)}</span>
                      ${routeBtn}
                    </div>`;
                  }).join('')}
                </div>`;
              } else {
                unitsHtml = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #1e3048;font-size:9px;color:#5a6e80;">No units assigned</div>`;
              }

              infoWindowRef.current?.setContent(`
                <div style="min-width:200px;font-family:'Courier New',monospace;background:#0d1520;color:#e5e7eb;padding:10px;border:1px solid ${pColor}50;border-radius:4px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <span style="background:${pColor};color:white;padding:2px 8px;font-size:10px;font-weight:900;letter-spacing:0.5px;">${escapeHtml(call.priority)}</span>
                    <span style="font-weight:900;font-size:13px;color:${pColor};">${escapeHtml(formatIncidentType(call.incident_type))}</span>
                  </div>
                  <div style="font-size:12px;color:#60a5fa;font-weight:bold;">${escapeHtml(call.call_number)}</div>
                  <div style="font-size:10px;margin-top:4px;color:#d1d5db;">${escapeHtml(call.location_address)}</div>
                  ${call.property_name ? `<div style="font-size:10px;margin-top:4px;color:#3b82f6;">\u{1F3E2} ${escapeHtml(call.property_name)}</div>` : ''}
                  <div style="font-size:9px;margin-top:6px;text-transform:uppercase;color:#5a6e80;letter-spacing:1px;font-weight:800;">${escapeHtml(call.status.replace(/_/g, ' '))}</div>
                  ${unitsHtml}
                </div>
              `);
              infoWindowRef.current?.setPosition({ lat: call.latitude!, lng: call.longitude! });
              infoWindowRef.current?.open(map);
            },
          });

          markersRef.current.push(marker);
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
                <div style="min-width:200px;font-family:'JetBrains Mono',monospace;background:#0d1520;color:#e5e7eb;padding:12px;border:1px solid #3b82f650;border-radius:4px;">
                  <div style="font-weight:900;font-size:13px;color:#60a5fa;margin-bottom:4px;">${escapeHtml(prop.name)}</div>
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
                  employee: '#22d3ee', contact: '#60a5fa', tenant: '#a78bfa', owner: '#4ade80',
                  manager: '#d4a017', subject: '#f59e0b', trespass_warning: '#ef4444',
                  banned: '#ef4444', frequent_visitor: '#9ca3af', associated: '#6b7280',
                };
                const personRows = linkedPersons.slice(0, 8).map((p: any) => {
                  const relColor = RELATIONSHIP_COLORS[p.relationship] || '#6b7280';
                  const name = escapeHtml(`${p.first_name} ${p.last_name}`);
                  const rel = escapeHtml((p.relationship || '').replace(/_/g, ' '));
                  const flagsArr = (() => { try { return JSON.parse(p.flags || '[]'); } catch { return []; } })();
                  const hasWarning = flagsArr.includes('trespass') || flagsArr.includes('violent') || flagsArr.includes('armed') || p.relationship === 'trespass_warning' || p.relationship === 'banned';
                  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #1e304820;">
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
                  const statusColor = c.status === 'cleared' || c.status === 'closed' ? '#4ade80' : c.status === 'pending' ? '#fbbf24' : '#60a5fa';
                  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #1e304820;">
                    <div>
                      <span style="color:#93c5fd;font-size:9px;font-weight:700;">${escapeHtml(c.call_number || '')}</span>
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
                    <span style="color:#22d3ee;">⦿</span> ${escapeHtml(s.officer_name || 'Unassigned')}
                    <span style="color:#6b7280;margin-left:4px;">${escapeHtml(s.shift_type || '')}</span>
                  </div>`
                ).join('');

                infoWindowRef.current?.setContent(`
                  <div style="min-width:280px;max-width:360px;font-family:'JetBrains Mono',monospace;background:#0d1520;color:#e5e7eb;padding:12px;border:1px solid #3b82f650;border-radius:4px;">
                    <div style="font-weight:900;font-size:13px;color:#60a5fa;margin-bottom:2px;">${escapeHtml(prop.name)}</div>
                    <div style="font-size:10px;color:#d1d5db;margin-bottom:2px;">${escapeHtml(prop.address)}</div>
                    ${prop.client_name ? `<div style="font-size:9px;color:#d4a017;font-weight:600;margin-bottom:6px;">Client: ${escapeHtml(prop.client_name)}</div>` : ''}

                    ${details.property_type ? `<div style="font-size:8px;color:#9ca3af;margin-bottom:2px;">Type: ${escapeHtml(details.property_type)}</div>` : ''}
                    ${details.emergency_contact ? `<div style="font-size:8px;color:#f87171;margin-bottom:2px;">Emergency: ${escapeHtml(details.emergency_contact)}</div>` : ''}
                    ${details.gate_code ? `<div style="font-size:8px;color:#9ca3af;margin-bottom:2px;">Gate: ${escapeHtml(details.gate_code)}</div>` : ''}
                    ${details.access_instructions ? `<div style="font-size:8px;color:#9ca3af;margin-bottom:6px;">Access: ${escapeHtml(details.access_instructions)}</div>` : ''}

                    ${schedules.length > 0 ? `
                      <div style="border-top:1px solid #1e3048;padding-top:6px;margin-top:4px;">
                        <div style="font-size:9px;color:#22d3ee;font-weight:700;margin-bottom:3px;">TODAY'S OFFICERS</div>
                        ${scheduleRows}
                      </div>
                    ` : ''}

                    ${linkedPersons.length > 0 ? `
                      <div style="border-top:1px solid #1e3048;padding-top:6px;margin-top:6px;">
                        <div style="font-size:9px;color:#e879f9;font-weight:700;margin-bottom:3px;">LINKED PERSONS (${linkedPersons.length})</div>
                        ${personRows}
                        ${linkedPersons.length > 8 ? `<div style="font-size:8px;color:#6b7280;text-align:center;margin-top:4px;">+${linkedPersons.length - 8} more</div>` : ''}
                      </div>
                    ` : ''}

                    ${recentCalls.length > 0 ? `
                      <div style="border-top:1px solid #1e3048;padding-top:6px;margin-top:6px;">
                        <div style="font-size:9px;color:#f59e0b;font-weight:700;margin-bottom:3px;">CALL HISTORY (${recentCalls.length})</div>
                        ${callRows}
                        ${recentCalls.length > 5 ? `<div style="font-size:8px;color:#6b7280;text-align:center;margin-top:4px;">+${recentCalls.length - 5} more</div>` : ''}
                      </div>
                    ` : `
                      <div style="border-top:1px solid #1e3048;padding-top:6px;margin-top:6px;">
                        <div style="font-size:9px;color:#6b7280;">No recent calls</div>
                      </div>
                    `}

                    ${details.client_contact ? `
                      <div style="border-top:1px solid #1e3048;padding-top:6px;margin-top:6px;">
                        <div style="font-size:9px;color:#a78bfa;font-weight:700;margin-bottom:3px;">CLIENT CONTACT</div>
                        <div style="font-size:9px;color:#d1d5db;">${escapeHtml(details.client_contact)}</div>
                        ${details.client_phone ? `<div style="font-size:9px;color:#93c5fd;">${escapeHtml(details.client_phone)}</div>` : ''}
                      </div>
                    ` : ''}

                    ${details.sla_response_minutes ? `<div style="font-size:8px;color:#4ade80;margin-top:4px;">SLA: ${details.sla_response_minutes} min response</div>` : ''}
                    ${details.hazard_notes ? `<div style="font-size:8px;color:#f87171;margin-top:4px;padding:3px 5px;background:#f8717110;border:1px solid #f8717130;border-radius:2px;">⚠ ${escapeHtml(details.hazard_notes)}</div>` : ''}
                    ${details.post_orders ? `<div style="font-size:8px;color:#9ca3af;margin-top:4px;">Post Orders: ${escapeHtml(details.post_orders.substring(0, 100))}${details.post_orders.length > 100 ? '…' : ''}</div>` : ''}
                  </div>
                `);
              } catch {
                // If fetch fails, show basic info
                infoWindowRef.current?.setContent(`
                  <div style="min-width:160px;font-family:'JetBrains Mono',monospace;background:#0d1520;color:#e5e7eb;padding:10px;border:1px solid #3b82f650;border-radius:4px;">
                    <div style="font-weight:900;font-size:13px;color:#60a5fa;margin-bottom:4px;">${escapeHtml(prop.name)}</div>
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

  // ============================================================
  // Update Route When Routed Unit GPS Changes
  // ============================================================

  useEffect(() => {
    if (!activeRoute) return;
    const routedUnit = units.find(u => u.call_sign === activeRoute.unitCallSign);
    if (routedUnit?.latitude != null && routedUnit?.longitude != null) {
      updateOrigin(routedUnit.latitude, routedUnit.longitude);
    }
  }, [activeRoute, units, updateOrigin]);

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

    if (!showHeatmap || heatmapData.length === 0) return;

    // Build weighted data points for HeatmapLayer
    const weightedData = heatmapData
      .filter((p: any) => p.latitude != null && p.longitude != null)
      .map((point: any) => ({
        location: new google.maps.LatLng(point.latitude, point.longitude),
        weight: heatmapMode === 'risk' ? (point.risk_weight || point.count || 1) : (point.count || 1),
      }));

    // Choose gradient based on mode
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

    const heatmap = new google.maps.visualization.HeatmapLayer({
      data: weightedData,
      map,
      radius: 30,
      opacity: 0.7,
      gradient,
      dissipating: true,
    });

    heatmapLayerRef.current = heatmap;

    return () => {
      if (heatmapLayerRef.current) {
        heatmapLayerRef.current.setMap(null);
        heatmapLayerRef.current = null;
      }
    };
  }, [showHeatmap, heatmapData, heatmapMode, mapLoaded]);

  // ============================================================
  // Unit-to-Call Tracking Lines
  // ============================================================

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    // Clear existing lines
    trackingLinesRef.current.forEach((line) => line.setMap(null));
    trackingLinesRef.current = [];

    if (!showTrackingLines) return;

    // Draw lines from each dispatched/enroute/onscene unit to their assigned call
    units.forEach((unit) => {
      if (unit.latitude == null || unit.longitude == null) return;
      if (!unit.current_call_id) return;
      if (!['dispatched', 'enroute', 'onscene'].includes(unit.status)) return;

      // Find the call this unit is assigned to
      const call = calls.find((c) => String(c.id) === String(unit.current_call_id));
      if (!call || call.latitude == null || call.longitude == null) return;

      const statusColor = UNIT_STATUS_COLORS[unit.status] || '#5a6e80';
      const isDashed = unit.status === 'dispatched';

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
    });
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

    if (!showBreadcrumbs) { setPlaybackTrails([]); return; }

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

      try {
        const trails = await apiFetch<Trail[]>(`/dispatch/gps/trails?hours=${breadcrumbHours}`);
        if (!trails) return;
        setPlaybackTrails(trails);

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
                fillColor: breadcrumbColorMode === 'speed' ? speedToColor(pt.speed) : unitColor,
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
            else dotColor = unitColor;

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
              const html = `
                <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:220px;line-height:1.6;background:#0a0e14;padding:10px 12px;border-radius:6px;border:1px solid #1e2a3a">
                  <div style="font-weight:bold;font-size:13px;margin-bottom:4px;color:${unitColor}">
                    ${escapeHtml(trail.call_sign)} — ${escapeHtml(trail.officer_name || 'Unknown')}
                  </div>
                  <div style="color:#8899aa;font-size:10px;margin-bottom:4px">${escapeHtml(trail.badge_number || '')}</div>
                  ${pt.road_name ? `<div style="color:#fbbf24;font-weight:bold;font-size:12px;margin-bottom:4px;padding:2px 0;border-bottom:1px solid #1e2a3a">${escapeHtml(pt.road_name)}</div>` : ''}
                  <div style="font-size:18px;font-weight:900;color:${speedToColor(pt.speed)};margin-bottom:4px">${formatSpeedMph(pt.speed)}</div>
                  <table style="width:100%;font-size:11px;border-collapse:collapse">
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Time</td><td style="font-weight:bold;color:#fff">${time}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Status</td><td style="font-weight:bold;color:${statusToColor(pt.status)}">${STATUS_LABELS[pt.status] || pt.status}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Speed</td><td style="color:${speedToColor(pt.speed)};font-weight:bold">${formatSpeedMph(pt.speed)}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Heading</td><td style="color:#e0e0e0">${formatHeadingDir(pt.heading)}</td></tr>
                    ${locationRow}
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Accuracy</td><td style="color:#e0e0e0">${pt.accuracy != null ? `±${Math.round(pt.accuracy)}m` : '—'}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Position</td><td style="font-size:10px;color:#e0e0e0">${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}</td></tr>
                    ${pt.call_number ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Call</td><td style="font-weight:bold;color:#4fc3f7">${escapeHtml(pt.call_number)} — ${escapeHtml(pt.call_type || '')}</td></tr>` : ''}
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
      } catch {
        retryTimeout = setTimeout(fetchTrails, 5000);
      }
    };

    fetchTrails();
    const interval = setInterval(fetchTrails, 15000);
    return () => { clearInterval(interval); clearTimeout(retryTimeout); };
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
          fillColor: '#00ff88',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
        zIndex: 9999,
        title: `${trail.call_sign} — Playback`,
      });
    }

    let currentIdx = playbackIdx;
    const step = () => {
      if (currentIdx >= trail.points.length) {
        setIsPlaying(false);
        setPlaybackIdx(trail.points.length - 1);
        return;
      }

      const pt = trail.points[currentIdx];
      if (playbackMarkerRef.current) {
        playbackMarkerRef.current.setPosition({ lat: pt.lat, lng: pt.lng });
        playbackMarkerRef.current.setIcon({
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 5,
          rotation: pt.heading || 0,
          fillColor: '#00ff88',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        });
      }

      setPlaybackIdx(currentIdx);
      currentIdx++;

      // Speed: base 200ms per point, divided by playback speed multiplier
      const delay = 200 / playbackSpeed;
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

  // Cleanup playback marker when playback unit changes or stops
  useEffect(() => {
    if (playbackUnit == null) {
      if (playbackMarkerRef.current) {
        playbackMarkerRef.current.setMap(null);
        playbackMarkerRef.current = null;
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

  const unitsWithCoords = units.filter(u => u.latitude != null && u.longitude != null);
  const callsWithCoords = calls.filter(c => c.latitude != null && c.longitude != null);
  const propertiesWithCoords = properties.filter(p => p.latitude != null && p.longitude != null);

  const unitsByStatus = units.reduce((acc, u) => {
    acc[u.status] = (acc[u.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const callsByPriority = calls.reduce((acc, c) => {
    acc[c.priority] = (acc[c.priority] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const filteredUnits = units.filter(u => {
    if (u.status === 'off_duty') return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return u.call_sign.toLowerCase().includes(q) || u.officer_name.toLowerCase().includes(q);
  });

  const filteredCalls = calls.filter(c => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return c.call_number.toLowerCase().includes(q) || c.incident_type.toLowerCase().includes(q) || c.location_address.toLowerCase().includes(q);
  });

  // Quick call status change from map sidebar
  const handleCallStatusChange = useCallback(async (callId: string, newStatus: string) => {
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
        el.innerHTML = `
          <div style="background:#3b82f6;color:#fff;font-size:9px;font-weight:900;padding:3px 8px;border:2px solid #fff;white-space:nowrap;font-family:'JetBrains Mono',monospace;letter-spacing:0.05em;max-width:200px;overflow:hidden;text-overflow:ellipsis;border-radius:2px;">
            ${escapeHtml(description.split(',')[0])}
          </div>
          <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #3b82f6;"></div>
        `;

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
  // Render
  // ============================================================

  return (
    <div className={`relative h-full flex ${isMobile ? 'overflow-hidden' : ''}`}>
      {/* Map Container — full-bleed on mobile, flex-1 on desktop */}
      <div className="flex-1 relative" style={isMobile ? { flex: 1, minHeight: 0 } : undefined}>
        <div
          ref={mapRef}
          className="absolute inset-0 bg-surface-deep"
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
              backdropFilter: 'blur(4px)',
              borderRadius: 2,
            }}
          >
            <Loader2 style={{ width: 14, height: 14, color: '#f59e0b' }} className="animate-spin" />
            <div className="flex flex-col">
              <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider font-mono leading-none">
                CACHED MAP
              </span>
              <span className="text-[8px] text-gray-500 font-mono leading-none mt-0.5">
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
              className="ml-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-blue-400 hover:text-white hover:bg-brand-600 transition-colors"
              style={{ borderRadius: 2 }}
            >
              Retry
            </button>
          </div>
        )}

        {/* RMPG Brand Watermark — pushed down on mobile to avoid search bar */}
        <div className={`absolute left-2 z-10 pointer-events-none opacity-40 ${isMobile ? 'top-14' : 'top-2'}`}>
          <RmpgLogo height={20} iconOnly />
        </div>

        {/* Offline fallback: Leaflet map with cached tiles when Google Maps fails
            due to connectivity (not API key errors). Shows GPS, unit positions, calls. */}
        {showOfflineFallback && (
          <OfflineMapFallback
            className="absolute inset-0 z-[2000]"
            selfPosition={
              gps.isTracking && gps.latitude != null && gps.longitude != null
                ? { lat: gps.latitude, lng: gps.longitude, accuracy: gps.accuracy ?? undefined, heading: gps.heading ?? undefined }
                : null
            }
            unitPositions={units
              .filter(u => u.latitude != null && u.longitude != null)
              .map(u => ({
                call_sign: u.call_sign,
                lat: u.latitude!,
                lng: u.longitude!,
                status: u.status,
              }))}
            activeCalls={calls.filter(c => c.latitude != null && c.longitude != null)}
            properties={properties
              .filter(p => p.latitude != null && p.longitude != null)
              .map(p => ({
                id: p.id,
                name: p.name,
                lat: p.latitude!,
                lng: p.longitude!,
                address: p.address,
                client_name: p.client_name || undefined,
              }))}
            onRetry={() => {
              setRetryingGmaps(true);
              setMapError(null);
              setMapRetry((n) => n + 1);
              // Reset retrying state after a delay (the Google Maps init effect will re-run)
              setTimeout(() => setRetryingGmaps(false), 5000);
            }}
            retrying={retryingGmaps}
          />
        )}

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
                  1. Go to <span className="text-blue-400">console.cloud.google.com/apis/library</span><br/>
                  2. Enable <span className="text-amber-400">Maps JavaScript API</span><br/>
                  3. Enable <span className="text-amber-400">Places API (New)</span><br/>
                  4. Go to <span className="text-blue-400">Billing</span> → ensure billing is active<br/>
                  5. Go to <span className="text-blue-400">Credentials</span> → check key restrictions<br/>
                  6. Add key to <span className="text-brand-400">client/.env</span>:<br/>
                  <span className="text-green-400 ml-2">VITE_GOOGLE_MAPS_API_KEY=your_key</span><br/>
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

        {/* ── Mobile Address Search Bar - Top (full width) ── */}
        {isMobile && (
          <div className="absolute top-2 left-2 right-2 z-[1001]">
            <div className="relative">
              <div className="relative flex items-center">
                <Search className="absolute left-3 w-4 h-4 text-white/50 pointer-events-none" />
                <input
                  type="text"
                  value={addressSearch}
                  onChange={(e) => handleAddressSearch(e.target.value)}
                  onFocus={() => addressResults.length > 0 && setShowAddressResults(true)}
                  onBlur={() => setTimeout(() => setShowAddressResults(false), 200)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setShowAddressResults(false); setAddressSearch(''); setAddressResults([]); }
                  }}
                  placeholder="Search address..."
                  className="w-full text-[13px] pl-10 pr-10 bg-black/60 border border-white/15 text-white placeholder:text-white/40 focus:border-white/40 focus:bg-black/70 focus:outline-none backdrop-blur-md shadow-lg font-mono"
                  style={{ borderRadius: 2, height: 44 }}
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
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {showAddressResults && addressResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-black/90 border border-white/15 shadow-2xl backdrop-blur-md overflow-hidden" style={{ borderRadius: 2 }}>
                  {addressResults.map((r) => (
                    <button
                      key={r.place_id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleAddressSelect(r.place_id, r.description)}
                      className="w-full text-left px-4 py-3 text-[12px] text-white/80 hover:bg-white/10 hover:text-white transition-colors border-b border-white/10 last:border-0 flex items-center gap-2"
                      style={{ minHeight: 44 }}
                    >
                      <MapPin className="w-4 h-4 text-blue-400 shrink-0" />
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
                  onBlur={() => setTimeout(() => setShowAddressResults(false), 200)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setShowAddressResults(false); setAddressSearch(''); setAddressResults([]); }
                  }}
                  placeholder="Search address..."
                  className={`text-[11px] pl-8 pr-8 py-1.5 w-[240px] focus:outline-none backdrop-blur-md shadow-lg font-mono transition-colors ${
                    isLightMapStyle(mapStyle)
                      ? 'bg-white/80 border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:bg-white/90'
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
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              {showAddressResults && addressResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-black/80 border border-white/15 shadow-2xl backdrop-blur-md overflow-hidden" style={{ borderRadius: 2 }}>
                  {addressResults.map((r) => (
                    <button
                      key={r.place_id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleAddressSelect(r.place_id, r.description)}
                      className="w-full text-left px-3 py-2 text-[10px] text-rmpg-200 hover:bg-rmpg-700/50 hover:text-white transition-colors border-b border-rmpg-700 last:border-0 flex items-center gap-2"
                    >
                      <MapPin className="w-3 h-3 text-blue-400 shrink-0" />
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
                  if (map) map.setZoom((map.getZoom() || 12) + 1);
                }}
                className={`border border-b-0 backdrop-blur-md px-2 py-1.5 transition-colors ${
                  isLightMapStyle(mapStyle) ? 'bg-white/80 border-gray-300 hover:bg-white/95' : 'bg-black/30 border-white/15 hover:bg-black/50'
                }`}
                style={{ borderRadius: '2px 2px 0 0' }}
                title="Zoom in"
              >
                <Plus className={`w-3.5 h-3.5 ${isLightMapStyle(mapStyle) ? 'text-gray-600' : 'text-white/70'}`} />
              </button>
              <button
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) map.setZoom((map.getZoom() || 12) - 1);
                }}
                className={`border backdrop-blur-md px-2 py-1.5 transition-colors ${
                  isLightMapStyle(mapStyle) ? 'bg-white/80 border-gray-300 hover:bg-white/95' : 'bg-black/30 border-white/15 hover:bg-black/50'
                }`}
                style={{ borderRadius: '0 0 2px 2px' }}
                title="Zoom out"
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
          <div className="bg-surface-deep/95 border border-rmpg-600 backdrop-blur-sm shadow-2xl" style={{ width: 'clamp(160px, 14vw, 200px)', borderRadius: 2 }}>
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
                { key: 'properties' as const, icon: <Building2 className="w-3 h-3" />, label: 'Properties', count: propertiesWithCoords.length, color: '#3b82f6' },
              ].map(({ key, icon, label, count, color }) => (
                <button
                  key={key}
                  onClick={() => toggleLayer(key)}
                  className={`flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors ${
                    layers[key] ? 'panel-inset bg-surface-deep' : 'opacity-40 hover:opacity-70 hover:bg-rmpg-800/50'
                  }`}
                >
                  {layers[key] ? <Eye className="w-3 h-3 text-green-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
                  <span style={{ color: layers[key] ? color : '#5a6e80' }}>{icon}</span>
                  <span className="text-[10px] text-rmpg-200 flex-1">{label}</span>
                  <span className="text-[9px] font-mono font-bold" style={{ color: layers[key] ? color : '#5a6e80' }}>{count}</span>
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
                  <span className="text-[8px] text-red-400 font-mono font-bold">{heatmapData.length} pts</span>
                )}
              </button>
              {showHeatmap && (
                <div className="px-3 py-1 space-y-1">
                  {/* Days selector */}
                  <div className="flex items-center gap-1">
                    {[7, 14, 30, 90].map((days) => (
                      <button
                        key={days}
                        onClick={() => setHeatmapDays(days)}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded transition-colors ${
                          heatmapDays === days
                            ? 'bg-red-900/50 text-red-400 border border-red-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {days}d
                      </button>
                    ))}
                  </div>
                  {/* Mode selector */}
                  <div className="flex items-center gap-1">
                    {([['all', 'All'], ['risk', 'Risk'], ['type', 'Type']] as const).map(([mode, label]) => (
                      <button
                        key={mode}
                        onClick={() => { setHeatmapMode(mode); if (mode !== 'type') setHeatmapTypeFilter(''); }}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded transition-colors ${
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
                {showBreadcrumbs ? <Eye className="w-3 h-3 text-cyan-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
                <Route className="w-3 h-3 text-cyan-400" />
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
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded transition-colors ${
                          breadcrumbHours === h
                            ? 'bg-cyan-900/50 text-cyan-400 border border-cyan-700/50'
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
                          if (!data?.trails?.length) { alert('No tracking data for this period.'); return; }
                          await generatePatrolTrackingPdf(data);
                        } catch (err: any) {
                          alert(err?.message || 'Failed to export PDF');
                        } finally { setExportingPdf(false); }
                      }}
                      disabled={exportingPdf}
                      className="px-1.5 py-0.5 text-[8px] font-mono font-bold rounded transition-colors text-brand-400 hover:bg-brand-900/30 ml-1 flex items-center gap-0.5"
                      title="Export patrol tracking PDF"
                    >
                      {exportingPdf ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <FileText className="w-2.5 h-2.5" />}
                      PDF
                    </button>
                  </div>
                  {/* Color mode selector */}
                  <div className="flex items-center gap-1">
                    <Palette className="w-2.5 h-2.5 text-rmpg-400" />
                    {([['unit', 'Unit'], ['speed', 'Speed'], ['status', 'Status']] as const).map(([mode, label]) => (
                      <button
                        key={mode}
                        onClick={() => setBreadcrumbColorMode(mode)}
                        className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded transition-colors ${
                          breadcrumbColorMode === mode
                            ? 'bg-cyan-900/50 text-cyan-400 border border-cyan-700/50'
                            : 'text-rmpg-500 hover:text-rmpg-300'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {/* Speed color legend */}
                  {breadcrumbColorMode === 'speed' && (
                    <div className="flex items-center gap-1.5 pl-1">
                      {[['#22c55e', '<15'], ['#eab308', '15-35'], ['#f97316', '35-55'], ['#ef4444', '55+']].map(([color, label]) => (
                        <span key={label} className="flex items-center gap-0.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                          <span className="text-[7px] text-rmpg-400 font-mono">{label}</span>
                        </span>
                      ))}
                      <span className="text-[7px] text-rmpg-500 font-mono">mph</span>
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
                          className="flex-1 bg-surface-deep border border-rmpg-600 text-[9px] text-rmpg-200 px-1 py-0.5 font-mono focus:outline-none focus:border-cyan-600"
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
                                className="p-0.5 rounded hover:bg-cyan-900/40 transition-colors"
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
                                className="flex-1 h-1 accent-cyan-400"
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
                                  className={`px-1 py-0 text-[7px] font-mono font-bold rounded transition-colors ${
                                    playbackSpeed === spd
                                      ? 'bg-cyan-900/50 text-cyan-400 border border-cyan-700/50'
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
                        className={`text-left px-2 py-1.5 rounded transition-all ${
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
                <Globe2 className="w-3 h-3 text-cyan-400" />
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
                        {state?.loaded && state.featureCount > 0 && (
                          <span className="text-[8px] font-mono" style={{ color: state.visible ? cfg.style.strokeColor : '#5a6e80' }}>
                            {state.featureCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── District Legend Section ── */}
            {geoLayerStates.beat?.visible && districtSections.length > 0 && (
              <div className="border-t border-rmpg-700 p-1.5">
                <button
                  onClick={() => setShowDistrictLegend(!showDistrictLegend)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors rounded hover:bg-rmpg-700/30"
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
                              onClick={(e) => { e.stopPropagation(); shiftPlanning.deletePlan(plan.id); }}
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
                            shiftPlanning.createPlan(newShiftPlanName.trim(), newShiftPlanDate, newShiftPlanType);
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
                                              ? 'bg-blue-900/30 text-blue-300'
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
                                            className="w-2.5 h-2.5 accent-blue-500"
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
                      {shiftPlanning.activePlan.assignments.length > 0 && (
                        <div className="border-t border-rmpg-700 pt-1 mt-1">
                          <div className="flex items-center justify-between px-2 mb-1">
                            <span className="text-[8px] text-rmpg-500 uppercase tracking-wider font-bold">
                              Assignments ({shiftPlanning.activePlan.assignments.length})
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  try { shiftPlanning.savePlanToServer(shiftPlanning.activePlanId!); } catch { addToast('Failed to save shift plan', 'error'); }
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
                            {shiftPlanning.activePlan.assignments.map((assignment) => (
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
                                  <span className="text-blue-400 font-bold">{stats.officers}</span> officers
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
                        {shiftPlanning.activePlan.assignments.length > 0 && (
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
                            onClick={(e) => { e.stopPropagation(); eventPlanning.deletePlan(plan.id); }}
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
                          eventPlanning.createPlan(newPlanName.trim());
                          setNewPlanName('');
                        }
                      }}
                      placeholder="New plan name..."
                      className="input-dark flex-1 px-1.5 py-0.5 text-[9px]"
                    />
                    <button
                      onClick={() => {
                        if (newPlanName.trim()) {
                          eventPlanning.createPlan(newPlanName.trim());
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

        {/* ── Status Legend - Bottom Left (desktop only) ── */}
        {!isMobile && <div className="absolute bottom-2 left-2 z-[1000]">
          <div
            className="backdrop-blur-md shadow-xl"
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
            className="backdrop-blur-md shadow-2xl"
            style={{
              borderRadius: 2,
              background: isLightMapStyle(mapStyle) ? 'rgba(255,255,255,0.88)' : isSatelliteStyle(mapStyle) ? 'rgba(6,12,20,0.92)' : 'rgba(6,12,20,0.95)',
              border: isLightMapStyle(mapStyle) ? '1px solid rgba(0,0,0,0.15)' : '1px solid rgba(30,48,72,0.6)',
            }}
          >
            <div className="flex items-center gap-0.5 px-1.5 py-1">
              {/* Live indicator */}
              <div className="flex items-center gap-1 px-2 py-0.5" style={{ borderRight: isLightMapStyle(mapStyle) ? '1px solid rgba(0,0,0,0.1)' : '1px solid #1e3048' }}>
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                <span className={`text-[9px] font-mono font-black tracking-wider ${isConnected ? (isLightMapStyle(mapStyle) ? 'text-green-700' : 'text-green-400') : 'text-red-400'}`}>
                  {isConnected ? 'LIVE' : 'DISC'}
                </span>
              </div>

              {/* Calls */}
              <div className="flex items-center gap-1 px-2 py-0.5" style={{ borderRight: isLightMapStyle(mapStyle) ? '1px solid rgba(0,0,0,0.1)' : '1px solid #1e3048' }}>
                <Siren className={`w-3 h-3 shrink-0 ${isLightMapStyle(mapStyle) ? 'text-red-600' : 'text-red-400'}`} />
                <span className={`text-[13px] font-mono font-black ${isLightMapStyle(mapStyle) ? 'text-gray-900' : 'text-white'}`}>{callsWithCoords.length}</span>
                {callsByPriority['P1'] ? <span className="text-[8px] font-mono font-bold text-red-500 bg-red-500/15 px-1 rounded">P1:{callsByPriority['P1']}</span> : null}
                {callsByPriority['P2'] ? <span className="text-[8px] font-mono font-bold text-amber-500 bg-amber-500/15 px-1 rounded">P2:{callsByPriority['P2']}</span> : null}
              </div>

              {/* Units */}
              <div className="flex items-center gap-1 px-2 py-0.5">
                <Shield className={`w-3 h-3 shrink-0 ${isLightMapStyle(mapStyle) ? 'text-green-600' : 'text-green-400'}`} />
                <span className={`text-[13px] font-mono font-black ${isLightMapStyle(mapStyle) ? 'text-gray-900' : 'text-white'}`}>{unitsWithCoords.length}</span>
                <div className="flex items-center gap-1.5 ml-1">
                  {([
                    { key: 'available', label: 'AVL', color: '#22c55e' },
                    { key: 'dispatched', label: 'DSP', color: '#f59e0b' },
                    { key: 'enroute', label: 'ENR', color: '#3b82f6' },
                    { key: 'onscene', label: 'ONS', color: '#a855f7' },
                  ] as const).filter(s => (unitsByStatus[s.key] || 0) > 0).map(({ key, label, color }) => (
                    <span key={key} className="text-[8px] font-mono font-bold px-1 rounded" style={{ color, background: color + '15' }}>
                      {label}:{unitsByStatus[key] || 0}
                    </span>
                  ))}
                </div>
              </div>

              {showTrackingLines && trackingLinesRef.current.length > 0 && (
                <div className="flex items-center gap-1 px-1.5">
                  <Navigation2 className="w-2.5 h-2.5 text-cyan-400" />
                  <span className="text-cyan-400 text-[8px] font-mono font-bold">{trackingLinesRef.current.length}</span>
                </div>
              )}
            </div>
          </div>
        </div>}

        {/* ── Route Info Panel (bottom-left, top on mobile) ── */}
        {activeRoute && (
          <div
            className="absolute z-[1000] backdrop-blur-md"
            style={{
              ...(isMobile
                ? { top: 56, left: 8, right: 8 }
                : { bottom: 48, left: 16, minWidth: 200 }),
              background: isLightMapStyle(mapStyle) ? 'rgba(255,255,255,0.92)' : 'rgba(6,12,20,0.95)',
              border: isLightMapStyle(mapStyle) ? '1px solid rgba(59,130,246,0.3)' : '1px solid #3b82f650',
              padding: '8px 14px',
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              borderRadius: 2,
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: '#3b82f6', fontWeight: 900, letterSpacing: '0.05em' }}>
                {activeRoute.unitCallSign} → {activeRoute.callNumber}
              </span>
              <button
                onClick={clearRoute}
                style={{ background: 'none', border: 'none', color: '#5a6e80', cursor: 'pointer', fontSize: 12, padding: '0 0 0 8px' }}
                title="Clear route"
              >
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 16, color: isLightMapStyle(mapStyle) ? '#111827' : '#fff', fontWeight: 900 }}>{activeRoute.eta}</span>
              <span style={{ fontSize: 11, color: isLightMapStyle(mapStyle) ? '#6b7280' : '#9ca3af' }}>{activeRoute.distance}</span>
            </div>
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
                border: '1px solid #1e3048',
              }}
            >
              <button
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) map.setZoom((map.getZoom() || 12) + 1);
                }}
                className="flex items-center justify-center transition-colors hover:bg-white/10 active:bg-white/20"
                style={{ width: 48, height: 48, borderBottom: '1px solid #1e3048' }}
                title="Zoom in"
              >
                <Plus className="w-5 h-5 text-white/80" />
              </button>
              <button
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) map.setZoom((map.getZoom() || 12) - 1);
                }}
                className="flex items-center justify-center transition-colors hover:bg-white/10 active:bg-white/20"
                style={{ width: 48, height: 48 }}
                title="Zoom out"
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
                  ? 'bg-white/90 border border-blue-300 hover:bg-blue-50'
                  : 'bg-surface-deep/95 border border-blue-500/50 hover:bg-blue-900/30'
              }`}
              style={isMobile
                ? { borderRadius: 2, width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }
                : { borderRadius: 2, padding: 10 }
              }
              title={`Center on my position${gps.unitCallSign ? ` (${gps.unitCallSign})` : ''}`}
            >
              <Navigation2 className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} ${isLightMapStyle(mapStyle) ? 'text-blue-600' : 'text-blue-400'}`} />
            </button>
          )}
          {/* Reset to default view */}
          <button
            onClick={() => {
              mapInstanceRef.current?.panTo({ lat: 40.7608, lng: -111.8910 });
              mapInstanceRef.current?.setZoom(12);
            }}
            className={`backdrop-blur-md shadow-xl transition-colors ${
              isLightMapStyle(mapStyle)
                ? 'bg-white/90 border border-gray-300 hover:bg-gray-100'
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
      </div>

      {/* ── Right Sidebar - Unit/Call List (Desktop only, responsive width) ── */}
      {!isMobile && <div
        className="flex flex-col panel-beveled transition-all"
        style={{
          width: sidebarOpen ? 'clamp(220px, 20vw, 300px)' : 36,
          background: '#060c14',
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="toolbar-btn flex items-center justify-center h-7"
          style={{ borderRadius: 0 }}
        >
          {sidebarOpen ? <ChevronUp className="w-3.5 h-3.5 text-rmpg-400 rotate-90" /> : <ChevronDown className="w-3.5 h-3.5 text-rmpg-400 -rotate-90" />}
        </button>

        {sidebarOpen && (
          <>
            {/* Compact status counters */}
            <div className="flex items-center justify-center gap-2 px-2 py-1.5 panel-inset" style={{ background: '#0a0a0a' }}>
              {([
                { label: 'AVL', count: unitsByStatus['available'] || 0, color: '#22c55e' },
                { label: 'DSP', count: unitsByStatus['dispatched'] || 0, color: '#f59e0b' },
                { label: 'ENR', count: unitsByStatus['enroute'] || 0, color: '#3b82f6' },
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
              {callsByPriority['P3'] ? <span className="text-[8px] font-mono font-bold text-blue-400">P3:{callsByPriority['P3']}</span> : null}
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

            <div className="flex-1 overflow-y-auto">
              {sidebarTab === 'units' && (
                <div className="divide-y divide-rmpg-700/50">
                  {filteredUnits.map((unit) => {
                    const hasCoords = unit.latitude != null && unit.longitude != null;
                    const statusColor = UNIT_STATUS_COLORS[unit.status];
                    return (
                      <button
                        key={unit.id}
                        onClick={() => hasCoords && panTo(unit.latitude!, unit.longitude!)}
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
                            <span className="text-[7px] font-bold px-1 py-0 bg-blue-900/40 text-blue-400 border border-blue-700/30" title="ClearPathGPS Hardware Tracker">CPG</span>
                          )}
                          <span className="text-[9px] font-mono ml-auto uppercase font-bold" style={{ color: statusColor }}>{UNIT_STATUS_LABELS[unit.status]}</span>
                        </div>
                        <div className="ml-5 mt-0.5">
                          <span className="text-[9px] text-rmpg-400">{unit.officer_name}</span>
                          {unit.call_number && (
                            <span className="text-[9px] text-blue-400 ml-2 font-mono">{unit.call_number}</span>
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
                    const pColor = PRIORITY_COLORS[call.priority] || '#5a6e80';
                    const { category } = getIncidentCategory(call.incident_type);
                    return (
                      <button
                        key={call.id}
                        onClick={() => hasCoords && panTo(call.latitude!, call.longitude!)}
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
                          <div className="ml-8 text-[8px] text-blue-400 truncate mt-0.5">{call.property_name}</div>
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
                              className="px-1.5 py-0.5 text-[8px] font-bold font-mono bg-blue-900/30 text-blue-400 border border-blue-700/40 hover:bg-blue-800/40 transition-colors"
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
                          {['dispatched', 'enroute', 'onscene'].includes(call.status) && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCallStatusChange(call.id, 'cleared'); }}
                              className="px-1.5 py-0.5 text-[8px] font-bold font-mono bg-rmpg-700/30 text-rmpg-300 border border-rmpg-600/40 hover:bg-rmpg-600/40 transition-colors"
                            >
                              CLEAR
                            </button>
                          )}
                        </div>
                      </button>
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
              border: '1px solid #1e3048',
              borderRadius: 2,
            }}
            onClick={() => setMobileLayersOpen(!mobileLayersOpen)}
            aria-label="Toggle layers"
          >
            <Layers style={{ width: 22, height: 22, color: '#3b82f6' }} />
          </button>

          <MobileBottomSheet
            open={mobileLayersOpen}
            onClose={() => setMobileLayersOpen(false)}
            initialSnap="half"
            collapsedHeight={0}
            header={
              <div className="flex items-center gap-1">
                {([
                  { id: 'layers' as const, icon: Layers, label: 'Layers', color: '#3b82f6' },
                  { id: 'units' as const, icon: Shield, label: `Units (${filteredUnits.length})`, color: '#22c55e' },
                  { id: 'calls' as const, icon: AlertTriangle, label: `Calls (${filteredCalls.length})`, color: '#ef4444' },
                ] as const).map(({ id, icon: Icon, label, color }) => (
                  <button
                    key={id}
                    onClick={() => setMobileSheetTab(id)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                    style={{
                      color: mobileSheetTab === id ? color : '#6a7a8a',
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
                  { key: 'properties' as const, icon: Building2, label: 'Properties', color: '#3b82f6' },
                ].map(({ key, icon: Icon, label, color }) => (
                  <button
                    key={key}
                    onClick={() => toggleLayer(key)}
                    className="flex items-center gap-3 w-full px-3 py-3 text-left transition-colors"
                    style={{
                      background: layers[key] ? 'rgba(34,197,94,0.08)' : '#141e2b',
                      border: '1px solid #1e3048',
                      minHeight: 44,
                    }}
                  >
                    {layers[key] ? <Eye className="w-4 h-4 text-green-400" /> : <EyeOff className="w-4 h-4 text-rmpg-500" />}
                    <Icon style={{ width: 16, height: 16, color: layers[key] ? color : '#5a6e80' }} />
                    <span className="text-sm text-rmpg-200 flex-1">{label}</span>
                  </button>
                ))}

                <button
                  onClick={() => setShowHeatmap(!showHeatmap)}
                  className="flex items-center gap-3 w-full px-3 py-3 text-left transition-colors"
                  style={{
                    background: showHeatmap ? 'rgba(239,68,68,0.08)' : '#141e2b',
                    border: '1px solid #1e3048',
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
                    background: showBreadcrumbs ? 'rgba(34,211,238,0.08)' : '#141e2b',
                    border: '1px solid #1e3048',
                    minHeight: 44,
                  }}
                >
                  {showBreadcrumbs ? <Eye className="w-4 h-4 text-cyan-400" /> : <EyeOff className="w-4 h-4 text-rmpg-500" />}
                  <Route style={{ width: 16, height: 16 }} className="text-cyan-400" />
                  <span className="text-sm text-rmpg-200 flex-1">Breadcrumbs</span>
                </button>

                {/* Breadcrumb time range + color mode */}
                {showBreadcrumbs && (
                  <div className="px-3 py-2 space-y-2" style={{ background: '#0d1520', border: '1px solid #1e3048' }}>
                    <div className="flex gap-1">
                      {[2, 4, 8, 12, 24].map((h) => (
                        <button
                          key={h}
                          onClick={() => setBreadcrumbHours(h)}
                          className={`flex-1 py-2 text-xs font-bold rounded ${
                            breadcrumbHours === h
                              ? 'bg-cyan-600 text-white'
                              : 'bg-rmpg-800 text-rmpg-400 hover:bg-rmpg-700'
                          }`}
                        >
                          {h}h
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      {([['unit', 'Unit'], ['speed', 'Speed'], ['status', 'Status']] as const).map(([mode, label]) => (
                        <button
                          key={mode}
                          onClick={() => setBreadcrumbColorMode(mode)}
                          className={`flex-1 py-1.5 text-[10px] font-bold rounded ${
                            breadcrumbColorMode === mode
                              ? 'bg-cyan-600 text-white'
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
                <div className="px-3 py-2 space-y-1.5" style={{ background: '#0d1520', border: '1px solid #1e3048' }}>
                  <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-widest mb-1">Map Style</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(Object.entries(MAP_STYLE_LABELS) as [MapStyleId, string][]).map(([key, label]) => {
                      const isActive = mapStyle === key;
                      return (
                        <button
                          key={key}
                          onClick={() => setMapStyle(key)}
                          className={`py-2 text-[10px] font-bold rounded transition-all ${
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
                    if (map && gps.latitude && gps.longitude) {
                      map.panTo({ lat: gps.latitude, lng: gps.longitude });
                      map.setZoom(16);
                    }
                  }}
                  className="flex items-center gap-3 w-full px-3 py-3 text-left transition-colors"
                  style={{
                    background: '#141e2b',
                    border: '1px solid #1e3048',
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
                          <span className="text-[7px] font-bold px-1 py-0 bg-blue-900/40 text-blue-400 border border-blue-700/30" title="ClearPathGPS Hardware Tracker">CPG</span>
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
                  const pColor = PRIORITY_COLORS[call.priority] || '#5a6e80';
                  const { category } = getIncidentCategory(call.incident_type);
                  return (
                    <button
                      key={call.id}
                      onClick={() => { if (hasCoords) { panTo(call.latitude!, call.longitude!); setMobileLayersOpen(false); } }}
                      className={`w-full text-left px-3 py-3 transition-colors ${hasCoords ? 'active:bg-rmpg-700/30' : 'opacity-60'}`}
                      style={{ minHeight: 44 }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded" style={{ background: pColor + '25', color: pColor, border: `1px solid ${pColor}40` }}>{call.priority}</span>
                        <span className="text-[11px] font-mono font-bold text-rmpg-100 flex-1">{call.call_number}</span>
                        <span className="text-[9px] font-mono text-rmpg-400 uppercase font-bold">{call.status.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 ml-8">
                        <span className="text-[8px] font-bold px-1 py-0.5 rounded" style={{ background: pColor + '15', color: pColor }}>{category}</span>
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
