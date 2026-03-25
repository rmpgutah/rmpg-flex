import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity, Database, Server, Shield, Wifi,
  HardDrive, MemoryStick, RefreshCw, AlertTriangle, CheckCircle2,
  Radio, FileWarning, Cpu, Monitor, Tag,
  ChevronDown, ChevronRight, Zap, Disc, Globe, ArrowDown, ArrowUp, Network,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { formatFileSize, formatDuration, toDisplayLabel } from '../../utils/formatters';

// ============================================================
// System Health & Monitoring Tab
// ============================================================

interface NetworkInterface {
  name: string;
  ip: string;
  mac: string;
  internal: boolean;
  family: string;
}

interface HostData {
  hostname: string;
  platform: string;
  arch: string;
  osRelease: string;
  osType: string;
  hostUptime: number;
  cpu: { model: string; cores: number; speed: number; usagePercent: number | null };
  memory: { total: number; free: number; used: number };
  disk: { total: number; used: number; free: number };
  loadAverage: { '1m': number; '5m': number; '15m': number };
  network?: NetworkInterface[];
  networkIO?: { rxBytes: number; txBytes: number } | null;
  processCount?: number | null;
}

interface HealthData {
  version?: string;
  server: {
    uptime: number;
    memory: { rss: number; heapUsed: number; heapTotal: number; external: number };
    nodeVersion: string;
  };
  host?: HostData;
  database: {
    sizeBytes: number;
    tables: Record<string, number>;
  };
  operations: {
    activeSessions: number;
    activeUnits: number;
    pendingCalls: number;
    connectedClients: number;
  };
  loginStats: {
    successful24h: number;
    failed24h: number;
  };
  recentErrors: Array<{
    id: string;
    action: string;
    details: string;
    created_at: string;
  }>;
}

interface ChangelogEntry {
  version: string;
  date: string;
  type: 'major' | 'minor' | 'patch';
  summary: string;
  changes: Array<{ type: string; description: string }>;
}

interface ChangelogData {
  version: string;
  changelog: ChangelogEntry[];
}

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

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

export default function AdminHealthTab({ LoadingSpinner }: Props) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [changelog, setChangelog] = useState<ChangelogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [showChangelog, setShowChangelog] = useState(false);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());

  // Upgrade: Enhanced system health + user activity
  const [systemHealth, setSystemHealth] = useState<{
    database: { sizeBytes: number; sizeMB: number; tableCounts: Record<string, number> };
    server: { uptimeHours: number; memoryUsageMB: { rss: number; heapUsed: number; heapTotal: number }; nodeVersion: string };
    activity: { activeSessions: number; activityLastHour: number; recentErrors: number };
    system: { platform: string; cpus: number; totalMemoryMB: number; freeMemoryMB: number; loadAvg: number[] };
  } | null>(null);
  const [usersActivity, setUsersActivity] = useState<{
    data: { id: number; full_name: string; role: string; login_count: number; last_active_at: string; recent_action_count: number; incidents_30d: number; messages_30d: number }[];
  } | null>(null);
  const [realtimeStats, setRealtimeStats] = useState<{
    activeCalls: number; unitsOnDuty: number; pendingIncidents: number;
    activeBolos: number; activeSessions: number; todayActivity: number; todayCalls: number;
  } | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<HealthData>('/admin/health/detailed');
      setHealth(data);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Failed to fetch health data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchChangelog = useCallback(async () => {
    try {
      const data = await apiFetch<ChangelogData>('/admin/changelog');
      setChangelog(data);
    } catch (err) {
      console.error('Failed to fetch changelog:', err);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    fetchChangelog();
    // Upgrade: fetch new system health and activity data
    apiFetch<any>('/admin/system-health').then(d => d && setSystemHealth(d)).catch(() => {});
    apiFetch<any>('/admin/users-activity-summary?days=30').then(d => d && setUsersActivity(d)).catch(() => {});
    apiFetch<any>('/admin/realtime-stats').then(d => d && setRealtimeStats(d)).catch(() => {});
    const interval = setInterval(() => {
      fetchHealth();
      apiFetch<any>('/admin/realtime-stats').then(d => d && setRealtimeStats(d)).catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchHealth, fetchChangelog]);

  // Set document title
  useEffect(() => { document.title = 'Admin - Health \u2014 RMPG Flex'; }, []);

  const h = health;
  const heapPercent = h?.server?.memory?.heapTotal && h.server.memory.heapTotal > 0
    ? Math.round((h.server.memory.heapUsed / h.server.memory.heapTotal) * 100)
    : 0;
  const heapColor = heapPercent > 85 ? 'text-red-400' : heapPercent > 65 ? 'text-amber-400' : 'text-green-400';

  const failRate = h?.loginStats && (h.loginStats.successful24h + h.loginStats.failed24h) > 0
    ? Math.round((h.loginStats.failed24h / (h.loginStats.successful24h + h.loginStats.failed24h)) * 100)
    : 0;

  const host = h?.host;
  const ramPercent = host && host.memory.total > 0
    ? Math.round((host.memory.used / host.memory.total) * 100) : 0;
  const diskPercent = host && host.disk.total > 0
    ? Math.round((host.disk.used / host.disk.total) * 100) : 0;

  const toggleVersion = (v: string) => {
    setExpandedVersions(prev => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
  };

  const changeTypeBadge = (type: string) => {
    const styles: Record<string, string> = {
      feature: 'bg-green-900/40 text-green-400 border-green-800/50',
      enhancement: 'bg-blue-900/40 text-blue-400 border-blue-800/50',
      fix: 'bg-amber-900/40 text-amber-400 border-amber-800/50',
      security: 'bg-red-900/40 text-red-400 border-red-800/50',
    };
    return styles[type] || 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50';
  };

  const versionTypeBadge = (type: string) => {
    if (type === 'major') return 'bg-red-900/30 text-red-400 border-red-800/40';
    if (type === 'minor') return 'bg-blue-900/30 text-blue-400 border-blue-800/40';
    return 'bg-green-900/30 text-green-400 border-green-800/40';
  };

  if (!h) return <div className="p-6 text-rmpg-400 text-xs">Failed to load health data.</div>;
  if (loading && !health) return <LoadingSpinner />;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-brand-400" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-rmpg-200">System Health</h2>
          <span className="ml-2 flex items-center gap-1 text-green-400 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            OPERATIONAL
          </span>
          {h.version && (
            <button type="button"
              onClick={() => setShowChangelog(!showChangelog)}
              className="ml-3 flex items-center gap-1 px-2 py-0.5 rounded-sm border border-brand-600/40 bg-brand-950/30 text-brand-400 text-[10px] font-mono font-bold hover:bg-brand-900/40 transition-colors"
            >
              <Tag className="w-3 h-3" />
              v{h.version}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-rmpg-500">
            Last refresh: {lastRefresh.toLocaleTimeString()}
          </span>
          <button type="button"
            onClick={fetchHealth}
            disabled={loading}
            className="toolbar-btn text-[10px] flex items-center gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Upgrade: Real-time Operations Stats */}
      {realtimeStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {[
            { label: 'Active Calls', value: realtimeStats.activeCalls, color: 'text-red-400' },
            { label: 'Units On Duty', value: realtimeStats.unitsOnDuty, color: 'text-green-400' },
            { label: 'Pending Incidents', value: realtimeStats.pendingIncidents, color: 'text-amber-400' },
            { label: 'Active BOLOs', value: realtimeStats.activeBolos, color: 'text-orange-400' },
            { label: 'Active Sessions', value: realtimeStats.activeSessions, color: 'text-blue-400' },
            { label: "Today's Activity", value: realtimeStats.todayActivity, color: 'text-purple-400' },
            { label: "Today's Calls", value: realtimeStats.todayCalls, color: 'text-cyan-400' },
          ].map(item => (
            <div key={item.label} className="bg-surface-sunken p-2 text-center panel-beveled">
              <div className={`text-xl font-bold font-mono ${item.color}`}>{item.value}</div>
              <div className="text-[8px] text-rmpg-400 uppercase tracking-wider">{item.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Upgrade: Enhanced DB Stats */}
      {systemHealth && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-surface-sunken p-2 panel-beveled">
            <div className="text-[10px] text-rmpg-400 uppercase">DB Size</div>
            <div className="text-sm font-bold text-white font-mono">{systemHealth.database.sizeMB} MB</div>
          </div>
          <div className="bg-surface-sunken p-2 panel-beveled">
            <div className="text-[10px] text-rmpg-400 uppercase">Server Uptime</div>
            <div className="text-sm font-bold text-white font-mono">{systemHealth.server.uptimeHours}h</div>
          </div>
          <div className="bg-surface-sunken p-2 panel-beveled">
            <div className="text-[10px] text-rmpg-400 uppercase">Heap Used</div>
            <div className="text-sm font-bold text-white font-mono">{systemHealth.server.memoryUsageMB.heapUsed} MB</div>
          </div>
          <div className="bg-surface-sunken p-2 panel-beveled">
            <div className="text-[10px] text-rmpg-400 uppercase">Recent Errors</div>
            <div className={`text-sm font-bold font-mono ${systemHealth.activity.recentErrors > 0 ? 'text-red-400' : 'text-green-400'}`}>
              {systemHealth.activity.recentErrors}
            </div>
          </div>
        </div>
      )}

      {/* Upgrade: Top Users by Activity (30d) */}
      {usersActivity && usersActivity.data.length > 0 && (
        <div className="panel-beveled bg-surface-base p-3">
          <div className="flex items-center gap-2 mb-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
            <Shield className="w-3.5 h-3.5 text-brand-400" />
            User Activity (30 days)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-rmpg-400 border-b border-rmpg-700/50">
                  <th className="text-left py-1 px-2">User</th>
                  <th className="text-left py-1 px-2">Role</th>
                  <th className="text-right py-1 px-2">Actions</th>
                  <th className="text-right py-1 px-2">Incidents</th>
                  <th className="text-right py-1 px-2">Messages</th>
                  <th className="text-right py-1 px-2">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {usersActivity.data.slice(0, 10).map((u: any) => (
                  <tr key={u.id} className="border-b border-rmpg-700/20 hover:bg-surface-raised">
                    <td className="py-1 px-2 text-white font-bold">{u.full_name}</td>
                    <td className="py-1 px-2 text-rmpg-400">{u.role}</td>
                    <td className="py-1 px-2 text-right font-mono text-brand-400">{u.recent_action_count}</td>
                    <td className="py-1 px-2 text-right font-mono">{u.incidents_30d}</td>
                    <td className="py-1 px-2 text-right font-mono">{u.messages_30d}</td>
                    <td className="py-1 px-2 text-right text-rmpg-500">{u.last_active_at ? timeAgo(u.last_active_at) : 'never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Changelog Panel (collapsible) */}
      {showChangelog && changelog && (
        <div className="panel-beveled bg-surface-base p-3 space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
            <Tag className="w-3.5 h-3.5" />
            Version History
          </div>
          <div className="space-y-1 max-h-64 overflow-y-auto scrollbar-dark">
            {changelog.changelog.map((entry) => (
              <div key={entry.version} className="border border-rmpg-700/50 rounded-sm overflow-hidden">
                <button type="button"
                  onClick={() => toggleVersion(entry.version)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-sunken transition-colors"
                >
                  {expandedVersions.has(entry.version) ? (
                    <ChevronDown className="w-3 h-3 text-rmpg-400 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-rmpg-400 shrink-0" />
                  )}
                  <span className="text-[11px] font-mono font-bold text-rmpg-100">v{entry.version}</span>
                  <span className={`px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase border ${versionTypeBadge(entry.type)}`}>
                    {toDisplayLabel(entry.type)}
                  </span>
                  <span className="text-[10px] text-rmpg-400 flex-1">{entry.summary}</span>
                  <span className="text-[9px] text-rmpg-500 font-mono">{entry.date}</span>
                </button>
                {expandedVersions.has(entry.version) && (
                  <div className="px-3 pb-2 space-y-1 bg-surface-sunken/50">
                    {entry.changes.map((change, i) => (
                      <div key={i} className="flex items-start gap-2 py-0.5">
                        <span className={`px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase border shrink-0 mt-0.5 ${changeTypeBadge(change.type)}`}>
                          {toDisplayLabel(change.type)}
                        </span>
                        <span className="text-[10px] text-rmpg-300">{change.description}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          icon={Server}
          label="Uptime"
          value={formatDuration(h.server.uptime)}
          sub={`Node ${h.server.nodeVersion}`}
          color="text-blue-400"
        />
        <MetricCard
          icon={HardDrive}
          label="Database"
          value={formatFileSize(h.database.sizeBytes)}
          sub={`${Object.keys(h.database.tables).length} tables`}
          color="text-purple-400"
        />
        <MetricCard
          icon={Wifi}
          label="Connected"
          value={String(h.operations.connectedClients)}
          sub={`${h.operations.activeSessions} sessions`}
          color="text-cyan-400"
        />
        <MetricCard
          icon={Radio}
          label="Active Units"
          value={String(h.operations.activeUnits)}
          sub={`${h.operations.pendingCalls} pending calls`}
          color="text-amber-400"
        />
      </div>

      {/* VPS / Host Health */}
      {host && (
        <div className="panel-beveled bg-surface-base p-3 space-y-3">
          <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
            <Monitor className="w-3.5 h-3.5" />
            VPS / Host Health
            <span className="ml-auto text-[9px] font-mono text-rmpg-500 normal-case font-normal">
              {host.hostname}
            </span>
          </div>

          {/* Host Overview Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-surface-sunken p-2 rounded-sm">
              <div className="text-[9px] text-rmpg-500 uppercase">Platform</div>
              <div className="text-[11px] font-mono font-bold text-rmpg-200">{host.osType} {host.arch}</div>
              <div className="text-[9px] text-rmpg-500">{host.osRelease}</div>
            </div>
            <div className="bg-surface-sunken p-2 rounded-sm">
              <div className="text-[9px] text-rmpg-500 uppercase">Host Uptime</div>
              <div className="text-[11px] font-mono font-bold text-rmpg-200">{formatDuration(host.hostUptime)}</div>
            </div>
            <div className="bg-surface-sunken p-2 rounded-sm">
              <div className="text-[9px] text-rmpg-500 uppercase">CPU</div>
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-mono font-bold text-rmpg-200">{host.cpu.cores} cores</span>
                {host.cpu.usagePercent != null && (
                  <span className={`text-[10px] font-mono font-bold ${host.cpu.usagePercent > 85 ? 'text-red-400' : host.cpu.usagePercent > 65 ? 'text-amber-400' : 'text-green-400'}`}>
                    {host.cpu.usagePercent}%
                  </span>
                )}
              </div>
              <div className="text-[9px] text-rmpg-500 truncate">{host.cpu.model}</div>
            </div>
            <div className="bg-surface-sunken p-2 rounded-sm">
              <div className="text-[9px] text-rmpg-500 uppercase">Load Average</div>
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-mono font-bold text-rmpg-200">{host.loadAverage['1m']}</span>
                <span className="text-[9px] font-mono text-rmpg-400">{host.loadAverage['5m']}</span>
                <span className="text-[9px] font-mono text-rmpg-500">{host.loadAverage['15m']}</span>
              </div>
              <div className="text-[9px] text-rmpg-500">1m / 5m / 15m</div>
            </div>
          </div>

          {/* RAM & Disk Bars */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] text-rmpg-400">
                <MemoryStick className="w-3 h-3" />
                <span>RAM</span>
                <span className="ml-auto font-mono text-rmpg-300">
                  {formatFileSize(host.memory.used)} / {formatFileSize(host.memory.total)}
                </span>
              </div>
              <div className="h-2.5 bg-rmpg-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${ramPercent > 85 ? 'bg-red-500' : ramPercent > 65 ? 'bg-amber-500' : 'bg-cyan-500'}`}
                  style={{ width: `${ramPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[9px]">
                <span className="text-rmpg-500">{formatFileSize(host.memory.free)} free</span>
                <span className={`font-mono font-bold ${ramPercent > 85 ? 'text-red-400' : ramPercent > 65 ? 'text-amber-400' : 'text-cyan-400'}`}>
                  {ramPercent}%
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] text-rmpg-400">
                <Disc className="w-3 h-3" />
                <span>Disk</span>
                <span className="ml-auto font-mono text-rmpg-300">
                  {host.disk.total > 0 ? `${formatFileSize(host.disk.used)} / ${formatFileSize(host.disk.total)}` : 'N/A'}
                </span>
              </div>
              <div className="h-2.5 bg-rmpg-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${diskPercent > 90 ? 'bg-red-500' : diskPercent > 75 ? 'bg-amber-500' : 'bg-purple-500'}`}
                  style={{ width: `${diskPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[9px]">
                <span className="text-rmpg-500">{host.disk.free > 0 ? `${formatFileSize(host.disk.free)} free` : ''}</span>
                <span className={`font-mono font-bold ${diskPercent > 90 ? 'text-red-400' : diskPercent > 75 ? 'text-amber-400' : 'text-purple-400'}`}>
                  {diskPercent}%
                </span>
              </div>
            </div>
          </div>

          {/* CPU Usage Bar */}
          {host.cpu.usagePercent != null && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] text-rmpg-400">
                <Cpu className="w-3 h-3" />
                <span>CPU Usage</span>
                <span className="ml-auto font-mono text-rmpg-300">
                  {host.cpu.usagePercent}% across {host.cpu.cores} cores
                </span>
              </div>
              <div className="h-2.5 bg-rmpg-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${host.cpu.usagePercent > 85 ? 'bg-red-500' : host.cpu.usagePercent > 65 ? 'bg-amber-500' : 'bg-green-500'}`}
                  style={{ width: `${Math.min(host.cpu.usagePercent, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Network & Process Info */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {/* Network Interfaces */}
            {host.network && host.network.filter(n => !n.internal).length > 0 && (
              <div className="bg-surface-sunken p-2 rounded-sm col-span-1">
                <div className="flex items-center gap-1 text-[9px] text-rmpg-500 uppercase mb-1">
                  <Globe className="w-3 h-3" />
                  Network
                </div>
                {host.network.filter(n => !n.internal).map((iface, i) => (
                  <div key={i} className="mb-1 last:mb-0">
                    <div className="text-[11px] font-mono font-bold text-rmpg-200">{iface.ip}</div>
                    <div className="text-[9px] text-rmpg-500">{iface.name} — {iface.mac}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Network I/O */}
            {host.networkIO && (
              <div className="bg-surface-sunken p-2 rounded-sm">
                <div className="flex items-center gap-1 text-[9px] text-rmpg-500 uppercase mb-1">
                  <Network className="w-3 h-3" />
                  Network I/O
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <ArrowDown className="w-3 h-3 text-green-400" />
                    <span className="text-[10px] text-rmpg-400">RX</span>
                    <span className="text-[11px] font-mono font-bold text-green-400 ml-auto">{formatFileSize(host.networkIO.rxBytes)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ArrowUp className="w-3 h-3 text-blue-400" />
                    <span className="text-[10px] text-rmpg-400">TX</span>
                    <span className="text-[11px] font-mono font-bold text-blue-400 ml-auto">{formatFileSize(host.networkIO.txBytes)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Process Count */}
            {host.processCount != null && (
              <div className="bg-surface-sunken p-2 rounded-sm">
                <div className="text-[9px] text-rmpg-500 uppercase">Processes</div>
                <div className="text-lg font-mono font-bold text-rmpg-200">{host.processCount}</div>
                <div className="text-[9px] text-rmpg-500">running</div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Node.js Memory Usage */}
        <div className="panel-beveled bg-surface-base p-3 space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
            <Cpu className="w-3.5 h-3.5" />
            Node.js Memory
          </div>
          <div className="space-y-1.5">
            <MemoryBar label="Heap Used" current={h.server.memory.heapUsed} total={h.server.memory.heapTotal} />
            <MemoryBar label="RSS" current={h.server.memory.rss} total={h.server.memory.rss * 1.5} />
            <MemoryBar label="External" current={h.server.memory.external} total={h.server.memory.heapTotal} />
          </div>
          <div className="flex items-center justify-between text-[10px] pt-1 border-t border-rmpg-700">
            <span className="text-rmpg-400">Heap Usage</span>
            <span className={`font-mono font-bold ${heapColor}`}>{heapPercent}%</span>
          </div>
        </div>

        {/* Login Stats */}
        <div className="panel-beveled bg-surface-base p-3 space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
            <Shield className="w-3.5 h-3.5" />
            Login Activity (24h)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="bg-surface-sunken p-2 rounded-sm">
              <div className="text-[10px] text-rmpg-400">Successful</div>
              <div className="text-lg font-bold font-mono text-green-400">{h.loginStats.successful24h}</div>
            </div>
            <div className="bg-surface-sunken p-2 rounded-sm">
              <div className="text-[10px] text-rmpg-400">Failed</div>
              <div className="text-lg font-bold font-mono text-red-400">{h.loginStats.failed24h}</div>
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] pt-1 border-t border-rmpg-700">
            <span className="text-rmpg-400">Failure Rate</span>
            <span className={`font-mono font-bold ${failRate > 20 ? 'text-red-400' : failRate > 5 ? 'text-amber-400' : 'text-green-400'}`}>
              {failRate}%
            </span>
          </div>
        </div>
      </div>

      {/* Database Table Stats */}
      <div className="panel-beveled bg-surface-base p-3 space-y-2">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <Database className="w-3.5 h-3.5" />
          Database Table Sizes
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Object.entries(h.database.tables)
            .sort(([, a], [, b]) => b - a)
            .map(([table, count]) => (
              <div key={table} className="flex items-center justify-between bg-surface-sunken px-2 py-1 rounded-sm">
                <span className="text-[10px] text-rmpg-300 truncate">{table.replace(/_/g, ' ')}</span>
                <span className="text-[10px] font-mono font-bold text-rmpg-200 ml-2">{count.toLocaleString()}</span>
              </div>
            ))}
        </div>
      </div>

      {/* Recent Errors (Feature 28) */}
      <div className="panel-beveled bg-surface-base p-3 space-y-2">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <FileWarning className="w-3.5 h-3.5" />
          Recent Errors / Failures
        </div>
        {h.recentErrors.length === 0 ? (
          <div className="flex items-center gap-2 text-[10px] text-green-400 py-2">
            <CheckCircle2 className="w-3.5 h-3.5" />
            No recent errors
          </div>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {h.recentErrors.map((err) => (
              <div key={err.id} className="flex items-start gap-2 bg-red-950/20 border border-red-900/30 px-2 py-1 rounded-sm">
                <AlertTriangle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-medium text-red-300">{err.action}</span>
                  <span className="text-[10px] text-rmpg-400 ml-2">{err.details}</span>
                </div>
                <span className="text-[9px] text-rmpg-500 whitespace-nowrap">{new Date(err.created_at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Feature 22: User Activity Heatmap */}
      <UserActivityHeatmap />

      {/* Feature 25: API Usage Statistics */}
      <ApiUsageStats />

      {/* Feature 24: Config Change History */}
      <ConfigChangeHistory />

      {/* Feature 27: Database Backup Status */}
      <DatabaseBackupStatus />

      {/* Feature 30: Maintenance Mode Toggle */}
      <MaintenanceModeToggle />
    </div>
  );
}

// ── Feature 22: User Activity Heatmap ──────────────────
function UserActivityHeatmap() {
  const [data, setData] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    apiFetch<{ data: any[] }>('/admin/user-activity-heatmap?days=30')
      .then(res => { setData(res.data || []); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxCount = Math.max(1, ...data.map((d: any) => d.count));

  const getColor = (count: number) => {
    if (count === 0) return 'bg-rmpg-800';
    const intensity = count / maxCount;
    if (intensity > 0.75) return 'bg-brand-500';
    if (intensity > 0.5) return 'bg-brand-600';
    if (intensity > 0.25) return 'bg-brand-700';
    return 'bg-brand-800';
  };

  const grid: Record<string, number> = {};
  for (const d of data) grid[`${d.day_of_week}-${d.hour}`] = d.count;

  if (!loaded) return null;

  return (
    <div className="panel-beveled bg-surface-base p-3">
      <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-2">
        <Activity className="w-3.5 h-3.5" />
        User Activity Heatmap (Last 30 Days)
      </div>
      <div className="overflow-x-auto">
        <div className="grid gap-px" style={{ gridTemplateColumns: 'auto repeat(24, 1fr)' }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-[7px] text-rmpg-500 text-center">{h}</div>
          ))}
          {dayNames.map((day, dayIdx) => (
            <React.Fragment key={day}>
              <div className="text-[8px] text-rmpg-400 pr-1 flex items-center">{day}</div>
              {Array.from({ length: 24 }, (_, hour) => {
                const count = grid[`${dayIdx}-${hour}`] || 0;
                return (
                  <div
                    key={hour}
                    className={`w-3 h-3 ${getColor(count)}`}
                    title={`${day} ${hour}:00 - ${count} actions`}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Feature 25: API Usage Statistics ───────────────────
function ApiUsageStats() {
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    apiFetch<{ data: any }>('/admin/api-stats?days=7')
      .then(res => setStats(res.data))
      .catch(() => {});
  }, []);

  if (!stats) return null;

  return (
    <div className="panel-beveled bg-surface-base p-3">
      <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-2">
        <Globe className="w-3.5 h-3.5" />
        API Usage (Last 7 Days)
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="text-[9px] text-rmpg-500 mb-1">Top Actions</div>
          {(stats.byAction || []).slice(0, 8).map((a: any) => (
            <div key={a.action} className="flex items-center justify-between py-0.5">
              <span className="text-[10px] text-rmpg-300 truncate">{a.action}</span>
              <span className="text-[10px] font-mono text-white ml-2">{a.count}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="text-[9px] text-rmpg-500 mb-1">Top Users</div>
          {(stats.byUser || []).slice(0, 8).map((u: any, i: number) => (
            <div key={i} className="flex items-center justify-between py-0.5">
              <span className="text-[10px] text-rmpg-300 truncate">{u.full_name || 'System'}</span>
              <span className="text-[10px] font-mono text-white ml-2">{u.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Feature 24: Config Change History ──────────────────
function ConfigChangeHistory() {
  const [history, setHistory] = useState<any[]>([]);
  useEffect(() => {
    apiFetch<{ data: any[] }>('/admin/config-history?limit=20')
      .then(res => setHistory(res.data || []))
      .catch(() => {});
  }, []);

  if (history.length === 0) return null;

  return (
    <div className="panel-beveled bg-surface-base p-3">
      <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-2">
        <Zap className="w-3.5 h-3.5" />
        Recent Config Changes
      </div>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {history.map((h: any) => (
          <div key={h.id} className="flex items-center gap-2 text-[10px] py-1 border-b border-rmpg-800 last:border-0">
            <span className="text-rmpg-400 w-16 shrink-0">{new Date(h.changed_at).toLocaleDateString()}</span>
            <span className="text-brand-400 font-mono">{h.config_key}</span>
            <span className="text-rmpg-500">by</span>
            <span className="text-white">{h.changed_by_name || 'Unknown'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Feature 27: Database Backup Status ─────────────────
function DatabaseBackupStatus() {
  const [backup, setBackup] = useState<any>(null);
  useEffect(() => {
    apiFetch<{ data: any }>('/admin/backup-status')
      .then(res => setBackup(res.data))
      .catch(() => {});
  }, []);

  if (!backup) return null;

  return (
    <div className="panel-beveled bg-surface-base p-3">
      <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-2">
        <Disc className="w-3.5 h-3.5" />
        Database Backup Status
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[9px] text-rmpg-500">Database Size</div>
          <div className="text-sm font-bold text-white">{formatFileSize(backup.dbSize || 0)}</div>
        </div>
        <div>
          <div className="text-[9px] text-rmpg-500">Last Modified</div>
          <div className="text-sm font-bold text-white">
            {backup.lastModified ? new Date(backup.lastModified).toLocaleString() : 'N/A'}
          </div>
        </div>
      </div>
      {backup.backups && backup.backups.length > 0 && (
        <div className="mt-2">
          <div className="text-[9px] text-rmpg-500 mb-1">Backup Files</div>
          {backup.backups.map((b: any, i: number) => (
            <div key={i} className="flex items-center justify-between text-[10px] py-0.5">
              <span className="text-rmpg-300">{b.filename}</span>
              <span className="text-rmpg-400">{formatFileSize(b.size)} - {new Date(b.created).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Feature 30: Maintenance Mode Toggle ────────────────
function MaintenanceModeToggle() {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ enabled: boolean; message: string }>('/admin/maintenance-mode')
      .then(res => { setEnabled(res.enabled); setMessage(res.message || ''); })
      .catch(() => {});
  }, []);

  const toggle = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ enabled: boolean }>('/admin/maintenance-mode', {
        method: 'PUT',
        body: JSON.stringify({ enabled: !enabled, message }),
      });
      setEnabled(res.enabled);
    } catch { /* silent */ }
    finally { setSaving(false); }
  };

  return (
    <div className={`panel-beveled bg-surface-base p-3 ${enabled ? 'border-l-2 border-l-amber-500' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <AlertTriangle className={`w-3.5 h-3.5 ${enabled ? 'text-amber-400' : 'text-rmpg-500'}`} />
          Maintenance Mode
        </div>
        <button type="button"
          onClick={toggle}
          disabled={saving}
          className={`px-3 py-1 text-[10px] font-bold border ${
            enabled
              ? 'bg-red-900/30 text-red-400 border-red-700/50 hover:bg-red-900/50'
              : 'bg-green-900/30 text-green-400 border-green-700/50 hover:bg-green-900/50'
          }`}
          aria-label={enabled ? 'Disable maintenance mode' : 'Enable maintenance mode'}
        >
          {saving ? 'Saving...' : enabled ? 'DISABLE' : 'ENABLE'}
        </button>
      </div>
      {enabled && (
        <div className="text-[10px] text-amber-400 mb-2">
          Maintenance mode is ACTIVE. Users will see a maintenance banner.
        </div>
      )}
      <input
        value={message}
        onChange={e => setMessage(e.target.value)}
        placeholder="Maintenance message shown to users..."
        className="w-full px-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none"
      />
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────

function MetricCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string; sub: string; color: string;
}) {
  return (
    <div className="panel-beveled bg-surface-base p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-[10px] text-rmpg-400 uppercase tracking-wider font-bold">{label}</span>
      </div>
      <div className="text-lg font-bold font-mono text-rmpg-100 tabular-nums">{value}</div>
      <div className="text-[10px] text-rmpg-500 mt-0.5">{sub}</div>
    </div>
  );
}

function MemoryBar({ label, current, total }: { label: string; current: number; total: number }) {
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const color = percent > 85 ? 'bg-red-500' : percent > 65 ? 'bg-amber-500' : 'bg-green-500';

  return (
    <div>
      <div className="flex items-center justify-between text-[10px] mb-0.5">
        <span className="text-rmpg-400">{label}</span>
        <span className="font-mono text-rmpg-300">{formatFileSize(current)}</span>
      </div>
      <div className="h-1.5 bg-rmpg-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all duration-500 rounded-full`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
