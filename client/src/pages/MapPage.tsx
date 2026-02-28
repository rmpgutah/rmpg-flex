import React, { useEffect, useRef, useState, useCallback } from 'react';
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
  X,
  Check,
  FileText,
  MousePointer2,
  CalendarDays,
  UserCheck,
  Copy,
  Save,
  Play,
} from 'lucide-react';
// Direct script-tag loader — more reliable than @googlemaps/js-api-loader
// which has known issues with React StrictMode and intermittent failures.
import type { UnitStatus } from '../types';
import RmpgLogo from '../components/RmpgLogo';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { usePersistedTab } from '../hooks/usePersistedState';
import { useWebSocket } from '../context/WebSocketContext';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { formatIncidentType } from '../utils/caseNumbers';
import { escapeHtml } from '../utils/sanitize';
import { useGeoJsonLayers, GEO_LAYER_CONFIGS } from '../hooks/useGeoJsonLayers';
import { useEventPlanning, PLAN_COLORS, PLAN_TYPE_LABELS, type PlanItemType } from '../hooks/useEventPlanning';
import { useShiftPlanning, SHIFT_TYPES, type ShiftType } from '../hooks/useShiftPlanning';

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
type MapStyleId = 'dark' | 'satellite' | 'hybrid' | 'streets' | 'arcgis';

const MAP_STYLE_LABELS: Record<MapStyleId, string> = {
  dark: 'Dark',
  satellite: 'Satellite',
  hybrid: 'Hybrid',
  streets: 'Streets',
  arcgis: 'ArcGIS Web Map',
};

// ============================================================
// Google Maps Dark Mode Style (Night Mode)
// ============================================================

const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#0a0a0a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#000000' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#555555' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#707070' }] },
  { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#0e0e0e' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#111111' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#0c0c0c' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0d120d' }, { visibility: 'simplified' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#141414' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#262626' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1e1e1e' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#606060' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#202020' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#050505' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#333333' }] },
];

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

function buildUnitMarkerContent(callSign: string, status: UnitStatus): HTMLElement {
  const color = UNIT_STATUS_COLORS[status];
  const label = UNIT_STATUS_LABELS[status];
  const isActive = status !== 'available' && status !== 'off_duty';

  const el = document.createElement('div');
  el.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;cursor:pointer;';
  el.innerHTML = `
    <div style="
      width:36px;height:42px;position:relative;
      background:linear-gradient(180deg,${color}dd,${color}77);
      clip-path:polygon(50% 0%,100% 12%,100% 68%,50% 100%,0% 68%,0% 12%);
      display:flex;align-items:center;justify-content:center;
      filter:drop-shadow(0 2px 4px rgba(0,0,0,0.7));
      ${isActive ? `box-shadow:0 0 10px ${color}60;` : ''}
    ">
      <div style="
        width:32px;height:38px;
        background:linear-gradient(180deg,#1a1a1add,#111111ee);
        clip-path:polygon(50% 2%,98% 13%,98% 67%,50% 98%,2% 67%,2% 13%);
        display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
      ">
        <span style="color:${color};font-size:9px;font-weight:900;font-family:'Courier New',monospace;letter-spacing:-0.5px;line-height:1;text-shadow:0 0 4px ${color}40;">${callSign}</span>
        <span style="color:${color}99;font-size:6px;font-weight:700;font-family:'Courier New',monospace;letter-spacing:1px;">${label}</span>
      </div>
    </div>
    ${isActive ? `<div style="position:absolute;top:-2px;right:-2px;width:6px;height:6px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color};animation:pulse-led 1.5s infinite;"></div>` : ''}
  `;
  return el;
}

function buildIncidentMarkerContent(priority: string, incidentType: string): HTMLElement {
  const color = PRIORITY_COLORS[priority] || '#6b7280';
  const isPriority1 = priority === 'P1';
  const { symbol, category } = getIncidentCategory(incidentType);

  const el = document.createElement('div');
  el.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;cursor:pointer;';
  el.innerHTML = `
    <div style="
      width:28px;height:28px;border-radius:6px;
      background:linear-gradient(180deg,#1e1e1eee,#141414ee);
      border:2px solid ${color};
      display:flex;align-items:center;justify-content:center;
      position:relative;overflow:hidden;
      filter:drop-shadow(0 2px 3px rgba(0,0,0,0.5));
      ${isPriority1 ? 'animation:pulse-incident 1.5s ease-in-out infinite;' : ''}
    ">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,${color},transparent);"></div>
      <span style="font-size:14px;line-height:1;margin-top:1px;">${symbol}</span>
    </div>
    <div style="
      position:absolute;bottom:-7px;
      background:${color};color:#fff;font-size:6px;font-weight:900;
      padding:0 3px;border-radius:2px;font-family:'Courier New',monospace;
      line-height:10px;letter-spacing:0.3px;white-space:nowrap;
    ">${priority} ${category}</div>
  `;
  return el;
}

function buildPropertyMarkerContent(name: string): HTMLElement {
  const shortName = name.length > 8 ? name.substring(0, 7) + '\u2026' : name;
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;';
  el.innerHTML = `
    <div style="
      display:flex;align-items:center;justify-content:center;
      width:22px;height:22px;border-radius:4px;
      background:linear-gradient(180deg,#0f172aee,#0a1020ee);border:1.5px solid #3b82f680;
      filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4));
    ">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="2" ry="2"/>
        <path d="M9 22v-4h6v4"/>
        <path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>
      </svg>
    </div>
    <div style="font-size:6px;color:#60a5fa;font-weight:700;font-family:'Courier New',monospace;margin-top:1px;text-shadow:0 1px 2px rgba(0,0,0,0.8);white-space:nowrap;">${shortName}</div>
  `;
  return el;
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

// ============================================================
// Google Maps Script Loader (direct script tag — bypasses js-api-loader issues)
// ============================================================

let _gmapsLoadPromise: Promise<void> | null = null;

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (_gmapsLoadPromise) return _gmapsLoadPromise;

  // If google.maps already exists (HMR / page revisit), resolve immediately
  if (typeof google !== 'undefined' && google.maps && google.maps.Map) {
    _gmapsLoadPromise = Promise.resolve();
    return _gmapsLoadPromise;
  }

  _gmapsLoadPromise = new Promise<void>((resolve, reject) => {
    // Remove any stale/failed script tags so we always get a fresh load.
    // A leftover <script> from a previous failed attempt (e.g. server was
    // down) would never fire its callback, causing an infinite polling loop.
    const existing = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existing) {
      // If Google Maps already fully loaded despite the stale tag, resolve now
      if (typeof google !== 'undefined' && google.maps && google.maps.Map) {
        resolve();
        return;
      }
      // Otherwise remove the dead script so we can inject a fresh one
      existing.remove();
      // Also clean up any lingering callback
      delete (window as any).__rmpg_gmaps_init__;
    }

    // Create and inject the script tag
    const callbackName = '__rmpg_gmaps_init__';
    (window as any)[callbackName] = () => {
      delete (window as any)[callbackName];
      resolve();
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,marker&callback=${callbackName}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      _gmapsLoadPromise = null; // Allow retry
      script.remove(); // Clean up the failed tag
      delete (window as any)[callbackName];
      reject(new Error('Failed to load Google Maps script'));
    };
    document.head.appendChild(script);

    // Safety timeout — if the callback never fires within 15 seconds,
    // treat it as a failure so the user sees the error overlay + Retry.
    setTimeout(() => {
      if (typeof google === 'undefined' || !google.maps || !google.maps.Map) {
        _gmapsLoadPromise = null;
        script.remove();
        delete (window as any)[callbackName];
        reject(new Error('Google Maps script load timed out'));
      }
    }, 15000);
  });

  return _gmapsLoadPromise;
}

const STYLE_ID = 'rmpg-map-keyframes';
function injectKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes pulse-led { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
    @keyframes pulse-incident { 0%,100% { box-shadow:0 0 4px rgba(220,38,38,0.3); transform:scale(1); } 50% { box-shadow:0 0 14px rgba(220,38,38,0.7); transform:scale(1.05); } }
    @keyframes pulse-gps { 0%,100% { transform:scale(1); opacity:0.7; } 50% { transform:scale(2.5); opacity:0; } }
    .gm-style-iw { background:#111 !important; border:1px solid #333 !important; border-radius:4px !important; color:#e5e7eb !important; }
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
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(false);
  const [breadcrumbHours, setBreadcrumbHours] = useState(8);
  const breadcrumbLinesRef = useRef<google.maps.Polyline[]>([]);

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = usePersistedTab('rmpg_map_sidebar', 'units', ['units', 'calls'] as const);

  // Map style
  const [mapStyle, setMapStyle] = usePersistedTab('rmpg_map_style', 'dark' as MapStyleId, ['dark', 'satellite', 'hybrid', 'streets', 'arcgis'] as const);
  const [showMapStyles, setShowMapStyles] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // GPS own-position
  const gps = useGpsTracking();
  const selfMarkerRef = useRef<any>(null);

  // WebSocket
  const { isConnected, subscribe } = useWebSocket();

  // Shift planning (area-based officer assignment)
  const shiftPlanning = useShiftPlanning();
  const [showShiftPanel, setShowShiftPanel] = useState(false);
  const [newShiftPlanName, setNewShiftPlanName] = useState('');
  const [newShiftPlanDate, setNewShiftPlanDate] = useState(() => new Date().toISOString().split('T')[0]);
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
    const interval = setInterval(() => { fetchAllData({ silent: true }); }, 60000);
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

    const unsubscribeCall = subscribe('call_update', (data: any) => {
      if (data && data.call) {
        setCalls((prev) => {
          const index = prev.findIndex((c) => c.id === data.call.id);
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = { ...updated[index], ...data.call };
            if (data.call.status === 'closed' || data.call.status === 'completed') {
              return updated.filter((c) => c.id !== data.call.id);
            }
            return updated;
          }
          if (data.call.status !== 'closed' && data.call.status !== 'completed') {
            return [...prev, data.call];
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

    // Skip Google Maps initialization entirely when ArcGIS mode is active.
    // Google Maps will be initialized lazily when the user switches to a
    // Google Maps style (dark/satellite/hybrid/streets).
    if (mapStyle === 'arcgis') return;

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
    // (e.g. server restart, brief network blip).
    let cancelled = false;
    const MAX_RETRIES = 5;
    const RETRY_DELAYS = [2000, 4000, 8000, 12000, 16000]; // ms

    function initMap() {
      if (!mapRef.current || authFailed || cancelled) return;
      if (mapInstanceRef.current) { setMapLoaded(true); return; }

      const map = new google.maps.Map(mapRef.current, {
        center: { lat: 40.7608, lng: -111.8910 },
        zoom: 12,
        disableDefaultUI: true,
        zoomControl: true,
        zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
        styles: DARK_MAP_STYLE,
        backgroundColor: '#0a0a0a',
      });

      mapInstanceRef.current = map;
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

      useAdvancedMarkersRef.current = false;
      if (!authFailed) setMapLoaded(true);
    }

    function attemptLoad(attempt: number) {
      if (cancelled) return;
      loadGoogleMaps(apiKey)
        .then(() => initMap())
        .catch((err: any) => {
          if (cancelled) return;
          const errMsg = err?.message || String(err);
          devWarn(`[MapPage] Google Maps load attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`, errMsg);

          if (attempt < MAX_RETRIES) {
            const delay = RETRY_DELAYS[attempt] || 16000;
            devLog(`[MapPage] Retrying in ${delay / 1000}s...`);
            setTimeout(() => attemptLoad(attempt + 1), delay);
          } else {
            console.error('[MapPage] Google Maps load failed after all retries');
            setMapError(
              'Failed to load Google Maps after multiple attempts.\n\n' +
              'This usually means the server was restarting. Try clicking Retry below.\n\n' +
              (errMsg ? `Technical details: ${errMsg}` : '')
            );
          }
        });
    }

    attemptLoad(0);

    return () => {
      cancelled = true; // Stop any pending retries
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

    if (mapStyle === 'arcgis') {
      // ArcGIS mode — Google Map stays hidden, ArcGIS embed takes over
      return;
    } else if (mapStyle === 'dark') {
      map.setMapTypeId('roadmap');
      map.setOptions({ styles: DARK_MAP_STYLE });
    } else if (mapStyle === 'satellite') {
      map.setMapTypeId('satellite');
      map.setOptions({ styles: [] });
    } else if (mapStyle === 'hybrid') {
      map.setMapTypeId('hybrid');
      map.setOptions({ styles: [] });
    } else if (mapStyle === 'streets') {
      map.setMapTypeId('roadmap');
      map.setOptions({ styles: [] });
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
              infoWindowRef.current?.setContent(`
                <div style="min-width:200px;font-family:'Courier New',monospace;background:#111;color:#e5e7eb;padding:10px;border:1px solid ${statusColor}50;border-radius:4px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #333;">
                    <div style="width:10px;height:10px;border-radius:50%;background:${statusColor};box-shadow:0 0 8px ${statusColor}80;"></div>
                    <span style="font-weight:900;font-size:15px;color:${statusColor};letter-spacing:-0.5px;">${escapeHtml(unit.call_sign)}</span>
                    <span style="margin-left:auto;font-size:9px;text-transform:uppercase;color:${statusColor};font-weight:800;letter-spacing:1px;padding:1px 6px;background:${statusColor}20;border:1px solid ${statusColor}30;border-radius:2px;">${escapeHtml(unit.status.replace('_', ' '))}</span>
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
                </div>
              `);
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
          const content = buildIncidentMarkerContent(call.priority, call.incident_type);
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
                <div style="min-width:200px;font-family:'Courier New',monospace;background:#111;color:#e5e7eb;padding:10px;border:1px solid ${pColor}50;border-radius:4px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <span style="background:${pColor};color:white;padding:2px 8px;font-size:10px;font-weight:900;border-radius:3px;letter-spacing:0.5px;">${escapeHtml(call.priority)}</span>
                    <span style="font-weight:900;font-size:13px;color:${pColor};">${escapeHtml(formatIncidentType(call.incident_type))}</span>
                  </div>
                  <div style="font-size:12px;color:#60a5fa;font-weight:bold;">${escapeHtml(call.call_number)}</div>
                  <div style="font-size:10px;margin-top:4px;color:#d1d5db;">${escapeHtml(call.location_address)}</div>
                  ${call.property_name ? `<div style="font-size:10px;margin-top:4px;color:#3b82f6;">\u{1F3E2} ${escapeHtml(call.property_name)}</div>` : ''}
                  <div style="font-size:9px;margin-top:6px;text-transform:uppercase;color:#6b7280;letter-spacing:1px;font-weight:800;">${escapeHtml(call.status)}</div>
                  ${unitsHtml}
                </div>
              `);
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
                <div style="min-width:160px;font-family:'Courier New',monospace;background:#111;color:#e5e7eb;padding:10px;border:1px solid #3b82f650;border-radius:4px;">
                  <div style="font-weight:900;font-size:13px;color:#60a5fa;margin-bottom:4px;">${escapeHtml(prop.name)}</div>
                  <div style="font-size:10px;color:#d1d5db;">${escapeHtml(prop.address)}</div>
                  ${prop.client_name ? `<div style="font-size:9px;margin-top:6px;color:#9ca3af;font-weight:600;">Client: ${escapeHtml(prop.client_name)}</div>` : ''}
                </div>
              `);
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
          if (trail.points.length < 2) return;

          const color = TRAIL_COLORS[idx % TRAIL_COLORS.length];

          // Draw segments color-coded by status
          for (let i = 0; i < trail.points.length - 1; i++) {
            const p1 = trail.points[i];
            const p2 = trail.points[i + 1];
            const age = (trail.points.length - i) / trail.points.length;
            const opacity = 0.3 + age * 0.5;

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
                <div style="font-family:monospace;font-size:11px;color:#111;min-width:200px;line-height:1.6">
                  <div style="font-weight:bold;font-size:13px;margin-bottom:4px;color:#c41e1e">
                    ${trail.call_sign} — ${trail.officer_name || 'Unknown'}
                  </div>
                  <div style="color:#666;font-size:10px;margin-bottom:6px">${trail.badge_number || ''}</div>
                  <table style="width:100%;font-size:11px;border-collapse:collapse">
                    <tr><td style="color:#888;padding:1px 6px 1px 0">Time</td><td style="font-weight:bold">${time}</td></tr>
                    <tr><td style="color:#888;padding:1px 6px 1px 0">Status</td><td style="font-weight:bold">${STATUS_LABELS[pt.status] || pt.status}</td></tr>
                    <tr><td style="color:#888;padding:1px 6px 1px 0">Speed</td><td>${formatSpeed(pt.speed)}</td></tr>
                    <tr><td style="color:#888;padding:1px 6px 1px 0">Heading</td><td>${formatHeading(pt.heading)}</td></tr>
                    <tr><td style="color:#888;padding:1px 6px 1px 0">Accuracy</td><td>${pt.accuracy != null ? `±${Math.round(pt.accuracy)}m` : '—'}</td></tr>
                    <tr><td style="color:#888;padding:1px 6px 1px 0">Position</td><td style="font-size:10px">${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}</td></tr>
                    ${pt.call_number ? `<tr><td style="color:#888;padding:1px 6px 1px 0">Call</td><td style="font-weight:bold">${pt.call_number} — ${pt.call_type || ''}</td></tr>` : ''}
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
        // Non-critical
      }
    };

    fetchTrails();

    // Refresh trails every 60 seconds while visible
    const interval = setInterval(fetchTrails, 60000);
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

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="relative h-full flex">
      {/* Map Container */}
      <div className="flex-1 relative">
        {/* Google Maps Container — hidden when ArcGIS mode is active */}
        <div
          ref={mapRef}
          className="absolute inset-0 bg-surface-deep"
          style={{ display: mapStyle === 'arcgis' ? 'none' : undefined }}
        />

        {/* ArcGIS Embedded Map — iframe to standalone HTML (ArcGIS web
            components require their own document context; dynamically
            injecting them into a React SPA hits CSP + custom-element
            lifecycle issues). The iframe loads from public/geojson/arcgis-embed.html
            which has the <script type="module"> and <arcgis-embedded-map> inline. */}
        {mapStyle === 'arcgis' && (
          <iframe
            src="/geojson/arcgis-embed.html"
            title="ArcGIS Web Map"
            className="absolute inset-0 w-full h-full border-0"
            allow="geolocation"
          />
        )}

        {/* RMPG Brand Watermark */}
        <div className="absolute top-2 left-2 z-10 pointer-events-none opacity-40">
          <RmpgLogo height={20} iconOnly />
        </div>

        {/* Google Maps Error Overlay — only shown for Google Maps styles, not ArcGIS */}
        {mapError && mapStyle !== 'arcgis' && (
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

        {/* ── Layer Controls Panel - Top Left ── */}
        <div className="absolute top-4 left-4 z-[1000]">
          <div className="bg-surface-deep/95 border border-rmpg-600 backdrop-blur-sm shadow-2xl" style={{ minWidth: 180, borderRadius: 4 }}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-700">
              <Layers className="w-3.5 h-3.5 text-brand-400" />
              <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-widest flex-1">Layers</span>
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
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
                  <span style={{ color: layers[key] ? color : '#6b7280' }}>{icon}</span>
                  <span className="text-[10px] text-rmpg-200 flex-1">{label}</span>
                  <span className="text-[9px] font-mono font-bold" style={{ color: layers[key] ? color : '#6b7280' }}>{count}</span>
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
                            shiftPlanning.duplicatePlan(shiftPlanning.activePlanId!, tomorrow.toISOString().split('T')[0]);
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
        </div>

        {/* ── Status Legend - Bottom Left ── */}
        <div className="absolute bottom-4 left-4 z-[1000]">
          <div className="bg-surface-deep/95 border border-rmpg-600 p-3 backdrop-blur-sm shadow-xl" style={{ borderRadius: 4 }}>
            <span className="text-[9px] font-bold text-rmpg-400 uppercase tracking-widest">Unit Status Legend</span>
            <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 mt-2">
              {(Object.entries(UNIT_STATUS_COLORS) as [UnitStatus, string][])
                .filter(([k]) => k !== 'off_duty')
                .map(([status, color]) => (
                  <div key={status} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}80` }} />
                    <span className="text-[9px] text-rmpg-300 capitalize font-mono">{UNIT_STATUS_LABELS[status as UnitStatus]}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* ── Stats Bar - Top Center ── */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000]">
          <div className="bg-surface-deep/95 border border-rmpg-600 px-5 py-2.5 backdrop-blur-sm shadow-xl" style={{ borderRadius: 4 }}>
            <div className="flex items-center gap-5 text-[10px] font-mono">
              <div className="flex items-center gap-2">
                <Siren className="w-3.5 h-3.5 text-red-400" />
                <span className="text-rmpg-400">ACTIVE</span>
                <span className="text-white font-bold text-sm">{callsWithCoords.length}</span>
              </div>
              <div className="w-px h-5 bg-rmpg-600" />
              <div className="flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-green-400" />
                <span className="text-rmpg-400">UNITS</span>
                <span className="text-white font-bold text-sm">{unitsWithCoords.length}</span>
              </div>
              <div className="w-px h-5 bg-rmpg-600" />
              <div className="flex items-center gap-1.5">
                <span className="text-green-400 text-[9px]">AVL</span>
                <span className="text-green-400 font-bold">{unitsByStatus['available'] || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-amber-400 text-[9px]">DSP</span>
                <span className="text-amber-400 font-bold">{unitsByStatus['dispatched'] || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-blue-400 text-[9px]">ENR</span>
                <span className="text-blue-400 font-bold">{unitsByStatus['enroute'] || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-purple-400 text-[9px]">ONS</span>
                <span className="text-purple-400 font-bold">{unitsByStatus['onscene'] || 0}</span>
              </div>
              {calls.length > 0 && (
                <>
                  <div className="w-px h-5 bg-rmpg-600" />
                  {callsByPriority['P1'] ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-red-400 text-[9px]">P1</span>
                      <span className="text-red-400 font-bold">{callsByPriority['P1']}</span>
                    </div>
                  ) : null}
                  {callsByPriority['P2'] ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-amber-400 text-[9px]">P2</span>
                      <span className="text-amber-400 font-bold">{callsByPriority['P2']}</span>
                    </div>
                  ) : null}
                  {callsByPriority['P3'] ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-blue-400 text-[9px]">P3</span>
                      <span className="text-blue-400 font-bold">{callsByPriority['P3']}</span>
                    </div>
                  ) : null}
                </>
              )}
              {isConnected && (
                <>
                  <div className="w-px h-5 bg-rmpg-600" />
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-green-400 font-bold">LIVE</span>
                  </div>
                </>
              )}
              {showTrackingLines && trackingLinesRef.current.length > 0 && (
                <>
                  <div className="w-px h-5 bg-rmpg-600" />
                  <div className="flex items-center gap-1.5">
                    <Navigation2 className="w-3 h-3 text-cyan-400" />
                    <span className="text-cyan-400 text-[9px]">LINKS</span>
                    <span className="text-cyan-400 font-bold">{trackingLinesRef.current.length}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Bottom Right Buttons (Recenter + GPS Locate) ── */}
        <div className="absolute bottom-4 right-4 z-[1000] flex flex-col gap-2" style={{ marginRight: sidebarOpen ? 280 : 36 }}>
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

      {/* ── Right Sidebar - Unit/Call List ── */}
      <div
        className="flex flex-col border-l border-rmpg-600 transition-all"
        style={{
          width: sidebarOpen ? 300 : 36,
          background: '#0a0a0a',
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
                    const pColor = PRIORITY_COLORS[call.priority] || '#6b7280';
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
                          <span className="text-[8px] font-mono text-rmpg-400 uppercase font-bold">{call.status}</span>
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
      </div>
    </div>
  );
}
