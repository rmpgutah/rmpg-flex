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

export default function AdminHealthTab({ LoadingSpinner }: Props) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [changelog, setChangelog] = useState<ChangelogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [showChangelog, setShowChangelog] = useState(false);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<HealthData>('/admin/health/detailed');
      setHealth(data);
      setLastRefresh(new Date());
    } catch (err: any) {
      console.error('Failed to fetch health data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchChangelog = useCallback(async () => {
    try {
      const data = await apiFetch<ChangelogData>('/admin/changelog');
      setChangelog(data);
    } catch (err: any) {
      console.error('Failed to fetch changelog:', err);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    fetchChangelog();
    const interval = setInterval(fetchHealth, 60000);
    return () => clearInterval(interval);
  }, [fetchHealth, fetchChangelog]);

  if (loading && !health) return <LoadingSpinner />;

  const h = health;
  if (!h) return <div className="p-6 text-rmpg-400 text-xs">Failed to load health data.</div>;

  const heapPercent = h.server.memory.heapTotal > 0
    ? Math.round((h.server.memory.heapUsed / h.server.memory.heapTotal) * 100)
    : 0;
  const heapColor = heapPercent > 85 ? 'text-red-400' : heapPercent > 65 ? 'text-amber-400' : 'text-green-400';

  const failRate = h.loginStats.successful24h + h.loginStats.failed24h > 0
    ? Math.round((h.loginStats.failed24h / (h.loginStats.successful24h + h.loginStats.failed24h)) * 100)
    : 0;

  const host = h.host;
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
            <button
              onClick={() => setShowChangelog(!showChangelog)}
              className="ml-3 flex items-center gap-1 px-2 py-0.5 rounded border border-brand-600/40 bg-brand-950/30 text-brand-400 text-[10px] font-mono font-bold hover:bg-brand-900/40 transition-colors"
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
          <button
            onClick={fetchHealth}
            disabled={loading}
            className="toolbar-btn text-[10px] flex items-center gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Changelog Panel (collapsible) */}
      {showChangelog && changelog && (
        <div className="panel-beveled bg-surface-base p-3 space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
            <Tag className="w-3.5 h-3.5" />
            Version History
          </div>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {changelog.changelog.map((entry) => (
              <div key={entry.version} className="border border-rmpg-700/50 rounded-sm overflow-hidden">
                <button
                  onClick={() => toggleVersion(entry.version)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-sunken transition-colors"
                >
                  {expandedVersions.has(entry.version) ? (
                    <ChevronDown className="w-3 h-3 text-rmpg-400 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-rmpg-400 shrink-0" />
                  )}
                  <span className="text-[11px] font-mono font-bold text-rmpg-100">v{entry.version}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${versionTypeBadge(entry.type)}`}>
                    {toDisplayLabel(entry.type)}
                  </span>
                  <span className="text-[10px] text-rmpg-400 flex-1">{entry.summary}</span>
                  <span className="text-[9px] text-rmpg-500 font-mono">{entry.date}</span>
                </button>
                {expandedVersions.has(entry.version) && (
                  <div className="px-3 pb-2 space-y-1 bg-surface-sunken/50">
                    {entry.changes.map((change, i) => (
                      <div key={i} className="flex items-start gap-2 py-0.5">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border shrink-0 mt-0.5 ${changeTypeBadge(change.type)}`}>
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

      {/* Recent Errors */}
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
      <div className="text-lg font-bold font-mono text-rmpg-100">{value}</div>
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
