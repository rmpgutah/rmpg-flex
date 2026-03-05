import React, { useEffect, useRef, useState, useCallback } from 'react';
import { loadGoogleMaps, DARK_MAP_STYLE, registerMapInstance, unregisterMapInstance, updateMapStyles, onOnlineRetryMaps } from '../utils/googleMapsLoader';
import { devLog, devWarn } from '../utils/devLog';
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
// Direct script-tag loader — more reliable than @googlemaps/js-api-loader
// which has known issues with React StrictMode and intermittent failures.
import type { UnitStatus } from '../types';
import RmpgLogo from '../components/RmpgLogo';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { usePersistedTab } from '../hooks/usePersistedState';
import { useWebSocket } from '../context/WebSocketContext';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { formatIncidentType } from '../utils/caseNumbers';
import { generatePatrolTrackingPdf } from '../utils/patrolTrackingPdfGenerator';
import { escapeHtml } from '../utils/sanitize';
import { localToday, dateToLocalYMD } from '../utils/dateUtils';
import { useGeoJsonLayers, GEO_LAYER_CONFIGS } from '../hooks/useGeoJsonLayers';
import { useEventPlanning, PLAN_COLORS, PLAN_TYPE_LABELS, type PlanItemType } from '../hooks/useEventPlanning';
import { useShiftPlanning, SHIFT_TYPES, type ShiftType } from '../hooks/useShiftPlanning';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileBottomSheet from '../components/mobile/MobileBottomSheet';

// ============================================================
// Types
// ============================================================

interface Unit {
  id: string;
  call_sign: string;
  officer_name: string;
  status: UnitStatus;
  latitude: number | null;
  longitude: number | null;
  vehicle: string;
  current_call_id: string | null;
  call_number: string | null;
  current_call_type: string | null;
  current_call_location: string | null;
  gps_source: string;
  cpg_vehicle_make: string | null;
  cpg_vehicle_model: string | null;
  cpg_license_plate: string | null;
  cpg_ignition_state: string | null;
  cpg_last_odometer: number | null;
  cpg_driver_name: string | null;
  cpg_last_synced_at: string | null;
}

interface ActiveCall {
  id: string;
  call_number: string;
  incident_type: string;
  priority: string;
  status: string;
  location_address: string;
  latitude: number | null;
  longitude: number | null;
  property_name: string | null;
}

interface Property {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  client_name: string | null;
}

// ============================================================
// Constants
// ============================================================

const UNIT_STATUS_COLORS: Record<UnitStatus, string> = {
  available: '#22c55e',
  dispatched: '#f59e0b',
  enroute: '#3b82f6',
  onscene: '#a855f7',
  busy: '#ef4444',
  off_duty: '#6b7280',
};

const UNIT_STATUS_LABELS: Record<UnitStatus, string> = {
  available: 'AVL',
  dispatched: 'DSP',
  enroute: 'ENR',
  onscene: 'ONS',
  busy: 'BSY',
  off_duty: 'OFD',
};

const PRIORITY_COLORS: Record<string, string> = {
  P1: '#dc2626',
  P2: '#f59e0b',
  P3: '#3b82f6',
  P4: '#6b7280',
};

// Map style options
type MapStyleId = 'dark' | 'satellite' | 'hybrid' | 'streets';

const MAP_STYLE_LABELS: Record<MapStyleId, string> = {
  dark: 'Dark',
  satellite: 'Satellite',
  hybrid: 'Hybrid',
  streets: 'Streets',
};

// DARK_MAP_STYLE is now imported from googleMapsLoader.ts (single source of truth)

// ============================================================
// Incident Category Icons (condensed text-based symbols for map markers)
// ============================================================

function getIncidentCategory(type: string): { symbol: string; category: string } {
  const t = type.toLowerCase();
  if (t.includes('theft') || t.includes('burglary') || t.includes('robbery') || t.includes('larceny') || t.includes('shoplifting'))
    return { symbol: '\u{1F511}', category: 'THEFT' };
  if (t.includes('assault') || t.includes('battery') || t.includes('fight'))
    return { symbol: '\u270A', category: 'ASLT' };
  if (t.includes('traffic') || t.includes('accident') || t.includes('crash') || t.includes('mvc') || t.includes('hit_and_run') || t.includes('dui'))
    return { symbol: '\u{1F697}', category: 'TRFC' };
  if (t.includes('fire') || t.includes('arson'))
    return { symbol: '\u{1F525}', category: 'FIRE' };
  if (t.includes('medical') || t.includes('ems') || t.includes('injury') || t.includes('overdose') || t.includes('death'))
    return { symbol: '\u271A', category: 'MED' };
  if (t.includes('suspicious') || t.includes('welfare') || t.includes('prowler'))
    return { symbol: '\u{1F441}', category: 'SUSP' };
  if (t.includes('alarm') || t.includes('intrusion'))
    return { symbol: '\u{1F514}', category: 'ALM' };
  if (t.includes('trespass') || t.includes('unwanted'))
    return { symbol: '\u2298', category: 'TRSP' };
  if (t.includes('domestic') || t.includes('dv'))
    return { symbol: '\u{1F3E0}', category: 'DV' };
  if (t.includes('drug') || t.includes('narcotics') || t.includes('paraphernalia'))
    return { symbol: '\u{1F48A}', category: 'DRUG' };
  if (t.includes('vandal') || t.includes('damage') || t.includes('criminal_mischief') || t.includes('graffiti'))
    return { symbol: '\u2716', category: 'VNDL' };
  if (t.includes('patrol') || t.includes('foot') || t.includes('check') || t.includes('escort') || t.includes('assist'))
    return { symbol: '\u{1F6E1}', category: 'PTRL' };
  if (t.includes('noise') || t.includes('disturbance') || t.includes('disorderly'))
    return { symbol: '\u{1F50A}', category: 'NOIS' };
  if (t.includes('fraud') || t.includes('forgery') || t.includes('identity') || t.includes('counterfeit'))
    return { symbol: '\u{1F4C4}', category: 'FRAD' };
  if (t.includes('missing') || t.includes('runaway') || t.includes('amber'))
    return { symbol: '\u2753', category: 'MISP' };
  if (t.includes('weapon') || t.includes('gun') || t.includes('shots') || t.includes('armed') || t.includes('shooting'))
    return { symbol: '\u2295', category: 'WPNS' };
  if (t.includes('warrant') || t.includes('wanted') || t.includes('fugitive'))
    return { symbol: '\u{1F4CB}', category: 'WRNT' };
  if (t.includes('hazmat') || t.includes('spill') || t.includes('environmental'))
    return { symbol: '\u26A0', category: 'HZMT' };
  if (t.includes('animal'))
    return { symbol: '\u{1F43E}', category: 'ANML' };
  return { symbol: '\u25CF', category: 'CALL' };
}

// ============================================================
// Marker Content Builders for AdvancedMarkerElement
// ============================================================

function buildUnitMarkerContent(callSign: string, status: UnitStatus, gpsSource?: string): HTMLElement {
  const color = UNIT_STATUS_COLORS[status];
  const label = UNIT_STATUS_LABELS[status];
  const isCpg = gpsSource === 'clearpathgps';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;';

  const tag = document.createElement('div');
  tag.style.cssText =
    `background:${color};color:#fff;font-size:9px;font-weight:900;` +
    `padding:2px 5px;border:1px solid ${isCpg ? '#60a5fa' : 'rgba(255,255,255,0.8)'};white-space:nowrap;font-family:'JetBrains Mono',monospace;letter-spacing:0.05em;` +
    `display:flex;align-items:center;gap:3px;${isCpg ? 'box-shadow:0 0 6px rgba(96,165,250,0.4);' : ''}`;

  if (isCpg) {
    const satIcon = document.createElement('span');
    satIcon.textContent = '\u{1F4E1}';
    satIcon.style.cssText = 'font-size:8px;line-height:1;';
    tag.appendChild(satIcon);
  }

  const csSpan = document.createElement('span');
  csSpan.textContent = callSign;
  const stSpan = document.createElement('span');
  stSpan.style.cssText = 'font-size:6px;opacity:0.8;letter-spacing:0.5px;';
  stSpan.textContent = label;
  tag.appendChild(csSpan);
  tag.appendChild(stSpan);

  const caret = document.createElement('div');
  caret.style.cssText =
    `width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid ${color};`;

  wrapper.appendChild(tag);
  wrapper.appendChild(caret);
  return wrapper;
}

function buildIncidentMarkerContent(priority: string, incidentType: string, callNumber?: string): HTMLElement {
  const color = PRIORITY_COLORS[priority] || '#6b7280';
  const { category } = getIncidentCategory(incidentType);

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;';

  const tag = document.createElement('div');
  tag.style.cssText =
    `background:${color};color:#fff;font-size:9px;font-weight:900;` +
    "padding:2px 5px;border:1px solid #fff;white-space:nowrap;font-family:'JetBrains Mono',monospace;letter-spacing:0.05em;" +
    'display:flex;align-items:center;gap:3px;';

  if (callNumber) {
    const numSpan = document.createElement('span');
    numSpan.textContent = callNumber;
    tag.appendChild(numSpan);
  }

  const catSpan = document.createElement('span');
  catSpan.style.cssText = 'font-size:7px;opacity:0.85;letter-spacing:0.3px;';
  catSpan.textContent = category;
  tag.appendChild(catSpan);

  const caret = document.createElement('div');
  caret.style.cssText =
    `width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid ${color};`;

  wrapper.appendChild(tag);
  wrapper.appendChild(caret);
  return wrapper;
}

function buildPropertyMarkerContent(name: string): HTMLElement {
  const shortName = name.length > 12 ? name.substring(0, 11) + '\u2026' : name;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;';

  const tag = document.createElement('div');
  tag.style.cssText =
    "background:#1e3a5f;color:#93c5fd;font-size:8px;font-weight:900;" +
    "padding:2px 5px;border:1px solid #3b82f6;white-space:nowrap;font-family:'JetBrains Mono',monospace;letter-spacing:0.05em;border-radius:2px;";
  tag.textContent = shortName;

  const caret = document.createElement('div');
  caret.style.cssText =
    'width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid #1e3a5f;';

  wrapper.appendChild(tag);
  wrapper.appendChild(caret);
  return wrapper;
}

// ============================================================
// Self-Position Marker (pulsing "you are here")
// ============================================================

function buildSelfPositionMarker(accuracy: number | null, heading: number | null): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;cursor:default;';
  const acc = accuracy != null ? Math.min(Math.max(accuracy, 4), 40) : 12;
  el.innerHTML = `
    <div style="
      width:${acc}px;height:${acc}px;border-radius:50%;
      background:rgba(59,130,246,0.15);border:2px solid rgba(59,130,246,0.4);
      position:absolute;
      animation:pulse-gps 2s ease-in-out infinite;
    "></div>
    <div style="
      width:14px;height:14px;border-radius:50%;
      background:radial-gradient(circle at 40% 35%,#60a5fa,#2563eb);
      border:2.5px solid #fff;
      box-shadow:0 0 10px rgba(59,130,246,0.8),0 0 20px rgba(59,130,246,0.3);
      z-index:1;
    "></div>
    ${heading != null ? `
      <div style="
        position:absolute;top:-10px;
        width:0;height:0;
        border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:10px solid #3b82f6;
        transform:rotate(${heading}deg);
        transform-origin:center 17px;
        filter:drop-shadow(0 0 3px rgba(59,130,246,0.6));
        z-index:2;
      "></div>
    ` : ''}
  `;
  return el;
}

// ============================================================
// Custom Overlay Marker (fallback when AdvancedMarkerElement unavailable)
// Lazily created after Google Maps script has loaded to avoid
// referencing google.maps.OverlayView at module parse time.
// ============================================================

interface OverlayMarker {
  updatePosition(lat: number, lng: number): void;
  updateContent(newContent: HTMLElement): void;
  remove(): void;
}

let _OverlayMarkerClass: (new (opts: {
  map: google.maps.Map;
  position: google.maps.LatLngLiteral;
  content: HTMLElement;
  zIndex?: number;
  title?: string;
  onClick?: () => void;
}) => OverlayMarker) | null = null;

function getOverlayMarkerClass() {
  if (_OverlayMarkerClass) return _OverlayMarkerClass;

  _OverlayMarkerClass = class extends google.maps.OverlayView implements OverlayMarker {
    private position: google.maps.LatLng;
    private container: HTMLDivElement | null = null;
    private content: HTMLElement;
    private zIdx: number;
    private clickCallback?: () => void;

    constructor(opts: { map: google.maps.Map; position: google.maps.LatLngLiteral; content: HTMLElement; zIndex?: number; title?: string; onClick?: () => void }) {
      super();
      this.position = new google.maps.LatLng(opts.position.lat, opts.position.lng);
      this.content = opts.content;
      this.zIdx = opts.zIndex ?? 0;
      this.clickCallback = opts.onClick;
      if (opts.title) this.content.title = opts.title;
      this.setMap(opts.map);
    }

    onAdd() {
      this.container = document.createElement('div');
      this.container.style.position = 'absolute';
      this.container.style.zIndex = String(this.zIdx);
      this.container.style.cursor = 'pointer';
      this.container.appendChild(this.content);
      if (this.clickCallback) {
        this.container.addEventListener('click', this.clickCallback);
      }
      const panes = this.getPanes();
      panes?.overlayMouseTarget.appendChild(this.container);
    }

    draw() {
      if (!this.container) return;
      const projection = this.getProjection();
      if (!projection) return;
      const point = projection.fromLatLngToDivPixel(this.position);
      if (point) {
        this.container.style.left = `${point.x}px`;
        this.container.style.top = `${point.y}px`;
        this.container.style.transform = 'translate(-50%, -100%)';
      }
    }

    onRemove() {
      if (this.container?.parentElement) {
        this.container.parentElement.removeChild(this.container);
      }
      this.container = null;
    }

    updatePosition(lat: number, lng: number) {
      this.position = new google.maps.LatLng(lat, lng);
      this.draw();
    }

    updateContent(newContent: HTMLElement) {
      if (this.container) {
        this.container.innerHTML = '';
        this.container.appendChild(newContent);
      }
      this.content = newContent;
    }

    remove() {
      this.setMap(null);
    }
  };

  return _OverlayMarkerClass;
}

// ============================================================
// CSS Keyframes (injected once)
// ============================================================

// Google Maps Script Loader — imported from shared utility (utils/googleMapsLoader.ts)

const STYLE_ID = 'rmpg-map-keyframes';
function injectKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes pulse-led { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
    @keyframes pulse-incident { 0%,100% { box-shadow:0 0 4px rgba(220,38,38,0.3); transform:scale(1); } 50% { box-shadow:0 0 14px rgba(220,38,38,0.7); transform:scale(1.05); } }
    @keyframes pulse-gps { 0%,100% { transform:scale(1); opacity:0.7; } 50% { transform:scale(2.5); opacity:0; } }
    .gm-style-iw { background:#111 !important; border:1px solid #333 !important; border-radius:0 !important; color:#e5e7eb !important; }
    .gm-style-iw-d { overflow:auto !important; }
    .gm-style-iw button[aria-label="Close"] { filter: invert(1) !important; }
    .gm-style .gm-style-iw-tc::after { background:#111 !important; }
  `;
  document.head.appendChild(style);
}

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
        backgroundColor: '#0a0a0a',
        // 'greedy' allows single-finger pan on mobile/tablet — critical for
        // in-vehicle use where two-finger gestures are awkward while driving.
        gestureHandling: 'greedy',
      });

      mapInstanceRef.current = map;
      registerMapInstance(map);
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
              const isCpgUnit = unit.gps_source === 'clearpathgps';
              const cpgSection = isCpgUnit ? `
                <div style="margin-top:6px;padding-top:6px;border-top:1px solid #333;">
                  <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
                    <span style="font-size:8px;font-weight:900;color:#60a5fa;background:#1e3a5f;border:1px solid #2563eb40;padding:1px 5px;letter-spacing:0.5px">CPG HARDWARE</span>
                  </div>
                  <table style="width:100%;font-size:10px;border-collapse:collapse;color:#d1d5db;">
                    ${unit.cpg_ignition_state ? `<tr><td style="color:#6b7280;padding:1px 6px 1px 0">Ignition</td><td style="font-weight:bold;color:${unit.cpg_ignition_state === 'on' ? '#22c55e' : '#6b7280'}">${escapeHtml(unit.cpg_ignition_state.toUpperCase())}</td></tr>` : ''}
                    ${unit.cpg_last_odometer != null ? `<tr><td style="color:#6b7280;padding:1px 6px 1px 0">Odometer</td><td>${Number(unit.cpg_last_odometer).toLocaleString()} mi</td></tr>` : ''}
                    ${unit.cpg_vehicle_make ? `<tr><td style="color:#6b7280;padding:1px 6px 1px 0">Vehicle</td><td>${escapeHtml(unit.cpg_vehicle_make)} ${escapeHtml(unit.cpg_vehicle_model || '')}</td></tr>` : ''}
                    ${unit.cpg_license_plate ? `<tr><td style="color:#6b7280;padding:1px 6px 1px 0">Plate</td><td style="font-weight:bold;color:#fbbf24">${escapeHtml(unit.cpg_license_plate)}</td></tr>` : ''}
                    ${unit.cpg_driver_name ? `<tr><td style="color:#6b7280;padding:1px 6px 1px 0">Driver</td><td>${escapeHtml(unit.cpg_driver_name)}</td></tr>` : ''}
                    ${unit.cpg_last_synced_at ? `<tr><td style="color:#6b7280;padding:1px 6px 1px 0">Last Sync</td><td style="font-size:9px">${new Date(unit.cpg_last_synced_at).toLocaleTimeString()}</td></tr>` : ''}
                  </table>
                </div>
              ` : '';
              infoWindowRef.current?.setContent(`
                <div style="min-width:200px;font-family:'Courier New',monospace;background:#111;color:#e5e7eb;padding:10px;border:1px solid ${statusColor}50;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #333;">
                    <div style="width:10px;height:10px;border-radius:50%;background:${statusColor};box-shadow:0 0 8px ${statusColor}80;"></div>
                    <span style="font-weight:900;font-size:15px;color:${statusColor};letter-spacing:-0.5px;">${escapeHtml(unit.call_sign)}</span>
                    <span style="margin-left:auto;font-size:9px;text-transform:uppercase;color:${statusColor};font-weight:800;letter-spacing:1px;padding:1px 6px;background:${statusColor}20;border:1px solid ${statusColor}30;">${escapeHtml(unit.status.replace('_', ' '))}</span>
                  </div>
                  <div style="font-size:11px;color:#d1d5db;margin-bottom:2px;">${escapeHtml(unit.officer_name)}</div>
                  ${unit.vehicle ? `<div style="font-size:10px;color:#6b7280;margin-bottom:6px;">Vehicle: ${escapeHtml(unit.vehicle)}</div>` : ''}
                  ${unit.call_number ? `
                    <div style="margin-top:6px;padding-top:6px;border-top:1px solid #333;">
                      <div style="font-size:10px;color:#60a5fa;font-weight:bold;">${escapeHtml(unit.call_number)}</div>
                      ${unit.current_call_type ? `<div style="font-size:10px;color:#d1d5db;">${escapeHtml(formatIncidentType(unit.current_call_type))}</div>` : ''}
                      <div style="font-size:9px;color:#6b7280;margin-top:2px;">${escapeHtml(location)}</div>
                    </div>
                  ` : `<div style="font-size:9px;color:#4b5563;margin-top:4px;">${escapeHtml(location)}</div>`}
                  ${cpgSection}
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
          const pColor = PRIORITY_COLORS[call.priority] || '#6b7280';

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
                unitsHtml = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #333;">
                  <div style="font-size:9px;color:#6b7280;margin-bottom:4px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">ASSIGNED UNITS (${assignedUnits.length})</div>
                  ${assignedUnits.map(u => {
                    const uc = UNIT_STATUS_COLORS[u.status] || '#6b7280';
                    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                      <div style="width:6px;height:6px;border-radius:50%;background:${uc};box-shadow:0 0 4px ${uc}80;"></div>
                      <span style="font-size:10px;color:${uc};font-weight:bold;font-family:monospace;">${escapeHtml(u.call_sign)}</span>
                      <span style="font-size:9px;color:#9ca3af;">${escapeHtml(u.officer_name)}</span>
                    </div>`;
                  }).join('')}
                </div>`;
              } else {
                unitsHtml = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #333;font-size:9px;color:#4b5563;">No units assigned</div>`;
              }

              infoWindowRef.current?.setContent(`
                <div style="min-width:200px;font-family:'Courier New',monospace;background:#111;color:#e5e7eb;padding:10px;border:1px solid ${pColor}50;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <span style="background:${pColor};color:white;padding:2px 8px;font-size:10px;font-weight:900;letter-spacing:0.5px;">${escapeHtml(call.priority)}</span>
                    <span style="font-weight:900;font-size:13px;color:${pColor};">${escapeHtml(formatIncidentType(call.incident_type))}</span>
                  </div>
                  <div style="font-size:12px;color:#60a5fa;font-weight:bold;">${escapeHtml(call.call_number)}</div>
                  <div style="font-size:10px;margin-top:4px;color:#d1d5db;">${escapeHtml(call.location_address)}</div>
                  ${call.property_name ? `<div style="font-size:10px;margin-top:4px;color:#3b82f6;">\u{1F3E2} ${escapeHtml(call.property_name)}</div>` : ''}
                  <div style="font-size:9px;margin-top:6px;text-transform:uppercase;color:#6b7280;letter-spacing:1px;font-weight:800;">${escapeHtml(call.status.replace(/_/g, ' '))}</div>
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
                <div style="min-width:160px;font-family:'Courier New',monospace;background:#111;color:#e5e7eb;padding:10px;border:1px solid #3b82f650;">
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

      const statusColor = UNIT_STATUS_COLORS[unit.status] || '#6b7280';
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
      road_name: string | null; gps_source: string;
      source?: string;
    }
    interface Trail {
      unit_id: number; call_sign: string; officer_name: string;
      badge_number: string; points: TrailPoint[];
    }

    const SOURCE_LABELS: Record<string, { label: string; color: string; icon: string }> = {
      gps: { label: 'GPS', color: '#22c55e', icon: '📡' },
      wifi: { label: 'WiFi', color: '#3b82f6', icon: '📶' },
      ip: { label: 'IP', color: '#f59e0b', icon: '🌐' },
      unknown: { label: '—', color: '#6b7280', icon: '' },
    };

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
          // WiFi/IP-sourced points get a distinct visual style (larger, different stroke)
          trail.points.forEach((pt, ptIdx) => {
            const isWifiSource = pt.source === 'wifi' || pt.source === 'ip';
            const isLast = ptIdx === trail.points.length - 1;
            const dot = new google.maps.Circle({
              center: { lat: pt.lat, lng: pt.lng },
              radius: isWifiSource ? 6 : 4,
              fillColor: isWifiSource ? '#3b82f6' : color,
              fillOpacity: isLast ? 1 : 0.6,
              strokeColor: isWifiSource ? '#60a5fa' : '#fff',
              strokeWeight: isLast ? 2 : (isWifiSource ? 1.5 : 0.5),
              strokeOpacity: 0.8,
              map,
              clickable: true,
              zIndex: ptIdx,
            });

            dot.addListener('click', () => {
              const time = new Date(pt.time).toLocaleString();
              const isCpg = pt.gps_source === 'clearpathgps';
              const gpsBadge = isCpg
                ? '<span style="display:inline-block;font-size:8px;font-weight:900;color:#60a5fa;background:#1e3a5f;border:1px solid #2563eb40;padding:1px 5px;margin-left:6px;letter-spacing:0.5px">CPG HARDWARE</span>'
                : '<span style="display:inline-block;font-size:8px;font-weight:900;color:#4ade80;background:#14532d80;border:1px solid #22c55e40;padding:1px 5px;margin-left:6px;letter-spacing:0.5px">BROWSER GPS</span>';
              const src = SOURCE_LABELS[pt.source || 'unknown'] || SOURCE_LABELS.unknown;
              const speedColor = pt.speed != null && pt.speed > 80 ? '#f87171' : pt.speed != null && pt.speed > 60 ? '#fbbf24' : '#e0e0e0';
              const html = `
                <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:220px;line-height:1.6;background:#0a0e14;padding:10px 12px;border:1px solid #1e2a3a">
                  <div style="font-weight:bold;font-size:13px;margin-bottom:2px;color:#ff4444;display:flex;align-items:center;flex-wrap:wrap">
                    ${escapeHtml(trail.call_sign)} — ${escapeHtml(trail.officer_name || 'Unknown')}
                    ${gpsBadge}
                  </div>
                  <div style="color:#8899aa;font-size:10px;margin-bottom:4px">${escapeHtml(trail.badge_number || '')}</div>
                  ${pt.road_name ? `<div style="color:#fbbf24;font-weight:bold;font-size:12px;margin-bottom:4px;padding:2px 0;border-bottom:1px solid #1e2a3a">${escapeHtml(pt.road_name)}</div>` : ''}
                  <div style="font-size:18px;font-weight:900;color:${speedColor};margin-bottom:4px">${formatSpeed(pt.speed)}</div>
                  <table style="width:100%;font-size:11px;border-collapse:collapse">
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Time</td><td style="font-weight:bold;color:#fff">${escapeHtml(time)}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Status</td><td style="font-weight:bold;color:#4fc3f7">${escapeHtml(STATUS_LABELS[pt.status] || pt.status)}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Source</td><td style="font-weight:bold;color:${src.color}">${src.icon} ${src.label}</td></tr>
                    <tr><td style="color:#6b7b8d;padding:1px 6px 1px 0">Heading</td><td style="color:#e0e0e0">${escapeHtml(formatHeading(pt.heading))}</td></tr>
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
    <div className="relative h-full flex font-mono">
      {/* Map Container */}
      <div className="flex-1 relative flex flex-col">
        {/* ── Spillman Flex Map Toolbar ── */}
        {!isMobile && (
          <div
            className="flex items-center px-1 gap-0 flex-shrink-0 z-[1002]"
            style={{
              height: 26,
              background: 'linear-gradient(180deg, #2a2a2a 0%, #1e1e1e 100%)',
              borderBottom: '1px solid #303030',
              borderTop: '1px solid #484848',
            }}
          >
            <button onClick={() => setLayersPanelOpen(!layersPanelOpen)} className={layersPanelOpen ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'} title="Layers Panel">
              <Layers style={{ width: 11, height: 11 }} />
              <span>Layers</span>
            </button>
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className={sidebarOpen ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'} title="Sidebar">
              {sidebarOpen ? <PanelLeftClose style={{ width: 11, height: 11 }} /> : <PanelLeftOpen style={{ width: 11, height: 11 }} />}
              <span>Sidebar</span>
            </button>
            <div className="toolbar-separator" />
            {(Object.entries(MAP_STYLE_LABELS) as [MapStyleId, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setMapStyle(key)}
                className={mapStyle === key ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'}
              >
                {label}
              </button>
            ))}
            <div className="toolbar-separator" />
            <button onClick={() => setShowBreadcrumbs(!showBreadcrumbs)} className={showBreadcrumbs ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'} title="GPS Breadcrumb Trails">
              <Route style={{ width: 11, height: 11 }} />
              <span>Trails</span>
            </button>
            <button onClick={() => setShowHeatmap(!showHeatmap)} className={showHeatmap ? 'toolbar-btn toolbar-btn-danger' : 'toolbar-btn'} title="Crime Heat Map">
              <Thermometer style={{ width: 11, height: 11 }} />
              <span>Heat</span>
            </button>
            <button onClick={() => setShowTrackingLines(!showTrackingLines)} className={showTrackingLines ? 'toolbar-btn toolbar-btn-success' : 'toolbar-btn'} title="Unit Tracking Lines">
              <Navigation2 style={{ width: 11, height: 11 }} />
              <span>Track</span>
            </button>
            <div className="toolbar-separator" />
            <button onClick={() => setShowGeoPanel(!showGeoPanel)} className={showGeoPanel ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'} title="Spatial GeoJSON Layers">
              <Globe2 style={{ width: 11, height: 11 }} />
              <span>Geo</span>
            </button>
            <button onClick={() => setShowShiftPanel(!showShiftPanel)} className={showShiftPanel ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'} title="Shift Planning">
              <CalendarDays style={{ width: 11, height: 11 }} />
              <span>Shifts</span>
            </button>
            <button onClick={() => setShowEventPanel(!showEventPanel)} className={showEventPanel ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'} title="Event Planning">
              <MapPin style={{ width: 11, height: 11 }} />
              <span>Events</span>
            </button>
            <div className="flex-1" />
            {/* Right side: GPS + WebSocket status */}
            <div className="flex items-center gap-2 panel-inset px-2 py-0.5" style={{ background: '#141414' }}>
              <div className="flex items-center gap-1">
                <div className={`led-dot ${isConnected ? 'led-green' : 'led-red'}`} style={{ width: 6, height: 6 }} />
                <span className="text-[8px] font-bold" style={{ color: isConnected ? '#22c55e' : '#ef4444' }}>WS</span>
              </div>
              <div className="flex items-center gap-1">
                <div className={`led-dot ${gps.isTracking ? 'led-green' : 'led-red'}`} style={{ width: 6, height: 6 }} />
                <span className="text-[8px] font-bold" style={{ color: gps.isTracking ? '#22c55e' : '#ef4444' }}>GPS</span>
              </div>
            </div>
          </div>
        )}

        {/* Map Canvas */}
        <div className="flex-1 relative">
        <div
          ref={mapRef}
          className="absolute inset-0 bg-surface-deep"
        />

        {/* RMPG Brand Watermark */}
        <div className="absolute top-2 left-2 z-10 pointer-events-none opacity-40">
          <RmpgLogo height={20} iconOnly />
        </div>

        {mapError && (
          <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-black/90">
            <div className="panel-beveled p-8 shadow-xl max-w-lg text-center" style={{ background: '#1a1a1a' }}>
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
              <h3 className="text-white text-sm font-bold mb-2">Map Configuration Required</h3>
              <pre className="text-rmpg-300 text-xs leading-relaxed mb-4 whitespace-pre-wrap text-left">{mapError}</pre>
              <div className="panel-inset p-3 text-left mb-4" style={{ background: '#0a0a0a' }}>
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
                  className="toolbar-btn-primary px-4 py-1.5 text-xs font-bold uppercase tracking-wider"
                >
                  Retry
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="toolbar-btn px-4 py-1.5 text-xs font-bold uppercase tracking-wider"
                >
                  Hard Reload
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {loading && !mapError && (
          <div className="absolute inset-0 z-[2000] flex items-center justify-center bg-black/90">
            <div className="panel-beveled p-6 shadow-xl" style={{ background: '#1a1a1a' }}>
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
            <div className="panel-beveled px-4 py-2 shadow-xl" style={{ background: '#3a0a0a', borderColor: '#8a0c0c' }}>
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
                  placeholder="SEARCH ADDRESS..."
                  className="input-dark text-[11px] pl-8 pr-8 py-1.5 w-[240px] font-mono"
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
                <div className="absolute top-full left-0 right-0 mt-1 panel-beveled shadow-2xl overflow-hidden" style={{ background: '#1a1a1a', zIndex: 50 }}>
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
            <div className="flex flex-col panel-beveled" style={{ overflow: 'hidden' }}>
              <button
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) map.setZoom((map.getZoom() || 12) + 1);
                }}
                className="toolbar-btn"
                style={{ padding: '4px 6px', borderBottom: '1px solid #303030' }}
                title="Zoom in"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  const map = mapInstanceRef.current;
                  if (map) map.setZoom((map.getZoom() || 12) - 1);
                }}
                className="toolbar-btn"
                style={{ padding: '4px 6px' }}
                title="Zoom out"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ── Layer Controls Panel - Top Left (Desktop only) ── */}
        {!isMobile && <div className="absolute top-4 left-4 z-[1000]">
          {!layersPanelOpen ? (
            <button
              onClick={() => setLayersPanelOpen(true)}
              className="toolbar-btn shadow-lg"
              style={{ padding: '6px' }}
              title="Show layers"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          ) : (
          <div className="panel-beveled shadow-2xl" style={{ width: 'clamp(160px, 14vw, 200px)', background: '#1a1a1a' }}>
            <PanelTitleBar title="LAYERS" icon={Layers}>
              <div className={`led-dot ${isConnected ? 'led-green' : 'led-red'}`} style={{ width: 6, height: 6 }} />
              <button
                onClick={() => setLayersPanelOpen(false)}
                className="toolbar-btn"
                style={{ padding: '0 2px' }}
                title="Hide layers"
              >
                <PanelLeftClose style={{ width: 10, height: 10 }} />
              </button>
            </PanelTitleBar>

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
                  <span style={{ color: layers[key] ? color : '#6b7280' }}>{icon}</span>
                  <span className="text-[10px] text-rmpg-200 flex-1">{label}</span>
                  <span className="text-[9px] font-mono font-bold" style={{ color: layers[key] ? color : '#6b7280' }}>{count}</span>
                </button>
              ))}

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
                <div className="flex items-center gap-1 px-3 py-1">
                  {[7, 14, 30, 90].map((days) => (
                    <button
                      key={days}
                      onClick={() => setHeatmapDays(days)}
                      className={`px-1.5 py-0.5 text-[8px] font-mono font-bold transition-colors ${
                        heatmapDays === days
                          ? 'panel-inset bg-surface-deep text-red-400'
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
                className={`flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors ${
                  showTrackingLines ? 'panel-inset bg-surface-deep' : 'opacity-40 hover:opacity-70 hover:bg-rmpg-800/50'
                }`}
              >
                {showTrackingLines ? <Eye className="w-3 h-3 text-green-400" /> : <EyeOff className="w-3 h-3 text-rmpg-500" />}
                <Navigation2 className="w-3 h-3 text-green-400" />
                <span className="text-[10px] text-rmpg-200 flex-1">Tracking Lines</span>
              </button>

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
                <div className="flex items-center gap-1 px-3 py-1">
                  {[2, 4, 8, 12, 24].map((h) => (
                    <button
                      key={h}
                      onClick={() => setBreadcrumbHours(h)}
                      className={`px-1.5 py-0.5 text-[8px] font-mono font-bold transition-colors ${
                        breadcrumbHours === h
                          ? 'panel-inset bg-surface-deep text-cyan-400'
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
                    className="toolbar-btn px-1.5 py-0.5 text-[8px] font-mono font-bold transition-colors text-brand-400 ml-1 flex items-center gap-0.5"
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
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-colors hover:bg-rmpg-800/50"
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
                      className={`w-full text-left px-4 py-1 text-[10px] transition-colors ${
                        mapStyle === key ? 'text-brand-400 panel-inset bg-surface-deep' : 'text-rmpg-400 hover:text-rmpg-200 hover:bg-rmpg-800/50'
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
                          <span className="text-[8px] font-mono" style={{ color: state.visible ? cfg.style.strokeColor : '#6b7280' }}>
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

        {/* ── Status Legend - Bottom Left (desktop only, wraps on narrow) ── */}
        {!isMobile && <div className="absolute bottom-2 left-2 z-[1000] max-w-[calc(100vw-16rem)]">
          <div className="panel-beveled px-2 py-1.5 shadow-xl" style={{ background: '#1a1a1a' }}>
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
          <div className="panel-beveled px-3 py-1.5 shadow-xl" style={{ background: '#1a1a1a' }}>
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
              className="toolbar-btn p-2 shadow-xl text-blue-400"
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
            className="toolbar-btn p-2 shadow-xl"
            title="Reset view"
          >
            <Crosshair className="w-4 h-4 text-rmpg-300" />
          </button>
        </div>
        </div>{/* end inner map canvas wrapper */}
      </div>

      {/* ── Right Sidebar - Unit/Call List (Desktop only, responsive width) ── */}
      {!isMobile && <div
        className="flex flex-col panel-beveled transition-all"
        style={{
          width: sidebarOpen ? 'clamp(220px, 20vw, 300px)' : 36,
          background: '#1a1a1a',
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
                    const pColor = PRIORITY_COLORS[call.priority] || '#6b7280';
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
                      color: mobileSheetTab === id ? color : '#888',
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
                      background: layers[key] ? 'rgba(34,197,94,0.08)' : '#1a1a1a',
                      border: '1px solid #2a2a2a',
                      minHeight: 44,
                    }}
                  >
                    {layers[key] ? <Eye className="w-4 h-4 text-green-400" /> : <EyeOff className="w-4 h-4 text-rmpg-500" />}
                    <Icon style={{ width: 16, height: 16, color: layers[key] ? color : '#6b7280' }} />
                    <span className="text-sm text-rmpg-200 flex-1">{label}</span>
                  </button>
                ))}

                <button
                  onClick={() => setShowHeatmap(!showHeatmap)}
                  className="flex items-center gap-3 w-full px-3 py-3 text-left transition-colors"
                  style={{
                    background: showHeatmap ? 'rgba(239,68,68,0.08)' : '#1a1a1a',
                    border: '1px solid #2a2a2a',
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
                    background: showBreadcrumbs ? 'rgba(34,211,238,0.08)' : '#1a1a1a',
                    border: '1px solid #2a2a2a',
                    minHeight: 44,
                  }}
                >
                  {showBreadcrumbs ? <Eye className="w-4 h-4 text-cyan-400" /> : <EyeOff className="w-4 h-4 text-rmpg-500" />}
                  <Route style={{ width: 16, height: 16 }} className="text-cyan-400" />
                  <span className="text-sm text-rmpg-200 flex-1">Breadcrumbs</span>
                </button>

                {/* Breadcrumb time range selector */}
                {showBreadcrumbs && (
                  <div className="flex gap-1 px-3 py-2" style={{ background: '#111', border: '1px solid #2a2a2a' }}>
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
                    background: '#1a1a1a',
                    border: '1px solid #2a2a2a',
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
                  const pColor = PRIORITY_COLORS[call.priority] || '#6b7280';
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
