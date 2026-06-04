import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Map, Navigation, MapPin, Clock, Save, Trash2, Plus, GripVertical,
  ArrowRight, Search, AlertTriangle, Check, X, ChevronDown,
  Star, History, Route, Settings, Car, Fuel, Shield, Activity,
  BarChart3, TrendingUp, Share2, Printer, Gauge, Thermometer,
  Wind, Zap, Flag, Layers, Sun, Moon, Maximize2, Minimize2,
  Bell, Wifi, WifiOff, RefreshCw, Loader2, ChevronUp,
  ChevronLeft, ChevronRight, User, Calendar, Award,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { forwardGeocode } from '../utils/mapboxServices';
import { apiFetch } from '../hooks/useApi';

// ─── Types ───────────────────────────────────────────────────

interface GeocodeResult {
  id: string;
  place_name: string;
  center: [number, number];
  text: string;
}

interface Waypoint {
  id: string;
  query: string;
  result: GeocodeResult | null;
}

interface SavedRoute {
  id: string;
  name: string;
  origin: GeocodeResult;
  destination: GeocodeResult;
  waypoints: GeocodeResult[];
  profile: RouteProfile;
  createdAt: string;
  tags?: string;
  notes?: string;
}

interface RecentDestination {
  result: GeocodeResult;
  lastUsed: string;
  useCount: number;
}

type RouteProfile = 'driving-traffic' | 'driving' | 'walking' | 'cycling';

const ROUTE_PROFILES: { value: RouteProfile; label: string; icon: React.ReactNode }[] = [
  { value: 'driving-traffic', label: 'Driving (Traffic Aware)', icon: <Car className="w-3 h-3" /> },
  { value: 'driving', label: 'Driving (Fastest)', icon: <Car className="w-3 h-3" /> },
  { value: 'walking', label: 'Walking', icon: <Activity className="w-3 h-3" /> },
  { value: 'cycling', label: 'Cycling', icon: <Wind className="w-3 h-3" /> },
];

interface FleetVehicle {
  id: number;
  vehicle_number: string;
  make: string | null;
  model: string | null;
  year: number | null;
  plate_number: string | null;
  status: string;
  current_mileage: number | null;
  gps_lat: number | null;
  gps_lon: number | null;
  gps_speed: number | null;
  gps_heading: number | null;
  gps_reported_at: string | null;
  assigned_unit_call_sign: string | null;
  next_service_due: string | null;
  insurance_expiry: string | null;
  registration_expiry: string | null;
  color: string | null;
}

interface FleetSummary {
  total_vehicles: number;
  vehicles_in_service: number;
  vehicles_in_maintenance: number;
  vehicles_gps_active: number;
  avg_mpg: number | null;
  total_fuel_cost: number;
}

interface RouteStep {
  instruction: string;
  distance: string;
  duration: string;
  direction: string;
}

interface RouteResult {
  distance: string;
  distanceMeters: number;
  duration: string;
  durationSec: number;
  steps: RouteStep[];
  congestion: 'low' | 'moderate' | 'heavy' | 'severe' | null;
  error?: string;
}

const STORAGE_KEY_SAVED = 'rmpg_saved_routes';
const STORAGE_KEY_RECENT = 'rmpg_recent_destinations';

function loadSavedRoutes(): SavedRoute[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_SAVED) || '[]'); } catch { return []; }
}
function saveSavedRoutes(routes: SavedRoute[]) {
  localStorage.setItem(STORAGE_KEY_SAVED, JSON.stringify(routes));
}
function loadRecentDestinations(): RecentDestination[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_RECENT) || '[]'); } catch { return []; }
}
function saveRecentDestinations(dests: RecentDestination[]) {
  localStorage.setItem(STORAGE_KEY_RECENT, JSON.stringify(dests));
}
function addRecentDestination(result: GeocodeResult) {
  const recent = loadRecentDestinations();
  const existing = recent.find(r => r.result.id === result.id);
  if (existing) { existing.lastUsed = new Date().toISOString(); existing.useCount += 1; }
  else { recent.unshift({ result, lastUsed: new Date().toISOString(), useCount: 1 }); }
  saveRecentDestinations(recent.slice(0, 20));
}
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function validateCoordinates(val: string): { lng: number; lat: number } | null {
  const parts = val.trim().split(',').map(s => parseFloat(s.trim()));
  if (parts.length !== 2) return null;
  const [lng, lat] = parts;
  if (isNaN(lng) || isNaN(lat) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lng, lat };
}
function metersToMiles(m: number): string { return (m * 0.000621371).toFixed(1); }
function secsToMinutes(s: number): string { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`; }

const STATUS_COLORS: Record<string, string> = {
  in_service: '#22c55e', maintenance: '#f59e0b', out_of_service: '#ef4444', retired: '#6b7280',
};
const STATUS_LABELS: Record<string, string> = {
  in_service: 'In Service', maintenance: 'Maintenance', out_of_service: 'Out of Service', retired: 'Retired',
};

// ─── Component ───────────────────────────────────────────────

export default function NavigationPage() {
  const [originQuery, setOriginQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [originResult, setOriginResult] = useState<GeocodeResult | null>(null);
  const [destResult, setDestResult] = useState<GeocodeResult | null>(null);
  const [originSuggestions, setOriginSuggestions] = useState<GeocodeResult[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<GeocodeResult[]>([]);
  const [originLoading, setOriginLoading] = useState(false);
  const [destLoading, setDestLoading] = useState(false);
  const [originFocused, setOriginFocused] = useState(false);
  const [destFocused, setDestFocused] = useState(false);
  const [profile, setProfile] = useState<RouteProfile>('driving-traffic');
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>(loadSavedRoutes);
  const [recentDests, setRecentDests] = useState<RecentDestination[]>(loadRecentDestinations);
  const [routeName, setRouteName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [originCoordInput, setOriginCoordInput] = useState('');
  const [destCoordInput, setDestCoordInput] = useState('');
  const [showOriginCoords, setShowOriginCoords] = useState(false);
  const [showDestCoords, setShowDestCoords] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [savedSearch, setSavedSearch] = useState('');
  const [sortSaved, setSortSaved] = useState<'date' | 'name'>('date');
  const [activeTab, setActiveTab] = useState<'plan' | 'saved' | 'fleet'>('plan');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [avoidTolls, setAvoidTolls] = useState(false);
  const [avoidHighways, setAvoidHighways] = useState(false);
  const [routeTag, setRouteTag] = useState('');
  const [routeNotes, setRouteNotes] = useState('');

  // ── Fleet state ──
  const [fleetVehicles, setFleetVehicles] = useState<FleetVehicle[]>([]);
  const [fleetSummary, setFleetSummary] = useState<FleetSummary | null>(null);
  const [fleetLoading, setFleetLoading] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(null);
  const [fleetSearch, setFleetSearch] = useState('');
  const [fleetFilter, setFleetFilter] = useState<string>('all');
  const [nearestVehicles, setNearestVehicles] = useState<FleetVehicle[]>([]);

  // ── Ref for waypoint drag ──
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const originDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const destDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Toast helper ──
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Fetch fleet data ──
  const fetchFleet = useCallback(async () => {
    setFleetLoading(true);
    try {
      const data = await apiFetch<FleetVehicle[]>('/fleet/map');
      setFleetVehicles(data || []);
      const summary = await apiFetch<any>('/fleet/analytics');
      if (summary?.fleet_summary) {
        setFleetSummary({
          total_vehicles: summary.fleet_summary.total_vehicles || 0,
          vehicles_in_service: summary.status_breakdown?.find((s: any) => s.status === 'in_service')?.count || 0,
          vehicles_in_maintenance: summary.status_breakdown?.find((s: any) => s.status === 'maintenance')?.count || 0,
          vehicles_gps_active: (data || []).filter(v => v.gps_lat && v.gps_lon).length,
          avg_mpg: summary.fleet_summary.avg_mpg || null,
          total_fuel_cost: summary.fleet_summary.total_fuel_cost || 0,
        });
      }
    } catch { /* ignore */ }
    finally { setFleetLoading(false); }
  }, []);

  useEffect(() => { fetchFleet(); }, [fetchFleet]);

  // ── Geocoding ──
  const doSearch = useCallback(async (query: string, setResults: (r: GeocodeResult[]) => void, setLoad: (v: boolean) => void) => {
    if (!query || query.trim().length < 3) { setResults([]); return; }
    setLoad(true);
    try {
      const features = await forwardGeocode(query, 5, 'address,place,locality,neighborhood,poi');
      setResults(features.map(f => ({ id: f.id, place_name: f.place_name, center: f.center, text: f.text })));
    } catch { setResults([]); }
    finally { setLoad(false); }
  }, []);

  useEffect(() => {
    if (originCoordInput.trim()) return;
    clearTimeout(originDebounce.current);
    originDebounce.current = setTimeout(() => doSearch(originQuery, setOriginSuggestions, setOriginLoading), 250);
    return () => clearTimeout(originDebounce.current);
  }, [originQuery, originCoordInput, doSearch]);

  useEffect(() => {
    if (destCoordInput.trim()) return;
    clearTimeout(destDebounce.current);
    destDebounce.current = setTimeout(() => doSearch(destQuery, setDestSuggestions, setDestLoading), 250);
    return () => clearTimeout(destDebounce.current);
  }, [destQuery, destCoordInput, doSearch]);

  const selectOrigin = useCallback((result: GeocodeResult) => {
    setOriginResult(result); setOriginQuery(result.place_name);
    setOriginSuggestions([]); setOriginFocused(false); setOriginCoordInput('');
  }, []);

  const selectDest = useCallback((result: GeocodeResult) => {
    setDestResult(result); setDestQuery(result.place_name);
    setDestSuggestions([]); setDestFocused(false); setDestCoordInput('');
    addRecentDestination(result); setRecentDests(loadRecentDestinations());
  }, []);

  const handleOriginCoordSubmit = useCallback(() => {
    const coords = validateCoordinates(originCoordInput);
    if (!coords) { setErrors(prev => ({ ...prev, origin: 'Invalid coordinates. Use format: lng,lat' })); return; }
    setErrors(prev => ({ ...prev, origin: undefined }));
    setOriginResult({ id: `coord-${originCoordInput}`, place_name: `${coords.lng.toFixed(5)}, ${coords.lat.toFixed(5)}`, center: [coords.lng, coords.lat], text: originCoordInput });
    setOriginQuery(`${coords.lng.toFixed(5)}, ${coords.lat.toFixed(5)}`);
    setOriginSuggestions([]); setShowOriginCoords(false);
  }, [originCoordInput]);

  const handleDestCoordSubmit = useCallback(() => {
    const coords = validateCoordinates(destCoordInput);
    if (!coords) { setErrors(prev => ({ ...prev, dest: 'Invalid coordinates. Use format: lng,lat' })); return; }
    setErrors(prev => ({ ...prev, dest: undefined }));
    const result: GeocodeResult = { id: `coord-${destCoordInput}`, place_name: `${coords.lng.toFixed(5)}, ${coords.lat.toFixed(5)}`, center: [coords.lng, coords.lat], text: destCoordInput };
    selectDest(result); setShowDestCoords(false);
  }, [destCoordInput, selectDest]);

  const addWaypoint = useCallback(() => setWaypoints(prev => [...prev, { id: generateId(), query: '', result: null }]), []);
  const removeWaypoint = useCallback((id: string) => setWaypoints(prev => prev.filter(w => w.id !== id)), []);
  const updateWaypointQuery = useCallback((id: string, query: string) => setWaypoints(prev => prev.map(w => w.id === id ? { ...w, query } : w)), []);

  const handleDragStart = useCallback((index: number) => { dragItem.current = index; }, []);
  const handleDragEnter = useCallback((index: number) => { dragOverItem.current = index; }, []);
  const handleDragEnd = useCallback(() => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const newList = [...waypoints];
    const [removed] = newList.splice(dragItem.current, 1);
    newList.splice(dragOverItem.current, 0, removed);
    setWaypoints(newList);
    dragItem.current = null; dragOverItem.current = null;
  }, [waypoints]);

  const clearAll = useCallback(() => {
    setOriginQuery(''); setDestQuery(''); setOriginResult(null); setDestResult(null);
    setOriginSuggestions([]); setDestSuggestions([]); setWaypoints([]);
    setRouteResult(null); setErrors({}); setOriginCoordInput(''); setDestCoordInput('');
  }, []);

  const swapOrigDest = useCallback(() => {
    const tmpQ = originQuery; const tmpR = originResult;
    setOriginQuery(destQuery); setOriginResult(destResult);
    setDestQuery(tmpQ); setDestResult(tmpR);
  }, [originQuery, originResult, destQuery, destResult]);

  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (!originResult && !originQuery.trim()) errs.origin = 'Origin is required';
    if (!destResult && !destQuery.trim()) errs.dest = 'Destination is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [originResult, originQuery, destResult, destQuery]);

  // ── Plan Route ──
  const handlePlanRoute = useCallback(async () => {
    if (!validate()) return;
    const origin = originResult?.center;
    const dest = destResult?.center;
    if (!origin || !dest) {
      setErrors({ origin: !origin ? 'Select a valid origin' : undefined, dest: !dest ? 'Select a valid destination' : undefined });
      return;
    }
    setRouteLoading(true); setRouteResult(null);
    try {
      const waypointCoords = waypoints.map(w => w.result?.center).filter(Boolean) as [number, number][];
      const coords = [origin, ...waypointCoords, dest];
      const coordinates = coords.map(c => `${c[0]},${c[1]}`).join(';');
      let url = `/api/mapbox/directions?profile=${profile}&coordinates=${coordinates}&geometries=geojson&overview=full&steps=true&language=en&alternatives=true`;
      if (avoidTolls) url += '&exclude=toll';
      if (avoidHighways) url += '&exclude=motorway';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Directions API returned ${res.status}`);
      const data = await res.json();
      if (!data.routes?.length) throw new Error('No route found');
      const route = data.routes[0];
      const steps: RouteStep[] = (route.legs?.[0]?.steps || []).map((s: any) => ({
        instruction: s.maneuver?.instruction || s.name || 'Continue',
        distance: metersToMiles(s.distance || 0),
        duration: secsToMinutes(s.duration || 0),
        direction: s.maneuver?.modifier || 'straight',
      }));
      const congestion = route.legs?.[0]?.annotation?.congestion || null;
      const worstCongestion = congestion ? (congestion.includes('severe') ? 'severe' : congestion.includes('heavy') ? 'heavy' : congestion.includes('moderate') ? 'moderate' : 'low') as 'low' | 'moderate' | 'heavy' | 'severe' : null;
      setRouteResult({
        distance: metersToMiles(route.distance),
        distanceMeters: route.distance,
        duration: secsToMinutes(route.duration),
        durationSec: route.duration,
        steps,
        congestion: worstCongestion,
      });
      if (destResult) addRecentDestination(destResult);
      setRecentDests(loadRecentDestinations());
      showToast('Route planned successfully', 'success');
    } catch (err: any) {
      setRouteResult({ distance: '', distanceMeters: 0, duration: '', durationSec: 0, steps: [], congestion: null, error: err.message || 'Route planning failed' });
      showToast(err.message || 'Route planning failed', 'error');
    } finally { setRouteLoading(false); }
  }, [originResult, destResult, waypoints, profile, validate, destResult, avoidTolls, avoidHighways, showToast]);

  const fuelCost = routeResult ? ((routeResult.distanceMeters * 0.000621371) / 15 * 3.50).toFixed(2) : '0.00';
  const co2Estimate = routeResult ? (routeResult.distanceMeters * 0.000621371 * 0.404).toFixed(1) : '0';
  const arrivalTime = routeResult ? new Date(Date.now() + routeResult.durationSec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';

  // ── Save/Load/Delete routes ──
  const saveCurrentRoute = useCallback(() => {
    if (!originResult || !destResult) return;
    const route: SavedRoute = {
      id: generateId(), name: routeName.trim() || `Route ${savedRoutes.length + 1}`,
      origin: originResult, destination: destResult,
      waypoints: waypoints.map(w => w.result).filter(Boolean) as GeocodeResult[],
      profile, createdAt: new Date().toISOString(), tags: routeTag, notes: routeNotes,
    };
    const updated = [route, ...savedRoutes];
    setSavedRoutes(updated); saveSavedRoutes(updated);
    setShowSaveDialog(false); setRouteName(''); setRouteTag(''); setRouteNotes('');
    showToast('Route saved successfully', 'success');
  }, [originResult, destResult, waypoints, profile, routeName, savedRoutes, routeTag, routeNotes, showToast]);

  const deleteSavedRoute = useCallback((id: string) => {
    const updated = savedRoutes.filter(r => r.id !== id);
    setSavedRoutes(updated); saveSavedRoutes(updated);
    showToast('Route deleted', 'info');
  }, [savedRoutes, showToast]);

  const loadSavedRoute = useCallback((route: SavedRoute) => {
    setOriginResult(route.origin); setOriginQuery(route.origin.place_name);
    setDestResult(route.destination); setDestQuery(route.destination.place_name);
    setProfile(route.profile);
    setWaypoints(route.waypoints.map(w => ({ id: generateId(), query: w.place_name, result: w })));
    setRouteResult(null); setActiveTab('plan');
    showToast(`Loaded route: ${route.name}`, 'info');
  }, [showToast]);

  const clearRecent = useCallback(() => { saveRecentDestinations([]); setRecentDests([]); }, []);
  const removeRecentDest = useCallback((id: string) => {
    const updated = recentDests.filter(r => r.result.id !== id);
    setRecentDests(updated); saveRecentDestinations(updated);
  }, [recentDests]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) { document.documentElement.requestFullscreen(); setIsFullscreen(true); }
    else { document.exitFullscreen(); setIsFullscreen(false); }
  }, []);

  // ── Filter saved routes ──
  const filteredSaved = savedRoutes
    .filter(r => !savedSearch || r.name.toLowerCase().includes(savedSearch.toLowerCase()) || r.origin.place_name.toLowerCase().includes(savedSearch.toLowerCase()) || r.destination.place_name.toLowerCase().includes(savedSearch.toLowerCase()))
    .sort((a, b) => sortSaved === 'date' ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() : a.name.localeCompare(b.name));

  // ── Filter fleet vehicles ──
  const filteredFleet = fleetVehicles
    .filter(v => !fleetSearch || v.vehicle_number.toLowerCase().includes(fleetSearch.toLowerCase()) || (v.make || '').toLowerCase().includes(fleetSearch.toLowerCase()) || (v.model || '').toLowerCase().includes(fleetSearch.toLowerCase()))
    .filter(v => fleetFilter === 'all' || v.status === fleetFilter);

  // ── Nearest vehicles to destination ──
  useEffect(() => {
    if (!destResult || fleetVehicles.length === 0) { setNearestVehicles([]); return; }
    const [dlng, dlat] = destResult.center;
    const withDist = fleetVehicles
      .filter(v => v.gps_lat && v.gps_lon)
      .map(v => {
        const dist = Math.sqrt(Math.pow((v.gps_lon || 0) - dlng, 2) + Math.pow((v.gps_lat || 0) - dlat, 2)) * 69;
        return { ...v, distanceMi: dist };
      })
      .sort((a, b) => a.distanceMi - b.distanceMi)
      .slice(0, 5);
    setNearestVehicles(withDist);
  }, [destResult, fleetVehicles]);

  // ── Share route ──
  const shareRoute = useCallback(() => {
    if (!originResult || !destResult) return;
    const text = `Route: ${originResult.place_name} → ${destResult.place_name} | ${routeResult?.distance || ''} | ${routeResult?.duration || ''} | Profile: ${ROUTE_PROFILES.find(p => p.value === profile)?.label || profile}`;
    navigator.clipboard.writeText(text).then(() => showToast('Route copied to clipboard', 'success')).catch(() => showToast('Failed to copy', 'error'));
  }, [originResult, destResult, routeResult, profile, showToast]);

  // ── Assign route to fleet vehicle ──
  const assignToVehicle = useCallback((vehicle: FleetVehicle) => {
    showToast(`Route assigned to ${vehicle.vehicle_number}`, 'success');
  }, [showToast]);

  // ── Render ──
  const renderSuggestionsDropdown = (
    suggestions: GeocodeResult[],
    focused: boolean,
    loading: boolean,
    onSelect: (r: GeocodeResult) => void,
  ) => {
    if (!focused || suggestions.length === 0) return null;
    return (
      <div className="absolute top-full left-0 right-0 z-50 mt-0.5 bg-surface-raised border border-surface-border rounded shadow-xl max-h-[220px] overflow-y-auto">
        {suggestions.map(s => (
          <button key={s.id} type="button" onMouseDown={() => onSelect(s)}
            className="w-full text-left px-2 py-1.5 text-[11px] text-rmpg-200 hover:bg-surface-hover border-b border-surface-border last:border-b-0 flex items-start gap-2"
          >
            <MapPin className="w-3 h-3 mt-0.5 shrink-0 text-rmpg-500" />
            <span className="truncate">{s.place_name}</span>
          </button>
        ))}
      </div>
    );
  };

  const congestionColor = routeResult?.congestion === 'severe' ? '#ef4444' : routeResult?.congestion === 'heavy' ? '#f59e0b' : routeResult?.congestion === 'moderate' ? '#eab308' : '#22c55e';
  const congestionLabel = routeResult?.congestion ? routeResult.congestion.charAt(0).toUpperCase() + routeResult.congestion.slice(1) : null;

  return (
    <div className="h-full flex flex-col bg-surface-base">
      {/* ── Top Navigation Bar ── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-border shrink-0" style={{ background: 'linear-gradient(180deg, var(--desktop-shell-start) 0%, var(--desktop-shell-end) 100%)' }}>
        <div className="flex items-center gap-2">
          <PanelTitleBar title="NAVIGATION & ROUTE PLANNING" icon={Navigation} />
          <div className="flex items-center gap-1 ml-3">
            {(['plan', 'saved', 'fleet'] as const).map(tab => (
              <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                className={`text-[10px] px-3 py-1 rounded transition-colors ${activeTab === tab ? 'bg-rmpg-accent/20 text-rmpg-accent font-semibold' : 'text-rmpg-400 hover:text-rmpg-200'}`}
              >
                {tab === 'plan' ? 'PLAN' : tab === 'saved' ? `SAVED (${savedRoutes.length})` : `FLEET (${fleetVehicles.length})`}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={clearAll} className="toolbar-btn text-[10px] px-2 py-1" title="Clear all fields">
            <X className="w-3 h-3 mr-1" /> Clear
          </button>
          <button type="button" onClick={toggleFullscreen} className="toolbar-btn p-1" title="Toggle fullscreen">
            {isFullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* ═══ LEFT PANEL ═══ */}
        <div className="w-[440px] min-w-[360px] border-r border-surface-border flex flex-col overflow-y-auto">
          {activeTab === 'plan' && (
            <div className="p-3 space-y-3">

              {/* Route Profile Selector */}
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider text-rmpg-400 mb-1 flex items-center gap-1">
                  <Settings className="w-2.5 h-2.5" /> Route Profile
                </label>
                <div className="relative">
                  <select value={profile} onChange={e => setProfile(e.target.value as RouteProfile)}
                    className="w-full bg-surface-sunken text-rmpg-100 text-xs px-2 py-[7px] rounded border border-surface-border appearance-none cursor-pointer"
                  >
                    {ROUTE_PROFILES.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" />
                </div>
              </div>

              {/* Origin */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[9px] font-semibold uppercase tracking-wider text-rmpg-400 flex items-center gap-1">
                    <Flag className="w-2.5 h-2.5" /> Origin
                  </label>
                  <button type="button" onClick={() => setShowOriginCoords(!showOriginCoords)} className="text-[8px] text-rmpg-500 hover:text-rmpg-300">
                    {showOriginCoords ? 'Address' : 'Coordinates'}
                  </button>
                </div>
                {showOriginCoords ? (
                  <div className="space-y-1">
                    <div className="flex gap-1">
                      <input type="text" value={originCoordInput} onChange={e => setOriginCoordInput(e.target.value)}
                        placeholder="lng,lat (e.g. -111.89,40.76)"
                        className="flex-1 bg-surface-sunken text-rmpg-100 text-xs px-2 py-[7px] rounded border border-surface-border font-mono"
                      />
                      <button type="button" onClick={handleOriginCoordSubmit} className="toolbar-btn px-2"><Check className="w-3 h-3" /></button>
                    </div>
                    {errors.origin && <p className="text-[9px] text-red-400">{errors.origin}</p>}
                  </div>
                ) : (
                  <div className="relative">
                    <input type="text" value={originQuery} onChange={e => { setOriginQuery(e.target.value); setOriginResult(null); }}
                      onFocus={() => setOriginFocused(true)} onBlur={() => setTimeout(() => setOriginFocused(false), 200)}
                      placeholder="Enter origin address or place..."
                      className="w-full bg-surface-sunken text-rmpg-100 text-xs px-2 py-[7px] rounded border border-surface-border"
                    />
                    {originLoading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 animate-spin" />}
                    {renderSuggestionsDropdown(originSuggestions, originFocused, originLoading, selectOrigin)}
                    {errors.origin && <p className="text-[9px] text-red-400 mt-0.5">{errors.origin}</p>}
                  </div>
                )}
              </div>

              {/* Destination */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[9px] font-semibold uppercase tracking-wider text-rmpg-400 flex items-center gap-1">
                    <MapPin className="w-2.5 h-2.5" /> Destination
                  </label>
                  <button type="button" onClick={() => setShowDestCoords(!showDestCoords)} className="text-[8px] text-rmpg-500 hover:text-rmpg-300">
                    {showDestCoords ? 'Address' : 'Coordinates'}
                  </button>
                </div>
                {showDestCoords ? (
                  <div className="space-y-1">
                    <div className="flex gap-1">
                      <input type="text" value={destCoordInput} onChange={e => setDestCoordInput(e.target.value)}
                        placeholder="lng,lat (e.g. -111.89,40.76)"
                        className="flex-1 bg-surface-sunken text-rmpg-100 text-xs px-2 py-[7px] rounded border border-surface-border font-mono"
                      />
                      <button type="button" onClick={handleDestCoordSubmit} className="toolbar-btn px-2"><Check className="w-3 h-3" /></button>
                    </div>
                    {errors.dest && <p className="text-[9px] text-red-400">{errors.dest}</p>}
                  </div>
                ) : (
                  <div className="relative">
                    <input type="text" value={destQuery} onChange={e => { setDestQuery(e.target.value); setDestResult(null); }}
                      onFocus={() => setDestFocused(true)} onBlur={() => setTimeout(() => setDestFocused(false), 200)}
                      placeholder="Enter destination address or place..."
                      className="w-full bg-surface-sunken text-rmpg-100 text-xs px-2 py-[7px] rounded border border-surface-border"
                    />
                    {destLoading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 animate-spin" />}
                    {renderSuggestionsDropdown(destSuggestions, destFocused, destLoading, selectDest)}
                    {errors.dest && <p className="text-[9px] text-red-400 mt-0.5">{errors.dest}</p>}
                  </div>
                )}
              </div>

              {/* Swap Button */}
              {(originResult || destResult) && (
                <button type="button" onClick={swapOrigDest}
                  className="w-full text-[10px] text-rmpg-400 hover:text-rmpg-200 py-1 flex items-center justify-center gap-1 border border-surface-border rounded"
                >
                  <ArrowRight className="w-3 h-3 rotate-90" /> Swap Origin & Destination
                </button>
              )}

              {/* Waypoints */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[9px] font-semibold uppercase tracking-wider text-rmpg-400 flex items-center gap-1">
                    <Layers className="w-2.5 h-2.5" /> Stops / Waypoints <span className="text-rmpg-600 font-normal">({waypoints.length})</span>
                  </label>
                  <button type="button" onClick={addWaypoint} className="text-[8px] text-rmpg-500 hover:text-rmpg-300 flex items-center gap-0.5">
                    <Plus className="w-3 h-3" /> Add Stop
                  </button>
                </div>
                <div className="space-y-1 max-h-[200px] overflow-y-auto styled-scrollbar">
                  {waypoints.map((wp, i) => (
                    <div key={wp.id} className="flex items-center gap-1.5 bg-surface-sunken/50 rounded px-1.5 py-1"
                      draggable onDragStart={() => handleDragStart(i)} onDragEnter={() => handleDragEnter(i)} onDragEnd={handleDragEnd} onDragOver={e => e.preventDefault()}
                    >
                      <GripVertical className="w-3 h-3 text-rmpg-600 shrink-0 cursor-grab" />
                      <span className="text-[9px] text-rmpg-500 w-4 shrink-0 font-mono">{i + 1}.</span>
                      <input type="text" value={wp.query} onChange={e => updateWaypointQuery(wp.id, e.target.value)}
                        placeholder="Waypoint address..."
                        className="flex-1 bg-transparent text-rmpg-100 text-[10px] px-1 py-[3px] border-b border-transparent focus:border-rmpg-500 outline-none"
                      />
                      <button type="button" onClick={() => removeWaypoint(wp.id)} className="text-red-500/60 hover:text-red-400 p-0.5"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                  {waypoints.length === 0 && <p className="text-[9px] text-rmpg-600 italic py-1">No intermediate stops — drag to reorder</p>}
                </div>
              </div>

              {/* Advanced Options */}
              <div>
                <button type="button" onClick={() => setAdvancedOpen(!advancedOpen)}
                  className="text-[9px] text-rmpg-500 hover:text-rmpg-300 flex items-center gap-1"
                >
                  <Settings className="w-2.5 h-2.5" /> Advanced Options {advancedOpen ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                </button>
                {advancedOpen && (
                  <div className="mt-1.5 p-2 bg-surface-sunken/50 rounded border border-surface-border space-y-2">
                    <label className="flex items-center gap-2 text-[10px] text-rmpg-300 cursor-pointer">
                      <input type="checkbox" checked={avoidTolls} onChange={e => setAvoidTolls(e.target.checked)} className="accent-rmpg-accent" />
                      Avoid Tolls
                    </label>
                    <label className="flex items-center gap-2 text-[10px] text-rmpg-300 cursor-pointer">
                      <input type="checkbox" checked={avoidHighways} onChange={e => setAvoidHighways(e.target.checked)} className="accent-rmpg-accent" />
                      Avoid Highways
                    </label>
                  </div>
                )}
              </div>

              {/* Plan Route Button */}
              <button type="button" onClick={handlePlanRoute}
                disabled={routeLoading || (!originResult && !originQuery.trim()) || (!destResult && !destQuery.trim())}
                className="w-full bg-rmpg-accent text-black text-xs font-semibold py-2.5 rounded flex items-center justify-center gap-2 disabled:opacity-40 hover:brightness-110 transition-all"
              >
                {routeLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Planning...</>
                ) : (
                  <><Route className="w-4 h-4" /> Plan Route</>
                )}
              </button>

              {/* ═══ Route Result ═══ */}
              {routeResult && (
                <div className={`rounded border ${routeResult.error ? 'bg-red-900/20 border-red-800' : 'bg-surface-raised border-surface-border'}`}>
                  {routeResult.error ? (
                    <div className="p-2 flex items-start gap-2 text-xs text-red-300">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{routeResult.error}</span>
                    </div>
                  ) : (
                    <div className="divide-y divide-surface-border">
                      {/* Route Summary Header */}
                      <div className="p-2.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-rmpg-400 text-[9px] uppercase tracking-wider">Route Summary</span>
                          {congestionLabel && (
                            <span className="text-[8px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: congestionColor + '20', color: congestionColor }}>
                              Traffic: {congestionLabel}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="bg-surface-sunken rounded p-1.5 text-center">
                            <Route className="w-3 h-3 mx-auto mb-0.5 text-rmpg-500" />
                            <div className="text-[10px] font-semibold text-rmpg-100">{routeResult.distance || '--'}</div>
                            <div className="text-[7px] text-rmpg-600 uppercase">Distance</div>
                          </div>
                          <div className="bg-surface-sunken rounded p-1.5 text-center">
                            <Clock className="w-3 h-3 mx-auto mb-0.5 text-rmpg-500" />
                            <div className="text-[10px] font-semibold text-rmpg-100">{routeResult.duration || '--'}</div>
                            <div className="text-[7px] text-rmpg-600 uppercase">Duration</div>
                          </div>
                          <div className="bg-surface-sunken rounded p-1.5 text-center">
                            <Navigation className="w-3 h-3 mx-auto mb-0.5 text-rmpg-500" />
                            <div className="text-[10px] font-semibold text-rmpg-100">{arrivalTime}</div>
                            <div className="text-[7px] text-rmpg-600 uppercase">Arrival</div>
                          </div>
                        </div>

                        {/* Stats Row */}
                        <div className="grid grid-cols-3 gap-2">
                          <div className="flex items-center gap-1 text-[9px] text-rmpg-400">
                            <Fuel className="w-2.5 h-2.5" /> ~${fuelCost}
                          </div>
                          <div className="flex items-center gap-1 text-[9px] text-rmpg-400">
                            <Wind className="w-2.5 h-2.5" /> {co2Estimate}kg CO₂
                          </div>
                          <div className="flex items-center gap-1 text-[9px] text-rmpg-400">
                            <Activity className="w-2.5 h-2.5" /> {ROUTE_PROFILES.find(p => p.value === profile)?.label?.split(' ')[0] || profile}
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: '0%', background: congestionColor }} />
                        </div>
                      </div>

                      {/* Turn-by-Turn Steps */}
                      {routeResult.steps.length > 0 && (
                        <div>
                          <button type="button" onClick={() => setShowSteps(!showSteps)}
                            className="w-full flex items-center justify-between px-2.5 py-1.5 text-[9px] text-rmpg-400 hover:text-rmpg-200 font-semibold uppercase tracking-wider"
                          >
                            <span>Turn-by-Turn ({routeResult.steps.length})</span>
                            {showSteps ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                          {showSteps && (
                            <div className="max-h-[240px] overflow-y-auto styled-scrollbar">
                              {routeResult.steps.map((step, i) => (
                                <div key={i} className="flex items-start gap-2 px-2.5 py-1.5 hover:bg-surface-hover border-t border-surface-border/50 transition-colors">
                                  <span className="text-[8px] text-rmpg-600 font-mono w-4 shrink-0 mt-0.5">{i + 1}.</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[10px] text-rmpg-200 truncate">{step.instruction}</p>
                                    <p className="text-[8px] text-rmpg-500">{step.distance} &middot; {step.duration}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex gap-1.5 p-2">
                        <button type="button" onClick={() => setShowSaveDialog(true)} className="flex-1 text-[9px] bg-surface-sunken text-rmpg-300 py-1.5 rounded flex items-center justify-center gap-1 hover:bg-surface-hover transition-colors">
                          <Save className="w-3 h-3" /> Save
                        </button>
                        <button type="button" onClick={shareRoute} className="flex-1 text-[9px] bg-surface-sunken text-rmpg-300 py-1.5 rounded flex items-center justify-center gap-1 hover:bg-surface-hover transition-colors">
                          <Share2 className="w-3 h-3" /> Share
                        </button>
                        <button type="button" onClick={() => window.print()} className="flex-1 text-[9px] bg-surface-sunken text-rmpg-300 py-1.5 rounded flex items-center justify-center gap-1 hover:bg-surface-hover transition-colors">
                          <Printer className="w-3 h-3" /> Print
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ═══ Recent Destinations ═══ */}
              {recentDests.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[9px] font-semibold uppercase tracking-wider text-rmpg-400 flex items-center gap-1">
                      <History className="w-3 h-3" /> Recent Destinations ({recentDests.length})
                    </label>
                    <button type="button" onClick={clearRecent} className="text-[8px] text-rmpg-600 hover:text-rmpg-400">Clear All</button>
                  </div>
                  <div className="space-y-0.5 max-h-[150px] overflow-y-auto styled-scrollbar">
                    {recentDests.map(r => (
                      <div key={r.result.id} className="flex items-center gap-1 px-2 py-1 hover:bg-surface-hover rounded group">
                        <button type="button" onClick={() => selectDest(r.result)}
                          className="flex-1 text-left text-[10px] text-rmpg-300 truncate flex items-center gap-2 min-w-0"
                        >
                          <History className="w-3 h-3 shrink-0 text-rmpg-600" />
                          <span className="truncate">{r.result.place_name}</span>
                          <span className="text-[8px] text-rmpg-600 shrink-0 ml-auto">{r.useCount}x</span>
                        </button>
                        <button type="button" onClick={() => { setOriginResult(r.result); setOriginQuery(r.result.place_name); }}
                          className="text-[8px] text-rmpg-600 hover:text-rmpg-400 opacity-0 group-hover:opacity-100 p-0.5" title="Set as origin"
                        ><Flag className="w-2.5 h-2.5" /></button>
                        <button type="button" onClick={() => removeRecentDest(r.result.id)}
                          className="text-red-500/40 hover:text-red-400 opacity-0 group-hover:opacity-100 p-0.5" title="Remove"
                        ><X className="w-2.5 h-2.5" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ SAVED ROUTES TAB ═══ */}
          {activeTab === 'saved' && (
            <div className="p-3 space-y-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-600" />
                  <input type="text" value={savedSearch} onChange={e => setSavedSearch(e.target.value)}
                    placeholder="Search saved routes..."
                    className="w-full bg-surface-sunken text-rmpg-100 text-[10px] pl-6 pr-2 py-[6px] rounded border border-surface-border"
                  />
                </div>
                <select value={sortSaved} onChange={e => setSortSaved(e.target.value as 'date' | 'name')}
                  className="bg-surface-sunken text-rmpg-100 text-[9px] px-2 py-[6px] rounded border border-surface-border appearance-none cursor-pointer"
                >
                  <option value="date">Newest</option>
                  <option value="name">Name</option>
                </select>
              </div>

              {filteredSaved.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-12">
                  <div className="text-center">
                    <Route className="w-10 h-10 text-rmpg-700 mx-auto mb-2" />
                    <p className="text-xs text-rmpg-600">{savedSearch ? 'No matching routes' : 'No saved routes yet'}</p>
                    <p className="text-[10px] text-rmpg-700 mt-1">Plan a route and save it for quick access</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredSaved.map(route => (
                    <div key={route.id} className="bg-surface-raised border border-surface-border rounded hover:border-rmpg-600 transition-colors group">
                      <div className="p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <Star className="w-3 h-3 text-rmpg-accent shrink-0" />
                              <span className="text-[11px] font-semibold text-rmpg-100 truncate">{route.name}</span>
                              {route.tags && <span className="text-[7px] text-rmpg-600 bg-surface-sunken px-1 py-0.5 rounded">{route.tags}</span>}
                            </div>
                            <div className="mt-1 space-y-0.5">
                              <div className="flex items-center gap-1.5 text-[9px] text-rmpg-400">
                                <Flag className="w-2.5 h-2.5 shrink-0" />
                                <span className="truncate">{route.origin.place_name}</span>
                              </div>
                              <div className="flex items-center gap-1.5 text-[9px] text-rmpg-400">
                                <MapPin className="w-2.5 h-2.5 shrink-0" />
                                <span className="truncate">{route.destination.place_name}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-[8px] text-rmpg-600">
                              <span className="flex items-center gap-1"><Calendar className="w-2.5 h-2.5" />{new Date(route.createdAt).toLocaleDateString()}</span>
                              <span>{ROUTE_PROFILES.find(p => p.value === route.profile)?.label || route.profile}</span>
                              {route.waypoints.length > 0 && <span>{route.waypoints.length} stop(s)</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button type="button" onClick={() => loadSavedRoute(route)} className="text-rmpg-400 hover:text-rmpg-200 p-1" title="Load route">
                              <Route className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" onClick={() => deleteSavedRoute(route.id)} className="text-red-500/60 hover:text-red-400 p-1" title="Delete route">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ FLEET TAB ═══ */}
          {activeTab === 'fleet' && (
            <div className="p-3 space-y-3">
              {/* Fleet Summary Stats */}
              {fleetSummary && (
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="bg-surface-sunken rounded p-1.5 text-center">
                    <div className="text-[11px] font-semibold text-rmpg-100">{fleetSummary.total_vehicles}</div>
                    <div className="text-[7px] text-rmpg-600 uppercase">Total</div>
                  </div>
                  <div className="bg-surface-sunken rounded p-1.5 text-center">
                    <div className="text-[11px] font-semibold text-green-400">{fleetSummary.vehicles_in_service}</div>
                    <div className="text-[7px] text-rmpg-600 uppercase">In Service</div>
                  </div>
                  <div className="bg-surface-sunken rounded p-1.5 text-center">
                    <div className="text-[11px] font-semibold text-amber-400">{fleetSummary.vehicles_in_maintenance}</div>
                    <div className="text-[7px] text-rmpg-600 uppercase">Maintenance</div>
                  </div>
                  <div className="bg-surface-sunken rounded p-1.5 text-center">
                    <div className="text-[11px] font-semibold text-rmpg-100">{fleetSummary.vehicles_gps_active}</div>
                    <div className="text-[7px] text-rmpg-600 uppercase">GPS Active</div>
                  </div>
                  <div className="bg-surface-sunken rounded p-1.5 text-center">
                    <div className="text-[11px] font-semibold text-rmpg-100">{fleetSummary.avg_mpg?.toFixed(1) || '--'}</div>
                    <div className="text-[7px] text-rmpg-600 uppercase">Avg MPG</div>
                  </div>
                  <div className="bg-surface-sunken rounded p-1.5 text-center">
                    <div className="text-[11px] font-semibold text-rmpg-100">${(fleetSummary.total_fuel_cost / 1000).toFixed(0)}k</div>
                    <div className="text-[7px] text-rmpg-600 uppercase">Fuel Cost</div>
                  </div>
                </div>
              )}

              {/* Fleet Search & Filter */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-600" />
                  <input type="text" value={fleetSearch} onChange={e => setFleetSearch(e.target.value)}
                    placeholder="Search vehicles..."
                    className="w-full bg-surface-sunken text-rmpg-100 text-[10px] pl-6 pr-2 py-[6px] rounded border border-surface-border"
                  />
                </div>
                <select value={fleetFilter} onChange={e => setFleetFilter(e.target.value)}
                  className="bg-surface-sunken text-rmpg-100 text-[9px] px-2 py-[6px] rounded border border-surface-border appearance-none cursor-pointer"
                >
                  <option value="all">All</option>
                  <option value="in_service">In Service</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="out_of_service">Out of Service</option>
                </select>
              </div>

              {/* Fleet Vehicle List */}
              {fleetLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 text-rmpg-500 animate-spin" />
                </div>
              ) : filteredFleet.length === 0 ? (
                <div className="text-center py-8">
                  <Car className="w-8 h-8 text-rmpg-700 mx-auto mb-2" />
                  <p className="text-xs text-rmpg-600">No vehicles found</p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[500px] overflow-y-auto styled-scrollbar">
                  {filteredFleet.map(v => (
                    <div key={v.id}
                      className={`bg-surface-raised border rounded p-2 cursor-pointer transition-colors ${selectedVehicle?.id === v.id ? 'border-rmpg-accent' : 'border-surface-border hover:border-rmpg-600'}`}
                      onClick={() => setSelectedVehicle(selectedVehicle?.id === v.id ? null : v)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_COLORS[v.status] || '#6b7280' }} />
                            <span className="text-[11px] font-semibold text-rmpg-100">{v.vehicle_number}</span>
                            {v.assigned_unit_call_sign && (
                              <span className="text-[8px] text-rmpg-500 bg-surface-sunken px-1 py-0.5 rounded">{v.assigned_unit_call_sign}</span>
                            )}
                          </div>
                          <div className="text-[9px] text-rmpg-400 mt-0.5">
                            {[v.year, v.make, v.model].filter(Boolean).join(' ') || '--'} &middot; {v.plate_number || 'No plate'}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[8px] text-rmpg-600">
                            {v.current_mileage && <span>{v.current_mileage.toLocaleString()} mi</span>}
                            {v.gps_speed != null && <span>{v.gps_speed.toFixed(0)} mph</span>}
                            {v.gps_reported_at && (
                              <span className="flex items-center gap-0.5">
                                {Date.now() - new Date(v.gps_reported_at).getTime() < 300000 ? <Wifi className="w-2.5 h-2.5 text-green-500" /> : <WifiOff className="w-2.5 h-2.5 text-red-500" />}
                                {Math.floor((Date.now() - new Date(v.gps_reported_at).getTime()) / 60000)}m ago
                              </span>
                            )}
                          </div>
                          {v.next_service_due && (() => {
                            const days = Math.ceil((new Date(v.next_service_due).getTime() - Date.now()) / 86400000);
                            return days <= 30 ? (
                              <span className={`inline-flex items-center gap-0.5 text-[8px] mt-0.5 px-1 py-0.5 rounded ${days <= 0 ? 'bg-red-900/40 text-red-300' : 'bg-amber-900/40 text-amber-300'}`}>
                                <AlertTriangle className="w-2 h-2" /> Service {days <= 0 ? 'OVERDUE' : `Due ${days}d`}
                              </span>
                            ) : null;
                          })()}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button type="button" onClick={e => { e.stopPropagation(); assignToVehicle(v); }}
                            className="text-[8px] text-rmpg-500 hover:text-rmpg-300 px-1 py-0.5 rounded border border-surface-border" title="Assign route to vehicle"
                          ><Navigation className="w-3 h-3" /></button>
                        </div>
                      </div>

                      {/* Expanded vehicle detail */}
                      {selectedVehicle?.id === v.id && (
                        <div className="mt-2 pt-2 border-t border-surface-border grid grid-cols-2 gap-x-3 gap-y-1 text-[9px] text-rmpg-400">
                          <div>Status: <span className="text-rmpg-200 font-semibold">{STATUS_LABELS[v.status] || v.status}</span></div>
                          {v.gps_lat && v.gps_lon && <div>Location: {v.gps_lat.toFixed(4)}, {v.gps_lon.toFixed(4)}</div>}
                          {v.gps_heading != null && <div>Heading: {v.gps_heading.toFixed(0)}&deg;</div>}
                          {v.current_mileage && <div>Odometer: {v.current_mileage.toLocaleString()} mi</div>}
                          {v.insurance_expiry && <div>Insurance: {new Date(v.insurance_expiry).toLocaleDateString()}</div>}
                          {v.registration_expiry && <div>Registration: {new Date(v.registration_expiry).toLocaleDateString()}</div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Nearest Vehicles to Destination */}
              {nearestVehicles.length > 0 && destResult && (
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-rmpg-400 mb-1 flex items-center gap-1">
                    <Navigation className="w-2.5 h-2.5" /> Nearest to Destination
                  </div>
                  <div className="space-y-1">
                    {nearestVehicles.map((v, i) => (
                      <div key={v.id} className="flex items-center gap-2 px-2 py-1 bg-surface-sunken/50 rounded text-[10px]">
                        <span className="text-rmpg-600 font-mono w-3">{i + 1}.</span>
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_COLORS[v.status] || '#6b7280' }} />
                        <span className="text-rmpg-200 font-semibold">{v.vehicle_number}</span>
                        <span className="text-rmpg-500">{(v as any).distanceMi?.toFixed(1)} mi</span>
                        <span className="text-rmpg-600 ml-auto">{v.assigned_unit_call_sign || 'Unassigned'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Refresh */}
              <button type="button" onClick={fetchFleet}
                className="w-full text-[9px] text-rmpg-500 hover:text-rmpg-300 py-1 flex items-center justify-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${fleetLoading ? 'animate-spin' : ''}`} /> Refresh Fleet Data
              </button>
            </div>
          )}
        </div>

        {/* ═══ RIGHT PANEL: Quick Stats Dashboard ═══ */}
        <div className="flex-1 flex flex-col overflow-y-auto p-4 bg-surface-sunken/30">
          {activeTab === 'plan' && (
            <div className="space-y-4">
              <PanelTitleBar title="ROUTE DASHBOARD" icon={BarChart3} />

              {/* Quick Stats Overview */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Distance', value: routeResult?.distance || '--', icon: Route, color: '#888888' },
                  { label: 'Duration', value: routeResult?.duration || '--', icon: Clock, color: '#888888' },
                  { label: 'Est. Fuel Cost', value: routeResult ? `$${fuelCost}` : '--', icon: Fuel, color: '#22c55e' },
                  { label: 'CO₂ Estimate', value: routeResult ? `${co2Estimate}kg` : '--', icon: Wind, color: '#f59e0b' },
                ].map(stat => (
                  <div key={stat.label} className="bg-surface-raised border border-surface-border rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-rmpg-400">{stat.label}</span>
                      <stat.icon className="w-4 h-4" style={{ color: stat.color }} />
                    </div>
                    <div className="text-lg font-semibold text-rmpg-100">{stat.value}</div>
                  </div>
                ))}
              </div>

              {/* Efficiency Metrics */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Avg Speed', value: routeResult ? `${(routeResult.distanceMeters * 0.000621371 / (routeResult.durationSec / 3600)).toFixed(0)} mph` : '--', icon: Gauge },
                  { label: 'Cost per Mile', value: routeResult ? `$${(parseFloat(fuelCost) / (routeResult.distanceMeters * 0.000621371)).toFixed(2)}` : '--', icon: TrendingUp },
                  { label: 'Arrival Time', value: arrivalTime, icon: Clock },
                ].map(stat => (
                  <div key={stat.label} className="bg-surface-raised border border-surface-border rounded p-2.5 flex items-center gap-3">
                    <stat.icon className="w-4 h-4 text-rmpg-500 shrink-0" />
                    <div>
                      <div className="text-[9px] font-semibold uppercase tracking-wider text-rmpg-400">{stat.label}</div>
                      <div className="text-sm font-semibold text-rmpg-100">{stat.value}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Traffic Congestion Indicator */}
              {routeResult && (
                <div className="bg-surface-raised border border-surface-border rounded p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-semibold uppercase tracking-wider text-rmpg-400">Traffic Conditions</span>
                    <span className="text-[8px] px-2 py-0.5 rounded-full font-semibold" style={{ background: congestionColor + '20', color: congestionColor }}>
                      {congestionLabel || 'No data'}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    {['low', 'moderate', 'heavy', 'severe'].map(level => (
                      <div key={level} className="flex-1 h-2 rounded-full transition-colors"
                        style={{ background: routeResult.congestion === level ? (level === 'severe' ? '#ef4444' : level === 'heavy' ? '#f59e0b' : level === 'moderate' ? '#eab308' : '#22c55e') : '#222222' }}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between mt-1 text-[7px] text-rmpg-600">
                    <span>Low</span><span>Moderate</span><span>Heavy</span><span>Severe</span>
                  </div>
                </div>
              )}

              {/* Fleet Quick Summary */}
              <div className="bg-surface-raised border border-surface-border rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-rmpg-400 flex items-center gap-1">
                    <Car className="w-3 h-3" /> Fleet at a Glance
                  </span>
                  <button type="button" onClick={() => setActiveTab('fleet')} className="text-[8px] text-rmpg-500 hover:text-rmpg-300">View All</button>
                </div>
                {fleetSummary ? (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center">
                      <div className="text-sm font-semibold text-rmpg-100">{fleetSummary.vehicles_gps_active}/{fleetSummary.total_vehicles}</div>
                      <div className="text-[8px] text-rmpg-600">GPS Active</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-semibold text-green-400">{fleetSummary.vehicles_in_service}</div>
                      <div className="text-[8px] text-rmpg-600">In Service</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-semibold text-amber-400">{fleetSummary.vehicles_in_maintenance}</div>
                      <div className="text-[8px] text-rmpg-600">In Shop</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-[10px] text-rmpg-600">Loading fleet data...</div>
                )}
              </div>

              {/* Empty State */}
              {!routeResult && (
                <div className="flex-1 flex items-center justify-center py-16">
                  <div className="text-center max-w-md">
                    <Navigation className="w-12 h-12 text-rmpg-700 mx-auto mb-3" />
                    <p className="text-sm text-rmpg-500 font-semibold">Plan a Route</p>
                    <p className="text-[10px] text-rmpg-600 mt-1 leading-relaxed">
                      Enter an origin and destination, add optional waypoints,<br />
                      then click <span className="text-rmpg-accent">Plan Route</span> to see distance, duration,<br />
                      turn-by-turn directions, fuel costs, and more.
                    </p>
                    <div className="flex items-center justify-center gap-4 mt-4 text-[8px] text-rmpg-600">
                      <span className="flex items-center gap-1"><Car className="w-2.5 h-2.5" /> Traffic-aware routing</span>
                      <span className="flex items-center gap-1"><Save className="w-2.5 h-2.5" /> Save favorites</span>
                      <span className="flex items-center gap-1"><Car className="w-2.5 h-2.5" /> Fleet integration</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'saved' && (
            <div className="space-y-4">
              <PanelTitleBar title={`SAVED ROUTES (${savedRoutes.length})`} icon={Star} />
              {savedRoutes.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-16">
                  <div className="text-center">
                    <Route className="w-12 h-12 text-rmpg-700 mx-auto mb-3" />
                    <p className="text-sm text-rmpg-500 font-semibold">No Saved Routes</p>
                    <p className="text-[10px] text-rmpg-600 mt-1">Plan and save routes for quick access from any device</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {filteredSaved.slice(0, 6).map(route => (
                    <div key={route.id} className="bg-surface-raised border border-surface-border rounded p-3 hover:border-rmpg-600 transition-colors cursor-pointer" onClick={() => loadSavedRoute(route)}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <Star className="w-3 h-3 text-rmpg-accent" />
                        <span className="text-xs font-semibold text-rmpg-100 truncate">{route.name}</span>
                      </div>
                      <div className="space-y-0.5 text-[9px] text-rmpg-400 truncate">
                        <div className="truncate"><Flag className="w-2.5 h-2.5 inline mr-1" />{route.origin.place_name}</div>
                        <div className="truncate"><ArrowRight className="w-2.5 h-2.5 inline mr-1" />{route.destination.place_name}</div>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 text-[8px] text-rmpg-600">
                        <span>{new Date(route.createdAt).toLocaleDateString()}</span>
                        {route.waypoints.length > 0 && <span>&middot; {route.waypoints.length} stops</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'fleet' && (
            <div className="space-y-4">
              <PanelTitleBar title={`Fleet Overview (${fleetVehicles.length} vehicles)`} icon={Car} />
              <div className="grid grid-cols-2 gap-3">
                {/* Status Distribution */}
                <div className="bg-surface-raised border border-surface-border rounded p-3">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-rmpg-400 mb-2 block">Status Distribution</span>
                  <div className="space-y-1.5">
                    {['in_service', 'maintenance', 'out_of_service', 'retired'].map(status => {
                      const count = fleetVehicles.filter(v => v.status === status).length;
                      const pct = fleetVehicles.length > 0 ? (count / fleetVehicles.length * 100).toFixed(0) : '0';
                      return (
                        <div key={status} className="flex items-center gap-2 text-[10px]">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_COLORS[status] || '#6b7280' }} />
                          <span className="text-rmpg-400 w-24">{STATUS_LABELS[status] || status}</span>
                          <div className="flex-1 h-2 bg-surface-sunken rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: STATUS_COLORS[status] || '#6b7280' }} />
                          </div>
                          <span className="text-rmpg-600 w-8 text-right">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* GPS Status */}
                <div className="bg-surface-raised border border-surface-border rounded p-3">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-rmpg-400 mb-2 block">GPS Status</span>
                  {(() => {
                    const active = fleetVehicles.filter(v => v.gps_lat && v.gps_lon && v.gps_reported_at && Date.now() - new Date(v.gps_reported_at).getTime() < 3600000).length;
                    const stale = fleetVehicles.filter(v => v.gps_lat && v.gps_lon && (!v.gps_reported_at || Date.now() - new Date(v.gps_reported_at).getTime() >= 3600000)).length;
                    const noGps = fleetVehicles.filter(v => !v.gps_lat || !v.gps_lon).length;
                    const total = fleetVehicles.length || 1;
                    return (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-[10px]"><Wifi className="w-3 h-3 text-green-500" /><span className="text-rmpg-400 w-24">Live GPS</span><div className="flex-1 h-2 bg-surface-sunken rounded-full overflow-hidden"><div className="h-full rounded-full bg-green-500" style={{ width: `${(active / total * 100).toFixed(0)}%` }} /></div><span className="text-rmpg-600 w-8 text-right">{active}</span></div>
                        <div className="flex items-center gap-2 text-[10px]"><WifiOff className="w-3 h-3 text-amber-500" /><span className="text-rmpg-400 w-24">Stale GPS</span><div className="flex-1 h-2 bg-surface-sunken rounded-full overflow-hidden"><div className="h-full rounded-full bg-amber-500" style={{ width: `${(stale / total * 100).toFixed(0)}%` }} /></div><span className="text-rmpg-600 w-8 text-right">{stale}</span></div>
                        <div className="flex items-center gap-2 text-[10px]"><AlertTriangle className="w-3 h-3 text-red-500" /><span className="text-rmpg-400 w-24">No GPS</span><div className="flex-1 h-2 bg-surface-sunken rounded-full overflow-hidden"><div className="h-full rounded-full bg-red-500" style={{ width: `${(noGps / total * 100).toFixed(0)}%` }} /></div><span className="text-rmpg-600 w-8 text-right">{noGps}</span></div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Toast Notification ── */}
      {toast && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] px-4 py-2 rounded shadow-2xl text-[11px] font-semibold transition-all duration-300 animate-dropdown-appear flex items-center gap-2 ${
          toast.type === 'success' ? 'bg-green-900/90 text-green-200 border border-green-700' :
          toast.type === 'error' ? 'bg-red-900/90 text-red-200 border border-red-700' :
          'bg-surface-raised text-rmpg-200 border border-surface-border'
        }`}>
          {toast.type === 'success' ? <Check className="w-3.5 h-3.5" /> : toast.type === 'error' ? <AlertTriangle className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
          {toast.message}
        </div>
      )}

      {/* ── Save Dialog ── */}
      {showSaveDialog && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center" onClick={() => setShowSaveDialog(false)}>
          <div className="bg-surface-raised border border-surface-border rounded p-4 w-[380px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-rmpg-100 flex items-center gap-2"><Save className="w-4 h-4" /> Save Route</span>
              <button type="button" onClick={() => setShowSaveDialog(false)} className="text-rmpg-500 hover:text-rmpg-300"><X className="w-4 h-4" /></button>
            </div>
            <input type="text" value={routeName} onChange={e => setRouteName(e.target.value)}
              placeholder="Route name (e.g. Patrol Zone 4)"
              className="w-full bg-surface-sunken text-rmpg-100 text-xs px-2 py-[6px] rounded border border-surface-border mb-2" autoFocus
            />
            <input type="text" value={routeTag} onChange={e => setRouteTag(e.target.value)}
              placeholder="Tags (e.g. patrol, zone, inspection)"
              className="w-full bg-surface-sunken text-rmpg-100 text-xs px-2 py-[6px] rounded border border-surface-border mb-2"
            />
            <textarea value={routeNotes} onChange={e => setRouteNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="w-full bg-surface-sunken text-rmpg-100 text-xs px-2 py-[6px] rounded border border-surface-border mb-3 resize-none h-16"
            />
            <div className="text-[9px] text-rmpg-500 mb-3 p-2 bg-surface-sunken/50 rounded">
              <div className="flex items-center gap-1.5"><Flag className="w-2.5 h-2.5" />{originResult?.place_name}</div>
              <div className="flex items-center gap-1.5 mt-0.5"><ArrowRight className="w-2.5 h-2.5" />{destResult?.place_name}</div>
              {waypoints.filter(w => w.result).length > 0 && <div className="text-rmpg-600 mt-0.5">+ {waypoints.filter(w => w.result).length} stops</div>}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowSaveDialog(false)} className="flex-1 text-[10px] text-rmpg-400 py-1.5 rounded border border-surface-border hover:bg-surface-hover">Cancel</button>
              <button type="button" onClick={saveCurrentRoute} className="flex-1 bg-rmpg-accent text-black text-[10px] font-semibold py-1.5 rounded hover:brightness-110">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Scrollbar styling */}
      <style>{`
        .styled-scrollbar::-webkit-scrollbar { width: 4px; }
        .styled-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .styled-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        .styled-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
        @media print { .toolbar-btn, button:not(.print\\:hidden) { display: none; } }
      `}</style>
    </div>
  );
}
