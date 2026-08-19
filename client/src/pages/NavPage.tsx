import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Navigation, MapPin, Clock, Route, Car, Play, Square, History,
  Gauge, Footprints, AlertTriangle, CheckCircle, Loader2, RefreshCw,
  Download, FileText, Crosshair, MapPinned, Pin, Trash2, Compass, ExternalLink,
  Settings, Satellite, WifiOff, Star,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../hooks/useApi';
import { getMapboxToken } from '../utils/mapboxApiKey';
import { injectMapboxStyles } from '../utils/mapboxLoader';
import { applyRmpgBasemap } from '../utils/mapboxBasemap';
import { useMapHeatmap, type HeatmapPoint } from '../hooks/useMapHeatmap';
import { useWebglMapRecovery } from '../hooks/useWebglMapRecovery';
import { useNavFavorites, type NavFavorite } from '../hooks/useNavFavorites';
import { useNavTrip, type NavTripContextValue } from '../context/NavTripContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../context/AuthContext';
import PanelTitleBar from '../components/PanelTitleBar';
import NavMapView, { type DroppedPin } from '../components/NavMapView';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { generateNavTripReport, generateNavSingleTripReport } from '../utils/navTripPdf';
import { trackToGpx, downloadGpx } from '../utils/gpxExport';
import { sessionToCsv, downloadCsv, type NavSample } from '../utils/navCsvExport';
import { parseTimestamp } from '../utils/dateUtils';
import type { NavTrip, NavTripStatus } from '../types';
import NavSettingsPanel, {
  type NavPrefs,
  loadNavPrefs,
  saveNavPrefs,
  getEffectiveBrightness,
} from './navigation/NavSettingsPanel';
import { tripDrivingScore, type HarshCounts } from './navigation/drivingScore';
import { harshEventColor } from './navigation/drivingScoreColor';

// Export a completed trip's breadcrumb track to GPX 1.1 (mapping / evidence) or
// CSV (spreadsheets). route_points carry { lat, lng, ts?, speed?, heading? }.
function tripFileStamp(trip: NavTrip): string {
  return `${(trip.start_time || '').replace(/[: ]/g, '-').slice(0, 16) || 'trip'}-${trip.id}`;
}

// Small local haversine — mirrors the pattern used elsewhere in the nav
// hooks (e.g. useNavTravel.ts's haversineMiles), but that one isn't
// exported, so a minimal equivalent lives here for staging-favorite
// proximity (Task 12).
function haversineMilesLocal(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth radius, miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function exportTripGpx(trip: NavTrip): void {
  const pts = Array.isArray(trip.route_points) ? (trip.route_points as any[]) : [];
  if (pts.length === 0) return;
  const xml = trackToGpx(
    pts.map((p) => ({ lat: p.lat, lng: p.lng, t: p.ts, speed: p.speed })),
    { name: `RMPG Trip ${trip.id}`, unit: trip.unit_call_sign || trip.vehicle_number || undefined },
  );
  downloadGpx(`rmpg-trip-${tripFileStamp(trip)}.gpx`, xml);
}
function exportTripCsv(trip: NavTrip): void {
  const pts = Array.isArray(trip.route_points) ? (trip.route_points as any[]) : [];
  if (pts.length === 0) return;
  const samples: NavSample[] = pts.map((p) => ({
    t: p.ts, lat: p.lat, lng: p.lng, speed: p.speed, heading: p.heading,
  }));
  downloadCsv(`rmpg-trip-${tripFileStamp(trip)}.csv`, sessionToCsv(samples, 'imperial'));
}

const STATUS_COLOR: Record<NavTripStatus, string> = {
  pending: 'var(--sev-warn)',
  active: 'var(--sev-ok)',
  paused: 'var(--sev-info)',
  completed: 'var(--sev-info)',
  cancelled: 'var(--text-muted)',
};

const STATUS_LABEL: Record<NavTripStatus, string> = {
  pending: 'Pending',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const PIN_STORAGE_KEY = 'rmpg_nav_dropped_pins';

// Role gate: only admin/manager may download multi-trip PDF reports.
const REPORT_ROLES = new Set(['admin', 'manager']);

function formatDuration(seconds?: number): string {
  if (!seconds) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDistance(miles?: number): string {
  if (!miles) return '--';
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`;
  return `${miles.toFixed(2)} mi`;
}

function timeAgo(dateStr: string): string {
  const d = parseTimestamp(dateStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function loadPins(): DroppedPin[] {
  try {
    const raw = localStorage.getItem(PIN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function savePins(pins: DroppedPin[]) {
  try { localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pins.slice(-20))); } catch { /* quota */ }
}

// #90 Reduced-motion / low-power: gate page-level pulse animations.
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  });
  useEffect(() => {
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const fn = () => setReduced(mq.matches);
      mq.addEventListener?.('change', fn);
      return () => mq.removeEventListener?.('change', fn);
    } catch { return undefined; }
  }, []);
  return reduced;
}

// #75 Fix-freshness model: tracks the wall-clock age of the last accepted fix
// plus navigator.onLine, producing a chip status of fresh / stale / offline.
type FixFreshness = 'fresh' | 'stale' | 'offline';

function useFixFreshness(hasFix: boolean, lat?: number | null, lng?: number | null): FixFreshness {
  const lastFixRef = useRef<number>(0);
  const [, force] = useState(0);

  // Mark a new accepted fix whenever the coordinate pair changes.
  useEffect(() => {
    if (hasFix && lat != null && lng != null) lastFixRef.current = Date.now();
  }, [hasFix, lat, lng]);

  // 1s tick drives the staleness re-evaluation (existing force() pattern).
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const online = (() => { try { return navigator.onLine; } catch { return true; } })();
  const age = lastFixRef.current ? Date.now() - lastFixRef.current : Infinity;
  if (!online || age > 60_000) return 'offline';
  if (age > 10_000) return 'stale';
  return 'fresh';
}

// #77 ETA helpers — format a remaining-seconds countdown + arrival clock.
function fmtCountdown(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function NavPage() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const officerName = user ? `${user.first_name} ${user.last_name}`.trim() || user.username : 'Unknown Officer';
  const canDownloadReport = REPORT_ROLES.has(user?.role ?? '');
  const { addToast } = useToast();

  // -- Deep-link: ?tab=history opens history tab directly --
  const [searchParams, setSearchParams] = useSearchParams();
  const fromDeepLinkRef = useRef(false);
  const initialTab = searchParams.get('tab') === 'history' ? 'history' : 'current';
  const [tab, setTab] = useState<'current' | 'history'>(initialTab as 'current' | 'history');

  // -- App-wide trip detector (NavTripProvider) --
  const navTrip = useNavTrip();
  const gps = navTrip?.gps;
  const detection = navTrip?.detection;
  const currentTrip = navTrip?.currentTrip ?? null;
  const hasTakeHome = navTrip?.hasTakeHome ?? false;
  const startManualTrip = navTrip?.startManualTrip;
  const endCurrentTrip = navTrip?.endCurrentTrip;
  const fetchCurrentTrip = navTrip?.fetchCurrentTrip;

  // Strip ?tab= param on first render (useRef guard prevents re-run).
  useEffect(() => {
    if (fromDeepLinkRef.current) return;
    fromDeepLinkRef.current = true;
    const tabParam = searchParams.get('tab');
    if (tabParam) {
      const next = new URLSearchParams(searchParams);
      next.delete('tab');
      setSearchParams(next, { replace: true });
      if (tabParam === 'history') addToast('Showing trip history', 'info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [currentTripLocal, setCurrentTripLocal] = useState<NavTrip | null>(null);
  const [tripHistory, setTripHistory] = useState<NavTrip[]>([]);
  const [loading, setLoading] = useState(false);
  const [droppedPins, setDroppedPins] = useState<DroppedPin[]>(loadPins);
  const dropPinHandlerRef = useRef<((pin: DroppedPin) => void) | null>(null);

  // -- ConfirmDialog state --
  const [endTripConfirmOpen, setEndTripConfirmOpen] = useState(false);
  const [clearPinsConfirmOpen, setClearPinsConfirmOpen] = useState(false);

  // #71/#81/#84/#93 Persisted nav prefs + settings popover open-state.
  const [prefs, setPrefs] = useState<NavPrefs>(loadNavPrefs);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // -- Saved/favorite destinations (Task 2) --
  const { favorites, save: saveFavorite, remove: removeFavorite } = useNavFavorites();
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  // Name-and-save dialog state (replaces window.prompt — see handlers below).
  const [saveFavoriteTarget, setSaveFavoriteTarget] = useState<{ lat: number; lng: number } | null>(null);
  const [saveFavoriteName, setSaveFavoriteName] = useState('');
  const saveFavoriteOpen = saveFavoriteTarget != null;

  // -- Staging/parking suggestions near an active call (Task 12) --
  // NavPage's trip model (NavTrip) has no call_id or destination lat/lng —
  // it tracks driving trips, not a linked CFS — so there is no "active call
  // location" available on this page to anchor against. The closest usable
  // proxy is the officer's own live GPS fix (gps.latitude/longitude from
  // NavTripContext), which approximates the call scene once the officer has
  // responded there. Any nav_favorites row flagged is_staging within
  // STAGING_RADIUS_MILES of that position is surfaced as a suggestion.
  const STAGING_RADIUS_MILES = 0.5;
  const nearbyStagingFavorites = useMemo(() => {
    if (gps?.latitude == null || gps?.longitude == null) return [];
    return favorites.filter((fav) => {
      if (!fav.is_staging) return false;
      const dist = haversineMilesLocal(gps.latitude!, gps.longitude!, fav.lat, fav.lng);
      return dist <= STAGING_RADIUS_MILES;
    });
  }, [favorites, gps?.latitude, gps?.longitude]);

  // -- Driving score trend (Task 8) — fetches recent closed trips' harsh-event
  // counts for the active unit (falls back to the current officer if no unit
  // is on-duty) and derives a per-trip 0-100 score client-side via
  // tripDrivingScore(). Same unit_id resolution as NavTripContext's socket
  // filter (gps.unitId, set from the officer's active on-duty unit). --
  const [scoreTrend, setScoreTrend] = useState<(HarshCounts & { id: number; start_time: string })[]>([]);
  const scoreTrendUnitId = gps?.unitId ?? null;
  const scoreTrendOfficerId = scoreTrendUnitId == null ? (user?.id ?? null) : null;
  useEffect(() => {
    if (scoreTrendUnitId == null && scoreTrendOfficerId == null) return;
    const qs = scoreTrendUnitId != null
      ? `unit_id=${scoreTrendUnitId}`
      : `officer_id=${scoreTrendOfficerId}`;
    apiFetch<(HarshCounts & { id: number; start_time: string })[]>(`/dispatch/trips/score-trend?${qs}&limit=20`)
      .then(setScoreTrend)
      .catch(() => setScoreTrend([]));
  }, [scoreTrendUnitId, scoreTrendOfficerId]);

  const setPref = useCallback(<K extends keyof NavPrefs>(key: K, value: NavPrefs[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      saveNavPrefs(next);
      return next;
    });
  }, []);

  // #84 Layer toggles read/write prefs.layers so on/off survives reload.
  const toggleLayer = useCallback((key: keyof NavPrefs['layers']) => {
    setPrefs((prev) => {
      const next = { ...prev, layers: { ...prev.layers, [key]: !prev.layers[key] } };
      saveNavPrefs(next);
      return next;
    });
  }, []);

  // #90 reduced-motion gate for page-level pulse animations.
  const reducedMotion = usePrefersReducedMotion();
  const pulseClass = reducedMotion ? '' : 'animate-pulse';

  // #74/#75 GPS fix presence + freshness. Hooks must run before any early
  // return, so we read gps optionally here (gps is non-null in practice).
  const hasFix = !!(gps?.latitude && gps?.longitude);
  const freshness = useFixFreshness(hasFix, gps?.latitude, gps?.longitude);

  useEffect(() => { savePins(droppedPins); }, [droppedPins]);

  useEffect(() => {
    setCurrentTripLocal(currentTrip);
  }, [currentTrip]);

  // -- Fetch history --
  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ trips: NavTrip[] }>('/nav/trip/history?limit=50');
      if (res?.trips) setTripHistory(res.trips);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const prevTripIdRef = useRef<number | null>(null);
  useEffect(() => {
    const prevId = prevTripIdRef.current;
    const curId = currentTrip?.id ?? null;
    if (prevId != null && curId == null) fetchHistory();
    prevTripIdRef.current = curId;
  }, [currentTrip, fetchHistory]);

  // activeTripEarly derived before keyboard effect so the closure is valid.
  const activeTripEarly = currentTripLocal || (detection?.pendingTripId ? currentTrip : null);

  // -- Manual start / end --
  const handleManualStart = useCallback(() => {
    if (gps?.latitude && gps?.longitude) {
      startManualTrip?.(gps.latitude, gps.longitude, gps.accuracy ?? undefined);
    }
  }, [gps?.latitude, gps?.longitude, gps?.accuracy, startManualTrip]);

  const handleEndTrip = useCallback(() => {
    endCurrentTrip?.(gps?.latitude ?? undefined, gps?.longitude ?? undefined);
    setEndTripConfirmOpen(false);
  }, [endCurrentTrip, gps?.latitude, gps?.longitude]);

  // -- N + Esc keyboard shortcuts --
  // N: start a trip (no active trip) or open End Trip confirm (active trip).
  // Esc cascade: endTripConfirm -> clearPinsConfirm -> settingsOpen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (e.key === 'Escape') {
        if (endTripConfirmOpen) { e.stopPropagation(); setEndTripConfirmOpen(false); return; }
        if (clearPinsConfirmOpen) { e.stopPropagation(); setClearPinsConfirmOpen(false); return; }
        if (settingsOpen) { e.stopPropagation(); setSettingsOpen(false); return; }
        if (saveFavoriteOpen) { e.stopPropagation(); closeSaveFavorite(); return; }
        if (favoritesOpen) { e.stopPropagation(); setFavoritesOpen(false); return; }
        return;
      }

      if (e.key === 'n' || e.key === 'N') {
        if (isInput) return;
        if (activeTripEarly && (activeTripEarly.status === 'active' || activeTripEarly.status === 'pending')) {
          setEndTripConfirmOpen(true);
        } else if (gps?.latitude && gps?.longitude && (gps?.unitCallSign || hasTakeHome)) {
          handleManualStart();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [endTripConfirmOpen, clearPinsConfirmOpen, settingsOpen, saveFavoriteOpen, favoritesOpen, activeTripEarly, gps, hasTakeHome, handleManualStart]);

  // -- Drop pin --
  const handleDropPin = useCallback((pin: DroppedPin) => {
    setDroppedPins((prev) => [...prev, pin]);
  }, []);
  dropPinHandlerRef.current = handleDropPin;

  // -- Favorites: name-and-save handlers (replaces window.prompt — this
  //    codebase deliberately moved off native prompt()/confirm() dialogs in
  //    GeographyPage/CaseManagement/DailyActivityReports/Reports/Incidents/
  //    CourtTracker in favor of an in-page ConfirmDialog with a text input;
  //    same pattern reused here so favorites naming is themed, Esc-aware,
  //    and validated like every other "add" flow on this page). --
  const openSaveFavorite = useCallback((lat: number, lng: number, defaultLabel: string) => {
    setSaveFavoriteTarget({ lat, lng });
    setSaveFavoriteName(defaultLabel);
  }, []);

  const closeSaveFavorite = useCallback(() => {
    setSaveFavoriteTarget(null);
    setSaveFavoriteName('');
  }, []);

  const confirmSaveFavorite = useCallback(() => {
    const target = saveFavoriteTarget;
    if (!target) return;
    const trimmed = saveFavoriteName.trim();
    if (!trimmed) return;
    saveFavorite(trimmed, target.lat, target.lng).catch(() => {
      addToast('Failed to save favorite', 'error');
    });
    closeSaveFavorite();
  }, [saveFavoriteTarget, saveFavoriteName, saveFavorite, addToast, closeSaveFavorite]);

  // -- Favorites: save a dropped pin as a favorite destination --
  const handleSavePinAsFavorite = useCallback((pin: DroppedPin) => {
    openSaveFavorite(pin.lat, pin.lng, pin.label);
  }, [openSaveFavorite]);

  // -- Favorites: save the current GPS position as a favorite destination --
  const handleSaveCurrentPositionAsFavorite = useCallback(() => {
    if (gps?.latitude == null || gps?.longitude == null) return;
    openSaveFavorite(gps.latitude, gps.longitude, 'Current Position');
  }, [gps?.latitude, gps?.longitude, openSaveFavorite]);

  // -- Favorites: navigate to a favorite via the existing Drive Mode deep-link
  //    (/navigation?destination=&lat=&lng= is already consumed by NavigationPage
  //    to call routeToDestination — reuse it rather than a second trip-start path).
  const favoriteNavigateHref = useCallback((fav: NavFavorite) => (
    `/navigation?destination=${encodeURIComponent(fav.label)}&lat=${fav.lat}&lng=${fav.lng}`
  ), []);

  const handleRemoveFavorite = useCallback((id: number) => {
    removeFavorite(id).catch(() => {
      addToast('Failed to delete favorite', 'error');
    });
  }, [removeFavorite, addToast]);

  // -- PDF downloads --
  const handleDownloadAllTrips = () => {
    if (!canDownloadReport || tripHistory.length === 0) return;
    const periodLabel = `Last ${tripHistory.length} trips`;
    generateNavTripReport({
      trips: tripHistory,
      officerName,
      vehicleLabel: tripHistory.find((t) => t.vehicle_number)?.vehicle_number ?? 'All Vehicles',
      periodLabel,
    });
  };

  const handleDownloadSingleTrip = (trip: NavTrip) => {
    generateNavSingleTripReport({ trip, officerName });
  };

  if (!navTrip || !gps || !detection) {
    return (
      <div className="flex items-center justify-center h-full bg-surface-base">
        <span className="text-[11px] font-mono text-rmpg-400">
          Navigation tracker unavailable.
        </span>
      </div>
    );
  }

  const activeTrip = activeTripEarly;

  return (
    <div className="flex flex-col h-full bg-surface-base relative">
      {/* #76/#103 Brightness/dim overlay for night driving — resolved via the
          shared getEffectiveBrightness() (also used by NavigationPage.tsx's
          overlay) so Auto mode behaves identically on both pages that share
          the same rmpg_nav_prefs blob. */}
      {getEffectiveBrightness(prefs) < 1 && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: 'black',
            opacity: (1 - getEffectiveBrightness(prefs)) * 0.6,
            pointerEvents: 'none',
            zIndex: 50,
          }}
        />
      )}

      <PanelTitleBar
        title="NAVIGATION"
        icon={Navigation}
        statusLed={gps.isTracking ? 'bg-emerald-400' : 'bg-red-400'}
        ledPulse={gps.isTracking}
      />

      {/* GPS Status Bar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-subtle text-[10px] font-mono" style={{ background:"var(--surface-sunken)" }}>
        <span style={{ color: gps.isTracking ? 'var(--sev-ok)' : 'var(--sev-critical)' }}>
          {gps.isTracking ? 'GPS ON' : 'GPS OFF'}
        </span>
        {gps.latitude && gps.longitude && (
          <span className="text-rmpg-400">
            {gps.latitude.toFixed(5)}, {gps.longitude.toFixed(5)}
          </span>
        )}
        {gps.accuracy != null && (
          <span className="text-rmpg-500">+-{Math.round(gps.accuracy)}m</span>
        )}
        {gps.unitCallSign ? (
          <span style={{ color: 'var(--field-label-color)' }}>{gps.unitCallSign} - ON DUTY</span>
        ) : hasTakeHome ? (
          <span style={{ color: 'var(--sev-ok)' }}>TAKE-HOME - TRACKING ACTIVE</span>
        ) : gps.isTracking ? (
          <span className="text-rmpg-500">GPS ONLY - Set take-home vehicle to log trips</span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          {/* #75 Offline / stale-fix status chip */}
          {(() => {
            const map = {
              fresh: { label: 'LIVE', color: 'var(--sev-ok)', border: 'rgb(var(--sev-ok-rgb) / 0.35)', Icon: Satellite },
              stale: { label: 'STALE', color: 'var(--sev-warn)', border: 'rgb(var(--sev-warn-rgb) / 0.35)', Icon: Satellite },
              offline: { label: 'OFFLINE', color: 'var(--sev-critical)', border: 'rgb(var(--sev-critical-rgb) / 0.35)', Icon: WifiOff },
            } as const;
            const m = map[freshness];
            return (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm border"
                style={{ color: m.color, borderColor: m.border }}
                title={`GPS fix freshness: ${freshness}`}
              >
                <m.Icon size={10} className={freshness === 'fresh' && !reducedMotion ? 'animate-pulse' : ''} /> {m.label}
              </span>
            );
          })()}
          {/* Favorites (saved destinations) */}
          <button
            type="button"
            aria-label="Favorite destinations"
            aria-expanded={favoritesOpen}
            onClick={() => setFavoritesOpen((o) => !o)}
            className="flex items-center justify-center rounded-sm border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-gold-300"
            style={{
              width: 24, height: 22,
              borderColor: favoritesOpen ? 'var(--field-label-color)' : 'var(--border-default)',
              color: favoritesOpen ? 'var(--field-label-color)' : 'var(--text-secondary)',
              background: favoritesOpen ? 'color-mix(in srgb, var(--field-label-color) 10%, transparent)' : 'transparent',
            }}
            title="Favorite destinations"
          >
            <Star size={12} fill={favorites.length > 0 ? 'currentColor' : 'none'} />
          </button>
          {/* #81 Gear / settings */}
          <button
            type="button"
            aria-label="Navigation settings"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((o) => !o)}
            className="flex items-center justify-center rounded-sm border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-gold-300"
            style={{
              width: 24, height: 22,
              borderColor: settingsOpen ? 'var(--field-label-color)' : 'var(--border-default)',
              color: settingsOpen ? 'var(--field-label-color)' : 'var(--text-secondary)',
              background: settingsOpen ? 'color-mix(in srgb, var(--field-label-color) 10%, transparent)' : 'transparent',
            }}
            title="Navigation settings"
          >
            <Settings size={12} />
          </button>
          <Link
            to="/navigation"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-subtle hover:border-strong transition-colors"
            style={{ color: 'var(--field-label-color)' }}
            title="Open full drive view with chase cam and turn-by-turn"
          >
            <ExternalLink size={10} /> Drive Mode
          </Link>
        </div>
      </div>

      {/* Always-visible mini-map */}
      <div className="px-3 pt-2">
        <NavMapView
          position={gps.latitude && gps.longitude
            ? { latitude: gps.latitude, longitude: gps.longitude, accuracy: gps.accuracy }
            : null}
          routePoints={activeTrip?.route_points as never}
          height={isMobile ? 200 : 260}
          onDropPin={(p) => dropPinHandlerRef.current?.(p)}
          pins={droppedPins}
        />
        {droppedPins.length > 0 && (
          <div className="mt-1 text-[9px] font-mono space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-rmpg-400">
                <Pin size={9} className="inline" /> {droppedPins.length} pin{droppedPins.length === 1 ? '' : 's'} on map
              </span>
              <button
                type="button"
                onClick={() => setClearPinsConfirmOpen(true)}
                className="flex items-center gap-1 hover:underline text-rmpg-400"
              >
                <Trash2 size={9} /> Clear pins
              </button>
            </div>
            {/* Most recent pin — quick "save as favorite" action */}
            {(() => {
              const lastPin = droppedPins[droppedPins.length - 1];
              return (
                <div className="flex items-center justify-between px-1.5 py-1 rounded-sm border border-subtle" style={{ background: 'var(--surface-sunken)' }}>
                  <span className="text-rmpg-300 truncate">{lastPin.label}</span>
                  <button
                    type="button"
                    aria-label="Save pin as favorite"
                    onClick={() => handleSavePinAsFavorite(lastPin)}
                    className="flex items-center gap-1 hover:underline"
                    style={{ color: 'var(--field-label-color)' }}
                  >
                    <Star size={9} /> Save
                  </button>
                </div>
              );
            })()}
          </div>
        )}

        {/* #84 Layer-toggle active-state visual sync */}
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {([
            ['crime', 'Crime'],
            ['crash', 'Crash'],
            ['trail', 'Trail'],
            ['alerts', 'Alerts'],
          ] as const).map(([key, label]) => {
            const active = prefs.layers[key];
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                aria-label={`Toggle ${label} layer`}
                onClick={() => toggleLayer(key)}
                className="px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded-sm border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-gold-300"
                style={{
                  minHeight: 22,
                  borderColor: active ? 'var(--field-label-color)' : 'var(--border-default)',
                  background: active ? 'var(--field-label-color)' : 'transparent',
                  color: active ? 'black' : 'var(--text-secondary)',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-subtle mt-2">
        {(['current', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors"
            style={{
              color: tab === t ? 'var(--field-label-color)' : 'var(--text-secondary)',
              borderBottom: tab === t ? '2px solid var(--field-label-color)' : '2px solid transparent',
            }}
          >
            {t === 'current' ? 'Current Trip' : 'Trip History'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {tab === 'current' ? (
          <CurrentTripPanel
            trip={activeTrip ?? null}
            detection={detection}
            gps={gps}
            hasTakeHome={hasTakeHome}
            prefs={prefs}
            reducedMotion={reducedMotion}
            onStart={handleManualStart}
            onEnd={() => setEndTripConfirmOpen(true)}
            onRefresh={() => fetchCurrentTrip?.()}
          />
        ) : (
          <HistoryPanel
            trips={tripHistory}
            loading={loading}
            onRefresh={fetchHistory}
            onDownloadAll={handleDownloadAllTrips}
            onDownloadTrip={handleDownloadSingleTrip}
            canDownloadReport={canDownloadReport}
          />
        )}
        {scoreTrend.length > 0 && <DrivingScoreTrend trend={scoreTrend} />}
        {tripHistory.length > 0 && <RouteHeatmapPanel trips={tripHistory} />}
      </div>

      {/* #74 Acquiring-GPS / no-fix full-screen empty state */}
      {!hasFix && (
        <div
          className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-3 px-6 text-center"
          style={{ background: 'rgba(5,5,5,0.92)', backdropFilter: 'blur(2px)' }}
        >
          <Satellite size={36} className={pulseClass} style={{ color: 'var(--field-label-color)' }} />
          <div className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: 'var(--field-label-color)' }}>
            Acquiring GPS fix...
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span className="px-1.5 py-0.5 rounded-sm border text-rmpg-400 border-rmpg-700">
              {gps.unitCallSign ? 'ON-DUTY GPS' : hasTakeHome ? 'TAKE-HOME GPS' : 'BROWSER GPS'}
            </span>
            {gps.accuracy != null && (
              <span className="text-rmpg-400">+-{Math.round(gps.accuracy)}m</span>
            )}
          </div>
          <p className="text-[10px] font-mono max-w-xs text-rmpg-400">
            {gps.isTracking
              ? 'Waiting for the first satellite fix. Stay near a clear sky view.'
              : 'Enable location services for this device to start tracking.'}
          </p>
        </div>
      )}

      {/* #71/#81 Master settings popover (bottom sheet) */}
      {settingsOpen && (
        <NavSettingsPanel
          prefs={prefs}
          setPref={setPref}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Favorites popover (bottom sheet, matches NavSettingsPanel pattern) */}
      {favoritesOpen && (
        <FavoritesPanel
          favorites={favorites}
          nearbyStaging={nearbyStagingFavorites}
          onClose={() => setFavoritesOpen(false)}
          onSaveCurrentPosition={handleSaveCurrentPositionAsFavorite}
          canSaveCurrentPosition={gps.latitude != null && gps.longitude != null}
          getNavigateHref={favoriteNavigateHref}
          onRemove={handleRemoveFavorite}
        />
      )}

      {/* Confirm: End Trip */}
      <ConfirmDialog
        isOpen={endTripConfirmOpen}
        onClose={() => setEndTripConfirmOpen(false)}
        onConfirm={handleEndTrip}
        title="End Trip"
        message="End the current trip now? The route and stats will be saved and the trip marked completed."
        confirmLabel="End Trip"
        confirmVariant="warning"
      />

      {/* Confirm: Clear Pins */}
      <ConfirmDialog
        isOpen={clearPinsConfirmOpen}
        onClose={() => setClearPinsConfirmOpen(false)}
        onConfirm={() => { setDroppedPins([]); setClearPinsConfirmOpen(false); }}
        title="Clear Pins"
        message={`Remove all ${droppedPins.length} dropped pin${droppedPins.length === 1 ? '' : 's'} from the map?`}
        confirmLabel="Clear Pins"
        confirmVariant="danger"
      />

      {/* Save Favorite dialog (replaces window.prompt — see handler comment above) */}
      <ConfirmDialog
        isOpen={saveFavoriteOpen}
        onClose={closeSaveFavorite}
        onConfirm={confirmSaveFavorite}
        title="Save Favorite"
        message="Enter a label for this saved destination."
        confirmLabel="Save"
        confirmVariant="default"
        confirmDisabled={!saveFavoriteName.trim()}
        details={
          <div className="mt-1">
            <label className="block text-[9px] uppercase tracking-wider text-rmpg-500 mb-1">
              Label
            </label>
            <input
              autoFocus
              type="text"
              value={saveFavoriteName}
              onChange={(e) => setSaveFavoriteName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveFavoriteName.trim()) {
                  e.preventDefault();
                  confirmSaveFavorite();
                }
              }}
              className="input-dark text-[12px] w-full"
              placeholder="e.g. Station HQ"
              maxLength={120}
            />
            {saveFavoriteTarget && (
              <div className="mt-2 text-[10px] font-mono text-rmpg-500">
                {saveFavoriteTarget.lat.toFixed(5)}, {saveFavoriteTarget.lng.toFixed(5)}
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}

// -- Favorites Panel (bottom sheet, styled after NavSettingsPanel) --

function FavoritesPanel({
  favorites, nearbyStaging, onClose, onSaveCurrentPosition, canSaveCurrentPosition, getNavigateHref, onRemove,
}: {
  favorites: NavFavorite[];
  nearbyStaging: NavFavorite[];
  onClose: () => void;
  onSaveCurrentPosition: () => void;
  canSaveCurrentPosition: boolean;
  getNavigateHref: (fav: NavFavorite) => string;
  onRemove: (id: number) => void;
}) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[1200] panel-beveled"
      role="dialog"
      aria-modal="true"
      aria-label="Favorite destinations"
      style={{
        background: 'rgba(5,5,5,0.95)',
        borderTop: '1px solid var(--border-default)',
        borderTopLeftRadius: 2,
        borderTopRightRadius: 2,
        boxShadow: '0 -8px 24px rgb(0 0 0 / 0.6)',
        maxHeight: '80vh',
        overflowY: 'auto',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--surface-raised)' }}>
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--field-label-color)' }}>
          Favorite Destinations
        </span>
        <button
          type="button"
          aria-label="Close favorite destinations"
          onClick={onClose}
          className="flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-gold-300"
          style={{
            width: 36, height: 36, borderRadius: 2,
            background: 'var(--surface-base)', border: '1px solid var(--border-default)', color: 'var(--text-muted)',
          }}
        >
          &times;
        </button>
      </div>

      <div className="p-3 space-y-2">
        {nearbyStaging.length > 0 && (
          <div className="rounded-sm border border-subtle p-2 space-y-1.5" style={{ background: 'var(--surface-sunken)' }}>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-brand-gold-500">
              Staging Spots Nearby
            </div>
            {nearbyStaging.map((fav) => (
              <div key={fav.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold text-rmpg-300 truncate">{fav.label}</div>
                  <div className="text-[9px] font-mono text-rmpg-500">
                    {fav.address || `${fav.lat.toFixed(5)}, ${fav.lng.toFixed(5)}`}
                  </div>
                </div>
                <Link
                  to={getNavigateHref(fav)}
                  className="flex items-center gap-1 px-1.5 py-1 rounded-sm border border-subtle text-[9px] font-mono uppercase tracking-wider hover:border-strong transition-colors shrink-0 text-brand-gold-500"
                  title={`Navigate to ${fav.label}`}
                >
                  <Compass size={10} /> Go
                </Link>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onSaveCurrentPosition}
          disabled={!canSaveCurrentPosition}
          className="w-full py-2 rounded-sm text-[10px] font-mono uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--surface-base)', color: 'var(--field-label-color)', border: '1px solid var(--border-subtle)' }}
        >
          <Star size={11} /> Save Current Position
        </button>

        {favorites.length === 0 ? (
          <div className="rounded-sm border border-subtle p-4 text-center" style={{ background: 'var(--surface-sunken)' }}>
            <Star size={20} className="mx-auto mb-1.5" style={{ color: 'var(--text-muted)' }} />
            <p className="text-[10px] text-rmpg-500">No favorites saved yet</p>
            <p className="text-[9px] text-rmpg-600 mt-1">
              Drop a pin on the map or save your current position to add one.
            </p>
          </div>
        ) : (
          favorites.map((fav) => (
            <div
              key={fav.id}
              className="flex items-center justify-between gap-2 rounded-sm border border-subtle p-2"
              style={{ background: 'var(--surface-sunken)' }}
            >
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-rmpg-300 truncate">{fav.label}</div>
                <div className="text-[9px] font-mono text-rmpg-500">
                  {fav.address || `${fav.lat.toFixed(5)}, ${fav.lng.toFixed(5)}`}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Link
                  to={getNavigateHref(fav)}
                  className="flex items-center gap-1 px-1.5 py-1 rounded-sm border border-subtle text-[9px] font-mono uppercase tracking-wider hover:border-strong transition-colors"
                  style={{ color: 'var(--field-label-color)' }}
                  title={`Navigate to ${fav.label}`}
                >
                  <Compass size={10} /> Go
                </Link>
                <button
                  type="button"
                  aria-label={`Delete favorite ${fav.label}`}
                  onClick={() => onRemove(fav.id)}
                  className="flex items-center justify-center px-1.5 py-1 rounded-sm border border-subtle hover:border-strong transition-colors text-rmpg-400"
                  title="Delete favorite"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// -- Driving Score trend (Task 8) --
//
// Line chart of the last N closed trips' derived driving score, oldest to
// newest left-to-right. The API returns newest-first (matching the /trips
// listing convention), so it's reversed here before charting. Styling
// mirrors navigation/MovementReportDrawer.tsx's SpeedProfile area chart
// (same gold line + gradient fill), and per-point color uses the same
// good/caution/bad thresholds as HudDrivingScore in hud/HudInstruments.tsx
// (0-1 harsh events = green, 2-5 = amber, 6+ = red).
function DrivingScoreTrend({ trend }: { trend: (HarshCounts & { id: number; start_time: string })[] }) {
  const chrono = useMemo(() => [...trend].reverse(), [trend]);
  const scores = useMemo(() => chrono.map((t) => tripDrivingScore(t)), [chrono]);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const W = 300, H = 84;
  const n = chrono.length;
  const path = useMemo(() => {
    if (n < 2) return { area: '', line: '' };
    const x = (i: number) => (i / (n - 1)) * W;
    const y = (score: number) => H - Math.min(H, (score / 100) * H);
    const pts = scores.map((s, i) => `${x(i).toFixed(1)},${y(s).toFixed(1)}`);
    return { area: `0,${H} ${pts.join(' ')} ${W},${H}`, line: pts.join(' ') };
  }, [n, scores]);

  return (
    <div className="rounded-sm border border-subtle p-3" style={{ background: 'var(--surface-raised)' }}>
      <PanelTitleBar title="DRIVING SCORE" icon={Gauge} />
      <div className="flex items-center gap-3 mt-2">
        <div className="font-mono font-bold text-[20px] tabular-nums shrink-0" style={{ color: avg >= 85 ? 'var(--sev-ok)' : avg >= 60 ? 'var(--sev-warn)' : 'var(--sev-critical)' }}>
          {avg}
        </div>
        <div className="text-[9px] uppercase tracking-wider text-rmpg-500 shrink-0">
          avg / last {n} trip{n === 1 ? '' : 's'}
        </div>
        <div className="flex-1 min-w-0">
          {n < 2 ? (
            <div className="flex items-center justify-center text-[10px] text-rmpg-600" style={{ height: H }}>
              Not enough closed trips yet
            </div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H }} aria-hidden="true">
              <defs>
                <linearGradient id="score-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--field-label-color)" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="var(--field-label-color)" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <polyline points={path.area} fill="url(#score-fill)" stroke="none" />
              <polyline points={path.line} fill="none" stroke="var(--field-label-color)" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {chrono.map((t, i) => {
                const cx = n < 2 ? 0 : (i / (n - 1)) * W;
                const cy = H - Math.min(H, (scores[i] / 100) * H);
                return <circle key={t.id} cx={cx} cy={cy} r="2.5" fill={harshEventColor(t.harsh_accel_count + t.harsh_brake_count + t.harsh_corner_count)} />;
              })}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}

// -- Route/Pattern Heatmap (Task 10) --
//
// Reuses the existing Mapbox heatmap infra (useMapHeatmap — same hook that
// drives the Crime Heatmap on the full Map page) to visualize an officer's
// OWN historical trip routes rather than incident density. Data comes from
// the trip history already fetched for the History tab / driving-score
// trend above (tripHistory / /nav/trip/history), so this is purely a data
// adapter: flatten every closed trip's route_points into HeatmapPoint[]
// and feed the same hook. A small dedicated Mapbox map instance is mounted
// here (mirrors DashboardMiniMap.tsx's minimal init pattern) since NavPage's
// primary NavMapView doesn't expose its underlying mapboxgl.Map instance.
const ROUTE_HEATMAP_TOKEN_TIMEOUT_MS = 8_000;
// Breadcrumbs are logged every few seconds, so 50 trips of any real length
// can flatten into tens of thousands of points — rebuilding the GeoJSON
// heatmap source with that many points in one synchronous call is a real
// jank risk on mobile MDTs. Cap the total via stride sampling (take every
// Nth point) rather than dropping whole trips, so route shape/coverage
// across the full history is preserved.
const ROUTE_HEATMAP_MAX_POINTS = 5_000;

function RouteHeatmapPanel({ trips }: { trips: NavTrip[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const webglRecoveryCleanupRef = useRef<(() => void) | null>(null);
  const { rebuildNonce, attach, onMapLoaded } = useWebglMapRecovery();
  const [mapLoaded, setMapLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const points = useMemo<HeatmapPoint[]>(() => {
    const all: HeatmapPoint[] = [];
    for (const trip of trips) {
      const route = Array.isArray(trip.route_points) ? trip.route_points : [];
      for (const p of route) {
        if (typeof p.lat === 'number' && typeof p.lng === 'number') {
          all.push({ latitude: p.lat, longitude: p.lng, weight: 0.5 });
        }
      }
    }
    if (all.length <= ROUTE_HEATMAP_MAX_POINTS) return all;
    const stride = Math.ceil(all.length / ROUTE_HEATMAP_MAX_POINTS);
    const sampled: HeatmapPoint[] = [];
    for (let i = 0; i < all.length; i += stride) sampled.push(all[i]);
    return sampled;
  }, [trips]);

  const heatmap = useMapHeatmap(mapRef.current, mapLoaded);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    injectMapboxStyles();

    (async () => {
      try {
        const tokenPromise = getMapboxToken();
        let timeoutId: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<null>((resolve) => {
          timeoutId = setTimeout(() => resolve(null), ROUTE_HEATMAP_TOKEN_TIMEOUT_MS);
        });
        let token: string | null;
        try {
          token = await Promise.race([tokenPromise, timeoutPromise]);
        } finally {
          clearTimeout(timeoutId!);
        }
        if (!token || cancelled || !containerRef.current) {
          if (!cancelled) setError('Mapbox token not configured');
          return;
        }

        mapboxgl.accessToken = token;
        const center: [number, number] = points.length
          ? [points[0].longitude, points[0].latitude]
          : [-111.891, 40.7608];
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center,
          zoom: 11,
          projection: 'mercator',
          interactive: true,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
        map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
        map.on('load', () => { if (!cancelled) { onMapLoaded(map); setMapLoaded(true); } });
        map.on('error', (e: mapboxgl.ErrorEvent) => { if (!cancelled) setError(e.error?.message || 'Map error'); });
        mapRef.current = map;
        webglRecoveryCleanupRef.current = attach(map, 'NavPage-RouteHeatmap');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load map');
      }
    })();

    return () => {
      cancelled = true;
      webglRecoveryCleanupRef.current?.();
      webglRecoveryCleanupRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
    // Map is created once per panel mount (and again after a WebGL
    // context-loss rebuild); point data is synced separately below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuildNonce]);

  // Enable the heatmap layer + push points once the map + data are ready,
  // and fit the camera to the route bounds.
  useEffect(() => {
    if (!mapLoaded || points.length === 0) return;
    heatmap.updatePoints(points);
    heatmap.setEnabled(true);

    const map = mapRef.current;
    if (map) {
      const bounds = new mapboxgl.LngLatBounds();
      points.forEach((p) => bounds.extend([p.longitude, p.latitude]));
      map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 0 });
    }
    // heatmap is a stable-shaped object from the hook; only re-run on data change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, points]);

  return (
    <div className="rounded-sm border border-subtle p-3" style={{ background: 'var(--surface-raised)' }}>
      <PanelTitleBar title="MY ROUTES" icon={MapPinned} />
      <div className="relative mt-2 rounded-sm overflow-hidden" style={{ height: 220 }}>
        <div ref={containerRef} className="w-full h-full" />
        {!mapLoaded && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-base/80">
            <Loader2 className="w-5 h-5 text-rmpg-400 animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-base/90 px-4 text-center">
            <span className="text-[10px]" style={{ color: 'var(--sev-warn)' }}>{error}</span>
          </div>
        )}
        {mapLoaded && !error && points.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-base/80 px-4 text-center">
            <span className="text-[10px] text-rmpg-500">No trip breadcrumb data yet</span>
          </div>
        )}
      </div>
      <div className="mt-1.5 text-[9px] uppercase tracking-wider text-rmpg-500">
        Density of GPS breadcrumbs across your last {trips.length} trip{trips.length === 1 ? '' : 's'}
      </div>
    </div>
  );
}

// -- Current Trip Panel --

function CurrentTripPanel({
  trip, detection, gps, hasTakeHome, prefs, reducedMotion, onStart, onEnd, onRefresh,
}: {
  trip: NavTrip | null;
  detection: NavTripContextValue['detection'];
  gps: NavTripContextValue['gps'];
  hasTakeHome: boolean;
  prefs: NavPrefs;
  reducedMotion: boolean;
  onStart: () => void;
  onEnd: () => void;
  onRefresh: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const pulseClass = reducedMotion ? '' : 'animate-pulse';

  useEffect(() => {
    if (!trip || trip.status !== 'active' || !trip.start_time) return;
    const start = parseTimestamp(trip.start_time).getTime();
    const interval = setInterval(() => {
      setElapsed(Math.round((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [trip]);

  // #77 ETA / arrival readout
  const etaSeconds = (trip as unknown as { remaining_eta_seconds?: number })?.remaining_eta_seconds;
  const etaView = useMemo(() => {
    if (etaSeconds == null || !isFinite(etaSeconds)) return null;
    const arrival = new Date(Date.now() + etaSeconds * 1000);
    const clock = arrival.toLocaleTimeString('en-US', {
      timeZone: 'America/Denver',
      hour: '2-digit',
      minute: '2-digit',
      hour12: prefs.clock === '12h',
    });
    const color = etaSeconds <= 60 ? 'var(--sev-critical)' : etaSeconds <= 300 ? 'var(--sev-warn)' : 'var(--field-label-color)';
    return { countdown: fmtCountdown(etaSeconds), clock, color };
  }, [etaSeconds, prefs.clock]);

  if (trip && (trip.status === 'active' || trip.status === 'pending')) {
    return (
      <div className="space-y-3">
        {/* Active Trip Card */}
        <div className="rounded-sm border border-subtle p-3" style={{ background: trip.status === 'active' ? 'rgb(var(--sev-ok-rgb) / 0.06)' : 'rgb(var(--sev-warn-rgb) / 0.06)' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${pulseClass}`} style={{ background: STATUS_COLOR[trip.status] || 'var(--text-muted)' }} />
              <span className="text-[11px] font-semibold uppercase" style={{ color: 'var(--panel-header-color)' }}>
                {STATUS_LABEL[trip.status] || trip.status} TRIP
              </span>
            </div>
            <span className="text-[10px] text-rmpg-500">
              {trip.detected_by === 'auto' ? 'Auto-detected' : 'Manual'}
            </span>
          </div>

          {/* Live stats */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="text-center">
              <div className="text-[22px] font-mono font-bold tabular-nums" style={{ color: 'var(--sev-ok)' }}>
                {trip.status === 'active' ? formatDuration(elapsed) : '--'}
              </div>
              <div className="text-[9px] text-rmpg-500 uppercase">Duration</div>
            </div>
            <div className="text-center">
              <div className="text-[22px] font-mono font-bold tabular-nums" style={{ color: 'var(--field-label-color)' }}>
                {formatDistance(trip.distance_miles)}
              </div>
              <div className="text-[9px] text-rmpg-500 uppercase">Distance</div>
            </div>
            <div className="text-center">
              <div className="text-[22px] font-mono font-bold tabular-nums" style={{ color: 'var(--sev-critical)' }}>
                {trip.max_speed_mph ? `${Math.round(trip.max_speed_mph)}` : '--'}
                <span className="text-[10px] ml-0.5 text-rmpg-400">mph</span>
              </div>
              <div className="text-[9px] text-rmpg-500 uppercase">Max Speed</div>
            </div>
          </div>

          {/* #77 ETA / arrival readout */}
          {etaView && (
            <div
              className="flex items-center justify-between mb-3 px-2 py-1.5 rounded-sm border"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-overlay)' }}
            >
              <div className="flex items-center gap-1.5">
                <Clock size={11} style={{ color: etaView.color }} />
                <span className="text-[16px] font-mono font-bold tabular-nums" style={{ color: etaView.color }}>
                  {etaView.countdown}
                </span>
                <span className="text-[9px] uppercase text-rmpg-400">to arrival</span>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-rmpg-300">
                ETA {etaView.clock}
              </span>
            </div>
          )}

          {/* Trip details */}
          <div className="space-y-1 text-[10px] font-mono">
            <div className="flex justify-between">
              <span className="text-rmpg-500">Start</span>
              <span className="text-rmpg-300">
                {trip.start_location || (trip.start_lat != null ? `${trip.start_lat.toFixed(4)}, ${trip.start_lng?.toFixed(4) ?? ''}` : '-')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-rmpg-500">Time</span>
              <span className="text-rmpg-300">{trip.start_time}</span>
            </div>
            {trip.vehicle_number && (
              <div className="flex justify-between">
                <span className="text-rmpg-500">Vehicle</span>
                <span style={{ color: 'var(--field-label-color)' }}>
                  {trip.vehicle_number} - {trip.make} {trip.model}
                </span>
              </div>
            )}
            {trip.unit_call_sign && (
              <div className="flex justify-between">
                <span className="text-rmpg-500">Unit</span>
                <span style={{ color: 'var(--field-label-color)' }}>{trip.unit_call_sign}</span>
              </div>
            )}
            {trip.route_points && Array.isArray(trip.route_points) && (
              <div className="flex justify-between">
                <span className="text-rmpg-500">Breadcrumbs</span>
                <span className="text-rmpg-300">{trip.route_points.length} points</span>
              </div>
            )}
          </div>
        </div>

        {/* End Trip Button */}
        <button
          onClick={onEnd}
          className="w-full py-3 max-md:min-h-[48px] rounded-sm text-[12px] font-semibold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
          style={{ background: 'var(--sev-critical)', color: 'var(--text-primary)' }}
        >
          <Square size={14} /> End Trip
        </button>

        <div className="grid grid-cols-2 gap-2">
          <Link
            to="/navigation"
            className="py-2 max-md:min-h-[44px] rounded-sm text-[10px] font-mono uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
            style={{ background: 'var(--surface-base)', color: 'var(--field-label-color)', border: '1px solid var(--border-subtle)' }}
          >
            <Compass size={11} /> Drive Mode
          </Link>
          <button
            onClick={onRefresh}
            className="py-2 max-md:min-h-[44px] rounded-sm text-[10px] font-mono uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
            style={{ background: 'var(--surface-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>
    );
  }

  // No active trip - show start screen
  return (
    <div className="space-y-3">
      {/* Status Card */}
      <div className="rounded-sm border border-subtle p-3" style={{ background:"var(--surface-sunken)" }}>
        <div className="flex items-center gap-2 mb-2">
          {gps.isTracking ? (
            <CheckCircle size={14} style={{ color: 'var(--sev-ok)' }} />
          ) : (
            <AlertTriangle size={14} style={{ color: 'var(--sev-critical)' }} />
          )}
          <span className="text-[11px] font-semibold uppercase" style={{ color: 'var(--panel-header-color)' }}>Status</span>
        </div>
        <div className="space-y-1 text-[10px] font-mono">
          <div className="flex justify-between">
            <span className="text-rmpg-500">GPS</span>
            <span style={{ color: gps.isTracking ? 'var(--sev-ok)' : 'var(--sev-critical)' }}>
              {gps.isTracking ? 'Tracking' : 'Acquiring...'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-rmpg-500">Position</span>
            <span className="text-rmpg-300">
              {gps.latitude ? `${gps.latitude.toFixed(5)}, ${gps.longitude?.toFixed(5)}` : 'No fix'}
            </span>
          </div>
          {gps.speed != null && (
            <div className="flex justify-between">
              <span className="text-rmpg-500">Speed</span>
              <span className="text-rmpg-300">{Math.round(gps.speed * 2.237)} mph</span>
            </div>
          )}
          {detection.loginPosition && (
            <div className="flex justify-between">
              <span className="text-rmpg-500">Login</span>
              <span className="text-rmpg-300">
                {detection.loginPosition.lat.toFixed(4)}, {detection.loginPosition.lng.toFixed(4)}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-rmpg-500">Vehicle</span>
            <span style={{ color: gps.unitCallSign ? 'var(--field-label-color)' : (hasTakeHome ? 'var(--sev-ok)' : 'var(--text-secondary)') }}>
              {gps.unitCallSign
                ? `${gps.unitCallSign} (on duty)`
                : hasTakeHome
                  ? 'Take-home (no duty required)'
                  : 'Set take-home in profile to track'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-rmpg-500">Detection</span>
            <span style={{ color: detection.movementConfirmed ? 'var(--sev-ok)' : 'var(--sev-warn)' }}>
              {detection.movementConfirmed ? 'Movement confirmed' : 'Monitoring...'}
            </span>
          </div>
        </div>
      </div>

      {/* Start Trip Button */}
      <button
        onClick={onStart}
        disabled={!gps.latitude || (!gps.unitCallSign && !hasTakeHome)}
        className="w-full py-3 max-md:min-h-[48px] rounded-sm text-[13px] font-semibold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: 'var(--field-label-color)', color: 'black' }}
      >
        <Play size={16} /> Start Trip Now
      </button>

      {!gps.isTracking && (
        <div className="rounded-sm border border-subtle p-2 text-center" style={{ background: 'rgb(var(--sev-critical-rgb) / 0.06)' }}>
          <p className="text-[10px]" style={{ color: 'var(--sev-critical)' }}>
            GPS not tracking - waiting for position fix.
          </p>
        </div>
      )}

      {!gps.unitCallSign && !hasTakeHome && (
        <div className="rounded-sm border border-subtle p-2 text-center" style={{ background: 'var(--surface-base)' }}>
          <p className="text-[10px] text-rmpg-400">
            Set a take-home vehicle on the Shift card to log trips without going on-duty.
          </p>
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-2">
        <Link
          to="/navigation"
          className="py-2 rounded-sm text-[10px] font-mono uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
          style={{ background: 'var(--surface-base)', color: 'var(--field-label-color)', border: '1px solid var(--border-subtle)' }}
        >
          <Compass size={11} /> Drive Mode
        </Link>
        <button
          onClick={onRefresh}
          className="py-2 rounded-sm text-[10px] font-mono uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
          style={{ background: 'var(--surface-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
        >
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      {/* Hint card */}
      <div className="rounded-sm border border-subtle p-2.5" style={{ background:"var(--surface-sunken)" }}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Footprints size={10} style={{ color: 'var(--panel-header-color)' }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
            How detection works
          </span>
        </div>
        <ul className="text-[9px] font-mono space-y-0.5 text-rmpg-400">
          <li>- Auto-starts when you move &gt;200ft from your login location (10s confirmation)</li>
          <li>- Use the Start button above for immediate trip logging</li>
          <li>- Trips are recorded with or without going on-duty (take-home works too)</li>
          <li>- Use the mini-map above to recenter, switch style, or drop a pin</li>
        </ul>
      </div>
    </div>
  );
}

// -- History Panel --

function HistoryPanel({
  trips, loading, onRefresh, onDownloadAll, onDownloadTrip, canDownloadReport,
}: {
  trips: NavTrip[];
  loading: boolean;
  onRefresh: () => void;
  onDownloadAll: () => void;
  onDownloadTrip: (trip: NavTrip) => void;
  canDownloadReport: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--field-label-color)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-rmpg-500 uppercase">{trips.length} trips</span>
        <div className="flex items-center gap-2">
          {trips.length > 0 && canDownloadReport && (
            <button
              onClick={onDownloadAll}
              className="flex items-center gap-1 text-[10px] transition-colors px-1.5 py-0.5 border border-subtle rounded-sm"
              style={{ color: 'var(--field-label-color)' }}
              title="Download PDF report of all trips"
            >
              <FileText size={11} /> PDF Report
            </button>
          )}
          <button
            onClick={onRefresh}
            className="flex items-center gap-1 text-[10px] transition-colors text-rmpg-400"
          >
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>

      {trips.length === 0 ? (
        <div className="rounded-sm border border-subtle p-6 text-center" style={{ background:"var(--surface-sunken)" }}>
          <Route size={24} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
          <p className="text-[11px] text-rmpg-500">No trips recorded yet</p>
          <p className="text-[10px] text-rmpg-600 mt-1">
            Trips are auto-detected when you start moving or can be started manually.
          </p>
        </div>
      ) : (
        trips.map((trip) => (
          <div
            key={trip.id}
            className="rounded-sm border border-subtle p-2.5 transition-colors"
            style={{ background:"var(--surface-sunken)" }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_COLOR[trip.status] || 'var(--text-muted)' }} />
                <span className="text-[11px] font-semibold text-rmpg-300">
                  {formatDistance(trip.distance_miles)}
                </span>
                <span className="text-[9px] font-mono" style={{ color: STATUS_COLOR[trip.status] || 'var(--text-muted)' }}>
                  {STATUS_LABEL[trip.status] || trip.status}
                </span>
              </div>
              <span className="text-[9px] text-rmpg-500">{timeAgo(trip.start_time)}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-[9px] font-mono">
              <div>
                <span className="text-rmpg-500">Duration</span>
                <div className="text-rmpg-300">{formatDuration(trip.duration_seconds)}</div>
              </div>
              <div>
                <span className="text-rmpg-500">Max Speed</span>
                <div className="text-rmpg-300">
                  {trip.max_speed_mph ? `${Math.round(trip.max_speed_mph)} mph` : '--'}
                </div>
              </div>
              <div>
                <span className="text-rmpg-500">Type</span>
                <div className="text-rmpg-300">{trip.detected_by === 'auto' ? 'Auto' : 'Manual'}</div>
              </div>
            </div>

            {trip.vehicle_number && (
              <div className="mt-1.5 text-[9px] font-mono flex justify-between">
                <span className="text-rmpg-500">Vehicle</span>
                <span style={{ color: 'var(--field-label-color)' }}>
                  {trip.vehicle_number} - {trip.make} {trip.model}
                </span>
              </div>
            )}

            <div className="mt-1 text-[9px] font-mono flex justify-between">
              <span className="text-rmpg-500">Route</span>
              <span className="text-rmpg-400">
                {trip.start_location || (trip.start_lat != null ? `${trip.start_lat.toFixed(4)}, ${trip.start_lng?.toFixed(4) ?? ''}` : '-')}
                {trip.end_lat && ` -> ${trip.end_location || `${trip.end_lat.toFixed(4)}, ${trip.end_lng?.toFixed(4)}`}`}
              </span>
            </div>

            {trip.status === 'completed' && (
              <div className="mt-1.5 flex justify-end gap-1.5">
                <button
                  onClick={() => onDownloadTrip(trip)}
                  className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 border border-subtle rounded-sm transition-colors hover:border-strong"
                  style={{ color: 'var(--field-label-color)' }}
                  title="Download this trip as a PDF report"
                >
                  <Download size={9} /> Trip PDF
                </button>
                {Array.isArray(trip.route_points) && trip.route_points.length > 0 && (
                  <>
                    <button
                      onClick={() => exportTripGpx(trip)}
                      className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 border border-subtle rounded-sm transition-colors hover:border-strong text-rmpg-400"
                      title="Export this trip's GPS track as GPX (for mapping / evidence)"
                    >
                      <Download size={9} /> GPX
                    </button>
                    <button
                      onClick={() => exportTripCsv(trip)}
                      className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 border border-subtle rounded-sm transition-colors hover:border-strong text-rmpg-400"
                      title="Export this trip's GPS samples as CSV (timestamp, lat, lng, speed, heading)"
                    >
                      <Download size={9} /> CSV
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
