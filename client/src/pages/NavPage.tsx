import { useState, useEffect, useCallback } from 'react';
import {
  Navigation, MapPin, Clock, Route, Car, Play, Square, History,
  Gauge, Footprints, AlertTriangle, CheckCircle, Loader2, RefreshCw,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { useNavTripDetection } from '../hooks/useNavTripDetection';
import { useIsMobile } from '../hooks/useIsMobile';
import PanelTitleBar from '../components/PanelTitleBar';
import type { NavTrip, NavTripStatus } from '../types';

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
  return `${miles.toFixed(1)} mi`;
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

export default function NavPage() {
  const isMobile = useIsMobile();
  const gps = useGpsTracking({ upload: true });
  const [tab, setTab] = useState<'current' | 'history'>('current');

  // ── Nav detection hook ────────────────────────────────────
  const {
    detection,
    currentTrip,
    hasTakeHome,
    startManualTrip,
    endCurrentTrip,
    fetchCurrentTrip,
  } = useNavTripDetection({
    position: gps.latitude && gps.longitude
      ? { latitude: gps.latitude, longitude: gps.longitude, accuracy: gps.accuracy }
      : null,
    isTracking: gps.isTracking,
    isForeground: true,
    onTripStarted: (trip) => setCurrentTripLocal(trip),
    onTripEnded: () => fetchHistory(),
  });

  const [currentTripLocal, setCurrentTripLocal] = useState<NavTrip | null>(null);
  const [tripHistory, setTripHistory] = useState<NavTrip[]>([]);
  const [loading, setLoading] = useState(false);

  // Sync current trip
  useEffect(() => {
    if (currentTrip) setCurrentTripLocal(currentTrip);
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

  // ── Manual start ──────────────────────────────────────────
  const handleManualStart = () => {
    if (gps.latitude && gps.longitude) {
      startManualTrip(gps.latitude, gps.longitude, gps.accuracy);
    }
  };

  // ── End trip ──────────────────────────────────────────────
  const handleEndTrip = () => {
    endCurrentTrip(gps.latitude, gps.longitude);
  };

  const activeTrip = currentTripLocal || (detection.pendingTripId ? currentTrip : null);

  return (
    <div className="flex flex-col h-full bg-surface-base">
      <PanelTitleBar title="NAVIGATION" icon={Navigation} statusLed={gps.isTracking ? 'bg-emerald-400' : 'bg-red-400'} ledPulse={gps.isTracking} />

      {/* GPS Status Bar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-subtle text-[10px] font-mono" style={{ background: '#0a0a0a' }}>
        <span style={{ color: gps.isTracking ? '#22c55e' : '#ef4444' }}>
          {gps.isTracking ? 'GPS ON' : 'GPS OFF'}
        </span>
        {gps.latitude && (
          <span className="text-rmpg-400">
            {gps.latitude.toFixed(5)}, {gps.longitude.toFixed(5)}
          </span>
        )}
        {gps.accuracy != null && (
          <span className="text-rmpg-500">±{Math.round(gps.accuracy)}m</span>
        )}
        {gps.unitCallSign && (
          <span style={{ color: '#d4a017' }}>{gps.unitCallSign}</span>
        )}
        {hasTakeHome && !gps.unitCallSign && (
          <span style={{ color: '#22c55e' }}>Take-Home Vehicle</span>
        )}
        {!gps.unitCallSign && !hasTakeHome && (
          <span className="text-rmpg-500">No unit assigned — go on-duty to log trips</span>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-subtle">
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
            onStart={handleManualStart}
            onEnd={handleEndTrip}
            onRefresh={fetchCurrentTrip}
          />
        ) : (
          <HistoryPanel trips={tripHistory} loading={loading} onRefresh={fetchHistory} />
        )}
      </div>
    </div>
  );
}

// ── Current Trip Panel ──────────────────────────────────────

function CurrentTripPanel({
  trip, detection, gps, hasTakeHome, onStart, onEnd, onRefresh,
}: {
  trip: NavTrip | null;
  detection: ReturnType<typeof useNavTripDetection>['detection'];
  gps: ReturnType<typeof useGpsTracking>;
  hasTakeHome: boolean;
  onStart: () => void;
  onEnd: () => void;
  onRefresh: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!trip || trip.status !== 'active') return;
    const start = new Date(trip.start_time.replace(' ', 'T')).getTime();
    const interval = setInterval(() => {
      setElapsed(Math.round((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [trip]);

  if (trip && (trip.status === 'active' || trip.status === 'pending')) {
    return (
      <div className="space-y-3">
        {/* Active Trip Card */}
        <div className="rounded-sm border border-subtle p-3" style={{ background: trip.status === 'active' ? '#0a2a0a' : '#1a1a0a' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: STATUS_COLOR[trip.status] }} />
              <span className="text-[11px] font-semibold uppercase" style={{ color: '#d4a017' }}>
                {STATUS_LABEL[trip.status]} TRIP
              </span>
            </div>
            <span className="text-[10px] text-rmpg-500">
              {trip.detected_by === 'auto' ? 'Auto-detected' : 'Manual'}
            </span>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="text-center">
              <div className="text-[20px] font-mono font-bold" style={{ color: '#e0e0e0' }}>
                {trip.status === 'active' ? formatDuration(elapsed) : '--'}
              </div>
              <div className="text-[9px] text-rmpg-500 uppercase">Duration</div>
            </div>
            <div className="text-center">
              <div className="text-[20px] font-mono font-bold" style={{ color: '#e0e0e0' }}>
                {formatDistance(trip.distance_miles)}
              </div>
              <div className="text-[9px] text-rmpg-500 uppercase">Distance</div>
            </div>
            <div className="text-center">
              <div className="text-[20px] font-mono font-bold" style={{ color: '#e0e0e0' }}>
                {trip.max_speed_mph ? `${Math.round(trip.max_speed_mph)} mph` : '--'}
              </div>
              <div className="text-[9px] text-rmpg-500 uppercase">Max Speed</div>
            </div>
          </div>

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

        {/* End Trip Button */}
        <button
          onClick={onEnd}
          className="w-full py-2 rounded-sm text-[11px] font-semibold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors"
          style={{ background: '#ef4444', color: '#fff' }}
        >
          <Square size={14} /> End Trip
        </button>

        <button
          onClick={onRefresh}
          className="w-full py-1.5 rounded-sm text-[10px] flex items-center justify-center gap-1 transition-colors"
          style={{ background: '#141414', color: '#888888', border: '1px solid #222222' }}
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
    );
  }

  // No active trip — show start screen
  return (
    <div className="space-y-3">
      {/* Detection Status */}
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
          {detection.loginPosition && (
            <div className="flex justify-between">
              <span className="text-rmpg-500">Login Location</span>
              <span style={{ color: '#e0e0e0' }}>
                {detection.loginPosition.lat.toFixed(4)}, {detection.loginPosition.lng.toFixed(4)}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-rmpg-500">Unit</span>
            <span style={{ color: gps.unitCallSign ? '#d4a017' : (hasTakeHome ? '#22c55e' : '#ef4444') }}>
              {gps.unitCallSign || (hasTakeHome ? 'Take-Home Vehicle' : 'Not on duty')}
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

      {/* Start Trip Button */}
      <button
        onClick={onStart}
        disabled={!gps.latitude}
        className="w-full py-2 rounded-sm text-[11px] font-semibold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
        style={{ background: '#d4a017', color: '#000' }}
      >
        <Play size={14} /> Start Trip Now
      </button>

      {!gps.isTracking && (
        <div className="rounded-sm border border-subtle p-2 text-center" style={{ background: '#1a0a0a' }}>
          <p className="text-[10px]" style={{ color: '#ef4444' }}>
            GPS not tracking — waiting for position fix.
          </p>
        </div>
      )}

      <button
        onClick={onRefresh}
        className="w-full py-1.5 rounded-sm text-[10px] flex items-center justify-center gap-1 transition-colors"
        style={{ background: '#141414', color: '#888888', border: '1px solid #222222' }}
      >
        <RefreshCw size={12} /> Refresh
      </button>
    </div>
  );
}

// ── History Panel ───────────────────────────────────────────

function HistoryPanel({ trips, loading, onRefresh }: { trips: NavTrip[]; loading: boolean; onRefresh: () => void }) {
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
        <button
          onClick={onRefresh}
          className="flex items-center gap-1 text-[10px] transition-colors"
          style={{ color: '#888888' }}
        >
          <RefreshCw size={11} /> Refresh
        </button>
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
                <div style={{ color: '#e0e0e0' }}>{trip.max_speed_mph ? `${Math.round(trip.max_speed_mph)} mph` : '--'}</div>
              </div>
              <div>
                <span className="text-rmpg-500">Type</span>
                <div style={{ color: '#e0e0e0' }}>{trip.detected_by === 'auto' ? 'Auto' : 'Manual'}</div>
              </div>
            </div>

            {trip.vehicle_number && (
              <div className="mt-1.5 text-[9px] font-mono flex justify-between">
                <span className="text-rmpg-500">Vehicle</span>
                <span style={{ color: '#d4a017' }}>{trip.vehicle_number} — {trip.make} {trip.model}</span>
              </div>
            )}

            <div className="mt-1 text-[9px] font-mono flex justify-between">
              <span className="text-rmpg-500">Route</span>
              <span style={{ color: '#888' }}>
                {trip.start_location || `${trip.start_lat.toFixed(4)}, ${trip.start_lng.toFixed(4)}`}
                {trip.end_lat && ` → ${trip.end_location || `${trip.end_lat.toFixed(4)}, ${trip.end_lng?.toFixed(4)}`}`}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
