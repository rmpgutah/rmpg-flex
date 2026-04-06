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
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { DashboardStats, ActivityLogEntry, BOLO } from '../types';
import StatsCard from '../components/StatsCard';
import ActivityFeed from '../components/ActivityFeed';
import PanelTitleBar from '../components/PanelTitleBar';
import IntegrationHub from '../components/IntegrationHub';
import WeatherWidget from '../components/WeatherWidget';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import { StatsCardSkeleton, CardSkeleton } from '../components/Skeleton';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';

// ─── Backend Response Types ──────────────────────────────

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
    hour: typeof entry.hour === 'string' ? parseInt(entry.hour, 10) : entry.hour,
    count: entry.count,
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

// ─── Component ───────────────────────────────────────────

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [activities, setActivities] = useState<ActivityLogEntry[]>([]);
  const [bolos, setBolos] = useState<BOLO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expiringCredentials, setExpiringCredentials] = useState<any[]>([]);
  const [activeWarrants, setActiveWarrants] = useState(0);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { user } = useAuth();

  const fetchDashboardData = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(null); }

    try {
      const [dashboardRaw, activityRaw, bolosRaw, warrantsRaw] = await Promise.all([
        apiFetch<DashboardApiResponse>('/reports/dashboard'),
        apiFetch<{ data: ActivityApiEntry[] }>('/comms/activity-feed?limit=20').then(r => r.data),
        apiFetch<BoloApiEntry[]>('/comms/bolos/active'),
        apiFetch<any>('/warrants?status=active&per_page=1').catch(() => ({ total: 0 })),
      ]);

      setStats(mapDashboardStats(dashboardRaw));
      setActivities((activityRaw ?? []).map(mapActivityEntry));
      setBolos(
        (bolosRaw ?? [])
          .filter((b) => b.status === 'active')
          .map(mapBoloEntry)
      );
      setActiveWarrants(warrantsRaw?.total ?? 0);
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
      const expiring = (data || []).filter((c: any) => {
        if (!c.expiry_date) return false;
        const exp = new Date(c.expiry_date);
        return exp <= sixtyDaysOut;
      });
      setExpiringCredentials(expiring);
    } catch {
      // Endpoint may not exist yet — fail silently
      setExpiringCredentials([]);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
    fetchCredentials();

    // Refresh every 60 seconds (LiveSync handles real-time updates)
    const interval = setInterval(() => { fetchDashboardData({ silent: true }); fetchCredentials(); }, 60_000);
    return () => clearInterval(interval);
  }, [fetchDashboardData, fetchCredentials]);

  // Live sync — auto-refresh dashboard when ANY module changes (silent to avoid unmounting UI)
  const silentRefreshDashboard = useCallback(() => fetchDashboardData({ silent: true }), [fetchDashboardData]);
  useLiveSync(['dispatch', 'incidents', 'records', 'personnel', 'fleet'], silentRefreshDashboard);

  // Format hour labels for chart
  const chartData = stats.calls_by_hour.map((d) => ({
    ...d,
    label: `${d.hour.toString().padStart(2, '0')}:00`,
  }));

  if (loading && stats === DEFAULT_STATS) {
    return (
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <StatsCardSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2"><CardSkeleton /></div>
          <CardSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 animate-fade-in">
      {/* Portal Header — RMPG Logo + System Title */}
      <div className="panel-beveled bg-surface-base overflow-hidden">
        <div className={`flex items-center gap-4 ${isMobile ? 'px-3 py-2' : 'px-4 py-3'} relative`}>
          {/* Crimson accent line */}
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #6e0a0a, #bc1010 30%, #bc1010 70%, #6e0a0a)' }} />
          {!isMobile && <RmpgLogo height={68} />}
          {isMobile && <RmpgLogo height={36} iconOnly />}
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className={`${isMobile ? 'text-xs' : 'text-sm'} font-bold tracking-wider uppercase text-rmpg-200`}>
                {isMobile ? 'C&C Dashboard' : 'Command & Control Dashboard'}
              </h1>
              <div className="hidden sm:flex items-center gap-1.5">
                <span className={`led-dot ${stats.active_calls > 0 ? 'led-green animate-led-pulse' : 'led-green'}`} />
                <span className="text-[9px] font-mono font-bold text-green-500">OPERATIONAL</span>
              </div>
            </div>
            {!isMobile && (
              <p className="text-[9px] tracking-wide mt-0.5 text-rmpg-600">
                Rocky Mountain Protective Group, LLC &mdash; Resolving today&rsquo;s concerns, to ensure tomorrow&rsquo;s solutions.
              </p>
            )}
          </div>
          <div className="hidden md:flex items-center gap-2 text-[9px] font-mono text-rmpg-600">
            <PrintButton />
            <span>{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 p-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-xs text-red-300">{error}</span>
          </div>
          <button
            className="text-xs text-red-400 hover:text-red-300 underline"
            onClick={() => fetchDashboardData()}
          >
            Retry
          </button>
        </div>
      )}

      {/* Stats Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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

      {/* Priority Breakdown — Clickable beveled panels with LED dots */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { key: 'P1', label: 'P1 Emergency', led: 'led-red', border: 'border-l-red-500', count: stats.calls_by_priority.P1 },
          { key: 'P2', label: 'P2 Urgent', led: 'led-amber', border: 'border-l-amber-500', count: stats.calls_by_priority.P2 },
          { key: 'P3', label: 'P3 Routine', led: 'led-blue', border: 'border-l-brand-500', count: stats.calls_by_priority.P3 },
          { key: 'P4', label: 'P4 Scheduled', led: 'led-off', border: 'border-l-gray-500', count: stats.calls_by_priority.P4 },
        ].map(({ key, label, led, border, count }) => (
          <div
            key={key}
            onClick={() => navigate('/dispatch')}
            className={`flex items-center gap-3 p-2 panel-beveled border-l-4 ${border} cursor-pointer hover:bg-surface-raised transition-all duration-150 group bg-surface-base`}
            title={`View ${key} calls in Dispatch`}
          >
            <span className={`led-dot ${led}`} />
            <div className="flex-1">
              <div className="text-lg font-bold text-green-400 font-mono">{count}</div>
              <div className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wide">{label}</div>
            </div>
            <ArrowRight className="w-3 h-3 text-rmpg-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        ))}
      </div>

      {/* BOLO Ticker */}
      {bolos.length > 0 && (
        <div className="bg-red-900/20 panel-beveled p-2 cursor-pointer hover:bg-red-900/30 transition-colors border-l-4 border-l-red-500" onClick={() => navigate('/communications')}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="led-dot led-red animate-led-pulse" />
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 animate-emergency-blink" />
            <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Active BOLOs</span>
          </div>
          {bolos.map((bolo) => (
            <div key={bolo.id} className="flex items-start gap-3">
              <span className="badge badge-p2 flex-shrink-0 mt-0.5">{bolo.priority}</span>
              <div>
                <p className="text-sm font-semibold text-red-300">{bolo.title}</p>
                <p className="text-xs text-rmpg-300 mt-0.5">{bolo.vehicle_description || bolo.subject_description}</p>
                <p className="text-[10px] text-rmpg-400 mt-0.5">
                  Issued by {bolo.issued_by}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Calls by Hour Chart */}
        <div className="lg:col-span-2 panel-beveled bg-surface-base">
          <PanelTitleBar title="CALLS BY HOUR — TODAY" icon={Activity} />
          <div className="p-3">
          <ResponsiveContainer width="100%" height={isMobile ? 160 : 220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="label"
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                tickLine={{ stroke: '#4b5563' }}
                interval={2}
              />
              <YAxis
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                tickLine={{ stroke: '#4b5563' }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--surface-base)',
                  border: '1px solid #383838',
                  borderRadius: '0px',
                  color: '#e0e0e0',
                  fontSize: '11px',
                }}
              />
              <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>

        {/* Quick Actions + Shift Summary */}
        <div className="panel-beveled bg-surface-base">
          <PanelTitleBar title="QUICK ACTIONS" icon={Shield} />
          <div className="p-3 space-y-2">
            <button className="w-full toolbar-btn toolbar-btn-primary justify-center" onClick={() => navigate('/dispatch')}>
              <Plus style={{ width: 12, height: 12 }} />
              New Call for Service
            </button>
            <button className="w-full toolbar-btn justify-center" onClick={() => navigate('/incidents')}>
              <FileText style={{ width: 12, height: 12 }} />
              New Incident Report
            </button>
            <button className="w-full toolbar-btn justify-center" onClick={() => navigate('/personnel')}>
              <LogIn style={{ width: 12, height: 12 }} />
              Clock In / Out
            </button>
            <button className="w-full toolbar-btn justify-center" onClick={() => navigate('/map')}>
              <MapPin style={{ width: 12, height: 12 }} />
              Tactical Map
            </button>
            <button className="w-full toolbar-btn justify-center" onClick={() => navigate('/warrants')}>
              <Gavel style={{ width: 12, height: 12 }} />
              Active Warrants
            </button>
          </div>

          {/* Weather */}
          <div className="mt-3">
            <WeatherWidget />
          </div>

          {/* Shift Summary */}
          <div className="mt-4 pt-3 border-t border-rmpg-700 px-3 pb-3">
            <h4 className="text-[10px] font-bold text-rmpg-400 uppercase mb-3 tracking-wider flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3" />
              Shift Summary
            </h4>

            {/* Unit Utilization Bar */}
            <div className="mb-3">
              <div className="flex justify-between text-[9px] mb-1">
                <span className="text-rmpg-400 uppercase font-bold">Unit Utilization</span>
                <span className="text-green-400 font-mono font-bold">
                  {stats.units_total > 0 ? Math.round((stats.units_available / stats.units_total) * 100) : 0}%
                </span>
              </div>
              <div className="h-2 bg-rmpg-700 overflow-hidden rounded-sm">
                <div
                  className={`h-full transition-all duration-500 ${stats.units_total > 0 && (stats.units_available / stats.units_total) < 0.3 ? 'bg-red-500' : 'bg-green-500'}`}
                  style={{ width: `${stats.units_total > 0 ? (stats.units_available / stats.units_total) * 100 : 0}%` }}
                />
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between cursor-pointer hover:bg-rmpg-700/30 -mx-1 px-1 py-0.5 transition-colors" onClick={() => navigate('/dispatch')}>
                <span className="text-rmpg-300 flex items-center gap-1.5"><Phone className="w-3 h-3" /> Calls Handled:</span>
                <span className="text-green-400 font-mono font-semibold">{stats.calls_today}</span>
              </div>
              <div className="flex justify-between cursor-pointer hover:bg-rmpg-700/30 -mx-1 px-1 py-0.5 transition-colors" onClick={() => navigate('/incidents')}>
                <span className="text-rmpg-300 flex items-center gap-1.5"><FileText className="w-3 h-3" /> Incidents Filed:</span>
                <span className="text-green-400 font-mono font-semibold">{stats.incidents_today}</span>
              </div>
              <div className="flex justify-between cursor-pointer hover:bg-rmpg-700/30 -mx-1 px-1 py-0.5 transition-colors" onClick={() => navigate('/personnel')}>
                <span className="text-rmpg-300 flex items-center gap-1.5"><Radio className="w-3 h-3" /> Units on Duty:</span>
                <span className="text-green-400 font-mono font-semibold">{stats.units_available} / {stats.units_total}</span>
              </div>
              <div className="flex justify-between cursor-pointer hover:bg-rmpg-700/30 -mx-1 px-1 py-0.5 transition-colors" onClick={() => navigate('/reports')}>
                <span className="text-rmpg-300 flex items-center gap-1.5"><Clock className="w-3 h-3" /> Avg Response:</span>
                <span className="text-green-400 font-mono font-semibold">
                  {stats.avg_response_time_minutes ? `${stats.avg_response_time_minutes} min` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between cursor-pointer hover:bg-rmpg-700/30 -mx-1 px-1 py-0.5 transition-colors" onClick={() => navigate('/warrants')}>
                <span className="text-rmpg-300 flex items-center gap-1.5"><Gavel className="w-3 h-3" /> Active Warrants:</span>
                <span className="text-amber-400 font-mono font-semibold">{activeWarrants}</span>
              </div>
              <div className="flex justify-between cursor-pointer hover:bg-rmpg-700/30 -mx-1 px-1 py-0.5 transition-colors" onClick={() => navigate('/communications')}>
                <span className="text-rmpg-300 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" /> Active BOLOs:</span>
                <span className="text-red-400 font-mono font-semibold">{stats.active_bolos}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Activity Feed + Operational Alerts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Activity Feed */}
        <div className="lg:col-span-2 panel-beveled bg-surface-base">
          <PanelTitleBar title="RECENT ACTIVITY" icon={Activity}>
            <button
              className="toolbar-btn flex items-center gap-1"
              onClick={() => navigate('/audit')}
              title="View full audit log"
            >
              <Eye style={{ width: 10, height: 10 }} />
              <span className="text-[9px]">View All</span>
            </button>
          </PanelTitleBar>
          <div className="p-3">
            <ActivityFeed entries={activities} maxHeight="320px" />
          </div>
        </div>

        {/* Operational Summary */}
        <div className="panel-beveled bg-surface-base">
          <PanelTitleBar title="OPERATIONAL STATUS" icon={Radio} />
          <div className="p-3 space-y-3">
            {/* Active Warrant Alerts */}
            <div
              className={`flex items-center gap-3 p-2.5 panel-beveled cursor-pointer hover:bg-amber-900/10 transition-colors bg-surface-sunken border-l-[3px] ${activeWarrants > 0 ? 'border-l-amber-500' : 'border-l-rmpg-600'}`}
              onClick={() => navigate('/warrants')}
            >
              <Gavel className={`w-4 h-4 ${activeWarrants > 0 ? 'text-amber-400' : 'text-rmpg-500'}`} />
              <div className="flex-1">
                <div className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wide">Active Warrants</div>
                <div className={`text-lg font-bold font-mono ${activeWarrants > 0 ? 'text-amber-400' : 'text-green-400'}`}>{activeWarrants}</div>
              </div>
              {activeWarrants > 0 && <span className="led-dot led-amber animate-led-pulse" />}
            </div>

            {/* Active BOLOs */}
            <div
              className={`flex items-center gap-3 p-2.5 panel-beveled cursor-pointer hover:bg-red-900/10 transition-colors bg-surface-sunken border-l-[3px] ${stats.active_bolos > 0 ? 'border-l-red-500' : 'border-l-rmpg-600'}`}
              onClick={() => navigate('/communications')}
            >
              <AlertTriangle className={`w-4 h-4 ${stats.active_bolos > 0 ? 'text-red-400' : 'text-rmpg-500'}`} />
              <div className="flex-1">
                <div className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wide">Active BOLOs</div>
                <div className={`text-lg font-bold font-mono ${stats.active_bolos > 0 ? 'text-red-400' : 'text-green-400'}`}>{stats.active_bolos}</div>
              </div>
              {stats.active_bolos > 0 && <span className="led-dot led-red animate-led-pulse" />}
            </div>

            {/* Officers on Duty */}
            <div
              className="flex items-center gap-3 p-2.5 panel-beveled cursor-pointer hover:bg-green-900/10 transition-colors bg-surface-sunken border-l-[3px] border-l-green-500"
              onClick={() => navigate('/personnel')}
            >
              <Users className={`w-4 h-4 text-green-400`} />
              <div className="flex-1">
                <div className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wide">Officers on Duty</div>
                <div className="text-lg font-bold font-mono text-green-400">{stats.officers_on_duty}</div>
              </div>
            </div>

            {/* Credential Alerts Quick Summary */}
            <div
              className={`flex items-center gap-3 p-2.5 panel-beveled cursor-pointer hover:bg-rmpg-700/30 transition-colors bg-surface-sunken border-l-[3px] ${expiringCredentials.length > 0 ? 'border-l-amber-500' : 'border-l-green-500'}`}
              onClick={() => navigate('/personnel')}
            >
              <Shield className={`w-4 h-4 ${expiringCredentials.length > 0 ? 'text-amber-400' : 'text-green-400'}`} />
              <div className="flex-1">
                <div className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wide">Credential Alerts</div>
                <div className={`text-lg font-bold font-mono ${expiringCredentials.length > 0 ? 'text-amber-400' : 'text-green-400'}`}>{expiringCredentials.length}</div>
              </div>
              {expiringCredentials.length > 0 && <span className="led-dot led-amber" />}
            </div>
          </div>
        </div>
      </div>

      {/* Credential Alerts */}
      <div className="panel-beveled bg-surface-base">
        <PanelTitleBar title="CREDENTIAL ALERTS" icon={Shield} />
        <div className="p-3">
          {expiringCredentials.length === 0 ? (
            <div className="flex items-center gap-2 py-4 justify-center">
              <span className="led-dot led-green" />
              <span className="text-xs text-rmpg-300">All credentials current</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-rmpg-600">
                    <th className="px-3 py-2 text-left text-rmpg-400 font-semibold uppercase text-[10px]">Officer</th>
                    <th className="px-3 py-2 text-left text-rmpg-400 font-semibold uppercase text-[10px]">Credential</th>
                    <th className="px-3 py-2 text-left text-rmpg-400 font-semibold uppercase text-[10px]">Expiry Date</th>
                    <th className="px-3 py-2 text-left text-rmpg-400 font-semibold uppercase text-[10px]">Days Left</th>
                    <th className="px-3 py-2 text-left text-rmpg-400 font-semibold uppercase text-[10px]">Status</th>
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
                      <tr key={cred.id ?? idx} className="border-b border-rmpg-700/50 hover:bg-rmpg-800/50">
                        <td className="px-3 py-2 text-rmpg-200">{cred.officer_name || cred.user_name || '-'}</td>
                        <td className="px-3 py-2 text-rmpg-200">{cred.credential_type || cred.type || '-'}</td>
                        <td className="px-3 py-2 text-rmpg-200 font-mono">{exp.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })}</td>
                        <td className="px-3 py-2 font-mono font-bold" style={{ color: isExpired ? '#ef4444' : isUrgent ? '#f59e0b' : '#22c55e' }}>
                          {isExpired ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d`}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`led-dot ${isExpired ? 'led-red animate-led-blink' : isUrgent ? 'led-amber' : 'led-green'}`} />
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

      {/* Integration Hub — admin/manager only */}
      {user && (user.role === 'admin' || user.role === 'manager') && (
        <IntegrationHub onSetupClick={(id) => navigate(`/admin?tab=${id}`)} />
      )}
    </div>
  );
}
