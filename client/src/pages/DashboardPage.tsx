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
import { apiFetch } from '../hooks/useApi';
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
  const [officerActivity, setOfficerActivity] = useState<{ id: number; full_name: string; badge_number: string; role: string; action_count: number }[]>([]);
  const [psoStats, setPsoStats] = useState<PsoStats | null>(null);
  const navigate = useNavigate();
  const isMobile = useIsMobile();

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
      if (dashboardRaw.pso) setPsoStats(dashboardRaw.pso);
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

  // Fetch officer activity comparison
  const fetchOfficerActivity = useCallback(async () => {
    try {
      const data = await apiFetch<any[]>('/reports/officer-activity');
      setOfficerActivity(data || []);
    } catch {
      setOfficerActivity([]);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
    fetchCredentials();
    fetchOfficerActivity();

    // Refresh every 60 seconds (LiveSync handles real-time updates)
    const interval = setInterval(() => { fetchDashboardData({ silent: true }); fetchCredentials(); fetchOfficerActivity(); }, 60_000);
    return () => clearInterval(interval);
  }, [fetchDashboardData, fetchCredentials, fetchOfficerActivity]);

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
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
          {/* Blue accent line */}
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #0e3359, #1a5a9e 30%, #1a5a9e 70%, #0e3359)' }} />
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
      <div className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3'}`}>
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
      <div className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2'}`}>
        {[
          { key: 'P1', label: 'P1 Emergency', led: 'led-red', border: 'border-l-red-500', count: stats.calls_by_priority.P1 },
          { key: 'P2', label: 'P2 Urgent', led: 'led-amber', border: 'border-l-amber-500', count: stats.calls_by_priority.P2 },
          { key: 'P3', label: 'P3 Routine', led: 'led-blue', border: 'border-l-brand-500', count: stats.calls_by_priority.P3 },
          { key: 'P4', label: 'P4 Scheduled', led: 'led-off', border: 'border-l-gray-500', count: stats.calls_by_priority.P4 },
        ].map(({ key, label, led, border, count }) => (
          <div
            key={key}
            onClick={() => navigate('/dispatch')}
            className={`flex items-center gap-3 ${isMobile ? 'p-3 min-h-[56px]' : 'p-2'} panel-beveled border-l-4 ${border} cursor-pointer hover:bg-surface-raised transition-all duration-150 group bg-surface-base`}
            title={`View ${key} calls in Dispatch`}
          >
            <span className={`led-dot ${led}`} />
            <div className="flex-1">
              <div className={`${isMobile ? 'text-2xl' : 'text-lg'} font-bold text-green-400 font-mono`}>{count}</div>
              <div className={`${isMobile ? 'text-[10px]' : 'text-[9px]'} text-rmpg-400 uppercase font-bold tracking-wide`}>{label}</div>
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
        {/* Calls by Hour — Area Chart with Gradient */}
        <div className="lg:col-span-2 panel-beveled bg-surface-base">
          <PanelTitleBar title="CALLS BY HOUR — TODAY" icon={Activity} />
          <div className="p-3">
          <ResponsiveContainer width="100%" height={isMobile ? 160 : 220}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="callsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1a5a9e" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#1a5a9e" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#162236" />
              <XAxis
                dataKey="label"
                tick={{ fill: '#5a6e80', fontSize: 9 }}
                tickLine={{ stroke: '#1e3048' }}
                axisLine={{ stroke: '#1e3048' }}
                interval={2}
              />
              <YAxis
                tick={{ fill: '#5a6e80', fontSize: 9 }}
                tickLine={{ stroke: '#1e3048' }}
                axisLine={{ stroke: '#1e3048' }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--surface-base)',
                  border: '1px solid #2a3e58',
                  borderRadius: '0px',
                  color: '#d0d8e0',
                  fontSize: '11px',
                }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#1a5a9e"
                strokeWidth={2}
                fill="url(#callsGradient)"
                dot={{ fill: '#1a5a9e', r: 2, strokeWidth: 0 }}
                activeDot={{ fill: '#3b8ad4', r: 4, strokeWidth: 2, stroke: '#ffffff' }}
              />
            </AreaChart>
          </ResponsiveContainer>
          </div>
        </div>

        {/* Priority Distribution Pie + Quick Actions */}
        <div className="panel-beveled bg-surface-base flex flex-col">
          <PanelTitleBar title="PRIORITY DISTRIBUTION" icon={Shield} />
          <div className="p-3 flex-1">
            {/* Pie Chart */}
            {(() => {
              const totalCalls = stats.calls_by_priority.P1 + stats.calls_by_priority.P2 + stats.calls_by_priority.P3 + stats.calls_by_priority.P4;
              const pieData = [
                { name: 'P1 Emergency', value: stats.calls_by_priority.P1, fill: '#dc2626' },
                { name: 'P2 Urgent', value: stats.calls_by_priority.P2, fill: '#f59e0b' },
                { name: 'P3 Routine', value: stats.calls_by_priority.P3, fill: '#1a5a9e' },
                { name: 'P4 Scheduled', value: stats.calls_by_priority.P4, fill: '#4b5563' },
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
                      {pieData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--surface-base)',
                        border: '1px solid #2a3e58',
                        borderRadius: '0px',
                        color: '#d0d8e0',
                        fontSize: '11px',
                      }}
                      formatter={(value: number) => [`${value} calls`, '']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[140px]">
                  <span className="text-[10px] text-rmpg-500 uppercase tracking-wider">No calls today</span>
                </div>
              );
            })()}

            {/* Pie Legend */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1">
              {[
                { key: 'P1', label: 'Emergency', color: '#dc2626', count: stats.calls_by_priority.P1 },
                { key: 'P2', label: 'Urgent', color: '#f59e0b', count: stats.calls_by_priority.P2 },
                { key: 'P3', label: 'Routine', color: '#1a5a9e', count: stats.calls_by_priority.P3 },
                { key: 'P4', label: 'Scheduled', color: '#4b5563', count: stats.calls_by_priority.P4 },
              ].map(({ key, label, color, count }) => (
                <div key={key} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-[9px] text-rmpg-400 truncate">{key} {label}</span>
                  <span className="text-[9px] font-mono font-bold text-rmpg-200 ml-auto">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions — compact */}
          <div className="border-t border-rmpg-700 px-3 py-2 space-y-1.5">
            <h4 className="text-[9px] font-bold text-rmpg-500 uppercase tracking-wider">Quick Actions</h4>
            <div className="grid grid-cols-2 gap-1.5">
              <button className={`toolbar-btn toolbar-btn-primary justify-center ${isMobile ? 'text-xs min-h-[48px]' : 'text-[10px]'}`} onClick={() => navigate('/dispatch')}>
                <Plus style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> New Call
              </button>
              <button className={`toolbar-btn justify-center ${isMobile ? 'text-xs min-h-[48px]' : 'text-[10px]'}`} onClick={() => navigate('/incidents')}>
                <FileText style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Incident
              </button>
              <button className={`toolbar-btn justify-center ${isMobile ? 'text-xs min-h-[48px]' : 'text-[10px]'}`} onClick={() => navigate('/map')}>
                <MapPin style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Map
              </button>
              <button className={`toolbar-btn justify-center ${isMobile ? 'text-xs min-h-[48px]' : 'text-[10px]'}`} onClick={() => window.open('/warrants', '_blank', 'noopener,noreferrer')}>
                <Gavel style={{ width: isMobile ? 14 : 10, height: isMobile ? 14 : 10 }} /> Warrants
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Shift Summary Row */}
      <div className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2'}`}>
        {[
          { icon: Phone, label: 'Calls Handled', value: stats.calls_today, color: '#3b82f6', path: '/dispatch' },
          { icon: FileText, label: 'Incidents Filed', value: stats.incidents_today, color: '#22c55e', path: '/incidents' },
          { icon: Radio, label: 'Units on Duty', value: `${stats.units_available}/${stats.units_total}`, color: '#22c55e', path: '/personnel' },
          { icon: Clock, label: 'Avg Response', value: stats.avg_response_time_minutes ? `${stats.avg_response_time_minutes}m` : 'N/A', color: '#1a5a9e', path: '/reports' },
          { icon: Gavel, label: 'Active Warrants', value: activeWarrants, color: '#f59e0b', path: '/warrants' },
          { icon: AlertTriangle, label: 'Active BOLOs', value: stats.active_bolos, color: stats.active_bolos > 0 ? '#ef4444' : '#22c55e', path: '/communications' },
        ].map(({ icon: Icon, label, value, color, path }) => (
          <div
            key={label}
            onClick={() => navigate(path)}
            className={`panel-beveled bg-surface-sunken ${isMobile ? 'p-3 min-h-[64px]' : 'p-2.5'} cursor-pointer hover:bg-surface-raised transition-colors group`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`${isMobile ? 'w-4 h-4' : 'w-3.5 h-3.5'}`} style={{ color }} />
              <span className={`${isMobile ? 'text-[10px]' : 'text-[9px]'} text-rmpg-500 uppercase font-bold tracking-wide truncate`}>{label}</span>
            </div>
            <div className={`${isMobile ? 'text-2xl' : 'text-lg'} font-bold font-mono`} style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

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
          <div className="panel-beveled bg-surface-base">
            <PanelTitleBar title="PSO OPERATIONS — THIS MONTH" icon={Briefcase} />
            <div className="p-3 space-y-3">
              {/* PSO Stats Cards */}
              <div className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2'}`}>
                <div className="panel-beveled bg-surface-sunken p-2.5 border-l-[3px] border-l-brand-500">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Briefcase className="w-3 h-3 text-brand-400" />
                    <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">Active PSO</span>
                  </div>
                  <div className="text-lg font-bold font-mono text-brand-400">{psoStats.activeCalls}</div>
                </div>
                <div className="panel-beveled bg-surface-sunken p-2.5 border-l-[3px] border-l-blue-500">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Phone className="w-3 h-3 text-blue-400" />
                    <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">Today</span>
                  </div>
                  <div className="text-lg font-bold font-mono text-blue-400">{psoStats.todayCalls}</div>
                </div>
                <div className="panel-beveled bg-surface-sunken p-2.5 border-l-[3px] border-l-green-500">
                  <div className="flex items-center gap-1.5 mb-1">
                    <CheckCircle className="w-3 h-3 text-green-400" />
                    <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">Completed</span>
                  </div>
                  <div className="text-lg font-bold font-mono text-green-400">{psoStats.monthCompleted}<span className="text-[10px] text-rmpg-500 ml-1">/ {psoStats.monthCalls}</span></div>
                </div>
                <div className="panel-beveled bg-surface-sunken p-2.5 border-l-[3px]" style={{ borderLeftColor: serveRate !== null && serveRate >= 70 ? '#22c55e' : serveRate !== null ? '#f59e0b' : '#5a6e80' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Target className="w-3 h-3" style={{ color: serveRate !== null && serveRate >= 70 ? '#22c55e' : '#f59e0b' }} />
                    <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">Serve Rate</span>
                  </div>
                  <div className="text-lg font-bold font-mono" style={{ color: serveRate !== null && serveRate >= 70 ? '#22c55e' : serveRate !== null ? '#f59e0b' : '#5a6e80' }}>
                    {serveRate !== null ? `${serveRate}%` : 'N/A'}
                  </div>
                </div>
                <div className="panel-beveled bg-surface-sunken p-2.5 border-l-[3px] border-l-amber-500">
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingUp className="w-3 h-3 text-amber-400" />
                    <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">Avg Attempts</span>
                  </div>
                  <div className="text-lg font-bold font-mono text-amber-400">{psoStats.avgAttempts ?? 'N/A'}</div>
                </div>
                <div className="panel-beveled bg-surface-sunken p-2.5 border-l-[3px] border-l-brand-500">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className="w-3 h-3 text-brand-400" />
                    <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide">PSO Response</span>
                  </div>
                  <div className="text-lg font-bold font-mono text-brand-400">{psoStats.avgResponseMinutes ? `${psoStats.avgResponseMinutes}m` : 'N/A'}</div>
                </div>
              </div>

              {/* Service Type Breakdown + Serve Results */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* Service Type Breakdown */}
                {psoStats.byServiceType.length > 0 && (
                  <div className="panel-beveled bg-surface-sunken p-2.5">
                    <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-2">By Service Type</div>
                    <div className="space-y-1.5">
                      {psoStats.byServiceType.map(st => {
                        const pct = psoStats.monthCalls > 0 ? Math.round((st.count / psoStats.monthCalls) * 100) : 0;
                        return (
                          <div key={st.pso_service_type} className="flex items-center gap-2">
                            <span className="text-[10px] text-rmpg-300 w-28 truncate capitalize">{SERVICE_TYPE_LABELS[st.pso_service_type] || st.pso_service_type.replace(/_/g, ' ')}</span>
                            <div className="flex-1 h-1.5 bg-rmpg-700 rounded-full overflow-hidden">
                              <div className="h-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[10px] font-mono text-rmpg-300 w-12 text-right">{st.count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Process Service Results */}
                {psoStats.serveResults.total > 0 && (
                  <div className="panel-beveled bg-surface-sunken p-2.5">
                    <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-2">Process Service Results</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-3 h-3 text-green-400" />
                        <span className="text-[10px] text-rmpg-300">Served</span>
                        <span className="text-[10px] font-mono font-bold text-green-400 ml-auto">{psoStats.serveResults.served}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <XCircle className="w-3 h-3 text-red-400" />
                        <span className="text-[10px] text-rmpg-300">Not Served</span>
                        <span className="text-[10px] font-mono font-bold text-red-400 ml-auto">{psoStats.serveResults.notServed}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3 h-3 text-amber-400" />
                        <span className="text-[10px] text-rmpg-300">Refused</span>
                        <span className="text-[10px] font-mono font-bold text-amber-400 ml-auto">{psoStats.serveResults.refused}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="w-3 h-3 text-rmpg-400" />
                        <span className="text-[10px] text-rmpg-300">Pending</span>
                        <span className="text-[10px] font-mono font-bold text-rmpg-400 ml-auto">{psoStats.serveResults.pendingResult}</span>
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
              onClick={() => window.open('/warrants', '_blank', 'noopener,noreferrer')}
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
                    {!isMobile && <th className="px-3 py-2 text-left text-rmpg-400 font-semibold uppercase text-[10px]">Expiry Date</th>}
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
                      <tr key={cred.id ?? idx} className={`border-b border-rmpg-700/50 hover:bg-rmpg-800/50 ${isMobile ? 'min-h-[48px]' : ''}`}>
                        <td className="px-3 py-2 text-rmpg-200">{cred.officer_name || cred.user_name || '-'}</td>
                        <td className="px-3 py-2 text-rmpg-200">{cred.credential_type || cred.type || '-'}</td>
                        {!isMobile && <td className="px-3 py-2 text-rmpg-200 font-mono">{exp.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })}</td>}
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

      {/* Officer Activity Comparison */}
      {officerActivity.length > 0 && (() => {
        const ROLE_COLORS: Record<string, string> = {
          admin: '#ef4444',
          supervisor: '#f59e0b',
          manager: '#3b82f6',
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
          fill: ROLE_COLORS[o.role] || '#5a6e80',
        }));

        return (
          <div className="panel-beveled bg-surface-base">
            <PanelTitleBar title="OFFICER ACTIVITY COMPARISON — LAST 30 DAYS" icon={Users} />
            <div className="p-3">
              {/* Role Legend */}
              <div className="flex items-center gap-4 mb-3">
                {ROLE_ORDER.map(role => (
                  <div key={role} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: ROLE_COLORS[role] }} />
                    <span className="text-[10px] text-rmpg-300 font-semibold uppercase tracking-wide">{ROLE_LABELS[role]}</span>
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={Math.max(180, chartRows.length * 32)}>
                <BarChart data={chartRows} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e3048" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#8a9aaa', fontSize: 10 }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={140}
                    tick={{ fill: '#b0bcc8', fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--surface-base)',
                      border: '1px solid #2a3e58',
                      borderRadius: '0px',
                      color: '#e0e0e0',
                      fontSize: '11px',
                    }}
                    formatter={(value: number, _name: string, props: any) => [
                      `${value} actions`,
                      `${ROLE_LABELS[props.payload.role] || props.payload.role} — Badge #${props.payload.badge || '—'}`,
                    ]}
                  />
                  <Bar dataKey="actions" radius={[0, 3, 3, 0]}>
                    {chartRows.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
