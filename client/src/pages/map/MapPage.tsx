import React, { useEffect, useRef, useState, useCallback } from 'react';
import { loadGoogleMaps, DARK_MAP_STYLE, registerMapInstance, unregisterMapInstance, updateMapStyles, onOnlineRetryMaps, monitorTileLoading, getFallbackMapImage, addOfflineTileLayer } from '../../utils/googleMapsLoader';
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
  PanelLeftClose,
  PanelLeftOpen,
  Loader2,
} from 'lucide-react';
import type { UnitStatus } from '../../types';
import RmpgLogo from '../../components/RmpgLogo';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';
import { usePersistedTab } from '../../hooks/usePersistedState';
import { useWebSocket } from '../../context/WebSocketContext';
import { useGpsTracking } from '../../hooks/useGpsTracking';
import { formatIncidentType } from '../../utils/caseNumbers';
import { generatePatrolTrackingPdf } from '../../utils/patrolTrackingPdfGenerator';
import { escapeHtml } from '../../utils/sanitize';
import { localToday, dateToLocalYMD } from '../../utils/dateUtils';
import { useGeoJsonLayers, GEO_LAYER_CONFIGS } from '../../hooks/useGeoJsonLayers';
import { useEventPlanning, PLAN_COLORS, PLAN_TYPE_LABELS, type PlanItemType } from '../../hooks/useEventPlanning';
import { useShiftPlanning, SHIFT_TYPES, type ShiftType } from '../../hooks/useShiftPlanning';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useMapRouting } from '../../hooks/useMapRouting';
import MobileBottomSheet from '../../components/mobile/MobileBottomSheet';
import OfflineMapFallback from '../../components/OfflineMapFallback';
import type { MapUnit as Unit, ActiveCall, MapProperty as Property, MapStyleId } from './utils/mapConstants';
import { UNIT_STATUS_COLORS, UNIT_STATUS_LABELS, PRIORITY_COLORS, MAP_STYLE_LABELS, getIncidentCategory } from './utils/mapConstants';
import { buildUnitMarkerContent, buildIncidentMarkerContent, buildPropertyMarkerContent, buildSelfPositionMarker, getOverlayMarkerClass, injectKeyframes, type OverlayMarker } from './utils/mapMarkerBuilders';

// ============================================================
// Main Component
// ============================================================

export default function MapPage() {
  const isMobile = useIsMobile();
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
  const [mobileSheetTab, setMobileSheetTab] = useState<'layers' | 'units' | 'calls'>('layers');
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<any[]>([]); // AdvancedMarkerElement or OverlayView
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const heatmapCirclesRef = useRef<google.maps.Circle[]>([]);
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

  // Breadcrumb trail state
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(true);
  const [breadcrumbHours, setBreadcrumbHours] = useState(8);
  const [exportingPdf, setExportingPdf] = useState(false);
  const breadcrumbLinesRef = useRef<google.maps.Polyline[]>([]);

  // Layers panel (left) collapsed/expanded
  const [layersPanelOpen, setLayersPanelOpen] = useState(true);

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = usePersistedTab('rmpg_map_sidebar', 'units', ['units', 'calls'] as const);

  // Map style
  const [mapStyle, setMapStyle] = usePersistedTab('rmpg_map_style', 'dark' as MapStyleId, ['dark', 'satellite', 'hybrid', 'streets'] as const);
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

  // GeoJSON spatial layers (with shift planning selection integration)
  const { layerStates: geoLayerStates, toggleGeoLayer, ensureLayerLoaded, configs: geoConfigs } = useGeoJsonLayers({
    map: mapInstanceRef.current,
    infoWindow: infoWindowRef.current,
    selectionMode: shiftPlanning.selectionMode,
    onFeatureClick: shiftPlanning.handleFeatureClick,
    selectedFeatures: shiftPlanning.selectedAreas,
    assignedFeatures: shiftPlanning.assignedFeatures,
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
    if (!isConnected) return;

    const unsubscribeUnit = subscribe('unit_update', (data: any) => {
      if (data && data.unit) {
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
        fetchUnits();
      }
    });

    return () => { unsubscribeUnit(); unsubscribeCall(); };
  }, [isConnected, subscribe, fetchUnits]);

  // ============================================================
  // Heat Map Data
  // ============================================================

  useEffect(() => {
    if (!showHeatmap) { setHeatmapData([]); return; }
    apiFetch<any[]>(`/dispatch/heatmap?days=${heatmapDays}`)
      .then((data) => setHeatmapData(data || []))
      .catch(() => setHeatmapData([]));
  }, [showHeatmap, heatmapDays]);

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

      const dismissObserver = new MutationObserver(() => {
        if (authFailed) return;
        const hardErr = mapRef.current?.querySelector('.gm-err-container');
        if (hardErr) {
          console.error('[MapPage] Google Maps hard error overlay detected');
          authFailed = true;
          dismissObserver.disconnect();
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
      setTimeout(() => dismissObserver.disconnect(), 10000);

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
    } else if (mapStyle === 'satellite') {
      map.setMapTypeId('satellite');
      map.setOptions({ styles: [] });
      updateMapStyles(map, []);
    } else if (mapStyle === 'hybrid') {
      map.setMapTypeId('hybrid');
      map.setOptions({ styles: [] });
      updateMapStyles(map, []);
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
          const content = buildUnitMarkerContent(unit.call_sign, unit.status);
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
                    <span style="margin-left:auto;font-size:9px;text-transform:uppercase;color:${statusColor};font-weight:800;letter-spacing:1px;padding:1px 6px;background:${statusColor}20;border:1px solid ${statusColor}30;border-radius:2px;">${escapeHtml(unit.status.replace('_', ' '))}</span>
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
                    <span style="background:${pColor};color:white;padding:2px 8px;font-size:10px;font-weight:900;border-radius:3px;letter-spacing:0.5px;">${escapeHtml(call.priority)}</span>
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

    // Add property markers
    if (layers.properties) {
      properties.forEach((prop) => {
        if (prop.latitude != null && prop.longitude != null) {
          const content = buildPropertyMarkerContent(prop.name);

          const marker = createMarker({
            map,
            position: { lat: prop.latitude, lng: prop.longitude },
            content,
            zIndex: 100,
            title: prop.name,
            onClick: () => {
              infoWindowRef.current?.setContent(`
                <div style="min-width:160px;font-family:'Courier New',monospace;background:#0d1520;color:#e5e7eb;padding:10px;border:1px solid #3b82f650;border-radius:4px;">
                  <div style="font-weight:900;font-size:13px;color:#60a5fa;margin-bottom:4px;">${escapeHtml(prop.name)}</div>
                  <div style="font-size:10px;color:#d1d5db;">${escapeHtml(prop.address)}</div>
                  ${prop.client_name ? `<div style="font-size:9px;margin-top:6px;color:#9ca3af;font-weight:600;">Client: ${escapeHtml(prop.client_name)}</div>` : ''}
                </div>
              `);
              infoWindowRef.current?.setPosition({ lat: prop.latitude!, lng: prop.longitude! });
              infoWindowRef.current?.open(map);
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

    heatmapCirclesRef.current.forEach((c) => c.setMap(null));
    heatmapCirclesRef.current = [];

    if (showHeatmap && heatmapData.length > 0) {
      heatmapData.forEach((point: any) => {
        if (point.latitude != null && point.longitude != null) {
          const intensity = Math.min((point.count ?? 1) / 10, 1);
          const radius = 200 + (point.count ?? 1) * 40;
          const circle = new google.maps.Circle({
            map,
            center: { lat: point.latitude, lng: point.longitude },
            radius: Math.min(radius, 800),
            fillColor: '#ef4444',
            fillOpacity: 0.15 + intensity * 0.4,
            strokeColor: '#ef4444',
            strokeOpacity: 0.3 + intensity * 0.3,
            strokeWeight: 1,
            clickable: false,
          });
          heatmapCirclesRef.current.push(circle);
        }
      });
    }
  }, [showHeatmap, heatmapData, mapLoaded]);

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
  // GPS Breadcrumb Trails
  // ============================================================

  // Unit colors for breadcrumb trails — cycle through distinct colors per unit
  const TRAIL_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#c084fc'];
  const breadcrumbMarkersRef = useRef<google.maps.Circle[]>([]);
  const breadcrumbInfoRef = useRef<google.maps.InfoWindow | null>(null);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    // Clear existing breadcrumb lines and dot markers
    breadcrumbLinesRef.current.forEach((line) => line.setMap(null));
    breadcrumbLinesRef.current = [];
    breadcrumbMarkersRef.current.forEach((m) => m.setMap(null));
    breadcrumbMarkersRef.current = [];

    if (!showBreadcrumbs) return;

    const token = localStorage.getItem('rmpg_token');
    if (!token) return;

    // Shared info window for breadcrumb dot popups
    if (!breadcrumbInfoRef.current) {
      breadcrumbInfoRef.current = new google.maps.InfoWindow();
    }

    const formatSpeed = (mps: number | null) => {
      if (mps == null) return '—';
      return `${(mps * 2.237).toFixed(0)} mph`;
    };

    const formatHeading = (deg: number | null) => {
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
    }
    interface Trail {
      unit_id: number; call_sign: string; officer_name: string;
      badge_number: string; points: TrailPoint[];
    }

    const fetchTrails = async () => {
      // Clear previous
      breadcrumbLinesRef.current.forEach((l) => l.setMap(null));
      breadcrumbLinesRef.current = [];
      breadcrumbMarkersRef.current.forEach((m) => m.setMap(null));
      breadcrumbMarkersRef.current = [];

      try {
        const res = await fetch(`/api/dispatch/gps/trails?hours=${breadcrumbHours}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const trails: Trail[] = await res.json();

        trails.forEach((trail, idx) => {
          if (trail.points.length === 0) return;

          const color = TRAIL_COLORS[idx % TRAIL_COLORS.length];

          // Draw segments color-coded by status
          for (let i = 0; i < trail.points.length - 1; i++) {
            const p1 = trail.points[i];
            const p2 = trail.points[i + 1];
            // Freshness: 0 for oldest segment, 1 for newest — newer = brighter
            const freshness = (i + 1) / trail.points.length;
            const opacity = 0.2 + freshness * 0.6;

            const seg = new google.maps.Polyline({
              path: [{ lat: p1.lat, lng: p1.lng }, { lat: p2.lat, lng: p2.lng }],
              geodesic: true,
              strokeColor: color,
              strokeOpacity: opacity,
              strokeWeight: 3,
              map,
            });
            breadcrumbLinesRef.current.push(seg);
          }

          // Place dot markers at each breadcrumb point (every point for interaction)
          trail.points.forEach((pt, ptIdx) => {
            const dot = new google.maps.Circle({
              center: { lat: pt.lat, lng: pt.lng },
              radius: 4,
              fillColor: color,
              fillOpacity: ptIdx === trail.points.length - 1 ? 1 : 0.6,
              strokeColor: '#fff',
              strokeWeight: ptIdx === trail.points.length - 1 ? 2 : 0.5,
              strokeOpacity: 0.8,
              map,
              clickable: true,
              zIndex: ptIdx,
            });

            dot.addListener('click', () => {
              const time = new Date(pt.time).toLocaleString();
              const html = `
                <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#0a0e14;padding:10px 12px;border-radius:6px;border:1px solid #1e2a3a">
                  <div style="font-weight:bold;font-size:13px;margin-bottom:4px;color:#ff4444">
                    ${trail.call_sign} — ${trail.officer_name || 'Unknown'}
                  </div>
                  <div style="color:#8899aa;font-size:10px;margin-bottom:6px">${trail.badge_number || ''}</div>
                  <table style="width:100%;font-size:11px;border-collapse:collapse">
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Time</td><td style="font-weight:bold;color:#fff">${time}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Status</td><td style="font-weight:bold;color:#4fc3f7">${STATUS_LABELS[pt.status] || pt.status}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Speed</td><td style="color:#e0e0e0">${formatSpeed(pt.speed)}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Heading</td><td style="color:#e0e0e0">${formatHeading(pt.heading)}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Accuracy</td><td style="color:#e0e0e0">${pt.accuracy != null ? `±${Math.round(pt.accuracy)}m` : '—'}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Position</td><td style="font-size:10px;color:#e0e0e0">${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}</td></tr>
                    ${pt.call_number ? `<tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Call</td><td style="font-weight:bold;color:#4fc3f7">${pt.call_number} — ${pt.call_type || ''}</td></tr>` : ''}
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
        // Retry once after a short delay on network failure (vehicle WiFi)
        setTimeout(fetchTrails, 5000);
      }
    };

    fetchTrails();

    // Refresh trails every 15 seconds to match GPS batch interval
    const interval = setInterval(fetchTrails, 15000);
    return () => clearInterval(interval);
  }, [showBreadcrumbs, breadcrumbHours, mapLoaded]);

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
    }
  }, [fetchCalls, fetchUnits]);

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
        setTimeout(() => {
          if (addressMarkerRef.current) {
            removeMarker(addressMarkerRef.current);
            addressMarkerRef.current = null;
          }
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
    <div className="relative h-full flex">
      {/* Map Container */}
      <div className="flex-1 relative">
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
            className="absolute top-12 left-3 z-[10] flex items-center gap-2 px-3 py-1.5"
            style={{
              background: 'rgba(0,0,0,0.9)',
              border: '1px solid #f59e0b40',
            }}
          >
            <Loader2 style={{ width: 12, height: 12, color: '#f59e0b' }} className="animate-spin" />
            <span className="text-[9px] text-amber-400 font-bold uppercase tracking-wider font-mono">
              OFFLINE TILES
            </span>
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
              className="text-[9px] text-blue-400 hover:text-blue-300 underline ml-1"
            >
              Retry
            </button>
          </div>
        )}

        {/* RMPG Brand Watermark */}
        <div className="absolute top-2 left-2 z-10 pointer-events-none opacity-40">
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
            <div className="bg-surface-overlay/95 border border-red-600 p-8 shadow-xl max-w-lg text-center" style={{ borderRadius: 4 }}>
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
              <h3 className="text-white text-sm font-bold mb-2">Map Configuration Required</h3>
              <pre className="text-rmpg-300 text-xs leading-relaxed mb-4 whitespace-pre-wrap text-left">{mapError}</pre>
              <div className="bg-surface-deep border border-rmpg-600 p-3 text-left mb-4" style={{ borderRadius: 4 }}>
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
                  style={{ borderRadius: 4 }}
                >
                  Retry
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-1.5 bg-surface-deep hover:bg-surface-overlay text-rmpg-300 text-xs font-bold uppercase tracking-wider border border-rmpg-600 transition-colors"
                  style={{ borderRadius: 4 }}
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
            <div className="bg-surface-overlay/95 border border-rmpg-600 p-6 shadow-xl" style={{ borderRadius: 4 }}>
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
            <div className="bg-red-900/95 border border-red-600 px-4 py-2 backdrop-blur-sm shadow-xl" style={{ borderRadius: 4 }}>
              <span className="text-white text-sm">{error}</span>
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
                <Search className="absolute left-2.5 w-3.5 h-3.5 text-white/50 pointer-events-none" />
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
                  className="bg-black/30 border border-white/15 text-[11px] text-white placeholder:text-white/40 pl-8 pr-8 py-1.5 w-[240px] focus:border-white/40 focus:bg-black/50 focus:outline-none backdrop-blur-md shadow-lg font-mono transition-colors"
                  style={{ borderRadius: 4 }}
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
                <div className="absolute top-full left-0 right-0 mt-1 bg-black/80 border border-white/15 shadow-2xl backdrop-blur-md overflow-hidden" style={{ borderRadius: 4 }}>
                  {addressResults.map((r) => (
                    <button
                      key={r.place_id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleAddressSelect(r.place_id, r.description)}
                      className="w-full text-left px-3 py-2 text-[10px] text-white/80 hover:bg-white/10 hover:text-white transition-colors border-b border-white/10 last:border-0 flex items-center gap-2"
                    >
                      <MapPin className="w-3 h-3 text-blue-400 shrink-0" />
                      <span className="truncate">{r.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Zoom +/- controls */}
            <div className="flex flex-col" style={{ borderRadius: 4, overflow: 'hidden' }}>
              <button
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) map.setZoom((map.getZoom() || 12) + 1);
                }}
                className="bg-black/30 border border-white/15 border-b-0 backdrop-blur-md px-2 py-1.5 hover:bg-black/50 transition-colors"
                style={{ borderRadius: '4px 4px 0 0' }}
                title="Zoom in"
              >
                <Plus className="w-3.5 h-3.5 text-white/70" />
              </button>
              <button
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) map.setZoom((map.getZoom() || 12) - 1);
                }}
                className="bg-black/30 border border-white/15 backdrop-blur-md px-2 py-1.5 hover:bg-black/50 transition-colors"
                style={{ borderRadius: '0 0 4px 4px' }}
                title="Zoom out"
              >
                <Minus className="w-3.5 h-3.5 text-white/70" />
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
              style={{ borderRadius: 4 }}
              title="Show layers"
            >
              <PanelLeftOpen className="w-4 h-4 text-white/70" />
            </button>
          ) : (
          <div className="bg-surface-deep/95 border border-rmpg-600 backdrop-blur-sm shadow-2xl" style={{ width: 'clamp(160px, 14vw, 200px)', borderRadius: 4 }}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-700">
              <Layers className="w-3.5 h-3.5 text-brand-400" />
              <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-widest flex-1">Layers</span>
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
              <button
                onClick={() => setLayersPanelOpen(false)}
                className="text-rmpg-500 hover:text-rmpg-200 transition-colors -mr-1"
                title="Hide layers"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
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
                  className={`flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors rounded ${
                    layers[key] ? 'bg-rmpg-700/30 hover:bg-rmpg-700/50' : 'opacity-40 hover:opacity-70'
                  }`}
                >
                  {layers[key] ? <Eye className="w-3 h-3 text-green-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
                  <span style={{ color: layers[key] ? color : '#5a6e80' }}>{icon}</span>
                  <span className="text-[10px] text-rmpg-200 flex-1">{label}</span>
                  <span className="text-[9px] font-mono font-bold" style={{ color: layers[key] ? color : '#5a6e80' }}>{count}</span>
                </button>
              ))}

              <button
                onClick={() => setShowHeatmap(!showHeatmap)}
                className={`flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors rounded ${
                  showHeatmap ? 'bg-red-900/30 hover:bg-red-900/40' : 'opacity-40 hover:opacity-70'
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
                <div className="flex items-center gap-1 px-3 py-1">
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
              )}

              <button
                onClick={() => setShowTrackingLines(!showTrackingLines)}
                className={`flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors rounded ${
                  showTrackingLines ? 'bg-green-900/30 hover:bg-green-900/40' : 'opacity-40 hover:opacity-70'
                }`}
              >
                {showTrackingLines ? <Eye className="w-3 h-3 text-green-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
                <Navigation2 className="w-3 h-3 text-green-400" />
                <span className="text-[10px] text-rmpg-200 flex-1">Tracking Lines</span>
              </button>

              <button
                onClick={() => setShowBreadcrumbs(!showBreadcrumbs)}
                className={`flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors rounded ${
                  showBreadcrumbs ? 'bg-cyan-900/30 hover:bg-cyan-900/40' : 'opacity-40 hover:opacity-70'
                }`}
              >
                {showBreadcrumbs ? <Eye className="w-3 h-3 text-cyan-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
                <Route className="w-3 h-3 text-cyan-400" />
                <span className="text-[10px] text-rmpg-200 flex-1">Breadcrumbs</span>
              </button>
              {showBreadcrumbs && (
                <div className="flex items-center gap-1 px-3 py-1">
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
                        if (!data?.trails?.length) {
                          alert('No tracking data for this period.');
                          return;
                        }
                        await generatePatrolTrackingPdf(data);
                      } catch (err: any) {
                        alert(err?.message || 'Failed to export PDF');
                      } finally {
                        setExportingPdf(false);
                      }
                    }}
                    disabled={exportingPdf}
                    className="px-1.5 py-0.5 text-[8px] font-mono font-bold rounded transition-colors text-brand-400 hover:bg-brand-900/30 ml-1 flex items-center gap-0.5"
                    title="Export patrol tracking PDF"
                  >
                    {exportingPdf ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <FileText className="w-2.5 h-2.5" />}
                    PDF
                  </button>
                </div>
              )}
            </div>

            <div className="border-t border-rmpg-700 p-1.5">
              <button
                onClick={() => setShowMapStyles(!showMapStyles)}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors rounded hover:bg-rmpg-700/30"
              >
                <MapIcon className="w-3 h-3 text-rmpg-400" />
                <span className="text-[10px] text-rmpg-300 flex-1">Map Style</span>
                <span className="text-[9px] text-rmpg-400">{MAP_STYLE_LABELS[mapStyle]}</span>
              </button>
              {showMapStyles && (
                <div className="mt-1 space-y-0.5">
                  {(Object.entries(MAP_STYLE_LABELS) as [MapStyleId, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => { setMapStyle(key); setShowMapStyles(false); }}
                      className={`w-full text-left px-4 py-1 text-[10px] rounded transition-colors ${
                        mapStyle === key ? 'text-brand-400 bg-brand-900/20' : 'text-rmpg-400 hover:text-rmpg-200 hover:bg-rmpg-700/30'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── GeoJSON Spatial Layers Section ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              <button
                onClick={() => setShowGeoPanel(!showGeoPanel)}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors rounded hover:bg-rmpg-700/30"
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
                        className={`flex items-center gap-2 w-full px-2 py-1 text-left transition-colors rounded ${
                          state?.visible ? 'bg-rmpg-700/30 hover:bg-rmpg-700/50' : 'opacity-40 hover:opacity-70'
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

            {/* ── Shift Planning Section ── */}
            <div className="border-t border-rmpg-700 p-1.5">
              <button
                onClick={() => setShowShiftPanel(!showShiftPanel)}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors rounded hover:bg-rmpg-700/30"
              >
                <CalendarDays className="w-3 h-3 text-emerald-400" />
                <span className="text-[10px] text-rmpg-300 flex-1">Shift Planning</span>
                {shiftPlanning.selectionMode && (
                  <span className="text-[7px] px-1 py-0.5 bg-amber-900/40 text-amber-400 border border-amber-700/40 rounded font-bold animate-pulse">SELECT</span>
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
                            className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors cursor-pointer ${
                              shiftPlanning.activePlanId === plan.id
                                ? 'bg-emerald-900/30 border border-emerald-700/40'
                                : 'hover:bg-rmpg-700/30'
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
                            <span className={`text-[7px] px-1 py-0.5 rounded font-bold ${
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
                        className="flex-1 bg-transparent border border-rmpg-700 px-1.5 py-0.5 text-[9px] text-rmpg-200 placeholder:text-rmpg-600 rounded focus:border-emerald-600 outline-none"
                      />
                      <input
                        type="date"
                        value={newShiftPlanDate}
                        onChange={(e) => setNewShiftPlanDate(e.target.value)}
                        className="bg-transparent border border-rmpg-700 px-1 py-0.5 text-[9px] text-rmpg-200 rounded focus:border-emerald-600 outline-none w-[90px]"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      {(Object.entries(SHIFT_TYPES) as [ShiftType, typeof SHIFT_TYPES.day][]).map(([key, info]) => (
                        <button
                          key={key}
                          onClick={() => setNewShiftPlanType(key)}
                          className={`flex-1 text-[8px] py-0.5 rounded font-bold transition-colors ${
                            newShiftPlanType === key
                              ? 'border text-white'
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
                          className={`flex items-center gap-2 w-full px-2 py-1.5 rounded transition-colors ${
                            shiftPlanning.selectionMode
                              ? 'bg-amber-900/40 border border-amber-600/50 text-amber-300'
                              : 'hover:bg-rmpg-700/30 text-rmpg-400'
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
                                    className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-900/20 rounded"
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
                                        className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                                          assignOfficerIds.includes(officer.id)
                                            ? 'bg-emerald-900/30 text-emerald-300'
                                            : 'hover:bg-rmpg-700/30 text-rmpg-400'
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
                                          className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                                            assignUnitIds.includes(unit.id)
                                              ? 'bg-blue-900/30 text-blue-300'
                                              : 'hover:bg-rmpg-700/30 text-rmpg-400'
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
                                    className="w-full bg-transparent border border-rmpg-700 px-1.5 py-0.5 text-[8px] text-rmpg-200 placeholder:text-rmpg-600 rounded focus:border-emerald-600 outline-none"
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
                                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[8px] font-bold bg-emerald-900/40 text-emerald-400 border border-emerald-700/40 rounded hover:bg-emerald-900/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                  >
                                    <UserCheck className="w-2.5 h-2.5" />
                                    Assign
                                  </button>
                                  <button
                                    onClick={() => shiftPlanning.clearSelection()}
                                    className="px-2 py-1 text-[8px] font-bold text-rmpg-400 border border-rmpg-700 rounded hover:bg-rmpg-700/30 transition-colors"
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
                                  try { shiftPlanning.savePlanToServer(shiftPlanning.activePlanId!); } catch {}
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
                                className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-rmpg-700/30"
                              >
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
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
                          className="flex items-center gap-1 px-1.5 py-0.5 text-[8px] text-rmpg-400 hover:text-rmpg-200 border border-rmpg-700 rounded hover:bg-rmpg-700/30 transition-colors"
                          title="Duplicate for next day"
                        >
                          <Copy className="w-2 h-2" /> Duplicate
                        </button>
                        {shiftPlanning.activePlan.assignments.length > 0 && (
                          <button
                            onClick={() => shiftPlanning.removeAllAssignments()}
                            className="flex items-center gap-1 px-1.5 py-0.5 text-[8px] text-red-400/60 hover:text-red-400 border border-rmpg-700 rounded hover:bg-red-900/20 transition-colors"
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
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors rounded hover:bg-rmpg-700/30"
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
                          className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors cursor-pointer ${
                            eventPlanning.activePlanId === plan.id
                              ? 'bg-amber-900/30 border border-amber-700/40'
                              : 'hover:bg-rmpg-700/30'
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
                      className="flex-1 bg-transparent border border-rmpg-700 px-1.5 py-0.5 text-[9px] text-rmpg-200 placeholder:text-rmpg-600 rounded focus:border-amber-600 outline-none"
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
                              className={`flex items-center gap-1 px-1.5 py-1 text-[9px] rounded transition-colors ${
                                eventPlanning.drawMode === type
                                  ? 'bg-amber-900/40 text-amber-300 border border-amber-600/50'
                                  : 'text-rmpg-400 hover:text-rmpg-200 hover:bg-rmpg-700/30 border border-transparent'
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
                        <div className="mx-1 px-2 py-1.5 bg-amber-900/20 border border-amber-700/30 rounded">
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
                                className="text-[8px] px-1.5 py-0.5 bg-green-900/40 text-green-400 border border-green-700/40 rounded hover:bg-green-900/60"
                              >
                                <Check className="w-2.5 h-2.5 inline mr-0.5" />Finish
                              </button>
                            )}
                            <button
                              onClick={() => eventPlanning.cancelDrawing()}
                              className="text-[8px] px-1.5 py-0.5 bg-red-900/40 text-red-400 border border-red-700/40 rounded hover:bg-red-900/60"
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
                                className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-rmpg-700/30"
                              >
                                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.color }} />
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

        {/* ── Status Legend - Bottom Left (desktop only, wraps on narrow) ── */}
        {!isMobile && <div className="absolute bottom-2 left-2 z-[1000] max-w-[calc(100vw-16rem)]">
          <div className="bg-surface-deep/95 border border-rmpg-600 px-2 py-1.5 backdrop-blur-sm shadow-xl" style={{ borderRadius: 4 }}>
            <span className="text-[8px] font-bold text-rmpg-400 uppercase tracking-widest">Legend</span>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
              {(Object.entries(UNIT_STATUS_COLORS) as [UnitStatus, string][])
                .filter(([k]) => k !== 'off_duty')
                .map(([status, color]) => (
                  <div key={status} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}80` }} />
                    <span className="text-[8px] text-rmpg-300 font-mono">{UNIT_STATUS_LABELS[status as UnitStatus]}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>}

        {/* ── Stats Bar - Top Left (after layers panel) ── */}
        <div
          className="absolute top-2 z-[1000] transition-all"
          style={{ left: layersPanelOpen ? 'calc(clamp(160px, 14vw, 200px) + 24px)' : 52 }}
        >
          <div className="bg-surface-deep/95 border border-rmpg-600 px-3 py-1.5 backdrop-blur-sm shadow-xl" style={{ borderRadius: 4 }}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono">
              <div className="flex items-center gap-1.5">
                <Siren className="w-3 h-3 text-red-400 shrink-0" />
                <span className="text-rmpg-400">ACTIVE</span>
                <span className="text-white font-bold">{callsWithCoords.length}</span>
              </div>
              <div className="w-px h-4 bg-rmpg-600 hidden sm:block" />
              <div className="flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-green-400 shrink-0" />
                <span className="text-rmpg-400">UNITS</span>
                <span className="text-white font-bold">{unitsWithCoords.length}</span>
              </div>
              <div className="w-px h-4 bg-rmpg-600 hidden sm:block" />
              <div className="flex items-center gap-1">
                <span className="text-green-400 text-[9px]">AVL</span>
                <span className="text-green-400 font-bold">{unitsByStatus['available'] || 0}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-amber-400 text-[9px]">DSP</span>
                <span className="text-amber-400 font-bold">{unitsByStatus['dispatched'] || 0}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-blue-400 text-[9px]">ENR</span>
                <span className="text-blue-400 font-bold">{unitsByStatus['enroute'] || 0}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-purple-400 text-[9px]">ONS</span>
                <span className="text-purple-400 font-bold">{unitsByStatus['onscene'] || 0}</span>
              </div>
              {calls.length > 0 && (
                <>
                  <div className="w-px h-4 bg-rmpg-600 hidden sm:block" />
                  {callsByPriority['P1'] ? (
                    <div className="flex items-center gap-1">
                      <span className="text-red-400 text-[9px]">P1</span>
                      <span className="text-red-400 font-bold">{callsByPriority['P1']}</span>
                    </div>
                  ) : null}
                  {callsByPriority['P2'] ? (
                    <div className="flex items-center gap-1">
                      <span className="text-amber-400 text-[9px]">P2</span>
                      <span className="text-amber-400 font-bold">{callsByPriority['P2']}</span>
                    </div>
                  ) : null}
                  {callsByPriority['P3'] ? (
                    <div className="flex items-center gap-1">
                      <span className="text-blue-400 text-[9px]">P3</span>
                      <span className="text-blue-400 font-bold">{callsByPriority['P3']}</span>
                    </div>
                  ) : null}
                </>
              )}
              {isConnected && (
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-green-400 font-bold text-[9px]">LIVE</span>
                </div>
              )}
              {showTrackingLines && trackingLinesRef.current.length > 0 && (
                <div className="flex items-center gap-1">
                  <Navigation2 className="w-2.5 h-2.5 text-cyan-400" />
                  <span className="text-cyan-400 text-[9px]">LINKS</span>
                  <span className="text-cyan-400 font-bold">{trackingLinesRef.current.length}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Route Info Panel (bottom-left) ── */}
        {activeRoute && (
          <div
            className="absolute bottom-4 left-4 z-[1000]"
            style={{
              background: 'rgba(10,10,10,0.95)',
              border: '1px solid #3b82f650',
              padding: '8px 12px',
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              minWidth: 180,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: '#60a5fa', fontWeight: 900 }}>
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
              <span style={{ fontSize: 14, color: '#fff', fontWeight: 900 }}>{activeRoute.eta}</span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{activeRoute.distance}</span>
            </div>
            {routeLoading && (
              <div style={{ fontSize: 8, color: '#f59e0b', marginTop: 4 }}>Updating route…</div>
            )}
          </div>
        )}

        {/* ── Bottom Right Buttons (Recenter + GPS Locate) ── */}
        <div className="absolute bottom-4 right-4 z-[1000] flex flex-col gap-2" style={{ marginRight: sidebarOpen ? 'clamp(200px, 20vw, 280px)' : 36 }}>
          {/* Center on my GPS position */}
          {gps.isTracking && gps.latitude != null && gps.longitude != null && (
            <button
              onClick={() => {
                if (gps.latitude != null && gps.longitude != null) {
                  mapInstanceRef.current?.panTo({ lat: gps.latitude, lng: gps.longitude });
                  mapInstanceRef.current?.setZoom(16);
                }
              }}
              className="bg-surface-deep/95 border border-blue-500/50 p-2 backdrop-blur-sm shadow-xl hover:bg-blue-900/30 transition-colors"
              style={{ borderRadius: 4 }}
              title={`Center on my position${gps.unitCallSign ? ` (${gps.unitCallSign})` : ''}`}
            >
              <Navigation2 className="w-4 h-4 text-blue-400" />
            </button>
          )}
          {/* Reset to default view */}
          <button
            onClick={() => {
              mapInstanceRef.current?.panTo({ lat: 40.7608, lng: -111.8910 });
              mapInstanceRef.current?.setZoom(12);
            }}
            className="bg-surface-deep/95 border border-rmpg-600 p-2 backdrop-blur-sm shadow-xl hover:bg-rmpg-700/40 transition-colors"
            style={{ borderRadius: 4 }}
            title="Reset view"
          >
            <Crosshair className="w-4 h-4 text-rmpg-300" />
          </button>
        </div>
      </div>

      {/* ── Right Sidebar - Unit/Call List (Desktop only, responsive width) ── */}
      {!isMobile && <div
        className="flex flex-col border-l border-rmpg-600 transition-all"
        style={{
          width: sidebarOpen ? 'clamp(220px, 20vw, 300px)' : 36,
          background: '#060c14',
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex items-center justify-center h-8 border-b border-rmpg-600 hover:bg-rmpg-700/40 transition-colors"
        >
          {sidebarOpen ? <ChevronUp className="w-3.5 h-3.5 text-rmpg-400 rotate-90" /> : <ChevronDown className="w-3.5 h-3.5 text-rmpg-400 -rotate-90" />}
        </button>

        {sidebarOpen && (
          <>
            {/* Compact status counters */}
            <div className="flex items-center justify-center gap-2 px-2 py-1.5 border-b border-rmpg-700 bg-rmpg-900/50">
              {([
                { label: 'AVL', count: unitsByStatus['available'] || 0, color: '#22c55e' },
                { label: 'DSP', count: unitsByStatus['dispatched'] || 0, color: '#f59e0b' },
                { label: 'ENR', count: unitsByStatus['enroute'] || 0, color: '#3b82f6' },
                { label: 'ONS', count: unitsByStatus['onscene'] || 0, color: '#a855f7' },
                { label: 'BSY', count: unitsByStatus['busy'] || 0, color: '#ef4444' },
              ]).map(({ label, count, color }) => (
                <div key={label} className="flex items-center gap-0.5" title={label}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-[8px] font-mono font-bold" style={{ color }}>{count}</span>
                </div>
              ))}
              <div className="w-px h-3 bg-rmpg-700" />
              {callsByPriority['P1'] ? <span className="text-[8px] font-mono font-bold text-red-400">P1:{callsByPriority['P1']}</span> : null}
              {callsByPriority['P2'] ? <span className="text-[8px] font-mono font-bold text-amber-400">P2:{callsByPriority['P2']}</span> : null}
              {callsByPriority['P3'] ? <span className="text-[8px] font-mono font-bold text-blue-400">P3:{callsByPriority['P3']}</span> : null}
            </div>

            <div className="flex border-b border-rmpg-600">
              <button
                onClick={() => setSidebarTab('units')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  sidebarTab === 'units' ? 'text-green-400 border-b-2 border-green-400 bg-green-400/5' : 'text-rmpg-400 hover:text-rmpg-200'
                }`}
              >
                <Shield className="w-3 h-3" /> Units ({filteredUnits.length})
              </button>
              <button
                onClick={() => setSidebarTab('calls')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  sidebarTab === 'calls' ? 'text-red-400 border-b-2 border-red-400 bg-red-400/5' : 'text-rmpg-400 hover:text-rmpg-200'
                }`}
              >
                <AlertTriangle className="w-3 h-3" /> Calls ({filteredCalls.length})
              </button>
            </div>

            <div className="px-2 py-1.5 border-b border-rmpg-700">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
                <input
                  type="text"
                  className="input-dark w-full text-[10px] py-1 pl-6 pr-2"
                  placeholder={sidebarTab === 'units' ? 'Search units...' : 'Search calls...'}
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
                        className={`w-full text-left px-3 py-2.5 hover:bg-rmpg-700/30 transition-colors ${
                          hasCoords ? 'cursor-pointer' : 'cursor-default opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: statusColor, boxShadow: `0 0 6px ${statusColor}80` }}
                          />
                          <span className="text-[11px] font-mono font-bold text-rmpg-100">{unit.call_sign}</span>
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
                        className={`w-full text-left px-3 py-2.5 hover:bg-rmpg-700/30 transition-colors ${
                          hasCoords ? 'cursor-pointer' : 'cursor-default opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded"
                            style={{ background: pColor + '25', color: pColor, border: `1px solid ${pColor}40` }}
                          >{call.priority}</span>
                          <span className="text-[10px] font-mono font-bold text-rmpg-100 flex-1">{call.call_number}</span>
                          <span className="text-[8px] font-mono text-rmpg-400 uppercase font-bold">{call.status.replace(/_/g, ' ')}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 ml-8">
                          <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: pColor + '15', color: pColor, fontSize: '8px' }}>{category}</span>
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
            style={{ bottom: 'calc(80px + env(safe-area-inset-bottom))', right: 16 }}
            onClick={() => setMobileLayersOpen(!mobileLayersOpen)}
            aria-label="Toggle layers"
          >
            <Layers style={{ width: 22, height: 22 }} />
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

                {/* Breadcrumb time range selector */}
                {showBreadcrumbs && (
                  <div className="flex gap-1 px-3 py-2" style={{ background: '#0d1520', border: '1px solid #1e3048' }}>
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
                )}

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
