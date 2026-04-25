import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Phone,
  Users,
  FileText,
  Clock,
  AlertTriangle,
  Plus,
  LogIn,
  Activity,
  Shield,
  Loader2,
  Radio,
  MapPin,
  Eye,
  ArrowRight,
  TrendingUp,
  Gavel,
  Briefcase,
  Target,
  CheckCircle,
  XCircle,
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudDrizzle,
  CloudFog,
  Snowflake,
  Timer,
  Navigation,
  Mail,
  Zap,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area, PieChart, Pie,
} from 'recharts';
import type { DashboardStats, ActivityLogEntry, BOLO } from '../types';
import StatsCard from '../components/StatsCard';
import ActivityFeed from '../components/ActivityFeed';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import { StatsCardSkeleton, CardSkeleton } from '../components/Skeleton';
import NewCallModal from '../components/NewCallModal';
import IncidentFormModal from '../components/IncidentFormModal';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';

// ─── Backend Response Types ──────────────────────────────

interface PsoStats {
  activeCalls: number;
  todayCalls: number;
  monthCalls: number;
  monthCompleted: number;
  avgResponseMinutes: number | null;
  avgAttempts: number | null;
  serveResults: {
    total: number;
    served: number;
    notServed: number;
    refused: number;
    pendingResult: number;
  };
  byServiceType: { pso_service_type: string; count: number }[];
  serveManager: { totalJobs: number; pendingJobs: number; completedJobs: number };
}

interface DashboardApiResponse {
  activeCalls: number;
  todayCalls: number;
  unitsOnDuty: number;
  totalUnits: number;
  pendingReports: number;
  activeBolos: number;
  unreadMessages: number;
  avgResponseMinutes: number | null;
  callsByPriority: { priority: string; count: number }[];
  callsByStatus: { status: string; count: number }[];
  recentActivity: unknown[];
  officersOnDuty: unknown[];
  callsByHour: { hour: string; count: number }[];
  pso?: PsoStats;
}

interface ActivityApiEntry {
  id: number | string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | number | null;
  details: string | null;
  ip_address: string | null;
  created_at: string;
  user_name: string | null;
  badge_number: string | null;
  user_role: string | null;
}

interface BoloApiEntry {
  id: number | string;
  bolo_number: string;
  type: string;
  status: string;
  title: string;
  description: string | null;
  subject_description: string | null;
  vehicle_description: string | null;
  photo_url: string | null;
  priority: string;
  issued_by: string;
  issued_by_name: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at?: string;
}

// ─── Mapper Functions ────────────────────────────────────

function mapDashboardStats(raw: DashboardApiResponse): DashboardStats {
  // Build calls_by_priority from the array
  const priorityMap: Record<string, number> = {};
  for (const entry of raw.callsByPriority ?? []) {
    priorityMap[entry.priority] = entry.count;
  }

  // Build calls_by_hour, converting string hour to number
  const callsByHour = (raw.callsByHour ?? []).map((entry) => ({
    hour: typeof entry.hour === 'string' ? (parseInt(entry.hour, 10) || 0) : (entry.hour ?? 0),
    count: entry.count ?? 0,
  }));

  // Fill in missing hours with zero counts
  const hourMap = new Map(callsByHour.map((h) => [h.hour, h.count]));
  const fullCallsByHour = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    count: hourMap.get(i) ?? 0,
  }));

  // Count incidents_today from callsByStatus (submitted + under_review items are pending reports)
  // The backend doesn't return incidents_today directly, so we default to pendingReports
  const incidentsToday = raw.pendingReports ?? 0;

  return {
    active_calls: raw.activeCalls ?? 0,
    calls_by_priority: {
      P1: priorityMap['P1'] ?? 0,
      P2: priorityMap['P2'] ?? 0,
      P3: priorityMap['P3'] ?? 0,
      P4: priorityMap['P4'] ?? 0,
    },
    units_available: raw.unitsOnDuty ?? 0,
    units_total: raw.totalUnits ?? 0,
    open_incidents: raw.pendingReports ?? 0,
    avg_response_time_minutes: raw.avgResponseMinutes ?? 0,
    calls_today: raw.todayCalls ?? 0,
    incidents_today: incidentsToday,
    active_bolos: raw.activeBolos ?? 0,
    officers_on_duty: Array.isArray(raw.officersOnDuty)
      ? raw.officersOnDuty.length
      : 0,
    calls_by_hour: fullCallsByHour,
  };
}

function mapActivityEntry(raw: ActivityApiEntry): ActivityLogEntry {
  return {
    id: String(raw.id),
    action: raw.action as ActivityLogEntry['action'],
    description: raw.details ?? '',
    user_id: raw.user_id ?? undefined,
    user_name: raw.user_name ?? undefined,
    entity_type: raw.entity_type ?? undefined,
    entity_id: raw.entity_id != null ? String(raw.entity_id) : undefined,
    timestamp: raw.created_at,
  };
}

function mapBoloEntry(raw: BoloApiEntry): BOLO {
  return {
    id: String(raw.id),
    bolo_number: raw.bolo_number,
    type: raw.type as BOLO['type'],
    status: raw.status as BOLO['status'],
    title: raw.title,
    description: raw.description ?? '',
    priority: raw.priority as BOLO['priority'],
    subject_description: raw.subject_description ?? undefined,
    vehicle_description: raw.vehicle_description ?? undefined,
    issued_by: raw.issued_by_name ?? String(raw.issued_by),
    issued_at: raw.created_at,
    expires_at: raw.expires_at ?? undefined,
    created_at: raw.created_at,
    updated_at: raw.updated_at ?? raw.created_at,
  };
}

// ─── Default Stats (used while loading / on error) ───────

const DEFAULT_STATS: DashboardStats = {
  active_calls: 0,
  calls_by_priority: { P1: 0, P2: 0, P3: 0, P4: 0 },
  units_available: 0,
  units_total: 0,
  open_incidents: 0,
  avg_response_time_minutes: 0,
  calls_today: 0,
  incidents_today: 0,
  active_bolos: 0,
  officers_on_duty: 0,
  calls_by_hour: Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 })),
};

// ─── Weather Helpers ─────────────────────────────────────

interface WeatherData {
  temperature: number;
  weatherCode: number;
  description: string;
  icon: React.ComponentType<any>;
  humidity?: number;
  windSpeed?: number;
  windDirection?: number;
}

function getWeatherInfo(code: number): { description: string; icon: React.ComponentType<any> } {
  // WMO Weather interpretation codes (WW)
  if (code === 0) return { description: 'Clear sky', icon: Sun };
  if (code === 1) return { description: 'Mainly clear', icon: Sun };
  if (code === 2) return { description: 'Partly cloudy', icon: Cloud };
  if (code === 3) return { description: 'Overcast', icon: Cloud };
  if (code >= 45 && code <= 48) return { description: 'Foggy', icon: CloudFog };
  if (code >= 51 && code <= 55) return { description: 'Drizzle', icon: CloudDrizzle };
  if (code >= 56 && code <= 57) return { description: 'Freezing drizzle', icon: CloudDrizzle };
  if (code >= 61 && code <= 65) return { description: 'Rain', icon: CloudRain };
  if (code >= 66 && code <= 67) return { description: 'Freezing rain', icon: CloudRain };
  if (code >= 71 && code <= 77) return { description: 'Snow', icon: CloudSnow };
  if (code >= 80 && code <= 82) return { description: 'Rain showers', icon: CloudRain };
  if (code >= 85 && code <= 86) return { description: 'Snow showers', icon: CloudSnow };
  if (code >= 95 && code <= 99) return { description: 'Thunderstorm', icon: CloudLightning };
  return { description: 'Unknown', icon: Cloud };
}

// ─── Shift Helpers ───────────────────────────────────────

interface ShiftInfo {
  name: string;
  startHour: number;
  endHour: number;
  startLabel: string;
  endLabel: string;
  elapsed: number; // seconds into shift
  remaining: number; // seconds left
  progress: number; // 0-1
}

function getCurrentShift(): ShiftInfo {
  // Get current Mountain Time
  const now = new Date();
  const mt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Denver' }));
  const hour = mt.getHours();
  const min = mt.getMinutes();
  const sec = mt.getSeconds();
  const currentSeconds = hour * 3600 + min * 60 + sec;

  // Shifts: Day 0600-1400, Swing 1400-2200, Night 2200-0600
  let name: string, startHour: number, endHour: number;
  if (hour >= 6 && hour < 14) {
    name = 'Day Shift'; startHour = 6; endHour = 14;
  } else if (hour >= 14 && hour < 22) {
    name = 'Swing Shift'; startHour = 14; endHour = 22;
  } else {
    name = 'Night Shift'; startHour = 22; endHour = 6;
  }

  const shiftDuration = 8 * 3600; // 8 hours in seconds
  const startSeconds = startHour * 3600;

  let elapsed: number;
  if (name === 'Night Shift') {
    // Night shift wraps past midnight
    if (hour >= 22) {
      elapsed = currentSeconds - 22 * 3600;
    } else {
      elapsed = currentSeconds + (24 * 3600 - 22 * 3600);
    }
  } else {
    elapsed = currentSeconds - startSeconds;
  }

  const remaining = Math.max(0, shiftDuration - elapsed);
  const progress = Math.min(1, elapsed / shiftDuration);

  const fmt = (h: number) => {
    const suffix = h >= 12 ? 'PM' : 'AM';
    const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${String(display).padStart(2, '0')}:00 ${suffix}`;
  };

  return {
    name,
    startHour,
    endHour,
    startLabel: fmt(startHour),
    endLabel: fmt(endHour),
    elapsed,
    remaining,
    progress,
  };
}

function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Component ───────────────────────────────────────────

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [activities, setActivities] = useState<ActivityLogEntry[]>([]);
  const [bolos, setBolos] = useState<BOLO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expiringCredentials, setExpiringCredentials] = useState<any[]>([]);
  const [activeWarrants, setActiveWarrants] = useState(0);
  const [officerActivity, setOfficerActivity] = useState<{ id: number; full_name: string; badge_number: string; role: string; action_count: number }[]>([]);
  const [psoStats, setPsoStats] = useState<PsoStats | null>(null);
  const [shiftInfo, setShiftInfo] = useState<ShiftInfo>(getCurrentShift);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherFetched, setWeatherFetched] = useState(false);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const [showNewCallModal, setShowNewCallModal] = useState(false);
  const [showIncidentModal, setShowIncidentModal] = useState(false);

  // ═══ Dashboard widget states (Features 31-43) ═══
  const [shiftComparison, setShiftComparison] = useState<any>(null);
  const [clearanceRate, setClearanceRate] = useState<any>(null);
  const [patrolCoverage, setPatrolCoverage] = useState<any>(null);
  const [evidencePending, setEvidencePending] = useState<any>(null);
  const [upcomingCourt, setUpcomingCourt] = useState<any>(null);
  const [overdueReports, setOverdueReports] = useState<any>(null);

  // ═══ NEW: Shift-aware stats, court dates, expiring certs ═══
  const [shiftStats, setShiftStats] = useState<{
    shift_name: string; calls: number; incidents: number; citations: number; patrol_scans: number;
  } | null>(null);
  const [courtDatesCount, setCourtDatesCount] = useState(0);
  const [expiringCertsCount, setExpiringCertsCount] = useState(0);

  // Shift countdown timer — update every second
  useEffect(() => {
    const timer = setInterval(() => setShiftInfo(getCurrentShift()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Weather fetch — refresh every 15 minutes
  const fetchWeather = useCallback(async () => {
    try {
      // Use server proxy to avoid browser CSP/CORS issues with open-meteo.com
      const resp = await apiFetch<any>('/weather');
      const temp = resp?.current?.temperature_2m;
      if (temp == null) { setWeather(null); return; }
      const code = resp?.current?.weather_code ?? 0;
      const info = getWeatherInfo(code);
      setWeather({
        temperature: Math.round(temp),
        weatherCode: code,
        description: info.description,
        icon: info.icon,
        humidity: resp?.current?.relative_humidity_2m ?? undefined,
        windSpeed: resp?.current?.wind_speed_10m ?? undefined,
        windDirection: resp?.current?.wind_direction_10m ?? undefined,
      });
    } catch {
      setWeather(null);
    } finally {
      setWeatherFetched(true);
    }
  }, []);

  useEffect(() => {
    fetchWeather();
    const weatherInterval = setInterval(fetchWeather, 15 * 60 * 1000);
    return () => clearInterval(weatherInterval);
  }, [fetchWeather]);

  const fetchDashboardData = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(null); }

    try {
      const [dashboardRaw, activityRaw, bolosRaw, warrantsRaw] = await Promise.all([
        apiFetch<DashboardApiResponse>('/reports/dashboard'),
        apiFetch<{ data: ActivityApiEntry[] }>('/comms/activity-feed?limit=20').then(r => r?.data ?? []),
        apiFetch<BoloApiEntry[]>('/comms/bolos/active'),
        apiFetch<any>('/warrants?status=active&per_page=1').catch((err) => { console.warn('[Dashboard] warrant fetch failed:', err); return { pagination: { total: 0 } }; }),
      ]);

      setStats(mapDashboardStats(dashboardRaw));
      if (dashboardRaw.pso) setPsoStats(dashboardRaw.pso);
      setActivities((activityRaw ?? []).map(mapActivityEntry));
      setBolos(
        (bolosRaw ?? [])
          .filter((b) => b.status === 'active')
          .map(mapBoloEntry)
      );
      setActiveWarrants(warrantsRaw?.pagination?.total ?? warrantsRaw?.total ?? 0);
    } catch (err) {
      if (!options?.silent) {
        console.error('Dashboard fetch error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      }
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  // Fetch expiring credentials
  const fetchCredentials = useCallback(async () => {
    try {
      const data = await apiFetch<any[]>('/personnel/credentials');
      const now = new Date();
      const sixtyDaysOut = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
      const expiring = (Array.isArray(data) ? data : []).filter((c: any) => {
        if (!c.expiry_date) return false;
        const exp = new Date(c.expiry_date);
        return exp <= sixtyDaysOut;
      });
      setExpiringCredentials(expiring);
    } catch (err) {
      console.warn('[Dashboard] credentials fetch failed:', err);
      setExpiringCredentials([]);
    }
  }, []);

  // Fetch officer activity comparison
  const fetchOfficerActivity = useCallback(async () => {
    try {
      const data = await apiFetch<any[]>('/reports/officer-activity');
      setOfficerActivity(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('[Dashboard] officer activity fetch failed:', err);
      setOfficerActivity([]);
    }
  }, []);

  // ═══ Fetch dashboard widget data (Features 31-43) ═══
  const fetchWidgets = useCallback(async () => {
    const safe = async <T,>(url: string): Promise<T | null> => {
      try { return await apiFetch<T>(url); } catch (err) { console.warn(`[Dashboard] widget fetch failed (${url}):`, err); return null; }
    };
    const [sc, cr, pc, ep, uc, or_, ss, cd, ec] = await Promise.all([
      safe<any>('/reports/shift-comparison'),
      safe<any>('/reports/clearance-rate'),
      safe<any>('/reports/patrol-coverage'),
      safe<any>('/reports/evidence-pending'),
      safe<any>('/reports/upcoming-court'),
      safe<any>('/reports/overdue-reports'),
      safe<any>('/admin/shift-stats'),
      safe<any>('/admin/upcoming-court-dates?days=30'),
      safe<any>('/admin/expiring-certifications?days=30'),
    ]);
    if (sc) setShiftComparison(sc);
    if (cr) setClearanceRate(cr);
    if (pc) setPatrolCoverage(pc);
    if (ep) setEvidencePending(ep);
    if (uc) setUpcomingCourt(uc);
    if (or_) setOverdueReports(or_);
    if (ss) setShiftStats(ss);
    if (cd) setCourtDatesCount(cd.count ?? 0);
    if (ec) setExpiringCertsCount((ec.expiring_count ?? 0) + (ec.expired_count ?? 0));
  }, []);

  useEffect(() => {
    fetchDashboardData();
    fetchCredentials();
    fetchOfficerActivity();
    fetchWidgets();

    // Refresh every 60 seconds (LiveSync handles real-time updates)
    const interval = setInterval(() => { fetchDashboardData({ silent: true }); fetchCredentials(); fetchOfficerActivity(); }, 60_000);
    return () => clearInterval(interval);
  }, [fetchDashboardData, fetchCredentials, fetchOfficerActivity, fetchWidgets]);

  // Live sync — auto-refresh dashboard when ANY module changes (silent to avoid unmounting UI)
  const silentRefreshDashboard = useCallback(() => fetchDashboardData({ silent: true }), [fetchDashboardData]);
  useLiveSync(['dispatch', 'incidents', 'records', 'personnel', 'fleet'], silentRefreshDashboard);

  // Activity feed 30-second auto-refresh
  useEffect(() => {
    let cancelled = false;
    const activityInterval = setInterval(async () => {
      try {
        const activityRaw = await apiFetch<{ data: ActivityApiEntry[] }>('/comms/activity-feed?limit=20');
        if (!cancelled && activityRaw?.data) setActivities(activityRaw.data.map(mapActivityEntry));
      } catch { /* silent */ }
    }, 30_000);
    return () => { cancelled = true; clearInterval(activityInterval); };
  }, []);

  // Format hour labels for chart
  const chartData = stats.calls_by_hour.map((d) => ({
    ...d,
    label: `${d.hour.toString().padStart(2, '0')}:00`,
  }));

  // Set document title
  useEffect(() => { document.title = 'Dashboard \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals (must be before early return to preserve hook order)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowNewCallModal(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const isInitialLoading = loading && stats === DEFAULT_STATS;

  if (isInitialLoading) {
    return (
      <div className="p-4 space-y-4 animate-fade-in" role="status" aria-label="Loading dashboard" aria-busy="true">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <StatsCardSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2"><CardSkeleton /></div>
          <CardSkeleton />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 animate-fade-in" role="main" aria-label="Command and Control Dashboard" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))' }}>
      {/* Portal Header — RMPG Logo + System Title */}
      <div className="panel-beveled bg-surface-base overflow-hidden shadow-lg shadow-black/20">
        <div className={`flex items-center gap-4 ${isMobile ? 'px-3 py-2' : 'px-4 py-3'} relative`}>
          {/* Blue accent line */}
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #1a1a1a, #888888 30%, #888888 70%, #1a1a1a)' }} />
          {!isMobile && <RmpgLogo height={68} />}
          {isMobile && <RmpgLogo height={36} iconOnly />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h1 className={`${isMobile ? 'text-xs' : 'text-sm'} font-bold tracking-wider uppercase text-rmpg-200 select-none`}>
                {isMobile ? 'C&C Dashboard' : 'Command & Control Dashboard'}
              </h1>
              <div className="hidden sm:flex items-center gap-1.5" role="status" aria-label="System status: operational">
                <span className={`led-dot ${stats.active_calls > 0 ? 'led-green animate-led-pulse' : 'led-green'}`} aria-hidden="true" />
                <span className="text-[9px] font-mono font-bold text-green-500 tracking-wider select-none">OPERATIONAL</span>
              </div>
            </div>
            {!isMobile && (
              <p className="text-[9px] tracking-wide mt-0.5 text-rmpg-600 truncate">
                Rocky Mountain Protective Group, LLC &mdash; Resolving today&rsquo;s concerns, to ensure tomorrow&rsquo;s solutions.
              </p>
            )}
          </div>
          <div className="hidden md:flex items-center gap-3 text-[9px] font-mono text-rmpg-600 flex-shrink-0">
            <PrintButton />
            <span className="border-l border-[#2b2b2b] pl-3">{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-900/30 border border-red-700/60 rounded-sm p-2.5 flex items-center justify-between animate-fade-in shadow-md shadow-red-900/20" role="alert" aria-live="assertive">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 animate-pulse" aria-hidden="true" />
            <span className="text-xs text-red-300 font-medium">{error}</span>
          </div>
          <button type="button"
            className="text-xs text-red-400 hover:text-red-200 underline font-bold uppercase tracking-wider transition-colors px-2 py-1 hover:bg-red-900/30 rounded-sm"
            onClick={() => fetchDashboardData()}
          >
            Retry
          </button>
        </div>
      )}

      {/* Stats Cards Row */}
      <div className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3'}`} role="region" aria-label="Key statistics">
        <StatsCard
          icon={Phone}
          label="Active Calls"
          value={stats.active_calls}
          accent="red"
          trendValue={`${stats.calls_today} today`}
          trendColor="gray"
          trend="flat"
          onClick={() => navigate('/dispatch')}
        />
        <StatsCard
          icon={Users}
          label="Units Available"
          value={`${stats.units_available} / ${stats.units_total}`}
          accent="green"
          trendValue={`${stats.officers_on_duty} on duty`}
          trendColor="green"
          trend="flat"
          onClick={() => navigate('/personnel')}
        />
        <StatsCard
          icon={FileText}
          label="Open Incidents"
          value={stats.open_incidents}
          accent="amber"
          trendValue={`${stats.incidents_today} today`}
          trendColor="gray"
          trend="flat"
          onClick={() => navigate('/incidents')}
        />
        <StatsCard
          icon={Clock}
          label="Avg Response"
          value={stats.avg_response_time_minutes ? `${stats.avg_response_time_minutes}m` : 'N/A'}
          accent="blue"
          trendValue={stats.avg_response_time_minutes ? 'within target' : 'no data'}
          trendColor={stats.avg_response_time_minutes ? 'green' : 'gray'}
          trend={stats.avg_response_time_minutes ? 'down' : 'flat'}
          onClick={() => navigate('/reports')}
        />
      </div>

      {/* Secondary Stats Row */}
      <div className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2'}`} role="region" aria-label="Record statistics">
        <div className="panel-beveled bg-surface-base p-2 cursor-pointer hover:bg-surface-raised transition-colors" onClick={() => navigate('/warrants')}>
          <div className="flex items-center gap-2">
            <Gavel className="w-4 h-4 text-red-400" />
            <div>
              <div className="text-lg font-bold font-mono tabular-nums text-white">{stats.active_warrants || 0}</div>
              <div className="text-[9px] text-rmpg-400 uppercase font-bold">Active Warrants</div>
            </div>
          </div>
        </div>
        <div className="panel-beveled bg-surface-base p-2 cursor-pointer hover:bg-surface-raised transition-colors" onClick={() => navigate('/serve')}>
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-amber-400" />
            <div>
              <div className="text-lg font-bold font-mono tabular-nums text-white">{stats.pending_serve || 0}</div>
              <div className="text-[9px] text-rmpg-400 uppercase font-bold">Pending Serve</div>
            </div>
          </div>
        </div>
        <div className="panel-beveled bg-surface-base p-2 cursor-pointer hover:bg-surface-raised transition-colors" onClick={() => navigate('/cases')}>
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-purple-400" />
            <div>
              <div className="text-lg font-bold font-mono tabular-nums text-white">{stats.open_cases || 0}</div>
              <div className="text-[9px] text-rmpg-400 uppercase font-bold">Open Cases</div>
            </div>
          </div>
        </div>
        <div className="panel-beveled bg-surface-base p-2 cursor-pointer hover:bg-surface-raised transition-colors" onClick={() => navigate('/records')}>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-gray-400" />
            <div>
              <div className="text-lg font-bold font-mono tabular-nums text-white">{stats.total_persons || 0}</div>
              <div className="text-[9px] text-rmpg-400 uppercase font-bold">Total Persons</div>
            </div>
          </div>
        </div>
      </div>

      {/* Priority Breakdown — Clickable beveled panels with LED dots */}
      <div className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2'}`} role="region" aria-label="Calls by priority">
        {[
          { key: 'P1', label: 'P1 Emerg', labelFull: 'P1 Emergency', led: 'led-red', border: 'border-l-red-500', count: stats.calls_by_priority.P1, valueColor: '#dc2626' },
          { key: 'P2', label: 'P2 Urgent', labelFull: 'P2 Urgent', led: 'led-amber', border: 'border-l-amber-500', count: stats.calls_by_priority.P2, valueColor: '#f59e0b' },
          { key: 'P3', label: 'P3 Routine', labelFull: 'P3 Routine', led: 'led-blue', border: 'border-l-brand-500', count: stats.calls_by_priority.P3, valueColor: '#888888' },
          { key: 'P4', label: 'P4 Sched', labelFull: 'P4 Scheduled', led: 'led-off', border: 'border-l-gray-500', count: stats.calls_by_priority.P4, valueColor: '#555555' },
        ].map(({ key, label, labelFull, led, border, count, valueColor }) => (
          <div
            key={key}
            onClick={() => navigate('/dispatch')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/dispatch'); }}
            tabIndex={0}
            role="button"
            className={`flex items-center gap-3 ${isMobile ? 'p-3 min-h-[56px]' : 'p-2'} panel-beveled border-l-4 ${border} cursor-pointer hover:bg-surface-raised hover:shadow-md hover:shadow-black/15 hover:-translate-y-px active:translate-y-0 transition-all duration-150 group bg-surface-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50`}
            title={`View ${key} calls in Dispatch`}
            aria-label={`${label}: ${count} calls`}
          >
            <span className={`led-dot ${led} ${count > 0 && key === 'P1' ? 'animate-led-pulse' : ''}`} />
            <div className="flex-1 min-w-0">
              <div className={`${isMobile ? 'text-2xl' : 'text-lg'} font-bold font-mono tabular-nums`} style={{ color: valueColor }}>{count}</div>
              <div className={`${isMobile ? 'text-[11px]' : 'text-[9px]'} text-rmpg-400 uppercase font-bold tracking-wide`}>{isMobile ? label : labelFull}</div>
            </div>
            <ArrowRight className="w-3 h-3 text-rmpg-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200" aria-hidden="true" />
          </div>
        ))}
      </div>

      {/* Shift Countdown + Weather + Quick Actions Row */}
      <div className={`grid ${isMobile ? 'grid-cols-1 gap-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'}`}>
        {/* Shift Countdown Timer */}
        <div className="panel-beveled bg-surface-base" role="region" aria-label="Current shift status">
          <PanelTitleBar title="SHIFT STATUS" icon={Timer} />
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-rmpg-200 tracking-wide">{shiftInfo.name}</div>
                <div className="text-[10px] text-rmpg-500 font-mono mt-0.5 tabular-nums">
                  {shiftInfo.startLabel} &mdash; {shiftInfo.endLabel}
                </div>
              </div>
              <div className="text-right" aria-live="polite" aria-atomic="true">
                <div className="text-lg font-bold font-mono text-brand-400 tabular-nums tracking-tight">{formatCountdown(shiftInfo.remaining)}</div>
                <div className="text-[9px] text-rmpg-500 uppercase tracking-widest font-semibold">Remaining</div>
              </div>
            </div>
            {/* Progress Bar */}
            <div className="space-y-1" role="progressbar" aria-valuenow={Math.round(shiftInfo.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Shift progress: ${Math.round(shiftInfo.progress * 100)}%`}>
              <div className="h-2.5 bg-surface-sunken rounded-sm overflow-hidden border border-[#2b2b2b] shadow-inner">
                <div
                  className="h-full transition-all duration-1000 ease-linear rounded-sm"
                  style={{
                    width: `${Math.round(shiftInfo.progress * 100)}%`,
                    background: `linear-gradient(90deg, #1a1a1a, #888888 ${Math.round(shiftInfo.progress * 100)}%)`,
                    boxShadow: '0 0 6px rgba(136, 136, 136, 0.4)',
                  }}
                />
              </div>
              <div className="flex justify-between text-[9px] font-mono text-rmpg-500 tabular-nums">
                <span>{shiftInfo.startLabel}</span>
                <span className="font-bold text-rmpg-400">{Math.round(shiftInfo.progress * 100)}%</span>
                <span>{shiftInfo.endLabel}</span>
              </div>
            </div>
            {/* Shift Indicator Dots */}
            <div className="flex items-center gap-2 pt-2 border-t border-[#2b2b2b]">
              {[
                { label: 'Day', hours: '06-14', active: shiftInfo.name === 'Day Shift' },
                { label: 'Swing', hours: '14-22', active: shiftInfo.name === 'Swing Shift' },
                { label: 'Night', hours: '22-06', active: shiftInfo.name === 'Night Shift' },
              ].map(s => (
                <div key={s.label} className={`flex-1 text-center p-1.5 rounded-sm transition-colors duration-300 ${s.active ? 'bg-brand-500/20 border border-brand-500/30 shadow-sm shadow-brand-500/10' : 'bg-surface-sunken border border-transparent'}`}>
                  <div className="flex items-center justify-center gap-1">
                    <span className={`led-dot ${s.active ? 'led-green animate-led-pulse' : 'led-off'}`} />
                    <span className={`text-[10px] font-bold select-none ${s.active ? 'text-brand-400' : 'text-rmpg-500'}`}>{s.label}</span>
                  </div>
                  <div className="text-[8px] font-mono text-rmpg-600 mt-0.5 tabular-nums">{s.hours}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Weather Widget */}
        <div className="panel-beveled bg-surface-base" role="region" aria-label="Current weather conditions" style={{ minWidth: 260 }}>
          <PanelTitleBar title="WEATHER — SALT LAKE CITY" icon={Cloud} />
          <div className="p-3">
            {weather ? (() => {
              const WeatherIcon = weather.icon;
              const isFreezing = weather.temperature < 32;
              return (
                <div className="space-y-3">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-sm bg-surface-sunken border border-[#2b2b2b] shadow-inner">
                      <WeatherIcon className="w-10 h-10 drop-shadow-md" style={{ color: isFreezing ? '#aaaaaa' : weather.weatherCode === 0 || weather.weatherCode === 1 ? '#fbbf24' : '#888888' }} />
                    </div>
                    <div>
                      <div className="text-3xl font-bold font-mono text-rmpg-100 tabular-nums" aria-label={`${weather.temperature} degrees Fahrenheit`}>{weather.temperature}<span className="text-lg text-rmpg-400 ml-0.5">&deg;F</span></div>
                      <div className="text-xs text-rmpg-400 mt-0.5 font-medium">{weather.description}</div>
                    </div>
                  </div>
                  {/* Humidity & Wind */}
                  {(weather.humidity != null || weather.windSpeed != null) && (
                    <div className="flex items-center gap-4 text-[10px] text-rmpg-400 font-mono tabular-nums">
                      {weather.humidity != null && (
                        <span title="Relative humidity">💧 {weather.humidity}%</span>
                      )}
                      {weather.windSpeed != null && (
                        <span title={`Wind direction: ${weather.windDirection ?? '—'}°`}>💨 {Math.round(weather.windSpeed)} mph</span>
                      )}
                    </div>
                  )}
                  {/* Road Conditions Warning */}
                  {isFreezing && (
                    <div className="flex items-center gap-2 p-2.5 bg-gray-900/20 border border-gray-700/30 rounded-sm animate-fade-in" role="alert">
                      <Snowflake className="w-4 h-4 text-gray-400 flex-shrink-0 animate-pulse" aria-hidden="true" />
                      <div>
                        <div className="text-[10px] font-bold text-gray-300 uppercase tracking-wider">Road Conditions Warning</div>
                        <div className="text-[10px] text-gray-400/80 mt-0.5">Temperature below freezing — watch for ice</div>
                      </div>
                    </div>
                  )}
                  {/* Weather Details */}
                  <div className="flex items-center gap-2 pt-2 border-t border-[#2b2b2b]">
                    <span className="text-[9px] text-rmpg-500 font-mono tabular-nums">
                      Updated {new Date().toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-[9px] text-rmpg-600 select-none">|</span>
                    <span className="text-[9px] text-rmpg-600 font-mono italic">Open-Meteo</span>
                  </div>
                </div>
              );
            })() : (
              <div className="flex flex-col items-center justify-center h-[100px] gap-2" role="status" aria-label={weatherFetched ? 'Weather unavailable' : 'Loading weather data'}>
                {!weatherFetched ? (
                  <>
                    <Loader2 className="w-5 h-5 text-rmpg-500 animate-spin" aria-hidden="true" />
                    <span className="text-[10px] text-rmpg-500 animate-pulse select-none">Loading weather...</span>
                  </>
                ) : (
                  <>
                    <Cloud className="w-6 h-6 text-rmpg-500 opacity-50" aria-hidden="true" />
                    <span className="text-[10px] text-rmpg-500 select-none">Weather unavailable</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="panel-beveled bg-surface-base" role="region" aria-label="Quick actions">
          <PanelTitleBar title="QUICK ACTIONS" icon={Zap} />
          <div className="p-3">
            <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-3'} gap-2`}>
              {[
                { icon: Phone, label: 'New Call', path: '', color: '#ef4444', action: () => setShowNewCallModal(true) },
                { icon: FileText, label: 'New Incident', path: '', color: '#f59e0b', action: () => setShowIncidentModal(true) },
                { icon: Navigation, label: 'Start Patrol', path: '/patrol', color: '#22c55e' },
                { icon: Gavel, label: 'New Citation', path: '/citations', color: '#888888' },
                { icon: Target, label: 'Process Server', path: '/serve', color: '#a855f7' },
                { icon: Mail, label: 'Email', path: '/email', color: '#22c55e' },
              ].map(({ icon: ActionIcon, label, path, color, action }) => (
                <button type="button"
                  key={label}
                  onClick={() => action ? action() : navigate(path)}
                  className={`flex flex-col items-center justify-center gap-1.5 ${isMobile ? 'p-3 min-h-[64px]' : 'p-2.5'} panel-beveled bg-surface-sunken hover:bg-surface-raised hover:shadow-md hover:shadow-black/15 hover:-translate-y-px active:translate-y-0 active:scale-[0.98] transition-all duration-150 cursor-pointer group border border-transparent hover:border-[#3a3a3a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50`}
                  aria-label={label}
                >
                  <ActionIcon
                    className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} transition-transform duration-200 group-hover:scale-110 drop-shadow-sm`}
                    style={{ color }}
                    aria-hidden="true"
                  />
                  <span className={`${isMobile ? 'text-[10px]' : 'text-[9px]'} font-bold text-rmpg-300 uppercase tracking-wider group-hover:text-rmpg-100 transition-colors duration-200 text-center leading-tight select-none`}>
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* BOLO Ticker */}
      {bolos.length > 0 && (
        <div className="bg-red-900/20 panel-beveled p-3 cursor-pointer hover:bg-red-900/30 transition-colors duration-200 border-l-4 border-l-red-500 shadow-md shadow-red-900/15 animate-fade-in" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/communications'); }} onClick={() => navigate('/communications')} aria-label={`View ${bolos.length} active BOLO${bolos.length !== 1 ? 's' : ''}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="led-dot led-red animate-led-pulse" />
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 animate-emergency-blink" />
            <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Active BOLOs</span>
            <span className="ml-auto text-[9px] font-mono font-bold text-red-400/80 bg-red-900/30 px-1.5 py-0.5 rounded-sm">{bolos.length}</span>
          </div>
          <div className="space-y-2" role="list" aria-label="Active BOLO entries">
          {bolos.map((bolo) => (
            <div key={bolo.id} className="flex items-start gap-3 p-2 rounded-sm hover:bg-red-900/20 transition-colors duration-150" role="listitem">
              <span className="badge badge-p2 flex-shrink-0 mt-0.5">{bolo.priority}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-red-300 truncate">{bolo.title}</p>
                <p className="text-xs text-rmpg-300 mt-0.5 truncate">{bolo.vehicle_description || bolo.subject_description}</p>
                <p className="text-[10px] text-rmpg-400 mt-0.5 font-mono tabular-nums">
                  Issued by {bolo.issued_by}
                </p>
              </div>
              <ArrowRight className="w-3 h-3 text-red-500/50 flex-shrink-0 mt-1" aria-hidden="true" />
            </div>
          ))}
          </div>
        </div>
      )}

      {/* ═══ NEW: Shift-Aware Stats + Court Dates + Expiring Certs Row ═══ */}
      {(shiftStats || courtDatesCount > 0 || expiringCertsCount > 0) && (
        <div className={`grid ${isMobile ? 'grid-cols-1 gap-2' : 'grid-cols-1 sm:grid-cols-3 gap-3'}`}>
          {shiftStats && (
            <div className="panel-beveled bg-surface-base p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="led-dot led-green animate-led-pulse" />
                <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">{shiftStats.shift_name} Stats</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-surface-sunken p-2 rounded-sm border border-[#2b2b2b]">
                  <div className="text-lg font-bold font-mono text-brand-400">{shiftStats.calls}</div>
                  <div className="text-[9px] text-rmpg-500 uppercase">Calls</div>
                </div>
                <div className="bg-surface-sunken p-2 rounded-sm border border-[#2b2b2b]">
                  <div className="text-lg font-bold font-mono text-amber-400">{shiftStats.incidents}</div>
                  <div className="text-[9px] text-rmpg-500 uppercase">Incidents</div>
                </div>
                <div className="bg-surface-sunken p-2 rounded-sm border border-[#2b2b2b]">
                  <div className="text-lg font-bold font-mono text-purple-400">{shiftStats.citations}</div>
                  <div className="text-[9px] text-rmpg-500 uppercase">Citations</div>
                </div>
                <div className="bg-surface-sunken p-2 rounded-sm border border-[#2b2b2b]">
                  <div className="text-lg font-bold font-mono text-green-400">{shiftStats.patrol_scans}</div>
                  <div className="text-[9px] text-rmpg-500 uppercase">Patrols</div>
                </div>
              </div>
            </div>
          )}
          {courtDatesCount > 0 && (
            <div
              className="panel-beveled bg-surface-base p-3 cursor-pointer hover:bg-surface-raised transition-colors"
              onClick={() => navigate('/citations')}
            >
              <div className="flex items-center gap-2 mb-2">
                <Gavel className="w-4 h-4 text-amber-400" />
                <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Court Dates (30d)</span>
              </div>
              <div className="text-3xl font-bold font-mono text-amber-400">{courtDatesCount}</div>
              <div className="text-[10px] text-rmpg-500 mt-1">Upcoming court appearances</div>
            </div>
          )}
          {expiringCertsCount > 0 && (
            <div
              className="panel-beveled bg-surface-base p-3 cursor-pointer hover:bg-surface-raised transition-colors border-l-4 border-l-red-500"
              onClick={() => navigate('/personnel')}
            >
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Cert Alerts</span>
              </div>
              <div className="text-3xl font-bold font-mono text-red-400">{expiringCertsCount}</div>
              <div className="text-[10px] text-rmpg-500 mt-1">Expiring or expired certifications</div>
            </div>
          )}
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" role="region" aria-label="Call analytics">
        {/* Calls by Hour — Area Chart with Gradient */}
        <div className="lg:col-span-2 panel-beveled bg-surface-base shadow-md shadow-black/10">
          <PanelTitleBar title="CALLS BY HOUR — TODAY" icon={Activity} />
          <div className="p-3">
          <ResponsiveContainer width="100%" height={isMobile ? 160 : 220}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="callsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#888888" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#888888" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#181818" />
              <XAxis
                dataKey="label"
                tick={{ fill: '#666666', fontSize: 9 }}
                tickLine={{ stroke: '#222222' }}
                axisLine={{ stroke: '#222222' }}
                interval={2}
              />
              <YAxis
                tick={{ fill: '#666666', fontSize: 9 }}
                tickLine={{ stroke: '#222222' }}
                axisLine={{ stroke: '#222222' }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0a0a0a',
                  border: '1px solid #3a3a3a',
                  borderRadius: '2px',
                  color: '#cccccc',
                  fontSize: '11px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  padding: '8px 12px',
                }}
                labelStyle={{ color: '#888888', fontSize: '10px', marginBottom: '4px' }}
                cursor={{ stroke: '#888888', strokeWidth: 1, strokeDasharray: '4 4' }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#888888"
                strokeWidth={2}
                fill="url(#callsGradient)"
                dot={{ fill: '#888888', r: 2, strokeWidth: 0 }}
                activeDot={{ fill: '#aaaaaa', r: 5, strokeWidth: 2, stroke: '#ffffff' }}
                animationDuration={800}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
          </div>
        </div>

        {/* Priority Distribution Pie + Quick Actions */}
        <div className="panel-beveled bg-surface-base flex flex-col shadow-md shadow-black/10">
          <PanelTitleBar title="PRIORITY DISTRIBUTION" icon={Shield} />
          <div className="p-3 flex-1">
            {/* Pie Chart */}
            {(() => {
              const totalCalls = stats.calls_by_priority.P1 + stats.calls_by_priority.P2 + stats.calls_by_priority.P3 + stats.calls_by_priority.P4;
              const pieData = [
                { name: 'P1 Emergency', value: stats.calls_by_priority.P1, fill: '#dc2626' },
                { name: 'P2 Urgent', value: stats.calls_by_priority.P2, fill: '#f59e0b' },
                { name: 'P3 Routine', value: stats.calls_by_priority.P3, fill: '#888888' },
                { name: 'P4 Scheduled', value: stats.calls_by_priority.P4, fill: '#555555' },
              ].filter(d => d.value > 0);

              return totalCalls > 0 ? (
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={55}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0a0a0a',
                        border: '1px solid #3a3a3a',
                        borderRadius: '2px',
                        color: '#cccccc',
                        fontSize: '11px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                        padding: '8px 12px',
                      }}
                      formatter={(value: number) => [`${value} calls`, '']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center h-[140px] gap-2" role="status">
                  <Shield className="w-6 h-6 text-rmpg-600" aria-hidden="true" />
                  <span className="text-[10px] text-rmpg-500 uppercase tracking-wider select-none">No calls today</span>
                </div>
              );
            })()}

            {/* Pie Legend */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2 pt-2 border-t border-[#2b2b2b]">
              {[
                { key: 'P1', label: 'Emergency', color: '#dc2626', count: stats.calls_by_priority.P1 },
                { key: 'P2', label: 'Urgent', color: '#f59e0b', count: stats.calls_by_priority.P2 },
                { key: 'P3', label: 'Routine', color: '#888888', count: stats.calls_by_priority.P3 },
                { key: 'P4', label: 'Scheduled', color: '#555555', count: stats.calls_by_priority.P4 },
              ].map(({ key, label, color, count }) => (
                <div key={key} className="flex items-center gap-1.5 py-0.5 px-1 rounded-sm hover:bg-surface-sunken transition-colors">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0 shadow-sm" style={{ backgroundColor: color }} />
                  <span className="text-[9px] text-rmpg-400 truncate">{key} {label}</span>
                  <span className="text-[9px] font-mono font-bold text-rmpg-200 ml-auto tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions — compact */}
          <div className="border-t border-[#2b2b2b] px-3 py-2.5 space-y-1.5">
            <h4 className="text-[9px] font-bold text-rmpg-500 uppercase tracking-widest select-none">Quick Actions</h4>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" className={`toolbar-btn toolbar-btn-primary justify-center ${isMobile ? 'text-xs min-h-[48px]' : 'text-[10px]'}`} onClick={() => navigate('/dispatch')}>
                <Plus style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> New Call
              </button>
              <button type="button" className={`toolbar-btn justify-center ${isMobile ? 'text-xs min-h-[48px]' : 'text-[10px]'}`} onClick={() => navigate('/incidents')}>
                <FileText style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Incident
              </button>
              <button type="button" className={`toolbar-btn justify-center ${isMobile ? 'text-xs min-h-[48px]' : 'text-[10px]'}`} onClick={() => navigate('/map')}>
                <MapPin style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Map
              </button>
              <button type="button" className={`toolbar-btn justify-center ${isMobile ? 'text-xs min-h-[48px]' : 'text-[10px]'}`} onClick={() => navigate('/warrants')}>
                <Gavel style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Warrants
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Shift Summary Row */}
      <div className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2'}`} role="region" aria-label="Shift summary metrics">
        {[
          { icon: Phone, label: 'Calls Handled', value: stats.calls_today, color: '#888888', path: '/dispatch' },
          { icon: FileText, label: 'Incidents Filed', value: stats.incidents_today, color: '#22c55e', path: '/incidents' },
          { icon: Radio, label: 'Units on Duty', value: `${stats.units_available}/${stats.units_total}`, color: '#22c55e', path: '/personnel' },
          { icon: Clock, label: 'Avg Response', value: stats.avg_response_time_minutes ? `${stats.avg_response_time_minutes}m` : 'N/A', color: '#888888', path: '/reports' },
          { icon: Gavel, label: 'Active Warrants', value: activeWarrants, color: '#f59e0b', path: '/warrants' },
          { icon: AlertTriangle, label: 'Active BOLOs', value: stats.active_bolos, color: stats.active_bolos > 0 ? '#ef4444' : '#22c55e', path: '/communications' },
        ].map(({ icon: Icon, label, value, color, path }) => (
          <div
            key={label}
            onClick={() => navigate(path)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(path); }}
            tabIndex={0}
            role="button"
            className={`panel-beveled bg-surface-sunken ${isMobile ? 'p-3 min-h-[64px]' : 'p-2.5'} cursor-pointer hover:bg-surface-raised hover:shadow-md hover:shadow-black/15 hover:-translate-y-px active:translate-y-0 transition-all duration-150 group focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50`}
            aria-label={`${label}: ${value}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`${isMobile ? 'w-4 h-4' : 'w-3.5 h-3.5'} transition-transform duration-200 group-hover:scale-110`} style={{ color }} />
              <span className={`${isMobile ? 'text-[10px]' : 'text-[9px]'} text-rmpg-500 uppercase font-bold tracking-wide truncate select-none`}>{label}</span>
            </div>
            <div className={`${isMobile ? 'text-2xl' : 'text-lg'} font-bold font-mono tabular-nums`} style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════
          Features 31-43: Analytics Dashboard Widgets
          ═══════════════════════════════════════════════════════ */}
      <div className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2'}`} role="region" aria-label="Analytics widgets">
        {/* Feature 31: Response Time Gauge */}
        <div
          className="panel-beveled bg-surface-base p-2.5 cursor-pointer hover:bg-surface-raised hover:shadow-md hover:shadow-black/15 hover:-translate-y-px active:translate-y-0 transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50"
          onClick={() => navigate('/reports')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/reports'); }}
          tabIndex={0}
          role="button"
          title="View response time analysis"
          aria-label={`Average response time: ${stats.avg_response_time_minutes || 'N/A'} minutes`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="w-3 h-3 text-brand-400" />
            <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">Avg Response</span>
          </div>
          <div className="relative w-16 h-16 mx-auto my-1">
            <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
              <circle cx="18" cy="18" r="14" fill="none" stroke="#222222" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="14" fill="none"
                stroke={stats.avg_response_time_minutes <= 5 ? '#22c55e' : stats.avg_response_time_minutes <= 10 ? '#f59e0b' : '#ef4444'}
                strokeWidth="3"
                strokeDasharray={`${Math.min(100, (stats.avg_response_time_minutes / 15) * 100) * 0.88} 88`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm font-bold font-mono text-rmpg-100 tabular-nums">
                {stats.avg_response_time_minutes ? `${stats.avg_response_time_minutes}` : 'N/A'}
              </span>
            </div>
          </div>
          <div className="text-[8px] text-rmpg-500 text-center uppercase">Minutes</div>
        </div>

        {/* Feature 34: Crime Category Donut (compact) */}
        <div className="panel-beveled bg-surface-base p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Shield className="w-3 h-3 text-purple-400" />
            <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">By Priority</span>
          </div>
          <ResponsiveContainer width="100%" height={76}>
            <PieChart>
              <Pie
                data={[
                  { name: 'P1', value: stats.calls_by_priority.P1, fill: '#dc2626' },
                  { name: 'P2', value: stats.calls_by_priority.P2, fill: '#f59e0b' },
                  { name: 'P3', value: stats.calls_by_priority.P3, fill: '#888888' },
                  { name: 'P4', value: stats.calls_by_priority.P4, fill: '#555555' },
                ].filter(d => d.value > 0)}
                cx="50%" cy="50%" innerRadius={20} outerRadius={32}
                paddingAngle={2} dataKey="value" stroke="none"
              >
                {[
                  { fill: '#dc2626' }, { fill: '#f59e0b' }, { fill: '#888888' }, { fill: '#555555' },
                ].map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Feature 38: Clearance Rate Widget */}
        <div
          className="panel-beveled bg-surface-base p-2.5 cursor-pointer hover:bg-surface-raised hover:shadow-md hover:shadow-black/15 hover:-translate-y-px active:translate-y-0 transition-all duration-150"
          onClick={() => navigate('/reports')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/reports'); }}
          tabIndex={0}
          role="button"
          aria-label={`Clearance rate: ${clearanceRate?.rate ?? 0}%`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle className="w-3 h-3 text-green-400" />
            <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">Clearance</span>
          </div>
          <div className="text-xl font-bold font-mono text-center tabular-nums" style={{ color: (clearanceRate?.rate || 0) >= 50 ? '#22c55e' : '#f59e0b' }}>
            {clearanceRate?.rate ?? 0}%
          </div>
          <div className="text-[8px] text-rmpg-500 text-center font-mono tabular-nums">{clearanceRate?.cleared || 0}/{clearanceRate?.total || 0} cleared</div>
        </div>

        {/* Feature 39: Patrol Coverage Indicator */}
        <div
          className="panel-beveled bg-surface-base p-2.5 cursor-pointer hover:bg-surface-raised hover:shadow-md hover:shadow-black/15 hover:-translate-y-px active:translate-y-0 transition-all duration-150"
          onClick={() => navigate('/patrol')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/patrol'); }}
          tabIndex={0}
          role="button"
          aria-label={`Patrol coverage: ${patrolCoverage?.coverage ?? 0}%`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Navigation className="w-3 h-3 text-gray-400" />
            <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">Coverage</span>
          </div>
          <div className="text-xl font-bold font-mono text-center text-gray-400 tabular-nums">
            {patrolCoverage?.coverage ?? 0}%
          </div>
          <div className="text-[8px] text-rmpg-500 text-center font-mono tabular-nums">{patrolCoverage?.coveredBeats || 0}/{patrolCoverage?.totalBeats || 0} beats</div>
        </div>

        {/* Feature 41: Evidence Pending Count */}
        <div
          className={`panel-beveled bg-surface-base p-2.5 cursor-pointer hover:bg-surface-raised hover:shadow-md hover:shadow-black/15 hover:-translate-y-px active:translate-y-0 transition-all duration-150 border-l-[3px] ${(evidencePending?.pending || 0) > 0 ? 'border-l-amber-500' : 'border-l-green-500'}`}
          onClick={() => navigate('/evidence')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/evidence'); }}
          tabIndex={0}
          role="button"
          aria-label={`Evidence pending: ${evidencePending?.pending ?? 0}`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Briefcase className="w-3 h-3" style={{ color: (evidencePending?.pending || 0) > 0 ? '#f59e0b' : '#22c55e' }} />
            <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">Evidence</span>
          </div>
          <div className="text-xl font-bold font-mono text-center tabular-nums" style={{ color: (evidencePending?.pending || 0) > 0 ? '#f59e0b' : '#22c55e' }}>
            {evidencePending?.pending ?? 0}
          </div>
          <div className="text-[8px] text-rmpg-500 text-center uppercase tracking-wider">Pending</div>
        </div>

        {/* Feature 43: Overdue Reports Alert */}
        <div
          className={`panel-beveled bg-surface-base p-2.5 cursor-pointer hover:bg-surface-raised hover:shadow-md hover:shadow-black/15 hover:-translate-y-px active:translate-y-0 transition-all duration-150 border-l-[3px] ${(overdueReports?.count || 0) > 0 ? 'border-l-red-500' : 'border-l-green-500'}`}
          onClick={() => navigate('/incidents')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/incidents'); }}
          tabIndex={0}
          role="button"
          aria-label={`Overdue reports: ${overdueReports?.count ?? 0}`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="w-3 h-3" style={{ color: (overdueReports?.count || 0) > 0 ? '#ef4444' : '#22c55e' }} />
            <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">Overdue</span>
          </div>
          <div className="text-xl font-bold font-mono text-center tabular-nums" style={{ color: (overdueReports?.count || 0) > 0 ? '#ef4444' : '#22c55e' }}>
            {overdueReports?.count ?? 0}
          </div>
          <div className="text-[8px] text-rmpg-500 text-center uppercase tracking-wider">Reports</div>
        </div>
      </div>

      {/* Feature 33: Shift Performance Comparison + Feature 42: Upcoming Court */}
      <div className={`grid ${isMobile ? 'grid-cols-1 gap-3' : 'grid-cols-1 lg:grid-cols-2 gap-3'}`}>
        {/* Feature 33: Shift Performance Comparison */}
        {shiftComparison?.shifts && (
          <div className="panel-beveled bg-surface-base shadow-md shadow-black/10" role="region" aria-label="Shift performance comparison">
            <PanelTitleBar title="SHIFT PERFORMANCE COMPARISON" icon={Activity} />
            <div className="p-3">
              <div className="grid grid-cols-3 gap-2">
                {shiftComparison.shifts.map((s: any) => {
                  const isCurrentShift = shiftInfo.name.toLowerCase().includes(s.shift.toLowerCase());
                  return (
                    <div key={s.shift} className={`panel-beveled bg-surface-sunken p-2.5 transition-colors duration-300 ${isCurrentShift ? 'border border-brand-500/30 shadow-sm shadow-brand-500/10' : 'border border-transparent'}`}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className={`led-dot ${isCurrentShift ? 'led-green animate-led-pulse' : 'led-off'}`} />
                        <span className={`text-[10px] font-bold uppercase tracking-wide ${isCurrentShift ? 'text-brand-400' : 'text-rmpg-200'}`}>{s.shift}</span>
                        <span className="text-[8px] text-rmpg-600 font-mono ml-auto tabular-nums">{s.hours}</span>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-rmpg-400">Calls</span>
                          <span className="text-xs font-bold font-mono text-gray-400 tabular-nums">{s.calls}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-rmpg-400">Incidents</span>
                          <span className="text-xs font-bold font-mono text-green-400 tabular-nums">{s.incidents}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-rmpg-400">Avg Resp</span>
                          <span className="text-xs font-bold font-mono text-brand-400 tabular-nums">
                            {s.avgResponseMin ? `${s.avgResponseMin}m` : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Feature 42: Upcoming Court Widget */}
        <div className="panel-beveled bg-surface-base shadow-md shadow-black/10" role="region" aria-label="Upcoming court appearances">
          <PanelTitleBar title="UPCOMING COURT — NEXT 7 DAYS" icon={Gavel} />
          <div className="p-3">
            {(upcomingCourt?.upcoming?.length || 0) === 0 ? (
              <div className="flex flex-col items-center gap-2 py-4 justify-center" role="status">
                <Gavel className="w-5 h-5 text-rmpg-600" aria-hidden="true" />
                <div className="flex items-center gap-1.5">
                  <span className="led-dot led-green" aria-hidden="true" />
                  <span className="text-xs text-rmpg-300 select-none">No upcoming court appearances</span>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent">
                {upcomingCourt.upcoming.map((c: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 panel-beveled bg-surface-sunken p-2 hover:bg-surface-raised transition-colors duration-150">
                    <div className="text-[10px] font-mono text-brand-400 font-bold w-16 flex-shrink-0 tabular-nums">
                      {c.date ? new Date(c.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-rmpg-200 truncate font-medium">{c.case_number || c.description || 'Court Appearance'}</div>
                      {c.officer_name && <div className="text-[9px] text-rmpg-500 truncate">{c.officer_name}</div>}
                    </div>
                    {c.time && <span className="text-[9px] font-mono text-rmpg-400 flex-shrink-0 tabular-nums">{c.time}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Feature 35: Trending Incidents + Feature 36: Officer Status Board + Feature 37: Call Volume Sparkline */}
      {/* (Feature 36 is already represented by the Officers on Duty in Operational Status) */}
      {/* (Feature 37: Call Volume sparkline is represented by the Calls by Hour chart above) */}
      {/* (Feature 32: Active incidents map preview — navigates to map page) */}
      {/* Feature 35: Trending Incidents Indicator — shown inline with shift summary above */}

      {/* PSO Operations Panel */}
      {psoStats && (psoStats.activeCalls > 0 || psoStats.monthCalls > 0) && (() => {
        const serveRate = psoStats.serveResults.total > 0
          ? Math.round((psoStats.serveResults.served / psoStats.serveResults.total) * 100)
          : null;
        const SERVICE_TYPE_LABELS: Record<string, string> = {
          patrol_service: 'Patrol Service',
          standing_guard: 'Standing Guard',
          event_security: 'Event Security',
          escort: 'Escort',
          process_service: 'Process Service',
          investigation: 'Investigation',
          surveillance: 'Surveillance',
          alarm_response: 'Alarm Response',
          other: 'Other',
        };
        return (
          <div className="panel-beveled bg-surface-base shadow-md shadow-black/10" role="region" aria-label="PSO Operations this month">
            <PanelTitleBar title="PSO OPERATIONS — THIS MONTH" icon={Briefcase} />
            <div className="p-3 space-y-3">
              {/* PSO Stats Cards */}
              <div className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2'}`}>
                <div className="panel-beveled bg-surface-sunken p-2.5 border-l-[3px] border-l-brand-500">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Briefcase className="w-3 h-3 text-brand-400" />
                    <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">Active PSO</span>
                  </div>
                  <div className="text-lg font-bold font-mono text-brand-400 tabular-nums">{psoStats.activeCalls}</div>
                </div>
                <div className="panel-beveled bg-surface-sunken p-2.5 border-l-[3px] border-l-gray-500">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Phone className="w-3 h-3 text-gray-400" />
                    <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">Today</span>
                  </div>
                  <div className="text-lg font-bold font-mono text-gray-400 tabular-nums">{psoStats.todayCalls}</div>
                </div>
                <div className="panel-beveled bg-surface-sunken p-2.5 border-l-[3px] border-l-green-500">
                  <div className="flex items-center gap-1.5 mb-1">
                    <CheckCircle className="w-3 h-3 text-green-400" />
                    <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">Completed</span>
                  </div>
                  <div className="text-lg font-bold font-mono text-green-400 tabular-nums">{psoStats.monthCompleted}<span className="text-[10px] text-rmpg-500 ml-1">/ {psoStats.monthCalls}</span></div>
                </div>
                <div className="panel-beveled bg-surface-sunken p-2.5 border-l-[3px]" style={{ borderLeftColor: serveRate !== null && serveRate >= 70 ? '#22c55e' : serveRate !== null ? '#f59e0b' : '#666666' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Target className="w-3 h-3" style={{ color: serveRate !== null && serveRate >= 70 ? '#22c55e' : '#f59e0b' }} />
                    <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">Serve Rate</span>
                  </div>
                  <div className="text-lg font-bold font-mono tabular-nums" style={{ color: serveRate !== null && serveRate >= 70 ? '#22c55e' : serveRate !== null ? '#f59e0b' : '#666666' }}>
                    {serveRate !== null ? `${serveRate}%` : 'N/A'}
                  </div>
                </div>
                <div className="panel-beveled bg-surface-sunken p-2.5 border-l-[3px] border-l-amber-500">
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingUp className="w-3 h-3 text-amber-400" />
                    <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">Avg Attempts</span>
                  </div>
                  <div className="text-lg font-bold font-mono text-amber-400 tabular-nums">{psoStats.avgAttempts ?? 'N/A'}</div>
                </div>
                <div className="panel-beveled bg-surface-sunken p-2.5 border-l-[3px] border-l-brand-500">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className="w-3 h-3 text-brand-400" />
                    <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">PSO Response</span>
                  </div>
                  <div className="text-lg font-bold font-mono text-brand-400 tabular-nums">{psoStats.avgResponseMinutes ? `${psoStats.avgResponseMinutes}m` : 'N/A'}</div>
                </div>
              </div>

              {/* Service Type Breakdown + Serve Results */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* Service Type Breakdown */}
                {psoStats.byServiceType.length > 0 && (
                  <div className="panel-beveled bg-surface-sunken p-2.5">
                    <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-widest mb-2 select-none">By Service Type</div>
                    <div className="space-y-1.5">
                      {psoStats.byServiceType.map(st => {
                        const pct = psoStats.monthCalls > 0 ? Math.round((st.count / psoStats.monthCalls) * 100) : 0;
                        return (
                          <div key={st.pso_service_type} className="flex items-center gap-2 group hover:bg-surface-raised/50 rounded-sm px-1 py-0.5 transition-colors">
                            <span className="text-[10px] text-rmpg-300 w-28 truncate capitalize group-hover:text-rmpg-200 transition-colors">{SERVICE_TYPE_LABELS[st.pso_service_type] || st.pso_service_type.replace(/_/g, ' ')}</span>
                            <div className="flex-1 h-1.5 bg-rmpg-700 rounded-full overflow-hidden shadow-inner">
                              <div className="h-full bg-brand-500 transition-all duration-500 ease-out rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[10px] font-mono text-rmpg-300 w-12 text-right tabular-nums">{st.count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Process Service Results */}
                {psoStats.serveResults.total > 0 && (
                  <div className="panel-beveled bg-surface-sunken p-2.5">
                    <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-widest mb-2 select-none">Process Service Results</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex items-center gap-2 p-1 rounded-sm hover:bg-surface-raised/50 transition-colors">
                        <CheckCircle className="w-3 h-3 text-green-400 flex-shrink-0" />
                        <span className="text-[10px] text-rmpg-300">Served</span>
                        <span className="text-[10px] font-mono font-bold text-green-400 ml-auto tabular-nums">{psoStats.serveResults.served}</span>
                      </div>
                      <div className="flex items-center gap-2 p-1 rounded-sm hover:bg-surface-raised/50 transition-colors">
                        <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                        <span className="text-[10px] text-rmpg-300">Not Served</span>
                        <span className="text-[10px] font-mono font-bold text-red-400 ml-auto tabular-nums">{psoStats.serveResults.notServed}</span>
                      </div>
                      <div className="flex items-center gap-2 p-1 rounded-sm hover:bg-surface-raised/50 transition-colors">
                        <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />
                        <span className="text-[10px] text-rmpg-300">Refused</span>
                        <span className="text-[10px] font-mono font-bold text-amber-400 ml-auto tabular-nums">{psoStats.serveResults.refused}</span>
                      </div>
                      <div className="flex items-center gap-2 p-1 rounded-sm hover:bg-surface-raised/50 transition-colors">
                        <Clock className="w-3 h-3 text-rmpg-400 flex-shrink-0" />
                        <span className="text-[10px] text-rmpg-300">Pending</span>
                        <span className="text-[10px] font-mono font-bold text-rmpg-400 ml-auto tabular-nums">{psoStats.serveResults.pendingResult}</span>
                      </div>
                    </div>
                    {/* ServeManager Sync */}
                    {psoStats.serveManager.totalJobs > 0 && (
                      <div className="mt-2 pt-2 border-t border-rmpg-700/50">
                        <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1">ServeManager Sync</div>
                        <div className="flex items-center gap-3 text-[10px]">
                          <span className="text-rmpg-400">Total: <span className="font-mono text-rmpg-200">{psoStats.serveManager.totalJobs}</span></span>
                          <span className="text-rmpg-400">Pending: <span className="font-mono text-amber-400">{psoStats.serveManager.pendingJobs}</span></span>
                          <span className="text-rmpg-400">Complete: <span className="font-mono text-green-400">{psoStats.serveManager.completedJobs}</span></span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Activity Feed + Operational Alerts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Activity Feed */}
        <div className="lg:col-span-2 panel-beveled bg-surface-base shadow-md shadow-black/10" role="region" aria-label="Recent activity feed" aria-live="polite">
          <PanelTitleBar title="RECENT ACTIVITY" icon={Activity}>
            <button type="button"
              className="toolbar-btn flex items-center gap-1 hover:bg-surface-raised transition-colors"
              onClick={() => navigate('/audit')}
              title="View full audit log"
            >
              <Eye style={{ width: 10, height: 10 }} />
              <span className="text-[9px] font-bold">View All</span>
            </button>
          </PanelTitleBar>
          <div className="p-3">
            {activities.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2" role="status">
                <Activity className="w-6 h-6 text-rmpg-600" aria-hidden="true" />
                <span className="text-[10px] text-rmpg-500 uppercase tracking-wider select-none">No recent activity</span>
              </div>
            ) : (
              <ActivityFeed entries={activities} maxHeight="320px" />
            )}
          </div>
        </div>

        {/* Operational Summary */}
        <div className="panel-beveled bg-surface-base shadow-md shadow-black/10" role="region" aria-label="Operational status">
          <PanelTitleBar title="OPERATIONAL STATUS" icon={Radio} />
          <div className="p-3 space-y-2.5">
            {/* Active Warrant Alerts */}
            <div
              className={`flex items-center gap-3 p-2.5 panel-beveled cursor-pointer hover:bg-amber-900/10 hover:shadow-sm transition-all duration-150 bg-surface-sunken border-l-[3px] ${activeWarrants > 0 ? 'border-l-amber-500' : 'border-l-rmpg-600'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50`}
              onClick={() => navigate('/warrants')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/warrants'); }}
              tabIndex={0}
              role="button"
              aria-label={`Active warrants: ${activeWarrants}`}
            >
              <Gavel className={`w-4 h-4 flex-shrink-0 ${activeWarrants > 0 ? 'text-amber-400' : 'text-rmpg-500'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wide">Active Warrants</div>
                <div className={`text-lg font-bold font-mono tabular-nums ${activeWarrants > 0 ? 'text-amber-400' : 'text-green-400'}`}>{activeWarrants}</div>
              </div>
              {activeWarrants > 0 && <span className="led-dot led-amber animate-led-pulse" />}
            </div>

            {/* Active BOLOs */}
            <div
              className={`flex items-center gap-3 p-2.5 panel-beveled cursor-pointer hover:bg-red-900/10 hover:shadow-sm transition-all duration-150 bg-surface-sunken border-l-[3px] ${stats.active_bolos > 0 ? 'border-l-red-500' : 'border-l-rmpg-600'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50`}
              onClick={() => navigate('/communications')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/communications'); }}
              tabIndex={0}
              role="button"
              aria-label={`Active BOLOs: ${stats.active_bolos}`}
            >
              <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${stats.active_bolos > 0 ? 'text-red-400' : 'text-rmpg-500'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wide">Active BOLOs</div>
                <div className={`text-lg font-bold font-mono tabular-nums ${stats.active_bolos > 0 ? 'text-red-400' : 'text-green-400'}`}>{stats.active_bolos}</div>
              </div>
              {stats.active_bolos > 0 && <span className="led-dot led-red animate-led-pulse" />}
            </div>

            {/* Officers on Duty */}
            <div
              className="flex items-center gap-3 p-2.5 panel-beveled cursor-pointer hover:bg-green-900/10 hover:shadow-sm transition-all duration-150 bg-surface-sunken border-l-[3px] border-l-green-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50"
              onClick={() => navigate('/personnel')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/personnel'); }}
              tabIndex={0}
              role="button"
              aria-label={`Officers on duty: ${stats.officers_on_duty}`}
            >
              <Users className="w-4 h-4 text-green-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wide">Officers on Duty</div>
                <div className="text-lg font-bold font-mono text-green-400 tabular-nums">{stats.officers_on_duty}</div>
              </div>
            </div>

            {/* Credential Alerts Quick Summary */}
            <div
              className={`flex items-center gap-3 p-2.5 panel-beveled cursor-pointer hover:bg-rmpg-700/30 hover:shadow-sm transition-all duration-150 bg-surface-sunken border-l-[3px] ${expiringCredentials.length > 0 ? 'border-l-amber-500' : 'border-l-green-500'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500/50`}
              onClick={() => navigate('/personnel')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/personnel'); }}
              tabIndex={0}
              role="button"
              aria-label={`Credential alerts: ${expiringCredentials.length}`}
            >
              <Shield className={`w-4 h-4 flex-shrink-0 ${expiringCredentials.length > 0 ? 'text-amber-400' : 'text-green-400'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wide">Credential Alerts</div>
                <div className={`text-lg font-bold font-mono tabular-nums ${expiringCredentials.length > 0 ? 'text-amber-400' : 'text-green-400'}`}>{expiringCredentials.length}</div>
              </div>
              {expiringCredentials.length > 0 && <span className="led-dot led-amber animate-led-pulse" />}
            </div>
          </div>
        </div>
      </div>

      {/* Credential Alerts */}
      <div className="panel-beveled bg-surface-base shadow-md shadow-black/10" role="region" aria-label="Credential alerts">
        <PanelTitleBar title="CREDENTIAL ALERTS" icon={Shield} />
        <div className="p-3">
          {expiringCredentials.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 justify-center" role="status">
              <Shield className="w-6 h-6 text-green-600/50" aria-hidden="true" />
              <div className="flex items-center gap-1.5">
                <span className="led-dot led-green" aria-hidden="true" />
                <span className="text-xs text-rmpg-300 font-medium select-none">All credentials current</span>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent">
              <table className="w-full text-xs" role="table" aria-label="Expiring credentials list">
                <thead>
                  <tr className="border-b border-[#2b2b2b]">
                    <th className="px-3 py-2 text-left text-rmpg-400 font-semibold uppercase text-[10px] tracking-wider" scope="col">Officer</th>
                    <th className="px-3 py-2 text-left text-rmpg-400 font-semibold uppercase text-[10px] tracking-wider" scope="col">Credential</th>
                    {!isMobile && <th className="px-3 py-2 text-left text-rmpg-400 font-semibold uppercase text-[10px] tracking-wider" scope="col">Expiry Date</th>}
                    <th className="px-3 py-2 text-left text-rmpg-400 font-semibold uppercase text-[10px] tracking-wider" scope="col">Days Left</th>
                    <th className="px-3 py-2 text-left text-rmpg-400 font-semibold uppercase text-[10px] tracking-wider" scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {expiringCredentials.map((cred: any, idx: number) => {
                    const now = new Date();
                    const exp = new Date(cred.expiry_date);
                    const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                    const isExpired = daysLeft < 0;
                    const isUrgent = daysLeft <= 30;

                    return (
                      <tr key={cred.id ?? idx} className={`border-b border-rmpg-700/30 hover:bg-surface-raised/50 transition-colors duration-150 ${isMobile ? 'min-h-[48px]' : ''}`}>
                        <td className="px-3 py-2.5 text-rmpg-200 font-medium">{cred.officer_name || cred.user_name || '-'}</td>
                        <td className="px-3 py-2.5 text-rmpg-200">{cred.credential_type || cred.type || '-'}</td>
                        {!isMobile && <td className="px-3 py-2.5 text-rmpg-200 font-mono tabular-nums">{exp.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })}</td>}
                        <td className="px-3 py-2.5 font-mono font-bold tabular-nums" style={{ color: isExpired ? '#ef4444' : isUrgent ? '#f59e0b' : '#22c55e' }}>
                          {isExpired ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d`}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`led-dot ${isExpired ? 'led-red animate-led-blink' : isUrgent ? 'led-amber animate-led-pulse' : 'led-green'}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Officer Activity Comparison */}
      {officerActivity.length > 0 && (() => {
        const ROLE_COLORS: Record<string, string> = {
          admin: '#ef4444',
          supervisor: '#f59e0b',
          manager: '#888888',
          officer: '#22c55e',
        };
        const ROLE_ORDER = ['admin', 'supervisor', 'manager', 'officer'];
        const ROLE_LABELS: Record<string, string> = {
          admin: 'Admin',
          supervisor: 'Supervisor',
          manager: 'Manager',
          officer: 'Officer',
        };
        // Sort: by role order, then by action_count desc within role
        const sorted = [...officerActivity].sort((a, b) => {
          const ra = ROLE_ORDER.indexOf(a.role);
          const rb = ROLE_ORDER.indexOf(b.role);
          if (ra !== rb) return ra - rb;
          return b.action_count - a.action_count;
        });
        const chartRows = sorted.map(o => ({
          name: o.full_name?.split(' ').filter(Boolean).map(w => w[0] ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ') || 'Unknown',
          badge: o.badge_number || '',
          actions: o.action_count,
          role: o.role,
          fill: ROLE_COLORS[o.role] || '#666666',
        }));

        return (
          <div className="panel-beveled bg-surface-base shadow-md shadow-black/10" role="region" aria-label="Officer activity comparison">
            <PanelTitleBar title="OFFICER ACTIVITY COMPARISON — LAST 30 DAYS" icon={Users} />
            <div className="p-3">
              {/* Role Legend */}
              <div className="flex items-center gap-4 mb-3 flex-wrap">
                {ROLE_ORDER.map(role => (
                  <div key={role} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm shadow-sm" style={{ backgroundColor: ROLE_COLORS[role] }} />
                    <span className="text-[10px] text-rmpg-300 font-semibold uppercase tracking-wider select-none">{ROLE_LABELS[role]}</span>
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={Math.max(180, chartRows.length * 32)}>
                <BarChart data={chartRows} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222222" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#888888', fontSize: 10 }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={140}
                    tick={{ fill: '#aaaaaa', fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0a0a0a',
                      border: '1px solid #3a3a3a',
                      borderRadius: '2px',
                      color: '#e0e0e0',
                      fontSize: '11px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                      padding: '8px 12px',
                    }}
                    formatter={(value: number, _name: string, props: any) => [
                      `${value} actions`,
                      `${ROLE_LABELS[props.payload.role] || props.payload.role} — Badge #${props.payload.badge || '—'}`,
                    ]}
                    cursor={{ fill: 'rgba(136, 136, 136, 0.08)' }}
                  />
                  <Bar dataKey="actions" radius={[0, 3, 3, 0]}>
                    {chartRows.map((entry) => (
                      <Cell key={`${entry.name}-${entry.badge}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* Quick Action Modals */}
      {showNewCallModal && (
        <NewCallModal
          isOpen={showNewCallModal}
          onClose={() => setShowNewCallModal(false)}
          onSubmit={async (callData: any) => {
            try {
              const body = {
                call_type: callData.call_type || 'other',
                priority: callData.priority || 'routine',
                location: callData.location || '',
                latitude: callData.latitude ?? null,
                longitude: callData.longitude ?? null,
                description: callData.description || '',
                caller_name: callData.caller_name || '',
                caller_phone: callData.caller_phone || '',
                nature_of_call: callData.nature_of_call || '',
                contract_id: callData.contract_id || null,
                zone_beat: callData.zone_beat || null,
                section_id: callData.section_id ?? null,
                zone_id: callData.zone_id ?? null,
                beat_id: callData.beat_id ?? null,
                weapons_involved: callData.weapons_involved || null,
                injuries_reported: callData.injuries_reported ?? false,
                num_subjects: callData.num_subjects ?? null,
                num_victims: callData.num_victims ?? null,
                subject_description: callData.subject_description || null,
                vehicle_description: callData.vehicle_description || null,
                direction_of_travel: callData.direction_of_travel || null,
                scene_safety: callData.scene_safety || null,
                alcohol_involved: callData.alcohol_involved ?? false,
                drugs_involved: callData.drugs_involved ?? false,
                domestic_violence: callData.domestic_violence ?? false,
                responding_officer: callData.responding_officer || null,
                ...(callData.created_at ? { created_at: callData.created_at } : {}),
                ...(callData.status && callData.status !== 'pending' ? { status: callData.status } : {}),
                ...(callData.disposition ? { disposition: callData.disposition } : {}),
              };
              const result = await apiFetch<any>('/dispatch/calls', { method: 'POST', body: JSON.stringify(body) });
              addToast(`Call ${result.call_number || ''} created`, 'success');
              setShowNewCallModal(false);
              fetchDashboardData({ silent: true });
            } catch (err: any) {
              console.error('Failed to create call from dashboard:', err);
              addToast(err?.message || 'Failed to create call', 'error');
            }
          }}
        />
      )}
      {showIncidentModal && (
        <IncidentFormModal
          isOpen={showIncidentModal}
          onClose={() => setShowIncidentModal(false)}
          onSubmit={() => { setShowIncidentModal(false); fetchDashboardData({ silent: true }); }}
          isSubmitting={false}
        />
      )}
    </div>
  );
}
