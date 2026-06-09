import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Navigation, MapPin, Clock, Route, Car, Play, Square, History,
  Gauge, Footprints, AlertTriangle, CheckCircle, Loader2, RefreshCw,
  Download, FileText, Crosshair, MapPinned, Pin, Trash2, Compass, ExternalLink,
  Settings, Satellite, WifiOff,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../hooks/useApi';
import { useNavTrip, type NavTripContextValue } from '../context/NavTripContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../context/AuthContext';
import PanelTitleBar from '../components/PanelTitleBar';
import NavMapView, { type DroppedPin } from '../components/NavMapView';
import { generateNavTripReport, generateNavSingleTripReport } from '../utils/navTripPdf';
import type { NavTrip, NavTripStatus } from '../types';
import NavSettingsPanel, {
  type NavPrefs,
  loadNavPrefs,
  saveNavPrefs,
} from './navigation/NavSettingsPanel';

const STATUS_COLOR: Record<NavTripStatus, string> = {
  pending: '#f59e0b',
  active: '#22c55e',
  completed: '#3b82f6',
  cancelled: '#6b7280',
};

const STATUS_LABEL: Record<NavTripStatus, string> = {
  pending: 'Pending',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const PIN_STORAGE_KEY = 'rmpg_nav_dropped_pins';

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
  const d = new Date(dateStr.replace(' ', 'T'));
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
  const [tab, setTab] = useState<'current' | 'history'>('current');

  // ── App-wide trip detector (NavTripProvider) ──────────────
  // NavPage no longer runs its own detector/uploader — detection lives once at
  // the app shell so trips record on every page (incl. Drive Mode). NavPage just
  // renders the shared state. navTrip is non-null in practice (NavPage always
  // renders under the provider); the fallbacks keep TS + isolated renders safe.
  const navTrip = useNavTrip();
  const gps = navTrip?.gps;
  const detection = navTrip?.detection;
  const currentTrip = navTrip?.currentTrip ?? null;
  const hasTakeHome = navTrip?.hasTakeHome ?? false;
  const startManualTrip = navTrip?.startManualTrip;
  const endCurrentTrip = navTrip?.endCurrentTrip;
  const fetchCurrentTrip = navTrip?.fetchCurrentTrip;

  const [currentTripLocal, setCurrentTripLocal] = useState<NavTrip | null>(null);
  const [tripHistory, setTripHistory] = useState<NavTrip[]>([]);
  const [loading, setLoading] = useState(false);
  const [droppedPins, setDroppedPins] = useState<DroppedPin[]>(loadPins);
  const dropPinHandlerRef = useRef<((pin: DroppedPin) => void) | null>(null);

  // #71/#81/#84/#93 Persisted nav prefs + settings popover open-state.
  const [prefs, setPrefs] = useState<NavPrefs>(loadNavPrefs);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    // Mirror the context trip into local state in BOTH directions. The old
    // `if (currentTrip)` guard copied a started trip down but never cleared on
    // end — so when a trip ended (currentTrip → null) currentTripLocal kept the
    // stale trip and `activeTrip` (line below) still rendered the End controls
    // until a full page reload.
    setCurrentTripLocal(currentTrip);
  }, [currentTrip]);

  // ── Fetch history ─────────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ trips: NavTrip[] }>('/nav/trip/history?limit=50');
      if (res?.trips) setTripHistory(res.trips);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // Refresh history whenever an in-progress trip finishes. The detector now
  // lives in the provider (no per-page onTripEnded callback), so we react to the
  // shared currentTrip transitioning from active/pending → cleared instead.
  const prevTripIdRef = useRef<number | null>(null);
  useEffect(() => {
    const prevId = prevTripIdRef.current;
    const curId = currentTrip?.id ?? null;
    if (prevId != null && curId == null) fetchHistory();
    prevTripIdRef.current = curId;
  }, [currentTrip, fetchHistory]);

  // ── Manual start / end ────────────────────────────────────
  const handleManualStart = () => {
    if (gps?.latitude && gps?.longitude) {
      startManualTrip?.(gps.latitude, gps.longitude, gps.accuracy ?? undefined);
    }
  };

  const handleEndTrip = () => {
    endCurrentTrip?.(gps?.latitude ?? undefined, gps?.longitude ?? undefined);
  };

  // ── Drop pin ──────────────────────────────────────────────
  const handleDropPin = useCallback((pin: DroppedPin) => {
    setDroppedPins((prev) => [...prev, pin]);
  }, []);
  // Keep the ref synced so the always-mounted mini-map's onDropPin always
  // calls the latest handler.
  dropPinHandlerRef.current = handleDropPin;

  // ── PDF downloads ─────────────────────────────────────────
  const handleDownloadAllTrips = () => {
    if (tripHistory.length === 0) return;
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

  // NavPage always renders under <NavTripProvider> (App route shell). If the
  // context is somehow absent, fail soft with a tiny notice rather than crash.
  if (!navTrip || !gps || !detection) {
    return (
      <div className="flex items-center justify-center h-full bg-surface-base">
        <span className="text-[11px] font-mono" style={{ color: '#888' }}>
          Navigation tracker unavailable.
        </span>
      </div>
    );
  }

  const activeTrip = currentTripLocal || (detection.pendingTripId ? currentTrip : null);

  return (
    <div className="flex flex-col h-full bg-surface-base relative">
      {/* #76 Brightness/dim overlay for night driving — non-interactive, above
          map content, below interactive chrome (chrome is z-[1000]+). */}
      {prefs.brightness < 1 && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: '#000',
            opacity: (1 - prefs.brightness) * 0.6,
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
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-subtle text-[10px] font-mono" style={{ background: '#0a0a0a' }}>
        <span style={{ color: gps.isTracking ? '#22c55e' : '#ef4444' }}>
          {gps.isTracking ? 'GPS ON' : 'GPS OFF'}
        </span>
        {gps.latitude && gps.longitude && (
          <span className="text-rmpg-400">
            {gps.latitude.toFixed(5)}, {gps.longitude.toFixed(5)}
          </span>
        )}
        {gps.accuracy != null && (
          <span className="text-rmpg-500">±{Math.round(gps.accuracy)}m</span>
        )}
        {gps.unitCallSign ? (
          <span style={{ color: '#d4a017' }}>{gps.unitCallSign} · ON DUTY</span>
        ) : hasTakeHome ? (
          <span style={{ color: '#22c55e' }}>TAKE-HOME · TRACKING ACTIVE</span>
        ) : gps.isTracking ? (
          <span className="text-rmpg-500">GPS ONLY · Set take-home vehicle to log trips</span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          {/* #75 Offline / stale-fix status chip */}
          {(() => {
            const map = {
              fresh: { label: 'LIVE', color: '#22c55e', border: '#1a3a1a', Icon: Satellite },
              stale: { label: 'STALE', color: '#f59e0b', border: '#3a2e0a', Icon: Satellite },
              offline: { label: 'OFFLINE', color: '#ef4444', border: '#3a1a1a', Icon: WifiOff },
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
          {/* #81 Gear / settings */}
          <button
            type="button"
            aria-label="Navigation settings"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((o) => !o)}
            className="flex items-center justify-center rounded-sm border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d4a017]"
            style={{
              width: 24, height: 22,
              borderColor: settingsOpen ? '#d4a017' : '#222',
              color: settingsOpen ? '#d4a017' : '#888',
              background: settingsOpen ? 'rgba(212,160,23,0.10)' : 'transparent',
            }}
            title="Navigation settings"
          >
            <Settings size={12} />
          </button>
          <Link
            to="/navigation"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm border border-subtle hover:border-strong transition-colors"
            style={{ color: '#d4a017' }}
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
          <div className="flex items-center justify-between mt-1 text-[9px] font-mono">
            <span style={{ color: '#888' }}>
              <Pin size={9} className="inline" /> {droppedPins.length} pin{droppedPins.length === 1 ? '' : 's'} on map
            </span>
            <button
              type="button"
              onClick={() => setDroppedPins([])}
              className="flex items-center gap-1 hover:underline"
              style={{ color: '#888' }}
            >
              <Trash2 size={9} /> Clear pins
            </button>
          </div>
        )}

        {/* #84 Layer-toggle active-state visual sync — reads/writes prefs.layers
            so persisted layers reflect correctly after reload (gold-filled =
            active). These mirror the Drive-Mode layer set on this surface. */}
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
                className="px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded-sm border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d4a017]"
                style={{
                  minHeight: 22,
                  borderColor: active ? '#d4a017' : '#222',
                  background: active ? '#d4a017' : 'transparent',
                  color: active ? '#000' : '#888',
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
              color: tab === t ? '#d4a017' : '#888888',
              borderBottom: tab === t ? '2px solid #d4a017' : '2px solid transparent',
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
            onEnd={handleEndTrip}
            onRefresh={() => fetchCurrentTrip?.()}
          />
        ) : (
          <HistoryPanel
            trips={tripHistory}
            loading={loading}
            onRefresh={fetchHistory}
            onDownloadAll={handleDownloadAllTrips}
            onDownloadTrip={handleDownloadSingleTrip}
          />
        )}
      </div>

      {/* #74 Acquiring-GPS / no-fix full-screen empty state — shown until the
          first fix arrives, distinct from a hard map/track error. */}
      {!hasFix && (
        <div
          className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-3 px-6 text-center"
          style={{ background: 'rgba(5,5,5,0.92)', backdropFilter: 'blur(2px)' }}
        >
          <Satellite size={36} className={pulseClass} style={{ color: '#d4a017' }} />
          <div className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: '#d4a017' }}>
            Acquiring GPS fix…
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span
              className="px-1.5 py-0.5 rounded-sm border"
              style={{ color: '#888', borderColor: '#222' }}
            >
              {gps.unitCallSign ? 'ON-DUTY GPS' : hasTakeHome ? 'TAKE-HOME GPS' : 'BROWSER GPS'}
            </span>
            {gps.accuracy != null && (
              <span style={{ color: '#888' }}>±{Math.round(gps.accuracy)}m</span>
            )}
          </div>
          <p className="text-[10px] font-mono max-w-xs" style={{ color: '#888' }}>
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
    </div>
  );
}

// ── Current Trip Panel ──────────────────────────────────────

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
    if (!trip || trip.status !== 'active') return;
    const start = new Date(trip.start_time.replace(' ', 'T')).getTime();
    const interval = setInterval(() => {
      setElapsed(Math.round((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [trip]);

  // #77 ETA / arrival readout: derive a live MM:SS countdown when the active
  // trip carries a remaining-ETA estimate, coloring gold→amber→red as it
  // shrinks, with the arrival clock shown in the user's clock pref.
  const etaSeconds = (trip as unknown as { remaining_eta_seconds?: number })?.remaining_eta_seconds;
  const etaView = useMemo(() => {
    if (etaSeconds == null || !isFinite(etaSeconds)) return null;
    const arrival = new Date(Date.now() + etaSeconds * 1000);
    const clock = arrival.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: prefs.clock === '12h',
    });
    const color = etaSeconds <= 60 ? '#ef4444' : etaSeconds <= 300 ? '#f59e0b' : '#d4a017';
    return { countdown: fmtCountdown(etaSeconds), clock, color };
  }, [etaSeconds, prefs.clock]);

  if (trip && (trip.status === 'active' || trip.status === 'pending')) {
    return (
      <div className="space-y-3">
        {/* Active Trip Card */}
        <div className="rounded-sm border border-subtle p-3" style={{ background: trip.status === 'active' ? '#0a2a0a' : '#1a1a0a' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${pulseClass}`} style={{ background: STATUS_COLOR[trip.status] }} />
              <span className="text-[11px] font-semibold uppercase" style={{ color: '#d4a017' }}>
                {STATUS_LABEL[trip.status]} TRIP
              </span>
            </div>
            <span className="text-[10px] text-rmpg-500">
              {trip.detected_by === 'auto' ? 'Auto-detected' : 'Manual'}
            </span>
          </div>

          {/* Live stats */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="text-center">
              <div className="text-[22px] font-mono font-bold tabular-nums" style={{ color: '#22c55e' }}>
                {trip.status === 'active' ? formatDuration(elapsed) : '--'}
              </div>
              <div className="text-[9px] text-rmpg-500 uppercase">Duration</div>
            </div>
            <div className="text-center">
              <div className="text-[22px] font-mono font-bold tabular-nums" style={{ color: '#d4a017' }}>
                {formatDistance(trip.distance_miles)}
              </div>
              <div className="text-[9px] text-rmpg-500 uppercase">Distance</div>
            </div>
            <div className="text-center">
              <div className="text-[22px] font-mono font-bold tabular-nums" style={{ color: '#ef4444' }}>
                {trip.max_speed_mph ? `${Math.round(trip.max_speed_mph)}` : '--'}
                <span className="text-[10px] ml-0.5" style={{ color: '#888' }}>mph</span>
              </div>
              <div className="text-[9px] text-rmpg-500 uppercase">Max Speed</div>
            </div>
          </div>

          {/* #77 ETA / arrival readout — live countdown + late band. Only
              rendered when the active trip carries a remaining-ETA estimate. */}
          {etaView && (
            <div
              className="flex items-center justify-between mb-3 px-2 py-1.5 rounded-sm border"
              style={{ borderColor: '#222', background: '#050505' }}
            >
              <div className="flex items-center gap-1.5">
                <Clock size={11} style={{ color: etaView.color }} />
                <span className="text-[16px] font-mono font-bold tabular-nums" style={{ color: etaView.color }}>
                  {etaView.countdown}
                </span>
                <span className="text-[9px] uppercase" style={{ color: '#888' }}>to arrival</span>
              </div>
              <span className="text-[11px] font-mono tabular-nums" style={{ color: '#e0e0e0' }}>
                ETA {etaView.clock}
              </span>
            </div>
          )}

          {/* Trip details */}
          <div className="space-y-1 text-[10px] font-mono">
            <div className="flex justify-between">
              <span className="text-rmpg-500">Start</span>
              <span style={{ color: '#e0e0e0' }}>
                {trip.start_location || `${trip.start_lat.toFixed(4)}, ${trip.start_lng.toFixed(4)}`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-rmpg-500">Time</span>
              <span style={{ color: '#e0e0e0' }}>{trip.start_time}</span>
            </div>
            {trip.vehicle_number && (
              <div className="flex justify-between">
                <span className="text-rmpg-500">Vehicle</span>
                <span style={{ color: '#d4a017' }}>
                  {trip.vehicle_number} — {trip.make} {trip.model}
                </span>
              </div>
            )}
            {trip.unit_call_sign && (
              <div className="flex justify-between">
                <span className="text-rmpg-500">Unit</span>
                <span style={{ color: '#d4a017' }}>{trip.unit_call_sign}</span>
              </div>
            )}
            {trip.route_points && Array.isArray(trip.route_points) && (
              <div className="flex justify-between">
                <span className="text-rmpg-500">Breadcrumbs</span>
                <span style={{ color: '#e0e0e0' }}>{trip.route_points.length} points</span>
              </div>
            )}
          </div>
        </div>

        {/* End Trip Button — FAB style */}
        <button
          onClick={onEnd}
          className="w-full py-3 rounded-sm text-[12px] font-semibold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
          style={{ background: '#ef4444', color: '#fff' }}
        >
          <Square size={14} /> End Trip
        </button>

        <div className="grid grid-cols-2 gap-2">
          <Link
            to="/navigation"
            className="py-2 rounded-sm text-[10px] font-mono uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
            style={{ background: '#141414', color: '#d4a017', border: '1px solid #222' }}
          >
            <Compass size={11} /> Drive Mode
          </Link>
          <button
            onClick={onRefresh}
            className="py-2 rounded-sm text-[10px] font-mono uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
            style={{ background: '#141414', color: '#888', border: '1px solid #222' }}
          >
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>
    );
  }

  // No active trip — show start screen
  return (
    <div className="space-y-3">
      {/* Status Card */}
      <div className="rounded-sm border border-subtle p-3" style={{ background: '#0a0a0a' }}>
        <div className="flex items-center gap-2 mb-2">
          {gps.isTracking ? (
            <CheckCircle size={14} style={{ color: '#22c55e' }} />
          ) : (
            <AlertTriangle size={14} style={{ color: '#ef4444' }} />
          )}
          <span className="text-[11px] font-semibold uppercase" style={{ color: '#d4a017' }}>Status</span>
        </div>
        <div className="space-y-1 text-[10px] font-mono">
          <div className="flex justify-between">
            <span className="text-rmpg-500">GPS</span>
            <span style={{ color: gps.isTracking ? '#22c55e' : '#ef4444' }}>
              {gps.isTracking ? 'Tracking' : 'Acquiring...'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-rmpg-500">Position</span>
            <span style={{ color: '#e0e0e0' }}>
              {gps.latitude ? `${gps.latitude.toFixed(5)}, ${gps.longitude?.toFixed(5)}` : 'No fix'}
            </span>
          </div>
          {gps.speed != null && (
            <div className="flex justify-between">
              <span className="text-rmpg-500">Speed</span>
              <span style={{ color: '#e0e0e0' }}>{Math.round(gps.speed * 2.237)} mph</span>
            </div>
          )}
          {detection.loginPosition && (
            <div className="flex justify-between">
              <span className="text-rmpg-500">Login</span>
              <span style={{ color: '#e0e0e0' }}>
                {detection.loginPosition.lat.toFixed(4)}, {detection.loginPosition.lng.toFixed(4)}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-rmpg-500">Vehicle</span>
            <span style={{ color: gps.unitCallSign ? '#d4a017' : (hasTakeHome ? '#22c55e' : '#888') }}>
              {gps.unitCallSign
                ? `${gps.unitCallSign} (on duty)`
                : hasTakeHome
                  ? 'Take-home (no duty required)'
                  : 'Set take-home in profile to track'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-rmpg-500">Detection</span>
            <span style={{ color: detection.movementConfirmed ? '#22c55e' : '#f59e0b' }}>
              {detection.movementConfirmed ? 'Movement confirmed' : 'Monitoring...'}
            </span>
          </div>
        </div>
      </div>

      {/* Start Trip Button — big and prominent, enabled for take-home */}
      <button
        onClick={onStart}
        disabled={!gps.latitude || (!gps.unitCallSign && !hasTakeHome)}
        className="w-full py-3 rounded-sm text-[13px] font-semibold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: '#d4a017', color: '#000' }}
      >
        <Play size={16} /> Start Trip Now
      </button>

      {!gps.isTracking && (
        <div className="rounded-sm border border-subtle p-2 text-center" style={{ background: '#1a0a0a' }}>
          <p className="text-[10px]" style={{ color: '#ef4444' }}>
            GPS not tracking — waiting for position fix.
          </p>
        </div>
      )}

      {!gps.unitCallSign && !hasTakeHome && (
        <div className="rounded-sm border border-subtle p-2 text-center" style={{ background: '#141414' }}>
          <p className="text-[10px]" style={{ color: '#888' }}>
            Set a take-home vehicle on the Shift card to log trips without going on-duty.
          </p>
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-2">
        <Link
          to="/navigation"
          className="py-2 rounded-sm text-[10px] font-mono uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
          style={{ background: '#141414', color: '#d4a017', border: '1px solid #222' }}
        >
          <Compass size={11} /> Drive Mode
        </Link>
        <button
          onClick={onRefresh}
          className="py-2 rounded-sm text-[10px] font-mono uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
          style={{ background: '#141414', color: '#888', border: '1px solid #222' }}
        >
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      {/* Hint card */}
      <div className="rounded-sm border border-subtle p-2.5" style={{ background: '#0a0a0a' }}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Footprints size={10} style={{ color: '#d4a017' }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#d4a017' }}>
            How detection works
          </span>
        </div>
        <ul className="text-[9px] font-mono space-y-0.5" style={{ color: '#888' }}>
          <li>• Auto-starts when you move &gt;200ft from your login location (10s confirmation)</li>
          <li>• Use the Start button above for immediate trip logging</li>
          <li>• Trips are recorded with or without going on-duty (take-home works too)</li>
          <li>• Use the mini-map above to recenter, switch style, or drop a pin</li>
        </ul>
      </div>
    </div>
  );
}

// ── History Panel ───────────────────────────────────────────

function HistoryPanel({
  trips, loading, onRefresh, onDownloadAll, onDownloadTrip,
}: {
  trips: NavTrip[];
  loading: boolean;
  onRefresh: () => void;
  onDownloadAll: () => void;
  onDownloadTrip: (trip: NavTrip) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin" style={{ color: '#d4a017' }} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-rmpg-500 uppercase">{trips.length} trips</span>
        <div className="flex items-center gap-2">
          {trips.length > 0 && (
            <button
              onClick={onDownloadAll}
              className="flex items-center gap-1 text-[10px] transition-colors px-1.5 py-0.5 border border-subtle rounded-sm"
              style={{ color: '#d4a017' }}
              title="Download PDF report of all trips"
            >
              <FileText size={11} /> PDF Report
            </button>
          )}
          <button
            onClick={onRefresh}
            className="flex items-center gap-1 text-[10px] transition-colors"
            style={{ color: '#888888' }}
          >
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>

      {trips.length === 0 ? (
        <div className="rounded-sm border border-subtle p-6 text-center" style={{ background: '#0a0a0a' }}>
          <Route size={24} className="mx-auto mb-2" style={{ color: '#333' }} />
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
            style={{ background: '#0a0a0a' }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_COLOR[trip.status] }} />
                <span className="text-[11px] font-semibold" style={{ color: '#e0e0e0' }}>
                  {formatDistance(trip.distance_miles)}
                </span>
                <span className="text-[9px] font-mono" style={{ color: STATUS_COLOR[trip.status] }}>
                  {STATUS_LABEL[trip.status]}
                </span>
              </div>
              <span className="text-[9px] text-rmpg-500">{timeAgo(trip.start_time)}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-[9px] font-mono">
              <div>
                <span className="text-rmpg-500">Duration</span>
                <div style={{ color: '#e0e0e0' }}>{formatDuration(trip.duration_seconds)}</div>
              </div>
              <div>
                <span className="text-rmpg-500">Max Speed</span>
                <div style={{ color: '#e0e0e0' }}>
                  {trip.max_speed_mph ? `${Math.round(trip.max_speed_mph)} mph` : '--'}
                </div>
              </div>
              <div>
                <span className="text-rmpg-500">Type</span>
                <div style={{ color: '#e0e0e0' }}>{trip.detected_by === 'auto' ? 'Auto' : 'Manual'}</div>
              </div>
            </div>

            {trip.vehicle_number && (
              <div className="mt-1.5 text-[9px] font-mono flex justify-between">
                <span className="text-rmpg-500">Vehicle</span>
                <span style={{ color: '#d4a017' }}>
                  {trip.vehicle_number} — {trip.make} {trip.model}
                </span>
              </div>
            )}

            <div className="mt-1 text-[9px] font-mono flex justify-between">
              <span className="text-rmpg-500">Route</span>
              <span style={{ color: '#888' }}>
                {trip.start_location || `${trip.start_lat.toFixed(4)}, ${trip.start_lng.toFixed(4)}`}
                {trip.end_lat && ` → ${trip.end_location || `${trip.end_lat.toFixed(4)}, ${trip.end_lng?.toFixed(4)}`}`}
              </span>
            </div>

            {trip.status === 'completed' && (
              <div className="mt-1.5 flex justify-end gap-1.5">
                <button
                  onClick={() => onDownloadTrip(trip)}
                  className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 border border-subtle rounded-sm transition-colors hover:border-strong"
                  style={{ color: '#d4a017' }}
                  title="Download this trip as a PDF report"
                >
                  <Download size={9} /> Trip PDF
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
